/**
 * Limbus Command - 地圖模組
 * 處理地圖渲染、工具、地形等
 */

// ===== 測距尺狀態 =====
let isMeasuring = false;
let rulerPoints = [];       // 所有折點的格子座標 [{x, y}, ...]
let rulerCurrentPos = null; // 目前游標的格子座標

// ===== 地圖初始化 =====
/**
 * 初始化地圖資料
 */
function initMapData() {
    state.mapData = Array(state.mapH).fill().map(() => Array(state.mapW).fill(0));
}

// ===== 主題與工具 =====
/**
 * 更換地圖主題
 * 將該主題的地形匯入調色盤（合併，不覆蓋已存在的）
 * @param {string|number} id - 主題 ID
 */
function changeMapTheme(id) {
    if (myRole !== 'st') return;
    state.themeId = parseInt(id);

    // 用該主題的地形取代調色盤
    const theme = MAP_PRESETS[state.themeId] || MAP_PRESETS[0];
    state.mapPalette = theme.tiles.map(t => ({
        id: t.id, name: t.name,
        color: t.color, effect: t.effect
    }));

    updateToolbar();
    if (typeof syncMapPalette === 'function') syncMapPalette();
    broadcastState();
}

/**
 * 更新工具列
 * 從 state.mapPalette 讀取地形，並提供新增按鈕
 */
function updateToolbar() {
    const container = document.getElementById('dynamic-tools');
    if (!container) return;

    // 確保調色盤已初始化
    if (typeof initMapPalette === 'function') initMapPalette();

    // 清空容器並重建所有工具
    container.innerHTML = '';

    // 固定工具：游標
    const cursorBtn = document.createElement('button');
    cursorBtn.className = 'tool-btn' + (currentTool === 'cursor' ? ' active' : '');
    cursorBtn.dataset.tool = 'cursor';
    cursorBtn.innerText = '👆';
    cursorBtn.onclick = () => setTool('cursor');
    container.appendChild(cursorBtn);

    // 固定工具：橡皮擦
    const floorBtn = document.createElement('button');
    floorBtn.className = 'tool-btn' + (currentTool === 'floor' ? ' active' : '');
    floorBtn.dataset.tool = 'floor';
    floorBtn.innerText = '🧹';
    floorBtn.onclick = () => setTool('floor');
    container.appendChild(floorBtn);

    // 從調色盤渲染地形按鈕
    const palette = state.mapPalette || [];
    palette.forEach(tile => {
        if (tile.name === '地板') return;

        const btn = document.createElement('button');
        btn.className = 'tool-btn' + (currentTool == tile.id ? ' active' : '');
        btn.dataset.tool = tile.id;
        btn.title = `${tile.name}\n${tile.effect}\n(右鍵編輯)`;
        btn.onclick = () => setTool(tile.id);

        // 右鍵編輯地形
        btn.oncontextmenu = (e) => {
            e.preventDefault();
            if (myRole === 'st' && typeof openTileEditorModal === 'function') {
                openTileEditorModal(tile.id);
            }
        };

        const dot = document.createElement('div');
        dot.className = 'color-indicator';
        dot.style.backgroundColor = tile.color;

        btn.innerText = tile.name.substring(0, 1);
        btn.appendChild(dot);
        container.appendChild(btn);
    });

    // ST 才顯示「+」新增地形按鈕
    if (myRole === 'st') {
        const addBtn = document.createElement('button');
        addBtn.className = 'tool-btn tool-btn-add';
        addBtn.title = '新增自訂地形';
        addBtn.innerText = '+';
        addBtn.onclick = () => {
            if (typeof openTileEditorModal === 'function') openTileEditorModal();
        };
        container.appendChild(addBtn);
    }
}

/**
 * 設定當前工具
 * @param {string|number} tool - 工具 ID
 */
function setTool(tool) {
    currentTool = tool;

    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
    if (btn) btn.classList.add('active');

    if (myRole === 'st') {
        const panel = document.getElementById('tile-info-panel');
        const info = document.getElementById('tile-effect-desc');
        let desc = "";

        if (tool === 'floor') {
            desc = "清除格子";
        } else if (tool === 'cursor') {
            desc = "選擇單位 / 查看格子";
        } else {
            const t = (typeof getTileFromPalette === 'function')
                ? getTileFromPalette(parseInt(tool))
                : null;
            if (t) desc = `${t.name}: ${t.effect}`;
        }

        if (info) info.innerText = desc;
        if (panel) panel.style.display = 'block';
    }
}

/**
 * 調整地圖大小
 */
function resizeMap() {
    const w = parseInt(document.getElementById('map-w').value);
    const h = parseInt(document.getElementById('map-h').value);

    const minSize = (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.MIN_SIZE : 5;
    const maxSize = (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.MAX_SIZE : 50;

    if (w < minSize || h < minSize || w > maxSize || h > maxSize) {
        showToast(`尺寸限制 ${minSize}~${maxSize}`);
        return;
    }

    const newData = Array(h).fill().map(() => Array(w).fill(0));
    for (let y = 0; y < Math.min(h, state.mapH); y++) {
        for (let x = 0; x < Math.min(w, state.mapW); x++) {
            newData[y][x] = state.mapData[y][x];
        }
    }

    state.mapW = w;
    state.mapH = h;
    state.mapData = newData;
    broadcastState();

    // 移除「套用」按鈕的變更狀態
    const applyBtn = document.querySelector('.apply-btn');
    if (applyBtn) applyBtn.classList.remove('has-changes');
}

// ===== 地圖渲染 =====
/**
 * 渲染地圖
 */
function renderMap() {
    const grid = document.getElementById('battle-map');
    if (!grid) return;

    // ===== 防呆機制：檢查地圖資料是否已載入 =====
    if (!state.mapData || state.mapData.length === 0 || !Array.isArray(state.mapData)) {
        grid.innerHTML = `
            <div style="
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                text-align: center;
                color: var(--text-dim);
                padding: 30px;
                background: var(--bg-card);
                border: 1px dashed var(--border);
                border-radius: 12px;
                max-width: 300px;
            ">
                <div style="font-size: 2rem; margin-bottom: 10px;">⏳</div>
                <div style="font-size: 1.1rem; margin-bottom: 8px; color: var(--accent-yellow);">正在讀取房間資料...</div>
                <div style="font-size: 0.8rem; line-height: 1.5;">
                    如果持續顯示此訊息，<br>請檢查連線狀態或重新整理頁面
                </div>
            </div>
        `;
        return;
    }

    const gridSize = (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.GRID_SIZE : 50;

    grid.style.gridTemplateColumns = `repeat(${state.mapW}, var(--grid-size))`;
    grid.innerHTML = '';
    
    // 設定容器尺寸
    const pxW = state.mapW * gridSize;
    const pxH = state.mapH * gridSize;
    grid.style.width = pxW + 'px';
    grid.style.height = pxH + 'px';
    
    const container = document.getElementById('map-container');
    if (container) {
        container.style.width = pxW + 'px';
        container.style.height = pxH + 'px';
        container.style.marginLeft = `-${pxW / 2}px`;
        container.style.marginTop = `-${pxH / 2}px`;
    }

    // 確保測距尺 SVG 層存在
    if (!document.getElementById('ruler-overlay')) {
        const rulerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        rulerSvg.id = 'ruler-overlay';
        container.appendChild(rulerSvg);
    }

    // 確保測距尺標籤存在
    if (!document.getElementById('ruler-label')) {
        const rulerLabel = document.createElement('div');
        rulerLabel.id = 'ruler-label';
        rulerLabel.className = 'ruler-label';
        rulerLabel.style.display = 'none';
        document.getElementById('map-viewport').appendChild(rulerLabel);
    }

    // 使用 DocumentFragment 提升效能（減少 DOM 重繪次數）
    const fragment = document.createDocumentFragment();

    // 渲染格子
    for (let y = 0; y < state.mapH; y++) {
        for (let x = 0; x < state.mapW; x++) {
            const val = state.mapData[y][x];
            const div = document.createElement('div');
            div.className = 'cell';

            // 部署高亮邏輯
            if (currentTool === 'cursor' && selectedUnitId !== null) {
                const u = findUnitById(selectedUnitId);
                const controllable = (typeof canControlUnit === 'function') ? canControlUnit(u) : true;
                if (u && u.x === -1 && controllable) {
                    div.classList.add('deploy-target');
                }
            }

            // 從調色盤查找地形定義（內含舊存檔回退邏輯）
            let tileDef = (typeof getTileFromPalette === 'function')
                ? getTileFromPalette(val)
                : null;

            // 舊存檔相容性（ID 1~3 的舊格式）
            if (!tileDef && state.themeId === 0) {
                const theme = getCurrentTheme();
                if (val === 1) tileDef = theme.tiles.find(t => t.name === '牆壁');
                else if (val === 2) tileDef = theme.tiles.find(t => t.name === '掩體');
                else if (val === 3) tileDef = theme.tiles.find(t => t.name === '險地');
            }

            if (tileDef) {
                div.style.backgroundColor = tileDef.color;
                if (tileDef.name.includes('牆') || tileDef.name.includes('掩體')) {
                    div.style.backgroundImage = 'repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(0,0,0,0.2) 4px,rgba(0,0,0,0.2) 8px)';
                }
            }

            // --- 互動事件綁定 ---

            // 儲存點擊起始座標（用於判斷是拖曳還是點擊）
            let clickStartX = null;
            let clickStartY = null;
            let cellTargetX = x;
            let cellTargetY = y;

            div.onpointerdown = (e) => {
                // 記錄起始座標
                clickStartX = e.clientX;
                clickStartY = e.clientY;

                // 游標模式
                if (currentTool === 'cursor') {
                    // 🔥 修復：如果有選中單位（準備部署或移動），阻止事件冒泡，避免觸發相機拖曳
                    if (selectedUnitId !== null) {
                        e.stopPropagation();
                        return;
                    }

                    // 游標模式下沒有選中單位時，ST 可查看該格的地形資訊
                    if (myRole === 'st') {
                        updateTileInfo(x, y);
                    }
                    // 允許事件冒泡以觸發地圖拖曳
                }
                // 繪製工具模式 (ST Only)
                else if (myRole === 'st') {
                    // 標記為開始繪製
                    isPaintingDrag = true;
                    handleMapInput(x, y, e);
                    // 阻止事件冒泡，避免觸發相機平移
                    e.stopPropagation();
                }
            };

            div.onpointerup = (e) => {
                // 游標模式 + 有選中單位 → 檢查是否為有效點擊（非拖曳）
                if (currentTool === 'cursor' && selectedUnitId !== null) {
                    // 計算拖曳距離
                    const dragDistance = Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY);

                    // 拖曳距離閾值：10px
                    const DRAG_THRESHOLD = 10;

                    // 如果是拖曳操作（超過閾值），忽略單位移動
                    if (dragDistance > DRAG_THRESHOLD) {
                        return;
                    }

                    // 如果 isDraggingMap 為 true，表示正在拖曳地圖，也要忽略
                    if (isDraggingMap) {
                        return;
                    }

                    // 有效點擊：移動單位
                    const u = findUnitById(selectedUnitId);
                    const controllable = (typeof canControlUnit === 'function') ? canControlUnit(u) : true;

                    if (u && controllable) {
                        if (myRole === 'st') {
                            u.x = cellTargetX;
                            u.y = cellTargetY;
                            selectedUnitId = null;
                            broadcastState();
                        } else {
                            sendToHost({ type: 'moveUnit', playerId: myPlayerId, unitId: u.id, x: cellTargetX, y: cellTargetY });
                            // 玩家端預先更新本地顯示
                            u.x = cellTargetX;
                            u.y = cellTargetY;
                            selectedUnitId = null;
                            renderAll();
                        }
                        // 點擊移動後阻止事件冒泡
                        e.stopPropagation();
                        return;
                    }
                }
            };

            // 實現拖曳繪製 (Mouse Drag Paint)
            div.onpointerenter = (e) => {
                // 條件：必須是 ST + 非游標工具 + 正在繪製中（已按下 pointerdown）
                if (myRole === 'st' && currentTool !== 'cursor' && isPaintingDrag) {
                    handleMapInput(x, y, e);
                }
            };

            fragment.appendChild(div);
        }
    }

    // 一次性添加所有格子到 DOM，避免多次重繪
    grid.appendChild(fragment);
    
    // 渲染 Tokens（先渲染大型單位，再渲染小型單位，確保小單位不被遮蓋）
    const sortedUnits = state.units.filter(u => u.x >= 0).sort((a, b) => {
        const sizeA = a.size || 1;
        const sizeB = b.size || 1;
        return sizeB - sizeA;  // 大型單位先渲染（z-index 較低）
    });

    sortedUnits.forEach((u, idx) => {
        // 隱形棋子：非 ST 玩家看不到，直接跳過不加入 DOM
        if (myRole !== 'st' && u.hidden === true) return;

        const t = document.createElement('div');
        const unitSize = u.size || 1;  // 預設為 1x1
        const isBoss = u.isBoss || u.type === 'boss';

        // 組合 class 名稱
        let tokenClasses = ['token', u.type];
        if (u.id === selectedUnitId) tokenClasses.push('selected');
        if (isBoss) tokenClasses.push('boss');
        if (unitSize === 2) tokenClasses.push('size-2x2');
        if (unitSize === 3) tokenClasses.push('size-3x3');
        
        t.className = tokenClasses.join(' ');
        t.dataset.unitId = u.id;

        // 根據單位大小計算 Token 尺寸
        const tokenSize = gridSize * unitSize - 4;  // -4 是邊框空間
        t.style.width = tokenSize + 'px';
        t.style.height = tokenSize + 'px';

        // +2 是為了配合 CSS 的邊框內縮，使用 Math.round() 避免小數座標導致模糊
        t.style.left = Math.round(u.x * gridSize + 2) + 'px';
        t.style.top = Math.round(u.y * gridSize + 2) + 'px';

        // GPU 加速，提升渲染清晰度
        t.style.transform = 'translateZ(0)';

        // ST 看到隱藏單位時顯示半透明
        if (myRole === 'st' && u.hidden === true) {
            t.style.opacity = '0.5';
        }

        // 大型單位 z-index 較低，小型單位較高
        // BOSS 有更高的 z-index
        if (isBoss) {
            t.style.zIndex = 50 + (3 - unitSize);
        } else {
            t.style.zIndex = 10 + (3 - unitSize);
        }

        // 大型單位調整字體大小
        if (unitSize > 1) {
            t.style.fontSize = (16 * unitSize * 0.8) + 'px';
            // 非 BOSS 的大型單位邊角更圓潤
            if (!isBoss) {
                t.style.borderRadius = '12px';
            }
        }

        // ===== 頭像處理 =====
        if (u.avatar) {
            if (isBoss) {
                // BOSS 使用 CSS 變數，讓 ::before 偽元素顯示頭像
                // 這樣頭像會被 ::before 的 overflow:hidden 裁切成圓形
                // 而 ::after 的金框不受影響
                t.style.setProperty('--avatar-url', `url(${u.avatar})`);
            } else {
                // 一般單位直接設定背景圖片
                t.style.backgroundImage = `url(${u.avatar})`;
            }
        } else {
            // 沒有頭像時顯示名字首字
            const initial = (u.name && u.name.length > 0) ? u.name[0].toUpperCase() : '?';
            if (isBoss) {
                // BOSS 需要特殊處理，因為 ::before 佔據了整個空間
                // 創建一個內層 span 來顯示文字
                const textSpan = document.createElement('span');
                textSpan.style.cssText = 'position:relative;z-index:50;';
                textSpan.innerText = initial;
                t.appendChild(textSpan);
            } else {
                t.innerText = initial;
            }
        }

        // 儲存棋子點擊起始座標（用於判斷是拖曳還是點擊）
        let tokenClickStartX = null;
        let tokenClickStartY = null;

        t.onpointerdown = (e) => {
            if (currentTool !== 'cursor') return;

            // 阻止格子接收點擊事件
            e.stopPropagation();
            // 阻止圖片預設拖曳
            e.preventDefault();

            // 記錄起始座標
            tokenClickStartX = e.clientX;
            tokenClickStartY = e.clientY;
        };

        t.onpointerup = (e) => {
            if (currentTool !== 'cursor') return;
            if (tokenClickStartX === null || tokenClickStartY === null) return;

            // 阻止格子接收點擊事件
            e.stopPropagation();
            // 阻止圖片預設拖曳
            e.preventDefault();

            // 計算拖曳距離
            const dragDistance = Math.hypot(e.clientX - tokenClickStartX, e.clientY - tokenClickStartY);

            // 拖曳距離閾值：10px（與格子點擊一致）
            const DRAG_THRESHOLD = 10;

            // 如果是拖曳操作（超過閾值），忽略選中
            if (dragDistance > DRAG_THRESHOLD) {
                tokenClickStartX = null;
                tokenClickStartY = null;
                return;
            }

            // 如果 isDraggingMap 為 true，表示正在拖曳地圖，也要忽略
            if (isDraggingMap) {
                tokenClickStartX = null;
                tokenClickStartY = null;
                return;
            }

            // 有效點擊：選取該單位
            // 移動邏輯：選取後點擊地圖格子來移動（見 cell.onpointerdown）
            selectUnit(u.id);

            // 重置起始座標
            tokenClickStartX = null;
            tokenClickStartY = null;
        };

        // ===== 數字編號標記 (Number Badge) =====
        if (u.name) {
            const numMatch = u.name.match(/\d+$/);
            if (numMatch) {
                const numBadge = document.createElement('div');
                numBadge.className = 'token-number-badge';
                numBadge.innerText = numMatch[0];
                t.appendChild(numBadge);
            }
        }

        // ===== 微型狀態標記 (Status Badges) =====
        if (u.status && typeof u.status === 'object') {
            const statusKeys = Object.keys(u.status);
            const badges = [];
            statusKeys.forEach(key => {
                if (!key) return;
                const val = parseInt(u.status[key]);
                const firstChar = key.charAt(0);
                const label = (val > 1) ? firstChar + val : firstChar;
                badges.push(label);
            });
            if (badges.length > 0) {
                const statusContainer = document.createElement('div');
                statusContainer.className = 'token-status-container';
                badges.forEach(label => {
                    const badge = document.createElement('div');
                    badge.className = 'token-status-badge';
                    badge.innerText = label;
                    statusContainer.appendChild(badge);
                });
                t.appendChild(statusContainer);
            }
        }

        grid.appendChild(t);

        // ===== Your Turn 旋轉符文指示器 =====
        const unitIdx = state.units.findIndex(su => su.id === u.id);
        if (state.isCombatActive && unitIdx === state.turnIdx) {
            const rune = document.createElement('div');
            rune.className = 'turn-indicator-rune';
            // 符文大小比 token 大 60%
            const runeSize = tokenSize * 1.6;
            rune.style.width = runeSize + 'px';
            rune.style.height = runeSize + 'px';
            // 置中在 token 中心
            const tokenCenterX = u.x * gridSize + 2 + tokenSize / 2;
            const tokenCenterY = u.y * gridSize + 2 + tokenSize / 2;
            rune.style.left = Math.round(tokenCenterX) + 'px';
            rune.style.top = Math.round(tokenCenterY) + 'px';
            // SVG 符文圖騰
            rune.innerHTML = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(253,216,53,0.6)" stroke-width="1.5" stroke-dasharray="6 4"/>
                <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(253,216,53,0.4)" stroke-width="1" stroke-dasharray="3 5"/>
                <!-- 四個方位符號 -->
                <text x="50" y="8" text-anchor="middle" fill="rgba(253,216,53,0.8)" font-size="8" font-weight="bold">⬥</text>
                <text x="50" y="98" text-anchor="middle" fill="rgba(253,216,53,0.8)" font-size="8" font-weight="bold">⬥</text>
                <text x="4" y="54" text-anchor="middle" fill="rgba(253,216,53,0.8)" font-size="8" font-weight="bold">⬥</text>
                <text x="96" y="54" text-anchor="middle" fill="rgba(253,216,53,0.8)" font-size="8" font-weight="bold">⬥</text>
                <!-- 對角線裝飾 -->
                <line x1="15" y1="15" x2="22" y2="22" stroke="rgba(253,216,53,0.5)" stroke-width="1.5"/>
                <line x1="85" y1="15" x2="78" y2="22" stroke="rgba(253,216,53,0.5)" stroke-width="1.5"/>
                <line x1="15" y1="85" x2="22" y2="78" stroke="rgba(253,216,53,0.5)" stroke-width="1.5"/>
                <line x1="85" y1="85" x2="78" y2="78" stroke="rgba(253,216,53,0.5)" stroke-width="1.5"/>
                <!-- 小三角箭頭 -->
                <polygon points="50,3 47,9 53,9" fill="rgba(253,216,53,0.7)"/>
                <polygon points="50,97 47,91 53,91" fill="rgba(253,216,53,0.7)"/>
                <polygon points="3,50 9,47 9,53" fill="rgba(253,216,53,0.7)"/>
                <polygon points="97,50 91,47 91,53" fill="rgba(253,216,53,0.7)"/>
            </svg>`;
            grid.appendChild(rune);
        }
    });

    // ===== 戰鬥模式 UI 切換 =====
    if (state.isCombatActive) {
        document.body.classList.add('combat-mode');
    } else {
        document.body.classList.remove('combat-mode');
        document.body.classList.remove('navbar-peek');
        const peekBtn = document.getElementById('combat-navbar-peek');
        if (peekBtn) peekBtn.classList.remove('active');
    }

    // ===== BOSS 血條 HUD =====
    const oldHud = document.getElementById('boss-hud');

    if (state.activeBossId) {
        const boss = findUnitById(state.activeBossId);
        if (boss) {
            // 使用加權 HP 算法（B=1, L=2, A=3 分）
            const hpPercent = (typeof calculateWeightedHpPercent === 'function')
                ? calculateWeightedHpPercent(boss)
                : 100;

            if (oldHud) {
                // 更新現有 HUD：紅色血條立刻縮減，白色殘影延遲跟隨
                const fill = oldHud.querySelector('.boss-hud-fill');
                const drain = oldHud.querySelector('.boss-hud-drain');
                const nameEl = oldHud.querySelector('.boss-hud-name');
                if (nameEl) nameEl.textContent = boss.name || 'BOSS';
                if (fill) fill.style.width = hpPercent + '%';
                // 白色殘影延遲 0.4 秒後才開始移動（等紅色先扣完）
                if (drain) {
                    setTimeout(() => { drain.style.width = hpPercent + '%'; }, 400);
                }
                oldHud.classList.remove('hidden');
            } else {
                // 首次建立 HUD
                const hud = document.createElement('div');
                hud.id = 'boss-hud';
                hud.className = 'boss-hud-container';
                hud.innerHTML = `
                    <div class="boss-hud-name">${escapeHtml(boss.name || 'BOSS')}</div>
                    <div class="boss-hud-bar-frame">
                        <div class="boss-hud-drain" style="width:${hpPercent}%"></div>
                        <div class="boss-hud-fill" style="width:${hpPercent}%"></div>
                    </div>
                `;
                // 掛載到 page-map 確保只在地圖頁可見
                const mapPage = document.getElementById('page-map');
                if (mapPage) {
                    mapPage.appendChild(hud);
                } else {
                    document.body.appendChild(hud);
                }
            }
        } else {
            // activeBossId 指向的單位不存在，移除 HUD
            if (oldHud) oldHud.remove();
        }
    } else {
        // 沒有 activeBoss，移除 HUD
        if (oldHud) oldHud.remove();
    }
}

/**
 * 處理地圖輸入 (繪製地形)
 * @param {number} x - X 座標
 * @param {number} y - Y 座標
 * @param {Event} e - 事件物件
 */
// 地圖同步節流器
let mapSyncTimeout = null;

function handleMapInput(x, y, e) {
    if (currentTool === 'cursor') return;
    if (myRole !== 'st') return;

    let newVal = (currentTool === 'floor') ? 0 : parseInt(currentTool);

    if (state.mapData[y][x] !== newVal) {
        state.mapData[y][x] = newVal;

        // 優化：直接修改 DOM 樣式，而不是重繪整個地圖 (效能提升)
        if (e && e.target && e.target.classList.contains('cell')) {
            const tileDef = (typeof getTileFromPalette === 'function')
                ? getTileFromPalette(newVal) : null;

            if (tileDef) {
                e.target.style.backgroundColor = tileDef.color;
                if (tileDef.name.includes('牆') || tileDef.name.includes('掩體')) {
                    e.target.style.backgroundImage = 'repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(0,0,0,0.2) 4px,rgba(0,0,0,0.2) 8px)';
                } else {
                    e.target.style.backgroundImage = '';
                }
            } else {
                e.target.style.backgroundColor = '';
                e.target.style.backgroundImage = '';
            }
        } else {
            // 如果無法直接操作 DOM，則回退到重繪
            renderAll();
        }

        // Firebase 同步：使用節流機制，避免過於頻繁的更新
        if (typeof syncMapData === 'function') {
            // 清除舊的計時器
            if (mapSyncTimeout) clearTimeout(mapSyncTimeout);

            // 延遲 500ms 後同步（等待用戶完成連續繪製）
            mapSyncTimeout = setTimeout(() => {
                syncMapData();
                mapSyncTimeout = null;
            }, 500);
        }
    }
}

// ===== 選擇與部署 =====
/**
 * 選擇單位
 * @param {string} id - 單位 ID
 */
function selectUnit(id) {
    selectedUnitId = id;
    renderMap();
}

/**
 * 清除選擇
 */
function clearSelection() {
    selectedUnitId = null;
    currentTool = 'cursor';
    renderAll();
}

/**
 * 開始部署單位
 * @param {string} id - 單位 ID
 */
function startDeploy(id) {
    const u = findUnitById(id);
    if (!u) return;

    const controllable = (typeof canControlUnit === 'function') ? canControlUnit(u) : true;
    if (!controllable) {
        showToast('你無法操控其他人的單位');
        return;
    }

    switchPage('map');
    // 確保切換到游標工具，否則點擊格子無法觸發部署邏輯
    currentTool = 'cursor';
    setTool('cursor');  // 同時更新 UI 狀態
    selectedUnitId = id;
    renderMap();
    showToast('請在地圖上點擊位置部署');
}

/**
 * 收回單位
 * @param {string} id - 單位 ID
 */
function recallUnit(id) {
    const u = findUnitById(id);
    if (!u) return;

    const controllable = (typeof canControlUnit === 'function') ? canControlUnit(u) : true;
    if (!controllable) {
        showToast('你無法操控其他人的單位');
        return;
    }

    if (myRole === 'st') {
        u.x = -1;
        u.y = -1;
        broadcastState();
    } else {
        sendToHost({
            type: 'moveUnit',
            playerId: myPlayerId,
            unitId: id,
            x: -1,
            y: -1
        });
    }
}

// ===== 地形資訊更新 =====
/**
 * 更新側邊欄的地形資訊
 * @param {number} x - X 座標
 * @param {number} y - Y 座標
 */
function updateTileInfo(x, y) {
    const panel = document.getElementById('tile-info-panel');
    const info = document.getElementById('tile-effect-desc');
    if (!info) return;

    const val = state.mapData[y]?.[x];

    if (val === undefined) {
        info.innerText = '無法讀取地形資訊';
        if (panel) panel.style.display = 'block';
        return;
    }

    if (val === 0) {
        info.innerText = `座標 (${x}, ${y}): 地板 - 無特殊效果`;
        if (panel) panel.style.display = 'block';
        return;
    }

    const tileDef = (typeof getTileFromPalette === 'function')
        ? getTileFromPalette(val) : null;

    if (tileDef) {
        info.innerText = `座標 (${x}, ${y}): ${tileDef.name} - ${tileDef.effect}`;
    } else {
        info.innerText = `座標 (${x}, ${y}): 未知地形`;
    }

    if (panel) panel.style.display = 'block';
}

// ===== 測距尺功能 (Alt 按住 = 測量) =====
/**
 * 將螢幕座標轉換為格子座標
 * @param {number} clientX - 滑鼠螢幕 X
 * @param {number} clientY - 滑鼠螢幕 Y
 * @returns {{ x: number, y: number }} 格子座標
 */
function screenToGrid(clientX, clientY) {
    const grid = document.getElementById('battle-map');
    if (!grid) return { x: 0, y: 0 };

    const gridSize = (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.GRID_SIZE : 50;
    const rect = grid.getBoundingClientRect();

    // rect 已反映 CSS transform，除以 cam.scale 得到原始地圖像素座標
    const mapPixelX = (clientX - rect.left) / cam.scale;
    const mapPixelY = (clientY - rect.top) / cam.scale;

    let gx = Math.floor(mapPixelX / gridSize);
    let gy = Math.floor(mapPixelY / gridSize);

    // 限制在地圖範圍內
    gx = Math.max(0, Math.min(state.mapW - 1, gx));
    gy = Math.max(0, Math.min(state.mapH - 1, gy));

    return { x: gx, y: gy };
}

/**
 * 計算折線總距離
 * @param {Array} points - 折點陣列
 * @param {{ x: number, y: number }|null} current - 當前游標位置
 * @returns {number}
 */
function calcRulerDistance(points, current) {
    const all = current ? [...points, current] : points;
    let total = 0;
    for (let i = 1; i < all.length; i++) {
        const dx = all[i].x - all[i - 1].x;
        const dy = all[i].y - all[i - 1].y;
        total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
}

/**
 * 重繪測距尺 SVG（所有折線段 + 游標段）
 */
function renderRuler() {
    const svg = document.getElementById('ruler-overlay');
    if (!svg) return;

    const gridSize = (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.GRID_SIZE : 50;
    const all = rulerCurrentPos ? [...rulerPoints, rulerCurrentPos] : [...rulerPoints];

    if (all.length < 2) {
        svg.innerHTML = '';
        return;
    }

    let html = '';
    for (let i = 1; i < all.length; i++) {
        const x1 = all[i - 1].x * gridSize + gridSize / 2;
        const y1 = all[i - 1].y * gridSize + gridSize / 2;
        const x2 = all[i].x * gridSize + gridSize / 2;
        const y2 = all[i].y * gridSize + gridSize / 2;
        html += `<line class="ruler-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }

    // 在每個折點畫一個小圓點
    for (let i = 0; i < rulerPoints.length; i++) {
        const cx = rulerPoints[i].x * gridSize + gridSize / 2;
        const cy = rulerPoints[i].y * gridSize + gridSize / 2;
        html += `<circle cx="${cx}" cy="${cy}" r="4" fill="var(--accent-yellow)" stroke="rgba(0,0,0,0.8)" stroke-width="1.5"/>`;
    }

    svg.innerHTML = html;
}

/**
 * 清除測距尺狀態
 */
function clearRuler() {
    isMeasuring = false;
    rulerPoints = [];
    rulerCurrentPos = null;

    const svg = document.getElementById('ruler-overlay');
    if (svg) svg.innerHTML = '';

    const label = document.getElementById('ruler-label');
    if (label) label.style.display = 'none';
}

/**
 * 初始化測距尺事件
 * 操作方式：
 *   - 按住 Alt 鍵：開始測量，線條從游標所在格拉出
 *   - 移動滑鼠：線段跟隨游標
 *   - 右鍵點擊：新增折點（轉折）
 *   - 放開 Alt 鍵：結束測量，線條消失
 */
function initRulerEvents() {
    const vp = document.getElementById('map-viewport');
    if (!vp) return;

    // Alt 按下 → 開始測量
    window.addEventListener('keydown', e => {
        if (e.key !== 'Alt') return;
        if (isMeasuring) return; // 避免重複觸發
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

        e.preventDefault();
        isMeasuring = true;
        rulerPoints = [];
        rulerCurrentPos = null;

        // 如果有上一次 pointermove 記錄的游標位置，以此作為起點
        if (lastRulerScreenPos) {
            const start = screenToGrid(lastRulerScreenPos.x, lastRulerScreenPos.y);
            rulerPoints.push(start);
        }
    });

    // Alt 放開 → 結束測量
    window.addEventListener('keyup', e => {
        if (e.key !== 'Alt') return;
        if (!isMeasuring) return;
        clearRuler();
    });

    // 追蹤滑鼠位置（即使尚未測量也記錄，這樣按下 Alt 時能取得起點）
    window.addEventListener('pointermove', e => {
        lastRulerScreenPos = { x: e.clientX, y: e.clientY };

        if (!isMeasuring) return;

        const current = screenToGrid(e.clientX, e.clientY);

        // 若尚無折點，以當前位置作為起點
        if (rulerPoints.length === 0) {
            rulerPoints.push(current);
            return;
        }

        rulerCurrentPos = current;
        renderRuler();

        // 計算總距離
        const dist = calcRulerDistance(rulerPoints, rulerCurrentPos).toFixed(1);

        // 更新標籤
        const label = document.getElementById('ruler-label');
        if (label) {
            label.style.display = 'block';
            label.textContent = `${dist} 格`;

            const vpRect = vp.getBoundingClientRect();
            label.style.left = (e.clientX - vpRect.left) + 'px';
            label.style.top = (e.clientY - vpRect.top) + 'px';
        }
    });

    // 右鍵 → 新增折點
    vp.addEventListener('contextmenu', e => {
        if (!isMeasuring) return;

        e.preventDefault();
        e.stopPropagation();

        if (rulerCurrentPos) {
            rulerPoints.push({ ...rulerCurrentPos });
            renderRuler();
        }
    });

    // 視窗失焦時清除
    window.addEventListener('blur', () => {
        if (isMeasuring) clearRuler();
    });
}

// 追蹤游標螢幕位置（用於 Alt 按下瞬間取得起點）
let lastRulerScreenPos = null;

// ===== 地圖大小監聯器 =====
/**
 * 初始化地圖大小輸入框的監聯器
 * 當輸入框變更時，標記「套用」按鈕為待儲存狀態
 */
function initMapSizeListeners() {
    const mapWInput = document.getElementById('map-w');
    const mapHInput = document.getElementById('map-h');
    const applyBtn = document.querySelector('.apply-btn');

    if (!mapWInput || !mapHInput || !applyBtn) return;

    // 儲存初始值
    let lastW = mapWInput.value;
    let lastH = mapHInput.value;

    // 監聽變更事件
    const handleChange = () => {
        const currentW = mapWInput.value;
        const currentH = mapHInput.value;

        // 如果值有變更，標記按鈕
        if (currentW !== lastW || currentH !== lastH) {
            applyBtn.classList.add('has-changes');
        } else {
            applyBtn.classList.remove('has-changes');
        }
    };

    mapWInput.addEventListener('input', handleChange);
    mapHInput.addEventListener('input', handleChange);

    // 當套用按鈕被點擊後，更新基準值
    const originalResizeMap = window.resizeMap;
    window.resizeMap = function() {
        originalResizeMap();
        lastW = mapWInput.value;
        lastH = mapHInput.value;
    };
}

// ===== 戰鬥模式 Navbar Peek 按鈕 =====
/**
 * 初始化戰鬥模式下的 Navbar 暫開按鈕
 * 點擊切換 peek 狀態，滑鼠離開 navbar + peek 按鈕區域時自動收回
 */
function initCombatNavbarPeek() {
    const peekBtn = document.getElementById('combat-navbar-peek');
    const navbar = document.querySelector('.navbar');
    if (!peekBtn || !navbar) return;

    // 自動收回的延遲時間 (ms)：滑鼠離開後等待多久才收回
    const AUTO_CLOSE_DELAY = 500;

    // 防止 mouseleave 在開啟動畫期間誤觸的寬限期 (ms)
    let peekGraceUntil = 0;

    // 追蹤滑鼠是否在 peek 按鈕或 navbar 上
    let mouseOnNavbar = false;
    let mouseOnPeekBtn = false;

    // 自動收回的計時器 ID，用於取消
    let autoCloseTimer = null;

    function closePeek() {
        document.body.classList.remove('navbar-peek');
        peekBtn.classList.remove('active');
    }

    function scheduleAutoClose() {
        // 清除前一次排程
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        autoCloseTimer = setTimeout(() => {
            // 寬限期內不自動收回
            if (Date.now() < peekGraceUntil) return;
            // 滑鼠仍在 navbar 或 peek 按鈕上時不收回
            if (mouseOnNavbar || mouseOnPeekBtn) return;
            if (document.body.classList.contains('navbar-peek')) {
                closePeek();
            }
        }, AUTO_CLOSE_DELAY);
    }

    function cancelAutoClose() {
        if (autoCloseTimer) {
            clearTimeout(autoCloseTimer);
            autoCloseTimer = null;
        }
    }

    // 使用 pointerdown 取代 click，消除行動裝置 300ms 延遲並提高快速點擊的回應
    peekBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const isPeeking = document.body.classList.toggle('navbar-peek');
        peekBtn.classList.toggle('active', isPeeking);
        if (isPeeking) {
            // 設定寬限期：等待 navbar 滑出動畫完成 (transition 0.5s + 緩衝)
            peekGraceUntil = Date.now() + 600;
            cancelAutoClose();
        }
    });

    // 防止 pointerdown 後的 click 造成重複觸發
    peekBtn.addEventListener('click', (e) => { e.preventDefault(); });

    // 追蹤 navbar 的滑鼠進出
    navbar.addEventListener('mouseenter', () => {
        mouseOnNavbar = true;
        cancelAutoClose();
    });
    navbar.addEventListener('mouseleave', () => {
        mouseOnNavbar = false;
        scheduleAutoClose();
    });

    // 追蹤 peek 按鈕的滑鼠進出
    peekBtn.addEventListener('mouseenter', () => {
        mouseOnPeekBtn = true;
        cancelAutoClose();
    });
    peekBtn.addEventListener('mouseleave', () => {
        mouseOnPeekBtn = false;
        scheduleAutoClose();
    });
}

// 當頁面載入時自動初始化
if (typeof window !== 'undefined') {
    // 延遲執行，確保 DOM 已載入
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initMapSizeListeners();
            initCombatNavbarPeek();
        });
    } else {
        // 如果已經載入完成，直接執行
        setTimeout(() => {
            initMapSizeListeners();
            initCombatNavbarPeek();
        }, 100);
    }
}

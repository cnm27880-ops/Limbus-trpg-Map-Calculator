/**
 * Limbus Command - 地圖模組
 * 處理地圖渲染、工具、地形等
 */

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
 * @param {string|number} id - 主題 ID
 */
function changeMapTheme(id) {
    if (myRole !== 'st') return;
    state.themeId = parseInt(id);
    updateToolbar();
    sendState();
    renderAll();
}

/**
 * 更新工具列
 */
function updateToolbar() {
    const container = document.getElementById('dynamic-tools');
    if (!container) return;

    // 清空容器並重建所有工具
    container.innerHTML = '';

    // 添加固定工具
    const cursorBtn = document.createElement('button');
    cursorBtn.className = 'tool-btn active';
    cursorBtn.dataset.tool = 'cursor';
    cursorBtn.innerText = '👆';
    cursorBtn.onclick = () => setTool('cursor');
    container.appendChild(cursorBtn);

    const floorBtn = document.createElement('button');
    floorBtn.className = 'tool-btn';
    floorBtn.dataset.tool = 'floor';
    floorBtn.innerText = '🧹';
    floorBtn.onclick = () => setTool('floor');
    container.appendChild(floorBtn);

    // 添加主題工具
    const theme = getCurrentTheme();
    theme.tiles.forEach(tile => {
        if (tile.name === '地板') return;

        const btn = document.createElement('button');
        btn.className = 'tool-btn';
        btn.dataset.tool = tile.id;
        btn.title = tile.name;
        btn.onclick = () => setTool(tile.id);

        const dot = document.createElement('div');
        dot.className = 'color-indicator';
        dot.style.backgroundColor = tile.color;

        btn.innerText = tile.name.substring(0, 1);
        btn.appendChild(dot);
        container.appendChild(btn);
    });
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
        const theme = getCurrentTheme();
        let desc = "";

        if (tool === 'floor') {
            desc = "清除格子";
        } else if (tool === 'cursor') {
            desc = "選擇單位 / 查看格子";
        } else {
            const t = theme.tiles.find(x => x.id == tool);
            if (t) desc = `${t.name}: ${t.effect}`;
        }

        if (info) info.innerText = desc;
        if (panel) panel.style.display = 'block';  // 顯示面板
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
    sendState();
    renderAll();

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

    const theme = getCurrentTheme();

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
                // 檢查 canControlUnit，若無此函數則預設為 true (避免報錯)
                const controllable = (typeof canControlUnit === 'function') ? canControlUnit(u) : true;
                if (u && u.x === -1 && controllable) {
                    div.classList.add('deploy-target');
                }
            }

            // 套用地形樣式
            let tileDef = theme.tiles.find(t => t.id === val);

            // 舊存檔相容性
            if (!tileDef && state.themeId === 0) {
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
                            sendState();
                            renderAll();
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

        // +2 是為了配合 CSS 的邊框內縮
        t.style.left = (u.x * gridSize + 2) + 'px';
        t.style.top = (u.y * gridSize + 2) + 'px';

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

        // ===== 環狀血量條 (HP Ring) =====
        const hpArr = u.hpArr || [];
        const maxHp = u.maxHp || hpArr.length || 1;

        // 只有在有傷害時才顯示血量環
        const hasDamage = hpArr.some(h => h > 0);
        if (hasDamage && maxHp > 0) {
            // 統計各類傷害
            const bCount = hpArr.filter(h => h === 1).length;  // B傷
            const lCount = hpArr.filter(h => h === 2).length;  // L傷
            const aCount = hpArr.filter(h => h === 3).length;  // A傷
            const emptyCount = maxHp - bCount - lCount - aCount;  // 完好

            // 計算百分比（轉換為度數，一圈 = 360deg）
            let gradientStops = [];
            let currentDeg = 0;

            // 順序：A傷（紅）→ L傷（橙）→ B傷（藍）→ 完好（深灰）
            // 這樣最嚴重的傷害在最前面
            if (aCount > 0) {
                const aDeg = (aCount / maxHp) * 360;
                gradientStops.push(`var(--accent-red) ${currentDeg}deg ${currentDeg + aDeg}deg`);
                currentDeg += aDeg;
            }
            if (lCount > 0) {
                const lDeg = (lCount / maxHp) * 360;
                gradientStops.push(`var(--accent-orange) ${currentDeg}deg ${currentDeg + lDeg}deg`);
                currentDeg += lDeg;
            }
            if (bCount > 0) {
                const bDeg = (bCount / maxHp) * 360;
                gradientStops.push(`var(--accent-blue) ${currentDeg}deg ${currentDeg + bDeg}deg`);
                currentDeg += bDeg;
            }
            if (emptyCount > 0) {
                // 完好部分用深灰色顯示
                gradientStops.push(`#333 ${currentDeg}deg 360deg`);
            }

            // 創建血量環 DOM
            const hpRing = document.createElement('div');
            hpRing.className = 'token-hp-ring';
            hpRing.style.setProperty('--hp-ring-gradient', `conic-gradient(${gradientStops.join(', ')})`);
            t.appendChild(hpRing);
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

        grid.appendChild(t);
    });
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
            const theme = getCurrentTheme();
            const tileDef = theme.tiles.find(t => t.id === newVal);

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
        sendState();
        renderAll();
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

    const theme = getCurrentTheme();
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

    const tileDef = theme.tiles.find(t => t.id === val);
    if (tileDef) {
        info.innerText = `座標 (${x}, ${y}): ${tileDef.name} - ${tileDef.effect}`;
    } else {
        info.innerText = `座標 (${x}, ${y}): 未知地形`;
    }

    // 顯示地形效果面板
    if (panel) panel.style.display = 'block';
}

// ===== 地圖大小監聽器 =====
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

// 當頁面載入時自動初始化
if (typeof window !== 'undefined') {
    // 延遲執行，確保 DOM 已載入
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMapSizeListeners);
    } else {
        // 如果已經載入完成，直接執行
        setTimeout(initMapSizeListeners, 100);
    }
}

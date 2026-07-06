/**
 * Limbus Command - 地圖模組
 * 處理地圖渲染、工具、地形等
 */

// ===== 工具列圖示（以單色線條 SVG 取代 emoji，跟隨按鈕文字色，質感較一致） =====
const TOOL_ICON_CURSOR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M5 3l14 8-6.3 1.8L10.5 20z"/></svg>';
const TOOL_ICON_ERASER = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M18.5 12.5l-7 7H6l-3-3a2 2 0 0 1 0-2.8l9-9a2 2 0 0 1 2.8 0l3.7 3.7a2 2 0 0 1 0 2.8z"/><path d="M13 6l5 5"/><path d="M8 20h9"/></svg>';

// ===== 測距尺狀態 =====
let isMeasuring = false;
let rulerPoints = [];       // 所有折點的格子座標 [{x, y}, ...]
let rulerCurrentPos = null; // 目前游標的格子座標

// ===== 拖曳移動棋子（長按拿起，拖曳中即時顯示標尺）=====
let dragUnitId = null;             // 目前正在拖曳的單位 id（null = 未拖曳）
let dragOriginCell = null;         // 拖曳起點格子座標 {x, y}
let dragHoverCell = null;          // 拖曳中目前懸停的格子座標 {x, y}
let dragLongPressTimer = null;     // 長按計時器
let dragCandidateStartPos = null;  // 長按計時中的起始螢幕座標，供中途取消判斷
const TOKEN_DRAG_LONGPRESS_MS = 250;
const TOKEN_DRAG_CANCEL_PX = 10;   // 長按計時中若已移動超過此距離，視為一般手勢而取消長按

// ===== 地圖背景圖 =====

function triggerMapBgUpload() {
    document.getElementById('map-bg-upload').click();
}

function handleMapBgUpload(input) {
    if (myRole !== 'st') return;
    const file = input.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) {
        if (typeof showToast === 'function') showToast('圖片過大（上限 10MB）');
        input.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // 壓縮後才能存進 Firebase 同步給玩家（原圖可能太大）
            const compressed = compressMapBgImage(img);
            if (!compressed) {
                if (typeof showToast === 'function') showToast('背景圖處理失敗');
                return;
            }
            state.mapBgImage = compressed;
            applyMapBg();
            saveMapBgToStorage();
            if (typeof syncMapBg === 'function') syncMapBg();
            renderMap();
            if (typeof showToast === 'function') showToast('背景圖已設定，並同步給所有玩家');
        };
        img.onerror = function() {
            if (typeof showToast === 'function') showToast('圖片載入失敗');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

/**
 * 壓縮背景圖：長邊縮到 1600px，輸出 JPEG
 * 並逐步降低品質直到 base64 小於 900KB（Firebase 同步用）
 */
function compressMapBgImage(img) {
    try {
        const MAX_DIM = 1600;
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);

        let quality = 0.85;
        let out = canvas.toDataURL('image/jpeg', quality);
        while (out.length > 900000 && quality > 0.4) {
            quality -= 0.15;
            out = canvas.toDataURL('image/jpeg', quality);
        }
        return out;
    } catch (e) {
        console.error('背景圖壓縮失敗:', e);
        return null;
    }
}

function clearMapBg() {
    state.mapBgImage = null;
    applyMapBg();
    saveMapBgToStorage();
    if (typeof syncMapBg === 'function') syncMapBg();
    renderMap();
    if (typeof showToast === 'function') showToast('背景圖已清除');
}

function applyMapBg() {
    const grid = document.getElementById('battle-map');
    const clearBtn = document.getElementById('clear-map-bg-btn');
    if (!grid) return;
    if (state.mapBgImage) {
        grid.style.backgroundImage = `url(${state.mapBgImage})`;
        grid.classList.add('has-map-bg');
        if (clearBtn) clearBtn.style.display = '';
    } else {
        grid.style.backgroundImage = '';
        grid.classList.remove('has-map-bg');
        if (clearBtn) clearBtn.style.display = 'none';
    }
}

function saveMapBgToStorage() {
    try {
        if (state.mapBgImage) {
            localStorage.setItem('limbus_map_bg', state.mapBgImage);
        } else {
            localStorage.removeItem('limbus_map_bg');
        }
    } catch(e) {
        if (typeof showToast === 'function') showToast('背景圖儲存失敗（容量不足）');
    }
}

function loadMapBgFromStorage() {
    try {
        const saved = localStorage.getItem('limbus_map_bg');
        if (saved) {
            state.mapBgImage = saved;
        }
    } catch(e) {
        console.error('Failed to load map background:', e);
    }
}

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
        color: t.color, effect: t.effect,
        moveCostMultiplier: t.moveCostMultiplier || 1
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
    cursorBtn.title = '選取／移動';
    cursorBtn.innerHTML = TOOL_ICON_CURSOR;
    cursorBtn.onclick = () => setTool('cursor');
    container.appendChild(cursorBtn);

    // 固定工具：橡皮擦
    const floorBtn = document.createElement('button');
    floorBtn.className = 'tool-btn' + (currentTool === 'floor' ? ' active' : '');
    floorBtn.dataset.tool = 'floor';
    floorBtn.title = '清除地形（回復地板）';
    floorBtn.innerHTML = TOOL_ICON_ERASER;
    floorBtn.onclick = () => setTool('floor');
    container.appendChild(floorBtn);

    // 從調色盤渲染地形按鈕
    const palette = state.mapPalette || [];
    palette.forEach(tile => {
        if (tile.name === '地板') return;

        const btn = document.createElement('button');
        btn.className = 'tool-btn' + (currentTool == tile.id ? ' active' : '');
        btn.dataset.tool = tile.id;
        const moveCostNote = (tile.moveCostMultiplier && tile.moveCostMultiplier !== 1)
            ? `\n移動消耗 ×${tile.moveCostMultiplier}` : '';
        btn.title = `${tile.name}\n${tile.effect}${moveCostNote}\n(右鍵編輯)`;
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
        } else if (tool === 'fog-hide') {
            desc = "迷霧補畫：恢復迷霧（隱藏）";
        } else if (tool === 'fog-reveal') {
            desc = "迷霧補畫：手動顯示（清除迷霧）";
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

    const wInput = document.getElementById('map-w');
    const hInput = document.getElementById('map-h');
    if (wInput && state.mapW) wInput.value = state.mapW;
    if (hInput && state.mapH) hInput.value = state.mapH;
    
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

    // 套用背景圖
    applyMapBg();

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

    // ===== Canvas 地圖層（取代 2500 個 .cell DOM 節點，效能優化）=====
    // 確保 canvas 存在並符合目前地圖尺寸；指標互動（選取/部署/移動/繪製）已在
    // map-canvas.js 的 attachMapCanvasEvents 內處理，行為與舊版 .cell 完全一致。
    ensureMapCanvas();

    // 移除上一輪的動態 DOM（Token / 回合符文），保留 canvas 地圖層
    grid.querySelectorAll('.token, .turn-indicator-rune').forEach(n => n.remove());

    // 在 canvas 上繪製格子地形、格線與部署高亮
    drawMapCanvas();

    // 戰爭迷霧疊加層（獨立 canvas，蓋在 Token 之上；由自身的動畫迴圈持續重繪翻滾效果）
    if (typeof ensureFogCanvas === 'function') ensureFogCanvas();

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
        // 拖曳中的棋子：即使因遠端更新觸發重繪，也維持懸停格視覺（不彈回原位）
        if (u.id === dragUnitId && dragHoverCell) tokenClasses.push('token-dragging');
        
        t.className = tokenClasses.join(' ');
        t.dataset.unitId = u.id;

        // 根據單位大小計算 Token 尺寸
        const tokenSize = gridSize * unitSize - 4;  // -4 是邊框空間
        t.style.width = tokenSize + 'px';
        t.style.height = tokenSize + 'px';

        // +2 是為了配合 CSS 的邊框內縮，使用 Math.round() 避免小數座標導致模糊
        // 拖曳中的棋子：以懸停格取代實際座標，避免重繪時彈回原位
        const posCell = (u.id === dragUnitId && dragHoverCell) ? dragHoverCell : u;
        t.style.left = Math.round(posCell.x * gridSize + 2) + 'px';
        t.style.top = Math.round(posCell.y * gridSize + 2) + 'px';

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

        // ===== 移動能量條（綠色）=====
        // 戰鬥中顯示本回合剩餘移動格數（floor(移動速度/5) - 已消耗）；
        // 玩家只看得到自己可控單位的能量條，ST 看得到全部。
        if (state.isCombatActive && typeof getUnitMaxMoveGrids === 'function') {
            const maxMove = getUnitMaxMoveGrids(u);
            const canSeeBar = (typeof canControlUnit === 'function') ? canControlUnit(u) : (myRole === 'st');
            if (maxMove > 0 && canSeeBar) {
                const remaining = getUnitMoveRemaining(u);
                const moveBar = document.createElement('div');
                moveBar.className = 'token-move-bar';
                moveBar.title = `移動能量：${remaining}/${maxMove} 格`;
                const moveFill = document.createElement('div');
                moveFill.className = 'token-move-fill' + (remaining === 0 ? ' depleted' : '');
                moveFill.style.width = Math.round((remaining / maxMove) * 100) + '%';
                moveBar.appendChild(moveFill);
                t.appendChild(moveBar);
            }
        }

        // 儲存棋子點擊起始座標（用於判斷是拖曳還是點擊）
        let tokenClickStartX = null;
        let tokenClickStartY = null;

        // 右鍵開啟快速操作選單
        t.oncontextmenu = (e) => {
            if (typeof openUnitContextMenu === 'function') {
                openUnitContextMenu(e, u.id);
            }
        };

        t.onpointerdown = (e) => {
            if (currentTool !== 'cursor') return;
            // 只處理左鍵（右鍵留給快速選單，不參與選取）
            if (e.button !== undefined && e.button !== 0) return;

            // 阻止格子接收點擊事件
            e.stopPropagation();
            // 阻止圖片預設拖曳
            e.preventDefault();

            // 記錄起始座標
            tokenClickStartX = e.clientX;
            tokenClickStartY = e.clientY;

            // 長按拿起：僅可操控的單位、且非群體選取模式時才啟動拖曳移動計時
            const controllable = (typeof canControlUnit === 'function') ? canControlUnit(u) : true;
            const inAoeMode = (typeof aoeIsSelecting === 'function') && aoeIsSelecting();
            if (controllable && !inAoeMode) {
                dragCandidateStartPos = { x: e.clientX, y: e.clientY };
                clearTimeout(dragLongPressTimer);
                dragLongPressTimer = setTimeout(() => {
                    dragLongPressTimer = null;
                    startTokenDrag(u);
                }, TOKEN_DRAG_LONGPRESS_MS);
            }
        };

        t.onpointerup = (e) => {
            if (currentTool !== 'cursor') return;
            // 只處理左鍵
            if (e.button !== undefined && e.button !== 0) return;

            clearTimeout(dragLongPressTimer);
            dragLongPressTimer = null;
            dragCandidateStartPos = null;

            // 長按已啟動拖曳：放開即落地結算，不走一般選取/點擊流程
            if (dragUnitId === u.id) {
                e.stopPropagation();
                e.preventDefault();
                finishTokenDrag();
                tokenClickStartX = null;
                tokenClickStartY = null;
                return;
            }

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

            // 群體選取模式（長按 T）：點擊改為切換 AOE 選取，不走一般選取/移動流程
            if (typeof aoeIsSelecting === 'function' && aoeIsSelecting()) {
                if (typeof aoeToggleUnit === 'function') aoeToggleUnit(u.id);
                tokenClickStartX = null;
                tokenClickStartY = null;
                return;
            }

            // 有效點擊：選取該單位；再點一次同一單位則取消選取
            // 移動邏輯：選取後點擊地圖格子來移動（見 cell.onpointerdown）
            if (selectedUnitId === u.id) {
                clearSelection();
            } else {
                selectUnit(u.id);
            }

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

        // ===== 懸浮狀態提示框 (Tooltip)：每個狀態一個色塊小卡，依增益/減益上色，多狀態時自動換行 =====
        if (u.status && typeof u.status === 'object' && Object.keys(u.status).length > 0) {
            const statusKeys = Object.keys(u.status);
            const tooltip = document.createElement('div');
            tooltip.className = 'token-tooltip';
            let hasValidStatus = false;

            statusKeys.forEach(key => {
                if (!key) return;
                const val = parseInt(u.status[key]);
                if (val <= 0) return;
                hasValidStatus = true;

                // 呼叫 getStatusById 取得中文名稱和圖示 (定義於 status-config.js)
                const statusDef = (typeof getStatusById === 'function') ? getStatusById(key) : null;
                const isDebuff = (typeof isDebuffStatus === 'function') ? isDebuffStatus(key) : false;

                const chip = document.createElement('span');
                chip.className = 'token-status-chip ' + (isDebuff ? 'is-debuff' : 'is-buff');

                if (statusDef && statusDef.icon) {
                    const icon = document.createElement('span');
                    icon.className = 'token-status-icon';
                    icon.textContent = statusDef.icon;
                    chip.appendChild(icon);
                }
                const nameSpan = document.createElement('span');
                nameSpan.textContent = statusDef ? statusDef.name : key;
                chip.appendChild(nameSpan);
                const valSpan = document.createElement('span');
                valSpan.className = 'token-status-val';
                valSpan.textContent = val;
                chip.appendChild(valSpan);

                tooltip.appendChild(chip);
            });

            if (hasValidStatus) {
                t.classList.add('token-has-status');
                t.appendChild(tooltip);

                // 手機端支援：長按/右鍵切換顯示 tooltip
                t.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    t.classList.toggle('show-tooltip');
                });
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

    // 戰爭迷霧補畫筆刷：交給 fog.js 處理，不繼續套用地形繪製
    if (typeof fogHandleToolPaint === 'function' && fogHandleToolPaint(currentTool, x, y)) return;

    let newVal = (currentTool === 'floor') ? 0 : parseInt(currentTool);

    if (state.mapData[y][x] !== newVal) {
        state.mapData[y][x] = newVal;

        // Canvas 模式：直接重繪 canvas 地圖層（取代逐格 DOM 操作）。
        // 單一 canvas 的 2D 填色重繪成本極低，繪製拖曳時也能維持流暢。
        if (typeof drawMapCanvas === 'function') {
            drawMapCanvas();
        } else {
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
        const moveCostNote = (tileDef.moveCostMultiplier && tileDef.moveCostMultiplier !== 1)
            ? `（移動消耗 ×${tileDef.moveCostMultiplier}）` : '';
        info.innerText = `座標 (${x}, ${y}): ${tileDef.name} - ${tileDef.effect}${moveCostNote}`;
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

// ===== 移動攔截器（5 米 1 格，斜走加倍）=====
/**
 * 移動防呆攔截：在單位移動到 (targetX, targetY) 前檢查並消耗移動能量。
 *
 * 規則：
 *   - ST 可自由移動所有棋子，不消耗、不受限。
 *   - 部署（從場外 x=-1 進場）與收回不消耗能量。
 *   - 非戰鬥中不設限（回合制能量只在戰鬥回合內結算）。
 *   - 戰鬥中：以戰術消耗算法（直走 1、斜走 2）計算消耗，
 *     超過剩餘能量（floor(移動速度/5) - 本回合已消耗）則攔截並提示。
 *
 * 通過檢查時會把消耗累加到 unit.moveUsed（能量條扣除），呼叫端負責同步。
 * @param {Object} unit - 要移動的單位
 * @param {number} targetX - 目標格 X
 * @param {number} targetY - 目標格 Y
 * @returns {boolean} true = 放行；false = 已攔截（並顯示提示）
 */
function applyMoveCost(unit, targetX, targetY) {
    if (!unit) return false;
    if (myRole === 'st') return true;                     // ST 自由移動
    if (unit.x < 0 || targetX < 0) return true;           // 部署 / 收回不計消耗
    if (!state.isCombatActive) return true;               // 非戰鬥中不設限

    const cost = (typeof calcTacticalPathCost === 'function')
        ? calcTacticalPathCost(unit.x, unit.y, targetX, targetY)
        : calcTacticalCost(targetX - unit.x, targetY - unit.y);
    if (cost === 0) return true;

    const remaining = getUnitMoveRemaining(unit);
    if (cost > remaining) {
        showToast(`⚡ 移動能量不足：需要 ${cost} 格，剩餘 ${remaining} 格`);
        return false;
    }

    unit.moveUsed = (parseInt(unit.moveUsed) || 0) + cost;
    return true;
}

/**
 * 計算折線總消耗格數（戰術消耗算法：直走 1 格消耗 1，斜走 1 格消耗 2）
 * @param {Array} points - 折點陣列
 * @param {{ x: number, y: number }|null} current - 當前游標位置
 * @returns {number} 總消耗格數（整數）
 */
function calcRulerDistance(points, current) {
    const all = current ? [...points, current] : points;
    let total = 0;
    for (let i = 1; i < all.length; i++) {
        total += (typeof calcTacticalPathCost === 'function')
            ? calcTacticalPathCost(all[i - 1].x, all[i - 1].y, all[i].x, all[i].y)
            : calcTacticalCost(all[i].x - all[i - 1].x, all[i].y - all[i - 1].y);
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

// ===== 拖曳移動棋子（長按拿起，拖曳中即時顯示標尺）=====
// 不快取 Token DOM 節點：renderMap() 可能因遠端 Firebase 更新而在拖曳中重繪，
// 每次都以 querySelector 重新取得目前存在的節點，避免操作到已被移除的舊節點。
function _dragTokenEl(unitId) {
    return document.querySelector(`.token[data-unit-id="${CSS.escape(String(unitId))}"]`);
}

/** 長按判定通過：進入拖曳模式，標尺起點設為棋子目前所在格 */
function startTokenDrag(u) {
    if (dragUnitId || !u) return;
    dragUnitId = u.id;
    dragOriginCell = { x: u.x, y: u.y };
    dragHoverCell = { x: u.x, y: u.y };

    rulerPoints = [{ ...dragOriginCell }];
    rulerCurrentPos = null;
    renderRuler();

    const el = _dragTokenEl(u.id);
    if (el) el.classList.add('token-dragging');
}

/** 拖曳中移動：格子變化時才更新（避免同格內小幅移動觸發過多重繪） */
function updateTokenDragPosition(clientX, clientY) {
    if (!dragUnitId) return;
    const gridSize = (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.GRID_SIZE : 50;
    const cell = screenToGrid(clientX, clientY);
    if (dragHoverCell && cell.x === dragHoverCell.x && cell.y === dragHoverCell.y) return;
    dragHoverCell = cell;

    const el = _dragTokenEl(dragUnitId);
    if (el) {
        el.style.left = Math.round(cell.x * gridSize + 2) + 'px';
        el.style.top = Math.round(cell.y * gridSize + 2) + 'px';
    }

    rulerCurrentPos = { ...cell };
    renderRuler();
    updateDragRulerLabel(clientX, clientY);
}

/** 更新拖曳中的標尺文字：玩家顯示「消耗／剩餘」，超出移動能量時標紅 */
function updateDragRulerLabel(clientX, clientY) {
    const label = document.getElementById('ruler-label');
    const vp = document.getElementById('map-viewport');
    if (!label || !vp) return;

    const cost = calcRulerDistance(rulerPoints, rulerCurrentPos);
    const unit = (typeof findUnitById === 'function') ? findUnitById(dragUnitId) : null;

    let text = `消耗 ${cost} 格`;
    let over = false;
    if (unit && myRole !== 'st' && state.isCombatActive && typeof getUnitMoveRemaining === 'function') {
        const remaining = getUnitMoveRemaining(unit);
        text = `消耗 ${cost}／剩 ${remaining} 格`;
        over = cost > remaining;
    }
    label.classList.toggle('ruler-label-over', over);
    label.style.display = 'block';
    label.textContent = text;

    const vpRect = vp.getBoundingClientRect();
    label.style.left = (clientX - vpRect.left) + 'px';
    label.style.top = (clientY - vpRect.top) + 'px';
}

/** 放開：落地結算移動（沿用既有的能量攔截／ST 自由移動邏輯） */
function finishTokenDrag() {
    if (!dragUnitId) return;
    const unitId = dragUnitId;
    const origin = dragOriginCell;
    const cell = dragHoverCell;

    const el = _dragTokenEl(unitId);
    if (el) el.classList.remove('token-dragging');
    dragUnitId = null;
    dragOriginCell = null;
    dragHoverCell = null;
    clearRuler();

    if (!cell || !origin || (cell.x === origin.x && cell.y === origin.y)) return;

    const u = (typeof findUnitById === 'function') ? findUnitById(unitId) : null;
    if (!u) return;

    if (myRole === 'st') {
        u.x = cell.x;
        u.y = cell.y;
        broadcastState();
    } else {
        if (typeof applyMoveCost === 'function' && !applyMoveCost(u, cell.x, cell.y)) {
            renderAll();  // 能量不足：applyMoveCost 已顯示 toast，重繪讓棋子彈回原位
            return;
        }
        sendToHost({ type: 'moveUnit', playerId: myPlayerId, unitId: u.id, x: cell.x, y: cell.y, moveUsed: u.moveUsed || 0 });
        u.x = cell.x;
        u.y = cell.y;
        renderAll();
    }
}

/** 中途取消（例如 pointercancel）：不落地，直接還原視覺狀態 */
function cancelTokenDrag() {
    if (!dragUnitId) return;
    const el = _dragTokenEl(dragUnitId);
    if (el) el.classList.remove('token-dragging');
    dragUnitId = null;
    dragOriginCell = null;
    dragHoverCell = null;
    clearRuler();
}

/** 全域指標事件：追蹤長按拿起後的拖曳移動（由 main.js 初始化時呼叫一次） */
function initTokenDragEvents() {
    window.addEventListener('pointermove', (e) => {
        if (dragUnitId) {
            updateTokenDragPosition(e.clientX, e.clientY);
            return;
        }
        // 長按計時中：移動過多視為一般手勢（例如相機平移），取消長按判定
        if (dragCandidateStartPos && dragLongPressTimer) {
            const dist = Math.hypot(e.clientX - dragCandidateStartPos.x, e.clientY - dragCandidateStartPos.y);
            if (dist > TOKEN_DRAG_CANCEL_PX) {
                clearTimeout(dragLongPressTimer);
                dragLongPressTimer = null;
                dragCandidateStartPos = null;
            }
        }
    });

    // 放開時可能不在棋子元素上方（拖到空地放開），故需全域監聽作為保底結算
    window.addEventListener('pointerup', () => {
        clearTimeout(dragLongPressTimer);
        dragLongPressTimer = null;
        dragCandidateStartPos = null;
        if (dragUnitId) finishTokenDrag();
    });

    window.addEventListener('pointercancel', () => {
        clearTimeout(dragLongPressTimer);
        dragLongPressTimer = null;
        dragCandidateStartPos = null;
        if (dragUnitId) cancelTokenDrag();
    });
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

        // 計算總消耗格數（直走 1、斜走 2）
        const cost = calcRulerDistance(rulerPoints, rulerCurrentPos);

        // 更新標籤：只顯示總消耗格數，不換算米數
        const label = document.getElementById('ruler-label');
        if (label) {
            label.style.display = 'block';
            label.textContent = `消耗 ${cost} 格`;

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

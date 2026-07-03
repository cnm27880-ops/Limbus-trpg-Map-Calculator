/**
 * Limbus Command - 地圖 Canvas 渲染層（Phase 1A 效能優化）
 *
 * 目的：消除「50x50 = 2500 個 .cell DOM 節點」造成的卡頓。
 * 作法（混合式渲染）：
 *   - 格子地形、格線、部署高亮 → 改畫在單一 <canvas>（2500 節點 → 1 節點）。
 *   - Token（棋子）維持原本的 DOM 寫法，點擊/拖曳/tooltip/右鍵選單邏輯完全不變。
 *
 * 視覺對照（與舊 .cell CSS 完全一致）：
 *   - 地板（val 0，無背景圖）：#1a1a1f
 *   - 格線：rgba(255,255,255,0.35) 1px
 *   - 地形：tileDef.color；牆壁/掩體加 45° 斜線陰影 rgba(0,0,0,0.2)
 *   - 部署高亮：rgba(253,216,53,0.3) 填色 + 2px #fdd835 內框
 *   - 背景圖模式：地板格透明（露出 #battle-map 的背景圖），地形仍為實色
 *
 * 互動：canvas 接手原本逐格 .cell 的 pointer 事件，
 *       以 screenToGrid() 將指標座標換算成格子座標，行為與舊版一致。
 */

// 模組內狀態（命名加前綴避免與全域變數衝突）
let mapCanvasClickStart = null;  // 指標按下時的螢幕座標（判斷點擊 vs 拖曳）
let mapCanvasPaintLast = null;   // 繪製拖曳時最後塗到的格子（避免重複觸發）

/**
 * 取得格子大小（與 renderMap 一致）
 */
function _mcGridSize() {
    return (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.GRID_SIZE : 50;
}

/**
 * 確保 canvas 地圖層存在，並依目前地圖尺寸調整解析度。
 * canvas 以 absolute 疊在 #battle-map 內、位於所有 Token 之下。
 * @returns {HTMLCanvasElement|null}
 */
function ensureMapCanvas() {
    const grid = document.getElementById('battle-map');
    if (!grid) return null;

    const gridSize = _mcGridSize();
    const pxW = state.mapW * gridSize;
    const pxH = state.mapH * gridSize;

    let canvas = document.getElementById('map-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'map-canvas';
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.zIndex = '0';          // Token 的 z-index 為 10+，會疊在 canvas 之上
        canvas.style.touchAction = 'none';  // 與舊 .cell 一致，避免觸控時頁面捲動
        // 插入為第一個子節點，確保後續 append 的 Token 疊在上方
        grid.insertBefore(canvas, grid.firstChild);
        attachMapCanvasEvents(canvas);
    }

    // CSS 尺寸 = 地圖像素尺寸（之後由 #map-container 的 transform 進行縮放/平移）
    canvas.style.width = pxW + 'px';
    canvas.style.height = pxH + 'px';

    // 背景儲存解析度：考量 devicePixelRatio 以維持清晰，但限制上限避免行動裝置記憶體爆量
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const MAX_DIM = 4096;
    const renderScale = Math.min(dpr, MAX_DIM / Math.max(pxW, pxH, 1));
    const bw = Math.max(1, Math.round(pxW * renderScale));
    const bh = Math.max(1, Math.round(pxH * renderScale));
    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
    }
    canvas._renderScale = renderScale;

    return canvas;
}

/**
 * 在 canvas 上繪製整張地圖（格子地形、格線、部署高亮）。
 * 由 renderMap() 與 handleMapInput() 呼叫；為單純的 2D 填色，重繪成本極低。
 */
function drawMapCanvas() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;
    if (!state.mapData || !Array.isArray(state.mapData) || state.mapData.length === 0) return;

    const ctx = canvas.getContext('2d');
    const gridSize = _mcGridSize();
    const renderScale = canvas._renderScale || 1;

    // 以 renderScale 設定座標系，之後皆用「地圖像素」座標繪製
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    const logicalW = canvas.width / renderScale;
    const logicalH = canvas.height / renderScale;
    ctx.clearRect(0, 0, logicalW, logicalH);

    const hasBg = !!state.mapBgImage;
    const theme = (typeof getCurrentTheme === 'function') ? getCurrentTheme() : null;

    // 是否處於「部署模式」：選了一個可控且尚未部署（x===-1）的單位 → 所有格高亮
    let deployMode = false;
    if (currentTool === 'cursor' && selectedUnitId !== null) {
        const u = (typeof findUnitById === 'function') ? findUnitById(selectedUnitId) : null;
        const controllable = (typeof canControlUnit === 'function') ? canControlUnit(u) : true;
        if (u && u.x === -1 && controllable) deployMode = true;
    }

    // ===== 1) 地形填色 =====
    for (let y = 0; y < state.mapH; y++) {
        const row = state.mapData[y];
        if (!row) continue;
        for (let x = 0; x < state.mapW; x++) {
            const val = row[x] || 0;
            const px = x * gridSize;
            const py = y * gridSize;

            let tileDef = (typeof getTileFromPalette === 'function') ? getTileFromPalette(val) : null;

            // 舊存檔相容（ID 1~3 的舊格式，與 renderMap 邏輯一致）
            if (!tileDef && state.themeId === 0 && theme) {
                if (val === 1) tileDef = theme.tiles.find(t => t.name === '牆壁');
                else if (val === 2) tileDef = theme.tiles.find(t => t.name === '掩體');
                else if (val === 3) tileDef = theme.tiles.find(t => t.name === '險地');
            }

            if (tileDef) {
                ctx.fillStyle = tileDef.color;
                ctx.fillRect(px, py, gridSize, gridSize);
                if (tileDef.name && (tileDef.name.includes('牆') || tileDef.name.includes('掩體'))) {
                    _mcDrawHatch(ctx, px, py, gridSize);
                }
            } else if (!hasBg) {
                // 地板：無背景圖時填深灰；有背景圖時保持透明以露出底圖
                ctx.fillStyle = '#1a1a1f';
                ctx.fillRect(px, py, gridSize, gridSize);
            }
        }
    }

    // ===== 2) 格線 =====
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= state.mapW; x++) {
        const gx = Math.round(x * gridSize) + 0.5;
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, state.mapH * gridSize);
    }
    for (let y = 0; y <= state.mapH; y++) {
        const gy = Math.round(y * gridSize) + 0.5;
        ctx.moveTo(0, gy);
        ctx.lineTo(state.mapW * gridSize, gy);
    }
    ctx.stroke();

    // ===== 3) 部署高亮 =====
    if (deployMode) {
        for (let y = 0; y < state.mapH; y++) {
            for (let x = 0; x < state.mapW; x++) {
                const px = x * gridSize;
                const py = y * gridSize;
                ctx.fillStyle = 'rgba(253, 216, 53, 0.3)';
                ctx.fillRect(px, py, gridSize, gridSize);
                ctx.strokeStyle = '#fdd835';
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 1, py + 1, gridSize - 2, gridSize - 2);
            }
        }
    }
}

/**
 * 在單一格內畫 45° 斜線陰影（對應舊 CSS 的 repeating-linear-gradient）。
 */
function _mcDrawHatch(ctx, px, py, size) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, size, size);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let d = -size; d <= size * 2; d += 8) {
        ctx.moveTo(px + d, py);
        ctx.lineTo(px + d + size, py + size);
    }
    ctx.stroke();
    ctx.restore();
}

// ===== Canvas 指標互動（接手原本逐格 .cell 的事件）=====

/**
 * 綁定 canvas 的指標事件。行為與舊版 .cell 的 onpointerdown/up/enter 完全對應：
 *   - 游標模式 + 已選單位：點擊 → 移動/部署單位（不平移地圖）
 *   - 游標模式 + 未選單位：交給相機平移（ST 另顯示地形資訊）
 *   - 繪製工具（ST）：按下並拖曳 → 繪製地形
 */
function attachMapCanvasEvents(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;  // 只處理左鍵

        const cell = screenToGrid(e.clientX, e.clientY);
        mapCanvasClickStart = { x: e.clientX, y: e.clientY };

        if (currentTool === 'cursor') {
            // 已選單位（準備部署/移動）：阻止冒泡，避免觸發相機拖曳
            if (selectedUnitId !== null) {
                e.stopPropagation();
                return;
            }
            // 未選單位時，ST 可查看該格地形；允許冒泡以觸發地圖平移
            if (myRole === 'st' && typeof updateTileInfo === 'function') {
                updateTileInfo(cell.x, cell.y);
            }
        } else if (myRole === 'st') {
            // 繪製工具：開始繪製，阻止冒泡避免相機平移
            isPaintingDrag = true;
            mapCanvasPaintLast = { x: cell.x, y: cell.y };
            handleMapInput(cell.x, cell.y, e);
            e.stopPropagation();
        }
    });

    canvas.addEventListener('pointerup', (e) => {
        if (e.button !== undefined && e.button !== 0) return;

        if (currentTool === 'cursor' && selectedUnitId !== null) {
            const cell = screenToGrid(e.clientX, e.clientY);

            // 拖曳判定：超過 10px 視為拖曳地圖，不移動單位
            if (mapCanvasClickStart) {
                const dragDistance = Math.hypot(e.clientX - mapCanvasClickStart.x, e.clientY - mapCanvasClickStart.y);
                if (dragDistance > 10) return;
            }
            if (isDraggingMap) return;

            const u = (typeof findUnitById === 'function') ? findUnitById(selectedUnitId) : null;
            const controllable = (typeof canControlUnit === 'function') ? canControlUnit(u) : true;

            if (u && controllable) {
                if (myRole === 'st') {
                    // ST 可自由移動所有棋子，不受移動能量限制
                    u.x = cell.x;
                    u.y = cell.y;
                    selectedUnitId = null;
                    broadcastState();
                } else {
                    // 玩家移動攔截器：戰術消耗（直走 1、斜走 2）超過剩餘能量則擋下
                    if (typeof applyMoveCost === 'function' && !applyMoveCost(u, cell.x, cell.y)) {
                        e.stopPropagation();
                        return;
                    }
                    sendToHost({ type: 'moveUnit', playerId: myPlayerId, unitId: u.id, x: cell.x, y: cell.y, moveUsed: u.moveUsed || 0 });
                    u.x = cell.x;
                    u.y = cell.y;
                    selectedUnitId = null;
                    renderAll();
                }
                e.stopPropagation();
                return;
            }

            // 選到無法操控的單位 → 點地面取消選取
            if (u && !controllable) {
                clearSelection();
                e.stopPropagation();
                return;
            }
        }
    });

    // 繪製拖曳：取代舊版逐格 .cell 的 onpointerenter
    canvas.addEventListener('pointermove', (e) => {
        if (!(myRole === 'st' && currentTool !== 'cursor' && isPaintingDrag)) return;
        const cell = screenToGrid(e.clientX, e.clientY);
        if (mapCanvasPaintLast && mapCanvasPaintLast.x === cell.x && mapCanvasPaintLast.y === cell.y) return;
        mapCanvasPaintLast = { x: cell.x, y: cell.y };
        handleMapInput(cell.x, cell.y, e);
    });
}

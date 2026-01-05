/**
 * Limbus Command - 相機控制
 * 處理地圖平移、縮放、Token 拖曳
 */

// ===== 全域互動狀態變數 =====
// 注意：isDraggingMap, isDraggingToken, isPaintingDrag 已在 state.js 中定義
// 此處不需要重複宣告

// Token 拖曳相關變數
var draggedUnit = null;
var draggedElement = null;
var dragStartPos = { x: 0, y: 0 };
var tokenStartPos = { x: 0, y: 0 };

// ===== 相機事件初始化 =====
/**
 * 初始化相機控制事件
 */
function initCameraEvents() {
    const vp = document.getElementById('map-viewport');
    if (!vp) return;

    // 滾輪縮放
    vp.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        zoomCamera(delta);
    }, { passive: false });

    // 指標按下 (pointerdown) - 決定互動模式
    vp.addEventListener('pointerdown', e => {
        // 1. 如果點擊到 Token，忽略此處，由 Token 自己的 handler (在 map.js) 處理
        if (e.target.classList.contains('token')) return;

        // 2. 如果是繪製工具 (且點擊到格子)，標記繪製開始，不移動相機
        if (currentTool !== 'cursor' && e.target.classList.contains('cell')) {
            // 注意：實際繪製邏輯在 map.js 的 handleMapInput
            isPaintingDrag = true;
            return;
        }

        // 3. 否則視為地圖平移
        isDraggingMap = true;
        lastPointer = { x: e.clientX, y: e.clientY };
        
        // 鎖定指針到視口，優化平移體驗
        vp.setPointerCapture(e.pointerId);
    });

    // 指標移動 (pointermove) - 綁定到 window 以防止滑鼠移出視口失效
    window.addEventListener('pointermove', e => {
        // A. 處理 Token 拖曳
        if (isDraggingToken && draggedElement) {
            e.preventDefault();
            handleTokenDragMove(e);
            return;
        }

        // B. 處理繪製拖曳 (邏輯主要由 map.js 的 cell:pointerenter 處理，這裡只需阻擋相機)
        if (isPaintingDrag) {
            return;
        }

        // C. 處理地圖平移
        if (isDraggingMap) {
            e.preventDefault();
            const dx = e.clientX - lastPointer.x;
            const dy = e.clientY - lastPointer.y;
            cam.x += dx;
            cam.y += dy;
            lastPointer = { x: e.clientX, y: e.clientY };
            applyCamera();
        }
    });

    // 指標放開 (pointerup) - 綁定到 window 確保能夠捕捉到釋放
    window.addEventListener('pointerup', e => {
        // A. 結束 Token 拖曳
        if (isDraggingToken) {
            endTokenDrag(e);
            return;
        }

        // B. 結束繪製
        if (isPaintingDrag) {
            isPaintingDrag = false;
            // 繪製結束後，如果是 ST，發送狀態更新
            if (myRole === 'st') sendState();
            return;
        }

        // C. 結束地圖平移
        if (isDraggingMap) {
            isDraggingMap = false;
            try { vp.releasePointerCapture(e.pointerId); } catch(err){}
        }
    });

    // 觸控捏合縮放 (Touch Pinch)
    vp.addEventListener('touchmove', e => {
        if (e.touches.length === 2 && !isDraggingToken) {
            e.preventDefault();
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            if (lastDist) {
                const diff = dist - lastDist;
                zoomCamera(diff * 0.005);
            }
            lastDist = dist;
        }
    }, { passive: false });

    vp.addEventListener('touchend', () => { 
        lastDist = 0; 
    });
}

// ===== 相機操作 =====
/**
 * 縮放相機
 * @param {number} amount - 縮放量
 */
function zoomCamera(amount) {
    cam.scale = Math.max(0.5, Math.min(3.0, cam.scale + amount));
    applyCamera();
}

/**
 * 套用相機變換
 */
function applyCamera() {
    const container = document.getElementById('map-container');
    if (container) {
        container.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`;
    }
}

/**
 * 重置相機位置
 */
function resetCamera() {
    cam = { x: 0, y: 0, scale: 1.0 };
    applyCamera();
}

// ===== Token 拖曳邏輯 =====
/**
 * 開始拖曳 Token (由 map.js 呼叫)
 */
function startTokenDrag(e, unit, element) {
    isDraggingToken = true;
    draggedUnit = unit;
    draggedElement = element;
    dragStartPos = { x: e.clientX, y: e.clientY };

    const gridSize = (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.GRID_SIZE : 50;
    
    // 記錄初始位置
    tokenStartPos = {
        x: unit.x * gridSize + 2,
        y: unit.y * gridSize + 2
    };

    element.classList.add('dragging');
    
    // 選取該單位
    if (typeof selectUnit === 'function') selectUnit(unit.id);
}

/**
 * 處理 Token 拖曳移動
 */
function handleTokenDragMove(e) {
    if (!isDraggingToken || !draggedElement) return;

    // 計算滑鼠位移 (除以縮放比例以獲得正確距離)
    const dx = (e.clientX - dragStartPos.x) / cam.scale;
    const dy = (e.clientY - dragStartPos.y) / cam.scale;

    draggedElement.style.left = (tokenStartPos.x + dx) + 'px';
    draggedElement.style.top = (tokenStartPos.y + dy) + 'px';
}

/**
 * 結束 Token 拖曳
 */
function endTokenDrag(e) {
    if (!isDraggingToken || !draggedUnit) {
        cancelTokenDrag();
        return;
    }

    const gridSize = (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.GRID_SIZE : 50;
    const dx = (e.clientX - dragStartPos.x) / cam.scale;
    const dy = (e.clientY - dragStartPos.y) / cam.scale;

    const newPixelX = tokenStartPos.x + dx;
    const newPixelY = tokenStartPos.y + dy;

    // 轉換為格子座標 (四捨五入)
    let newX = Math.round(newPixelX / gridSize);
    let newY = Math.round(newPixelY / gridSize);

    // 限制在地圖範圍內
    newX = Math.max(0, Math.min(state.mapW - 1, newX));
    newY = Math.max(0, Math.min(state.mapH - 1, newY));

    // 更新位置
    if (myRole === 'st') {
        draggedUnit.x = newX;
        draggedUnit.y = newY;
        sendState();
        renderAll();
    } else {
        sendToHost({
            type: 'moveUnit',
            playerId: myPlayerId,
            unitId: draggedUnit.id,
            x: newX,
            y: newY
        });
        // 預先更新本地顯示
        draggedUnit.x = newX;
        draggedUnit.y = newY;
        renderAll();
    }

    if (draggedElement) {
        draggedElement.classList.remove('dragging');
    }

    isDraggingToken = false;
    draggedUnit = null;
    draggedElement = null;
}

/**
 * 取消 Token 拖曳
 */
function cancelTokenDrag() {
    if (draggedElement) {
        draggedElement.classList.remove('dragging');
        renderAll(); // 重繪以歸位
    }

    isDraggingToken = false;
    draggedUnit = null;
    draggedElement = null;
}

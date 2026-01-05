/**
 * Limbus Command - 相機控制
 * 處理地圖平移、縮放、Token 拖曳
 */

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

    // 指標事件 - 地圖平移
    vp.addEventListener('pointerdown', e => {
        // 如果正在拖曳 Token 或點擊到 Token，不處理
        if (isDraggingToken || e.target.classList.contains('token')) return;

        // 如果使用繪製工具點擊格子，不處理地圖拖曳
        if (currentTool !== 'cursor' && e.target.classList.contains('cell')) {
            isPaintingDrag = true;
            return;
        }

        isDraggingMap = true;
        lastPointer = { x: e.clientX, y: e.clientY };
        vp.setPointerCapture(e.pointerId);
    });

    vp.addEventListener('pointermove', e => {
        // 處理 Token 拖曳
        if (isDraggingToken && draggedElement) {
            e.preventDefault();
            handleTokenDragMove(e);
            return;
        }

        // 處理繪製拖曳
        if (isPaintingDrag) {
            return;
        }

        // 處理地圖平移
        if (!isDraggingMap) return;
        e.preventDefault();
        
        const dx = e.clientX - lastPointer.x;
        const dy = e.clientY - lastPointer.y;

        cam.x += dx;
        cam.y += dy;
        lastPointer = { x: e.clientX, y: e.clientY };
        applyCamera();
    });

    vp.addEventListener('pointerup', e => {
        // 處理 Token 放置
        if (isDraggingToken) {
            endTokenDrag(e);
            return;
        }

        // 處理繪製拖曳結束
        if (isPaintingDrag) {
            isPaintingDrag = false;
            if (myRole === 'st') sendState();
            return;
        }

        // 處理地圖平移結束
        if (isDraggingMap) {
            isDraggingMap = false;
            vp.releasePointerCapture(e.pointerId);
        }
    });

    vp.addEventListener('pointercancel', e => {
        if (isDraggingToken) {
            cancelTokenDrag();
        }
        isDraggingMap = false;
        isPaintingDrag = false;
    });

    // 觸控捏合縮放
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
 * 開始拖曳 Token
 * @param {Event} e - 指標事件
 * @param {Object} unit - 單位物件
 * @param {HTMLElement} element - Token DOM 元素
 */
function startTokenDrag(e, unit, element) {
    isDraggingToken = true;
    draggedUnit = unit;
    draggedElement = element;
    dragStartPos = { x: e.clientX, y: e.clientY };

    const gridSize = MAP_DEFAULTS.GRID_SIZE;
    tokenStartPos = {
        x: unit.x * gridSize + 2,
        y: unit.y * gridSize + 2
    };

    element.classList.add('dragging');
    element.setPointerCapture(e.pointerId);
    selectUnit(unit.id);
}

/**
 * 處理 Token 拖曳移動
 * @param {Event} e - 指標事件
 */
function handleTokenDragMove(e) {
    if (!isDraggingToken || !draggedElement) return;

    const dx = (e.clientX - dragStartPos.x) / cam.scale;
    const dy = (e.clientY - dragStartPos.y) / cam.scale;

    draggedElement.style.left = (tokenStartPos.x + dx) + 'px';
    draggedElement.style.top = (tokenStartPos.y + dy) + 'px';
}

/**
 * 結束 Token 拖曳
 * @param {Event} e - 指標事件
 */
function endTokenDrag(e) {
    if (!isDraggingToken || !draggedUnit) {
        cancelTokenDrag();
        return;
    }

    const gridSize = MAP_DEFAULTS.GRID_SIZE;
    const dx = (e.clientX - dragStartPos.x) / cam.scale;
    const dy = (e.clientY - dragStartPos.y) / cam.scale;

    const newPixelX = tokenStartPos.x + dx;
    const newPixelY = tokenStartPos.y + dy;

    // 轉換為格子座標
    let newX = Math.round(newPixelX / gridSize);
    let newY = Math.round(newPixelY / gridSize);

    // 限制在地圖範圍內
    newX = Math.max(0, Math.min(state.mapW - 1, newX));
    newY = Math.max(0, Math.min(state.mapH - 1, newY));

    // 根據角色更新位置
    if (myRole === 'st') {
        draggedUnit.x = newX;
        draggedUnit.y = newY;
        sendState();
    } else {
        sendToHost({
            type: 'moveUnit',
            playerId: myPlayerId,
            unitId: draggedUnit.id,
            x: newX,
            y: newY
        });
    }

    // 清理
    if (draggedElement) {
        draggedElement.classList.remove('dragging');
        try { 
            draggedElement.releasePointerCapture(e.pointerId); 
        } catch (err) {}
    }

    isDraggingToken = false;
    draggedUnit = null;
    draggedElement = null;
    selectedUnitId = null;

    renderAll();
}

/**
 * 取消 Token 拖曳
 */
function cancelTokenDrag() {
    if (draggedElement) {
        draggedElement.classList.remove('dragging');
        // 重置位置
        const gridSize = MAP_DEFAULTS.GRID_SIZE;
        if (draggedUnit) {
            draggedElement.style.left = (draggedUnit.x * gridSize + 2) + 'px';
            draggedElement.style.top = (draggedUnit.y * gridSize + 2) + 'px';
        }
    }

    isDraggingToken = false;
    draggedUnit = null;
    draggedElement = null;
}

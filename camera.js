// js/camera.js

// 全域變數 (假設 state.js 已定義，若無請在此定義)
// let isDraggingMap = false;
// let isDraggingToken = false;
// let isPaintingDrag = false;
// let draggedUnit = null;
// let draggedElement = null;
// let dragStartPos = { x: 0, y: 0 };
// let tokenStartPos = { x: 0, y: 0 };
// let lastPointer = { x: 0, y: 0 };
// let lastDist = 0;

function initCameraEvents() {
    const vp = document.getElementById('map-viewport');
    if (!vp) return;

    // 滾輪縮放
    vp.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        zoomCamera(delta);
    }, { passive: false });

    // 指標按下 (只處理開始)
    vp.addEventListener('pointerdown', e => {
        // 1. 如果點擊到 Token，交給 Token 的 handler 處理 (在 map.js 綁定)
        if (e.target.classList.contains('token')) return;

        // 2. 如果是繪製工具 (且點擊到格子)，標記繪製開始，不移動相機
        if (currentTool !== 'cursor' && e.target.classList.contains('cell')) {
            isPaintingDrag = true;
            return;
        }

        // 3. 否則視為地圖平移
        isDraggingMap = true;
        lastPointer = { x: e.clientX, y: e.clientY };
        // 鎖定指針到視口，確保平移順暢
        vp.setPointerCapture(e.pointerId);
    });

    // ★★★ 修改重點：將 Move 和 Up 綁定到 window，確保拖曳不中斷 ★★★
    window.addEventListener('pointermove', e => {
        // 優先處理 Token 拖曳
        if (isDraggingToken && draggedElement) {
            e.preventDefault();
            handleTokenDragMove(e);
            return;
        }

        // 繪製拖曳由 map.js 的 cell.pointerenter 處理，這裡只需阻擋相機移動
        if (isPaintingDrag) return;

        // 處理地圖平移
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

    window.addEventListener('pointerup', e => {
        // 結束 Token 拖曳
        if (isDraggingToken) {
            endTokenDrag(e);
            return;
        }

        // 結束繪製
        if (isPaintingDrag) {
            isPaintingDrag = false;
            if (myRole === 'st') sendState();
            return;
        }

        // 結束地圖平移
        if (isDraggingMap) {
            isDraggingMap = false;
            try { vp.releasePointerCapture(e.pointerId); } catch(err){}
        }
    });
    
    // 觸控捏合縮放 (保持在 vp 上即可)
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
    
    vp.addEventListener('touchend', () => { lastDist = 0; });
}

function zoomCamera(amount) {
    cam.scale = Math.max(0.5, Math.min(3.0, cam.scale + amount));
    applyCamera();
}

function applyCamera() {
    const container = document.getElementById('map-container');
    if (container) {
        container.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`;
    }
}

function resetCamera() {
    cam = { x: 0, y: 0, scale: 1.0 };
    applyCamera();
}

// ===== Token 拖曳邏輯 (修正版) =====

function startTokenDrag(e, unit, element) {
    isDraggingToken = true;
    draggedUnit = unit;
    draggedElement = element;
    dragStartPos = { x: e.clientX, y: e.clientY };

    const gridSize = MAP_DEFAULTS.GRID_SIZE; // 50
    tokenStartPos = {
        x: unit.x * gridSize + 2, // 2px 是因為 token css inset/padding 調整
        y: unit.y * gridSize + 2
    };

    element.classList.add('dragging');
    
    // ★★★ 修改重點：移除 setPointerCapture ★★★
    // 因為我們現在用 window 監聽，不需要鎖定 capture，
    // 鎖定反而會導致 window 層級的事件監聽不到，或者座標計算錯誤。
    
    selectUnit(unit.id);
}

function handleTokenDragMove(e) {
    if (!isDraggingToken || !draggedElement) return;

    // 計算滑鼠移動的距離 (需除以縮放比例)
    const dx = (e.clientX - dragStartPos.x) / cam.scale;
    const dy = (e.clientY - dragStartPos.y) / cam.scale;

    draggedElement.style.left = (tokenStartPos.x + dx) + 'px';
    draggedElement.style.top = (tokenStartPos.y + dy) + 'px';
}

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
        // 客戶端先重繪以避免閃爍
        draggedUnit.x = newX;
        draggedUnit.y = newY;
        renderAll();
    }

    if (draggedElement) draggedElement.classList.remove('dragging');
    
    isDraggingToken = false;
    draggedUnit = null;
    draggedElement = null;
}

function cancelTokenDrag() {
    if (draggedElement) {
        draggedElement.classList.remove('dragging');
        renderAll(); // 重置回原位
    }
    isDraggingToken = false;
    draggedUnit = null;
    draggedElement = null;
}

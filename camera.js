/**
 * Limbus Command - 相機控制
 * 處理地圖平移、縮放
 * 注意：Token 拖曳功能已移除，改用「點選後點擊目標格移動」的操作模式
 */

// ===== 全域互動狀態變數 =====
// 注意：isDraggingMap, isPaintingDrag 已在 state.js 中定義
// 此處不需要重複宣告

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
        // A. 處理繪製拖曳 (邏輯主要由 map.js 的 cell:pointerenter 處理，這裡只需阻擋相機)
        if (isPaintingDrag) {
            return;
        }

        // B. 處理地圖平移
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
        // A. 結束繪製
        if (isPaintingDrag) {
            isPaintingDrag = false;
            // 繪製結束後，如果是 ST，發送狀態更新
            if (myRole === 'st') sendState();
            return;
        }

        // B. 結束地圖平移
        if (isDraggingMap) {
            isDraggingMap = false;
            try { vp.releasePointerCapture(e.pointerId); } catch(err){}
        }
    });

    // 觸控捏合縮放 (Touch Pinch) - 以雙指中心點為縮放中心
    let lastPinchCenter = null;

    vp.addEventListener('touchmove', e => {
        if (e.touches.length === 2) {
            isDraggingMap = false;
            e.preventDefault();

            // 計算雙指中心點
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

            // 計算雙指距離
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );

            if (lastDist && lastPinchCenter) {
                const diff = dist - lastDist;
                const zoomDelta = diff * 0.002;

                // 取得視口位置
                const vpRect = vp.getBoundingClientRect();

                // 計算中心點相對於視口的位置
                const relX = centerX - vpRect.left;
                const relY = centerY - vpRect.top;

                // 以中心點為準進行縮放
                zoomCameraAt(zoomDelta, relX, relY);
            }

            lastDist = dist;
            lastPinchCenter = { x: centerX, y: centerY };
        }
    }, { passive: false });

    vp.addEventListener('touchend', () => {
        lastDist = 0;
        lastPinchCenter = null;
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
 * 以指定點為中心縮放相機
 * @param {number} amount - 縮放量
 * @param {number} focusX - 縮放中心點 X (相對於視口)
 * @param {number} focusY - 縮放中心點 Y (相對於視口)
 */
function zoomCameraAt(amount, focusX, focusY) {
    const oldScale = cam.scale;
    const newScale = Math.max(0.5, Math.min(3.0, cam.scale + amount));

    if (oldScale === newScale) return;

    // 計算縮放點在世界坐標系中的位置（縮放前）
    // 公式：世界坐標 = (螢幕坐標 - 相機位移) / 縮放比例
    const worldX = (focusX - cam.x) / oldScale;
    const worldY = (focusY - cam.y) / oldScale;

    // 縮放後，調整相機位置，使該世界坐標點在螢幕上的位置保持不變
    // 公式：相機位移 = 螢幕坐標 - 世界坐標 * 新縮放比例
    cam.x = focusX - worldX * newScale;
    cam.y = focusY - worldY * newScale;
    cam.scale = newScale;

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

// Token 拖曳功能已移除
// 改用「點選單位 -> 點擊目標格」的操作模式
// 詳見 map.js 中的 cell.onpointerdown 和 token.onpointerdown 處理邏輯

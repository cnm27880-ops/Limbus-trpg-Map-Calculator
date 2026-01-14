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

    // ===== 觸控捏合縮放 (Touch Pinch) - 以雙指中心點為縮放中心 =====
    let lastPinchCenter = null;

    vp.addEventListener('touchmove', e => {
        // 雙指操作：進行縮放
        if (e.touches.length === 2) {
            // 防抖動處理：強制停止地圖拖曳
            isDraggingMap = false;

            // 阻止瀏覽器預設行為（防止頁面縮放或滾動）
            e.preventDefault();

            // ===== Step 1: 計算雙指中心點（螢幕座標）=====
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

            // ===== Step 2: 計算雙指距離 =====
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );

            // 只有在有上一次記錄時才執行縮放
            if (lastDist && lastPinchCenter) {
                // ===== Step 3: 計算距離變化量 =====
                const distanceDelta = dist - lastDist;

                // ===== Step 4: 設定靈敏度 (0.002 = 細膩縮放) =====
                const ZOOM_SENSITIVITY = 0.002;
                const zoomDelta = distanceDelta * ZOOM_SENSITIVITY;

                // ===== Step 5: 位置補償（關鍵邏輯）=====
                // 取得視口的邊界矩形
                const vpRect = vp.getBoundingClientRect();

                // 計算中心點相對於視口左上角的偏移量（視口座標系）
                const focusX = centerX - vpRect.left;
                const focusY = centerY - vpRect.top;

                // 呼叫縮放函數，傳入雙指中心點作為縮放焦點
                // 這會確保縮放時，雙指中心點在螢幕上的位置保持不變
                zoomCameraAt(zoomDelta, focusX, focusY);
            }

            // 記錄當前狀態供下一次計算使用
            lastDist = dist;
            lastPinchCenter = { x: centerX, y: centerY };
        }
    }, { passive: false });

    // 觸控結束：重置狀態
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
 * 以指定點為中心縮放相機（關鍵函數：實作位置補償邏輯）
 * @param {number} amount - 縮放量（正值放大，負值縮小）
 * @param {number} focusX - 縮放焦點 X 座標（相對於視口左上角）
 * @param {number} focusY - 縮放焦點 Y 座標（相對於視口左上角）
 *
 * 原理：
 * 1. 縮放前，焦點對應地圖上的某個「世界座標」
 * 2. 縮放後，這個世界座標在螢幕上的位置應該還是焦點位置
 * 3. 透過調整相機位置 (cam.x, cam.y) 來實現這個效果
 */
function zoomCameraAt(amount, focusX, focusY) {
    // 記錄舊的縮放倍率
    const oldScale = cam.scale;

    // ===== 邊界檢查：限制縮放範圍 0.5 到 3.0 =====
    const newScale = Math.max(0.5, Math.min(3.0, cam.scale + amount));

    // 如果縮放倍率沒有改變（達到邊界），直接返回
    if (oldScale === newScale) return;

    // ===== 位置補償演算法 =====

    // Step 1: 計算焦點在「世界座標系」中的位置（縮放前）
    // 世界座標 = (螢幕座標 - 相機偏移) / 舊縮放倍率
    // 這告訴我們：焦點位置對應到地圖上的哪個點
    const worldX = (focusX - cam.x) / oldScale;
    const worldY = (focusY - cam.y) / oldScale;

    // Step 2: 更新縮放倍率
    cam.scale = newScale;

    // Step 3: 調整相機位置，使世界座標點在縮放後仍然對應到焦點位置
    // 相機偏移 = 螢幕座標 - 世界座標 * 新縮放倍率
    // 這確保了：縮放時，焦點位置在螢幕上不會移動
    cam.x = focusX - worldX * newScale;
    cam.y = focusY - worldY * newScale;

    // Step 4: 套用相機變換到 DOM
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

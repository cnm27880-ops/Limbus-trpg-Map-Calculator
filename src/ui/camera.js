/**
 * Limbus Command - 相機控制
 * 處理地圖平移、縮放
 * 注意：Token 拖曳功能已移除，改用「點選後點擊目標格移動」的操作模式
 */

// ===== 全域互動狀態變數 =====
// 注意：isDraggingMap, isPaintingDrag, isPinchZooming 等已在 state.js 中定義

// ===== 相機事件初始化 =====
/**
 * 初始化相機控制事件
 *
 * Phase 3B：統一手勢模型
 * 過去用「pointer 事件做平移 + 另一套 touch 事件做捏合縮放 + isPinchZooming 全域旗標互相抑制」，
 * 在行動裝置上容易有相容性問題，且放開其中一指時會因參考點未更新而「瞬間跳動」。
 * 現改為單一的 Pointer Events 模型，以 activePointers 追蹤所有指標：
 *   - 1 個指標：單指/滑鼠平移（超過 threshold 才算拖曳）
 *   - 2 個指標：雙指捏合縮放（以雙指中心為焦點做位置補償）
 *   - 2 指 → 1 指：以剩餘指標重設平移基準，消除跳動
 */
function initCameraEvents() {
    const vp = document.getElementById('map-viewport');
    if (!vp) return;

    // 滾輪縮放（桌面）
    vp.addEventListener('wheel', e => {
        e.preventDefault();
        zoomCamera(e.deltaY > 0 ? -0.1 : 0.1);
    }, { passive: false });

    // ===== 統一的指標手勢狀態 =====
    const pointers = new Map();        // pointerId -> { x, y }
    const DRAG_THRESHOLD = 5;          // 單指：位移超過此值才視為平移（與點擊區分）
    const ZOOM_SENSITIVITY = 0.002;    // 捏合縮放靈敏度（沿用舊值）
    let dragStartX = 0, dragStartY = 0;
    let pinchPrevDist = 0;             // 上一次雙指距離

    // 計算雙指距離與中心點（螢幕座標）
    function pinchInfo() {
        const pts = [...pointers.values()];
        return {
            dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
            cx: (pts[0].x + pts[1].x) / 2,
            cy: (pts[0].y + pts[1].y) / 2,
        };
    }

    vp.addEventListener('pointerdown', e => {
        // 測距尺啟用時不啟動相機
        if (isMeasuring || e.altKey) return;
        // 點到 Token：交給 Token 自己的 handler（map.js）
        if (e.target.classList.contains('token')) return;
        // 繪製工具且點在地圖層：canvas 會自行處理並 stopPropagation，這裡保險再擋一次。
        // 迷霧補畫筆刷例外：只點一下塗一格、不會 stopPropagation，讓 ST 仍可正常拖曳平移地圖。
        if (currentTool !== 'cursor' && currentTool !== 'fog-reveal' && currentTool !== 'fog-hide' &&
            (e.target.id === 'map-canvas' || e.target.classList.contains('cell'))) {
            isPaintingDrag = true;
            return;
        }

        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { vp.setPointerCapture(e.pointerId); } catch (err) {}

        if (pointers.size === 1) {
            // 準備單指/滑鼠平移（先不啟動，待超過 threshold 才確認是拖曳）
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            lastPointer = { x: e.clientX, y: e.clientY };
            isPotentialDrag = true;
            isDraggingMap = false;
        } else if (pointers.size === 2) {
            // 進入雙指捏合：中斷任何單指平移
            isPinchZooming = true;
            isPotentialDrag = false;
            isDraggingMap = false;
            pinchPrevDist = pinchInfo().dist;
        }
    });

    window.addEventListener('pointermove', e => {
        if (isMeasuring) return;
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // 繪製拖曳由 map-canvas 處理，這裡不平移
        if (isPaintingDrag) return;

        // 雙指捏合縮放（以雙指中心為焦點，縮放時中心點在螢幕上保持不動）
        if (pointers.size >= 2) {
            e.preventDefault();
            const info = pinchInfo();
            if (pinchPrevDist > 0) {
                const zoomDelta = (info.dist - pinchPrevDist) * ZOOM_SENSITIVITY;
                const vpRect = vp.getBoundingClientRect();
                zoomCameraAt(zoomDelta, info.cx - vpRect.left, info.cy - vpRect.top);
            }
            pinchPrevDist = info.dist;
            return;
        }

        // 單指/滑鼠平移
        if (isPotentialDrag && !isDraggingMap) {
            if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > DRAG_THRESHOLD) {
                isDraggingMap = true;   // 確認為拖曳
            }
        }
        if (isDraggingMap) {
            e.preventDefault();
            cam.x += e.clientX - lastPointer.x;
            cam.y += e.clientY - lastPointer.y;
            lastPointer = { x: e.clientX, y: e.clientY };
            applyCamera();
        }
    });

    function endPointer(e) {
        pointers.delete(e.pointerId);
        try { vp.releasePointerCapture(e.pointerId); } catch (err) {}

        // 結束繪製（繪製不在 pointers 內，但需在此收尾）
        if (isPaintingDrag) {
            isPaintingDrag = false;
            if (myRole === 'st' && typeof sendState === 'function') sendState();
        }

        if (pointers.size === 1) {
            // 雙指 → 單指：以剩餘手指作為新的平移基準，避免座標跳動。
            // 與舊版一致：放開一指後不自動接續平移，需重新按下才會平移。
            const rest = [...pointers.values()][0];
            lastPointer = { x: rest.x, y: rest.y };
            isPinchZooming = false;
            pinchPrevDist = 0;
            isDraggingMap = false;
            isPotentialDrag = false;
        } else if (pointers.size === 0) {
            isPinchZooming = false;
            pinchPrevDist = 0;
            isDraggingMap = false;
            isPotentialDrag = false;
        }
    }

    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);
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
    // #map-container 是 left:50%/top:50% + 負 margin 置中，且 transform-origin:center center，
    // 所以 CSS scale 實際上是繞著「視口中心」縮放，而不是視口左上角。focusX/focusY 是呼叫端
    // 以視口左上角為原點量測的座標，若直接當成相對視口左上角的世界座標換算（未扣掉視口中心
    // 偏移 V），只有焦點剛好落在視口中心時補償才準；其餘位置縮放（尤其雙指捏合）畫面會偏移。
    const vp = document.getElementById('map-viewport');
    const vpRect = vp ? vp.getBoundingClientRect() : { width: 0, height: 0 };
    const vx = vpRect.width / 2;
    const vy = vpRect.height / 2;

    // Step 1: 計算焦點在「世界座標系」中的位置（縮放前，相對視口中心 V 換算）
    // 世界座標 = 視口中心 + (螢幕座標 − 視口中心 − 相機偏移) / 舊縮放倍率
    const worldX = vx + (focusX - vx - cam.x) / oldScale;
    const worldY = vy + (focusY - vy - cam.y) / oldScale;

    // Step 2: 更新縮放倍率
    cam.scale = newScale;

    // Step 3: 調整相機位置，使世界座標點在縮放後仍然對應到焦點位置
    // 相機偏移 = 螢幕座標 − 視口中心 − (世界座標 − 視口中心) × 新縮放倍率
    // 這確保了：縮放時，焦點位置在螢幕上不會移動
    cam.x = focusX - vx - (worldX - vx) * newScale;
    cam.y = focusY - vy - (worldY - vy) * newScale;

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

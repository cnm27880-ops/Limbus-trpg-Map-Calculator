/**
 * Limbus Command - 懸浮視窗 / 彈窗「防誤關」辨識機制
 *
 * 解決問題：懸浮面板（modal 遮罩、環繞選單、狀態速選彈窗…）太敏感——滑鼠稍微滑出，
 * 或從面板內部按下再拖曳/滑到外面放開，就被當成「點外面 → 關閉」而誤關。
 * （例如：豁免抵擋圈選目標時，指標一滑出彈窗就整個關掉。）
 *
 * 兩種面板、兩種機制：
 *  A) .modal-overlay 遮罩式彈窗（以 onclick 判斷點到遮罩背景就關閉）
 *     → installOverlayDismissGuard(): 全域攔截。瀏覽器的 click 會派送到 mousedown 與 mouseup
 *       的「共同祖先」——若在視窗內部按下（如圈選目標的晶片），拖曳滑到遮罩背景才放開，
 *       click 會落在遮罩上而誤觸關閉。故只有「按下起點也是同一層遮罩背景」的真正點擊才允許
 *       關閉；從視窗內部拖曳滑出的 click 於捕獲階段吞掉，阻止誤關。
 *  B) 非遮罩式浮動面板（環繞選單、狀態速選彈窗，靠 document pointerdown 判斷點外面關閉）
 *     → attachOutsideDismiss(): 只有在面板外「按下＋放開、且位移很小」的真正點擊才關閉，
 *       避免一按下（或拖曳地圖、滑出視窗）就誤關。
 */
(function () {
    'use strict';

    // ===== A) 遮罩式彈窗：防止「從內部拖曳滑出後放開」被誤判為點背景關閉 =====
    let lastPointerDownTarget = null;

    function installOverlayDismissGuard() {
        if (window.__overlayDismissGuardInstalled) return;
        window.__overlayDismissGuardInstalled = true;

        document.addEventListener('pointerdown', (e) => {
            lastPointerDownTarget = e.target;
        }, true);

        // 捕獲階段先於遮罩自身的 onclick 執行：判定為誤觸時 stopImmediatePropagation 阻止關閉。
        document.addEventListener('click', (e) => {
            const el = e.target;
            if (!el || !el.classList || !el.classList.contains('modal-overlay')) return;
            // 放開落在遮罩背景，但按下起點不是同一層遮罩（從視窗內部拖曳/滑出）→ 視為不小心，攔截。
            // 真正想點背景關閉時，按下與放開都在同一層遮罩上，lastPointerDownTarget === el，放行。
            if (lastPointerDownTarget !== el) {
                e.stopImmediatePropagation();
            }
        }, true);
    }

    // ===== B) 非遮罩式浮動面板：只有真正的「點外面」才關閉 =====
    /**
     * @param {function(EventTarget):boolean} isOutside - 傳入事件 target，回傳 true 表示落在面板外
     * @param {function(Event)} onDismiss - 判定為真正點外面時呼叫
     * @param {{moveTolerance?:number}} [opts] - moveTolerance：按下→放開允許位移(px)，超過視為拖曳，不關閉
     * @returns {function} detach - 解除監聽（面板關閉時務必呼叫，避免殘留）
     */
    function attachOutsideDismiss(isOutside, onDismiss, opts) {
        const tol = (opts && Number(opts.moveTolerance) > 0) ? Number(opts.moveTolerance) : 12;
        let armed = false, sx = 0, sy = 0;

        function onDown(e) {
            // 按下起點在面板外才「上膛」；起點在面板內表示使用者正在操作面板，忽略後續放開。
            if (isOutside(e.target)) { armed = true; sx = e.clientX; sy = e.clientY; }
            else { armed = false; }
        }
        function onUp(e) {
            if (!armed) return;
            armed = false;
            if (isOutside(e.target) !== true) return;               // 放開落在面板內 → 不關
            if (Math.hypot((e.clientX || 0) - sx, (e.clientY || 0) - sy) > tol) return; // 位移過大 → 拖曳，不關
            onDismiss(e);
        }
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('pointerup', onUp, true);
        return function detach() {
            document.removeEventListener('pointerdown', onDown, true);
            document.removeEventListener('pointerup', onUp, true);
        };
    }

    window.attachOutsideDismiss = attachOutsideDismiss;
    window.installOverlayDismissGuard = installOverlayDismissGuard;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installOverlayDismissGuard);
    } else {
        installOverlayDismissGuard();
    }
})();

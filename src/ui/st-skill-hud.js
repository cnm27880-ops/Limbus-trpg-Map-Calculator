/**
 * Limbus Command - 戰鬥面板共用工具 + 群體操作 (AOE)
 *
 * 原「怪物招式」「浮動 DP 計算器」「導覽列計算頁」「Google Sheets 戰鬥 HUD」均已移除：
 *   - 怪物每招的 DP / 狀態改由「多重行動設定」逐招填寫（src/ui/units.js）
 *   - 戰鬥全面改為「右鍵棋子 → 黑箱計算 → QTE 彈窗」，不再需要手動計算器
 *
 * 本檔保留下列跨面板共用的函式：
 *   - 通用可拖曳 / 雙擊摺疊 / 位置夾限
 *   - 狀態名稱顯示輔助（getStatusName / getStatusDisplayName）
 *
 * 群體操作 (AOE) 已改為「長按 T 鍵」的選取模式，邏輯移至 src/ui/aoe-select.js。
 */

// ===== Position Clamping =====
// 儲存的座標可能來自更大的視窗（例如從桌機換到筆電），
// 開啟時若不夾限會整個面板落在螢幕外，看起來像「面板消失」
function clampHudPosition(stateObj, panelId) {
    const panel = document.getElementById(panelId);
    const w = (panel && panel.offsetWidth) || 340;
    stateObj.position.x = Math.max(-w + 100, Math.min(window.innerWidth - 100, stateObj.position.x));
    stateObj.position.y = Math.max(0, Math.min(window.innerHeight - 50, stateObj.position.y));
    if (panel) {
        panel.style.left = stateObj.position.x + 'px';
        panel.style.top = stateObj.position.y + 'px';
    }
}

// ===== Generic Draggable Panel Setup =====

function setupPanelDrag(panelId, headerId, stateObj, saveFn) {
    const panel = document.getElementById(panelId);
    const header = document.getElementById(headerId);
    if (!panel || !header) return;

    // 交由 WindowManager 管理層級：點擊面板即在其 tier 內置頂（最後點擊者在上）
    if (typeof WindowManager !== 'undefined') {
        WindowManager.register(panel, { tier: 'panel' });
    }

    let isDragging = false, hasMoved = false;
    const THRESHOLD = 5;
    let startX, startY, startPosX, startPosY;

    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, { passive: false });

    function startDrag(e) {
        if (e.target.closest('button')) return;
        isDragging = true; hasMoved = false;
        if (e.type === 'touchstart') {
            startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        } else {
            startX = e.clientX; startY = e.clientY;
        }
        const rect = panel.getBoundingClientRect();
        startPosX = rect.left; startPosY = rect.top;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('touchend', stopDrag);
        if (e.type === 'touchstart') e.preventDefault();
    }

    function onDrag(e) {
        if (!isDragging) return;
        let cx, cy;
        if (e.type === 'touchmove') { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
        else { cx = e.clientX; cy = e.clientY; }
        const dx = cx - startX, dy = cy - startY;
        if (!hasMoved && Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        if (!hasMoved) { hasMoved = true; panel.classList.add('dragging'); }
        const w = panel.offsetWidth || 340, h = panel.offsetHeight || 200;
        stateObj.position.x = Math.max(-w + 100, Math.min(window.innerWidth - 100, startPosX + dx));
        stateObj.position.y = Math.max(0, Math.min(window.innerHeight - 50, startPosY + dy));
        panel.style.left = stateObj.position.x + 'px';
        panel.style.top = stateObj.position.y + 'px';
        e.preventDefault();
    }

    function stopDrag() {
        if (isDragging) {
            isDragging = false;
            if (hasMoved) { panel.classList.remove('dragging'); saveFn(); }
            hasMoved = false;
        }
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', onDrag);
        document.removeEventListener('touchend', stopDrag);
    }
}

// ===== Generic Collapse Setup =====

function setupPanelCollapse(headerId, stateObj, panelId, saveFn, renderCollapsed, renderExpanded) {
    const header = document.getElementById(headerId);
    if (!header) return;

    // Double-click to toggle collapse/expand
    header.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        const panel = document.getElementById(panelId);
        if (stateObj.isCollapsed) {
            stateObj.isCollapsed = false;
            if (panel) panel.classList.remove('collapsed');
            saveFn();
            if (renderExpanded) renderExpanded();
        } else {
            stateObj.isCollapsed = true;
            if (panel) panel.classList.add('collapsed');
            saveFn();
            if (renderCollapsed) renderCollapsed();
        }
    });
}

// ===== Status Name Helpers =====

function getStatusName(statusId) {
    if (!statusId) return '';
    // getStatusById（status-config.js）涵蓋預設庫與自訂狀態
    if (typeof getStatusById === 'function') {
        const found = getStatusById(statusId);
        if (found) return (found.icon || '') + ' ' + found.name;
    }
    return statusId;
}

function getStatusDisplayName(statusId) {
    if (!statusId) return statusId;
    if (typeof getStatusById === 'function') {
        const found = getStatusById(statusId);
        if (found) return found.name;
    }
    return statusId;
}


// 註：舊版「ST AOE Manager」（多重行動面板內的勾選式群體操作）已移除，
// 群體操作改由「長按 T 鍵」的選取模式處理，邏輯見 src/ui/aoe-select.js。
// 核心結算（applyBatchAction / undoLastBatch）仍位於 src/core/state.js。

// ===== Window bindings =====
window.clampHudPosition = clampHudPosition;
window.setupPanelDrag = setupPanelDrag;
window.setupPanelCollapse = setupPanelCollapse;
window.getStatusName = getStatusName;
window.getStatusDisplayName = getStatusDisplayName;

console.log('戰鬥面板共用工具已載入');

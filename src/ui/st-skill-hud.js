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

// ===== Generic Floating Panel（可拖曳 + 雙擊/按鈕收合 + 位置記憶）=====

/**
 * 把一個浮動面板元素設定為：標頭可拖曳、雙擊標頭或點收起鈕可收合、
 * 位置與收合狀態記憶到 localStorage，並交由 WindowManager 管理層級。
 * 供 ST 的「BOSS 設定」「戰鬥數值設定」等面板共用，取代固定置中的遮罩式 modal，
 * 讓 ST 在戰鬥中把面板拖到一旁、隨時對照戰場。
 *
 * @param {Object} opts
 * @param {string} opts.panelId       浮動面板根元素 id
 * @param {string} opts.headerId      標頭（拖曳把手）id
 * @param {string} opts.storageKey    localStorage 記憶位置/收合狀態的 key
 * @param {string} [opts.collapseBtnId] 標頭收起鈕 id（可選）
 * @param {{x:number,y:number}} [opts.defaultPos] 首次開啟的預設座標
 * @returns {Object|undefined} stateObj（含 position / isCollapsed）
 */
function makeFloatingPanel(opts) {
    const o = opts || {};
    const panel = document.getElementById(o.panelId);
    const header = document.getElementById(o.headerId);
    if (!panel || !header) return;

    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(o.storageKey) || '{}') || {}; } catch (e) { saved = {}; }
    const def = o.defaultPos || { x: 40, y: 70 };
    const stateObj = {
        position: {
            x: (saved.position && Number.isFinite(saved.position.x)) ? saved.position.x : def.x,
            y: (saved.position && Number.isFinite(saved.position.y)) ? saved.position.y : def.y,
        },
        isCollapsed: !!saved.isCollapsed,
    };
    const saveFn = () => {
        try { localStorage.setItem(o.storageKey, JSON.stringify(stateObj)); } catch (e) { /* 忽略配額/隱私模式錯誤 */ }
    };

    panel.style.left = stateObj.position.x + 'px';
    panel.style.top = stateObj.position.y + 'px';

    const collapseBtn = o.collapseBtnId ? document.getElementById(o.collapseBtnId) : null;
    function syncCollapse() {
        panel.classList.toggle('collapsed', stateObj.isCollapsed);
        if (collapseBtn) {
            collapseBtn.textContent = stateObj.isCollapsed ? '▸' : '▾';
            collapseBtn.title = stateObj.isCollapsed ? '展開' : '收起';
        }
    }
    function toggleCollapse() {
        stateObj.isCollapsed = !stateObj.isCollapsed;
        syncCollapse();
        saveFn();
    }
    syncCollapse();

    // 標頭拖曳 + WindowManager 置頂（同 tier 內最後點擊者在最上層）
    setupPanelDrag(o.panelId, o.headerId, stateObj, saveFn);

    // 雙擊標頭收合／展開（點標頭上的按鈕時不觸發）
    header.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        toggleCollapse();
    });
    if (collapseBtn) {
        collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(); });
    }

    // 夾限，避免記憶座標來自更大的視窗、開啟時整個面板落到螢幕外
    clampHudPosition(stateObj, o.panelId);
    return stateObj;
}

// ===== Passive Entry Editor（被動能力／特性：逐條新增、可刪除）=====
// 單位上仍以字串儲存（各條目以換行分隔），與既有模板 / Firebase 同步格式相容。

const passiveEditors = {}; // containerId -> string[]

/** 在指定容器初始化被動條目編輯器，initialText 為以換行分隔的既有內容 */
function initPassiveEditor(containerId, initialText) {
    passiveEditors[containerId] = String(initialText || '')
        .split('\n').map(s => s.trim()).filter(Boolean);
    renderPassiveEditor(containerId);
}

function renderPassiveEditor(containerId) {
    const box = document.getElementById(containerId);
    if (!box) return;
    const entries = passiveEditors[containerId] || [];
    const rows = entries.map((t, i) =>
        `<div class="passive-entry"><span>${escapeHtml(t)}</span><button onclick="removePassiveEntry('${containerId}',${i})" title="刪除">×</button></div>`
    ).join('');
    box.innerHTML = `
        <div class="passive-entry-list">${rows}</div>
        <div class="passive-entry-add">
            <input type="text" id="${containerId}-input" placeholder="例：每回合結束回復 10 HP"
                   onkeydown="if(event.key==='Enter'){addPassiveEntry('${containerId}');event.preventDefault();}">
            <button class="ma-mini-btn" onclick="addPassiveEntry('${containerId}')">＋</button>
        </div>`;
}

function addPassiveEntry(containerId) {
    const input = document.getElementById(containerId + '-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    if (!passiveEditors[containerId]) passiveEditors[containerId] = [];
    passiveEditors[containerId].push(text);
    renderPassiveEditor(containerId);
    const fresh = document.getElementById(containerId + '-input');
    if (fresh) fresh.focus();
}

function removePassiveEntry(containerId, index) {
    if (!passiveEditors[containerId]) return;
    passiveEditors[containerId].splice(index, 1);
    renderPassiveEditor(containerId);
}

/** 讀回編輯器內容（含輸入框中尚未按＋的文字），回傳換行分隔字串供儲存 */
function readPassiveEditor(containerId) {
    const entries = (passiveEditors[containerId] || []).slice();
    const pending = (document.getElementById(containerId + '-input')?.value || '').trim();
    if (pending) entries.push(pending);
    return entries.join('\n');
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
window.makeFloatingPanel = makeFloatingPanel;
window.initPassiveEditor = initPassiveEditor;
window.renderPassiveEditor = renderPassiveEditor;
window.addPassiveEntry = addPassiveEntry;
window.removePassiveEntry = removePassiveEntry;
window.readPassiveEditor = readPassiveEditor;
window.getStatusName = getStatusName;
window.getStatusDisplayName = getStatusDisplayName;

console.log('戰鬥面板共用工具已載入');

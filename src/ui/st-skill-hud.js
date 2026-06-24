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
 *   - ST 群體操作 (AOE)（已整合進「多重行動設定」面板）
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


// ===== ST AOE Manager =====

let stAoePanelOpen = false;

function toggleStAoePanel() {
    const content = document.getElementById('st-aoe-panel-content');
    const icon = document.getElementById('st-aoe-toggle-icon');
    if (!content || !icon) return;

    stAoePanelOpen = !stAoePanelOpen;
    if (stAoePanelOpen) {
        content.style.display = 'block';
        icon.innerText = '▲';
        renderStAoeTargetList();
    } else {
        content.style.display = 'none';
        icon.innerText = '▼';
    }
}

/**
 * 建立 AOE 狀態名稱自動補全清單（含自訂狀態）
 */
function buildStAoeStatusDatalist() {
    let dl = document.getElementById('st-aoe-status-options');
    if (!dl) {
        dl = document.createElement('datalist');
        dl.id = 'st-aoe-status-options';
        document.body.appendChild(dl);
    }
    const names = [];
    if (typeof getAllStatuses === 'function') {
        getAllStatuses().forEach(s => names.push(s.name));
    }
    if (typeof state !== 'undefined' && Array.isArray(state.customStatuses)) {
        state.customStatuses.forEach(s => { if (s && s.name) names.push(s.name); });
    }
    dl.innerHTML = [...new Set(names)].map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}

function renderStAoeTargetList() {
    const listContainer = document.getElementById('st-aoe-target-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    buildStAoeStatusDatalist();

    // 排除多重行動條目（沒有自己的血量，傷害應打在 BOSS 本體）
    const targetableUnits = (state.units || []).filter(u => !u.actionSlotOf);

    if (targetableUnits.length === 0) {
        listContainer.innerHTML = '<div style="color:var(--text-dim);">場上無單位</div>';
        return;
    }

    targetableUnits.forEach(u => {
        const item = document.createElement('label');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.padding = '2px 0';
        item.style.cursor = 'pointer';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'st-aoe-unit-checkbox';
        cb.value = u.id;
        cb.dataset.type = u.type || 'enemy'; // 'player', 'enemy', 'boss'

        const nameSpan = document.createElement('span');
        nameSpan.innerText = `${u.name || '未命名'} (${u.type === 'player' ? '玩家' : '敵人'})`;
        nameSpan.style.marginLeft = '5px';

        item.appendChild(cb);
        item.appendChild(nameSpan);
        listContainer.appendChild(item);
    });
}

function stAoeSelect(mode) {
    const checkboxes = document.querySelectorAll('.st-aoe-unit-checkbox');
    checkboxes.forEach(cb => {
        if (mode === 'players') {
            cb.checked = (cb.dataset.type === 'player');
        } else if (mode === 'enemies') {
            cb.checked = (cb.dataset.type === 'enemy' || cb.dataset.type === 'boss');
        } else if (mode === 'all') {
            cb.checked = true;
        } else if (mode === 'none') {
            cb.checked = false;
        } else if (mode === 'invert') {
            cb.checked = !cb.checked;
        }
    });
}

function executeStAoeAction(type) {
    const checkboxes = document.querySelectorAll('.st-aoe-unit-checkbox:checked');
    const unitIds = Array.from(checkboxes).map(cb => cb.value);

    if (unitIds.length === 0) {
        if (typeof showToast === 'function') showToast('請先勾選目標單位');
        return;
    }

    let actionData = { type };

    if (type === 'damage' || type === 'heal') {
        const val = parseInt(document.getElementById('st-aoe-value-input').value);
        if (isNaN(val) || val <= 0) {
            if (typeof showToast === 'function') showToast('請輸入有效數值');
            return;
        }
        actionData.value = val;
        if (type === 'damage') {
            actionData.dmgType = document.getElementById('st-aoe-dmg-type')?.value || 'l';
        }
    } else if (type === 'status') {
        const statusId = document.getElementById('st-aoe-status-id').value.trim();
        const val = parseInt(document.getElementById('st-aoe-status-val').value) || 0;
        if (!statusId) {
            if (typeof showToast === 'function') showToast('請輸入狀態名稱');
            return;
        }
        actionData.statusId = statusId;
        actionData.value = val;
    }

    if (typeof applyBatchAction === 'function') {
        applyBatchAction(unitIds, actionData);
        if (typeof showToast === 'function') {
            if (type === 'damage') {
                const typeLabel = { b: 'B', l: 'L', a: 'A' }[actionData.dmgType] || '';
                showToast(`對 ${unitIds.length} 個目標造成 ${actionData.value} 點 ${typeLabel} 傷`);
            }
            else if (type === 'heal') showToast(`為 ${unitIds.length} 個目標治癒 ${actionData.value} 點`);
            else if (type === 'status') showToast(`對 ${unitIds.length} 個目標套用狀態 ${actionData.statusId}`);
        }

        if (typeof renderMap === 'function') renderMap();
        if (typeof updateSidebarUnits === 'function') updateSidebarUnits();
    }
}

function undoStAoe() {
    if (typeof undoLastBatch === 'function') {
        undoLastBatch();
        if (typeof showToast === 'function') showToast('已復原上一步 AOE 操作');
        if (typeof renderMap === 'function') renderMap();
        if (typeof updateSidebarUnits === 'function') updateSidebarUnits();
    }
}

// ===== Window bindings =====
window.clampHudPosition = clampHudPosition;
window.setupPanelDrag = setupPanelDrag;
window.setupPanelCollapse = setupPanelCollapse;
window.getStatusName = getStatusName;
window.getStatusDisplayName = getStatusDisplayName;
window.toggleStAoePanel = toggleStAoePanel;
window.renderStAoeTargetList = renderStAoeTargetList;
window.stAoeSelect = stAoeSelect;
window.executeStAoeAction = executeStAoeAction;
window.undoStAoe = undoStAoe;

console.log('戰鬥面板共用工具 + AOE 已載入');

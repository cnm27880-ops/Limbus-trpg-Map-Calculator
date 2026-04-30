/**
 * Limbus Command - AOE 管理面板邏輯
 */

let isAoePanelOpen = false;

function toggleAoePanel() {
    const panel = document.getElementById('aoe-panel');
    if (!panel) return;

    isAoePanelOpen = !isAoePanelOpen;
    if (isAoePanelOpen) {
        panel.classList.remove('hidden');
        renderAoeUnitList();
    } else {
        panel.classList.add('hidden');
    }
}

function renderAoeUnitList() {
    const listContainer = document.getElementById('aoe-unit-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    // 渲染所有單位
    state.units.forEach(u => {
        const item = document.createElement('label');
        item.className = 'aoe-unit-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'aoe-unit-checkbox';
        cb.value = u.id;

        const nameSpan = document.createElement('span');
        nameSpan.innerText = u.name || '未命名單位';

        item.appendChild(cb);
        item.appendChild(nameSpan);
        listContainer.appendChild(item);
    });
}

function aoeSelectAll() {
    document.querySelectorAll('.aoe-unit-checkbox').forEach(cb => cb.checked = true);
}

function aoeSelectInvert() {
    document.querySelectorAll('.aoe-unit-checkbox').forEach(cb => cb.checked = !cb.checked);
}

function executeAoeAction(type) {
    const checkboxes = document.querySelectorAll('.aoe-unit-checkbox:checked');
    const unitIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (unitIds.length === 0) {
        showToast('請先選擇至少一個單位');
        return;
    }

    let actionData = { type: type };

    if (type === 'damage' || type === 'heal') {
        const val = parseInt(document.getElementById('aoe-value-input').value) || 0;
        actionData.value = val;
    } else if (type === 'status') {
        const statusId = document.getElementById('aoe-status-id').value.trim();
        const val = parseInt(document.getElementById('aoe-status-val').value) || 0;
        if (!statusId) {
            showToast('請輸入狀態 ID');
            return;
        }
        actionData.statusId = statusId;
        actionData.value = val;
    }

    if (typeof applyBatchAction === 'function') {
        applyBatchAction(unitIds, actionData);
        showToast('AOE 操作執行完畢');

        // 重新渲染左側側邊欄和地圖，因為 broadcastState 本來會處理，但在這裡強制更新視覺
        if (typeof renderMap === 'function') renderMap();
        if (typeof updateSidebarUnits === 'function') updateSidebarUnits();
    }
}

function undoAoeAction() {
    if (typeof undoLastBatch === 'function') {
        undoLastBatch();
        showToast('已復原上一步 AOE 操作');
        if (typeof renderMap === 'function') renderMap();
        if (typeof updateSidebarUnits === 'function') updateSidebarUnits();
    }
}

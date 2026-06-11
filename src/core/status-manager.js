/**
 * Limbus Command - 狀態管理模組
 * 處理狀態的新增、移除、互動機制
 */

// ===== 狀態管理狀態 =====
let currentStatusUnitId = null;
let currentStatusCategory = 'common';
let statusSearchQuery = '';

// ===== Modal 操作 =====

/**
 * 開啟狀態管理 Modal
 * @param {string} unitId - 單位 ID
 */
function openStatusModal(unitId) {
    currentStatusUnitId = unitId;
    currentStatusCategory = 'common';
    statusSearchQuery = '';

    const unit = findUnitById(unitId);
    if (!unit) {
        showToast('找不到單位');
        return;
    }

    const modalHtml = `
        <div class="modal-overlay show" id="status-modal" onclick="closeStatusModalOnOverlay(event)">
            <div class="modal status-modal" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <span style="font-weight:bold;">🏷️ 管理狀態 - ${escapeHtml(unit.name)}</span>
                    <button onclick="closeStatusModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body" style="padding:0;">
                    <!-- 搜尋框 -->
                    <div class="status-search-bar">
                        <input type="text" id="status-search-input" placeholder="🔍 搜尋狀態名稱或效果..."
                               oninput="handleStatusSearch(this.value)">
                    </div>

                    <!-- 最近使用 -->
                    <div class="recent-status-bar" id="recent-status-bar">
                        ${renderRecentStatusBar()}
                    </div>

                    <!-- 目前狀態 -->
                    <div class="current-statuses-section">
                        <div class="section-title">目前狀態</div>
                        <div class="current-statuses" id="current-statuses-list">
                            ${renderCurrentStatuses(unit)}
                        </div>
                    </div>

                    <!-- 分類標籤頁 -->
                    <div class="status-category-tabs" id="status-category-tabs">
                        ${renderCategoryTabs()}
                    </div>

                    <!-- 狀態網格 -->
                    <div class="status-grid-container">
                        <div class="status-grid-hint">💡 點一下狀態卡＝立即套用（累積型每次 +1、開關型可切換）；點 ℹ 可查看詳情或指定層數</div>
                        <div class="status-grid" id="status-grid">
                            ${renderStatusGrid('common')}
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button onclick="openCustomStatusModal()" class="modal-btn" style="background:var(--accent-purple);">
                        ✏️ 自訂狀態
                    </button>
                    <button onclick="closeStatusModal()" class="modal-btn">關閉</button>
                </div>
            </div>
        </div>
    `;

    // 使用 insertAdjacentHTML 避免覆蓋其他 modal
    const container = document.getElementById('modals-container');
    // 移除之前可能存在的狀態 modal
    const existingModal = document.getElementById('status-modal');
    if (existingModal) existingModal.remove();
    container.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * 關閉狀態 Modal
 */
function closeStatusModal() {
    const modal = document.getElementById('status-modal');
    if (modal) {
        modal.remove();
    }
    currentStatusUnitId = null;
}

/**
 * 點擊 overlay 關閉
 */
function closeStatusModalOnOverlay(event) {
    if (event.target.id === 'status-modal') {
        closeStatusModal();
    }
}

// ===== 渲染函數 =====

/**
 * 渲染分類標籤頁
 */
function renderCategoryTabs() {
    let html = '';
    const favorites = getFavoriteStatuses();

    for (const [id, cat] of Object.entries(STATUS_CATEGORIES)) {
        const isActive = id === currentStatusCategory ? 'active' : '';
        let count = 0;

        if (id === 'common') {
            // 常用分類顯示收藏數量
            count = favorites.length || STATUS_LIBRARY.common.length;
        } else if (id === 'custom') {
            // 自訂分類：從 state.customStatuses 取得
            count = (state.customStatuses || []).length;
        } else if (STATUS_LIBRARY[id]) {
            count = STATUS_LIBRARY[id].length;
        }

        html += `
            <button class="category-tab ${isActive}" data-category="${id}"
                    onclick="switchStatusCategory('${id}')">
                ${cat.icon} ${cat.name} <span class="count">${count}</span>
            </button>
        `;
    }

    return html;
}

/**
 * 渲染狀態網格
 * @param {string} category - 分類 ID
 */
function renderStatusGrid(category) {
    let statuses = [];
    const overrideFn = (typeof applyStatusOverride === 'function') ? applyStatusOverride : (s => s);
    // 自訂狀態可指定分類（預設 custom），會一併顯示在該分類網格中
    const customsInCategory = cat => getCustomStatuses().filter(s => {
        const c = (s.category && STATUS_CATEGORIES[s.category]) ? s.category : 'custom';
        return c === cat;
    });

    if (category === 'common') {
        // 常用分類：顯示收藏的狀態，沒有則顯示預設常用
        const favorites = getFavoriteStatuses();
        if (favorites.length > 0) {
            statuses = favorites.map(id => getStatusById(id)).filter(Boolean);
        } else {
            statuses = (STATUS_LIBRARY.common || []).map(overrideFn);
        }
        statuses = statuses.concat(customsInCategory('common'));
    } else if (category === 'custom') {
        // 自訂分類：從 state.customStatuses 取得（房間共享）
        statuses = customsInCategory('custom');
    } else if (STATUS_LIBRARY[category]) {
        statuses = (STATUS_LIBRARY[category] || []).map(overrideFn).concat(customsInCategory(category));
    }

    if (statuses.length === 0) {
        if (category === 'custom') {
            return '<div class="no-statuses">尚無自訂狀態，點擊下方「✏️ 自訂狀態」建立</div>';
        }
        return '<div class="no-statuses">此分類沒有狀態</div>';
    }

    return statuses.map(status => renderStatusCard(status)).join('');
}

/**
 * 渲染單一狀態卡片
 * @param {object} status - 狀態定義
 */
function renderStatusCard(status) {
    const categoryInfo = STATUS_CATEGORIES[getStatusCategory(status.id)] || {};
    const borderColor = categoryInfo.color || '#666';

    // 自訂狀態才顯示刪除按鈕
    const deleteBtn = status.isCustom
        ? `<button class="status-card-delete" onclick="event.stopPropagation();confirmDeleteCustomStatus('${status.id}','${escapeHtml(status.name)}')" title="刪除此自訂狀態">×</button>`
        : '';

    // ST 可編輯任何狀態（常駐狀態以覆寫方式儲存，全房間同步）
    const editBtn = (myRole === 'st')
        ? `<button class="status-card-info-btn status-card-edit-btn" onclick="event.stopPropagation();openStatusEditorModal('${status.id}')" title="編輯此狀態">✎</button>`
        : '';

    return `
        <div class="status-card" data-status-id="${status.id}"
             style="border-left-color:${borderColor}"
             onclick="quickApplyStatus('${status.id}')">
            ${deleteBtn}
            <div class="status-card-icon">${status.icon}</div>
            <div class="status-card-info">
                <div class="status-card-name">${status.name}</div>
                <div class="status-card-desc">${status.desc}</div>
            </div>
            <div class="status-card-side">
                <div class="status-card-type ${status.type}">${status.type === 'stack' ? '累積' : '開關'}</div>
                <div style="display:flex;gap:3px;">
                    <button class="status-card-info-btn" onclick="event.stopPropagation();selectStatus('${status.id}')" title="查看詳情／指定層數">ℹ</button>
                    ${editBtn}
                </div>
            </div>
        </div>
    `;
}

/**
 * 一鍵套用狀態到當前單位（點擊狀態卡直接生效）
 * 累積型：每次點擊 +1 層；開關型：已存在則移除（切換）
 * @param {string} statusId - 狀態 ID
 */
function quickApplyStatus(statusId) {
    if (!currentStatusUnitId) return;

    const status = getStatusById(statusId);
    if (!status) return;

    const unit = findUnitById(currentStatusUnitId);
    if (!unit) return;

    if (status.type === 'binary' && unit.status && unit.status[status.name] !== undefined) {
        removeStatusFromUnit(currentStatusUnitId, status.name);
    } else {
        addStatusToUnit(currentStatusUnitId, statusId, status.type === 'stack' ? 1 : null);
        trackStatusUsage(statusId);
        recordRecentStatus(statusId);
    }

    refreshStatusModalViews();
}

/**
 * 刷新狀態 Modal 內的「目前狀態」與「最近使用」區塊
 */
function refreshStatusModalViews() {
    if (!currentStatusUnitId) return;
    const unit = findUnitById(currentStatusUnitId);
    if (unit) {
        const container = document.getElementById('current-statuses-list');
        if (container) container.innerHTML = renderCurrentStatuses(unit);
    }
    const recentBar = document.getElementById('recent-status-bar');
    if (recentBar) recentBar.innerHTML = renderRecentStatusBar();
}

/**
 * 渲染目前狀態列表
 * @param {object} unit - 單位物件
 */
function renderCurrentStatuses(unit) {
    const statuses = unit.status || {};
    const entries = Object.entries(statuses);

    if (entries.length === 0) {
        return '<div class="no-current-status">尚無狀態</div>';
    }

    return entries.map(([name, value]) => {
        // 嘗試找到狀態定義
        const statusDef = getStatusByName(name);
        const icon = statusDef?.icon || '📌';
        const color = statusDef ? (STATUS_CATEGORIES[getStatusCategory(statusDef.id)]?.color || '#666') : '#666';
        const enc = encodeStatusArg(name);

        // 累積型（或值看起來是數字的自訂狀態）顯示 −/+ 快速調整
        const isStack = statusDef ? statusDef.type === 'stack' : (value !== '' && !isNaN(parseInt(value)));
        const valueHtml = isStack
            ? `<button class="stack-adjust-btn" onclick="event.stopPropagation();adjustCurrentStatusStacks('${enc}',-1)" title="減 1 層">−</button><span class="stack-value">${escapeHtml(value || '0')}</span><button class="stack-adjust-btn" onclick="event.stopPropagation();adjustCurrentStatusStacks('${enc}',1)" title="加 1 層">+</button>`
            : (value ? ` (${escapeHtml(value)})` : '');

        return `
            <span class="current-status-tag" style="--status-color:${color}">
                ${icon} ${escapeHtml(name)}${valueHtml}
                <button class="remove-status-btn" onclick="event.stopPropagation();removeStatusFromUnit('${currentStatusUnitId}',decodeURIComponent('${enc}'))"
                        title="移除此狀態">×</button>
            </span>
        `;
    }).join('');
}

/**
 * 將狀態名稱編碼為可安全嵌入 onclick 屬性的字串
 * （encodeURIComponent 不會處理單引號，需額外取代）
 * @param {string} name - 狀態名稱
 */
function encodeStatusArg(name) {
    return encodeURIComponent(name).replace(/'/g, '%27');
}

/**
 * 在狀態 Modal 中快速增減目前狀態的層數
 * @param {string} encodedName - 編碼後的狀態名稱
 * @param {number} delta - 增減量
 */
function adjustCurrentStatusStacks(encodedName, delta) {
    if (!currentStatusUnitId) return;
    const name = decodeURIComponent(encodedName);
    const unit = findUnitById(currentStatusUnitId);
    if (!unit || !unit.status || unit.status[name] === undefined) return;

    const current = parseInt(unit.status[name]) || 0;
    updateStatusStacks(currentStatusUnitId, name, current + delta);
    refreshStatusModalViews();
}

/**
 * 根據名稱獲取狀態定義
 * @param {string} name - 狀態名稱
 */
function getStatusByName(name) {
    // 先查詢預設狀態庫
    for (const category of Object.values(STATUS_LIBRARY)) {
        const status = category.find(s => s.name === name);
        if (status) return status;
    }

    // 🔥 修復：再查詢自訂狀態
    const customs = getCustomStatuses();
    const custom = customs.find(s => s.name === name);
    if (custom) return custom;

    return null;
}

// ===== 互動函數 =====

/**
 * 切換分類
 * @param {string} category - 分類 ID
 */
function switchStatusCategory(category) {
    currentStatusCategory = category;
    statusSearchQuery = '';

    // 清空搜尋框
    const searchInput = document.getElementById('status-search-input');
    if (searchInput) searchInput.value = '';

    // 更新標籤頁
    document.querySelectorAll('.category-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.category === category);
    });

    // 更新網格
    const grid = document.getElementById('status-grid');
    if (grid) {
        grid.innerHTML = renderStatusGrid(category);
    }
}

/**
 * 處理搜尋
 * @param {string} query - 搜尋關鍵字
 */
function handleStatusSearch(query) {
    statusSearchQuery = query.trim();
    const grid = document.getElementById('status-grid');
    if (!grid) return;

    if (!statusSearchQuery) {
        grid.innerHTML = renderStatusGrid(currentStatusCategory);
        return;
    }

    const results = searchStatuses(statusSearchQuery);
    if (results.length === 0) {
        grid.innerHTML = '<div class="no-statuses">找不到符合的狀態</div>';
    } else {
        grid.innerHTML = results.map(status => renderStatusCard(status)).join('');
    }

    // 清除分類選中狀態
    document.querySelectorAll('.category-tab').forEach(tab => {
        tab.classList.remove('active');
    });
}

/**
 * 選擇狀態（顯示詳細面板）
 * @param {string} statusId - 狀態 ID
 */
function selectStatus(statusId) {
    const status = getStatusById(statusId);
    if (!status) return;

    const categoryInfo = STATUS_CATEGORIES[getStatusCategory(statusId)] || {};

    // 建立詳細面板
    const detailHtml = `
        <div class="status-detail-overlay" id="status-detail-overlay" onclick="closeStatusDetail(event)">
            <div class="status-detail-panel" onclick="event.stopPropagation()">
                <div class="detail-header" style="border-color:${categoryInfo.color || '#666'}">
                    <span class="detail-icon">${status.icon}</span>
                    <span class="detail-name">${status.name}</span>
                    <span class="detail-type ${status.type}">${status.type === 'stack' ? '累積型' : '開關型'}</span>
                </div>

                <div class="detail-body">
                    <div class="detail-desc">${status.fullDesc || status.desc}</div>

                    ${status.keyResist ? `
                        <div class="detail-resist">
                            <strong>關鍵抵抗：</strong> ${status.keyResist.join('、')}
                        </div>
                    ` : ''}

                    ${status.canCounter ? `
                        <div class="detail-counter">
                            ⚠️ 與 ${status.canCounter.map(id => getStatusById(id)?.name || id).join('、')} 互相抵銷
                        </div>
                    ` : ''}

                    ${status.effects ? `
                        <div class="detail-effects">
                            ${status.effects.light ? `<div class="effect-item light"><strong>輕度：</strong>${status.effects.light}</div>` : ''}
                            ${status.effects.heavy ? `<div class="effect-item heavy"><strong>重度：</strong>${status.effects.heavy}</div>` : ''}
                            ${status.effects.destruction ? `<div class="effect-item destruction"><strong>毀滅：</strong>${status.effects.destruction}</div>` : ''}
                        </div>
                    ` : ''}

                    ${status.type === 'stack' ? `
                        <div class="detail-input">
                            <label>堆疊數值：</label>
                            <input type="number" id="status-stack-input" value="1" min="1" max="99">
                        </div>
                    ` : ''}
                </div>

                <div class="detail-footer">
                    <button onclick="addStatusToCurrentUnit('${statusId}')" class="modal-btn" style="background:var(--accent-green);">
                        ✓ 新增狀態
                    </button>
                    <button onclick="closeStatusDetail()" class="modal-btn">取消</button>
                </div>
            </div>
        </div>
    `;

    // 插入到 status-modal 內
    const modal = document.getElementById('status-modal');
    if (modal) {
        const overlay = document.createElement('div');
        overlay.innerHTML = detailHtml;
        modal.appendChild(overlay.firstElementChild);
    }
}

/**
 * 關閉詳細面板
 */
function closeStatusDetail(event) {
    if (event && event.target.id !== 'status-detail-overlay') return;
    const overlay = document.getElementById('status-detail-overlay');
    if (overlay) overlay.remove();
}

// ===== 狀態操作 =====

/**
 * 新增狀態到目前單位
 * @param {string} statusId - 狀態 ID
 */
function addStatusToCurrentUnit(statusId) {
    if (!currentStatusUnitId) return;

    const status = getStatusById(statusId);
    if (!status) return;

    let stacks = null;
    if (status.type === 'stack') {
        const input = document.getElementById('status-stack-input');
        stacks = parseInt(input?.value) || 1;
    }

    addStatusToUnit(currentStatusUnitId, statusId, stacks);
    closeStatusDetail();

    // 記錄使用
    trackStatusUsage(statusId);
    recordRecentStatus(statusId);

    // 刷新目前狀態與最近使用列表
    refreshStatusModalViews();
}

/**
 * 新增狀態到單位
 * @param {string} unitId - 單位 ID
 * @param {string} statusId - 狀態 ID
 * @param {number|null} stacks - 堆疊數值（累積型）
 */
function addStatusToUnit(unitId, statusId, stacks = null) {
    const unit = findUnitById(unitId);
    if (!unit) return;

    const status = getStatusById(statusId);
    if (!status) return;

    // 初始化 status 物件
    if (!unit.status) unit.status = {};

    // 檢查互動機制（抵銷）
    if (status.canCounter && status.canCounter.length > 0) {
        for (const counterId of status.canCounter) {
            const counterStatus = getStatusById(counterId);
            if (counterStatus && unit.status[counterStatus.name]) {
                // 執行抵銷
                const existingStacks = parseInt(unit.status[counterStatus.name]) || 1;
                const newStacks = stacks || 1;

                if (newStacks >= existingStacks) {
                    // 新狀態抵銷舊狀態
                    delete unit.status[counterStatus.name];
                    const remaining = newStacks - existingStacks;
                    if (remaining > 0) {
                        unit.status[status.name] = remaining.toString();
                    }
                    showToast(`${status.name} 與 ${counterStatus.name} 互相抵銷！`);
                } else {
                    // 舊狀態減少
                    unit.status[counterStatus.name] = (existingStacks - newStacks).toString();
                    showToast(`${counterStatus.name} 減少 ${newStacks} 點`);
                }

                syncUnitStatus(unitId);
                renderUnitsList();
                renderSidebarUnits();
                return;
            }
        }
    }

    // 正常新增
    if (status.type === 'stack') {
        const existing = parseInt(unit.status[status.name]) || 0;
        unit.status[status.name] = (existing + (stacks || 1)).toString();
        showToast(`已新增 ${status.name}（共 ${unit.status[status.name]} 層）`);
    } else {
        unit.status[status.name] = '';
        showToast(`已新增 ${status.name}`);
    }
    syncUnitStatus(unitId);
    renderUnitsList();
    renderSidebarUnits();
}

/**
 * 從單位移除狀態
 * @param {string} unitId - 單位 ID
 * @param {string} statusName - 狀態名稱
 */
function removeStatusFromUnit(unitId, statusName) {
    const unit = findUnitById(unitId);
    if (!unit || !unit.status) return;

    delete unit.status[statusName];

    showToast(`已移除 ${statusName}`);
    syncUnitStatus(unitId);

    // 刷新 Modal 內的目前狀態列表
    const container = document.getElementById('current-statuses-list');
    if (container && currentStatusUnitId === unitId) {
        container.innerHTML = renderCurrentStatuses(unit);
    }

    renderUnitsList();
    renderSidebarUnits();
}

/**
 * 更新狀態堆疊數值
 * @param {string} unitId - 單位 ID
 * @param {string} statusName - 狀態名稱
 * @param {number} newStacks - 新數值
 */
function updateStatusStacks(unitId, statusName, newStacks) {
    const unit = findUnitById(unitId);
    if (!unit || !unit.status) return;

    if (newStacks <= 0) {
        delete unit.status[statusName];
        showToast(`${statusName} 已消除`);
    } else {
        unit.status[statusName] = newStacks.toString();
    }

    syncUnitStatus(unitId);
    renderUnitsList();
    renderSidebarUnits();
}

/**
 * 同步單位狀態到 Firebase
 * @param {string} unitId - 單位 ID
 */
function syncUnitStatus(unitId) {
    const unit = findUnitById(unitId);
    if (!unit) return;

    if (myRole === 'st') {
        sendState();
    } else {
        sendToHost({
            type: 'updateStatus',
            unitId: unitId,
            status: unit.status
        });
    }
}

// ===== 自訂狀態 =====

const CUSTOM_STATUS_KEY = 'limbus-command-custom-statuses'; // 保留用於向後相容遷移

/**
 * 獲取自訂狀態列表（從房間共享的 state.customStatuses 取得）
 */
function getCustomStatuses() {
    return state.customStatuses || [];
}

/**
 * 開啟自訂狀態 Modal
 */
function openCustomStatusModal() {
    const customHtml = `
        <div class="status-detail-overlay" id="custom-status-overlay" onclick="closeCustomStatusModal(event)">
            <div class="status-detail-panel" onclick="event.stopPropagation()">
                <div class="detail-header" style="border-color:var(--accent-purple)">
                    <span class="detail-icon">✏️</span>
                    <span class="detail-name">建立自訂狀態</span>
                </div>

                <div class="detail-body">
                    <div class="form-group">
                        <label>狀態名稱：</label>
                        <input type="text" id="custom-status-name" placeholder="例如：詛咒">
                    </div>

                    <div class="form-group">
                        <label>圖示：</label>
                        <div class="emoji-picker" id="emoji-picker">
                            ${['💀', '☠️', '⚡', '🔥', '❄️', '💧', '🌙', '☀️', '⭐', '💫', '🎯', '🔮', '💎', '🗡️', '🛡️', '💪', '👁️', '🧠', '❤️', '💔'].map(e =>
                                `<span class="emoji-option" onclick="selectCustomEmoji('${e}')">${e}</span>`
                            ).join('')}
                        </div>
                        <input type="text" id="custom-status-icon" value="📌" readonly style="width:50px;text-align:center;">
                    </div>

                    <div class="form-group">
                        <label>類型：</label>
                        <select id="custom-status-type">
                            <option value="stack">累積型（有數值）</option>
                            <option value="binary">開關型（有/無）</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>顯示分類：</label>
                        <select id="custom-status-category">
                            <option value="custom">✏️ 自訂</option>
                            <option value="common">⭐ 常用狀態</option>
                            <option value="debuff">💀 負面與失能</option>
                            <option value="mental">🧠 精神與心智</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>簡短描述：</label>
                        <input type="text" id="custom-status-desc" placeholder="例如：受到詛咒影響">
                    </div>

                    <div class="form-group">
                        <label>完整說明（選填）：</label>
                        <textarea id="custom-status-fullDesc" placeholder="詳細效果說明..."></textarea>
                    </div>
                </div>

                <div class="detail-footer">
                    <button onclick="createCustomStatus()" class="modal-btn" style="background:var(--accent-green);">
                        ✓ 建立並新增
                    </button>
                    <button onclick="closeCustomStatusModal()" class="modal-btn">取消</button>
                </div>
            </div>
        </div>
    `;

    const modal = document.getElementById('status-modal');
    if (modal) {
        const overlay = document.createElement('div');
        overlay.innerHTML = customHtml;
        modal.appendChild(overlay.firstElementChild);
    }
}

/**
 * 關閉自訂狀態 Modal
 */
function closeCustomStatusModal(event) {
    if (event && event.target.id !== 'custom-status-overlay') return;
    const overlay = document.getElementById('custom-status-overlay');
    if (overlay) overlay.remove();
}

/**
 * 選擇自訂 Emoji
 */
function selectCustomEmoji(emoji) {
    const input = document.getElementById('custom-status-icon');
    if (input) input.value = emoji;

    // 高亮選中的
    document.querySelectorAll('.emoji-option').forEach(el => {
        el.classList.toggle('selected', el.textContent === emoji);
    });
}

/**
 * 建立自訂狀態
 */
function createCustomStatus() {
    const name = document.getElementById('custom-status-name')?.value.trim();
    const icon = document.getElementById('custom-status-icon')?.value || '📌';
    const type = document.getElementById('custom-status-type')?.value || 'binary';
    const desc = document.getElementById('custom-status-desc')?.value.trim() || '自訂狀態';
    const fullDesc = document.getElementById('custom-status-fullDesc')?.value.trim();
    const category = document.getElementById('custom-status-category')?.value || 'custom';

    if (!name) {
        showToast('請輸入狀態名稱');
        return;
    }

    // 建立自訂狀態物件（category 決定顯示在哪個分類網格）
    const newStatus = {
        id: 'custom_' + Date.now(),
        name,
        icon,
        type,
        desc,
        fullDesc: fullDesc || desc,
        category,
        isCustom: true
    };

    // 透過 Firebase 同步到房間（所有人共享）
    if (typeof addCustomStatusToRoom === 'function') {
        addCustomStatusToRoom(newStatus);
    }

    // 直接新增到當前單位
    if (currentStatusUnitId) {
        const unit = findUnitById(currentStatusUnitId);
        if (unit) {
            if (!unit.status) unit.status = {};
            if (type === 'stack') {
                unit.status[name] = '1';
            } else {
                unit.status[name] = '';
            }
            syncUnitStatus(currentStatusUnitId);

            // 記錄最近使用
            recordRecentStatus(newStatus.id);

            // 刷新目前狀態列表
            const container = document.getElementById('current-statuses-list');
            if (container) {
                container.innerHTML = renderCurrentStatuses(unit);
            }

            renderUnitsList();
            renderSidebarUnits();
        }
    }

    showToast(`已建立並新增 ${name}`);
    closeCustomStatusModal();
}

// ===== 快速操作（用於單位卡片上的狀態標籤） =====

/**
 * 點擊單位卡上的狀態標籤 → 開啟快速調整浮窗
 * （取代原本的 prompt 輸入框，可直接 −/+ 調層、移除、查看說明）
 * @param {Event} event - 點擊事件（用於定位浮窗）
 * @param {string} unitId - 單位 ID
 * @param {string} encodedName - 編碼後的狀態名稱
 */
function onStatusTagClick(event, unitId, encodedName) {
    const statusName = decodeURIComponent(encodedName);
    const unit = findUnitById(unitId);
    if (!unit || !unit.status || unit.status[statusName] === undefined) return;

    const statusDef = getStatusByName(statusName);

    // 無權限：只顯示說明
    if (typeof canControlUnit === 'function' && !canControlUnit(unit)) {
        if (statusDef) {
            alert(`${statusDef.icon} ${statusDef.name}\n\n${statusDef.fullDesc || statusDef.desc}`);
        }
        return;
    }

    openStatusQuickPopover(event, unitId, statusName, statusDef);
}

// ===== 狀態快速調整浮窗 =====
let statusPopoverTarget = null;  // { unitId, statusName }

/**
 * 開啟狀態快速調整浮窗
 */
function openStatusQuickPopover(event, unitId, statusName, statusDef) {
    closeStatusQuickPopover();

    const unit = findUnitById(unitId);
    if (!unit || !unit.status) return;

    const rawValue = unit.status[statusName];
    const isStack = statusDef ? statusDef.type === 'stack' : (rawValue !== '' && !isNaN(parseInt(rawValue)));
    const icon = statusDef?.icon || '📌';
    const desc = statusDef ? (statusDef.fullDesc || statusDef.desc || '') : '';

    statusPopoverTarget = { unitId, statusName };

    const stackControls = isStack ? `
        <div class="popover-stack-row">
            <button class="popover-stack-btn" onclick="popoverAdjustStacks(-5)">−5</button>
            <button class="popover-stack-btn" onclick="popoverAdjustStacks(-1)">−</button>
            <input type="number" id="popover-stack-input" value="${parseInt(rawValue) || 1}" min="0"
                   onchange="popoverSetStacks(this.value)">
            <button class="popover-stack-btn" onclick="popoverAdjustStacks(1)">+</button>
            <button class="popover-stack-btn" onclick="popoverAdjustStacks(5)">+5</button>
        </div>` : '';

    const pop = document.createElement('div');
    pop.id = 'status-quick-popover';
    pop.className = 'status-quick-popover';
    pop.innerHTML = `
        <div class="popover-header">
            <span class="popover-title">${icon} ${escapeHtml(statusName)}</span>
            <button class="popover-close" onclick="closeStatusQuickPopover()">×</button>
        </div>
        ${desc ? `<div class="popover-desc">${escapeHtml(desc)}</div>` : ''}
        ${stackControls}
        <div class="popover-footer">
            <button class="popover-remove-btn" onclick="popoverRemoveStatus()">🗑 移除狀態</button>
        </div>
    `;
    document.body.appendChild(pop);

    // 定位在點擊位置附近，並夾限在視窗內
    const W = pop.offsetWidth || 240;
    const H = pop.offsetHeight || 130;
    let x = event.clientX - W / 2;
    let y = event.clientY + 12;
    x = Math.max(8, Math.min(window.innerWidth - W - 8, x));
    if (y + H > window.innerHeight - 8) y = event.clientY - H - 12;
    pop.style.left = x + 'px';
    pop.style.top = Math.max(8, y) + 'px';

    // 點擊浮窗外部時關閉（延遲註冊，避免吃到當前點擊）
    setTimeout(() => {
        document.addEventListener('pointerdown', handlePopoverOutsideClick, true);
    }, 0);
}

function handlePopoverOutsideClick(e) {
    const pop = document.getElementById('status-quick-popover');
    if (pop && !pop.contains(e.target)) closeStatusQuickPopover();
}

function closeStatusQuickPopover() {
    const pop = document.getElementById('status-quick-popover');
    if (pop) pop.remove();
    statusPopoverTarget = null;
    document.removeEventListener('pointerdown', handlePopoverOutsideClick, true);
}

/**
 * 浮窗內增減層數（即時生效並同步）
 */
function popoverAdjustStacks(delta) {
    if (!statusPopoverTarget) return;
    const { unitId, statusName } = statusPopoverTarget;
    const unit = findUnitById(unitId);
    if (!unit || !unit.status || unit.status[statusName] === undefined) {
        closeStatusQuickPopover();
        return;
    }

    const current = parseInt(unit.status[statusName]) || 0;
    const newVal = current + delta;
    updateStatusStacks(unitId, statusName, newVal);

    if (newVal <= 0) {
        closeStatusQuickPopover();
    } else {
        const input = document.getElementById('popover-stack-input');
        if (input) input.value = newVal;
    }
}

/**
 * 浮窗內直接輸入層數
 */
function popoverSetStacks(value) {
    if (!statusPopoverTarget) return;
    const parsed = parseInt(value);
    if (isNaN(parsed)) return;
    const { unitId, statusName } = statusPopoverTarget;
    updateStatusStacks(unitId, statusName, parsed);
    if (parsed <= 0) closeStatusQuickPopover();
}

function popoverRemoveStatus() {
    if (!statusPopoverTarget) return;
    const { unitId, statusName } = statusPopoverTarget;
    removeStatusFromUnit(unitId, statusName);
    closeStatusQuickPopover();
}

// ===== 最近使用狀態 (Recent Usage - LRU) =====
const RECENT_STATUS_KEY = 'limbus_recent_statuses';
const RECENT_STATUS_MAX = 8;

/**
 * 取得最近使用的狀態 ID 列表
 * @returns {string[]}
 */
function getRecentStatuses() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_STATUS_KEY)) || [];
    } catch {
        return [];
    }
}

/**
 * 記錄最近使用的狀態（LRU 演算法）
 * @param {string} statusId - 狀態 ID
 */
function recordRecentStatus(statusId) {
    let recent = getRecentStatuses();
    // 移除已存在的（LRU：移到最前面）
    recent = recent.filter(id => id !== statusId);
    // 插入到最前面
    recent.unshift(statusId);
    // 限制最大數量
    if (recent.length > RECENT_STATUS_MAX) {
        recent = recent.slice(0, RECENT_STATUS_MAX);
    }
    localStorage.setItem(RECENT_STATUS_KEY, JSON.stringify(recent));
}

/**
 * 渲染最近使用狀態列
 * @returns {string} HTML
 */
function renderRecentStatusBar() {
    const recent = getRecentStatuses();
    if (recent.length === 0) {
        return '<span style="color:var(--text-muted);font-size:0.8rem;padding:0 4px;">尚無最近使用紀錄</span>';
    }

    return recent.map(statusId => {
        const status = getStatusById(statusId);
        if (!status) return '';
        const shortName = status.name.length > 4 ? status.name.slice(0, 4) + '…' : status.name;
        return `<button class="recent-tag" onclick="quickAddRecentStatus('${statusId}')" title="${escapeHtml(status.name)}：${escapeHtml(status.desc)}">
            ${status.icon} ${shortName}
        </button>`;
    }).filter(Boolean).join('');
}

/**
 * 快速新增最近使用的狀態到當前單位
 * @param {string} statusId - 狀態 ID
 */
function quickAddRecentStatus(statusId) {
    if (!currentStatusUnitId) return;

    const status = getStatusById(statusId);
    if (!status) {
        showToast('找不到該狀態');
        return;
    }

    // 累積型預設 1 點
    const stacks = status.type === 'stack' ? 1 : null;
    addStatusToUnit(currentStatusUnitId, statusId, stacks);

    // 記錄使用
    trackStatusUsage(statusId);
    recordRecentStatus(statusId);

    // 刷新目前狀態列表
    const unit = findUnitById(currentStatusUnitId);
    if (unit) {
        const container = document.getElementById('current-statuses-list');
        if (container) {
            container.innerHTML = renderCurrentStatuses(unit);
        }
    }

    // 刷新最近使用列
    const recentBar = document.getElementById('recent-status-bar');
    if (recentBar) {
        recentBar.innerHTML = renderRecentStatusBar();
    }
}

// ===== 刪除自訂狀態 =====

/**
 * 顯示刪除自訂狀態的確認對話框
 * @param {string} statusId - 狀態 ID
 * @param {string} statusName - 狀態名稱（用於顯示）
 */
function confirmDeleteCustomStatus(statusId, statusName) {
    const confirmHtml = `
        <div class="status-detail-overlay" id="confirm-delete-overlay" onclick="closeConfirmDeleteOverlay(event)">
            <div class="status-detail-panel" style="max-width:340px;" onclick="event.stopPropagation()">
                <div class="detail-header" style="border-color:var(--accent-red)">
                    <span class="detail-icon">⚠️</span>
                    <span class="detail-name">確認刪除</span>
                </div>
                <div class="detail-body" style="text-align:center;">
                    <p style="margin:0;color:var(--text-main);">確定要刪除自訂狀態<br><strong style="color:var(--accent-red);">${statusName}</strong>？</p>
                    <p style="margin:8px 0 0;font-size:0.8rem;color:var(--text-dim);">此操作無法復原</p>
                </div>
                <div class="detail-footer" style="justify-content:center;">
                    <button onclick="executeDeleteCustomStatus('${statusId}')" class="modal-btn" style="background:var(--accent-red);">
                        確認刪除
                    </button>
                    <button onclick="closeConfirmDeleteOverlay()" class="modal-btn">取消</button>
                </div>
            </div>
        </div>
    `;

    const modal = document.getElementById('status-modal');
    if (modal) {
        // 移除舊的確認面板
        const old = document.getElementById('confirm-delete-overlay');
        if (old) old.remove();

        const wrapper = document.createElement('div');
        wrapper.innerHTML = confirmHtml;
        modal.appendChild(wrapper.firstElementChild);
    }
}

/**
 * 關閉確認刪除 overlay
 */
function closeConfirmDeleteOverlay(event) {
    if (event && event.target.id !== 'confirm-delete-overlay') return;
    const overlay = document.getElementById('confirm-delete-overlay');
    if (overlay) overlay.remove();
}

/**
 * 執行刪除自訂狀態
 * @param {string} statusId - 狀態 ID
 */
function executeDeleteCustomStatus(statusId) {
    // 透過 Firebase 移除
    if (typeof removeCustomStatusFromRoom === 'function') {
        removeCustomStatusFromRoom(statusId);
    } else {
        // 本地移除
        state.customStatuses = (state.customStatuses || []).filter(s => s.id !== statusId);
    }

    showToast('已刪除自訂狀態');
    closeConfirmDeleteOverlay();

    // 刷新狀態網格
    const grid = document.getElementById('status-grid');
    if (grid) {
        grid.innerHTML = renderStatusGrid(currentStatusCategory);
    }

    // 刷新分類標籤數量
    const tabs = document.getElementById('status-category-tabs');
    if (tabs) {
        tabs.innerHTML = renderCategoryTabs();
    }
}

console.log('🏷️ 狀態管理模組已載入');

// ===== 狀態編輯器（ST 專用，可編輯常駐與自訂狀態） =====

const STATUS_EDITOR_EMOJIS = ['💀', '☠️', '⚡', '🔥', '❄️', '💧', '🌙', '☀️', '⭐', '💫', '🎯', '🔮', '💎', '🗡️', '🛡️', '💪', '👁️', '🧠', '❤️', '💔', '🩸', '😱', '😴', '🕸️', '🌀', '🔒'];

/**
 * 開啟狀態編輯器
 * - 自訂狀態：直接修改自訂狀態本身
 * - 常駐狀態：以「覆寫」方式儲存（不動程式碼），可隨時還原預設
 * @param {string} statusId - 狀態 ID
 */
function openStatusEditorModal(statusId) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以編輯狀態庫');
        return;
    }

    const status = getStatusById(statusId);
    if (!status) return;

    const isCustom = status.isCustom === true;
    const hasOverride = !isCustom && state.statusOverrides && state.statusOverrides[statusId];
    const category = getStatusCategory(statusId) || 'custom';

    const old = document.getElementById('status-editor-overlay');
    if (old) old.remove();

    const emojiOptions = STATUS_EDITOR_EMOJIS.map(e =>
        `<span class="emoji-option ${e === status.icon ? 'selected' : ''}" onclick="selectEditorEmoji('${e}')">${e}</span>`
    ).join('');

    const categoryOptions = Object.entries(STATUS_CATEGORIES).map(([id, cat]) =>
        `<option value="${id}" ${id === category ? 'selected' : ''}>${cat.icon} ${cat.name}</option>`
    ).join('');

    const editorHtml = `
        <div class="status-detail-overlay" id="status-editor-overlay" onclick="closeStatusEditorModal(event)">
            <div class="status-detail-panel" onclick="event.stopPropagation()">
                <div class="detail-header" style="border-color:var(--accent-yellow)">
                    <span class="detail-icon">✎</span>
                    <span class="detail-name">編輯狀態${isCustom ? '（自訂）' : hasOverride ? '（已覆寫常駐）' : '（常駐）'}</span>
                </div>

                <div class="detail-body">
                    <div class="form-group">
                        <label>狀態名稱：</label>
                        <input type="text" id="editor-status-name" value="${escapeHtml(status.name)}">
                    </div>

                    <div class="form-group">
                        <label>圖示：</label>
                        <div class="emoji-picker">${emojiOptions}</div>
                        <input type="text" id="editor-status-icon" value="${status.icon || '📌'}" style="width:50px;text-align:center;">
                    </div>

                    <div class="form-group">
                        <label>類型：</label>
                        <select id="editor-status-type">
                            <option value="stack" ${status.type === 'stack' ? 'selected' : ''}>累積型（有數值）</option>
                            <option value="binary" ${status.type === 'binary' ? 'selected' : ''}>開關型（有/無）</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>顯示分類：</label>
                        <select id="editor-status-category">${categoryOptions}</select>
                        ${!isCustom ? '<div style="font-size:0.68rem;color:var(--text-dim);margin-top:2px;">常駐狀態的分類無法變更（以原始分類顯示）</div>' : ''}
                    </div>

                    <div class="form-group">
                        <label>簡短描述：</label>
                        <input type="text" id="editor-status-desc" value="${escapeHtml(status.desc || '')}">
                    </div>

                    <div class="form-group">
                        <label>完整說明：</label>
                        <textarea id="editor-status-fullDesc">${escapeHtml(status.fullDesc || '')}</textarea>
                    </div>
                </div>

                <div class="detail-footer">
                    ${hasOverride ? `<button onclick="revertStatusOverride('${statusId}')" class="modal-btn" style="background:var(--accent-red);margin-right:auto;">還原預設</button>` : ''}
                    <button onclick="closeStatusEditorModal()" class="modal-btn">取消</button>
                    <button onclick="saveStatusEdit('${statusId}')" class="modal-btn" style="background:var(--accent-green);">✓ 儲存</button>
                </div>
            </div>
        </div>
    `;

    const modal = document.getElementById('status-modal');
    const host = modal || document.getElementById('modals-container') || document.body;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = editorHtml;
    host.appendChild(wrapper.firstElementChild);
}

function closeStatusEditorModal(event) {
    if (event && event.target.id !== 'status-editor-overlay') return;
    const overlay = document.getElementById('status-editor-overlay');
    if (overlay) overlay.remove();
}

function selectEditorEmoji(emoji) {
    const input = document.getElementById('editor-status-icon');
    if (input) input.value = emoji;
    document.querySelectorAll('#status-editor-overlay .emoji-option').forEach(el => {
        el.classList.toggle('selected', el.textContent === emoji);
    });
}

/**
 * 儲存狀態編輯
 * @param {string} statusId - 狀態 ID
 */
function saveStatusEdit(statusId) {
    const original = getStatusById(statusId);
    if (!original) return;

    const name = document.getElementById('editor-status-name')?.value.trim();
    if (!name) {
        showToast('請輸入狀態名稱');
        return;
    }

    const edited = {
        id: statusId,
        name,
        icon: document.getElementById('editor-status-icon')?.value || '📌',
        type: document.getElementById('editor-status-type')?.value || 'binary',
        desc: document.getElementById('editor-status-desc')?.value.trim() || '',
        fullDesc: document.getElementById('editor-status-fullDesc')?.value.trim() || ''
    };

    if (original.isCustom) {
        // 自訂狀態：直接更新（含分類）
        const updated = {
            ...original,
            ...edited,
            category: document.getElementById('editor-status-category')?.value || original.category || 'custom',
            isCustom: true
        };
        if (typeof updateCustomStatusInRoom === 'function') {
            updateCustomStatusInRoom(updated);
        }
    } else {
        // 常駐狀態：以覆寫儲存（保留原始 keyResist/canCounter/effects 等欄位）
        if (typeof setStatusOverrideInRoom === 'function') {
            setStatusOverrideInRoom(edited);
        }
    }

    showToast(`已儲存狀態：${name}`);
    closeStatusEditorModal();
    refreshStatusLibraryViews();
}

/**
 * 還原常駐狀態為預設定義
 * @param {string} statusId - 狀態 ID
 */
function revertStatusOverride(statusId) {
    if (typeof removeStatusOverrideFromRoom === 'function') {
        removeStatusOverrideFromRoom(statusId);
    }
    showToast('已還原預設狀態');
    closeStatusEditorModal();
    refreshStatusLibraryViews();
}

/**
 * 刷新狀態庫相關畫面（網格、分類數量、單位列表）
 */
function refreshStatusLibraryViews() {
    const grid = document.getElementById('status-grid');
    if (grid) grid.innerHTML = renderStatusGrid(currentStatusCategory);
    const tabs = document.getElementById('status-category-tabs');
    if (tabs) tabs.innerHTML = renderCategoryTabs();
    renderUnitsList();
    renderSidebarUnits();
}

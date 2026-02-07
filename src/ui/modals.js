/**
 * Limbus Command - Modal 模組
 * 處理所有彈出視窗
 */

// ===== Modal 初始化 =====
/**
 * 初始化所有 Modal
 */
function initModals() {
    const container = document.getElementById('modals-container');
    if (!container) return;

    container.innerHTML = `
        <!-- Add Unit Modal -->
        <div class="modal-overlay" id="modal-add-unit">
            <div class="modal">
                <div class="modal-header">
                    <span>新增單位</span>
                    <button onclick="closeModal('modal-add-unit')">×</button>
                </div>
                <div class="modal-body">
                    <!-- 模板選擇區 -->
                    <div style="display:flex;gap:8px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border);">
                        <select id="template-select" onchange="loadUnitTemplate(this.value)" style="flex:1;">
                            <option value="">-- 載入模板 --</option>
                        </select>
                        <button class="modal-btn" onclick="deleteSelectedTemplate()" style="background:var(--bg-input);padding:8px 12px;" title="刪除選中的模板">🗑️</button>
                    </div>

                    <!-- 頭像預覽區 -->
                    <div id="template-avatar-preview" style="display:none;text-align:center;margin-bottom:12px;">
                        <div style="width:64px;height:64px;border-radius:50%;margin:0 auto;background-size:cover;background-position:center;border:2px solid var(--border);" id="template-avatar-img"></div>
                        <button onclick="clearTemplateAvatar()" style="margin-top:6px;font-size:0.75rem;background:none;border:none;color:var(--accent-red);cursor:pointer;">清除頭像</button>
                    </div>

                    <input type="text" id="add-name" placeholder="名稱">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <input type="number" id="add-hp" value="10" placeholder="HP">
                        <select id="add-type">
                            <option value="enemy">敵方</option>
                            <option value="player">我方</option>
                            <option value="boss">BOSS (首領)</option>
                        </select>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
                        <div class="calc-field">
                            <span class="calc-label">單位大小</span>
                            <select id="add-size">
                                <option value="1">1x1 (普通)</option>
                                <option value="2">2x2 (大型)</option>
                                <option value="3">3x3 (巨型)</option>
                            </select>
                        </div>
                        <div class="calc-field" style="display:flex;align-items:flex-end;">
                            <label><input type="checkbox" id="add-avatar"> 上傳頭像</label>
                        </div>
                    </div>

                    <!-- 隱藏欄位：儲存模板頭像 -->
                    <input type="hidden" id="add-template-avatar" value="">
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-add-unit')" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="saveAsUnitTemplate()" style="background:var(--accent-purple);color:#fff;">💾 存為模板</button>
                    <button class="modal-btn" onclick="confirmAddUnit()" style="background:var(--accent-green);color:#000;">確認</button>
                </div>
            </div>
        </div>

        <!-- Batch Modal -->
        <div class="modal-overlay" id="modal-batch">
            <div class="modal">
                <div class="modal-header">
                    <span>批量新增</span>
                    <button onclick="closeModal('modal-batch')">×</button>
                </div>
                <div class="modal-body">
                    <input type="text" id="batch-prefix" placeholder="前綴 (例: 雜兵)">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div class="calc-field">
                            <span class="calc-label">起始編號</span>
                            <input type="number" id="batch-start" value="1">
                        </div>
                        <div class="calc-field">
                            <span class="calc-label">數量</span>
                            <input type="number" id="batch-count" value="5">
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div class="calc-field">
                            <span class="calc-label">HP</span>
                            <input type="number" id="batch-hp" value="10">
                        </div>
                        <div class="calc-field">
                            <span class="calc-label">類型</span>
                            <select id="batch-type">
                                <option value="enemy">敵方</option>
                                <option value="player">我方</option>
                                <option value="boss">BOSS (首領)</option>
                            </select>
                        </div>
                    </div>
                    <div class="calc-field" style="margin-top:10px;">
                        <span class="calc-label">單位大小</span>
                        <select id="batch-size" style="width:100%;">
                            <option value="1">1x1 (普通)</option>
                            <option value="2">2x2 (大型)</option>
                            <option value="3">3x3 (巨型)</option>
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-batch')" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="confirmBatchAdd()" style="background:var(--accent-green);color:#000;">確認</button>
                </div>
            </div>
        </div>

        <!-- HP Modify Modal -->
        <div class="modal-overlay" id="modal-hp">
            <div class="modal">
                <div class="modal-header">
                    <span id="hp-modal-title">修改 HP</span>
                    <button onclick="closeModal('modal-hp')">×</button>
                </div>
                <div class="modal-body">
                    <div id="hp-modal-mode-damage" style="display:none;">
                        <div style="margin-bottom:10px;color:var(--text-dim);">選擇傷害類型：</div>
                        <div style="display:flex;gap:8px;margin-bottom:15px;">
                            <button class="action-btn dmg-b" style="flex:1;padding:12px;" onclick="setHpModalType('b', this)">B 傷 (鈍擊)</button>
                            <button class="action-btn dmg-l" style="flex:1;padding:12px;" onclick="setHpModalType('l', this)">L 傷 (穿刺)</button>
                            <button class="action-btn dmg-a" style="flex:1;padding:12px;" onclick="setHpModalType('a', this)">A 傷 (惡化)</button>
                        </div>
                    </div>
                    <div id="hp-modal-mode-heal" style="display:none;">
                        <div style="margin-bottom:10px;color:var(--text-dim);">選擇要治療的傷勢類型：</div>
                        <div style="display:flex;gap:8px;margin-bottom:15px;">
                            <button class="action-btn dmg-b" style="flex:1;padding:12px;" onclick="setHpModalType('heal-b', this)">治療 B 傷</button>
                            <button class="action-btn dmg-l" style="flex:1;padding:12px;" onclick="setHpModalType('heal-l', this)">治療 L 傷</button>
                            <button class="action-btn dmg-a" style="flex:1;padding:12px;" onclick="setHpModalType('heal-a', this)">治療 A 傷</button>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span class="calc-label" style="white-space:nowrap;">數量：</span>
                        <input type="number" id="hp-amount" value="1" min="1" style="flex:1;text-align:center;font-size:1.2rem;">
                    </div>
                    <input type="hidden" id="hp-target-id">
                    <input type="hidden" id="hp-action-type" value="b">
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-hp')" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="confirmHpModify()" style="background:var(--accent-green);color:#000;">確認</button>
                </div>
            </div>
        </div>

        <!-- Modify Max HP Modal -->
        <div class="modal-overlay" id="modal-max-hp">
            <div class="modal">
                <div class="modal-header">
                    <span id="max-hp-modal-title">修改生命上限</span>
                    <button onclick="closeModal('modal-max-hp')">×</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom:10px;color:var(--text-dim);font-size:0.9rem;">
                        設定新的生命上限（HP 上限）。<br>
                        <span style="color:var(--accent-orange);font-size:0.8rem;">增加上限會新增完好的 HP 格；減少上限會從末尾移除。</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span class="calc-label" style="white-space:nowrap;">新的 HP 上限：</span>
                        <input type="number" id="max-hp-value" value="10" min="1" style="flex:1;text-align:center;font-size:1.2rem;">
                    </div>
                    <input type="hidden" id="max-hp-target-id">
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-max-hp')" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="confirmMaxHpModify()" style="background:var(--accent-green);color:#000;">確認</button>
                </div>
            </div>
        </div>

        <!-- 狀態 Modal 已移至 status-manager.js 動態生成 -->

        <!-- Assign Owner Modal (分配權限) -->
        <div class="modal-overlay" id="modal-assign-owner">
            <div class="modal">
                <div class="modal-header">
                    <span id="assign-modal-title">分配棋子給...</span>
                    <button onclick="closeModal('modal-assign-owner')">×</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom:10px;color:var(--text-dim);font-size:0.9rem;">選擇要將此棋子分配給的玩家：</div>
                    <div id="assign-player-list" style="max-height:300px;overflow-y:auto;"></div>
                    <input type="hidden" id="assign-target-unit-id">
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-assign-owner')" style="background:var(--bg-card);">取消</button>
                </div>
            </div>
        </div>
    `;
}

// ===== Modal 控制 =====
/**
 * 開啟 Modal
 * @param {string} id - Modal ID
 */
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('show');
}

/**
 * 關閉 Modal
 * @param {string} id - Modal ID
 */
function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('show');
}

/**
 * 開啟新增單位 Modal
 */
function openAddUnitModal() {
    // 刷新模板下拉選單
    refreshTemplateSelect();

    // 重置表單
    document.getElementById('add-name').value = '';
    document.getElementById('add-hp').value = '10';
    document.getElementById('add-type').value = 'enemy';
    document.getElementById('add-size').value = '1';
    document.getElementById('add-avatar').checked = false;
    document.getElementById('add-template-avatar').value = '';
    document.getElementById('template-select').value = '';

    // 隱藏頭像預覽
    const preview = document.getElementById('template-avatar-preview');
    if (preview) preview.style.display = 'none';

    openModal('modal-add-unit');
}

/**
 * 刷新模板下拉選單
 */
function refreshTemplateSelect() {
    const select = document.getElementById('template-select');
    if (!select) return;

    const templates = typeof getUnitTemplates === 'function' ? getUnitTemplates() : [];

    // 重建選項
    select.innerHTML = '<option value="">-- 載入模板 --</option>';
    templates.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.name} (HP:${t.hp}, ${t.type === 'boss' ? 'BOSS' : t.type === 'enemy' ? '敵方' : '我方'})`;
        select.appendChild(opt);
    });
}

/**
 * 載入單位模板
 * @param {string} templateId - 模板 ID
 */
function loadUnitTemplate(templateId) {
    if (!templateId) {
        // 選擇了空選項，重置頭像預覽
        document.getElementById('add-template-avatar').value = '';
        document.getElementById('template-avatar-preview').style.display = 'none';
        return;
    }

    const templates = typeof getUnitTemplates === 'function' ? getUnitTemplates() : [];
    const template = templates.find(t => t.id === templateId);

    if (!template) {
        showToast('找不到該模板');
        return;
    }

    // 填入表單
    document.getElementById('add-name').value = template.name || '';
    document.getElementById('add-hp').value = template.hp || 10;
    document.getElementById('add-type').value = template.type || 'enemy';
    document.getElementById('add-size').value = template.size || 1;

    // 處理頭像
    if (template.avatar) {
        document.getElementById('add-template-avatar').value = template.avatar;
        document.getElementById('add-avatar').checked = false;  // 不需要另外上傳
        // 顯示頭像預覽
        const preview = document.getElementById('template-avatar-preview');
        const img = document.getElementById('template-avatar-img');
        if (preview && img) {
            img.style.backgroundImage = `url(${template.avatar})`;
            preview.style.display = 'block';
        }
    } else {
        document.getElementById('add-template-avatar').value = '';
        document.getElementById('template-avatar-preview').style.display = 'none';
    }

    showToast(`已載入模板：${template.name}`);
}

/**
 * 存為單位模板
 */
function saveAsUnitTemplate() {
    const name = document.getElementById('add-name').value;
    if (!name || name.trim() === '') {
        showToast('請先輸入單位名稱');
        return;
    }

    const hp = parseInt(document.getElementById('add-hp').value) || 10;
    const type = document.getElementById('add-type').value;
    const size = parseInt(document.getElementById('add-size').value) || 1;
    const avatar = document.getElementById('add-template-avatar').value || null;

    if (typeof saveUnitTemplate !== 'function') {
        showToast('模板功能不可用');
        return;
    }

    const saved = saveUnitTemplate({
        name: name.trim(),
        hp: hp,
        type: type,
        size: size,
        avatar: avatar
    });

    if (saved) {
        showToast(`已儲存模板：${saved.name}`);
        refreshTemplateSelect();
        // 選中剛儲存的模板
        document.getElementById('template-select').value = saved.id;
    } else {
        showToast('儲存模板失敗');
    }
}

/**
 * 刪除選中的模板
 */
function deleteSelectedTemplate() {
    const select = document.getElementById('template-select');
    const templateId = select ? select.value : '';

    if (!templateId) {
        showToast('請先選擇要刪除的模板');
        return;
    }

    const templates = typeof getUnitTemplates === 'function' ? getUnitTemplates() : [];
    const template = templates.find(t => t.id === templateId);

    if (!template) {
        showToast('找不到該模板');
        return;
    }

    if (!confirm(`確定要刪除模板「${template.name}」嗎？`)) {
        return;
    }

    if (typeof deleteUnitTemplate === 'function' && deleteUnitTemplate(templateId)) {
        showToast(`已刪除模板：${template.name}`);
        refreshTemplateSelect();
        // 清空頭像預覽
        document.getElementById('add-template-avatar').value = '';
        document.getElementById('template-avatar-preview').style.display = 'none';
    } else {
        showToast('刪除模板失敗');
    }
}

/**
 * 清除模板頭像
 */
function clearTemplateAvatar() {
    document.getElementById('add-template-avatar').value = '';
    document.getElementById('template-avatar-preview').style.display = 'none';
}

/**
 * 開啟批量新增 Modal
 */
function openBatchModal() {
    openModal('modal-batch');
}

// ===== 新增單位 =====
/**
 * 確認新增單位
 */
function confirmAddUnit() {
    const name = document.getElementById('add-name').value || 'Unit';
    const hp = parseInt(document.getElementById('add-hp').value) || 10;
    const type = document.getElementById('add-type').value;
    const size = parseInt(document.getElementById('add-size').value) || 1;
    const useAvatar = document.getElementById('add-avatar').checked;
    const templateAvatar = document.getElementById('add-template-avatar').value || '';

    if (myRole === 'st') {
        const u = createUnit(name, hp, type, myPlayerId, myName, size);

        // 優先使用模板頭像，否則觸發上傳
        if (templateAvatar) {
            u.avatar = templateAvatar;
        } else if (useAvatar) {
            uploadTargetId = u.id;
            document.getElementById('file-upload').click();
        }

        state.units.push(u);
        closeModal('modal-add-unit');
        sendState();
        renderAll();
    } else {
        sendToHost({
            type: 'addUnit',
            playerId: myPlayerId,
            name: name,
            hp: hp,
            unitType: type,
            playerName: myName,
            size: size,
            avatar: templateAvatar || null  // 傳送模板頭像給 ST
        });
        closeModal('modal-add-unit');
        showToast('已請求新增單位');
    }
}

/**
 * 確認批量新增
 */
function confirmBatchAdd() {
    if (myRole !== 'st') {
        showToast('只有 ST 可以批量新增');
        return;
    }

    const prefix = document.getElementById('batch-prefix').value || 'Unit';
    const start = parseInt(document.getElementById('batch-start').value) || 1;
    const count = parseInt(document.getElementById('batch-count').value) || 5;
    const hp = parseInt(document.getElementById('batch-hp').value) || 10;
    const type = document.getElementById('batch-type').value;
    const size = parseInt(document.getElementById('batch-size').value) || 1;

    for (let i = 0; i < count; i++) {
        state.units.push(createUnit(`${prefix}${start + i}`, hp, type, myPlayerId, myName, size));
    }

    closeModal('modal-batch');
    sendState();
    renderAll();
}

// ===== HP 修改 Modal =====
/**
 * 開啟 HP 修改 Modal
 * @param {number} id - 單位 ID
 * @param {string} mode - 模式 ('damage' 或 'heal')
 */
function openHpModal(id, mode) {
    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    document.getElementById('hp-target-id').value = id;
    document.getElementById('hp-amount').value = 1;
    document.getElementById('hp-action-type').value = mode === 'heal' ? 'heal-b' : 'b';

    document.getElementById('hp-modal-title').innerText = mode === 'heal' ? `治療：${u.name}` : `傷害：${u.name}`;
    document.getElementById('hp-modal-mode-damage').style.display = mode === 'damage' ? 'block' : 'none';
    document.getElementById('hp-modal-mode-heal').style.display = mode === 'heal' ? 'block' : 'none';

    // 重置按鈕高亮
    document.querySelectorAll('#modal-hp .action-btn').forEach(btn => {
        btn.style.boxShadow = '';
    });
    
    // 高亮第一個選項
    const firstBtn = document.querySelector(mode === 'heal' ? '#hp-modal-mode-heal .action-btn' : '#hp-modal-mode-damage .action-btn');
    if (firstBtn) firstBtn.style.boxShadow = '0 0 0 2px var(--accent-yellow)';

    openModal('modal-hp');
}

/**
 * 設定 HP Modal 類型
 * @param {string} type - 類型
 * @param {HTMLElement} btnElement - 被點擊的按鈕元素
 */
function setHpModalType(type, btnElement) {
    document.getElementById('hp-action-type').value = type;

    // 更新按鈕高亮
    document.querySelectorAll('#modal-hp .action-btn').forEach(btn => {
        btn.style.boxShadow = '';
    });
    if (btnElement) {
        btnElement.style.boxShadow = '0 0 0 2px var(--accent-yellow)';
    }
}

/**
 * 確認 HP 修改
 */
function confirmHpModify() {
    const id = document.getElementById('hp-target-id').value;  // 直接获取字符串 ID
    const amount = parseInt(document.getElementById('hp-amount').value) || 1;
    const type = document.getElementById('hp-action-type').value;

    modifyHP(id, type, amount);
    closeModal('modal-hp');
}

// ===== 狀態 Modal =====
// 注意：狀態管理功能已移至 status-manager.js
// openStatusModal, selectStatus, addStatusToUnit 等函數在該檔案中定義

// ===== 分配權限 Modal =====
/**
 * 開啟分配權限 Modal
 * @param {string} unitId - 要分配的單位 ID
 */
function openAssignOwnerModal(unitId) {
    // 只有 ST 可以分配權限
    if (myRole !== 'st') {
        showToast('只有 ST 可以分配棋子權限');
        return;
    }

    const u = findUnitById(unitId);
    if (!u) {
        showToast('找不到該單位');
        return;
    }

    // 設定目標單位 ID
    document.getElementById('assign-target-unit-id').value = unitId;
    document.getElementById('assign-modal-title').innerText = `分配「${u.name}」給...`;

    // 取得玩家列表
    const playerList = document.getElementById('assign-player-list');

    // 使用 getAllUsers() 取得所有使用者（如果函數存在）
    let users = [];
    if (typeof getAllUsers === 'function') {
        users = getAllUsers();
    } else if (typeof roomUsers !== 'undefined') {
        // 回退方案：直接從 roomUsers 取得
        for (const [userId, userData] of Object.entries(roomUsers)) {
            users.push({
                id: userId,
                name: userData.name || '未知',
                role: userData.role || 'player',
                online: userData.online || false
            });
        }
    }

    // 如果沒有玩家，顯示提示
    if (users.length === 0) {
        playerList.innerHTML = `
            <div style="text-align:center;color:var(--text-dim);padding:20px;">
                目前沒有其他玩家在房間內
            </div>
        `;
        openModal('modal-assign-owner');
        return;
    }

    // 渲染玩家列表
    playerList.innerHTML = users.map(user => {
        const isCurrentOwner = u.ownerId === user.id;
        const isST = user.role === 'st';
        const statusDot = user.online ? '🟢' : '⚪';
        const roleTag = isST ? '<span style="color:var(--accent-yellow);font-size:0.75rem;">[ST]</span>' : '';
        const ownerTag = isCurrentOwner ? '<span style="color:var(--accent-green);font-size:0.75rem;margin-left:4px;">(目前擁有者)</span>' : '';

        return `
            <div class="assign-player-item" style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                padding:12px;
                margin-bottom:8px;
                background:var(--bg-input);
                border:1px solid ${isCurrentOwner ? 'var(--accent-green)' : 'var(--border)'};
                border-radius:8px;
                cursor:pointer;
                transition:all 0.2s;
            " onclick="assignOwner('${unitId}', '${user.id}', '${escapeHtml(user.name)}')"
            onmouseover="this.style.borderColor='var(--accent-yellow)'"
            onmouseout="this.style.borderColor='${isCurrentOwner ? 'var(--accent-green)' : 'var(--border)'}'">
                <div>
                    <span style="margin-right:6px;">${statusDot}</span>
                    <span style="font-weight:600;">${escapeHtml(user.name)}</span>
                    ${roleTag}
                    ${ownerTag}
                </div>
                <div style="color:var(--text-dim);font-size:0.8rem;">
                    ${user.id.substring(0, 12)}...
                </div>
            </div>
        `;
    }).join('');

    openModal('modal-assign-owner');
}

/**
 * 分配單位給指定玩家
 * @param {string} unitId - 單位 ID
 * @param {string} newOwnerId - 新擁有者 ID
 * @param {string} newOwnerName - 新擁有者名稱
 */
function assignOwner(unitId, newOwnerId, newOwnerName) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以分配權限');
        return;
    }

    const u = findUnitById(unitId);
    if (!u) {
        showToast('找不到該單位');
        return;
    }

    // 更新本地狀態
    u.ownerId = newOwnerId;
    u.ownerName = newOwnerName;

    // 同步到 Firebase
    if (roomRef) {
        roomRef.child(`units/${unitId}/ownerId`).set(newOwnerId);
        roomRef.child(`units/${unitId}/ownerName`).set(newOwnerName);
    }

    // 關閉 Modal 並顯示提示
    closeModal('modal-assign-owner');
    showToast(`已將「${u.name}」分配給 ${newOwnerName}`);

    // 重新渲染
    renderAll();
}

// ===== 地形編輯器 Modal =====

/**
 * 開啟地形編輯器 Modal
 * @param {number|null} existingTileId - 若提供則為編輯模式
 */
function openTileEditorModal(existingTileId = null) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以編輯地形');
        return;
    }

    const isEdit = existingTileId !== null;
    let tile = null;
    if (isEdit) {
        tile = (typeof getTileFromPalette === 'function')
            ? getTileFromPalette(existingTileId)
            : (state.mapPalette || []).find(t => t.id === existingTileId);
    }

    // 預設值
    const tileName = tile ? tile.name : '';
    const tileColor = tile ? tile.color : '#666666';
    // 將 rgba/named colors 轉為 hex 以供 color picker
    const colorHex = colorToHex(tileColor);
    const tileEffect = tile ? tile.effect : '';

    // 建立「從預設庫匯入」選項列表
    let presetOptions = '';
    MAP_PRESETS.forEach((preset, pi) => {
        preset.tiles.forEach(t => {
            presetOptions += `<option value="${pi}_${t.id}">${preset.name} - ${t.name}</option>`;
        });
    });

    const modalHtml = `
        <div class="modal-overlay show" id="tile-editor-modal" onclick="closeTileEditorOnOverlay(event)">
            <div class="modal tile-editor-modal" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <span style="font-weight:bold;">🎨 ${isEdit ? '編輯地形' : '新增地形'}</span>
                    <button onclick="closeTileEditorModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <!-- 從預設庫匯入 -->
                    <div class="tile-import-section">
                        <label class="tile-editor-label">從預設庫匯入</label>
                        <div style="display:flex;gap:6px;">
                            <select id="tile-import-select" class="tile-editor-select">
                                <option value="">-- 選擇預設地形 --</option>
                                ${presetOptions}
                            </select>
                            <button onclick="importPresetTile()" class="modal-btn" style="background:var(--accent-blue);white-space:nowrap;padding:8px 12px;">匯入</button>
                        </div>
                    </div>

                    <div class="tile-editor-divider"></div>

                    <!-- 自訂表單 -->
                    <div class="tile-editor-form">
                        <div class="form-group">
                            <label class="tile-editor-label">地形名稱</label>
                            <input type="text" id="tile-edit-name" value="${escapeHtml(tileName)}" placeholder="例如：熔岩地帶" maxlength="20">
                        </div>

                        <div class="form-group">
                            <label class="tile-editor-label">顏色</label>
                            <div class="tile-color-row">
                                <input type="color" id="tile-edit-color" value="${colorHex}" class="tile-color-picker">
                                <span class="tile-color-hex" id="tile-color-hex">${colorHex}</span>
                                <div class="tile-color-preview" id="tile-color-preview" style="background:${colorHex};"></div>
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="tile-editor-label">效果描述</label>
                            <textarea id="tile-edit-effect" placeholder="例如：每回合受 2 點火焰傷害" rows="3">${escapeHtml(tileEffect)}</textarea>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    ${isEdit ? `<button onclick="deletePaletteTile(${existingTileId})" class="modal-btn" style="background:var(--accent-red);margin-right:auto;">刪除</button>` : ''}
                    <button onclick="closeTileEditorModal()" class="modal-btn" style="background:var(--bg-card);">取消</button>
                    <button onclick="saveTileFromEditor(${isEdit ? existingTileId : 'null'})" class="modal-btn" style="background:var(--accent-green);color:#000;">
                        ${isEdit ? '儲存變更' : '新增地形'}
                    </button>
                </div>
            </div>
        </div>
    `;

    const container = document.getElementById('modals-container');
    const existing = document.getElementById('tile-editor-modal');
    if (existing) existing.remove();
    container.insertAdjacentHTML('beforeend', modalHtml);

    // 顏色選取器即時預覽
    const colorInput = document.getElementById('tile-edit-color');
    if (colorInput) {
        colorInput.addEventListener('input', () => {
            const hex = colorInput.value;
            document.getElementById('tile-color-hex').textContent = hex;
            document.getElementById('tile-color-preview').style.background = hex;
        });
    }
}

/**
 * 從預設庫匯入地形到編輯表單
 */
function importPresetTile() {
    const select = document.getElementById('tile-import-select');
    if (!select || !select.value) {
        showToast('請先選擇一個預設地形');
        return;
    }

    const [presetIdx, tileId] = select.value.split('_').map(Number);
    const preset = MAP_PRESETS[presetIdx];
    if (!preset) return;

    const tile = preset.tiles.find(t => t.id === tileId);
    if (!tile) return;

    // 填入表單
    document.getElementById('tile-edit-name').value = tile.name;
    document.getElementById('tile-edit-color').value = colorToHex(tile.color);
    document.getElementById('tile-color-hex').textContent = colorToHex(tile.color);
    document.getElementById('tile-color-preview').style.background = tile.color;
    document.getElementById('tile-edit-effect').value = tile.effect;
}

/**
 * 儲存地形（新增或編輯）
 * @param {number|null} existingId - 若提供則更新現有地形
 */
function saveTileFromEditor(existingId) {
    const name = document.getElementById('tile-edit-name')?.value.trim();
    const color = document.getElementById('tile-edit-color')?.value || '#666666';
    const effect = document.getElementById('tile-edit-effect')?.value.trim() || '';

    if (!name) {
        showToast('請輸入地形名稱');
        return;
    }

    if (!state.mapPalette) state.mapPalette = [];

    if (existingId !== null) {
        // 編輯模式：更新現有地形
        const idx = state.mapPalette.findIndex(t => t.id === existingId);
        if (idx !== -1) {
            state.mapPalette[idx].name = name;
            state.mapPalette[idx].color = color;
            state.mapPalette[idx].effect = effect;
        }
        showToast(`已更新地形「${name}」`);
    } else {
        // 新增模式：生成唯一 ID
        const newId = Date.now() % 100000 + 1000;
        state.mapPalette.push({ id: newId, name, color, effect });
        showToast(`已新增地形「${name}」`);
    }

    closeTileEditorModal();
    updateToolbar();

    // 同步到 Firebase
    if (typeof syncMapPalette === 'function') syncMapPalette();
    if (myRole === 'st') sendState();

    // 重繪地圖以反映顏色變更
    renderMap();
}

/**
 * 從調色盤刪除地形
 * @param {number} tileId - 地形 ID
 */
function deletePaletteTile(tileId) {
    if (!confirm('確定要從調色盤移除此地形？\n（已繪製在地圖上的格子不會消失，但無法再使用此工具繪製）')) return;

    state.mapPalette = (state.mapPalette || []).filter(t => t.id !== tileId);

    closeTileEditorModal();
    updateToolbar();
    showToast('地形已從調色盤移除');

    if (typeof syncMapPalette === 'function') syncMapPalette();
    if (myRole === 'st') sendState();
}

/**
 * 關閉地形編輯器 Modal
 */
function closeTileEditorModal() {
    const modal = document.getElementById('tile-editor-modal');
    if (modal) modal.remove();
}

function closeTileEditorOnOverlay(event) {
    if (event.target.id === 'tile-editor-modal') closeTileEditorModal();
}

/**
 * 將 CSS 顏色轉換為 hex
 * @param {string} color - CSS 顏色值
 * @returns {string} hex 格式
 */
function colorToHex(color) {
    if (!color) return '#666666';
    // 已經是 hex
    if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;

    // 使用 canvas 轉換
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = color;
    return ctx.fillStyle; // 瀏覽器會自動轉為 hex
}

// ===== 修改生命上限 Modal =====
/**
 * 開啟修改生命上限 Modal
 * @param {string} id - 單位 ID
 */
function openMaxHpModal(id) {
    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    document.getElementById('max-hp-target-id').value = id;
    document.getElementById('max-hp-value').value = u.maxHp || 10;
    document.getElementById('max-hp-modal-title').innerText = `修改生命上限：${u.name}`;

    openModal('modal-max-hp');
}

/**
 * 確認修改生命上限
 */
function confirmMaxHpModify() {
    const id = document.getElementById('max-hp-target-id').value;
    const newMaxHp = parseInt(document.getElementById('max-hp-value').value);

    if (!newMaxHp || newMaxHp < 1) {
        showToast('HP 上限必須至少為 1');
        return;
    }

    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    if (myRole === 'st') {
        const oldMaxHp = u.maxHp || u.hpArr.length;
        if (newMaxHp > oldMaxHp) {
            // 增加上限：新增完好的 HP 格
            const diff = newMaxHp - oldMaxHp;
            for (let i = 0; i < diff; i++) {
                u.hpArr.push(0);
            }
        } else if (newMaxHp < oldMaxHp) {
            // 減少上限：從末尾移除（優先移除完好格）
            // 先排序使受傷格在前、完好格在後
            u.hpArr.sort((a, b) => b - a);
            u.hpArr = u.hpArr.slice(0, newMaxHp);
        }
        u.maxHp = newMaxHp;
        // 重新排序
        u.hpArr.sort((a, b) => b - a);

        closeModal('modal-max-hp');
        broadcastState();
        showToast(`已將「${u.name}」的生命上限修改為 ${newMaxHp}`);
    } else {
        sendToHost({
            type: 'modifyMaxHp',
            playerId: myPlayerId,
            unitId: id,
            newMaxHp: newMaxHp
        });
        closeModal('modal-max-hp');
        showToast('已請求修改生命上限');
    }
}

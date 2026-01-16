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
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-add-unit')" style="background:var(--bg-card);">取消</button>
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
    openModal('modal-add-unit');
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

    if (myRole === 'st') {
        const u = createUnit(name, hp, type, myPlayerId, myName, size);
        if (useAvatar) {
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
            size: size
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

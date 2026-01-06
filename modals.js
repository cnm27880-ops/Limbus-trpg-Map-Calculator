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
                            <button class="action-btn dmg-b" style="flex:1;padding:12px;" onclick="setHpModalType('b')">B 傷 (鈍擊)</button>
                            <button class="action-btn dmg-l" style="flex:1;padding:12px;" onclick="setHpModalType('l')">L 傷 (穿刺)</button>
                            <button class="action-btn dmg-a" style="flex:1;padding:12px;" onclick="setHpModalType('a')">A 傷 (惡化)</button>
                        </div>
                    </div>
                    <div id="hp-modal-mode-heal" style="display:none;">
                        <div style="margin-bottom:10px;color:var(--text-dim);">選擇要治療的傷勢類型：</div>
                        <div style="display:flex;gap:8px;margin-bottom:15px;">
                            <button class="action-btn dmg-b" style="flex:1;padding:12px;" onclick="setHpModalType('heal-b')">治療 B 傷</button>
                            <button class="action-btn dmg-l" style="flex:1;padding:12px;" onclick="setHpModalType('heal-l')">治療 L 傷</button>
                            <button class="action-btn dmg-a" style="flex:1;padding:12px;" onclick="setHpModalType('heal-a')">治療 A 傷</button>
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
        const u = createUnit(name, hp, type, myPeerId, myName, size);
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
        state.units.push(createUnit(`${prefix}${start + i}`, hp, type, myPeerId, myName, size));
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
 */
function setHpModalType(type) {
    document.getElementById('hp-action-type').value = type;
    
    // 更新按鈕高亮
    document.querySelectorAll('#modal-hp .action-btn').forEach(btn => {
        btn.style.boxShadow = '';
    });
    event.target.style.boxShadow = '0 0 0 2px var(--accent-yellow)';
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

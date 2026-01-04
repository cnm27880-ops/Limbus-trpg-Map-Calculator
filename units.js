/**
 * Limbus Command - 單位模組
 * 處理單位渲染、HP 修改、回合等
 */

// ===== 渲染函數 =====
/**
 * 渲染所有內容
 */
function renderAll() {
    renderMap();
    renderUnitsList();
    renderSidebarUnits();
    renderUnitsToolbar();
}

/**
 * 渲染單位工具列
 */
function renderUnitsToolbar() {
    const toolbar = document.getElementById('units-toolbar');
    if (!toolbar) return;

    if (myRole === 'st') {
        toolbar.innerHTML = `
            <button class="units-btn primary" onclick="nextTurn()">▶ 下一回合</button>
            <button class="units-btn" onclick="openAddUnitModal()">+ 新增</button>
            <button class="units-btn" onclick="openBatchModal()">📋 批量</button>
            <button class="units-btn" onclick="sortByInit()">⏱ 排序</button>
        `;
    } else {
        toolbar.innerHTML = `
            <button class="units-btn" onclick="openAddUnitModal()">+ 新增我的單位</button>
            <span style="color:var(--text-dim);font-size:0.8rem;padding:8px;">回合控制由 ST 操作</span>
        `;
    }
}

/**
 * 渲染單位列表
 */
function renderUnitsList() {
    const list = document.getElementById('units-list');
    if (!list) return;

    list.innerHTML = state.units.map((u, idx) => {
        const isTurn = idx === state.turnIdx;
        const a = u.hpArr.filter(x => x === 3).length;
        const l = u.hpArr.filter(x => x === 2).length;
        const b = u.hpArr.filter(x => x === 1).length;
        const empty = u.maxHp - a - l - b;

        const isEnemy = u.type === 'enemy';
        const isSt = myRole === 'st';
        const isMyUnit = u.ownerId === myPlayerId;
        const hideDetails = isEnemy && !isSt && !isMyUnit;

        let statusText = `${empty}完好 / ${b}B / ${l}L / ${a}A`;
        if (hideDetails) statusText = `狀態: ${getVagueStatus(u)}`;

        // 擁有者標籤
        let ownerTag = '';
        if (u.ownerName) {
            const ownerColor = isMyUnit ? 'var(--accent-green)' : 'var(--text-dim)';
            ownerTag = `<span style="font-size:0.65rem;color:${ownerColor};margin-left:6px;">[${escapeHtml(u.ownerName)}]</span>`;
        }

        // HP 條
        const bar = u.hpArr.map(h => {
            let cls = 'hp-empty';
            if (h === 1) cls = 'hp-b';
            if (h === 2) cls = 'hp-l';
            if (h === 3) cls = 'hp-a';
            return `<div class="hp-chunk ${cls}" style="width:${100 / u.maxHp}%"></div>`;
        }).join('');

        // 部署按鈕
        const deployBtn = u.x >= 0
            ? `<button class="action-btn" onclick="recallUnit(${u.id})">📍收回</button>`
            : `<button class="action-btn" onclick="startDeploy(${u.id})">📍部署</button>`;

        // 操作按鈕（只顯示給可控制的使用者）
        let actions = '';
        if (canControlUnit(u)) {
            actions = `
                <div class="unit-actions">
                    <button class="action-btn dmg-b" onclick="modifyHP(${u.id},'b',1)" title="按住Shift開啟數量輸入">+B</button>
                    <button class="action-btn dmg-l" onclick="modifyHP(${u.id},'l',1)" title="按住Shift開啟數量輸入">+L</button>
                    <button class="action-btn dmg-a" onclick="modifyHP(${u.id},'a',1)" title="按住Shift開啟數量輸入">+A</button>
                    <button class="action-btn" onclick="openHpModal(${u.id},'damage')" title="開啟傷害面板">⚔</button>
                    <button class="action-btn heal" onclick="openHpModal(${u.id},'heal')" title="開啟治療面板">治療</button>
                    ${deployBtn}
                    <button class="action-btn" onclick="deleteUnit(${u.id})">✕</button>
                </div>
            `;
        }

        const avaStyle = u.avatar ? `background-image:url(${u.avatar});color:transparent;` : '';
        const initReadonly = !canControlUnit(u) ? 'readonly' : '';
        const initInput = `<input type="number" class="unit-init" value="${u.init}" onchange="updateInit(${u.id},this.value)" ${initReadonly} style="width:50px;text-align:center;">`;

        // 使用者自己的單位有特殊邊框
        const myUnitStyle = isMyUnit ? 'border-left-width:6px;' : '';

        return `
            <div class="unit-card ${u.type} ${isTurn ? 'active-turn' : ''}" style="${myUnitStyle}">
                <div class="unit-header">
                    <div class="unit-avatar ${u.type}" style="${avaStyle}" onclick="uploadAvatar(${u.id})">${u.avatar ? '' : u.name[0]}</div>
                    <div style="flex:1;">
                        <div style="font-weight:600;">${escapeHtml(u.name)}${ownerTag}</div>
                        <div style="font-size:0.75rem;color:var(--text-dim);">${statusText}</div>
                    </div>
                    ${initInput}
                </div>
                <div class="hp-bar-wrap">${bar}</div>
                ${actions}
            </div>
        `;
    }).join('');
}

/**
 * 渲染側邊欄單位列表
 */
function renderSidebarUnits() {
    const c = document.getElementById('sidebar-units');
    if (!c) return;
    
    if (state.units.length === 0) {
        c.innerHTML = '<div style="padding:10px;text-align:center;color:#555;">無單位</div>';
        return;
    }
    
    c.innerHTML = state.units.map((u, idx) => {
        const isTurn = idx === state.turnIdx;
        const isEnemy = u.type === 'enemy';
        const isSt = myRole === 'st';
        
        const bar = `<div class="hp-bar-wrap" style="height:6px;margin-top:4px;">` + 
            u.hpArr.map(h => {
                const cls = h === 0 ? 'hp-empty' : h === 1 ? 'hp-b' : h === 2 ? 'hp-l' : 'hp-a';
                return `<div class="hp-chunk ${cls}" style="width:${100 / u.maxHp}%"></div>`;
            }).join('') + 
            `</div>`;

        let statusTxt = isEnemy && !isSt 
            ? getVagueStatus(u) 
            : `${u.hpArr.filter(x => x === 3).length}A ${u.hpArr.filter(x => x === 2).length}L`;

        return `
            <div class="unit-card ${u.type} ${isTurn ? 'active-turn' : ''}" style="padding:8px;margin-bottom:6px;">
                <div style="display:flex;justify-content:space-between;">
                    <span style="font-weight:bold;font-size:0.9rem;">${escapeHtml(u.name)}</span>
                    <span style="color:var(--accent-yellow);font-family:'JetBrains Mono';">${u.init}</span>
                </div>
                <div style="font-size:0.75rem;color:#777;">${statusTxt}</div>
                ${bar}
            </div>
        `;
    }).join('');
}

// ===== 單位操作 =====
/**
 * 修改單位 HP
 * @param {number} id - 單位 ID
 * @param {string} type - 傷害類型
 * @param {number} amount - 數量
 */
function modifyHP(id, type, amount) {
    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    if (myRole === 'st') {
        modifyHPInternal(u, type, amount);
        broadcastState();
    } else {
        sendToHost({
            type: 'modifyHP',
            playerId: myPlayerId,
            unitId: id,
            dmgType: type,
            amount: amount
        });
    }
}

/**
 * 刪除單位
 * @param {number} id - 單位 ID
 */
function deleteUnit(id) {
    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法刪除其他人的單位');
        return;
    }

    if (!confirm('刪除?')) return;

    if (myRole === 'st') {
        state.units = state.units.filter(u => u.id !== id);
        sendState();
        renderAll();
    } else {
        sendToHost({ 
            type: 'deleteUnit', 
            playerId: myPlayerId, 
            unitId: id 
        });
    }
}

/**
 * 更新先攻值
 * @param {number} id - 單位 ID
 * @param {string|number} val - 新的先攻值
 */
function updateInit(id, val) {
    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    if (myRole === 'st') {
        u.init = parseInt(val);
        sendState();
        renderAll();
    } else {
        sendToHost({
            type: 'updateInit',
            playerId: myPlayerId,
            unitId: id,
            init: parseInt(val)
        });
    }
}

/**
 * 依先攻排序
 */
function sortByInit() {
    if (myRole !== 'st') {
        showToast('只有 ST 可以排序');
        return;
    }
    state.units.sort((a, b) => b.init - a.init);
    state.turnIdx = 0;
    broadcastState();
}

/**
 * 下一回合
 */
function nextTurn() {
    if (myRole !== 'st') {
        showToast('只有 ST 可以控制回合');
        return;
    }
    if (state.units.length) {
        state.turnIdx = (state.turnIdx + 1) % state.units.length;
        broadcastState();
        
        setTimeout(() => {
            const el = document.querySelector('.unit-card.active-turn');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
}

// ===== 頭像上傳 =====
/**
 * 上傳頭像
 * @param {number} id - 單位 ID
 */
function uploadAvatar(id) {
    const u = findUnitById(id);
    if (!u) return;

    if (myRole !== 'st' && u.ownerId !== myPlayerId) {
        showToast('你只能為自己的單位上傳頭像');
        return;
    }

    uploadTargetId = id;
    document.getElementById('file-upload').click();
}

/**
 * 初始化檔案上傳處理器
 */
function initFileUpload() {
    const fileInput = document.getElementById('file-upload');
    if (!fileInput) return;

    fileInput.addEventListener('change', e => {
        if (!uploadTargetId) return;
        
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = ev => {
                const img = new Image();
                img.onload = () => {
                    const cvs = document.createElement('canvas');
                    cvs.width = 64;
                    cvs.height = 64;
                    cvs.getContext('2d').drawImage(img, 0, 0, 64, 64);
                    const avatarData = cvs.toDataURL('image/jpeg', 0.7);

                    if (myRole === 'st') {
                        const u = findUnitById(uploadTargetId);
                        if (u) {
                            u.avatar = avatarData;
                            broadcastState();
                        }
                    } else {
                        sendToHost({
                            type: 'uploadAvatar',
                            playerId: myPlayerId,
                            unitId: uploadTargetId,
                            avatar: avatarData
                        });
                    }
                    uploadTargetId = null;
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        }
        e.target.value = '';
    });
}

/**
 * Limbus Command - 單位模組
 * 處理單位渲染、HP 修改、回合等
 */

// ===== 頭像解析度設定 =====
// 根據 token 最大尺寸決定（3x3 = 150px，加上 Retina 螢幕需求）
const AVATAR_SIZE = 256;  // 從 64 提升到 256，確保 3x3 token 在高解析度螢幕也清晰
const AVATAR_QUALITY = 0.85;  // 較高品質，但仍保持合理檔案大小

// ===== 戰鬥流程控制 =====
/**
 * 切換戰鬥狀態
 */
function toggleCombat() {
    if (myRole !== 'st') {
        showToast('只有 ST 可以控制戰鬥');
        return;
    }

    if (state.isCombatActive) {
        // 結束戰鬥：重置先攻、回合、BOSS HUD
        state.isCombatActive = false;
        state.units.forEach(u => u.init = 0);
        state.turnIdx = -1;
        state.activeBossId = null;
        sendState();
        renderAll();
        showToast('戰鬥已結束，先攻已歸零');
    } else {
        // 開始戰鬥：排序並設定第一回合
        state.isCombatActive = true;
        // 直接排序，不透過 sortByInit() 避免雙重 broadcastState
        state.units.sort((a, b) => b.init - a.init);
        state.turnIdx = 0;
        sendState();
        renderAll();
        showToast('戰鬥開始！');
    }
}

/**
 * 切換 BOSS 血條顯示
 * @param {string} id - BOSS 單位 ID
 */
function toggleActiveBoss(id) {
    if (state.activeBossId === id) {
        state.activeBossId = null;
    } else {
        state.activeBossId = id;
    }
    sendState();
    renderAll();
}

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
        const combatBtn = state.isCombatActive
            ? `<button class="units-btn combat-btn-reset" onclick="toggleCombat()">🔄 重置戰鬥</button>`
            : `<button class="units-btn combat-btn-start" onclick="toggleCombat()">⚔️ 開始戰鬥</button>`;

        const turnControls = state.isCombatActive
            ? `<div class="turn-controls">
                <button class="turn-btn" onclick="prevTurn()" title="上一個">▲</button>
                <button class="turn-btn" onclick="nextTurn()" title="下一個">▼</button>
              </div>`
            : '';

        toolbar.innerHTML = `
            ${combatBtn}
            ${turnControls}
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
        const hpArr = u.hpArr || [];
        const maxHp = u.maxHp || hpArr.length || 1;
        const a = hpArr.filter(x => x === 3).length;
        const l = hpArr.filter(x => x === 2).length;
        const b = hpArr.filter(x => x === 1).length;
        const empty = maxHp - a - l - b;

        const isEnemy = u.type === 'enemy';
        const isSt = myRole === 'st';
        const isMyUnit = u.ownerId === myPlayerId;
        const hideDetails = isEnemy && !isSt && !isMyUnit;
        const isBoss = u.isBoss || u.type === 'boss';

        const canEdit = canControlUnit(u);
        const maxHpLabel = canEdit
            ? `<span class="max-hp-edit" onclick="openMaxHpModal('${u.id}')" title="點擊修改生命上限" style="cursor:pointer;text-decoration:underline dotted;color:var(--accent-yellow);margin-left:4px;">[HP:${maxHp}]</span>`
            : `<span style="margin-left:4px;color:var(--text-muted);">[HP:${maxHp}]</span>`;

        let statusText = `${empty}完好 / ${b}B / ${l}L / ${a}A`;
        if (hideDetails) statusText = `狀態: ${getVagueStatus(u)}`;

        // 擁有者標籤
        let ownerTag = '';
        if (u.ownerName) {
            const ownerColor = isMyUnit ? 'var(--accent-green)' : 'var(--text-dim)';
            ownerTag = `<span style="font-size:0.65rem;color:${ownerColor};margin-left:6px;">[${escapeHtml(u.ownerName)}]</span>`;
        }

        // HP 條
        const bar = hpArr.map(h => {
            let cls = 'hp-empty';
            if (h === 1) cls = 'hp-b';
            if (h === 2) cls = 'hp-l';
            if (h === 3) cls = 'hp-a';
            return `<div class="hp-chunk ${cls}" style="width:${100 / maxHp}%"></div>`;
        }).join('');

        // 部署按鈕
        const deployBtn = u.x >= 0
            ? `<button class="action-btn" onclick="recallUnit('${u.id}')">📍收回</button>`
            : `<button class="action-btn" onclick="startDeploy('${u.id}')">📍部署</button>`;

        // 狀態標籤
        let statusBadges = '';
        if (u.status && Object.keys(u.status).length > 0) {
            const badges = Object.entries(u.status).map(([statusName, statusValue]) => {
                // 使用新的狀態庫查詢圖示和顏色
                const statusDef = typeof getStatusByName === 'function' ? getStatusByName(statusName) : null;
                let icon, color;

                if (statusDef) {
                    icon = statusDef.icon;
                    const categoryId = typeof getStatusCategory === 'function' ? getStatusCategory(statusDef.id) : null;
                    color = categoryId && STATUS_CATEGORIES ? (STATUS_CATEGORIES[categoryId]?.color || '#9e9e9e') : '#9e9e9e';
                } else {
                    // 回退到舊的 STATUS_PRESETS（相容自訂狀態）
                    const config = (typeof STATUS_PRESETS !== 'undefined' && STATUS_PRESETS[statusName])
                        ? STATUS_PRESETS[statusName]
                        : { icon: '🔸', color: '#9e9e9e' };
                    icon = config.icon;
                    color = config.color;
                }

                const escapedName = escapeHtml(statusName);
                const displayValue = statusValue ? ` ${escapeHtml(statusValue)}` : '';
                return `<span class="status-badge"
                             data-tooltip="${escapedName}"
                             style="--badge-color: ${color}"
                             onclick="onStatusTagClick('${u.id}', '${escapedName}')">
                    ${icon}${displayValue}
                </span>`;
            }).join('');

            // 顯示 [+] 按鈕（只給可控制的使用者）
            const addBtn = canControlUnit(u)
                ? `<span class="status-badge status-add" onclick="openStatusModal('${u.id}')">+</span>`
                : '';

            statusBadges = `<div class="status-container">${badges}${addBtn}</div>`;
        } else if (canControlUnit(u)) {
            // 沒有狀態但可控制：只顯示 [+] 按鈕
            statusBadges = `<div class="status-container"><span class="status-badge status-add" onclick="openStatusModal('${u.id}')">+</span></div>`;
        }

        // 操作按鈕（只顯示給可控制的使用者）
        let actions = '';
        if (canControlUnit(u)) {
            // ST 專屬的分配權限按鈕
            const assignBtn = isSt ? `<button class="action-btn" onclick="openAssignOwnerModal('${u.id}')" title="分配給其他玩家">👮</button>` : '';

            // BOSS 血條切換按鈕
            const bossToggleBtn = isBoss
                ? `<button class="action-btn boss-toggle${state.activeBossId === u.id ? ' active' : ''}" onclick="toggleActiveBoss('${u.id}')" title="顯示/隱藏 BOSS 血條">👑</button>`
                : '';

            actions = `
                <div class="unit-actions">
                    <button class="action-btn dmg-b" onclick="modifyHP('${u.id}','b',1)" title="按住Shift開啟數量輸入">+B</button>
                    <button class="action-btn dmg-l" onclick="modifyHP('${u.id}','l',1)" title="按住Shift開啟數量輸入">+L</button>
                    <button class="action-btn dmg-a" onclick="modifyHP('${u.id}','a',1)" title="按住Shift開啟數量輸入">+A</button>
                    <button class="action-btn" onclick="openHpModal('${u.id}','damage')" title="開啟傷害面板">⚔</button>
                    <button class="action-btn heal" onclick="openHpModal('${u.id}','heal')" title="開啟治療面板">治療</button>
                    <button class="action-btn heal" onclick="resetUnitHp('${u.id}')" title="清除所有傷害，重置血條">♻</button>
                    ${deployBtn}
                    ${bossToggleBtn}
                    ${assignBtn}
                    <button class="action-btn" onclick="deleteUnit('${u.id}')">✕</button>
                </div>
            `;
        }

        const avaStyle = u.avatar ? `background-image:url(${u.avatar});color:transparent;` : '';
        const initReadonly = !canControlUnit(u) ? 'readonly' : '';
        // 移除 inline style，使用 CSS 設定的樣式（width: 70px, height: 36px, font-size: 1.1rem）
        const initInput = `<input type="number" class="unit-init" value="${u.init || 0}" onchange="updateInit('${u.id}',this.value)" ${initReadonly}>`;
        const unitInitial = (u.name && u.name.length > 0) ? u.name[0] : '?';

        // 使用者自己的單位有特殊邊框
        const myUnitStyle = isMyUnit ? 'border-left-width:6px;' : '';
        
        // 單位卡片類別
        const cardClasses = [
            'unit-card',
            u.type,
            isTurn ? 'active-turn' : '',
            isBoss ? 'boss' : ''
        ].filter(Boolean).join(' ');
        
        // 頭像類別
        const avatarClasses = [
            'unit-avatar',
            u.type,
            isBoss ? 'boss' : ''
        ].filter(Boolean).join(' ');

        return `
            <div class="${cardClasses}" style="${myUnitStyle}">
                <div class="unit-header">
                    <div class="${avatarClasses}" style="${avaStyle}" onclick="uploadAvatar('${u.id}')">${u.avatar ? '' : unitInitial}</div>
                    <div style="flex:1;">
                        <div style="font-weight:600;">${escapeHtml(u.name)}${ownerTag}</div>
                        <div style="font-size:0.75rem;color:var(--text-dim);">${statusText}${hideDetails ? '' : maxHpLabel}</div>
                    </div>
                    ${initInput}
                </div>
                <div class="hp-bar-wrap">${bar}</div>
                ${statusBadges}
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
        const isBoss = u.isBoss || u.type === 'boss';
        const hpArr = u.hpArr || [];
        const maxHp = u.maxHp || hpArr.length || 1;
        const currentHp = maxHp - hpArr.filter(x => x > 0).length;

        // 簡潔的傷害狀態文字（帶顏色標記）
        const aCount = hpArr.filter(x => x === 3).length;
        const lCount = hpArr.filter(x => x === 2).length;
        const bCount = hpArr.filter(x => x === 1).length;
        let statusTxt = isEnemy && !isSt
            ? getVagueStatus(u)
            : `<span class="dmg-b">${bCount}B</span> <span class="dmg-l">${lCount}L</span> <span class="dmg-a">${aCount}A</span>`;

        const unitName = u.name || 'Unknown';

        // 單位卡片類別
        const cardClasses = [
            'unit-card',
            u.type,
            isTurn ? 'active-turn' : '',
            isBoss ? 'boss' : ''
        ].filter(Boolean).join(' ');

        // 生成戰術血條（10 格方塊）
        const segmentCount = 10;
        let tacticalSegments = '';
        for (let i = 0; i < segmentCount; i++) {
            // 計算此格對應的 hpArr 索引
            const hpIndex = Math.floor((i / segmentCount) * maxHp);
            const hpValue = hpArr[hpIndex] !== undefined ? hpArr[hpIndex] : 0;

            let segmentClass = 'hp-tactical-segment';
            if (hpValue === 0) {
                segmentClass += ' hp-healthy';  // 完好 = 綠色
            } else if (hpValue === 1) {
                segmentClass += ' hp-b';  // B傷 = 藍色
            } else if (hpValue === 2) {
                segmentClass += ' hp-l';  // L傷 = 橙色
            } else if (hpValue === 3) {
                segmentClass += ' hp-a';  // A傷 = 紅色
            }

            tacticalSegments += `<div class="${segmentClass}"></div>`;
        }

        // 三欄佈局：左名-中血-右速
        return `
            <div class="${cardClasses}">
                <div class="unit-header">
                    <div class="unit-info">
                        <div class="unit-name">${escapeHtml(unitName)}</div>
                        <div class="unit-status">${statusTxt}</div>
                    </div>
                    <div class="hp-tactical-container">${tacticalSegments}</div>
                    <div class="unit-init-box">
                        <span class="unit-init-value">${u.init || 0}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ===== 單位操作 =====
/**
 * 重置單位血量（清除所有傷害）
 * @param {string} id - 單位 ID
 */
function resetUnitHp(id) {
    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    if (myRole === 'st') {
        if (u.hpArr) {
            u.hpArr = u.hpArr.map(() => 0);
        }
        broadcastState();
        showToast(`${u.name || '單位'} 血量已重置`);
    } else {
        sendToHost({
            type: 'resetUnitHp',
            playerId: myPlayerId,
            unitId: id
        });
    }
}

/**
 * 修改單位 HP
 * @param {string} id - 單位 ID
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
 * @param {string} id - 單位 ID
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
 * 更新單位狀態
 * @param {string} unitId - 單位 ID
 * @param {string} name - 狀態名稱
 * @param {string} value - 狀態數值（空字串表示刪除）
 * @param {string} oldName - 舊狀態名稱（用於重新命名或刪除）
 */
function updateStatus(unitId, name, value, oldName = null) {
    const u = findUnitById(unitId);
    if (!u) return;

    // 權限檢查
    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    if (myRole === 'st') {
        // 初始化 status 物件（如果不存在）
        if (!u.status) u.status = {};

        // 如果正在編輯現有狀態且名稱改變，刪除舊狀態
        if (oldName && oldName !== name && u.status[oldName] !== undefined) {
            delete u.status[oldName];
        }

        // 更新或刪除狀態
        if (value === '' || value === null) {
            // 刪除狀態
            delete u.status[name];
            if (oldName && oldName !== name) {
                delete u.status[oldName];
            }
            showToast('狀態已刪除');
        } else {
            // 更新或新增狀態
            u.status[name] = value;
            showToast('狀態已更新');
        }

        broadcastState();
    } else {
        // 玩家請求修改
        sendToHost({
            type: 'updateStatus',
            playerId: myPlayerId,
            unitId: unitId,
            statusName: name,
            statusValue: value,
            oldName: oldName
        });
    }
}

/**
 * 更新先攻值
 * @param {string} id - 單位 ID
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
        u.init = parseInt(val) || 0;
        sendState();
        renderAll();
    } else {
        sendToHost({
            type: 'updateInit',
            playerId: myPlayerId,
            unitId: id,
            init: parseInt(val) || 0
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
    // 記住當前回合的單位 ID，排序後恢復位置
    const currentUnit = state.units[state.turnIdx];
    const currentUnitId = currentUnit ? currentUnit.id : null;

    state.units.sort((a, b) => b.init - a.init);

    // 找回該單位的新索引
    if (currentUnitId) {
        const newIdx = state.units.findIndex(u => u.id === currentUnitId);
        state.turnIdx = newIdx >= 0 ? newIdx : 0;
    } else {
        state.turnIdx = 0;
    }
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

/**
 * 上一回合
 */
function prevTurn() {
    if (myRole !== 'st') {
        showToast('只有 ST 可以控制回合');
        return;
    }
    if (state.units.length) {
        // 處理 < 0 的循環情況
        state.turnIdx = (state.turnIdx - 1 + state.units.length) % state.units.length;
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
 * @param {string} id - 單位 ID
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
 * 處理頭像圖片，保持高品質
 * @param {HTMLImageElement} img - 原始圖片
 * @returns {string} Base64 圖片資料
 */
function processAvatarImage(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // 設定輸出尺寸
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    
    // 計算裁切區域（正方形置中裁切）
    const size = Math.min(img.width, img.height);
    const sx = (img.width - size) / 2;
    const sy = (img.height - size) / 2;
    
    // 啟用圖片平滑化
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // 繪製裁切後的圖片
    ctx.drawImage(
        img,
        sx, sy, size, size,  // 來源區域（正方形裁切）
        0, 0, AVATAR_SIZE, AVATAR_SIZE  // 目標區域
    );
    
    // 輸出為 JPEG（較小檔案）或 PNG（透明背景）
    return canvas.toDataURL('image/jpeg', AVATAR_QUALITY);
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
        if (!file) return;
        
        // 檢查檔案類型
        if (!file.type.startsWith('image/')) {
            showToast('請選擇圖片檔案');
            return;
        }
        
        // 檢查檔案大小（最大 5MB）
        if (file.size > 5 * 1024 * 1024) {
            showToast('圖片過大（最大 5MB）');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
                // 使用新的高品質處理函數
                const avatarData = processAvatarImage(img);

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
                
                showToast('頭像已上傳');
                uploadTargetId = null;
            };
            img.onerror = () => {
                showToast('圖片載入失敗');
                uploadTargetId = null;
            };
            img.src = ev.target.result;
        };
        reader.onerror = () => {
            showToast('檔案讀取失敗');
            uploadTargetId = null;
        };
        reader.readAsDataURL(file);
        
        // 清除 input 以便再次選擇相同檔案
        e.target.value = '';
    });
}

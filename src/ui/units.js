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
        broadcastState();
        showToast('戰鬥已結束，先攻已歸零');
    } else {
        // 開始戰鬥：排序並設定第一回合
        state.isCombatActive = true;
        // 直接排序，不透過 sortByInit() 避免雙重 broadcastState
        state.units.sort((a, b) => b.init - a.init);
        state.turnIdx = 0;
        // 戰鬥開始時所有自動護盾回滿
        state.units.forEach(u => {
            if ((u.shieldAutoMax || 0) > 0) u.shieldAuto = u.shieldAutoMax;
        });
        broadcastState();
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
    broadcastState();
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
        // 隱形棋子：非 ST 玩家完全看不到
        if (myRole !== 'st' && u.hidden === true) return '';

        // 多重行動條目：精簡列（無血條/狀態，只有先攻），實體是本體 BOSS
        if (u.actionSlotOf) {
            const isStView = myRole === 'st';
            const parent = findUnitById(u.actionSlotOf);
            const label = parent ? `${parent.name}・行動${u.slotIndex || ''}` : (u.name || '行動');
            const slotClasses = ['unit-card', 'action-slot', u.type, isTurn ? 'active-turn' : ''].filter(Boolean).join(' ');
            const slotInit = `<input type="number" class="unit-init" value="${u.init || 0}" onchange="updateInit('${u.id}',this.value)" ${isStView ? '' : 'readonly'}>`;
            const slotDel = isStView ? `<button class="action-btn" onclick="deleteUnit('${u.id}')" title="刪除此行動條目">✕</button>` : '';
            return `
                <div class="${slotClasses}" oncontextmenu="openUnitContextMenu(event, '${u.id}')">
                    <div class="unit-header" style="min-height:auto;">
                        <span class="slot-icon">⚔</span>
                        <div style="flex:1;font-size:0.85rem;font-weight:600;color:var(--text-dim);">${escapeHtml(label)}</div>
                        ${slotDel}
                        ${slotInit}
                    </div>
                </div>
            `;
        }

        const hpArr = u.hpArr || [];
        const maxHp = u.maxHp || hpArr.length || 1;
        const a = hpArr.filter(x => x === 3).length;
        const l = hpArr.filter(x => x === 2).length;
        const b = hpArr.filter(x => x === 1).length;
        const empty = maxHp - a - l - b;

        const isEnemy = u.type === 'enemy';
        const isSt = myRole === 'st';
        const isMyUnit = u.ownerId === myPlayerId;
        const isBoss = u.isBoss || u.type === 'boss';
        // 玩家看敵方單位（含 BOSS）時隱藏 B/L/A 明細，只顯示剩餘百分比
        const hideDetails = (isEnemy || isBoss) && !isSt && !isMyUnit;
        const isHidden = u.hidden === true;
        // ST 才會看到的隱藏標籤
        const hiddenBadge = (isSt && isHidden) ? ' <span style="font-size:0.7rem;color:var(--text-dim);">👁️‍🗨️ (已隱藏)</span>' : '';

        const canEdit = canControlUnit(u);
        const maxHpLabel = canEdit
            ? `<span class="max-hp-edit" onclick="openMaxHpModal('${u.id}')" title="點擊修改生命上限" style="cursor:pointer;text-decoration:underline dotted;color:var(--accent-yellow);margin-left:4px;">[HP:${maxHp}]</span>`
            : `<span style="margin-left:4px;color:var(--text-muted);">[HP:${maxHp}]</span>`;

        const hpPercent = (typeof calculateWeightedHpPercent === 'function')
            ? Math.round(calculateWeightedHpPercent(u))
            : 100;

        let statusText = `${empty}完好 / ${b}B / ${l}L / ${a}A`;
        if (hideDetails) statusText = `剩餘 ${hpPercent}%`;

        // 擁有者標籤
        let ownerTag = '';
        if (u.ownerName) {
            const ownerColor = isMyUnit ? 'var(--accent-green)' : 'var(--text-dim)';
            ownerTag = `<span style="font-size:0.65rem;color:${ownerColor};margin-left:6px;">[${escapeHtml(u.ownerName)}]</span>`;
        }

        // HP 條：玩家看敵方單位時改用單色百分比條（不洩漏 B/L/A 明細）
        let bar;
        if (hideDetails) {
            const pctCls = hpPercent >= 60 ? 'pct-high' : hpPercent >= 30 ? 'pct-mid' : 'pct-low';
            bar = `<div class="hp-percent-fill ${pctCls}" style="width:${hpPercent}%"></div>`;
        } else {
            bar = hpArr.map(h => {
                let cls = 'hp-empty';
                if (h === 1) cls = 'hp-b';
                if (h === 2) cls = 'hp-l';
                if (h === 3) cls = 'hp-a';
                return `<div class="hp-chunk ${cls}" style="width:${100 / maxHp}%"></div>`;
            }).join('');
        }

        // 護盾徽章（所有人可見）
        let shieldBadges = '';
        if ((u.shieldAuto || 0) > 0 || (u.shieldAutoMax || 0) > 0) {
            shieldBadges += `<span class="shield-badge shield-auto" title="自動護盾（每回合回滿）">🛡 ${u.shieldAuto || 0}/${u.shieldAutoMax || 0}</span>`;
        }
        if ((u.shieldTemp || 0) > 0) {
            shieldBadges += `<span class="shield-badge shield-temp" title="一次性護盾">🛡 ${u.shieldTemp}</span>`;
        }

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
                const encodedName = encodeURIComponent(statusName).replace(/'/g, '%27');
                const displayValue = statusValue ? ` ${escapeHtml(statusValue)}` : '';
                return `<span class="status-badge"
                             data-tooltip="${escapedName}"
                             style="--badge-color: ${color}"
                             onclick="event.stopPropagation();onStatusTagClick(event, '${u.id}', '${encodedName}')">
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

            // ST 專屬的隱藏/現身切換按鈕
            const visibilityBtn = isSt
                ? `<button class="action-btn" onclick="toggleUnitVisibility('${u.id}')" title="切換隱藏/現身">👁️ ${isHidden ? '現身' : '隱藏'}</button>`
                : '';

            // ST 專屬的多重行動設定（BOSS 一回合多次行動）
            const multiActionBtn = isSt
                ? `<button class="action-btn" onclick="openMultiActionModal('${u.id}')" title="多重行動設定（一回合多次行動）">⚔×</button>`
                : '';

            actions = `
                <div class="unit-actions">
                    <button class="action-btn dmg-b" onclick="modifyHP('${u.id}','b',1)" title="按住Shift開啟數量輸入">+B</button>
                    <button class="action-btn dmg-l" onclick="modifyHP('${u.id}','l',1)" title="按住Shift開啟數量輸入">+L</button>
                    <button class="action-btn dmg-a" onclick="modifyHP('${u.id}','a',1)" title="按住Shift開啟數量輸入">+A</button>
                    <button class="action-btn" onclick="openHpModal('${u.id}','damage')" title="開啟傷害面板">⚔</button>
                    <button class="action-btn heal" onclick="openHpModal('${u.id}','heal')" title="開啟治療面板">治療</button>
                    <button class="action-btn heal" onclick="resetUnitHp('${u.id}')" title="清除所有傷害，重置血條">♻</button>
                    <button class="action-btn" onclick="openShieldModal('${u.id}')" title="設定護盾">🛡</button>
                    ${deployBtn}
                    ${bossToggleBtn}
                    ${multiActionBtn}
                    ${assignBtn}
                    ${visibilityBtn}
                    <button class="action-btn" onclick="deleteUnit('${u.id}')">✕</button>
                </div>
            `;
        }

        const safeAvatar = (u.avatar && typeof u.avatar === 'string' && u.avatar.startsWith('data:image/')) ? u.avatar : '';
        const avaStyle = safeAvatar ? `background-image:url(${safeAvatar});color:transparent;` : '';
        const initReadonly = !canControlUnit(u) ? 'readonly' : '';
        // 移除 inline style，使用 CSS 設定的樣式（width: 70px, height: 36px, font-size: 1.1rem）
        const initInput = `<input type="number" class="unit-init" value="${u.init || 0}" onchange="updateInit('${u.id}',this.value)" ${initReadonly}>`;
        const unitInitial = (u.name && u.name.length > 0) ? u.name[0] : '?';

        // 使用者自己的單位有特殊邊框；ST 看到隱藏單位時降低透明度
        const myUnitStyle = (isMyUnit ? 'border-left-width:6px;' : '') + (isSt && isHidden ? 'opacity:0.6;' : '');
        
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
            <div class="${cardClasses}" style="${myUnitStyle}" oncontextmenu="openUnitContextMenu(event, '${u.id}')">
                <div class="unit-header">
                    <div class="${avatarClasses}" style="${avaStyle}" onclick="uploadAvatar('${u.id}')">${u.avatar ? '' : unitInitial}</div>
                    <div style="flex:1;">
                        <div style="font-weight:600;">${escapeHtml(u.name)}${hiddenBadge}${ownerTag}${shieldBadges}</div>
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
        // 隱形棋子：非 ST 玩家完全看不到
        if (myRole !== 'st' && u.hidden === true) return '';

        // 多重行動條目：側欄精簡列
        if (u.actionSlotOf) {
            const parent = findUnitById(u.actionSlotOf);
            const label = parent ? `${parent.name}・行動${u.slotIndex || ''}` : (u.name || '行動');
            const slotClasses = ['unit-card', 'action-slot', u.type, isTurn ? 'active-turn' : ''].filter(Boolean).join(' ');
            return `
                <div class="${slotClasses}">
                    <div class="unit-header">
                        <div class="unit-info">
                            <div class="unit-name" style="color:var(--text-dim);">⚔ ${escapeHtml(label)}</div>
                        </div>
                        <div class="unit-init-box">
                            <span class="unit-init-value">${u.init || 0}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        const isEnemy = u.type === 'enemy';
        const isSt = myRole === 'st';
        const isBoss = u.isBoss || u.type === 'boss';
        const isMyUnit = u.ownerId === myPlayerId;
        const isHidden = u.hidden === true;
        const hpArr = u.hpArr || [];
        const maxHp = u.maxHp || hpArr.length || 1;

        // 玩家看敵方單位（含 BOSS）時隱藏 B/L/A 明細，只顯示剩餘百分比
        const hideDetails = (isEnemy || isBoss) && !isSt && !isMyUnit;
        const hpPercent = (typeof calculateWeightedHpPercent === 'function')
            ? Math.round(calculateWeightedHpPercent(u))
            : 100;

        // 簡潔的傷害狀態文字（帶顏色標記）
        const aCount = hpArr.filter(x => x === 3).length;
        const lCount = hpArr.filter(x => x === 2).length;
        const bCount = hpArr.filter(x => x === 1).length;
        let statusTxt = hideDetails
            ? `剩餘 ${hpPercent}%`
            : `<span class="dmg-b">${bCount}B</span> <span class="dmg-l">${lCount}L</span> <span class="dmg-a">${aCount}A</span>`;

        const unitName = u.name || 'Unknown';
        // ST 看到隱藏單位時的視覺提示
        const sidebarHiddenStyle = (isSt && isHidden) ? 'opacity:0.6;' : '';
        const hiddenSidebarBadge = (isSt && isHidden) ? ' 👁️' : '';

        // 單位卡片類別
        const cardClasses = [
            'unit-card',
            u.type,
            isTurn ? 'active-turn' : '',
            isBoss ? 'boss' : ''
        ].filter(Boolean).join(' ');

        // 生成戰術血條：玩家看敵方時改用百分比填充條，否則用 10 格 B/L/A 方塊
        let tacticalBar;
        if (hideDetails) {
            const pctCls = hpPercent >= 60 ? 'pct-high' : hpPercent >= 30 ? 'pct-mid' : 'pct-low';
            tacticalBar = `<div class="hp-tactical-percent"><div class="hp-percent-fill ${pctCls}" style="width:${hpPercent}%"></div></div>`;
        } else {
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
            tacticalBar = tacticalSegments;
        }

        // 三欄佈局：左名-中血-右速
        return `
            <div class="${cardClasses}" style="${sidebarHiddenStyle}" oncontextmenu="openUnitContextMenu(event, '${u.id}')">
                <div class="unit-header">
                    <div class="unit-info">
                        <div class="unit-name">${escapeHtml(unitName)}${hiddenSidebarBadge}</div>
                        <div class="unit-status">${statusTxt}</div>
                    </div>
                    <div class="hp-tactical-container">${tacticalBar}</div>
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
        // 連同其多重行動條目一起刪除
        state.units = state.units.filter(x => x.id !== id && x.actionSlotOf !== id);
        broadcastState();
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
        broadcastState();
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
        // 記下剛結束回合的單位（用於狀態結算提醒）
        const endingUnit = state.units[state.turnIdx];

        state.turnIdx = (state.turnIdx + 1) % state.units.length;

        // 輪到的單位自動護盾回滿
        const activeUnit = state.units[state.turnIdx];
        if (activeUnit && (activeUnit.shieldAutoMax || 0) > 0 && (activeUnit.shieldAuto || 0) < activeUnit.shieldAutoMax) {
            activeUnit.shieldAuto = activeUnit.shieldAutoMax;
            showToast(`🛡 ${activeUnit.name || '單位'} 的自動護盾已回滿（${activeUnit.shieldAutoMax}）`);
        }

        broadcastState();

        // 回合結束狀態結算提醒（燃燒/流血/再生等）
        // 多重行動條目結束時，結算對象是本體 BOSS（規則：每次結束行動時結算）
        let settleUnit = endingUnit;
        if (endingUnit && endingUnit.actionSlotOf) {
            settleUnit = findUnitById(endingUnit.actionSlotOf) || null;
        }
        if (settleUnit) showTurnEndSettlement(settleUnit);

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

/**
 * 切換單位隱藏狀態（ST 專用）
 * 隱藏的單位在玩家畫面上完全不可見，ST 則以半透明方式顯示
 * @param {string} id - 單位 ID
 */
function toggleUnitVisibility(id) {
    if (myRole !== 'st') return;
    const u = findUnitById(id);
    if (!u) return;
    u.hidden = !u.hidden;
    broadcastState();
    renderAll();
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

// ===== 護盾系統 =====
/**
 * 開啟護盾設定視窗
 * 護盾分兩種：自動護盾（每回合輪到該單位時回滿）與一次性護盾
 * 傷害優先消耗一次性護盾 → 自動護盾 → 才扣血（見 modifyHPInternal）
 * @param {string} unitId - 單位 ID
 */
function openShieldModal(unitId) {
    const u = findUnitById(unitId);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    const existing = document.getElementById('shield-modal');
    if (existing) existing.remove();

    const html = `
        <div class="modal-overlay show" id="shield-modal" onclick="if(event.target.id==='shield-modal')closeShieldModal()">
            <div class="modal" style="max-width:380px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <span style="font-weight:bold;">🛡 護盾設定 - ${escapeHtml(u.name || '單位')}</span>
                    <button onclick="closeShieldModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>自動護盾上限（輪到該單位時自動回滿，0 = 不啟用）</label>
                        <input type="number" id="shield-auto-max" value="${u.shieldAutoMax || 0}" min="0" max="999">
                    </div>
                    <div class="form-group">
                        <label>目前自動護盾</label>
                        <input type="number" id="shield-auto-cur" value="${u.shieldAuto || 0}" min="0" max="999">
                    </div>
                    <div class="form-group">
                        <label>一次性護盾（耗盡即消失，不會回復）</label>
                        <input type="number" id="shield-temp" value="${u.shieldTemp || 0}" min="0" max="999">
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-dim);line-height:1.5;">
                        每 1 點傷害消耗 1 點護盾；優先消耗一次性護盾，再消耗自動護盾，最後才會扣血。
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="clearUnitShield('${u.id}')" style="background:var(--accent-red);margin-right:auto;">清除護盾</button>
                    <button class="modal-btn" onclick="closeShieldModal()" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="saveUnitShield('${u.id}')" style="background:var(--accent-green);color:#000;">儲存</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modals-container').insertAdjacentHTML('beforeend', html);
}

function closeShieldModal() {
    const modal = document.getElementById('shield-modal');
    if (modal) modal.remove();
}

function saveUnitShield(unitId) {
    const clampShield = v => Math.max(0, Math.min(999, parseInt(v) || 0));
    const autoMax = clampShield(document.getElementById('shield-auto-max')?.value);
    const autoCur = Math.min(clampShield(document.getElementById('shield-auto-cur')?.value), autoMax);
    const temp = clampShield(document.getElementById('shield-temp')?.value);
    applyShieldChange(unitId, autoMax, autoCur, temp);
    closeShieldModal();
}

function clearUnitShield(unitId) {
    applyShieldChange(unitId, 0, 0, 0);
    closeShieldModal();
}

function applyShieldChange(unitId, autoMax, autoCur, temp) {
    const u = findUnitById(unitId);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    u.shieldAutoMax = autoMax;
    u.shieldAuto = autoCur;
    u.shieldTemp = temp;

    if (myRole === 'st') {
        broadcastState();
    } else {
        sendToHost({
            type: 'updateShield',
            playerId: myPlayerId,
            unitId: unitId,
            shieldAutoMax: autoMax,
            shieldAuto: autoCur,
            shieldTemp: temp
        });
        renderAll();
    }
    showToast('🛡 護盾已更新');
}

// ===== 回合結束狀態結算提醒 =====
/**
 * 可自動結算的狀態規則（key = 狀態名稱，與 unit.status 的 key 對應）
 */
const TURN_END_RULES = {
    '燃燒': { kind: 'damage', dmgType: 'l', desc: pts => `受到 ${pts} 點 L 傷（火焰）` },
    '流血': { kind: 'damage', dmgType: 'l', desc: pts => `受到 ${pts} 點 L 傷（物理）` },
    '再生': { kind: 'heal', desc: pts => `回復 ${pts} 點傷害` },
    '尖釘': { kind: 'remind', desc: () => '回合結束受到流血，並增加麻痺點數（請手動處理）' }
};

/**
 * 顯示回合結束狀態結算提醒（僅 ST，nextTurn 時觸發）
 * @param {Object} unit - 剛結束回合的單位
 */
function showTurnEndSettlement(unit) {
    if (myRole !== 'st' || !unit || !unit.status) return;

    const items = [];
    for (const [name, rule] of Object.entries(TURN_END_RULES)) {
        if (unit.status[name] === undefined) continue;
        const pts = parseInt(unit.status[name]) || 0;
        if (rule.kind !== 'remind' && pts <= 0) continue;
        items.push({ name, rule, pts });
    }
    if (items.length === 0) return;

    closeTurnSettlement();

    const itemsHtml = items.map(item => {
        const statusDef = (typeof getStatusByName === 'function') ? getStatusByName(item.name) : null;
        const icon = statusDef?.icon || '📌';
        const actionBtn = item.rule.kind === 'remind'
            ? ''
            : `<button class="settlement-apply-btn" id="settle-btn-${encodeURIComponent(item.name)}"
                   onclick="applyTurnEndItem('${unit.id}', '${encodeURIComponent(item.name)}')">套用</button>`;
        return `
            <div class="settlement-item">
                <span class="settlement-label">${icon} ${escapeHtml(item.name)} ${item.pts || ''}：${escapeHtml(item.rule.desc(item.pts))}</span>
                ${actionBtn}
            </div>
        `;
    }).join('');

    const hasApplicable = items.some(i => i.rule.kind !== 'remind');

    const panel = document.createElement('div');
    panel.id = 'turn-settlement-panel';
    panel.className = 'turn-settlement-panel';
    panel.innerHTML = `
        <div class="settlement-header">
            <span>⏳ 回合結束結算 — ${escapeHtml(unit.name || '單位')}</span>
            <button class="settlement-close" onclick="closeTurnSettlement()">×</button>
        </div>
        <div class="settlement-body">${itemsHtml}</div>
        <div class="settlement-footer">
            ${hasApplicable ? `<button class="settlement-apply-all-btn" onclick="applyAllTurnEndItems('${unit.id}')">全部套用</button>` : ''}
            <button class="settlement-skip-btn" onclick="closeTurnSettlement()">略過</button>
        </div>
    `;
    document.body.appendChild(panel);
}

function closeTurnSettlement() {
    const panel = document.getElementById('turn-settlement-panel');
    if (panel) panel.remove();
}

/**
 * 套用單一回合結算項目
 * @param {string} unitId - 單位 ID
 * @param {string} encodedName - 編碼後的狀態名稱
 */
function applyTurnEndItem(unitId, encodedName) {
    const name = decodeURIComponent(encodedName);
    const u = findUnitById(unitId);
    const rule = TURN_END_RULES[name];
    if (!u || !rule || !u.status || u.status[name] === undefined) return;

    const pts = parseInt(u.status[name]) || 0;
    if (pts <= 0) return;

    if (rule.kind === 'damage') {
        modifyHPInternal(u, rule.dmgType, pts);
        showToast(`${u.name || '單位'} 因 ${name} 受到 ${pts} 點 L 傷`);
    } else if (rule.kind === 'heal') {
        modifyHPInternal(u, 'heal', pts);
        showToast(`${u.name || '單位'} 因 ${name} 回復 ${pts} 點傷害`);
    }

    broadcastState();

    // 標記按鈕為已套用
    const btn = document.getElementById('settle-btn-' + encodedName);
    if (btn) {
        btn.disabled = true;
        btn.innerText = '✓ 已套用';
        btn.classList.add('applied');
    }
}

/**
 * 套用全部可結算項目
 * @param {string} unitId - 單位 ID
 */
function applyAllTurnEndItems(unitId) {
    const panel = document.getElementById('turn-settlement-panel');
    if (!panel) return;
    panel.querySelectorAll('.settlement-apply-btn:not(.applied)').forEach(btn => btn.click());
}

// ===== 單位右鍵快速選單 =====
/**
 * 開啟單位快速操作選單（單位卡或地圖 token 按右鍵）
 * @param {Event} event - contextmenu 事件
 * @param {string} unitId - 單位 ID
 */
function openUnitContextMenu(event, unitId) {
    event.preventDefault();
    event.stopPropagation();
    // 避免同一棋子上其它 contextmenu 監聽器（地圖棋子的狀態 tooltip 切換）被一併觸發，造成 tooltip 卡住
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    closeUnitContextMenu();

    const u = findUnitById(unitId);
    if (!u) return;

    const isSt = myRole === 'st';
    const isBoss = u.isBoss || u.type === 'boss';
    const deployed = u.x >= 0;

    const canControl = typeof canControlUnit !== 'function' || canControlUnit(u);
    // 玩家即使無控制權，仍可對敵方/BOSS 發起攻擊
    const canAttack = !isSt && (u.type === 'enemy' || isBoss);

    // 既不能控制、也不能攻擊 → 不顯示任何選單
    if (!canControl && !canAttack) return;

    let items;
    if (canControl && u.actionSlotOf) {
        // 多重行動條目：只提供設定與刪除
        items = [
            { icon: '⚔', label: '多重行動設定', fn: `openMultiActionModal('${u.actionSlotOf}')` },
            { icon: '✕', label: '刪除此行動', cls: 'danger', fn: `deleteUnit('${u.id}')` }
        ];
    } else {
        items = [];
        if (canControl) {
            items.push(
                { icon: '⚔', label: '傷害面板', fn: `openHpModal('${u.id}','damage')` },
                { icon: '💚', label: '治療面板', fn: `openHpModal('${u.id}','heal')` },
                { icon: '🏷', label: '管理狀態', fn: `openStatusModal('${u.id}')` },
                { icon: '🛡', label: '設定護盾', fn: `openShieldModal('${u.id}')` },
                { icon: '📍', label: deployed ? '收回單位' : '部署單位', fn: deployed ? `recallUnit('${u.id}')` : `startDeploy('${u.id}')` },
                { icon: '♻', label: '重置血量', fn: `resetUnitHp('${u.id}')` }
            );
            if (isSt) {
                items.push({ icon: '⚔', label: '多重行動設定', fn: `openMultiActionModal('${u.id}')` });
                items.push({ icon: '👁', label: u.hidden ? '現身' : '隱藏', fn: `toggleUnitVisibility('${u.id}')` });
                if (isBoss) {
                    items.push({ icon: '👑', label: state.activeBossId === u.id ? '隱藏 BOSS 血條' : '顯示 BOSS 血條', fn: `toggleActiveBoss('${u.id}')` });
                }
            }
        }
        // ===== 盲盒戰鬥與 QTE 系統：附加戰鬥按鈕（不影響原有操作項目） =====
        if (canAttack) {
            items.push({ icon: '⚔️', label: '發起攻擊', fn: `openAttackModal('${u.id}')` });
        } else if (isSt && u.type === 'player') {
            items.push({ icon: '🗡️', label: '發起威脅 (QTE)', fn: `openThreatModal('${u.id}')` });
        }

        if (canControl) {
            items.push({ icon: '✕', label: '刪除單位', cls: 'danger', fn: `deleteUnit('${u.id}')` });
        }
    }

    if (!items.length) return;

    const menu = document.createElement('div');
    menu.id = 'unit-context-menu';
    menu.className = 'unit-context-menu';
    menu.innerHTML = `
        <div class="ucm-title">${escapeHtml(u.name || '單位')}</div>
        ${items.map(it => `
            <div class="ucm-item ${it.cls || ''}" onclick="closeUnitContextMenu();${it.fn}">
                <span class="ucm-icon">${it.icon}</span>${it.label}
            </div>
        `).join('')}
    `;
    document.body.appendChild(menu);

    // 定位在游標附近並夾限在視窗內
    const W = menu.offsetWidth || 170;
    const H = menu.offsetHeight || 280;
    let x = event.clientX;
    let y = event.clientY;
    if (x + W > window.innerWidth - 8) x = window.innerWidth - W - 8;
    if (y + H > window.innerHeight - 8) y = window.innerHeight - H - 8;
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = Math.max(8, y) + 'px';

    setTimeout(() => {
        document.addEventListener('pointerdown', handleUcmOutsideClick, true);
    }, 0);
}

function handleUcmOutsideClick(e) {
    const menu = document.getElementById('unit-context-menu');
    if (menu && !menu.contains(e.target)) closeUnitContextMenu();
}

function closeUnitContextMenu() {
    const menu = document.getElementById('unit-context-menu');
    if (menu) menu.remove();
    document.removeEventListener('pointerdown', handleUcmOutsideClick, true);
}

// ===== BOSS 多重行動系統 =====
/**
 * 取得某單位的多重行動條目（依 slotIndex 排序）
 * @param {string} bossId - 本體單位 ID
 */
function getActionSlots(bossId) {
    return state.units
        .filter(u => u.actionSlotOf === bossId)
        .sort((a, b) => (a.slotIndex || 0) - (b.slotIndex || 0));
}

/**
 * 開啟多重行動設定視窗
 * 一個視窗填完「總行動次數 + 每個行動的先攻」，
 * 行動條目會出現在先攻列表但沒有血條/狀態（共用本體 BOSS 的血量）
 * @param {string} bossId - 本體單位 ID
 */
function openMultiActionModal(bossId) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以設定多重行動');
        return;
    }
    const boss = findUnitById(bossId);
    if (!boss) return;
    // 從行動條目開啟時轉到本體
    if (boss.actionSlotOf) return openMultiActionModal(boss.actionSlotOf);

    const slots = getActionSlots(bossId);
    const total = slots.length + 1;

    const existing = document.getElementById('multi-action-modal');
    if (existing) existing.remove();

    const html = `
        <div class="modal-overlay show" id="multi-action-modal" onclick="if(event.target.id==='multi-action-modal')closeMultiActionModal()">
            <div class="modal" style="max-width:420px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <span style="font-weight:bold;">⚔ 多重行動設定 - ${escapeHtml(boss.name || '單位')}</span>
                    <button onclick="closeMultiActionModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>總行動次數（含本體，例：七招式 BOSS 填 7）</label>
                        <input type="number" id="ma-count" value="${total}" min="1" max="12"
                               onchange="renderMultiActionInits('${bossId}')">
                    </div>
                    <div class="form-group">
                        <label>各行動先攻值（行動 1 = 本體自己的先攻）</label>
                        <div class="ma-init-grid" id="ma-init-grid"></div>
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-dim);line-height:1.5;">
                        行動條目只佔先攻順序，沒有自己的血條與狀態；對 BOSS 的傷害照常打在本體上。
                        刪除本體 BOSS 時會自動清掉所有行動條目。
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="removeMultiAction('${bossId}')" style="background:var(--accent-red);margin-right:auto;">移除全部行動</button>
                    <button class="modal-btn" onclick="closeMultiActionModal()" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="saveMultiAction('${bossId}')" style="background:var(--accent-green);color:#000;">儲存</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modals-container').insertAdjacentHTML('beforeend', html);
    renderMultiActionInits(bossId);
}

function closeMultiActionModal() {
    const modal = document.getElementById('multi-action-modal');
    if (modal) modal.remove();
}

/**
 * 依「總行動次數」重新渲染先攻輸入格（保留已輸入的值）
 * @param {string} bossId - 本體單位 ID
 */
function renderMultiActionInits(bossId) {
    const grid = document.getElementById('ma-init-grid');
    const countInput = document.getElementById('ma-count');
    if (!grid || !countInput) return;

    const boss = findUnitById(bossId);
    const slots = getActionSlots(bossId);
    const count = Math.max(1, Math.min(12, parseInt(countInput.value) || 1));
    countInput.value = count;

    // 既有輸入值優先，其次是現有單位資料
    const currentValues = [];
    for (let i = 0; i < count; i++) {
        const input = document.getElementById('ma-init-' + i);
        if (input) {
            currentValues[i] = input.value;
        } else if (i === 0) {
            currentValues[i] = boss ? (boss.init || 0) : 0;
        } else {
            currentValues[i] = slots[i - 1] ? (slots[i - 1].init || 0) : 0;
        }
    }

    grid.innerHTML = currentValues.map((v, i) => `
        <div class="ma-init-cell">
            <label>行動${i + 1}${i === 0 ? '（本體）' : ''}</label>
            <input type="number" id="ma-init-${i}" value="${v}">
        </div>
    `).join('');
}

/**
 * 儲存多重行動設定：建立/更新/移除行動條目並寫入先攻
 * @param {string} bossId - 本體單位 ID
 */
function saveMultiAction(bossId) {
    const boss = findUnitById(bossId);
    if (!boss) return;

    const count = Math.max(1, Math.min(12, parseInt(document.getElementById('ma-count')?.value) || 1));
    const inits = [];
    for (let i = 0; i < count; i++) {
        inits[i] = parseInt(document.getElementById('ma-init-' + i)?.value) || 0;
    }

    // 行動 1 = 本體先攻
    boss.init = inits[0];

    const slots = getActionSlots(bossId);

    // 更新或建立行動 2..count
    for (let i = 1; i < count; i++) {
        if (slots[i - 1]) {
            slots[i - 1].init = inits[i];
            slots[i - 1].slotIndex = i + 1;
        } else {
            const slot = createUnit(`${boss.name}・行動${i + 1}`, 1, boss.type);
            slot.actionSlotOf = bossId;
            slot.slotIndex = i + 1;
            slot.init = inits[i];
            state.units.push(slot);
        }
    }

    // 移除多餘的條目（行動次數被調低時）
    const keepIds = new Set(getActionSlots(bossId).slice(0, count - 1).map(s => s.id));
    state.units = state.units.filter(u => u.actionSlotOf !== bossId || keepIds.has(u.id));

    broadcastState();
    closeMultiActionModal();
    showToast(`⚔ ${boss.name || '單位'} 已設定 ${count} 次行動`);
}

/**
 * 移除某單位的所有多重行動條目
 * @param {string} bossId - 本體單位 ID
 */
function removeMultiAction(bossId) {
    state.units = state.units.filter(u => u.actionSlotOf !== bossId);
    broadcastState();
    closeMultiActionModal();
    showToast('已移除全部行動條目');
}

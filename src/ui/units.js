/**
 * Limbus Command - 單位模組
 * 處理單位渲染、HP 修改、回合等
 */

// ===== 頭像解析度設定 =====
// 根據 token 最大尺寸決定（3x3 = 150px，加上 Retina 螢幕需求）
const AVATAR_SIZE = 256;  // 從 64 提升到 256，確保 3x3 token 在高解析度螢幕也清晰
const AVATAR_QUALITY = 0.85;  // 較高品質，但仍保持合理檔案大小

// ===== 狀態 → FontAwesome 6 向量圖標對照（全面取代原生 Emoji）=====
// 以狀態庫 id 對應；未列出者退回中性的 fa-circle-dot（仍為向量、不使用 Emoji）。
const STATUS_FA_ICONS = {
    burn: 'fa-fire', bleed: 'fa-droplet', fragile: 'fa-gem', stun: 'fa-star',
    paralyze: 'fa-bolt', freeze: 'fa-snowflake', entangle: 'fa-spider', invisible: 'fa-ghost',
    haste: 'fa-gauge-high', regenerate: 'fa-heart-pulse', shield: 'fa-shield-halved', marked: 'fa-crosshairs',
    strength: 'fa-dumbbell', endurance: 'fa-shield', command_target: 'fa-wand-magic-sparkles', karma: 'fa-scale-balanced',
    command_protect: 'fa-hands-holding', tremor: 'fa-bell', poise: 'fa-wind', flaw: 'fa-bullseye',
    weakness: 'fa-eye', nails: 'fa-thumbtack', gale: 'fa-tornado', erosion_amplify: 'fa-fire-flame-curved',
    helpless: 'fa-handcuffs', unconscious: 'fa-bed', paralyzed: 'fa-icicles', stunned: 'fa-face-dizzy',
    sleep: 'fa-moon', exhausted: 'fa-face-tired', blind: 'fa-eye-slash', deaf: 'fa-ear-deaf',
    dazzled: 'fa-star', tinnitus: 'fa-bell', airborne: 'fa-wind', prone: 'fa-person-falling',
    immobilized: 'fa-lock', slow: 'fa-hourglass-half', sinking: 'fa-water', silence: 'fa-volume-xmark',
    seal: 'fa-ban', charge: 'fa-bolt-lightning', swiftness: 'fa-person-running', bind: 'fa-link',
    provoke: 'fa-hand-fist', vulnerable: 'fa-heart-crack', weak: 'fa-angles-down', defense: 'fa-shield',
    duel: 'fa-hand-fist', echo: 'fa-wave-square', arcana: 'fa-wand-sparkles', banish: 'fa-ban',
    charmed: 'fa-heart', confusion: 'fa-arrows-spin', depression: 'fa-cloud-rain', dominate: 'fa-brain',
    excitement: 'fa-face-grin-stars', fascinated: 'fa-heart', fatigue: 'fa-battery-quarter', fear: 'fa-ghost',
    love: 'fa-heart', mental_bind: 'fa-brain', pain: 'fa-bolt', addiction: 'fa-pills',
    knowledge: 'fa-book', true: 'fa-certificate', limb_disabled: 'fa-crutch', limb_impair: 'fa-bandage',
    frozen_solid: 'fa-icicles'
};

/**
 * 取得某狀態的 FontAwesome 圖標 class（向量、非 Emoji）。
 * @param {object|null} statusDef - 狀態庫定義
 * @param {string} statusName - 狀態名稱（自訂狀態的回退）
 */
function getStatusFa(statusDef, statusName) {
    const id = statusDef ? statusDef.id : statusName;
    return 'fa-solid ' + (STATUS_FA_ICONS[id] || 'fa-circle-dot');
}

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
        const totalRounds = state.roundNum || 1;
        state.isCombatActive = false;
        state.units.forEach(u => u.init = 0);
        state.turnIdx = -1;
        state.roundNum = 0;
        state.activeBossId = null;

        // 戰鬥結束清除全場狀態（ST 於排除名單勾選的狀態除外）
        const cleared = (typeof clearBattleEndStatuses === 'function') ? clearBattleEndStatuses() : [];

        broadcastState();
        showToast('戰鬥已結束，先攻已歸零' + (cleared.length ? `，並清除狀態：${cleared.join('、')}` : ''));
        // 戰鬥日誌：寫入結束標記（供回合分析切分戰鬥區段；附當下時鐘刻度供刻度消耗統計）
        if (typeof bbPushCombatLog === 'function') {
            bbPushCombatLog({
                entryType: 'battle_end',
                attackerName: 'ST', attackerRole: 'enemy',
                broadcastText: `🏁 戰鬥結束（共 ${totalRounds} 回合）`,
                round: totalRounds,
                clockTicks: (typeof eroClockTicks === 'number') ? eroClockTicks : -1
            });
        }
    } else {
        // 開始戰鬥：排序並設定第一回合
        state.isCombatActive = true;
        // 直接排序，不透過 sortByInit() 避免雙重 broadcastState
        state.units.sort((a, b) => b.init - a.init);
        state.turnIdx = 0;
        state.roundNum = 1;
        // 戰鬥開始時所有自動護盾回滿、移動能量條回滿（moveUsed 歸零）
        state.units.forEach(u => {
            if ((u.shieldAutoMax || 0) > 0) u.shieldAuto = u.shieldAutoMax;
            u.moveUsed = 0;
        });
        broadcastState();
        showToast('戰鬥開始！');
        // 戰鬥日誌：寫入開始標記
        if (typeof bbPushCombatLog === 'function') {
            bbPushCombatLog({
                entryType: 'battle_start',
                attackerName: 'ST', attackerRole: 'enemy',
                broadcastText: '⚔️ 戰鬥開始！第 1 回合',
                round: 1,
                clockTicks: (typeof eroClockTicks === 'number') ? eroClockTicks : -1
            });
        }
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
            <button class="units-btn" onclick="openInitRollModal()" title="全體骰先攻：1D10 + 先攻加值，自動填入先攻序列">🎲 先攻</button>
            <button class="units-btn" onclick="sortByInit()">⏱ 排序</button>
            <button class="units-btn" onclick="openStatusExclusionModal()" title="設定戰鬥結束清除全場狀態時，哪些狀態要保留">🛡️ 排除名單</button>
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
            const slotClasses = ['unit-card', 'unit-card-subaction', 'action-slot', u.type, isTurn ? 'active-turn' : ''].filter(Boolean).join(' ');
            const slotInit = `<div class="unit-init-seq${isStView ? '' : ' readonly'}" data-unit-id="${u.id}" title="先攻序列（滑鼠滾輪調整）">${u.init || 0}</div>`;
            const slotDel = isStView ? `<button class="action-btn" onclick="deleteUnit('${u.id}')" title="刪除此行動條目">✕</button>` : '';
            return `
                <div class="${slotClasses}" oncontextmenu="openUnitContextMenu(event, '${u.id}')">
                    <div class="unit-header" style="min-height:auto;">
                        <span class="slot-icon">⚔</span>
                        <div class="unit-name" title="${escapeHtml(label)}" style="flex:1;font-size:0.85rem;font-weight:600;color:var(--text-dim);">${escapeHtml(label)}</div>
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
            ? `<span class="max-hp-edit" onclick="openMaxHpPopover(event, '${u.id}')" title="點擊修改生命上限"><i class="fa-solid fa-pen-to-square"></i>HP ${maxHp}</span>`
            : `<span class="max-hp-edit max-hp-ro">HP ${maxHp}</span>`;

        const hpPercent = (typeof calculateWeightedHpPercent === 'function')
            ? Math.round(calculateWeightedHpPercent(u))
            : 100;

        // HP 明細文字：保留「N完好 / bB / lL / aA」（B/L/A 傷勢明細以顏色區分）。
        let statusText = `${empty}完好 / <span class="dmg-b">${b}B</span> / <span class="dmg-l">${l}L</span> / <span class="dmg-a">${a}A</span>`;
        if (hideDetails) statusText = `剩餘 ${hpPercent}%`;

        // 擁有者代號標籤：ST 可點擊修改（辨識這是哪位玩家的單位）；其他人唯讀顯示
        let ownerTag = '';
        const isPlayerOwned = !!u.ownerId && !String(u.ownerId).startsWith('st_');
        if (isSt && isPlayerOwned) {
            const codeText = u.ownerName ? `[${escapeHtml(u.ownerName)}]` : '[＋代號]';
            ownerTag = `<span class="owner-code-edit" onclick="event.stopPropagation();renameOwnerCode('${u.id}')" title="修改玩家代號（僅 ST）" style="font-size:0.65rem;margin-left:6px;">${codeText}</span>`;
        } else if (u.ownerName) {
            const ownerColor = isMyUnit ? 'var(--accent-green)' : 'var(--text-dim)';
            ownerTag = `<span style="font-size:0.65rem;color:${ownerColor};margin-left:6px;">[${escapeHtml(u.ownerName)}]</span>`;
        }

        // （血條已移除：HP 以第二列「N完好 / bB / lL / aA」明細文字呈現，玩家看敵方則顯示「剩餘 X%」。）

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
            ? `<button class="action-btn" onclick="recallUnit('${u.id}')" title="收回單位"><i class="fa-solid fa-box-archive text-purple-400"></i><span class="ab-t">收回</span></button>`
            : `<button class="action-btn" onclick="startDeploy('${u.id}')" title="部署到地圖"><i class="fa-solid fa-map-location-dot text-purple-400"></i><span class="ab-t">部署</span></button>`;

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
                // 色彩編碼：負面狀態淡紅底、其餘（增益）淡綠底，讓 ST 用顏色快速判讀
                const statusKey = statusDef ? statusDef.id : statusName;
                const catCls = (typeof isDebuffStatus === 'function' && isDebuffStatus(statusKey)) ? 'cat-negative' : 'cat-positive';
                const fa = getStatusFa(statusDef, statusName);
                return `<span class="status-badge ${catCls}"
                             data-tooltip="${escapedName}"
                             style="--badge-color: ${color}"
                             onclick="event.stopPropagation();onStatusTagClick(event, '${u.id}', '${encodedName}')">
                    <i class="${fa}" style="color:${color}"></i>${displayValue}
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
        // v2 佈局：把「血條右側的操作按鈕」與「第二列的 BLA 步進器」拆成兩段，
        // 讓卡片呈現「資訊列 + 狀態/BLA 列」的雙列結構（參考新版 UI 互動模型）。
        let hpActions = '';    // 第一列血條右側：重置/護盾/部署/… 等緊湊等高按鈕
        let blaControls = '';  // 第二列右側：扣血/治療切換 + B/L/A 步進器
        if (canControlUnit(u)) {
            // ST 專屬的分配權限按鈕
            const assignBtn = isSt ? `<button class="action-btn" onclick="openAssignOwnerModal('${u.id}')" title="分配給其他玩家"><i class="fa-solid fa-user-gear text-gray-400"></i></button>` : '';

            // BOSS 血條切換按鈕
            const bossToggleBtn = isBoss
                ? `<button class="action-btn boss-toggle${state.activeBossId === u.id ? ' active' : ''}" onclick="toggleActiveBoss('${u.id}')" title="顯示/隱藏 BOSS 血條"><i class="fa-solid fa-crown text-amber-400"></i></button>`
                : '';

            // ST 專屬的隱藏/現身切換按鈕
            const visibilityBtn = isSt
                ? `<button class="action-btn" onclick="toggleUnitVisibility('${u.id}')" title="${isHidden ? '現身' : '隱藏'}"><i class="fa-solid ${isHidden ? 'fa-eye' : 'fa-eye-slash'} text-gray-400"></i></button>`
                : '';

            // ST 專屬的 BOSS 設定（戰鬥數值＋一回合多次行動，合併於同一 Modal）
            const multiActionBtn = (isSt && u.type === 'boss')
                ? `<button class="action-btn" onclick="openMultiActionModal('${u.id}')" title="BOSS 設定（戰鬥數值＋多重行動）"><i class="fa-solid fa-gears text-amber-400"></i></button>`
                : '';

            // 第一列血條右側的操作按鈕（純向量圖標、等高、微深灰漸層底）
            hpActions = `
                <div class="uc-actions">
                    <button class="action-btn heal" onclick="showToast('再點一次確認重置')" ondblclick="hpResetAll('${u.id}')" title="雙擊重置血量（避免誤觸）"><i class="fa-solid fa-heart-circle-check text-emerald-400"></i></button>
                    <button class="action-btn shield-btn" onclick="openShieldModal('${u.id}')" title="護盾 / 防禦"><i class="fa-solid fa-shield-halved text-cyan-400"></i></button>
                    ${deployBtn}
                    ${bossToggleBtn}
                    ${multiActionBtn}
                    ${assignBtn}
                    ${visibilityBtn}
                    <button class="action-btn del" onclick="deleteUnit('${u.id}')" title="刪除單位"><i class="fa-solid fa-trash-can text-rose-400"></i></button>
                </div>`;

            // B/L/A 快速傷害/治療步進器：+/- 只調整「待套用量」（暫存於 hpPending，不碰血量）。
            // 最左邊的開關切換「扣血／治療」模式，決定套用時是造成傷害還是治療（預設扣血）。
            const mode = hpAdjustMode[u.id] || 'damage';
            const pending = hpPending[u.id] || { b: 0, l: 0, a: 0 };
            // 傷害／治療模式切換鈕：點擊切換，滑鼠移上滾動滾輪也可切換（onwheel）。
            const modeBtn = `
                <button class="bla-mode ${mode === 'heal' ? 'heal' : 'dmg'}"
                        onclick="toggleHpAdjustMode('${u.id}')"
                        onwheel="wheelHpAdjustMode(event, '${u.id}')"
                        title="點擊或滾輪切換：扣血／治療（目前：${mode === 'heal' ? '治療' : '扣血'}）">
                    <i class="fa-solid ${mode === 'heal' ? 'fa-heart-pulse' : 'fa-burst'}"></i>
                    <span>${mode === 'heal' ? '治療' : '傷害'}</span>
                </button>`;

            // 戰術步進器：－/＋ 只調整待套用量（可長按快速輸入）。
            // 中央數字：單擊＝直接輸入待套用數字、雙擊＝真正套用（依 mode 扣血或治療）。
            // 中央保留為可點擊的 <button>，故不套用範本 CSS 的 pointer-events:none。
            const hpStepper = (type, label) => `
                <div class="hp-stepper stepper-${type}">
                    <button class="stepper-btn minus" onpointerdown="hpHoldStart('${u.id}','${type}',-1)" onpointerup="hpHoldStop()" onpointerleave="hpHoldStop()" onpointercancel="hpHoldStop()" title="待套用量 －1（按住可快速輸入）">−</button>
                    <button class="stepper-val" id="hp-pending-${u.id}-${type}" onclick="onStepperValClick('${u.id}','${type}')" ondblclick="onStepperValDblClick('${u.id}','${type}')" title="單擊輸入數字、雙擊${mode === 'heal' ? '治療' : '扣血'}套用">${pending[type] || 0}${label}</button>
                    <button class="stepper-btn plus" onpointerdown="hpHoldStart('${u.id}','${type}',1)" onpointerup="hpHoldStop()" onpointerleave="hpHoldStop()" onpointercancel="hpHoldStop()" title="待套用量 ＋1（按住可快速輸入）">+</button>
                </div>`;

            blaControls = `
                <div class="uc-bla">
                    ${modeBtn}
                    ${hpStepper('b', 'B')}
                    ${hpStepper('l', 'L')}
                    ${hpStepper('a', 'A')}
                </div>`;
        }

        // 狀況徽章：依剩餘血量百分比給一個顏色標籤，快速判讀單位狀態（參考新版 UI）
        let condLabel, condCls;
        if (hpPercent >= 100) { condLabel = '完好'; condCls = 'cond-full'; }
        else if (hpPercent >= 60) { condLabel = '輕傷'; condCls = 'cond-light'; }
        else if (hpPercent >= 30) { condLabel = '重傷'; condCls = 'cond-heavy'; }
        else if (hpPercent > 0) { condLabel = '瀕死'; condCls = 'cond-crit'; }
        else { condLabel = '倒下'; condCls = 'cond-down'; }

        const safeAvatar = (u.avatar && typeof u.avatar === 'string' && u.avatar.startsWith('data:image/')) ? u.avatar : '';
        const avaStyle = safeAvatar ? `background-image:url(${safeAvatar});color:transparent;` : '';
        // 先攻面板：平時只顯示「最終先攻」大數字；滑鼠懸停才彈出工業風明細方框，
        // 讓玩家知道自己的先攻由什麼組成、被什麼狀態改動（基準 / 迅捷 / 束縛 / 最終）。
        // 基準＝u.init（滑鼠滾輪調整、可控單位限定）；迅捷 +層數、束縛 -層數。
        const initBase = parseInt(u.init) || 0;
        const initSw = irGetStatusLayers(u, 'swiftness');
        const initBd = irGetStatusLayers(u, 'bind');
        const initAdj = initSw - initBd;
        // 不再加 title：原生瀏覽器提示框會跟懸停彈出的 .uinit-pop 明細方框同時出現互相打架，
        // 明細本身已經足夠說明，滾輪調整方式改標示在 .uinit-pop 內。
        const initInput = `<div class="unit-init-seq uinit${canControlUnit(u) ? '' : ' readonly'}" data-unit-id="${u.id}" data-base="${initBase}" data-adj="${initAdj}" data-sw="${initSw}" data-bd="${initBd}">${renderInitPanelInner(initBase, initAdj, initSw, initBd)}</div>`;
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

        // 第二列（狀態徽章 + BLA 步進器）只有在其中一邊有內容時才渲染，避免留下空白列。
        const row2 = (statusBadges || blaControls)
            ? `<div class="uc-row2">
                    <div class="uc-statuses">${statusBadges}</div>
                    ${blaControls}
                </div>`
            : '';

        return `
            <div class="${cardClasses}" style="${myUnitStyle}" oncontextmenu="openUnitContextMenu(event, '${u.id}')">
                <div class="uc-row1">
                    <div class="${avatarClasses}" style="${avaStyle}" onclick="uploadAvatar('${u.id}')">${u.avatar ? '' : unitInitial}</div>
                    <div class="uc-main">
                        <div class="uc-nameline">
                            ${canEdit
                                ? `<span class="unit-name unit-name-edit" onclick="event.stopPropagation();renameUnit('${u.id}')" title="修改單位名稱（點擊）">${escapeHtml(u.name)}</span>`
                                : `<span class="unit-name" title="${escapeHtml(u.name)}">${escapeHtml(u.name)}</span>`}
                            <span class="uc-cond ${condCls}">${condLabel}</span>
                            ${hiddenBadge}${ownerTag}${shieldBadges}
                        </div>
                        <div class="uc-hprow">
                            <span class="uc-hptext">${statusText}${hideDetails ? '' : maxHpLabel}</span>
                            ${hpActions}
                        </div>
                    </div>
                    ${initInput}
                </div>
                ${row2}
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

        // 多重行動條目：側欄極簡子項目（縮排 + 左邊框，僅顯示行動代號與先攻）
        if (u.actionSlotOf) {
            const parent = findUnitById(u.actionSlotOf);
            const label = parent ? `${parent.name}・行動${u.slotIndex || ''}` : (u.name || '行動');
            const slotClasses = ['unit-card', 'unit-card-subaction', 'action-slot', u.type, isTurn ? 'active-turn' : ''].filter(Boolean).join(' ');
            return `
                <div class="${slotClasses}">
                    <div class="unit-header">
                        <div class="unit-info">
                            <div class="unit-name" title="${escapeHtml(label)}">⚔ ${escapeHtml(label)}</div>
                        </div>
                        <div class="unit-init-box">
                            <span class="unit-init-value">${getEffectiveInit(u)}</span>
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

        // 生成戰術血條：玩家看敵方時改用百分比填充條，否則用固定 6 格 B/L/A 方塊
        // （不論 maxHp 多少，畫面永遠是 6 格 —— 血量越高，一格代表的血量就越多；
        //  每格取其對應 hpArr 區間內「最嚴重」的傷勢，避免傷害被壓縮掉而看不出來）
        let tacticalBar;
        if (hideDetails) {
            const pctCls = hpPercent >= 60 ? 'pct-high' : hpPercent >= 30 ? 'pct-mid' : 'pct-low';
            tacticalBar = `<div class="hp-tactical-percent"><div class="hp-percent-fill ${pctCls}" style="width:${hpPercent}%"></div></div>`;
        } else {
            const segmentCount = 6;
            let tacticalSegments = '';
            for (let i = 0; i < segmentCount; i++) {
                // 此格對應的 hpArr 區間（區間內取最嚴重的傷勢代表這一格）
                const startIdx = Math.floor((i / segmentCount) * maxHp);
                const endIdx = Math.max(startIdx + 1, Math.floor(((i + 1) / segmentCount) * maxHp));
                let hpValue = 0;
                for (let h = startIdx; h < endIdx && h < maxHp; h++) {
                    const v = hpArr[h] !== undefined ? hpArr[h] : 0;
                    if (v > hpValue) hpValue = v;
                }

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
                        <div class="unit-name" title="${escapeHtml(unitName)}">${escapeHtml(unitName)}${hiddenSidebarBadge}</div>
                        <div class="unit-status">${statusTxt}</div>
                    </div>
                    <div class="hp-tactical-container">${tacticalBar}</div>
                    <div class="unit-init-box">
                        <span class="unit-init-value">${getEffectiveInit(u)}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ===== BLA 快速傷害/治療步進器 =====
// 純本地端 UI 暫存（不寫入 state/Firebase），故不會隨其他玩家的操作同步重置；
// 只有「提交」「重置血量」時才清空，讓 +/- 步進不必每次都重算/重繪血條。
let hpPending = {};      // { [unitId]: { b, l, a } } 尚未套用的待套用量
let hpAdjustMode = {};   // { [unitId]: 'damage' | 'heal' }，預設 'damage'（扣血）
let hpHoldTimer = null;
let hpHoldInterval = null;

/**
 * 切換某單位的傷害/治療模式（開關預設扣血，切換後改為治療）。
 * @param {string} unitId
 */
function toggleHpAdjustMode(unitId) {
    hpAdjustMode[unitId] = (hpAdjustMode[unitId] === 'heal') ? 'damage' : 'heal';
    renderUnitsList();
}

/**
 * 滑鼠滾輪切換扣血／治療模式（滑鼠移到模式鈕上滾動即可切換）。
 * @param {WheelEvent} e
 * @param {string} unitId
 */
function wheelHpAdjustMode(e, unitId) {
    e.preventDefault();
    toggleHpAdjustMode(unitId);
}

/**
 * 調整某單位某傷害類型的「待套用量」（不動血量），並直接更新該顯示元素，
 * 避免每次 +/- 都整個單位列表重繪（長按快速輸入時尤其重要）。
 * @param {string} unitId
 * @param {string} type - 'b' | 'l' | 'a'
 * @param {number} delta - +1 或 -1
 */
function hpPendingAdjust(unitId, type, delta) {
    if (!hpPending[unitId]) hpPending[unitId] = { b: 0, l: 0, a: 0 };
    const cur = hpPending[unitId][type] || 0;
    const next = Math.max(0, Math.min(999, cur + delta));
    if (next === cur) return;
    hpPending[unitId][type] = next;
    const el = document.getElementById(`hp-pending-${unitId}-${type}`);
    if (el) el.textContent = next + type.toUpperCase();
}

/**
 * 按住 +/- 按鈕時啟動長按快速輸入：先立即調整一次，短暫延遲後轉為持續重複，
 * 不必一下一下點擊就能快速堆疊出較大的待套用量。
 */
function hpHoldStart(unitId, type, delta) {
    hpHoldStop();
    hpPendingAdjust(unitId, type, delta);
    hpHoldTimer = setTimeout(() => {
        hpHoldInterval = setInterval(() => hpPendingAdjust(unitId, type, delta), 110);
    }, 450);
}

/** 放開或移出按鈕時停止長按重複（pointerup/pointerleave/pointercancel 共用）。 */
function hpHoldStop() {
    if (hpHoldTimer) { clearTimeout(hpHoldTimer); hpHoldTimer = null; }
    if (hpHoldInterval) { clearInterval(hpHoldInterval); hpHoldInterval = null; }
}

/**
 * 提交「待套用量」：依目前扣血/治療開關狀態一次性呼叫 modifyHP()，並清空待套用量。
 * @param {string} unitId
 * @param {string} type - 'b' | 'l' | 'a'
 */
function commitHpPending(unitId, type) {
    const amount = (hpPending[unitId] && hpPending[unitId][type]) || 0;
    if (amount <= 0) return;
    const mode = hpAdjustMode[unitId] || 'damage';
    const dmgType = (mode === 'heal') ? ('heal-' + type) : type;

    hpPending[unitId][type] = 0;
    const el = document.getElementById(`hp-pending-${unitId}-${type}`);
    if (el) el.textContent = '0' + type.toUpperCase();

    modifyHP(unitId, dmgType, amount);
}

// ===== 中央數字：單擊就地輸入 / 雙擊套用 =====
// 一次要扣（或治療）大量血時，用 +/- 逐格太慢；改為單擊中央數字直接把它換成
// 一個小輸入框就地輸入待套用量（不彈出全螢幕的瀏覽器 prompt() 白框），
// 雙擊才真正套用（扣血／治療）。以計時器區分單擊與雙擊：單擊延遲 250ms 後才開始編輯，
// 若期間偵測到第二下（雙擊）則取消編輯、直接套用。
let blaValClickTimer = null;

/**
 * 單擊中央數字：延遲後開始就地輸入（不立即套用血量）。
 * @param {string} unitId
 * @param {string} type - 'b' | 'l' | 'a'
 */
function onStepperValClick(unitId, type) {
    if (blaValClickTimer) { clearTimeout(blaValClickTimer); }
    blaValClickTimer = setTimeout(() => {
        blaValClickTimer = null;
        startStepperInlineEdit(unitId, type);
    }, 250);
}

/**
 * 雙擊中央數字：取消待處理的單擊輸入，直接套用目前待套用量（依扣血／治療模式）。
 * @param {string} unitId
 * @param {string} type - 'b' | 'l' | 'a'
 */
function onStepperValDblClick(unitId, type) {
    if (blaValClickTimer) { clearTimeout(blaValClickTimer); blaValClickTimer = null; }
    commitHpPending(unitId, type);
}

/**
 * 開始就地輸入：把中央數字的 <button> 換成一個小 <input>，focus 並全選，
 * 直接在原位輸入數字（取代原本彈出瀏覽器 prompt() 全螢幕白框的做法）。
 * Enter／失焦即提交，Esc 取消。
 * @param {string} unitId
 * @param {string} type - 'b' | 'l' | 'a'
 */
function startStepperInlineEdit(unitId, type) {
    const u = findUnitById(unitId);
    if (u && !canControlUnit(u)) { showToast('你無法修改其他人的單位'); return; }

    const holder = document.getElementById(`hp-pending-${unitId}-${type}`);
    if (!holder || holder.tagName !== 'BUTTON') return; // 已在編輯中，忽略重複觸發

    const cur = (hpPending[unitId] && hpPending[unitId][type]) || 0;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'stepper-val-input';
    input.id = holder.id;
    input.min = '0';
    input.max = '999';
    input.value = cur;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        else if (e.key === 'Escape') { input.dataset.cancelled = '1'; input.blur(); }
    });
    input.addEventListener('blur', () => finishStepperInlineEdit(unitId, type, input));
    holder.replaceWith(input);
    input.focus();
    input.select();
}

/**
 * 就地輸入結束（失焦／Enter／Esc）：寫回待套用量，並還原成可點擊的數字按鈕。
 * @param {string} unitId
 * @param {string} type - 'b' | 'l' | 'a'
 * @param {HTMLInputElement} input
 */
function finishStepperInlineEdit(unitId, type, input) {
    if (!hpPending[unitId]) hpPending[unitId] = { b: 0, l: 0, a: 0 };
    if (input.dataset.cancelled !== '1') {
        const parsed = parseInt(input.value, 10);
        hpPending[unitId][type] = Math.max(0, Math.min(999, isNaN(parsed) ? 0 : parsed));
    }
    const n = hpPending[unitId][type] || 0;
    const mode = hpAdjustMode[unitId] || 'damage';

    const btn = document.createElement('button');
    btn.className = 'stepper-val';
    btn.id = input.id;
    btn.textContent = n + type.toUpperCase();
    btn.title = `單擊輸入數字、雙擊${mode === 'heal' ? '治療' : '扣血'}套用`;
    btn.addEventListener('click', () => onStepperValClick(unitId, type));
    btn.addEventListener('dblclick', () => onStepperValDblClick(unitId, type));
    input.replaceWith(btn);
}

/** 雙擊 ♻ 重置血量：一併清空該單位尚未提交的待套用量，避免顯示與實際血量脫鉤。 */
function hpResetAll(unitId) {
    hpPending[unitId] = { b: 0, l: 0, a: 0 };
    ['b', 'l', 'a'].forEach(t => {
        const el = document.getElementById(`hp-pending-${unitId}-${t}`);
        if (el) el.textContent = '0' + t.toUpperCase();
    });
    resetUnitHp(unitId);
}

// ===== 生命上限快速調整浮窗（比照狀態層數快速調整浮窗，取代原本置中的 Modal）=====
let maxHpPopoverTarget = null; // unitId

/**
 * 開啟生命上限快速調整浮窗（點擊「HP N」膠囊觸發，定位在點擊處附近）。
 * @param {Event} event
 * @param {string} unitId
 */
function openMaxHpPopover(event, unitId) {
    const u = findUnitById(unitId);
    if (!u) return;
    if (!canControlUnit(u)) { showToast('你無法修改其他人的單位'); return; }
    closeMaxHpPopover();

    maxHpPopoverTarget = unitId;
    const cur = u.maxHp || (u.hpArr || []).length || 10;

    const pop = document.createElement('div');
    pop.id = 'maxhp-quick-popover';
    pop.className = 'status-quick-popover';
    pop.innerHTML = `
        <div class="popover-header">
            <span class="popover-title"><i class="fa-solid fa-heart-circle-check" style="color:var(--accent-yellow);"></i> 生命上限</span>
            <button class="popover-close" onclick="closeMaxHpPopover()">×</button>
        </div>
        <div class="popover-stack-row">
            <button class="popover-stack-btn" onclick="maxHpPopoverAdjust(-5)">−5</button>
            <button class="popover-stack-btn" onclick="maxHpPopoverAdjust(-1)">−</button>
            <input type="number" id="maxhp-popover-input" value="${cur}" min="1" onchange="maxHpPopoverSet(this.value)">
            <button class="popover-stack-btn" onclick="maxHpPopoverAdjust(1)">+</button>
            <button class="popover-stack-btn" onclick="maxHpPopoverAdjust(5)">+5</button>
        </div>
    `;
    document.body.appendChild(pop);

    // 定位在點擊位置附近，並夾限在視窗內（與狀態快速調整浮窗共用同一套邏輯）
    const W = pop.offsetWidth || 220;
    const H = pop.offsetHeight || 90;
    let x = event.clientX - W / 2;
    let y = event.clientY + 12;
    x = Math.max(8, Math.min(window.innerWidth - W - 8, x));
    if (y + H > window.innerHeight - 8) y = event.clientY - H - 12;
    pop.style.left = x + 'px';
    pop.style.top = Math.max(8, y) + 'px';

    setTimeout(armMaxHpPopoverOutsideDismiss, 0);
}

let maxHpPopoverDetach = null;
function armMaxHpPopoverOutsideDismiss() {
    if (maxHpPopoverDetach) { maxHpPopoverDetach(); maxHpPopoverDetach = null; }
    if (typeof attachOutsideDismiss !== 'function') {
        document.addEventListener('pointerdown', handleMaxHpPopoverOutsideClick, true);
        return;
    }
    maxHpPopoverDetach = attachOutsideDismiss(
        (t) => { const pop = document.getElementById('maxhp-quick-popover'); return !pop || !pop.contains(t); },
        () => closeMaxHpPopover()
    );
}

function handleMaxHpPopoverOutsideClick(e) {
    const pop = document.getElementById('maxhp-quick-popover');
    if (pop && !pop.contains(e.target)) closeMaxHpPopover();
}

function closeMaxHpPopover() {
    const pop = document.getElementById('maxhp-quick-popover');
    if (pop) pop.remove();
    maxHpPopoverTarget = null;
    if (maxHpPopoverDetach) { maxHpPopoverDetach(); maxHpPopoverDetach = null; }
    document.removeEventListener('pointerdown', handleMaxHpPopoverOutsideClick, true);
}

/** 浮窗內 −5/−1/+1/+5：即時套用生命上限變更。 */
function maxHpPopoverAdjust(delta) {
    if (!maxHpPopoverTarget) return;
    const u = findUnitById(maxHpPopoverTarget);
    if (!u) { closeMaxHpPopover(); return; }
    const cur = u.maxHp || (u.hpArr || []).length || 10;
    applyMaxHpChange(maxHpPopoverTarget, Math.max(1, cur + delta));
    const input = document.getElementById('maxhp-popover-input');
    const applied = findUnitById(maxHpPopoverTarget);
    if (input && applied) input.value = applied.maxHp;
}

/** 浮窗內直接輸入生命上限數字：即時套用。 */
function maxHpPopoverSet(value) {
    if (!maxHpPopoverTarget) return;
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 1) { showToast('HP 上限必須至少為 1'); return; }
    applyMaxHpChange(maxHpPopoverTarget, parsed);
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
 * 修改「單位名稱」（玩家可改自己的、ST 可改全部）。單位名稱即戰鬥廣播顯示的名字。
 * @param {string} id - 單位 ID
 */
function renameUnit(id) {
    const u = findUnitById(id);
    if (!u) return;
    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }
    const cur = u.name || '';
    const input = prompt('修改單位名稱（戰鬥廣播會顯示這個名字）', cur);
    if (input === null) return;                       // 取消
    const name = input.trim().substring(0, 50);
    if (!name) { showToast('名稱不可空白'); return; }
    if (name === cur) return;

    u.name = name;                                    // 本地樂觀更新
    if (myRole === 'st') {
        broadcastState();
    } else {
        sendToHost({ type: 'renameUnit', playerId: myPlayerId, unitId: id, name });
        renderAll();
    }
    showToast('單位名稱已更新');
}

/**
 * 修改「玩家代號」（僅 ST）。代號用來辨識這是哪位玩家的單位，不影響戰鬥廣播顯示名。
 * @param {string} id - 單位 ID
 */
function renameOwnerCode(id) {
    if (typeof myRole === 'undefined' || myRole !== 'st') {
        showToast('只有 ST 可以修改代號');
        return;
    }
    const u = findUnitById(id);
    if (!u) return;
    const cur = u.ownerName || '';
    const input = prompt('修改玩家代號（僅 ST 可改，用來辨識這是誰的單位）', cur);
    if (input === null) return;
    const code = input.trim().substring(0, 30);
    if (code === cur) return;
    u.ownerName = code;
    broadcastState();
    showToast('玩家代號已更新');
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

    // 清除該單位的 BLA 步進器本地暫存（待套用量/扣血治療模式），避免殘留無主資料
    delete hpPending[id];
    delete hpAdjustMode[id];

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

// ===== 先攻序列滾輪調整 =====
// 單位頁的先攻序列框不可打字，改用滑鼠滾輪 ±1；
// 連續滾動以 400ms 去抖後才提交（updateInit → 廣播），避免每格都觸發一次同步。
const initSeqCommitTimers = {};

/**
 * 產生先攻面板內容：平時只顯示「最終先攻」大數字；
 * 另附一個懸停才顯示的工業風明細方框（基準 / 迅捷 / 束縛 / 最終）。
 * @param {number} base - 基準先攻（u.init）
 * @param {number} adj - 狀態調整（迅捷 − 束縛）
 * @param {number} sw - 迅捷層數
 * @param {number} bd - 束縛層數
 * @returns {string} 面板內部 HTML
 */
function renderInitPanelInner(base, adj, sw, bd) {
    const final = base + adj;
    const rows = [`<div class="uip-row"><span class="uip-k">基準</span><span class="uip-v uip-base">${base}</span></div>`];
    if (sw) rows.push(`<div class="uip-row"><span class="uip-k">迅捷</span><span class="uip-v pos">+${sw}</span></div>`);
    if (bd) rows.push(`<div class="uip-row"><span class="uip-k">束縛</span><span class="uip-v neg">-${bd}</span></div>`);
    rows.push(`<div class="uip-row uip-total"><span class="uip-k">最終先攻</span><span class="uip-v uip-final">${final}</span></div>`);
    return `<div class="uinit-final">${final}</div>`
        + `<div class="uinit-pop"><div class="uip-title">先攻明細 <span class="uip-hint">滾輪調整基準</span></div>${rows.join('')}</div>`;
}

function handleInitSeqWheel(e) {
    const box = e.target && e.target.closest ? e.target.closest('.unit-init-seq') : null;
    if (!box || box.classList.contains('readonly')) return;
    e.preventDefault();
    const id = box.dataset.unitId;
    if (!id) return;
    const dir = e.deltaY > 0 ? -1 : 1;  // 向上滾＝增加
    let next;
    if (box.classList.contains('uinit')) {
        // 新版先攻面板：滾輪只調整「基準先攻」(data-base)，狀態調整值 (data-adj) 維持不變，
        // 即時重算「基準 +（調整） = 最終」的顯示；提交時仍只寫回基準值 (u.init)。
        next = Math.max(-999, Math.min(999, (parseInt(box.dataset.base) || 0) + dir));
        const adj = parseInt(box.dataset.adj) || 0;
        const sw = parseInt(box.dataset.sw) || 0;
        const bd = parseInt(box.dataset.bd) || 0;
        box.dataset.base = next;
        box.innerHTML = renderInitPanelInner(next, adj, sw, bd);
    } else {
        // 舊版純數字框（多重行動子條目等）：直接改文字
        next = Math.max(-999, Math.min(999, (parseInt(box.textContent) || 0) + dir));
        box.textContent = next;
    }
    box.classList.remove('wheel-flash');
    void box.offsetWidth;
    box.classList.add('wheel-flash');
    clearTimeout(initSeqCommitTimers[id]);
    initSeqCommitTimers[id] = setTimeout(() => {
        delete initSeqCommitTimers[id];
        updateInit(id, next);
    }, 400);
}
if (typeof document !== 'undefined') {
    document.addEventListener('wheel', handleInitSeqWheel, { passive: false });
}

// ===== 全體骰先攻（ST）=====
/**
 * 開啟骰先攻 Modal：列出所有單位（可勾選），一鍵擲 1D10 + 先攻加值並自動填入先攻序列。
 */
function openInitRollModal() {
    if (myRole !== 'st') {
        showToast('只有 ST 可以擲全體先攻');
        return;
    }
    const existing = document.getElementById('init-roll-modal');
    if (existing) existing.remove();

    const rows = state.units.map(u => {
        const isSlot = !!u.actionSlotOf;
        const label = isSlot
            ? `${(findUnitById(u.actionSlotOf)?.name) || ''}・行動${u.slotIndex || ''}`
            : (u.name || '未命名');
        const typeTxt = u.type === 'boss' ? 'BOSS' : u.type === 'enemy' ? '敵方' : '我方';
        return `
            <label class="init-roll-row">
                <input type="checkbox" class="ir-check" value="${u.id}" data-type="${u.type}" checked>
                <span class="irr-name">${escapeHtml(label)}</span>
                <span class="irr-bonus">${typeTxt}｜加值 ${u.initBonus || 0}</span>
                <span class="irr-result" id="ir-result-${u.id}">目前 ${u.init || 0}</span>
            </label>`;
    }).join('');

    const html = `
        <div class="modal-overlay show" id="init-roll-modal" onclick="if(event.target.id==='init-roll-modal')closeInitRollModal()">
            <div class="modal" style="max-width:440px;" onclick="event.stopPropagation()">
                <div class="modal-header modal-header--dice">
                    <span style="font-weight:bold;">🎲 全體骰先攻（1D10 + 先攻加值）</span>
                    <button onclick="closeInitRollModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button class="modal-btn" onclick="irSetAll('all')" style="background:var(--bg-card);border:1px solid var(--border);padding:4px 10px;font-size:0.78rem;">全選</button>
                        <button class="modal-btn" onclick="irSetAll('enemy')" style="background:var(--bg-card);border:1px solid var(--border);padding:4px 10px;font-size:0.78rem;">僅敵方/BOSS</button>
                        <button class="modal-btn" onclick="irSetAll('player')" style="background:var(--bg-card);border:1px solid var(--border);padding:4px 10px;font-size:0.78rem;">僅我方</button>
                        <button class="modal-btn" onclick="irSetAll('none')" style="background:var(--bg-card);border:1px solid var(--border);padding:4px 10px;font-size:0.78rem;">清除</button>
                    </div>
                    <div style="max-height:46vh;overflow-y:auto;">${rows || '<div style="color:var(--text-dim);padding:12px;">尚無單位</div>'}</div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeInitRollModal()" style="background:var(--bg-card);">關閉</button>
                    <button class="modal-btn" onclick="rollInitiative()" style="background:var(--accent-green);color:#000;">🎲 擲先攻並填入</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modals-container').insertAdjacentHTML('beforeend', html);
}

function closeInitRollModal() {
    const modal = document.getElementById('init-roll-modal');
    if (modal) modal.remove();
}

/** 快速勾選：all＝全選、enemy＝敵方/BOSS、player＝我方、none＝清除 */
function irSetAll(mode) {
    document.querySelectorAll('#init-roll-modal .ir-check').forEach(c => {
        const t = c.dataset.type;
        if (mode === 'all') c.checked = true;
        else if (mode === 'none') c.checked = false;
        else if (mode === 'enemy') c.checked = (t === 'enemy' || t === 'boss');
        else if (mode === 'player') c.checked = (t === 'player');
    });
}

/** 對勾選單位各擲 1D10 + 先攻加值，寫入先攻序列並廣播。 */
function rollInitiative() {
    if (myRole !== 'st') return;
    const checks = document.querySelectorAll('#init-roll-modal .ir-check:checked');
    if (!checks.length) {
        showToast('未勾選任何單位');
        return;
    }
    let rolled = 0;
    checks.forEach(c => {
        const u = findUnitById(c.value);
        if (!u) return;
        const d10 = Math.floor(Math.random() * 10) + 1;
        const bonus = parseInt(u.initBonus) || 0;
        u.init = d10 + bonus;
        rolled++;
        const cell = document.getElementById('ir-result-' + u.id);
        if (cell) cell.textContent = `${d10}+${bonus} = ${u.init}`;
    });
    broadcastState();
    showToast(`🎲 已為 ${rolled} 個單位擲先攻並填入`);
}

/** 取得單位某狀態（依狀態庫 id 對應的中文名稱）目前的層數，找不到定義或無此狀態時回傳 0。 */
function irGetStatusLayers(unit, statusId) {
    if (!unit || !unit.status) return 0;
    const def = (typeof getStatusById === 'function') ? getStatusById(statusId) : null;
    const name = def ? def.name : null;
    if (!name) return 0;
    return parseInt(unit.status[name]) || 0;
}

/**
 * 「有效先攻」＝先攻序列（1D10＋先攻加值的無狀態基準，戰鬥中不會被狀態動去改動）
 * 再疊加【迅捷】（+層數）／【束縛】（-層數）目前的即時層數。
 * 先攻基準本身刻意不寫入狀態，因為狀態在戰鬥中隨時可能變化——擲骰當下算進去的層數，
 * 下一秒可能就過期；只在「依先攻排序」當下才即時讀取現況，排序永遠反映最新狀態。
 */
function getEffectiveInit(unit) {
    const base = parseInt(unit && unit.init) || 0;
    return base + irGetStatusLayers(unit, 'swiftness') - irGetStatusLayers(unit, 'bind');
}

/**
 * 依先攻排序：以「有效先攻」（先攻序列 + 當下迅捷／束縛層數）排序，
 * 不需要 ST 手動把這兩個狀態換算進先攻數值——每次排序都即時反映目前狀態。
 */
function sortByInit() {
    if (myRole !== 'st') {
        showToast('只有 ST 可以排序');
        return;
    }
    // 記住當前回合的單位 ID，排序後恢復位置
    const currentUnit = state.units[state.turnIdx];
    const currentUnitId = currentUnit ? currentUnit.id : null;

    state.units.sort((a, b) => getEffectiveInit(b) - getEffectiveInit(a));

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

        // 先攻列表輪完一圈 → 新回合（供戰鬥日誌回合分析使用）
        if (state.turnIdx === 0 && state.isCombatActive) {
            state.roundNum = (state.roundNum || 1) + 1;
            showToast(`🔄 第 ${state.roundNum} 回合開始`);
        }

        // 輪到的單位自動護盾回滿
        const activeUnit = state.units[state.turnIdx];
        if (activeUnit && (activeUnit.shieldAutoMax || 0) > 0 && (activeUnit.shieldAuto || 0) < activeUnit.shieldAutoMax) {
            activeUnit.shieldAuto = activeUnit.shieldAutoMax;
            showToast(`🛡 ${activeUnit.name || '單位'} 的自動護盾已回滿（${activeUnit.shieldAutoMax}）`);
        }

        // 輪到的單位移動能量條回滿（本回合可重新移動 floor(移動速度/5) 格）
        if (activeUnit && !activeUnit.actionSlotOf) {
            activeUnit.moveUsed = 0;
        }

        // 防禦附加成功是回合刷新資源：輪到 BOSS 主體（非多重行動子條目）的行動時重置滿額，
        // 而非每次被攻擊都視為全額可用——本回合內被消耗殆盡後要到下回合才會重置。
        if (activeUnit && !activeUnit.actionSlotOf && (activeUnit.defAuto || 0) > 0) {
            activeUnit.defAutoRemaining = activeUnit.defAuto;
        }

        broadcastState();

        // 回合結束狀態結算提醒（燃燒/流血/尖釘等）：
        // BOSS 多重行動的各條目（actionSlotOf 指向本體）僅代表同一回合內的多次行動，
        // 規則上應只在輪到 BOSS 主體的行動結束時結算一次，其餘子行動結束時不結算，
        // 避免同一回合的 DOT 傷害被重複觸發多次。
        const settleUnit = (endingUnit && !endingUnit.actionSlotOf) ? endingUnit : null;
        if (settleUnit) showTurnEndSettlement(settleUnit);

        // 回合開始地形提醒：輪到的單位若站在帶「回合開始」效果的地形上，提示 ST（可套用的數值另由結算面板處理）
        if (activeUnit && !activeUnit.actionSlotOf) {
            const ts = getUnitTerrainTurnEffects(activeUnit).turnStart;
            ts.forEach(t => {
                if (t.kind === 'heal' && t.amount > 0 && typeof modifyHPInternal === 'function') {
                    modifyHPInternal(activeUnit, 'heal', t.amount);
                    broadcastState();
                    showToast(`${activeUnit.name || '單位'}：${t.label}`);
                } else {
                    showToast(`回合開始 ${t.label}`);
                }
            });
        }

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

/**
 * 切換單位的「分享視野」狀態（ST 專用，戰爭迷霧系統）
 * 開啟後，這個單位（例如船隻）周圍的視野會提供給所有玩家，
 * 即使玩家自己的棋子不在場上也能靠它看到迷霧下的地圖。
 * @param {string} id - 單位 ID
 */
function toggleUnitSharedVision(id) {
    if (myRole !== 'st') return;
    const u = findUnitById(id);
    if (!u) return;
    u.sharedVision = !u.sharedVision;
    broadcastState();
    if (typeof fogRenderPanel === 'function') fogRenderPanel();
    if (typeof showToast === 'function') showToast(u.sharedVision ? `已將「${u.name}」的視野分享給全體玩家` : `已取消「${u.name}」的視野分享`);
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
                <div class="modal-header modal-header--info">
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

// ===== 玩家角色數值（三豁免 + 移速） =====
/**
 * 判斷是否為「玩家角色」：我方類型、或已分配給玩家操控（ownerId 非 ST）。
 * 用於決定右鍵選單是否顯示「角色數值」與移動限制是否適用。
 * @param {Object} u - 單位
 * @returns {boolean}
 */
function isPlayerCharacterUnit(u) {
    if (!u) return false;
    return u.type === 'player' || (!!u.ownerId && !String(u.ownerId).startsWith('st_'));
}

/**
 * 開啟「角色數值」Modal：玩家（或 ST）填寫該角色的三豁免與移動速度。
 * 攻擊/防禦 DP 維持戰鬥當下填寫，這裡只保存常駐的角色資料。
 * @param {string} unitId - 單位 ID
 */
function openPlayerStatsModal(unitId) {
    const u = findUnitById(unitId);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    const existing = document.getElementById('player-stats-modal');
    if (existing) existing.remove();

    const html = `
        <div class="modal-overlay show" id="player-stats-modal" onclick="if(event.target.id==='player-stats-modal')closePlayerStatsModal()">
            <div class="modal" style="max-width:380px;" onclick="event.stopPropagation()">
                <div class="modal-header modal-header--info">
                    <span style="font-weight:bold;">📊 角色數值 - ${escapeHtml(u.name || '單位')}</span>
                    <button onclick="closePlayerStatsModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div style="font-size:0.72rem;color:var(--text-dim);margin-bottom:4px;">數值欄支援「A+B」記法：A＝擲骰數、B＝附加成功（例 6+1；無附加填 6 即可）。</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                        <div class="calc-field"><span class="calc-label">意志豁免</span>
                            <input type="text" inputmode="numeric" id="ps-save-will" value="${formatDicePlus(u.saveWill, u.saveWillAuto)}"></div>
                        <div class="calc-field"><span class="calc-label">反射豁免</span>
                            <input type="text" inputmode="numeric" id="ps-save-reflex" value="${formatDicePlus(u.saveReflex, u.saveReflexAuto)}"></div>
                        <div class="calc-field"><span class="calc-label">強韌豁免</span>
                            <input type="text" inputmode="numeric" id="ps-save-tenacity" value="${formatDicePlus(u.saveTenacity, u.saveTenacityAuto)}"></div>
                    </div>
                    <div class="calc-field">
                        <span class="calc-label">措手不及防禦（單方面攻擊等突襲時的較弱防禦，A+B）</span>
                        <input type="text" inputmode="numeric" id="ps-surprise-dp" value="${formatDicePlus(u.surpriseDp, u.surpriseAuto)}"
                               placeholder="例：6+1" title="遭受【單方面攻擊】等措手不及狀況時，系統自動以此值代替防禦 QTE">
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div class="calc-field">
                            <span class="calc-label">移動速度（米）</span>
                            <input type="number" id="ps-move-speed" value="${(u.moveSpeed !== undefined && u.moveSpeed !== null) ? u.moveSpeed : 20}" min="0" max="999">
                        </div>
                        <div class="calc-field">
                            <span class="calc-label">先攻加值</span>
                            <input type="number" id="ps-init-bonus" value="${u.initBonus || 0}" title="骰先攻時 1D10 + 此加值 = 先攻序列">
                        </div>
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-dim);">5 米 = 1 格；每回合可移動 floor(速度/5) 格，斜走 1 格消耗 2。</div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closePlayerStatsModal()" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="savePlayerStats('${u.id}')" style="background:var(--accent-green);color:#000;">儲存</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modals-container').insertAdjacentHTML('beforeend', html);
}

function closePlayerStatsModal() {
    const modal = document.getElementById('player-stats-modal');
    if (modal) modal.remove();
}

/** 儲存角色數值：三豁免與移速寫入單位並同步（玩家經 sendToHost，ST 直接廣播） */
function savePlayerStats(unitId) {
    const u = findUnitById(unitId);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    const clamp = v => Math.max(-999, Math.min(999, parseInt(v) || 0));
    // A+B 記法：豁免與措手不及防禦以「擲骰數(A)＋附加成功(B)」分存兩個欄位
    const readDicePlus = (id) => {
        const p = parseDicePlus(document.getElementById(id)?.value);
        return { dice: clamp(p.dice), auto: Math.max(0, Math.min(999, p.auto)) };
    };
    const will = readDicePlus('ps-save-will');
    const reflex = readDicePlus('ps-save-reflex');
    const tenacity = readDicePlus('ps-save-tenacity');
    const surprise = readDicePlus('ps-surprise-dp');
    const msRaw = parseInt(document.getElementById('ps-move-speed')?.value);
    const moveSpeed = (Number.isFinite(msRaw) && msRaw >= 0) ? Math.min(999, msRaw) : 20;
    const initBonus = clamp(document.getElementById('ps-init-bonus')?.value);

    u.saveWill = will.dice;
    u.saveWillAuto = will.auto;
    u.saveReflex = reflex.dice;
    u.saveReflexAuto = reflex.auto;
    u.saveTenacity = tenacity.dice;
    u.saveTenacityAuto = tenacity.auto;
    u.surpriseDp = surprise.dice;
    u.surpriseAuto = surprise.auto;
    u.moveSpeed = moveSpeed;
    u.initBonus = initBonus;

    if (myRole === 'st') {
        broadcastState();
    } else {
        sendToHost({
            type: 'updatePlayerStats',
            playerId: myPlayerId,
            unitId: unitId,
            saveWill: will.dice,
            saveWillAuto: will.auto,
            saveReflex: reflex.dice,
            saveReflexAuto: reflex.auto,
            saveTenacity: tenacity.dice,
            saveTenacityAuto: tenacity.auto,
            surpriseDp: surprise.dice,
            surpriseAuto: surprise.auto,
            moveSpeed: moveSpeed,
            initBonus: initBonus
        });
        renderAll();
    }
    closePlayerStatsModal();
    showToast(`📊 角色數值已儲存（移速 ${moveSpeed} 米 = 每回合 ${Math.floor(moveSpeed / 5)} 格）`);
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

// 本回合結算面板目前顯示的項目（供 onclick 依索引套用；避免把 closure 塞進 inline onclick）
let _turnEndItems = [];

/**
 * 讀取單位腳下地形的「回合開始／結束」效果，保守解析為可套用項目或純提醒。
 * 僅對少數明確的數值樣式（毒素／B‧L‧A 傷／回 HP）自動套用；其餘一律列為提醒，交由 ST 判斷，
 * 避免對自由文字做武斷解讀。未部署（x<0）或該格無地形時回傳空集合。
 * @param {Object} unit
 * @returns {{turnStart: Array, turnEnd: Array}}
 */
function getUnitTerrainTurnEffects(unit) {
    const out = { turnStart: [], turnEnd: [] };
    if (!unit || typeof unit.x !== 'number' || unit.x < 0 || unit.y < 0) return out;
    const row = (typeof state !== 'undefined' && state.mapData) ? state.mapData[unit.y] : null;
    const tileId = row ? (parseInt(row[unit.x]) || 0) : 0;
    if (!tileId) return out;
    const tile = (typeof getTileFromPalette === 'function') ? getTileFromPalette(tileId) : null;
    if (!tile || !tile.effect) return out;
    return parseTerrainTurnEffects(tile.effect, tile.name || '地形');
}

/**
 * 保守解析地形效果文字，抽出回合開始／結束的數值效果。
 * @param {string} effect - 地形效果描述
 * @param {string} tileName - 地形名稱（顯示用）
 * @returns {{turnStart: Array, turnEnd: Array}}
 */
function parseTerrainTurnEffects(effect, tileName) {
    const out = { turnStart: [], turnEnd: [] };
    const label = (txt) => `🗺 ${tileName}：${txt}`;
    let m;
    if (/回合結束/.test(effect)) {
        // 只對「明確且無條件」的樣式自動套用；帶「若／則」等條件敘述的一律退回純提醒，避免誤判。
        // 毒素／B‧L‧A 傷都要求出現「受」字（排除「扣N意志，若空則NA傷」這類條件式扣血）。
        if ((m = effect.match(/回合結束[^。]*?受(?:到)?\s*(\d+)\s*點?\s*毒素/))) {
            const n = parseInt(m[1]) || 0;
            out.turnEnd.push({ icon: '☠️', kind: 'damage', dmgType: 'l', amount: n, label: label(`受 ${n} 點毒素（L 傷）`) });
        } else if (!/[若則]/.test(effect) && (m = effect.match(/回合結束[^。]*?受(?:到)?\s*(\d+)\s*點?\s*([BLAbla])\s*傷/))) {
            const n = parseInt(m[1]) || 0;
            const dt = m[2].toLowerCase();
            out.turnEnd.push({ icon: '💥', kind: 'damage', dmgType: dt, amount: n, label: label(`受 ${n} 點 ${m[2].toUpperCase()} 傷`) });
        } else if ((m = effect.match(/回合結束[^。]*?流血\s*(\d+)\s*層/))) {
            const n = parseInt(m[1]) || 0;
            out.turnEnd.push({ icon: '🩸', kind: 'status', statusName: '流血', amount: n, label: label(`流血 +${n} 層`) });
        } else {
            out.turnEnd.push({ icon: '🗺', kind: 'remind', label: label(effect) });
        }
    }
    if (/回合開始/.test(effect)) {
        if ((m = effect.match(/回合開始[^。]*?回\s*(\d+)\s*HP/i))) {
            const n = parseInt(m[1]) || 0;
            out.turnStart.push({ icon: '💚', kind: 'heal', amount: n, label: label(`回復 ${n} 點傷害`) });
        } else {
            out.turnStart.push({ icon: '🗺', kind: 'remind', label: label(effect) });
        }
    }
    return out;
}

/**
 * 彙整某單位「回合結束」時所有可結算／提醒的項目：
 *   1) 明確 DOT/治療狀態（燃燒／流血／再生／尖釘）
 *   2) 資料驅動的層數衰減（狀態定義帶 turnEndDecay，如充能／混亂 −1）
 *   3) 腳下地形的回合結束效果（保守解析）
 * @param {Object} unit
 * @returns {Array<{icon,label,kind,statusName?,dmgType?,amount?}>}
 */
function buildTurnEndItems(unit) {
    const items = [];
    if (!unit) return items;
    const status = unit.status || {};

    for (const [name, rule] of Object.entries(TURN_END_RULES)) {
        if (status[name] === undefined) continue;
        const pts = parseInt(status[name]) || 0;
        if (rule.kind !== 'remind' && pts <= 0) continue;
        const def = (typeof getStatusByName === 'function') ? getStatusByName(name) : null;
        items.push({
            icon: def?.icon || '📌', kind: rule.kind, statusName: name, dmgType: rule.dmgType, amount: pts,
            label: `${name} ${rule.kind === 'remind' ? '' : pts}：${rule.desc(pts)}`
        });
    }

    for (const [name, raw] of Object.entries(status)) {
        if (TURN_END_RULES[name]) continue; // 已於上一輪處理
        const def = (typeof getStatusByName === 'function') ? getStatusByName(name) : null;
        const decay = def ? (parseInt(def.turnEndDecay) || 0) : 0;
        if (decay <= 0) continue;
        const cur = parseInt(raw) || 0;
        if (cur <= 0) continue;
        items.push({
            icon: def?.icon || '📌', kind: 'decay', statusName: name, amount: decay,
            label: `${name} ${cur} → ${Math.max(0, cur - decay)}：回合結束 −${decay} 層`
        });
    }

    getUnitTerrainTurnEffects(unit).turnEnd.forEach(t => items.push(t));
    return items;
}

/**
 * 顯示回合結束狀態結算提醒（僅 ST，nextTurn 時觸發）
 * @param {Object} unit - 剛結束回合的單位
 */
function showTurnEndSettlement(unit) {
    if (myRole !== 'st' || !unit) return;

    const items = buildTurnEndItems(unit);
    if (items.length === 0) return;

    closeTurnSettlement();
    _turnEndItems = items;

    const itemsHtml = items.map((item, i) => {
        const actionBtn = item.kind === 'remind'
            ? ''
            : `<button class="settlement-apply-btn" id="settle-btn-${i}"
                   onclick="applyTurnEndItem('${unit.id}', ${i})">套用</button>`;
        return `
            <div class="settlement-item">
                <span class="settlement-label">${item.icon || '📌'} ${escapeHtml(item.label)}</span>
                ${actionBtn}
            </div>
        `;
    }).join('');

    const hasApplicable = items.some(i => i.kind !== 'remind');

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
    _turnEndItems = [];
}

/**
 * 套用單一回合結算項目（依 showTurnEndSettlement 建立的 _turnEndItems 索引）。
 * @param {string} unitId - 單位 ID
 * @param {number} index - 項目索引
 */
function applyTurnEndItem(unitId, index) {
    const u = findUnitById(unitId);
    const item = _turnEndItems[index];
    if (!u || !item) return;

    if (item.kind === 'damage') {
        if (item.amount > 0 && typeof modifyHPInternal === 'function') modifyHPInternal(u, item.dmgType || 'l', item.amount);
        showToast(`${u.name || '單位'}：${item.label}`);
    } else if (item.kind === 'heal') {
        if (item.amount > 0 && typeof modifyHPInternal === 'function') modifyHPInternal(u, 'heal', item.amount);
        showToast(`${u.name || '單位'}：${item.label}`);
    } else if (item.kind === 'decay') {
        if (!u.status || u.status[item.statusName] === undefined) return;
        const cur = parseInt(u.status[item.statusName]) || 0;
        updateStatusStacks(unitId, item.statusName, cur - (item.amount || 1));
        showToast(`${u.name || '單位'}：${item.label}`);
    } else if (item.kind === 'status') {
        // 地形施加的狀態（如流血 +N）：以名稱解析後累加
        const def = (typeof getStatusByName === 'function') ? getStatusByName(item.statusName) : null;
        if (def && typeof addStatusToUnit === 'function') addStatusToUnit(unitId, def.id, item.amount || 1);
        showToast(`${u.name || '單位'}：${item.label}`);
    } else {
        return; // remind：無動作
    }

    broadcastState();

    const btn = document.getElementById('settle-btn-' + index);
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
// 環繞式選單用的極簡白灰線條圖標（單色，隨容器 color 上色）。刻意用細線 SVG 取代
// 彩色 emoji，讓縮到極小時仍清晰、風格統一。
const _ucmSvg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const UCM_ICON = {
    tag:    _ucmSvg('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-6.2-6.2A2 2 0 0 1 3.8 13V5.8a2 2 0 0 1 2-2H13a2 2 0 0 1 1.4.6l6.2 6.2a2 2 0 0 1 0 2.8z"/><circle cx="8" cy="8" r="1.2"/>'),
    pin:    _ucmSvg('<path d="M12 21.5c4-4.6 6.5-8 6.5-11a6.5 6.5 0 1 0-13 0c0 3 2.5 6.4 6.5 11z"/><circle cx="12" cy="10.5" r="2.3"/>'),
    chart:  _ucmSvg('<path d="M5 20V11M12 20V4M19 20v-6"/>'),
    gear:   _ucmSvg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.1 5.1l2.1 2.1M16.8 16.8l2.1 2.1M18.9 5.1l-2.1 2.1M7.2 16.8l-2.1 2.1"/>'),
    eye:    _ucmSvg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.5"/>'),
    eyeOff: _ucmSvg('<path d="M4 4l16 16M9.6 9.7A2.5 2.5 0 0 0 12 14.5c.7 0 1.3-.3 1.8-.7M6.5 6.7C3.8 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.8M10 5.7A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.4 3.2"/>'),
    signal: _ucmSvg('<path d="M4.5 14.5a10 10 0 0 1 15 0M7.5 12a6 6 0 0 1 9 0"/><circle cx="12" cy="17.5" r="1.4"/>'),
    crown:  _ucmSvg('<path d="M4 17.5h16M4.5 17.5l-1.3-9 4.8 3.4L12 5.5l4 6.4 4.8-3.4-1.3 9z"/>'),
    sword:  _ucmSvg('<path d="M20.5 3.5l-9.5 9.5M14 4h6.5V10.5M9 15l-2.5 2.5M4 20l2.5-2.5M4 20l1.5.4M4 20l.4 1.5M11 13l-6.5 6.5"/>'),
    x:      _ucmSvg('<path d="M6 6l12 12M18 6L6 18"/>'),
};

/**
 * 開啟單位快速操作選單（單位卡或地圖 token 按右鍵）
 * @param {Event} event - contextmenu 事件
 * @param {string} unitId - 單位 ID
 */
function openUnitContextMenu(event, unitId, mode) {
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

    // 侵蝕攻擊：玩家自身侵蝕增幅達門檻時，可對「其他玩家」發起威脅（E.G.O 失控打隊友）。
    let canErosionAttack = false;
    if (!isSt && u.type === 'player' && u.ownerId !== myPlayerId && typeof eroCanAttackAllies === 'function') {
        const myUnit = (typeof state !== 'undefined' && Array.isArray(state.units))
            ? state.units.find(x => x.ownerId === myPlayerId) : null;
        canErosionAttack = !!(myUnit && eroCanAttackAllies(myUnit));
    }

    // 既不能控制、也不能攻擊 → 不顯示任何選單
    if (!canControl && !canAttack && !canErosionAttack) return;

    const I = UCM_ICON;
    let items;
    if (canControl && u.actionSlotOf) {
        // 多重行動條目：只提供設定與刪除
        items = [
            { icon: I.gear, label: 'BOSS 設定', fn: `openMultiActionModal('${u.actionSlotOf}')` },
            { icon: I.x, label: '刪除此行動', cls: 'danger', fn: `deleteUnit('${u.id}')` }
        ];
    } else {
        items = [];
        if (canControl) {
            items.push(
                { icon: I.tag, label: '管理狀態', fn: `openStatusModal('${u.id}')` },
                { icon: I.pin, label: deployed ? '收回單位' : '部署單位', fn: deployed ? `recallUnit('${u.id}')` : `startDeploy('${u.id}')` }
            );
            // 玩家角色：填寫三豁免與移速（攻擊/防禦 DP 維持戰鬥當下填寫）
            if (typeof isPlayerCharacterUnit === 'function' && isPlayerCharacterUnit(u)) {
                items.push({ icon: I.chart, label: '角色數值', fn: `openPlayerStatsModal('${u.id}')` });
            }
            if (isSt) {
                // BOSS：戰鬥數值＋多重行動已合併進同一個 Modal，只需一個入口，不必來回切換兩個視窗
                if (u.type === 'boss') {
                    items.push({ icon: I.gear, label: 'BOSS 設定', fn: `openMultiActionModal('${u.id}')` });
                } else if (isBoss || u.type === 'enemy') {
                    items.push({ icon: I.gear, label: '戰鬥數值設定', fn: `openBossUnitModal('${u.id}')` });
                }
                items.push({ icon: u.hidden ? I.eyeOff : I.eye, label: u.hidden ? '現身' : '隱藏', fn: `toggleUnitVisibility('${u.id}')` });
                items.push({ icon: I.signal, label: u.sharedVision ? '取消分享視野' : '分享視野給全員', fn: `toggleUnitSharedVision('${u.id}')` });
                if (isBoss) {
                    items.push({ icon: I.crown, label: state.activeBossId === u.id ? '隱藏 BOSS 血條' : '顯示 BOSS 血條', fn: `toggleActiveBoss('${u.id}')` });
                }
            }
        }
        // ===== 盲盒戰鬥與 QTE 系統：附加戰鬥按鈕（不影響原有操作項目） =====
        if (canAttack) {
            items.push({ icon: I.sword, label: '發起攻擊', fn: `openAttackModal('${u.id}')` });
        } else if (isSt && u.type === 'player') {
            items.push({ icon: I.sword, label: '發起威脅', fn: `openThreatModal('${u.id}')` });
        }
        // 侵蝕攻擊：玩家對其他玩家（達侵蝕門檻時才出現）
        if (canErosionAttack) {
            items.push({ icon: I.sword, label: '🩸 侵蝕攻擊', cls: 'danger', fn: `openErosionAttackModal('${u.id}')` });
        }

        if (canControl) {
            items.push({ icon: I.x, label: '刪除單位', cls: 'danger', fn: `deleteUnit('${u.id}')` });
        }
    }

    if (!items.length) return;

    // ===== 條列式選單：單位頁／側欄的右鍵選單沿用原本的直式清單 =====
    // 只有地圖棋子（mode === 'radial'）才用環繞式；其餘一律條列式。
    if (mode !== 'radial') {
        const menu = document.createElement('div');
        menu.id = 'unit-context-menu';
        menu.className = 'unit-context-menu';
        menu.innerHTML =
            `<div class="ucm-title">${escapeHtml(u.name || '單位')}</div>` +
            items.map(it => `
                <div class="ucm-item ${it.cls || ''}">
                    <span class="ucm-icon">${it.icon}</span>${escapeHtml(it.label)}
                </div>`).join('');
        // 綁定點擊（避免 inline onclick 需處理 SVG 圖標與引號）
        Array.from(menu.querySelectorAll('.ucm-item')).forEach((el, i) => {
            el.addEventListener('click', (ev) => {
                ev.stopPropagation();
                closeUnitContextMenu();
                try { (new Function(items[i].fn))(); } catch (err) { console.warn('選單動作執行失敗', err); }
            });
        });
        document.body.appendChild(menu);

        // 定位在游標附近並夾限在視窗內
        const W = menu.offsetWidth || 170;
        const H = menu.offsetHeight || 280;
        let x = event.clientX, y = event.clientY;
        if (x + W > window.innerWidth - 8) x = window.innerWidth - W - 8;
        if (y + H > window.innerHeight - 8) y = window.innerHeight - H - 8;
        menu.style.left = Math.max(8, x) + 'px';
        menu.style.top = Math.max(8, y) + 'px';

        setTimeout(armUcmOutsideDismiss, 0);
        return;
    }

    // ===== 環繞式選單：以棋子為圓心，極簡白灰圖標環繞展開，帶旋轉切入／切出動畫 =====
    const n = items.length;
    const itemR = 13;                              // 圖標命中半徑（對應 CSS 26px；視覺圖形更小）
    const ringR = 44 + Math.max(0, n - 6) * 6;     // 環半徑：緊貼棋子，項目多時才外擴

    // 圓心：優先對準地圖上的棋子中心，找不到（未部署／隱藏）則退回游標位置
    let cx = event.clientX;
    let cy = event.clientY;
    const tokenEl = document.querySelector(`.token[data-unit-id="${u.id}"]`);
    if (tokenEl) {
        const r = tokenEl.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
    }
    // 夾限圓心，讓整個環（含圖標與標籤）留在視窗內
    const pad = ringR + itemR + 20;
    cx = Math.max(pad, Math.min(window.innerWidth - pad, cx));
    cy = Math.max(pad, Math.min(window.innerHeight - pad, cy));

    const menu = document.createElement('div');
    menu.id = 'unit-context-menu';
    menu.className = 'radial-menu';
    menu.style.left = cx + 'px';
    menu.style.top = cy + 'px';

    // 從正上方（-90°）順時針均分
    items.forEach((it, i) => {
        const ang = -Math.PI / 2 + i * (2 * Math.PI / n);
        const tx = Math.round(Math.cos(ang) * ringR);
        const ty = Math.round(Math.sin(ang) * ringR);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'radial-item ' + (it.cls || '');
        btn.style.setProperty('--tx', tx + 'px');
        btn.style.setProperty('--ty', ty + 'px');
        btn.style.setProperty('--i', i);
        btn.innerHTML = `<span class="ri-icon">${it.icon}</span><span class="radial-label">${escapeHtml(it.label)}</span>`;
        // 點擊：先關閉（播放收合動畫），再執行原本的動作
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            closeUnitContextMenu();
            try { (new Function(it.fn))(); } catch (err) { console.warn('選單動作執行失敗', err); }
        });
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // 觸發展開動畫（下一影格加上 .open，讓 transition 從收合狀態播放到環上）
    requestAnimationFrame(() => {
        requestAnimationFrame(() => menu.classList.add('open'));
    });

    setTimeout(armUcmOutsideDismiss, 0);
}

// 點外面關閉：改用「防誤關」辨識機制——只有在選單外真正點擊（按下＋放開、位移很小）才關閉，
// 避免指標稍微滑出選單、或按下要拖曳地圖時就誤關（環繞選單以棋子為圓心，指標常在其外圍游走）。
let ucmOutsideDetach = null;
function armUcmOutsideDismiss() {
    if (ucmOutsideDetach) { ucmOutsideDetach(); ucmOutsideDetach = null; }
    if (typeof attachOutsideDismiss !== 'function') {
        // 保底：辨識機制未載入時退回原本的 pointerdown 關閉
        document.addEventListener('pointerdown', handleUcmOutsideClick, true);
        return;
    }
    ucmOutsideDetach = attachOutsideDismiss(
        (t) => { const m = document.getElementById('unit-context-menu'); return !m || !m.contains(t); },
        () => closeUnitContextMenu()
    );
}

function handleUcmOutsideClick(e) {
    const menu = document.getElementById('unit-context-menu');
    if (menu && !menu.contains(e.target)) closeUnitContextMenu();
}

function closeUnitContextMenu() {
    const menu = document.getElementById('unit-context-menu');
    if (ucmOutsideDetach) { ucmOutsideDetach(); ucmOutsideDetach = null; }
    document.removeEventListener('pointerdown', handleUcmOutsideClick, true);
    if (!menu) return;
    // 條列式選單：直接移除（無展開動畫）
    if (!menu.classList.contains('radial-menu')) { menu.remove(); return; }
    // 環繞式：若已在關閉中則不重複；播放收合動畫後才真正移除
    if (menu.dataset.closing) return;
    menu.dataset.closing = '1';
    menu.classList.add('closing');
    menu.classList.remove('open');
    setTimeout(() => menu.remove(), 260);
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
// 多重行動編輯暫存：{ bossId, actions: [{ init, dp, statuses:[{id,stacks}] }] }
// actions[0] = 本體（行動1）；其餘對應行動條目。狀態為動態增刪，故以暫存物件管理而非每次讀 DOM。
let maEdit = null;

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

    // 由現有單位資料初始化暫存
    maEdit = { bossId, actions: [] };
    maEdit.actions.push(maReadActionFrom(boss));
    slots.forEach(s => maEdit.actions.push(maReadActionFrom(s)));

    const existing = document.getElementById('multi-action-modal');
    if (existing) existing.remove();

    const html = `
        <div class="float-modal ma-float-panel" id="multi-action-modal">
            <div class="modal-header modal-header--combat" id="ma-float-header">
                <span style="font-weight:bold;">👹 BOSS 設定 - ${escapeHtml(boss.name || '單位')}</span>
                <span class="float-modal-btns">
                    <button class="float-modal-icon-btn" id="ma-collapse-btn" title="收起">▾</button>
                    <button class="float-modal-icon-btn" onclick="closeMultiActionModal()" title="關閉">×</button>
                </span>
            </div>
            <div class="modal-body">
                <!-- 區塊一：戰鬥數值（原獨立的「戰鬥數值設定」Modal，併入同一視窗以免來回切換） -->
                <div class="ma-section-title">👹 戰鬥數值</div>
                <div class="stat-grid cols-3">
                    <label class="stat-field"><span>生命上限</span><input type="number" id="ma-boss-max-hp" value="${boss.maxHp || 1}" min="1"></label>
                    <label class="stat-field"><span>防禦</span><input type="number" id="ma-boss-def-dp" value="${boss.defDp || 0}"></label>
                    <label class="stat-field"><span>防禦附加成功</span><input type="number" id="ma-boss-def-auto" value="${boss.defAuto || 0}"></label>
                </div>
                <div class="stat-field">
                    <span>三豁免（意志 / 反射 / 強韌，A+B：擲骰數+附加成功）</span>
                    <div class="stat-grid cols-3">
                        <input type="text" inputmode="numeric" id="ma-boss-save-will" value="${formatDicePlus(boss.saveWill, boss.saveWillAuto)}" placeholder="意志">
                        <input type="text" inputmode="numeric" id="ma-boss-save-reflex" value="${formatDicePlus(boss.saveReflex, boss.saveReflexAuto)}" placeholder="反射">
                        <input type="text" inputmode="numeric" id="ma-boss-save-tenacity" value="${formatDicePlus(boss.saveTenacity, boss.saveTenacityAuto)}" placeholder="強韌">
                    </div>
                </div>
                <div class="stat-grid cols-3">
                    <label class="stat-field"><span>全屬性</span><input type="number" id="ma-boss-all-attr" value="${boss.allAttr || 0}"></label>
                    <label class="stat-field"><span>全技能</span><input type="number" id="ma-boss-all-skill" value="${boss.allSkill || 0}"></label>
                    <label class="stat-field"><span>支線等級</span><input type="number" id="ma-boss-side-level" value="${boss.sideLevel || 1}" min="1" max="99" title="「對抗分配」修正基數 = 等級 × 10"></label>
                </div>
                <div class="stat-field">
                    <span>被動能力／特性（逐條新增，供 ST 臨場參考）</span>
                    <div id="ma-boss-passive-editor"></div>
                </div>

                <!-- 區塊：部位破壞 / 混亂（Break / Stagger）——嚴重槽填滿 → 一回合混亂 -->
                <div class="ma-section-title">💫 部位破壞 / 混亂</div>
                <div id="ma-stagger-status"></div>

                <!-- 區塊二：多重行動設定（原獨立的「多重行動設定」Modal） -->
                <div class="ma-section-title">⚔ 多重行動設定</div>
                <div class="form-group">
                    <label>總行動次數（含本體，例：七招式 BOSS 填 7）</label>
                    <input type="number" id="ma-count" value="${maEdit.actions.length}" min="1" max="12"
                           onchange="maSetCount(this.value)">
                </div>
                <div id="ma-action-list"></div>
                <datalist id="ma-status-options"></datalist>

                <!-- 對抗分配（先攻對抗計算自動化） -->
                <div class="skill-hud-aoe-section" style="padding:8px; border:1px solid var(--border); margin-top:8px;">
                    <div style="font-weight:bold; color:var(--accent-red); margin-bottom:4px;">🎲 對抗分配</div>
                    <button class="skill-action-btn" style="width:100%;margin-bottom:6px;" onclick="cpStartRound('${bossId}')">開始新輪次：徵詢玩家對抗行動</button>
                    <div id="ma-counter-status" style="font-size:0.78rem;color:var(--text-dim);"></div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn" onclick="removeMultiAction('${bossId}')" style="background:var(--accent-red);">移除全部行動</button>
                <button class="modal-btn" onclick="saveMultiActionAsTemplate('${bossId}')" style="background:var(--accent-purple);color:#fff;margin-right:auto;" title="把目前設定的完整戰鬥數值存為模板，之後套用到其他同類小怪不必重新填一次">💾 存為模板</button>
                <button class="modal-btn" onclick="closeMultiActionModal()" style="background:var(--bg-card);">取消</button>
                <button class="modal-btn" onclick="saveMultiAction('${bossId}')" style="background:var(--accent-green);color:#000;">儲存</button>
            </div>
        </div>
    `;
    document.getElementById('modals-container').insertAdjacentHTML('beforeend', html);
    maBuildStatusDatalist();
    if (typeof initPassiveEditor === 'function') initPassiveEditor('ma-boss-passive-editor', boss.passive);
    renderMultiActionList();
    renderMultiActionCounterStatus();
    renderMultiActionStaggerStatus(bossId);
    // 轉為可拖曳 / 雙擊收起的浮動面板（記憶位置與收合狀態），預設落在右側不擋戰場
    if (typeof makeFloatingPanel === 'function') {
        makeFloatingPanel({
            panelId: 'multi-action-modal',
            headerId: 'ma-float-header',
            collapseBtnId: 'ma-collapse-btn',
            storageKey: 'limbus_boss_setup_panel',
            defaultPos: { x: Math.max(20, window.innerWidth - 400), y: 64 },
            dock: { icon: '👹', title: `BOSS 設定 - ${boss.name || '單位'}` },
        });
    }
}

/**
 * 渲染多重行動 Modal 內的「對抗分配」狀態（counter-phase.js 狀態更新時呼叫）。
 * ST 可用每列的下拉手動指定／改派對抗者（玩家還沒討論好就先點了也能改回來），
 * 調整完按「公佈最終結果」推送給所有玩家並鎖定本輪分配。
 */
function renderMultiActionCounterStatus() {
    const box = document.getElementById('ma-counter-status');
    if (!box) return;
    if (typeof counterPhaseState === 'undefined' || !counterPhaseState.started) {
        box.innerHTML = '尚未開始本輪徵詢';
        return;
    }
    // 只顯示「這隻 BOSS」的徵詢狀態：換一隻 BOSS 開設定視窗時，
    // 不再殘留上一隻 BOSS 的行動與分配，每隻新 BOSS 都從空白開始
    if (maEdit && counterPhaseState.bossId && counterPhaseState.bossId !== maEdit.bossId) {
        box.innerHTML = '此 BOSS 尚未開始徵詢（目前進行中的是其他 BOSS 的輪次；按上方按鈕開始新輪次會重置所有分配）';
        return;
    }
    const actions = counterPhaseState.actions || [];
    const assignments = counterPhaseState.assignments || {};
    const submitted = Object.keys(assignments);
    const finalized = !!counterPhaseState.finalized;

    // 玩家候選清單（每位玩家取其第一個棋子的名稱），供 ST 手動指定對抗者
    const candidates = [];
    const seenOwners = new Set();
    (state.units || []).forEach(u => {
        if (u.type === 'player' && u.ownerId && !u.actionSlotOf && !seenOwners.has(u.ownerId)) {
            seenOwners.add(u.ownerId);
            candidates.push({ id: u.ownerId, name: u.name || u.ownerName || u.ownerId });
        }
    });

    const rows = actions.map(a => {
        const r = (typeof cpResolveActionMod === 'function') ? cpResolveActionMod(a.id) : { playerId: null, playerName: '', mod: 0 };
        const options = ['<option value="">— 無人對抗 —</option>']
            .concat(candidates.map(p =>
                `<option value="${escapeHtml(p.id)}" ${r.playerId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`))
            .join('');
        // 公佈後無人對抗 → 依【單方面攻擊】規則顯示鎖定目標與直接 DP 加值（無視先攻）
        const modTxt = r.playerId
            ? `DP ${r.mod >= 0 ? '+' : ''}${r.mod}`
            : (r.unopposed ? `⚡單方面 DP +${r.mod}` : '');
        const unopposedNote = r.unopposed
            ? `<div class="cp-st-unopposed">⚡ 單方面攻擊：鎖定血量最低的「${escapeHtml(r.victimName || '？')}」，其措手不及（支線+1＝${r.surpriseLevel} 級）</div>`
            : '';
        return `<div class="cp-st-row">
            <span class="cp-st-label">${escapeHtml(a.label)}</span>
            <select onchange="cpSTAssign('${a.id}', this.value)" title="手動指定／改派此行動的對抗者">${options}</select>
            <span class="cp-st-mod">${modTxt}</span>
        </div>${unopposedNote}`;
    }).join('');

    box.innerHTML = `
        <div style="margin-bottom:4px;">已送出 ${submitted.length} 人${finalized ? '｜<span style="color:var(--accent-green);">✅ 已公佈</span>' : ''}</div>
        ${rows}
        <button class="skill-action-btn" style="width:100%;margin-top:6px;" onclick="cpFinalizeRound()" ${finalized ? 'disabled' : ''}>
            ${finalized ? '✅ 已公佈最終結果' : '📢 公佈最終結果給玩家'}
        </button>`;
}

/**
 * 渲染 BOSS 設定面板內的「部位破壞 / 混亂」區塊。
 * 規則【部位破壞 / 混亂】：
 *   1. BOSS 的嚴重槽（每一格 L 以上傷害佔一格）填滿時，陷入一回合混亂、本回合無法行動。
 *      已滿時提供一鍵套用「混亂」狀態，讓全場在單位卡上看得到。
 *   2. 部位破壞（頭部／上肢／軀幹／下肢）：條目尚未開放，僅保留說明。
 * @param {string} bossId - 本體單位 ID
 */
function renderMultiActionStaggerStatus(bossId) {
    const box = document.getElementById('ma-stagger-status');
    if (!box) return;
    const boss = findUnitById(bossId);
    if (!boss) return;
    const maxHp = boss.maxHp || (boss.hpArr || []).length || 0;
    const severe = (typeof countSevereSlots === 'function') ? countSevereSlots(boss) : 0;
    const full = (typeof isSevereGaugeFull === 'function') && isSevereGaugeFull(boss);

    const fullBlock = full ? `
        <div class="ma-stagger-warn">💫 嚴重槽已填滿：依規則 BOSS 陷入一回合混亂，本回合無法行動。</div>
        <button class="skill-action-btn" style="width:100%;margin-top:4px;" onclick="maApplyBossStagger('${bossId}')">💫 套用「混亂」狀態（全場可見）</button>` : '';

    box.innerHTML = `
        <div class="ma-stagger-line${full ? ' is-full' : ''}">嚴重槽：${severe} / ${maxHp}${full ? '（已滿）' : ''}</div>
        ${fullBlock}
        <div class="ma-stagger-note">部位破壞（頭部／上肢／軀幹／下肢，攻擊可改為破壞部位而非削減血條）：此條目尚未開放。</div>`;
}

/** 一鍵對 BOSS 套用 1 層「混亂」狀態（嚴重槽填滿 → 一回合無法行動） */
function maApplyBossStagger(bossId) {
    if (myRole !== 'st') return;
    if (typeof addStatusToUnit === 'function') addStatusToUnit(bossId, 'confusion', 1);
    showToast('💫 已對 BOSS 套用混亂：本回合無法行動（回合結束請手動移除）');
    renderMultiActionStaggerStatus(bossId);
}

/** 從單位讀取行動設定（先攻 / DP / 狀態 / AOE / 豁免抵擋），含舊資料相容 */
function maReadActionFrom(unit) {
    return {
        init: unit.init || 0,
        dp: unit.actionDp || 0,
        statuses: Array.isArray(unit.actionStatuses) ? unit.actionStatuses.map(s => ({ ...s })) : [],
        aoe: !!unit.actionAoe,
        saveResist: !!unit.actionSaveResist,
        saveType: ['saveWill', 'saveReflex', 'saveTenacity'].includes(unit.actionSaveType) ? unit.actionSaveType : 'saveReflex'
    };
}

function closeMultiActionModal() {
    // 面板被程式關閉（儲存/移除）時，若已收納在右緣邊條需一併清掉圖標
    if (typeof PanelDock !== 'undefined') PanelDock.remove('multi-action-modal');
    const modal = document.getElementById('multi-action-modal');
    if (modal) modal.remove();
    maEdit = null;
}

/** 建立狀態名稱自動補全清單（預設庫 + 自訂狀態） */
function maBuildStatusDatalist() {
    const dl = document.getElementById('ma-status-options');
    if (!dl) return;
    const names = [];
    if (typeof getAllStatuses === 'function') getAllStatuses().forEach(s => names.push(s.name));
    if (typeof state !== 'undefined' && Array.isArray(state.customStatuses)) {
        state.customStatuses.forEach(s => { if (s && s.name) names.push(s.name); });
    }
    dl.innerHTML = [...new Set(names)].map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}

/** 調整總行動次數（保留已填資料） */
function maSetCount(value) {
    if (!maEdit) return;
    const count = Math.max(1, Math.min(12, parseInt(value) || 1));
    const cur = maEdit.actions;
    if (count > cur.length) {
        while (maEdit.actions.length < count) maEdit.actions.push({ init: 0, dp: 0, statuses: [], aoe: false, saveResist: false, saveType: 'saveReflex' });
    } else if (count < cur.length) {
        maEdit.actions = cur.slice(0, count);
    }
    const countInput = document.getElementById('ma-count');
    if (countInput) countInput.value = count;
    renderMultiActionList();
}

function maUpdateField(index, field, value) {
    if (!maEdit || !maEdit.actions[index]) return;
    maEdit.actions[index][field] = parseInt(value) || 0;
}

/**
 * 把行動列表目前輸入框的值同步回 maEdit 暫存。
 * 重新渲染或儲存前先呼叫，避免「先攻/DP 輸入後尚未觸發 onchange（未失焦）
 * 就被 innerHTML 重建」導致輸入值默默遺失（AOE 行動 DP 顯示 0 的元凶）。
 */
function maSyncFromDom() {
    if (!maEdit) return;
    maEdit.actions.forEach((a, i) => {
        const initEl = document.getElementById(`ma-init-${i}`);
        const dpEl = document.getElementById(`ma-dp-${i}`);
        const saveTypeEl = document.getElementById(`ma-savetype-${i}`);
        if (initEl) a.init = parseInt(initEl.value) || 0;
        if (dpEl) a.dp = parseInt(dpEl.value) || 0;
        if (saveTypeEl) a.saveType = saveTypeEl.value;
    });
}

/** 切換某行動是否為 AOE 行動（群體效果，不走單體威脅/防禦QTE流程） */
function maToggleAoe(index, checked) {
    if (!maEdit || !maEdit.actions[index]) return;
    maEdit.actions[index].aoe = !!checked;
    // 只更新暫存，不重建列表：勾選框本身已反映新狀態，無需重繪
}

/** 切換某行動是否走「豁免抵擋」結算（開啟後行動卡顯示豁免類型選擇） */
function maToggleSaveResist(index, checked) {
    if (!maEdit || !maEdit.actions[index]) return;
    maEdit.actions[index].saveResist = !!checked;
    // 需要重建列表以顯示/隱藏豁免類型選擇（renderMultiActionList 會先收回輸入值並保留捲動位置）
    renderMultiActionList();
}

/** 更新某行動的豁免類型（豁免抵擋開啟時的下拉選擇） */
function maUpdateSaveType(index, value) {
    if (!maEdit || !maEdit.actions[index]) return;
    maEdit.actions[index].saveType = ['saveWill', 'saveReflex', 'saveTenacity'].includes(value) ? value : 'saveReflex';
}

/** 由輸入框（狀態名稱 + 層數）新增一個狀態到指定行動 */
function maAddStatus(index) {
    if (!maEdit || !maEdit.actions[index]) return;
    const nameInput = document.getElementById('ma-status-name-' + index);
    const stackInput = document.getElementById('ma-status-stack-' + index);
    const raw = (nameInput?.value || '').trim();
    if (!raw) return;
    let def = (typeof getStatusByName === 'function') ? getStatusByName(raw) : null;
    if (!def && typeof getStatusById === 'function') def = getStatusById(raw);
    const id = def ? def.id : raw;
    const stacks = parseInt(stackInput?.value) || 0;
    const existing = maEdit.actions[index].statuses.find(s => s.id === id);
    if (existing) existing.stacks = stacks;
    else maEdit.actions[index].statuses.push({ id, stacks });
    if (nameInput) nameInput.value = '';
    if (stackInput) stackInput.value = '1';
    renderMultiActionList();
}

function maRemoveStatus(index, statusIdx) {
    if (!maEdit || !maEdit.actions[index]) return;
    maEdit.actions[index].statuses.splice(statusIdx, 1);
    renderMultiActionList();
}

function maStatusLabel(s) {
    const name = (typeof getStatusDisplayName === 'function') ? getStatusDisplayName(s.id) : s.id;
    return escapeHtml(name) + (s.stacks > 0 ? ' x' + s.stacks : '');
}

/** 依暫存重新渲染行動列表（先攻/DP/狀態）；重建前同步輸入值並保留捲動位置 */
function renderMultiActionList() {
    const list = document.getElementById('ma-action-list');
    if (!list || !maEdit) return;
    // 先把目前輸入框的值收回暫存（重建 DOM 會丟掉未觸發 onchange 的輸入）
    if (list.children.length) maSyncFromDom();
    // 重建會導致可捲動容器跳回頂端：記住位置，重建後還原
    const scrollBox = list.closest('.modal-body');
    const prevScroll = scrollBox ? scrollBox.scrollTop : 0;
    list.innerHTML = maEdit.actions.map((a, i) => {
        const chips = a.statuses.length
            ? a.statuses.map((s, si) =>
                `<span class="ma-status-chip">${maStatusLabel(s)}<button onclick="maRemoveStatus(${i},${si})" title="移除">×</button></span>`
              ).join('')
            : '<span style="font-size:0.7rem;color:var(--text-dim);">無</span>';
        const saveTypeSelect = a.saveResist ? `
                <label class="ma-f-narrow">豁免
                    <select class="wheel-cycle" id="ma-savetype-${i}" onchange="maUpdateSaveType(${i}, this.value)" title="此行動由目標用哪一項豁免抵擋">
                        <option value="saveReflex" ${a.saveType === 'saveReflex' ? 'selected' : ''}>反射</option>
                        <option value="saveWill" ${a.saveType === 'saveWill' ? 'selected' : ''}>意志</option>
                        <option value="saveTenacity" ${a.saveType === 'saveTenacity' ? 'selected' : ''}>強韌</option>
                    </select>
                </label>` : '';
        return `
        <div class="ma-action-card">
            <div class="ma-action-head">
                行動${i + 1}${i === 0 ? '（本體）' : ''}
                <span style="margin-left:auto;display:inline-flex;align-items:center;">
                <label class="ma-save-switch" title="開啟後此行動改走「豁免抵擋」結算：發起威脅時自動帶入豁免攻擊面板，由目標擲豁免對抗（點擊切換）">
                    <input type="checkbox" ${a.saveResist ? 'checked' : ''} onchange="maToggleSaveResist(${i}, this.checked)">
                    <span class="save-text">豁免抵擋</span>
                    <span class="save-track"></span>
                </label>
                <label class="ma-aoe-switch" title="開啟後此行動視為群體(AOE)效果，以長按 T 鍵的選取模式結算，不會出現在單體威脅快選中（點擊切換）">
                    <input type="checkbox" ${a.aoe ? 'checked' : ''} onchange="maToggleAoe(${i}, this.checked)">
                    <span class="aoe-text">AOE</span>
                    <span class="aoe-track"></span>
                </label>
                </span>
            </div>
            <div class="ma-action-fields">
                <label class="ma-f-narrow">先攻<input type="number" id="ma-init-${i}" value="${a.init}" onchange="maUpdateField(${i},'init',this.value)"></label>
                <label class="ma-f-narrow">DP<input type="number" id="ma-dp-${i}" value="${a.dp}" onchange="maUpdateField(${i},'dp',this.value)"></label>
                ${saveTypeSelect}
                <label class="ma-f-wide">命中施加狀態<input type="text" id="ma-status-name-${i}" list="ma-status-options" placeholder="例：破裂"></label>
            </div>
            <div class="ma-status-row">
                <input type="number" id="ma-status-stack-${i}" value="1" title="層數" style="width:48px;">
                <button class="ma-mini-btn" onclick="maAddStatus(${i})">＋</button>
                <div class="ma-status-chips">${chips}</div>
            </div>
        </div>`;
    }).join('');
    if (scrollBox) scrollBox.scrollTop = prevScroll;
}

/**
 * 儲存多重行動設定：建立/更新/移除行動條目並寫入先攻、DP、狀態
 * @param {string} bossId - 本體單位 ID
 */
function saveMultiAction(bossId) {
    const boss = findUnitById(bossId);
    if (!boss || !maEdit) return;

    // 先把行動列表輸入框的最新值收回暫存（未失焦的輸入也一併保住）
    maSyncFromDom();

    // 戰鬥數值區塊（原獨立的「戰鬥數值設定」Modal，併入同一視窗一併儲存）
    boss.maxHp = Math.max(1, parseInt(document.getElementById('ma-boss-max-hp')?.value) || 1);
    boss.defDp = parseInt(document.getElementById('ma-boss-def-dp')?.value) || 0;
    boss.defAuto = parseInt(document.getElementById('ma-boss-def-auto')?.value) || 0;
    // 與 boss-battle-hud.js 的數值面板一致：儲存時以新 defAuto 重置本回合剩餘資源池，
    // 避免資源池已存在（曾被攻擊）時調整 defAuto 無效
    boss.defAutoRemaining = boss.defAuto;
    // 三豁免 A+B 記法：擲骰數(A)與附加成功(B)分存兩個欄位
    const maWill = parseDicePlus(document.getElementById('ma-boss-save-will')?.value);
    const maReflex = parseDicePlus(document.getElementById('ma-boss-save-reflex')?.value);
    const maTenacity = parseDicePlus(document.getElementById('ma-boss-save-tenacity')?.value);
    boss.saveWill = maWill.dice;
    boss.saveWillAuto = maWill.auto;
    boss.saveReflex = maReflex.dice;
    boss.saveReflexAuto = maReflex.auto;
    boss.saveTenacity = maTenacity.dice;
    boss.saveTenacityAuto = maTenacity.auto;
    boss.allAttr = parseInt(document.getElementById('ma-boss-all-attr')?.value) || 0;
    boss.allSkill = parseInt(document.getElementById('ma-boss-all-skill')?.value) || 0;
    boss.sideLevel = Math.max(1, parseInt(document.getElementById('ma-boss-side-level')?.value) || 1);
    boss.passive = (typeof readPassiveEditor === 'function') ? readPassiveEditor('ma-boss-passive-editor') : (boss.passive || '');
    if (Array.isArray(boss.hpArr) && boss.hpArr.length !== boss.maxHp) {
        const old = boss.hpArr;
        boss.hpArr = Array.from({ length: boss.maxHp }, (_, i) => old[i] || 0);
    }

    const actions = maEdit.actions;
    const count = actions.length;

    // 行動 1 = 本體
    boss.init = actions[0].init;
    boss.actionDp = actions[0].dp;
    boss.actionStatuses = actions[0].statuses.map(s => ({ ...s }));
    boss.actionAoe = !!actions[0].aoe;
    boss.actionSaveResist = !!actions[0].saveResist;
    boss.actionSaveType = actions[0].saveType || 'saveReflex';

    const slots = getActionSlots(bossId);

    // 更新或建立行動 2..count
    for (let i = 1; i < count; i++) {
        const data = actions[i];
        if (slots[i - 1]) {
            slots[i - 1].init = data.init;
            slots[i - 1].actionDp = data.dp;
            slots[i - 1].actionStatuses = data.statuses.map(s => ({ ...s }));
            slots[i - 1].actionAoe = !!data.aoe;
            slots[i - 1].actionSaveResist = !!data.saveResist;
            slots[i - 1].actionSaveType = data.saveType || 'saveReflex';
            slots[i - 1].slotIndex = i + 1;
        } else {
            const slot = createUnit(`${boss.name}・行動${i + 1}`, 1, boss.type);
            slot.actionSlotOf = bossId;
            slot.slotIndex = i + 1;
            slot.init = data.init;
            slot.actionDp = data.dp;
            slot.actionStatuses = data.statuses.map(s => ({ ...s }));
            slot.actionAoe = !!data.aoe;
            slot.actionSaveResist = !!data.saveResist;
            slot.actionSaveType = data.saveType || 'saveReflex';
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
 * 把「BOSS 設定」Modal 目前輸入框的完整資料（基礎欄位＋戰鬥數值＋本體行動 DP/狀態）
 * 另存為「單位模板」，供之後套用到其他同類小怪，不必每隻重新填一次。
 * 讀取的是 Modal 目前輸入框的值（尚未儲存也可先存模板），而非單位物件上的舊值；
 * 多重行動的行動 2 以後（各別行動條目）不納入模板，模板只代表「本體」的一份完整資料卡。
 * @param {string} bossId - 本體單位 ID
 */
function saveMultiActionAsTemplate(bossId) {
    if (myRole !== 'st') return;
    const boss = findUnitById(bossId);
    if (!boss || !maEdit) return;
    maSyncFromDom();
    if (typeof saveUnitTemplate !== 'function') {
        showToast('模板功能不可用');
        return;
    }

    const action0 = maEdit.actions[0] || { dp: 0, statuses: [], aoe: false };
    const templateData = {
        name: boss.name || 'Template',
        hp: Math.max(1, parseInt(document.getElementById('ma-boss-max-hp')?.value) || boss.maxHp || 10),
        type: boss.type || 'enemy',
        size: boss.size || 1,
        avatar: boss.avatar || null,
        combat: {
            defDp: parseInt(document.getElementById('ma-boss-def-dp')?.value) || 0,
            defAuto: parseInt(document.getElementById('ma-boss-def-auto')?.value) || 0,
            initBonus: parseInt(boss.initBonus) || 0,
            init: parseInt(action0.init) || boss.init || 0,
            saveWill: parseDicePlus(document.getElementById('ma-boss-save-will')?.value).dice,
            saveWillAuto: parseDicePlus(document.getElementById('ma-boss-save-will')?.value).auto,
            saveReflex: parseDicePlus(document.getElementById('ma-boss-save-reflex')?.value).dice,
            saveReflexAuto: parseDicePlus(document.getElementById('ma-boss-save-reflex')?.value).auto,
            saveTenacity: parseDicePlus(document.getElementById('ma-boss-save-tenacity')?.value).dice,
            saveTenacityAuto: parseDicePlus(document.getElementById('ma-boss-save-tenacity')?.value).auto,
            allAttr: parseInt(document.getElementById('ma-boss-all-attr')?.value) || 0,
            allSkill: parseInt(document.getElementById('ma-boss-all-skill')?.value) || 0,
            sideLevel: Math.max(1, parseInt(document.getElementById('ma-boss-side-level')?.value) || 1),
            passive: (typeof readPassiveEditor === 'function') ? readPassiveEditor('ma-boss-passive-editor') : (boss.passive || ''),
            actionDp: action0.dp || 0,
            actionAoe: !!action0.aoe,
            actionStatuses: action0.statuses.map(s => ({ ...s })),
            actionNote: boss.actionNote || ''
        }
    };

    // 同名模板存在時詢問是否覆蓋更新（模板可修改：調整數值後重存同名即更新）
    const result = (typeof saveTemplateWithOverwritePrompt === 'function')
        ? saveTemplateWithOverwritePrompt(templateData)
        : (saveUnitTemplate(templateData) ? { template: templateData, updated: false } : null);

    if (result) {
        showToast(`已將「${boss.name || '單位'}」的完整戰鬥數值${result.updated ? '更新' : '存為'}模板：${result.template.name}`);
    } else {
        showToast('儲存模板失敗');
    }
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

/**
 * Limbus Command - Limbus 24 格刻度時鐘與 E.G.O 侵蝕系統（系統 B）
 *
 * 1. 全域 24 格刻度時鐘：Firebase /rooms/{roomId}/clockTicks（預設 24），所有玩家即時可見。
 * 2. E.G.O 侵蝕控制台（ST 專屬）：刻度增減、罪業抽取（負面狀態 → 侵蝕增幅）、暴走 1D2 判定與全場警告廣播、燃盡。
 *
 * 防禦性：所有操作以 typeof / try-catch 防呆，僅 ST 可寫入；絕不影響地圖、單位與既有 Firebase 同步。
 */

const ERO_CLOCK_MAX = 24;
const ERO_STATUS_ID = 'erosion_amplify';
const ERO_STATUS_NAME = '侵蝕增幅';
const ERO_DEFAULT_THRESHOLD = 20;
// 「負面狀態」判定統一委派給 status-config.js 的 isDebuffStatus()，
// 以支援狀態定義明確標記 isDebuff，以及自訂狀態建立時的負面標記。

let eroClockTicks = ERO_CLOCK_MAX;

// ===== Firebase 監聽（由 setupRoomListeners 呼叫） =====
function erosionSetupListener() {
    if (typeof roomRef === 'undefined' || !roomRef) return;
    eroGateUI();

    // 刻度時鐘
    const clockListener = roomRef.child('clockTicks').on('value', snapshot => {
        if (snapshot.exists()) {
            const v = Number(snapshot.val());
            eroClockTicks = Number.isFinite(v) ? Math.max(0, Math.min(ERO_CLOCK_MAX, v)) : ERO_CLOCK_MAX;
        } else {
            eroClockTicks = ERO_CLOCK_MAX;
            // ST 初始化節點
            if (typeof myRole !== 'undefined' && myRole === 'st') {
                roomRef.child('clockTicks').set(ERO_CLOCK_MAX);
            }
        }
        renderClockDisplay();
        if (document.getElementById('erosion-hud') && !document.getElementById('erosion-hud').classList.contains('hidden')) {
            renderErosionConsole();
        }
    });
    if (typeof unsubscribeListeners !== 'undefined') {
        unsubscribeListeners.push(() => roomRef.child('clockTicks').off('value', clockListener));
    }

    // 侵蝕暴走全場警告廣播
    const eroEventListener = roomRef.child('events/erosion').on('value', snapshot => {
        if (snapshot.exists()) handleErosionBroadcast(snapshot.val());
    });
    if (typeof unsubscribeListeners !== 'undefined') {
        unsubscribeListeners.push(() => roomRef.child('events/erosion').off('value', eroEventListener));
    }
}

/** 僅 ST 可見侵蝕控制台的 QAB 開關。 */
function eroGateUI() {
    const isST = (typeof myRole !== 'undefined' && myRole === 'st');
    const item = document.getElementById('qab-erosion-item');
    if (item) item.style.display = isST ? 'flex' : 'none';
}

// ===== 24 格刻度時鐘渲染 =====
function renderClockDisplay() {
    const box = document.getElementById('limbus-clock-display');
    if (!box) return;
    const ticks = eroClockTicks;

    // Circular 24 step logic with conic-gradient
    const percentage = Math.max(0, Math.min(100, (ticks / ERO_CLOCK_MAX) * 100));

    // Create red ring for remaining ticks, dark gray for consumed
    // We add 24 ticks as rotation divisions in css/html
    let ticksHtml = '';
    for(let i=0; i<24; i++) {
        ticksHtml += `<div class="clock-tick" style="transform: rotate(${i * 15}deg);"></div>`;
    }

    const label = (Math.round(ticks * 10) / 10);
    box.innerHTML = `
        <div class="clock-circle-bg" style="background: conic-gradient(from 0deg, #8B0000 0%, #8B0000 ${percentage}%, #111 ${percentage}%, #111 100%);">
            ${ticksHtml}
            <div class="clock-inner">
                <span class="clock-label-number">${label}</span>
            </div>
        </div>
    `;
}

// ===== 侵蝕控制台（ST） =====
function toggleErosionHud() {
    const hud = document.getElementById('erosion-hud');
    if (!hud) return;
    // 若被收納在右緣邊條，開啟時先還原
    if (typeof PanelDock !== 'undefined' && PanelDock.isDocked('erosion-hud')) {
        PanelDock.restore('erosion-hud');
        renderErosionConsole();
        hud.classList.remove('hidden');
        return;
    }
    if (hud.classList.contains('hidden')) {
        renderErosionConsole();
        hud.classList.remove('hidden');
        if (typeof WindowManager !== 'undefined') WindowManager.bringToFront(hud);
    } else {
        hud.classList.add('hidden');
    }
}
function closeErosionHud() {
    const hud = document.getElementById('erosion-hud');
    if (hud) hud.classList.add('hidden');
}

/** 初始化：侵蝕控制台接上通用浮動面板（拖曳／雙擊收起／右緣磁鐵收納） */
function eroInitFloatPanel() {
    if (typeof makeFloatingPanel !== 'function') return;
    makeFloatingPanel({
        panelId: 'erosion-hud',
        headerId: 'erosion-hud-header',
        collapseBtnId: 'erosion-hud-collapse',
        storageKey: 'limbus_erosion_hud_panel',
        defaultPos: { x: Math.max(20, window.innerWidth - 370), y: Math.max(60, window.innerHeight - 560) },
        dock: { icon: '🔥', title: 'E.G.O 侵蝕控制台' },
        restoreDock: true,
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', eroInitFloatPanel);
} else {
    eroInitFloatPanel();
}

/**
 * 以 DOM 節點填充單選 <select>（option 文字用 textContent），避免把 Firebase 來源的
 * 單位名稱經由 innerHTML 注入，杜絕 XSS。
 * @param {string} selectedId - 目前選取的單位 id。
 */
function eroPopulateSelect(selectId, filterFn, selectedId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.textContent = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = '（請選擇）';
    sel.appendChild(ph);
    if (typeof state !== 'undefined' && Array.isArray(state.units)) {
        for (const u of state.units) {
            if (!filterFn(u)) continue;
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.name || '';
            if (u.id === selectedId) opt.selected = true;
            sel.appendChild(opt);
        }
    }
}

/**
 * 以「可點擊複選 chip」取代原生 <select multiple>：原生多選需按住 Ctrl/⌘ 才能多選，
 * 不夠直覺；改成點一下 chip 就切換勾選，體驗與 AOE 選目標／骰先攻勾選一致。
 * 名稱一樣以 DOM 節點 + textContent 填入，避免 innerHTML 注入。
 * @param {string[]} selectedIds - 重繪時保留勾選狀態的單位 id 清單。
 * @param {string} chipClass - 額外的 chip 樣式 class（區分復活／吸收者的強調色）。
 * @param {Function} [onChange] - 勾選狀態變更時的回呼（例如即時刷新暴走閾值顯示）。
 */
function eroPopulateChips(containerId, filterFn, selectedIds, chipClass, onChange) {
    const box = document.getElementById(containerId);
    if (!box) return;
    const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : [selectedIds]);
    box.textContent = '';
    const units = (typeof state !== 'undefined' && Array.isArray(state.units)) ? state.units.filter(filterFn) : [];
    if (!units.length) {
        const empty = document.createElement('span');
        empty.className = 'ero-chip-empty';
        empty.textContent = '（無可選單位）';
        box.appendChild(empty);
        return;
    }
    for (const u of units) {
        const label = document.createElement('label');
        label.className = `ero-chip ${chipClass}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = u.id;
        input.checked = selectedSet.has(u.id);
        if (onChange) input.addEventListener('change', onChange);
        label.appendChild(input);
        label.appendChild(document.createTextNode(u.name || ''));
        box.appendChild(label);
    }
}

/** 取得複選 chip 容器目前所有被勾選的單位 id。 */
function eroGetSelectedValues(containerId) {
    const box = document.getElementById(containerId);
    if (!box) return [];
    return Array.from(box.querySelectorAll('input:checked')).map(i => i.value).filter(Boolean);
}

function eroIsEnemy(u) { return u && (u.type === 'enemy' || u.type === 'boss'); }
function eroIsPlayer(u) { return u && u.type === 'player'; }

/**
 * 「主線給予之支線等級」：侵蝕層數單次消耗上限（補充規則 1）。
 * 優先取作用中 BOSS 的支線等級，否則取場上第一隻本體 BOSS；無 BOSS 時回退 1。
 * @returns {{ level: number, bossName: string }}
 */
function eroSideLevelCap() {
    let boss = null;
    if (typeof state !== 'undefined' && Array.isArray(state.units)) {
        if (state.activeBossId && typeof findUnitById === 'function') boss = findUnitById(state.activeBossId);
        if (!boss) boss = state.units.find(u => u && (u.type === 'boss' || u.isBoss) && !u.actionSlotOf) || null;
    }
    return { level: Math.max(1, (boss && parseInt(boss.sideLevel)) || 1), bossName: (boss && boss.name) || '' };
}

function eroGetErosionLayers(unit) {
    if (!unit || !unit.status) return 0;
    return parseInt(unit.status[ERO_STATUS_NAME]) || 0;
}

function renderErosionConsole() {
    const body = document.getElementById('erosion-hud-body');
    if (!body) return;

    // 保留目前選取，避免重繪時清空
    // 「吸收者」與「復活目標」共用同一份勾選清單：在侵蝕台復活的玩家本來就是吸收罪業的人，不再分開選取。
    const prevSource = document.getElementById('ero-source')?.value || '';
    const prevTargets = eroGetSelectedValues('ero-revive-target');
    const prevThreshold = document.getElementById('ero-threshold')?.value || ERO_DEFAULT_THRESHOLD;
    const prevGain = document.getElementById('ero-gain-amount')?.value || 1;
    const prevConsume = document.getElementById('ero-consume-amount')?.value || 1;

    // 暴走閾值狀態列：多選目標玩家時，僅以第一位作為顯示／判定基準（與單選邏輯相容）
    const firstTargetId = prevTargets[0] || '';
    const absorber = (typeof findUnitById === 'function' && firstTargetId) ? findUnitById(firstTargetId) : null;
    const absorberErosion = eroGetErosionLayers(absorber);
    const threshold = parseInt(prevThreshold, 10) || ERO_DEFAULT_THRESHOLD;
    const overloadReady = absorber && absorberErosion >= threshold;
    // 補充規則 1：單次攻擊可消耗的侵蝕層數上限＝主線給予之支線等級
    const sideCap = eroSideLevelCap();

    body.innerHTML = `
        <div class="ero-section">
            <div class="ero-section-title">🕒 刻度時鐘操作（目前 ${Math.round(eroClockTicks * 10) / 10} / ${ERO_CLOCK_MAX}）</div>
            <div class="ero-btn-row">
                <button class="ero-btn ero-minus" onclick="eroSetClock(-1)">-1 單人復活</button>
                <button class="ero-btn ero-minus" onclick="eroSetClock(-0.5)">-0.5 雙人復活</button>
                <button class="ero-btn ero-minus" onclick="eroSetClock(-6)">-6 全滅</button>
            </div>
            <div class="ero-btn-row">
                <button class="ero-btn ero-plus" onclick="eroSetClock(2)">+2 支線完成</button>
                <button class="ero-btn ero-plus" onclick="eroSetClock(4)">+4 主線完成</button>
                <button class="ero-btn ero-reset" onclick="eroResetClock()">↺ 滿血 (24)</button>
            </div>
            <div class="ero-field" style="margin-top:6px;"><label>獲取刻度：章節首開基因鎖（1階+1、2階+2…）／轉盤獎品向主神兌換</label>
                <div class="ero-gain-row">
                    <input id="ero-gain-amount" class="ero-input" type="number" min="0.5" step="0.5" value="${prevGain}">
                    <button class="ero-btn ero-plus" onclick="eroGainTicks('🧬 基因鎖首開')">🧬 基因鎖首開</button>
                    <button class="ero-btn ero-plus" onclick="eroGainTicks('🎡 轉盤兌換')">🎡 轉盤兌換</button>
                </div>
            </div>
        </div>

        <div class="ero-section">
            <div class="ero-section-title">⛑️🩸 復活／吸收者與刻度連動</div>
            <div class="ero-field"><label>目標玩家（可點多個；同回合多人復活時請一起選取——在此復活的玩家即是抽取罪業時的吸收者，均攤侵蝕層數）</label>
                <div id="ero-revive-target" class="ero-chip-list"></div></div>
            <button class="ero-btn ero-revive" onclick="eroReviveTarget()">⛑️ 復活並重置血量</button>
            <div id="ero-revive-tick-prompt" class="ero-btn-row hidden">
                <button class="ero-btn ero-minus" onclick="eroConfirmReviveTick(-1)">單人 -1</button>
                <button class="ero-btn ero-minus" onclick="eroConfirmReviveTick(-0.5)">多人 -0.5</button>
                <button class="ero-btn ero-minus" onclick="eroConfirmReviveTick(-6)">全滅 -6</button>
            </div>
        </div>

        <div class="ero-section">
            <div class="ero-section-title">🩸 罪業抽取與侵蝕暴走</div>
            <div class="ero-field"><label>來源（敵方）</label>
                <select id="ero-source" class="ero-select"></select></div>
            <div class="ero-field"><label>暴走閾值</label>
                <input id="ero-threshold" class="ero-input" type="number" min="1" value="${threshold}" onchange="renderErosionConsole()"></div>

            <div class="ero-status-line">
                目標玩家目前侵蝕增幅（第一位）：<b class="${overloadReady ? 'ero-over' : ''}">${absorberErosion}</b> / ${threshold}
            </div>

            <button class="ero-btn ero-drain" onclick="eroDrainSin()">🩸 抽取罪業（均攤給上方所有已選目標玩家）</button>

            <div class="ero-subrule">
                <div class="ero-subrule-title">⚔️ 補充規則：攻擊消耗侵蝕層數（尚未進入侵蝕狀態時）</div>
                <div class="ero-field"><label>本次攻擊消耗層數（上限＝主線給予之支線等級 ${sideCap.level}${sideCap.bossName ? `，取自「${sideCap.bossName}」` : ''}；作用於第一位已選目標玩家）</label>
                    <input id="ero-consume-amount" class="ero-input" type="number" min="1" max="${sideCap.level}" value="${prevConsume}"></div>
                <button class="ero-btn ero-consume" onclick="eroConsumeErosion()">⚔️ 消耗層數（該次攻擊受等同層數的減值）</button>
            </div>

            <div class="ero-overload-area">
                <button class="ero-btn ero-roll" onclick="eroRollTarget()" ${overloadReady ? '' : 'disabled'}>
                    🎲 判定侵蝕目標 (1D2)${overloadReady ? '' : '（未達閾值）'}</button>
                <button class="ero-btn ero-burn" onclick="eroBurnOut()">✨ 燃盡（清空侵蝕）</button>
            </div>
            <div class="ero-subrule-note">🛡 補充規則：即將對隊友發動侵蝕攻擊時，該隊友可進行一次「純粹的意志／強韌豁免」（不可燒意志加檢定、不得獲得其他加值），此次傷害減免＝成功數（嚴重傷害）。</div>
        </div>`;

    // 單位下拉以 DOM 填充（名稱用 textContent，避免 innerHTML 注入）
    eroPopulateSelect('ero-source', eroIsEnemy, prevSource);
    // 吸收者與復活目標共用同一份清單：勾選變動時需重繪以更新暴走閾值顯示
    eroPopulateChips('ero-revive-target', eroIsPlayer, prevTargets, 'ero-chip-revive ero-chip-absorber', renderErosionConsole);
}

// ===== 復活並重置血量（與刻度連動） =====
/** 點擊「復活並重置血量」：立即重置所有已選目標玩家的血量（支援同回合多人復活），並彈出刻度扣除快捷選項。 */
function eroReviveTarget() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const targetIds = eroGetSelectedValues('ero-revive-target');
    if (!targetIds.length) { if (typeof showToast === 'function') showToast('請先選擇要復活的目標玩家'); return; }

    targetIds.forEach(id => { if (typeof resetUnitHp === 'function') resetUnitHp(id); });

    const prompt = document.getElementById('ero-revive-tick-prompt');
    if (prompt) prompt.classList.remove('hidden');
}

/** 選擇本次復活扣除的刻度數，直接連動扣除 Firebase 上的 clockTicks。 */
function eroConfirmReviveTick(delta) {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    eroSetClock(delta);
    const prompt = document.getElementById('ero-revive-tick-prompt');
    if (prompt) prompt.classList.add('hidden');
    if (typeof showToast === 'function') showToast(`已復活並扣除 ${Math.abs(Number(delta) || 0)} 刻度`);
}

// ===== 獲取刻度（基因鎖首開 / 轉盤兌換） =====
/**
 * 依輸入的數值增加刻度並廣播來源：
 *   - 🧬 基因鎖首開：章節中首次開啟基因鎖，1 階 +1、2 階 +2，以此類推（輸入＝階級數）
 *   - 🎡 轉盤兌換：以難以言喻的轉盤獎品向主神兌換章節刻度（輸入＝兌換量）
 * @param {string} label - 來源說明（顯示在 toast）
 */
function eroGainTicks(label) {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const v = parseFloat(document.getElementById('ero-gain-amount')?.value) || 0;
    if (v <= 0) { if (typeof showToast === 'function') showToast('請先輸入要增加的刻度數'); return; }
    eroSetClock(v);
    if (typeof showToast === 'function') showToast(`${label}：刻度 +${v}`);
}

// ===== 補充規則 1：攻擊消耗侵蝕層數（尚未進入侵蝕狀態時） =====
/**
 * 玩家具有侵蝕層數、但尚未進入侵蝕（暴走）狀態時，一次攻擊可消耗最多
 * 「主線給予之支線等級」的層數，該次攻擊受到等同消耗層數的減值。
 * 由 ST 在此代為扣除層數；攻擊減值以 toast 提醒 ST 於審核時套用。
 */
function eroConsumeErosion() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const absorberId = eroGetSelectedValues('ero-revive-target')[0] || '';
    const absorber = (typeof findUnitById === 'function') ? findUnitById(absorberId) : null;
    if (!absorber) { if (typeof showToast === 'function') showToast('請先在上方選擇目標玩家'); return; }

    const layers = eroGetErosionLayers(absorber);
    if (layers <= 0) { if (typeof showToast === 'function') showToast('該玩家沒有侵蝕增幅層數'); return; }

    const cap = eroSideLevelCap().level;
    const raw = parseInt(document.getElementById('ero-consume-amount')?.value, 10) || 0;
    const amount = Math.min(raw, cap, layers);
    if (amount <= 0) { if (typeof showToast === 'function') showToast('請輸入要消耗的層數（至少 1）'); return; }

    const remaining = layers - amount;
    if (remaining > 0) absorber.status[ERO_STATUS_NAME] = String(remaining);
    else delete absorber.status[ERO_STATUS_NAME];
    if (typeof syncUnitStatus === 'function') syncUnitStatus(absorberId);

    if (typeof showToast === 'function') {
        showToast(`⚔️ ${absorber.name || '玩家'} 消耗 ${amount} 層侵蝕增幅（剩 ${remaining}）：本次攻擊受 −${amount} 減值`);
    }
    renderErosionConsole();
}

// ===== 刻度操作 =====
function eroWriteClock(next) {
    const clamped = Math.max(0, Math.min(ERO_CLOCK_MAX, Math.round(next * 10) / 10));
    eroClockTicks = clamped;
    if (typeof myRole !== 'undefined' && myRole === 'st' && typeof roomRef !== 'undefined' && roomRef) {
        roomRef.child('clockTicks').set(clamped);
    }
    renderClockDisplay();
    renderErosionConsole();
}
function eroSetClock(delta) { eroWriteClock(eroClockTicks + (Number(delta) || 0)); }
function eroResetClock() { eroWriteClock(ERO_CLOCK_MAX); }

// ===== 罪業抽取 =====
function eroIsDebuffStatusName(name) {
    if (typeof getStatusByName !== 'function' || typeof isDebuffStatus !== 'function') return false;
    const def = getStatusByName(name);
    if (!def) return false;
    if (def.id === ERO_STATUS_ID) return false; // 侵蝕增幅本身不算罪業
    return isDebuffStatus(def.id);
}

function eroDrainSin() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const sourceId = document.getElementById('ero-source')?.value || '';
    const targetIds = eroGetSelectedValues('ero-revive-target');
    if (!sourceId || !targetIds.length) { if (typeof showToast === 'function') showToast('請先選擇來源與目標玩家'); return; }

    const source = (typeof findUnitById === 'function') ? findUnitById(sourceId) : null;
    if (!source || !source.status) { if (typeof showToast === 'function') showToast('來源沒有任何狀態'); return; }

    // 規則：抽取「當下」所有負面狀態層數總和的一半（先加總，只取一次整）。
    const negativeEntries = [];
    let total = 0;
    for (const [name, val] of Object.entries(source.status)) {
        if (!eroIsDebuffStatusName(name)) continue;
        const layers = parseInt(val) || 0;
        if (layers <= 0) continue;
        total += layers;
        negativeEntries.push({ name, layers, removeAmt: 0 });
    }
    if (total <= 0) { if (typeof showToast === 'function') showToast('來源沒有可抽取的負面狀態'); return; }

    const gained = Math.floor(total / 2);
    if (gained <= 0) { if (typeof showToast === 'function') showToast('負面狀態層數不足以抽取（至少需 2 層）'); return; }

    // 先在每個狀態上各自扣「向下取整的一半」，再把因取整流失的尾數依序補回，
    // 使實際扣除總和精確等於 floor(總和 / 2)，不多不少。
    let remainingToRemove = gained;
    for (const entry of negativeEntries) {
        entry.removeAmt = Math.min(entry.layers, Math.floor(entry.layers / 2));
        remainingToRemove -= entry.removeAmt;
    }
    for (const entry of negativeEntries) {
        if (remainingToRemove <= 0) break;
        const extra = Math.min(remainingToRemove, entry.layers - entry.removeAmt);
        entry.removeAmt += extra;
        remainingToRemove -= extra;
    }
    for (const entry of negativeEntries) {
        if (entry.removeAmt <= 0) continue;
        const remaining = entry.layers - entry.removeAmt;
        if (remaining > 0) source.status[entry.name] = String(remaining);
        else delete source.status[entry.name];
    }

    if (typeof syncUnitStatus === 'function') syncUnitStatus(sourceId);

    // 轉化為目標玩家的侵蝕增幅層數：同回合多人復活時，由所有已選目標玩家均攤（無法整除的餘數依序分給前幾位，避免層數憑空消失）
    const perHead = Math.floor(gained / targetIds.length);
    const remainder = gained - perHead * targetIds.length;
    if (gained > 0 && typeof addStatusToUnit === 'function') {
        targetIds.forEach((id, idx) => {
            const amount = perHead + (idx < remainder ? 1 : 0);
            if (amount > 0) addStatusToUnit(id, ERO_STATUS_ID, amount);
        });
    }

    if (typeof showToast === 'function') {
        const splitNote = targetIds.length > 1 ? `（${targetIds.length} 人均攤）` : '';
        showToast(`抽取罪業：來源 ${total} 層負面 → 共 +${gained} 侵蝕增幅${splitNote}`);
    }
    renderErosionConsole();
}

// ===== 暴走 1D2 判定與全場廣播 =====
function eroRollTarget() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const absorberId = eroGetSelectedValues('ero-revive-target')[0] || '';
    const threshold = parseInt(document.getElementById('ero-threshold')?.value, 10) || ERO_DEFAULT_THRESHOLD;
    const absorber = (typeof findUnitById === 'function') ? findUnitById(absorberId) : null;
    if (!absorber) { if (typeof showToast === 'function') showToast('請先選擇目標玩家'); return; }
    if (eroGetErosionLayers(absorber) < threshold) { if (typeof showToast === 'function') showToast('尚未達到暴走閾值'); return; }

    const roll = Math.random() < 0.5 ? 1 : 2;
    const targetSide = roll === 1 ? '敵方' : '友軍';

    if (typeof roomRef !== 'undefined' && roomRef) {
        roomRef.child('events/erosion').set({
            playerName: String(absorber.name || '某玩家'),
            roll,
            targetSide,
            ts: (typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue)
                ? firebase.database.ServerValue.TIMESTAMP : Date.now(),
            nonce: Math.random().toString(36).slice(2)
        });
    }
}

function eroBurnOut() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const absorberId = eroGetSelectedValues('ero-revive-target')[0] || '';
    const absorber = (typeof findUnitById === 'function') ? findUnitById(absorberId) : null;
    if (!absorber || !absorber.status) { if (typeof showToast === 'function') showToast('請先選擇目標玩家'); return; }
    if (!absorber.status[ERO_STATUS_NAME]) { if (typeof showToast === 'function') showToast('該吸收者沒有侵蝕增幅'); return; }
    delete absorber.status[ERO_STATUS_NAME];
    if (typeof syncUnitStatus === 'function') syncUnitStatus(absorberId);
    if (typeof showToast === 'function') showToast(`已燃盡 ${absorber.name} 的侵蝕增幅`);
    renderErosionConsole();
}

// ===== 全場侵蝕警告廣播（所有客戶端） =====
let eroWarningTimer = null;
function handleErosionBroadcast(val) {
    if (!val || !val.playerName) return;
    // 略過加入房間時收到的舊廣播（避免一進房就跳出過期警告）
    if (typeof val.ts === 'number' && (Date.now() - val.ts) > 15000) return;
    const el = document.getElementById('erosion-warning-toast');
    if (!el) return;
    // 補充規則 2：侵蝕攻擊鎖定友軍時，附上「純粹意志／強韌豁免」的減免提醒
    const allySaveHint = (val.targetSide === '友軍')
        ? '（被鎖定的隊友可擲純粹的意志／強韌豁免——不可燒意志、不得加值，每成功數減免 1 點嚴重傷害）'
        : '';
    // 使用 textContent 而非 innerHTML：本身不解析 HTML，從根本杜絕 XSS（含跨客戶端的玩家名稱）
    el.textContent = `⚠️ 警告！【${val.playerName}】發生 E.G.O 侵蝕，鎖定【${val.targetSide || '？'}】發動毀滅打擊！${allySaveHint}`;
    el.classList.add('show');
    clearTimeout(eroWarningTimer);
    eroWarningTimer = setTimeout(() => el.classList.remove('show'), 6000);
}

// ===== Window bindings =====
if (typeof window !== 'undefined') {
    window.erosionSetupListener = erosionSetupListener;
    window.toggleErosionHud = toggleErosionHud;
    window.closeErosionHud = closeErosionHud;
    window.renderErosionConsole = renderErosionConsole;
    window.eroSetClock = eroSetClock;
    window.eroResetClock = eroResetClock;
    window.eroDrainSin = eroDrainSin;
    window.eroGainTicks = eroGainTicks;
    window.eroConsumeErosion = eroConsumeErosion;
    window.eroRollTarget = eroRollTarget;
    window.eroBurnOut = eroBurnOut;
    window.eroReviveTarget = eroReviveTarget;
    window.eroConfirmReviveTick = eroConfirmReviveTick;
    window.handleErosionBroadcast = handleErosionBroadcast;
    window.renderClockDisplay = renderClockDisplay;
}

console.log('🔥 E.G.O 侵蝕系統與刻度時鐘已載入');

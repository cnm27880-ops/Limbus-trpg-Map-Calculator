/**
 * Limbus Command - 人格卡引擎 UI 串接層
 *
 * 職責：
 *  1. 轉接層（adapter）：在「引擎英文狀態鍵」與「網站中文狀態庫」之間互轉，
 *     讓 evaluatePlayerAttack 能讀取實際單位狀態，並把結算結果套用回單位。
 *  2. 人格卡面板（modal）：玩家挑選持有的人格卡、勾選重複抽取解鎖、
 *     指定我方/目標單位，計算疊加後的 DP・武器傷害・附加成功・狀態，
 *     並可一鍵載入到 DP 計算器，或把狀態實際套用到單位上。
 *
 * 依賴（皆以 typeof 防呆，缺少時不致拋錯）：
 *   IDENTITY_LIBRARY / IDENTITY_STATUS_KEYMAP / getIdentityOwners / getIdentitiesByOwner /
 *   getIdentityById / evaluatePlayerAttack / evaluatePlayerTurnStart（資料與引擎層）
 *   getStatusById / addStatusToUnit / findUnitById / state / showToast /
 *   applyAttackToCalc / escapeHtml（既有網站）
 */

// ===== 轉接層 =====

/**
 * 取得引擎英文鍵對應的狀態庫 id。
 * @param {string} engKey
 * @returns {string}
 */
function identityLibIdForKey(engKey) {
    if (typeof IDENTITY_STATUS_KEYMAP !== 'undefined' && IDENTITY_STATUS_KEYMAP[engKey]) {
        return IDENTITY_STATUS_KEYMAP[engKey];
    }
    return engKey;
}

/**
 * 取得引擎英文鍵對應的中文狀態名稱（用於顯示）。
 * @param {string} engKey
 * @returns {string}
 */
function identityStatusName(engKey) {
    const libId = identityLibIdForKey(engKey);
    if (typeof getStatusById === 'function') {
        const def = getStatusById(libId);
        if (def && def.name) return def.name;
    }
    return engKey;
}

/**
 * 將實際單位轉為引擎所需的狀態物件（中文狀態 → 英文鍵層數）。
 * @param {object} unit - state.units 中的單位
 * @param {object} [extra] - 額外覆寫欄位（initiative / initiativeRank / severeFull / notActedThisTurn）
 * @returns {object}
 */
function buildEngineUnitState(unit, extra) {
    const status = {};
    if (unit && unit.status && typeof IDENTITY_STATUS_KEYMAP !== 'undefined') {
        for (const engKey of Object.keys(IDENTITY_STATUS_KEYMAP)) {
            const def = (typeof getStatusById === 'function') ? getStatusById(identityLibIdForKey(engKey)) : null;
            const name = def ? def.name : null;
            if (name && unit.status[name] !== undefined) {
                status[engKey] = parseInt(unit.status[name]) || 0;
            }
        }
    }
    const base = { status, initiative: (unit && unit.init) ? (parseInt(unit.init) || 0) : 0 };
    return Object.assign(base, extra || {});
}

/**
 * 把引擎輸出的狀態（英文鍵 → 層數）實際套用到單位上。
 * @param {string} unitId
 * @param {object} statusMap - 例如 { depression: 6, swiftness: 1 }
 * @returns {number} 實際套用的狀態種類數
 */
function applyEngineStatusesToUnit(unitId, statusMap) {
    if (!statusMap || typeof addStatusToUnit !== 'function') return 0;
    let n = 0;
    for (const [engKey, layers] of Object.entries(statusMap)) {
        const amount = parseInt(layers) || 0;
        if (amount === 0) continue;
        addStatusToUnit(unitId, identityLibIdForKey(engKey), amount);
        n++;
    }
    return n;
}

// ===== 面板狀態 =====

let identityHudState = {
    owner: null,
    cards: {},          // cardId -> { owned: bool, unlocked: bool }
    cardInputs: {},     // cardId -> { key: value }（人格卡的特殊手動資源，如意志力/魔法阿卡納）
    attackerId: null,
    targetId: null,
    atkRank: '',        // 先攻序位（空＝自動依先攻值推算）
    atkSevere: false,   // 我方嚴重槽已滿
    tgtSevere: false,   // 目標嚴重槽已滿
    notActed: false,    // 目標本回合未行動
    lastResult: null
};

// ===== 狀態持久化（保留上次選擇的角色與持有/解鎖，計算結果不保存） =====
const IDENTITY_STATE_KEY = 'limbus-identity-state';

function saveIdentityState() {
    try {
        localStorage.setItem(IDENTITY_STATE_KEY, JSON.stringify({
            owner: identityHudState.owner,
            cards: identityHudState.cards,
            cardInputs: identityHudState.cardInputs
        }));
    } catch (e) { /* ignore */ }
}

function loadIdentityState() {
    try {
        const raw = localStorage.getItem(IDENTITY_STATE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s && typeof s === 'object') {
            if (s.owner) identityHudState.owner = s.owner;
            if (s.cards && typeof s.cards === 'object') identityHudState.cards = s.cards;
            if (s.cardInputs && typeof s.cardInputs === 'object') identityHudState.cardInputs = s.cardInputs;
        }
    } catch (e) { /* ignore */ }
}

/** 設定某張人格卡的手動資源輸入（如當前意志力），並即時重算。 */
function setCardInput(cardId, key, value) {
    if (!identityHudState.cardInputs[cardId]) identityHudState.cardInputs[cardId] = {};
    const num = parseInt(value);
    identityHudState.cardInputs[cardId][key] = isNaN(num) ? 0 : num;
    saveIdentityState();
    refreshIdentityResult();
    // 重繪結果區（提醒可能隨意志力正負而改變），但不重建整個面板以免輸入框失焦
    const resultBox = document.querySelector('#identity-modal .idt-result');
    if (resultBox) resultBox.innerHTML = renderIdentityResult();
}

// ===== 自訂人格卡（使用者打字匯入） =====
const CUSTOM_IDENTITY_KEY = 'limbus-custom-identities';

// 條件可選用的目標狀態（引擎英文鍵 → 中文）
const IDT_STATUS_LABELS = {
    depression: '沮喪', swiftness: '迅捷', bleed: '流血', weak: '虛弱', burn: '燃燒',
    charge: '充能', rupture: '破裂', tremor: '震顫', breathing: '呼吸法', shield: '人民之盾',
    sinking: '沉淪', gale: '疾風', knowledge: '學識', paralyze: '麻痺', stun: '暈眩',
    flaw: '破綻', bind: '束縛', provoke: '挑釁', nails: '尖釘', defenseDown: '防禦等級降低',
    loveHate: '愛/憎', karma: '業'
};

// 編輯中的草稿（null = 未在新增表單）
let identityDraft = null;

function loadCustomIdentities() {
    try {
        const raw = localStorage.getItem(CUSTOM_IDENTITY_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function saveCustomIdentities(arr) {
    try { localStorage.setItem(CUSTOM_IDENTITY_KEY, JSON.stringify(arr)); } catch (e) {}
}

/**
 * 將純資料草稿轉為引擎可用的人格卡（含 condition 函式），並注入 IDENTITY_LIBRARY。
 */
function registerCustomIdentity(raw) {
    if (typeof IDENTITY_LIBRARY === 'undefined' || !raw || !raw.id) return;
    const rules = Array.isArray(raw.rules) ? raw.rules : [];
    const onAttack = rules.map(r => {
        const dp = parseInt(r.dp) || 0;
        const succ = parseInt(r.succ) || 0;
        if (!dp && !succ) return null;
        const key = r.statusKey || '';
        const min = parseInt(r.min) || 0;
        const cond = (key && min > 0)
            ? (t => ((t && t.status && t.status[key]) || 0) >= min)
            : (() => true);
        const e = { condition: cond, source: raw.name, skill: raw.name };
        if (dp) e.dpBonus = dp;
        if (succ) e.extraSuccess = succ;
        return e;
    }).filter(Boolean);

    // 說明文字以「手動效果」掛入，計算時於結果區列出供 ST 參考
    if (raw.desc && raw.desc.trim()) {
        onAttack.push({ manual: true, condition: () => true, desc: raw.desc.trim(), source: raw.name, skill: raw.name });
    }

    IDENTITY_LIBRARY[raw.id] = {
        id: raw.id,
        name: raw.name || '自訂人格卡',
        owner: raw.owner || '自訂',
        custom: true,
        keyStatuses: [...new Set(rules.map(r => r.statusKey).filter(Boolean))],
        hooks: { onAttack }
    };
}

function registerAllCustomIdentities() {
    loadCustomIdentities().forEach(registerCustomIdentity);
}

function deleteCustomIdentity(id) {
    if (!confirm('確定刪除這張自訂人格卡？')) return;
    saveCustomIdentities(loadCustomIdentities().filter(c => c.id !== id));
    if (typeof IDENTITY_LIBRARY !== 'undefined') delete IDENTITY_LIBRARY[id];
    if (identityHudState.cards[id]) delete identityHudState.cards[id];
    const owners = (typeof getIdentityOwners === 'function') ? getIdentityOwners() : [];
    if (!owners.includes(identityHudState.owner)) identityHudState.owner = owners[0] || null;
    renderIdentityModal();
    if (typeof showToast === 'function') showToast('已刪除自訂人格卡');
}

// ===== 新增人格卡表單 =====

function openAddIdentityForm() {
    identityDraft = {
        owner: identityHudState.owner || '',
        name: '',
        desc: '',
        rules: [{ statusKey: '', min: 0, dp: 0, succ: 0 }]
    };
    renderAddIdentityForm();
}

function cancelAddIdentity() {
    identityDraft = null;
    renderIdentityModal();
}

function idtDraftSet(field, value) {
    if (identityDraft) identityDraft[field] = value;
}

function idtDraftAddRule() {
    if (!identityDraft) return;
    identityDraft.rules.push({ statusKey: '', min: 0, dp: 0, succ: 0 });
    renderAddIdentityForm();
}

function idtDraftRemoveRule(i) {
    if (!identityDraft) return;
    identityDraft.rules.splice(i, 1);
    if (identityDraft.rules.length === 0) identityDraft.rules.push({ statusKey: '', min: 0, dp: 0, succ: 0 });
    renderAddIdentityForm();
}

function idtDraftSetRule(i, field, value) {
    if (identityDraft && identityDraft.rules[i]) identityDraft.rules[i][field] = value;
}

function saveNewIdentity() {
    if (!identityDraft) return;
    const owner = (identityDraft.owner || '').trim();
    const name = (identityDraft.name || '').trim();
    if (!owner) { if (typeof showToast === 'function') showToast('請填寫角色名稱'); return; }
    if (!name) { if (typeof showToast === 'function') showToast('請填寫人格卡名稱'); return; }

    const desc = (identityDraft.desc || '').trim();
    const rules = identityDraft.rules
        .map(r => ({ statusKey: r.statusKey || '', min: parseInt(r.min) || 0, dp: parseInt(r.dp) || 0, succ: parseInt(r.succ) || 0 }))
        .filter(r => r.dp || r.succ);

    if (rules.length === 0 && !desc) {
        if (typeof showToast === 'function') showToast('請至少填一條加成（DP 或附加成功），或填寫說明');
        return;
    }

    const raw = {
        id: 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        owner, name, desc, rules
    };

    const arr = loadCustomIdentities();
    arr.push(raw);
    saveCustomIdentities(arr);
    registerCustomIdentity(raw);

    identityDraft = null;
    identityHudState.owner = owner;
    if (typeof selectIdentityOwner === 'function') selectIdentityOwner(owner, true);
    identityHudState.cards[raw.id] = { owned: true, unlocked: false };
    renderIdentityModal();
    if (typeof showToast === 'function') showToast(`已新增人格卡「${name}」`);
}

function renderAddIdentityForm() {
    const el = document.getElementById('identity-modal');
    if (!el || !identityDraft) return;
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);

    const statusOpts = (sel) => '<option value="">（無條件）</option>' +
        Object.entries(IDT_STATUS_LABELS).map(([k, v]) =>
            `<option value="${k}"${k === sel ? ' selected' : ''}>${v}</option>`).join('');

    const rulesHtml = identityDraft.rules.map((r, i) => `
        <div class="idt-rule">
            <div class="idt-rule-cond">
                <span class="idt-rule-label">當目標</span>
                <select class="idt-input idt-rule-status" onchange="idtDraftSetRule(${i},'statusKey',this.value)">${statusOpts(r.statusKey)}</select>
                <span class="idt-rule-label">≥</span>
                <input class="idt-input idt-rule-min" type="number" min="0" value="${r.min || 0}" title="門檻（0＝無條件恆生效）" onchange="idtDraftSetRule(${i},'min',this.value)">
            </div>
            <div class="idt-rule-vals">
                <label>DP 加值<input class="idt-input" type="number" value="${r.dp || 0}" onchange="idtDraftSetRule(${i},'dp',this.value)"></label>
                <label>附加成功<input class="idt-input" type="number" value="${r.succ || 0}" onchange="idtDraftSetRule(${i},'succ',this.value)"></label>
                <button class="idt-btn idt-rule-del" title="刪除此條規則" onclick="idtDraftRemoveRule(${i})">🗑️</button>
            </div>
        </div>`).join('');

    el.innerHTML = `
        <div class="identity-modal-box">
            <div class="idt-header">
                <span>➕ 新增人格卡</span>
                <button class="idt-close" onclick="cancelAddIdentity()">×</button>
            </div>
            <div class="idt-body">
                <div class="idt-section">
                    <div class="idt-field"><label>角色名稱（owner）</label>
                        <input class="idt-input" type="text" value="${esc(identityDraft.owner)}" placeholder="例：格里高爾" oninput="idtDraftSet('owner',this.value)"></div>
                    <div class="idt-field"><label>人格卡名稱</label>
                        <input class="idt-input" type="text" value="${esc(identityDraft.name)}" placeholder="例：自訂・突進斬" oninput="idtDraftSet('name',this.value)"></div>
                    <div class="idt-field"><label>說明（選填；特殊／需擲骰效果寫這裡，計算時列為手動提示）</label>
                        <textarea class="idt-input" rows="2" placeholder="例：擊殺時對全體敵人施加 3 點沮喪" oninput="idtDraftSet('desc',this.value)">${esc(identityDraft.desc)}</textarea></div>
                </div>
                <div class="idt-section">
                    <div class="idt-section-title">攻擊加成規則</div>
                    <div class="idt-rule-hint">每條規則：可選「當目標某狀態達到門檻」時，提供 DP／附加成功加值；門檻填 0＝無條件恆生效。</div>
                    ${rulesHtml}
                    <button class="idt-btn idt-btn-mini" onclick="idtDraftAddRule()">＋ 新增一條規則</button>
                </div>
                <div class="idt-action-row">
                    <button class="idt-btn idt-btn-main" onclick="saveNewIdentity()">💾 儲存人格卡</button>
                    <button class="idt-btn" onclick="cancelAddIdentity()">取消</button>
                </div>
            </div>
        </div>`;
}

// ===== 開關 =====

function openIdentityModal() {
    let el = document.getElementById('identity-modal');
    if (!el) {
        el = document.createElement('div');
        el.id = 'identity-modal';
        el.className = 'identity-modal-overlay';
        el.addEventListener('click', (e) => { if (e.target === el) closeIdentityModal(); });
        document.body.appendChild(el);
    }
    // 沿用上次選擇的角色；若沒有（或先前選的角色已不存在）才退回第一個
    if (typeof getIdentityOwners === 'function') {
        const owners = getIdentityOwners();
        if (!identityHudState.owner || !owners.includes(identityHudState.owner)) {
            if (owners.length) selectIdentityOwner(owners[0], true);
        }
    }
    // 預設我方攻擊者＝自己控制的單位（方便玩家直接開算）
    if (!identityHudState.attackerId && typeof state !== 'undefined' && Array.isArray(state.units)) {
        const mine = (typeof myPlayerId !== 'undefined' && myPlayerId)
            ? state.units.find(u => u.ownerId === myPlayerId) : null;
        if (mine) identityHudState.attackerId = mine.id;
    }
    renderIdentityModal();
    el.style.display = 'flex';
}

function closeIdentityModal() {
    const el = document.getElementById('identity-modal');
    if (el) el.style.display = 'none';
}

function toggleIdentityModal() {
    const el = document.getElementById('identity-modal');
    if (el && el.style.display === 'flex') closeIdentityModal();
    else openIdentityModal();
}

// ===== 選取操作 =====

function selectIdentityOwner(owner, skipRender) {
    // 切換角色時清除上一個角色的結算結果，避免結果面板顯示舊資料
    if (identityHudState.owner !== owner) identityHudState.lastResult = null;
    identityHudState.owner = owner;
    // 初次選此角色 → 預設全部持有、三技未解鎖
    if (typeof getIdentitiesByOwner === 'function') {
        for (const cardId of getIdentitiesByOwner(owner)) {
            if (!identityHudState.cards[cardId]) {
                identityHudState.cards[cardId] = { owned: true, unlocked: false };
            }
        }
    }
    saveIdentityState();
    if (!skipRender) renderIdentityModal();
}

function toggleIdentityCard(cardId) {
    const c = identityHudState.cards[cardId] || (identityHudState.cards[cardId] = { owned: false, unlocked: false });
    c.owned = !c.owned;
    saveIdentityState();
    refreshIdentityResult();
    renderIdentityModal();
}

function toggleIdentityUnlock(cardId) {
    const c = identityHudState.cards[cardId] || (identityHudState.cards[cardId] = { owned: false, unlocked: false });
    c.unlocked = !c.unlocked;
    saveIdentityState();
    refreshIdentityResult();
    renderIdentityModal();
}

/** 設定欄位並（若已有結果）即時重算重繪，供輸入控制項 onchange 使用。 */
function setIdentityField(field, value) {
    identityHudState[field] = value;
}

function updateIdentityField(field, value) {
    identityHudState[field] = value;
    refreshIdentityResult();
    renderIdentityModal();
}

/**
 * 蒐集目前「持有」的人格卡，轉為引擎輸入陣列 [{id, unlocked}]。
 * 僅納入「當前選中角色」名下的卡片，避免切換角色後與前一個角色的選取疊加。
 */
function collectOwnedIdentities() {
    const list = [];
    const ownerCards = (typeof getIdentitiesByOwner === 'function' && identityHudState.owner)
        ? getIdentitiesByOwner(identityHudState.owner) : [];
    for (const cardId of ownerCards) {
        const c = identityHudState.cards[cardId];
        if (c && c.owned) list.push({ id: cardId, unlocked: !!c.unlocked });
    }
    return list;
}

/**
 * 依先攻值自動推算某單位的先攻序位（1 = 最快）。
 */
function autoInitiativeRank(unitId) {
    if (typeof state === 'undefined' || !Array.isArray(state.units)) return 0;
    const sorted = [...state.units].sort((a, b) => (b.init || 0) - (a.init || 0));
    const idx = sorted.findIndex(u => u.id === unitId);
    return idx === -1 ? 0 : idx + 1;
}

// ===== 計算 =====

/**
 * 實際計算疊加結果並寫入 lastResult。
 * @param {boolean} silent - true 時不顯示提示（供輸入變動時的即時重算使用）
 * @returns {boolean} 是否成功算出結果
 */
function computeIdentityResult(silent) {
    if (typeof evaluatePlayerAttack !== 'function') return false;
    const owned = collectOwnedIdentities();
    if (owned.length === 0) {
        identityHudState.lastResult = null;
        if (!silent && typeof showToast === 'function') showToast('請先勾選至少一張持有的人格卡');
        return false;
    }

    const attackerUnit = (typeof findUnitById === 'function' && identityHudState.attackerId)
        ? findUnitById(identityHudState.attackerId) : null;
    const targetUnit = (typeof findUnitById === 'function' && identityHudState.targetId)
        ? findUnitById(identityHudState.targetId) : null;

    const rank = identityHudState.atkRank !== '' ? (parseInt(identityHudState.atkRank) || 0)
        : (identityHudState.attackerId ? autoInitiativeRank(identityHudState.attackerId) : 0);

    const attacker = buildEngineUnitState(attackerUnit, {
        initiativeRank: rank,
        severeFull: !!identityHudState.atkSevere
    });
    const target = buildEngineUnitState(targetUnit, {
        severeFull: !!identityHudState.tgtSevere,
        notActedThisTurn: !!identityHudState.notActed
    });

    // 疊加人格卡的「手動資源輸入」到攻擊者狀態，讓條件/動態數值（如魔法阿卡納層數、
    // 意志力正負判定型態）能據此計算。
    applyManualInputsToAttacker(owned, attacker);

    const result = evaluatePlayerAttack(owned, attacker, target);
    // 附加「資源提醒」（如：暗型態自傷扣血、光型態 -4 意志力），供 ST/玩家確認資源增減
    result.reminders = collectIdentityReminders(owned, attacker, target);
    identityHudState.lastResult = result;
    return true;
}

/**
 * 把持有卡的手動資源輸入覆寫到攻擊者狀態。
 * 對應到引擎狀態鍵（如 arcana / loveHate）者直接寫入 status；其餘自訂鍵（如 will）亦寫入。
 */
function applyManualInputsToAttacker(owned, attacker) {
    if (!attacker.status) attacker.status = {};
    for (const { id } of owned) {
        const card = (typeof getIdentityById === 'function') ? getIdentityById(id) : null;
        if (!card || !Array.isArray(card.manualInputs)) continue;
        const vals = identityHudState.cardInputs[id] || {};
        for (const inp of card.manualInputs) {
            const v = (vals[inp.key] !== undefined) ? vals[inp.key] : (inp.default || 0);
            attacker.status[inp.key] = parseInt(v) || 0;
        }
    }
}

/**
 * 蒐集持有卡的資源提醒：
 *  - 卡片 reminders 陣列（可帶 condition(target, attacker) 決定是否顯示）
 *  - 卡片 formNote（型態／資源機制總說明）恆顯示
 */
function collectIdentityReminders(owned, attacker, target) {
    const out = [];
    for (const { id } of owned) {
        const card = (typeof getIdentityById === 'function') ? getIdentityById(id) : null;
        if (!card) continue;
        if (Array.isArray(card.reminders)) {
            for (const rm of card.reminders) {
                let show = true;
                if (typeof rm.condition === 'function') {
                    try { show = !!rm.condition(target, attacker); } catch (e) { show = false; }
                }
                if (show && rm.text) out.push({ card: card.name, text: rm.text });
            }
        }
        if (card.formNote) out.push({ card: card.name, text: card.formNote, note: true });
    }
    return out;
}

/** 「⚡ 計算」按鈕：計算並重繪（無卡片時提示）。 */
function runIdentityCalc() {
    computeIdentityResult(false);
    renderIdentityModal();
}

/**
 * 即時重算：若已有結算結果，於任何輸入變動後同步更新，
 * 避免面板顯示與目前選擇不符的舊資料。
 */
function refreshIdentityResult() {
    if (identityHudState.lastResult) computeIdentityResult(true);
}

// ===== 套用 =====

function applyIdentityToCalc() {
    const r = identityHudState.lastResult;
    if (!r) return;
    const atk = document.getElementById('c-atk');
    const auto = document.getElementById('c-atk-auto');
    if (atk) atk.value = (parseInt(atk.value) || 0) + (r.totalDpBonus || 0);
    if (auto) auto.value = (parseInt(auto.value) || 0) + (r.totalExtraSuccess || 0);
    if (typeof showToast === 'function') {
        showToast(`已載入計算器：DP +${r.totalDpBonus || 0}、附加成功 +${r.totalExtraSuccess || 0}`);
    }
}

function applyIdentityTargetStatus() {
    const r = identityHudState.lastResult;
    if (!r) return;
    if (!identityHudState.targetId) { if (typeof showToast === 'function') showToast('請先指定目標單位'); return; }
    const n = applyEngineStatusesToUnit(identityHudState.targetId, r.expectedTargetStatus);
    if (typeof showToast === 'function') showToast(n ? `已對目標套用 ${n} 種狀態` : '無可套用的目標狀態');
}

function applyIdentitySelfStatus() {
    const r = identityHudState.lastResult;
    if (!r) return;
    if (!identityHudState.attackerId) { if (typeof showToast === 'function') showToast('請先指定我方單位'); return; }
    const n = applyEngineStatusesToUnit(identityHudState.attackerId, r.expectedSelfStatus);
    if (typeof showToast === 'function') showToast(n ? `已對我方套用 ${n} 種狀態` : '無可套用的自身狀態');
}

function runIdentityTurnStart() {
    if (typeof evaluatePlayerTurnStart !== 'function') return;
    if (!identityHudState.attackerId) { if (typeof showToast === 'function') showToast('請先指定我方單位'); return; }
    const owned = collectOwnedIdentities();
    const attackerUnit = (typeof findUnitById === 'function') ? findUnitById(identityHudState.attackerId) : null;
    const res = evaluatePlayerTurnStart(owned, buildEngineUnitState(attackerUnit));
    const n = applyEngineStatusesToUnit(identityHudState.attackerId, res.expectedSelfStatus);
    if (typeof showToast === 'function') {
        showToast(n ? `回合開始：已對我方套用 ${n} 種資源` : '本組人格卡無回合開始資源');
    }
}

// ===== 渲染 =====

function renderIdentityUnitOptions(selectedId) {
    let opts = '<option value="">（未指定）</option>';
    if (typeof state !== 'undefined' && Array.isArray(state.units)) {
        for (const u of state.units) {
            const sel = (u.id === selectedId) ? ' selected' : '';
            const tag = (u.type === 'enemy') ? '🔴' : '🔵';
            const safe = (typeof escapeHtml === 'function') ? escapeHtml(u.name || '') : (u.name || '');
            opts += `<option value="${u.id}"${sel}>${tag} ${safe}（先攻 ${u.init || 0}）</option>`;
        }
    }
    return opts;
}

function renderIdentityCardList() {
    if (typeof getIdentitiesByOwner !== 'function' || !identityHudState.owner) return '';
    const ids = getIdentitiesByOwner(identityHudState.owner);
    return ids.map(cardId => {
        const card = (typeof getIdentityById === 'function') ? getIdentityById(cardId) : null;
        if (!card) return '';
        const c = identityHudState.cards[cardId] || { owned: false, unlocked: false };
        const name = (typeof escapeHtml === 'function') ? escapeHtml(card.name) : card.name;
        const unlockName = card.repeatUnlockSkill ? ((typeof escapeHtml === 'function') ? escapeHtml(card.repeatUnlockSkill) : card.repeatUnlockSkill) : '';
        const unlockCtrl = card.repeatUnlockSkill ? `
            <label class="idt-unlock ${c.owned ? '' : 'idt-disabled'}">
                <input type="checkbox" ${c.unlocked ? 'checked' : ''} ${c.owned ? '' : 'disabled'}
                       onchange="toggleIdentityUnlock('${cardId}')">
                <span>解鎖三技：${unlockName}</span>
            </label>` : '<span class="idt-no-unlock">（無重複抽取技）</span>';
        const delCtrl = card.custom
            ? `<button class="idt-card-del" title="刪除自訂人格卡" onclick="deleteCustomIdentity('${cardId}')">🗑️ 刪除</button>`
            : '';
        return `
            <div class="idt-card ${c.owned ? 'idt-owned' : ''}">
                <label class="idt-own">
                    <input type="checkbox" ${c.owned ? 'checked' : ''} onchange="toggleIdentityCard('${cardId}')">
                    <span class="idt-card-name">${name}${card.custom ? ' <span class="idt-custom-tag">自訂</span>' : ''}</span>
                </label>
                ${unlockCtrl}
                ${delCtrl}
            </div>`;
    }).join('');
}

/**
 * 渲染「特殊資源」區：列出所有持有卡所宣告的手動輸入欄位（如當前意志力、魔法阿卡納層數）。
 * 沒有任何持有卡需要手動輸入時，整段不顯示。
 */
function renderIdentityManualInputs() {
    const owned = collectOwnedIdentities();
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);
    let rows = '';
    for (const { id } of owned) {
        const card = (typeof getIdentityById === 'function') ? getIdentityById(id) : null;
        if (!card || !Array.isArray(card.manualInputs) || card.manualInputs.length === 0) continue;
        const vals = identityHudState.cardInputs[id] || {};
        const fields = card.manualInputs.map(inp => {
            const v = (vals[inp.key] !== undefined) ? vals[inp.key] : (inp.default || 0);
            const hint = inp.hint ? `<span class="idt-mi-hint">${esc(inp.hint)}</span>` : '';
            return `<label class="idt-mi-field">
                        <span class="idt-mi-label">${esc(inp.label)}${hint}</span>
                        <input class="idt-input" type="number" value="${esc(String(v))}"
                               onchange="setCardInput('${id}','${inp.key}',this.value)">
                    </label>`;
        }).join('');
        rows += `<div class="idt-mi-card"><div class="idt-mi-card-name">${esc(card.name)}</div>${fields}</div>`;
    }
    if (!rows) return '';
    return `
        <div class="idt-section">
            <div class="idt-section-title">②‧5 特殊資源（依持有人格卡填寫）</div>
            <div class="idt-mi-hint-top">部分人格卡的效果依「玩家自身資源」變動（如意志力、魔法阿卡納層數），請在此填入當前數值以正確計算。</div>
            ${rows}
        </div>`;
}

function renderIdentityResult() {
    const r = identityHudState.lastResult;
    if (!r) return '<div class="idt-result-empty">設定完成後按「⚡ 計算疊加效果」</div>';

    const bonusRows = [
        ['DP 加值', r.totalDpBonus],
        ['武器傷害', r.totalWeaponDamage],
        ['附加成功', r.totalExtraSuccess],
        ['法術威力', r.totalSpellPower],
        ['最終傷害', r.totalFinalDamage]
    ].filter(([, v]) => (v || 0) !== 0)
     .map(([k, v]) => `<div class="idt-bonus"><span>${k}</span><b>+${v}</b></div>`).join('');

    const fmtStatus = (m) => Object.entries(m || {})
        .map(([k, v]) => {
            const name = identityStatusName(k);
            if (typeof v !== 'number') return `${name}（${v}）`;
            return `${name} ${v >= 0 ? '+' : ''}${v}`;
        }).join('、');
    const tgtStatus = fmtStatus(r.expectedTargetStatus);
    const selfStatus = fmtStatus(r.expectedSelfStatus);

    const autoLogs = r.triggerLogs.filter(l => !l.manual);
    const manualLogs = r.triggerLogs.filter(l => l.manual);

    const logRow = (l) => {
        const parts = [];
        if (l.dpBonus) parts.push(`DP+${l.dpBonus}`);
        if (l.weaponDamage) parts.push(`武器+${l.weaponDamage}`);
        if (l.extraSuccess) parts.push(`附加成功+${l.extraSuccess}`);
        if (l.spellPower) parts.push(`威力+${l.spellPower}`);
        if (l.finalDamage) parts.push(`最終傷害+${l.finalDamage}`);
        if (l.targetStatus) parts.push('→敵：' + fmtStatus(resolveLogStatus(l.targetStatus, r)));
        if (l.selfStatus) parts.push('→己：' + fmtStatus(resolveLogStatus(l.selfStatus, r)));
        const src = (typeof escapeHtml === 'function') ? escapeHtml(l.source || '') : (l.source || '');
        const phase = l.phase === 'attack' ? '攻擊' : (l.phase === 'hit' ? '命中' : l.phase);
        return `<div class="idt-log"><span class="idt-log-src">[${phase}] ${src}</span><span class="idt-log-eff">${parts.join('，')}</span></div>`;
    };

    let html = '';
    if (bonusRows) html += `<div class="idt-bonus-row">${bonusRows}</div>`;
    if (tgtStatus) html += `<div class="idt-statline">🎯 預計施加目標：<b>${tgtStatus}</b></div>`;
    if (selfStatus) html += `<div class="idt-statline">🔵 預計施加自身：<b>${selfStatus}</b></div>`;

    html += '<div class="idt-apply-row">'
        + '<button class="idt-btn idt-btn-mini" onclick="applyIdentityToCalc()">📥 載入計算器</button>'
        + '<button class="idt-btn idt-btn-mini" onclick="applyIdentityTargetStatus()">🎯 套用目標狀態</button>'
        + '<button class="idt-btn idt-btn-mini" onclick="applyIdentitySelfStatus()">🔵 套用自身狀態</button>'
        + '</div>';

    if (autoLogs.length) {
        html += '<div class="idt-log-title">觸發明細</div>' + autoLogs.map(logRow).join('');
    }
    if (manualLogs.length) {
        html += '<div class="idt-log-title idt-manual-title">⚠ 需手動判定（擲骰／指定友軍／特殊結算）</div>';
        html += manualLogs.map(l => {
            const src = (typeof escapeHtml === 'function') ? escapeHtml(l.source || '') : (l.source || '');
            const desc = (typeof escapeHtml === 'function') ? escapeHtml(l.desc || '') : (l.desc || '');
            return `<div class="idt-log idt-manual"><span class="idt-log-src">${src}</span><span class="idt-log-eff">${desc}</span></div>`;
        }).join('');
    }
    if (Array.isArray(r.reminders) && r.reminders.length) {
        const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);
        html += '<div class="idt-log-title idt-remind-title">💠 資源提醒（血量／意志力／型態）</div>';
        html += r.reminders.map(rm =>
            `<div class="idt-remind ${rm.note ? 'idt-remind-note' : ''}">${esc(rm.text)}</div>`).join('');
    }
    return html;
}

// 觸發明細中的狀態欄位可能含函式（動態層數）；以最終累積值無法逐條還原，
// 故此處對「數字層數」直接顯示，函式層數則顯示為動態標記。
function resolveLogStatus(map, result) {
    const out = {};
    for (const [k, v] of Object.entries(map || {})) {
        out[k] = (typeof v === 'function') ? '動態' : v;
    }
    return out;
}

function renderIdentityModal() {
    const el = document.getElementById('identity-modal');
    if (!el) return;

    const owners = (typeof getIdentityOwners === 'function') ? getIdentityOwners() : [];
    const ownerOpts = owners.map(o => {
        const sel = o === identityHudState.owner ? ' selected' : '';
        const safe = (typeof escapeHtml === 'function') ? escapeHtml(o) : o;
        return `<option value="${safe}"${sel}>${safe}</option>`;
    }).join('');

    el.innerHTML = `
        <div class="identity-modal-box">
            <div class="idt-header">
                <span>🃏 人格卡引擎</span>
                <div class="idt-header-actions">
                    <button class="idt-add-btn" title="新增自訂人格卡" onclick="openAddIdentityForm()">＋</button>
                    <button class="idt-close" onclick="closeIdentityModal()">×</button>
                </div>
            </div>
            <div class="idt-body">
                <div class="idt-section">
                    <div class="idt-section-title">① 選擇角色與持有的人格卡</div>
                    <select class="idt-select" onchange="selectIdentityOwner(this.value)">${ownerOpts}</select>
                    <div class="idt-card-list">${renderIdentityCardList()}</div>
                </div>

                <div class="idt-section">
                    <div class="idt-section-title">② 指定單位與條件</div>
                    <div class="idt-field"><label>我方（攻擊者）</label>
                        <select class="idt-select" onchange="updateIdentityField('attackerId', this.value)">${renderIdentityUnitOptions(identityHudState.attackerId)}</select>
                    </div>
                    <div class="idt-field"><label>目標（敵方）</label>
                        <select class="idt-select" onchange="updateIdentityField('targetId', this.value)">${renderIdentityUnitOptions(identityHudState.targetId)}</select>
                    </div>
                    <div class="idt-field"><label>先攻序位（空＝自動）</label>
                        <input class="idt-input" type="number" min="1" placeholder="自動" value="${identityHudState.atkRank}"
                               onchange="updateIdentityField('atkRank', this.value)">
                    </div>
                    <div class="idt-checks">
                        <label><input type="checkbox" ${identityHudState.atkSevere ? 'checked' : ''} onchange="updateIdentityField('atkSevere', this.checked)"> 我方嚴重槽已滿</label>
                        <label><input type="checkbox" ${identityHudState.tgtSevere ? 'checked' : ''} onchange="updateIdentityField('tgtSevere', this.checked)"> 目標嚴重槽已滿</label>
                        <label><input type="checkbox" ${identityHudState.notActed ? 'checked' : ''} onchange="updateIdentityField('notActed', this.checked)"> 目標本回合未行動</label>
                    </div>
                    <div class="idt-action-row">
                        <button class="idt-btn idt-btn-main" onclick="runIdentityCalc()">⚡ 計算疊加效果</button>
                        <button class="idt-btn" onclick="runIdentityTurnStart()" title="套用回合開始的資源獲取（呼吸法／充能／人民之盾等）">🔄 回合開始資源</button>
                    </div>
                </div>

                ${renderIdentityManualInputs()}

                <div class="idt-section">
                    <div class="idt-section-title">③ 結算結果</div>
                    <div class="idt-result">${renderIdentityResult()}</div>
                </div>
            </div>
        </div>`;
}

// ===== 樣式（一次性注入，沿用網站 CSS 變數） =====
function injectIdentityStyles() {
    if (document.getElementById('identity-hud-styles')) return;
    const s = document.createElement('style');
    s.id = 'identity-hud-styles';
    s.textContent = `
        .identity-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9000;display:none;align-items:center;justify-content:center;padding:16px;}
        .identity-modal-box{background:var(--bg-panel,#1b1b22);border:1px solid var(--border,#33333a);border-radius:12px;width:min(560px,96vw);max-height:90vh;display:flex;flex-direction:column;color:var(--text,#eee);box-shadow:0 10px 40px rgba(0,0,0,.5);}
        .idt-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border,#33333a);font-weight:bold;font-size:1.05rem;}
        .idt-close{background:none;border:none;color:var(--text-dim,#999);font-size:1.5rem;cursor:pointer;line-height:1;}
        .idt-body{padding:12px 16px;overflow-y:auto;}
        .idt-section{margin-bottom:14px;}
        .idt-section-title{font-size:.9rem;color:var(--accent-purple,#9b59b6);margin-bottom:8px;font-weight:bold;}
        .idt-select,.idt-input{width:100%;background:var(--bg-input,#111);border:1px solid var(--border,#33333a);color:var(--text,#eee);border-radius:6px;padding:7px 8px;font-size:.9rem;}
        .idt-card-list{margin-top:8px;display:flex;flex-direction:column;gap:6px;}
        .idt-card{border:1px solid var(--border,#33333a);border-radius:8px;padding:8px 10px;background:var(--bg-input,#15151b);display:flex;flex-direction:column;gap:4px;opacity:.6;}
        .idt-card.idt-owned{opacity:1;border-color:var(--accent-purple,#7e57c2);}
        .idt-own{display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:bold;}
        .idt-card-name{font-size:.92rem;}
        .idt-unlock{display:flex;align-items:center;gap:6px;font-size:.82rem;color:var(--accent-orange,#e67e22);cursor:pointer;padding-left:24px;}
        .idt-unlock.idt-disabled{opacity:.4;cursor:not-allowed;}
        .idt-no-unlock{font-size:.78rem;color:var(--text-dim,#777);padding-left:24px;}
        .idt-field{margin-bottom:8px;}
        .idt-field label{display:block;font-size:.8rem;color:var(--text-dim,#aaa);margin-bottom:3px;}
        .idt-checks{display:flex;flex-direction:column;gap:5px;margin:8px 0;font-size:.85rem;}
        .idt-checks label{display:flex;align-items:center;gap:7px;cursor:pointer;}
        .idt-action-row,.idt-apply-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}
        .idt-btn{flex:1;min-width:120px;background:var(--bg-input,#222);border:1px solid var(--border,#33333a);color:var(--text,#eee);border-radius:6px;padding:8px;cursor:pointer;font-size:.85rem;}
        .idt-btn-main{background:var(--accent-purple,#7e57c2);border-color:var(--accent-purple,#7e57c2);font-weight:bold;}
        .idt-btn-mini{flex:1;min-width:0;font-size:.78rem;padding:6px 4px;}
        .idt-result{background:var(--bg-input,#111);border:1px solid var(--border,#33333a);border-radius:8px;padding:10px;min-height:48px;}
        .idt-result-empty{color:var(--text-dim,#777);font-size:.85rem;text-align:center;padding:10px;}
        .idt-bonus-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;}
        .idt-bonus{background:var(--bg-panel,#22222a);border:1px solid var(--border,#33333a);border-radius:6px;padding:6px 10px;font-size:.85rem;}
        .idt-bonus b{color:var(--accent-green,#27ae60);margin-left:6px;}
        .idt-statline{font-size:.85rem;margin:4px 0;}
        .idt-statline b{color:var(--accent-orange,#e67e22);}
        .idt-log-title{font-size:.8rem;color:var(--text-dim,#aaa);margin:10px 0 4px;border-top:1px solid var(--border,#33333a);padding-top:6px;}
        .idt-manual-title{color:var(--accent-orange,#e67e22);}
        .idt-log{display:flex;justify-content:space-between;gap:10px;font-size:.8rem;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,.06);}
        .idt-log-src{color:var(--text-dim,#bbb);white-space:nowrap;}
        .idt-log-eff{text-align:right;}
        .idt-log.idt-manual .idt-log-eff{color:var(--text-dim,#999);}
        .idt-header-actions{display:flex;align-items:center;gap:8px;}
        .idt-add-btn{background:var(--accent-purple,#7e57c2);border:none;color:#fff;width:28px;height:28px;border-radius:6px;font-size:1.15rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;}
        .idt-add-btn:hover{filter:brightness(1.15);}
        .idt-custom-tag{font-size:.66rem;background:var(--accent-purple,#7e57c2);color:#fff;border-radius:4px;padding:1px 5px;margin-left:4px;vertical-align:middle;}
        .idt-card-del{align-self:flex-start;margin-left:24px;background:none;border:1px solid var(--border,#33333a);color:var(--accent-red,#e74c3c);border-radius:5px;padding:2px 8px;font-size:.74rem;cursor:pointer;}
        .idt-card-del:hover{background:rgba(231,76,60,.15);}
        .idt-rule-hint{font-size:.76rem;color:var(--text-dim,#888);margin-bottom:8px;}
        .idt-rule{border:1px solid var(--border,#33333a);border-radius:8px;padding:8px;margin-bottom:8px;background:var(--bg-input,#15151b);display:flex;flex-direction:column;gap:8px;}
        .idt-rule-cond{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
        .idt-rule-label{font-size:.82rem;color:var(--text-dim,#aaa);white-space:nowrap;}
        .idt-rule-status{flex:1;min-width:96px;width:auto;}
        .idt-rule-min{width:64px;flex:0 0 auto;}
        .idt-rule-vals{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;}
        .idt-rule-vals label{font-size:.76rem;color:var(--text-dim,#aaa);display:flex;flex-direction:column;gap:3px;}
        .idt-rule-vals input{width:84px;}
        .idt-rule-del{flex:0 0 auto;min-width:0;max-width:46px;}
        .idt-mi-hint-top{font-size:.76rem;color:var(--text-dim,#888);margin-bottom:8px;}
        .idt-mi-card{border:1px solid var(--accent-purple,#7e57c2);border-radius:8px;padding:8px 10px;margin-bottom:8px;background:rgba(126,87,194,.08);}
        .idt-mi-card-name{font-size:.82rem;font-weight:bold;color:var(--accent-purple,#9b59b6);margin-bottom:6px;}
        .idt-mi-field{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;}
        .idt-mi-field:last-child{margin-bottom:0;}
        .idt-mi-label{font-size:.82rem;color:var(--text,#eee);display:flex;flex-direction:column;}
        .idt-mi-hint{font-size:.7rem;color:var(--text-dim,#999);}
        .idt-mi-field input{width:90px;flex:0 0 auto;}
        .idt-remind-title{color:var(--accent-blue,#4aa3ff);}
        .idt-remind{font-size:.82rem;color:var(--text,#eee);background:rgba(74,163,255,.08);border-left:3px solid var(--accent-blue,#4aa3ff);border-radius:4px;padding:6px 8px;margin:4px 0;line-height:1.5;}
        .idt-remind-note{border-left-color:var(--accent-purple,#7e57c2);background:rgba(126,87,194,.08);color:var(--text-dim,#bbb);font-size:.78rem;}
    `;
    document.head.appendChild(s);
}

// ===== Window bindings =====
if (typeof window !== 'undefined') {
    window.openIdentityModal = openIdentityModal;
    window.closeIdentityModal = closeIdentityModal;
    window.toggleIdentityModal = toggleIdentityModal;
    window.selectIdentityOwner = selectIdentityOwner;
    window.toggleIdentityCard = toggleIdentityCard;
    window.toggleIdentityUnlock = toggleIdentityUnlock;
    window.setIdentityField = setIdentityField;
    window.updateIdentityField = updateIdentityField;
    window.runIdentityCalc = runIdentityCalc;
    window.runIdentityTurnStart = runIdentityTurnStart;
    window.applyIdentityToCalc = applyIdentityToCalc;
    window.applyIdentityTargetStatus = applyIdentityTargetStatus;
    window.applyIdentitySelfStatus = applyIdentitySelfStatus;
    window.renderIdentityModal = renderIdentityModal;
    // 自訂人格卡
    window.openAddIdentityForm = openAddIdentityForm;
    window.cancelAddIdentity = cancelAddIdentity;
    window.idtDraftSet = idtDraftSet;
    window.idtDraftAddRule = idtDraftAddRule;
    window.idtDraftRemoveRule = idtDraftRemoveRule;
    window.idtDraftSetRule = idtDraftSetRule;
    window.saveNewIdentity = saveNewIdentity;
    window.deleteCustomIdentity = deleteCustomIdentity;
    window.setCardInput = setCardInput;
    // 啟動時把使用者儲存的自訂人格卡注入資料庫，並還原上次的選擇
    registerAllCustomIdentities();
    loadIdentityState();
    // 注入樣式（DOM 已就緒時立即注入，否則待載入）
    if (document.head) injectIdentityStyles();
    else document.addEventListener('DOMContentLoaded', injectIdentityStyles);
}

console.log('🃏 人格卡引擎 UI 已載入');

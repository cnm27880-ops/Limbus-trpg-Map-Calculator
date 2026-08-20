/**
 * Limbus Command - 人格卡引擎 UI 串接層
 *
 * 職責：
 *  1. 轉接層（adapter）：在「引擎英文狀態鍵」與「網站中文狀態庫」之間互轉，
 *     讓 evaluatePlayerAttack 能讀取實際單位狀態，並把結算結果套用回單位。
 *  2. 人格卡面板（modal）：玩家挑選持有的人格卡、勾選重複抽取解鎖；我方單位恆鎖定為玩家
 *     自己控制的單位、目標自動偵測玩家上次發起攻擊的對象，全自動即時算出疊加後的
 *     DP・武器傷害・附加成功・狀態，無需手動按鈕。
 *
 * 依賴（皆以 typeof 防呆，缺少時不致拋錯）：
 *   IDENTITY_LIBRARY / IDENTITY_STATUS_KEYMAP / getIdentityOwners / getIdentitiesByOwner /
 *   getIdentityById / evaluatePlayerAttack / evaluatePlayerTurnStart（資料與引擎層）
 *   getStatusById / addStatusToUnit / findUnitById / state / showToast /
 *   escapeHtml（既有網站）
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
    const base = {
        status,
        initiative: (unit && unit.init) ? (parseInt(unit.init) || 0) : 0,
        // 單位卡上的護盾值（一次性＋自動），供「護盾不為 0」類條件使用；與人民之盾狀態無關
        unitShield: unit ? ((parseInt(unit.shieldTemp) || 0) + (parseInt(unit.shieldAuto) || 0)) : 0,
        // 場上是否存在「指令對象」（食指的業判定：攻擊指令對象以外的目標 → 獲得業）
        commandTargetOnField: idtHasCommandTargetOnField(),
        // 全隊共用資源池（血宴等）：不屬於任何單位，故不放進 status，改以 pools 提供給條件函式
        pools: idtGetTeamPools(),
        // 上一回合是否完全沒受到傷害（浮士德倖存者【伺機而動】的條件）。
        // dmgTakenLastTurn 由 nextTurn() 在輪到該單位時，從本回合累計值輪替過來（見 units.js）。
        noDamageLastTurn: !(unit && (parseInt(unit.dmgTakenLastTurn) || 0) > 0),
        // 嚴重生命槽是否已填滿（希斯克利夫「極意之劍」、提燈的雙倍恢復等條件）
        severeFull: !!(unit && typeof isSevereGaugeFull === 'function' && isSevereGaugeFull(unit)),
        // 身上是否帶有惡性 (A) 傷（格里高爾「都切碎吧」的條件）
        hasViciousDamage: !!(unit && Array.isArray(unit.hpArr) && unit.hpArr.some(v => (parseInt(v) || 0) >= 3)),
        // 身上「不同種類的負面狀態」數量（奧提斯【點彩派】依負面狀態種類數加武器傷害）
        debuffTypeCount: idtCountDebuffTypes(unit),
    };
    return Object.assign(base, extra || {});
}

/**
 * 計算單位身上「不同種類的負面狀態」數量。
 * 沿用狀態庫的 isDebuffStatus 判定（欄位 > 分類 > 白名單回退），與罪業抽取的口徑一致，
 * 免得同一個狀態在兩處被判成不同陣營。
 * @param {object} unit
 * @returns {number}
 */
function idtCountDebuffTypes(unit) {
    if (!unit || !unit.status || typeof isDebuffStatus !== 'function') return 0;
    let n = 0;
    for (const [name, raw] of Object.entries(unit.status)) {
        if ((parseInt(raw) || 0) <= 0) continue;
        const def = (typeof getStatusByName === 'function') ? getStatusByName(name) : null;
        // isDebuffStatus 取的是狀態 id；自訂狀態查不到定義時以名稱當 id 交給白名單回退
        if (isDebuffStatus(def ? def.id : name)) n++;
    }
    return n;
}

/**
 * 取得目前的全隊共用資源池（含防呆預設值）。
 * state.teamPools 可能因舊房間資料或尚未連線而不存在，一律補齊為 0，避免條件函式讀到 undefined。
 * @returns {{bloodFeast:number, bloodFeastSpent:number, bleedDamageAcc:number}}
 */
function idtGetTeamPools() {
    const raw = (typeof state !== 'undefined' && state.teamPools) ? state.teamPools : {};
    return {
        bloodFeast: parseInt(raw.bloodFeast) || 0,
        bloodFeastSpent: parseInt(raw.bloodFeastSpent) || 0,
        bleedDamageAcc: parseInt(raw.bleedDamageAcc) || 0
    };
}

/**
 * 調整全隊共用資源池並同步給整個房間。
 * @param {string} key - 資源池鍵（如 'bloodFeast'）
 * @param {number} delta - 增減量（可為負；負值同時累計到 <key>Spent 供「累計消耗」類技能使用）
 * @returns {number} 實際變動量（受 0 與上限夾限後可能小於 delta）
 */
function idtAdjustTeamPool(key, delta) {
    const def = (typeof IDENTITY_TEAM_POOLS !== 'undefined') ? IDENTITY_TEAM_POOLS[key] : null;
    if (!def) return 0;
    const pools = idtGetTeamPools();
    const cur = pools[key] || 0;
    const next = Math.max(0, Math.min(def.max || 999, cur + (parseInt(delta) || 0)));
    const actual = next - cur;
    if (actual === 0) return 0;

    pools[key] = next;
    // 累計消耗量只記「真的扣掉的量」——玩家手動加回去不該把累計消耗一起倒扣
    if (def.trackSpent && actual < 0) {
        pools[key + 'Spent'] = (pools[key + 'Spent'] || 0) + Math.abs(actual);
    }
    if (typeof syncTeamPools === 'function') syncTeamPools(pools);
    else if (typeof state !== 'undefined') state.teamPools = pools;

    if (typeof showToast === 'function') {
        showToast(`${def.icon || '🎴'} ${def.name}${actual > 0 ? '+' : ''}${actual} → ${next}/${def.max}`);
    }
    renderIdentityModal();
    return actual;
}

/**
 * 把引擎輸出的資源池增減（poolDelta）實際套用到全隊共用資源池。
 * @param {object} poolDelta - 例如 { bloodFeast: -2 }
 * @returns {number} 實際變動的資源池種類數
 */
function applyEnginePoolDelta(poolDelta) {
    if (!poolDelta || typeof poolDelta !== 'object') return 0;
    let n = 0;
    for (const [key, amount] of Object.entries(poolDelta)) {
        if (idtAdjustTeamPool(key, parseInt(amount) || 0) !== 0) n++;
    }
    return n;
}

/** 場上任一單位是否帶有「指令對象」狀態 */
function idtHasCommandTargetOnField() {
    if (typeof state === 'undefined' || !Array.isArray(state.units)) return false;
    const def = (typeof getStatusById === 'function') ? getStatusById('command_target') : null;
    const name = def ? def.name : '指令對象';
    return state.units.some(u => u.status && (parseInt(u.status[name]) || 0) > 0);
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

/**
 * 套用引擎輸出的狀態「增減量」（可為負）：正值走 addStatusToUnit 累加，
 * 負值改以 updateStatusStacks 扣減並在歸零時移除（addStatusToUnit 不夾限會留下「0 層」殘留）。
 * 供 onTurnEnd 等含資源衰減的結算使用。
 * @param {string} unitId
 * @param {object} statusMap - 例如 { charge: -1, breathing: 2 }
 * @returns {number} 實際變動的狀態種類數
 */
function applyEngineStatusDeltasToUnit(unitId, statusMap) {
    if (!statusMap) return 0;
    const unit = (typeof findUnitById === 'function') ? findUnitById(unitId) : null;
    let n = 0;
    for (const [engKey, layers] of Object.entries(statusMap)) {
        const delta = parseInt(layers) || 0;
        if (delta === 0) continue;
        if (delta > 0) {
            if (typeof addStatusToUnit === 'function') { addStatusToUnit(unitId, identityLibIdForKey(engKey), delta); n++; }
        } else {
            // 扣減：需先知道目前層數。以中文狀態名讀取單位狀態。
            const def = (typeof getStatusById === 'function') ? getStatusById(identityLibIdForKey(engKey)) : null;
            const name = def ? def.name : null;
            if (!name || !unit || !unit.status || unit.status[name] === undefined) continue;
            const cur = parseInt(unit.status[name]) || 0;
            if (typeof updateStatusStacks === 'function') { updateStatusStacks(unitId, name, cur + delta); n++; }
        }
    }
    return n;
}

// ===== 面板狀態 =====

let identityHudState = {
    owner: null,
    cards: {},          // cardId -> { owned: bool, unlocked: bool }
    cardInputs: {},     // cardId -> { key: value }（人格卡的特殊手動資源，如意志力/魔法阿卡納）
    attackerId: null,   // 恆為玩家自己的單位（每次渲染自動鎖定，不可手動更改）
    targetId: null,     // 自動偵測玩家上次發起攻擊的目標；仍可由下拉選單手動覆寫
    cardFilter: '',     // 卡片清單篩選字串（不持久化）
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
    loveHate: '愛/憎', karma: '業', rupture: '破裂', strength: '強壯', endurance: '不屈',
    magicBullet: '魔彈', blackFlame: '黑焰', vulnerable: '易損',
    bloomingThorns: '綻放荊棘', fanaticism: '狂信'
};

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
 * 將「純資料」人格卡（無函式、可 JSON 序列化）轉為引擎可用的人格卡（含 condition 函式），
 * 並注入 IDENTITY_LIBRARY。
 *
 * 支援的資料結構（AI 鍛造爐輸出 / localStorage 儲存格式，皆向後相容舊版 {statusKey,min,dp,succ}）：
 *   {
 *     id, owner, name,
 *     desc: "整體需手動判定的說明",
 *     rules: [{
 *        phase: "attack"|"hit",            // 預設 attack
 *        statusKey, min, condOn:"target"|"self",   // 條件（門檻 0／省略＝無條件）
 *        dp, succ, weaponDamage, spellPower, finalDamage,
 *        targetStatus: { key: layers }, selfStatus: { key: layers },
 *        source: "技能名", note: "此條規則需手動判定的補充"
 *     }],
 *     specialResources: [{ key, label, default, hint }]   // 特殊資源（意志力／阿卡納層數…）
 *   }
 * 全程以 || []／|| '' 與型別檢查防護，避免 AI 漏給欄位導致註冊時崩潰。
 */
function sanitizeStatusMap(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    const out = {};
    for (const [k, v] of Object.entries(m)) {
        const n = parseInt(v) || 0;
        if (k && n) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
}

function registerCustomIdentity(raw) {
    if (typeof IDENTITY_LIBRARY === 'undefined') {
        // 不可靜默丟棄：這曾造成「自訂人格卡全部消失」的難查 bug（模組載入時序）
        console.warn('[identity-hud] IDENTITY_LIBRARY 尚未載入，自訂人格卡註冊被跳過：', raw && raw.id);
        return;
    }
    if (!raw || !raw.id) return;

    const rules = Array.isArray(raw.rules) ? raw.rules : [];
    const onAttack = [];
    const onHit = [];
    const keyStatuses = new Set();
    // 數值欄位：資料鍵 → 引擎鍵
    const NUM_FIELDS = [['dp', 'dpBonus'], ['succ', 'extraSuccess'], ['weaponDamage', 'weaponDamage'], ['spellPower', 'spellPower'], ['finalDamage', 'finalDamage']];

    rules.forEach(r => {
        if (!r || typeof r !== 'object') return;
        const bucket = ((r.phase || '').toString().trim().toLowerCase() === 'hit') ? onHit : onAttack;

        const statusKey = (r.statusKey || '').toString();
        const min = parseInt(r.min) || 0;
        const condOn = ((r.condOn || '').toString().trim().toLowerCase() === 'self') ? 'self' : 'target';
        if (statusKey) keyStatuses.add(statusKey);

        // 由「目標／自身某狀態達門檻」宣告式條件，建立引擎 condition 函式（門檻 0＝無條件恆真）
        const cond = (statusKey && min > 0)
            ? (condOn === 'self'
                ? ((t, a) => ((a && a.status && a.status[statusKey]) || 0) >= min)
                : ((t) => ((t && t.status && t.status[statusKey]) || 0) >= min))
            : (() => true);

        const source = (r.source || raw.name || '自訂').toString();
        const effect = { condition: cond, source, skill: source };
        if (r.locked) effect.locked = true;
        let hasEffect = false;
        NUM_FIELDS.forEach(([src, dst]) => {
            const v = parseInt(r[src]) || 0;
            if (v) { effect[dst] = v; hasEffect = true; }
        });
        const tgt = sanitizeStatusMap(r.targetStatus);
        const slf = sanitizeStatusMap(r.selfStatus);
        if (tgt) { effect.targetStatus = tgt; hasEffect = true; Object.keys(tgt).forEach(k => keyStatuses.add(k)); }
        if (slf) { effect.selfStatus = slf; hasEffect = true; Object.keys(slf).forEach(k => keyStatuses.add(k)); }
        if (hasEffect) bucket.push(effect);

        // 此條規則附帶的「需手動判定」補充
        const note = (r.note || '').toString().trim();
        if (note) bucket.push({ manual: true, condition: cond, desc: note, source, skill: source });
    });

    // 卡片整體「需手動判定」說明（無法量化的複雜／機率效果）
    const desc = (raw.desc || '').toString().trim();
    if (desc) onAttack.push({ manual: true, condition: () => true, desc, source: raw.name || '自訂', skill: raw.name || '自訂' });

    // 特殊資源（意志力／阿卡納層數…）→ 引擎的 manualInputs；缺漏時退回空陣列
    const manualInputs = (Array.isArray(raw.specialResources) ? raw.specialResources : [])
        .filter(s => s && s.key)
        .map(s => ({ key: String(s.key), label: (s.label || s.key).toString(), default: parseInt(s.default) || 0, hint: (s.hint || '').toString() }));

    IDENTITY_LIBRARY[raw.id] = {
        id: raw.id,
        name: (raw.name || '自訂人格卡').toString(),
        owner: (raw.owner || '自訂').toString(),
        custom: true,
        keyStatuses: [...keyStatuses],
        manualInputs,
        repeatUnlockSkill: (raw.repeatUnlockSkill || '').toString(),
        hooks: { onAttack, onHit }
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

// ===== AI 人格鍛造爐（自然語言 → JSON → 人格卡） =====

// AI 連線設定（端點 / 金鑰 / 模型）持久化於 localStorage。
const AI_ENDPOINT_KEY = 'limbus-ai-endpoint';
const AI_KEY_KEY = 'limbus-ai-key';
const AI_MODEL_KEY = 'limbus-ai-model';
const AI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const AI_DEFAULT_MODEL = 'gpt-4o-mini';

function getAISetting(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
function setAISetting(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* quota / disabled */ }
}

/**
 * 餵給 AI 的「範例 Schema」：直接取自系統實際讀取的人格卡資料結構（純資料、無函式），
 * 強制 AI 輸出的欄位名稱與現有引擎 100% 吻合（見 registerCustomIdentity）。
 */
function aiSchemaExample() {
    return {
        owner: '格里高爾',
        name: '自訂・流血突刺',
        desc: '擊殺目標時對其周圍 3 公尺內所有敵人施加 3 點流血（需 ST 自行判定範圍）。',
        rules: [
            { phase: 'attack', statusKey: 'bleed', min: 7, condOn: 'target', dp: 3, source: '流血突刺' },
            { phase: 'attack', statusKey: 'breathing', min: 10, condOn: 'self', weaponDamage: 2, source: '蓄勢' },
            { phase: 'hit', targetStatus: { bleed: 2 }, source: '流血突刺' },
            { phase: 'hit', statusKey: 'bleed', min: 10, condOn: 'target', targetStatus: { weak: 1 }, selfStatus: { swiftness: 1 }, source: '流血突刺', note: '若骰中兩個以上 10，額外附加 2 點虛弱（需擲骰判定）。' },
            { phase: 'attack', dp: 2, source: '萬鍛連掌', locked: true, note: '此為重複抽取解鎖技，僅在玩家勾選「已解鎖」時才計入計算。' }
        ],
        specialResources: [
            { key: 'will', label: '當前意志力', default: 0, hint: '>0 光型態 / <0 暗型態' }
        ],
        repeatUnlockSkill: '萬鍛連掌'
    };
}

/** 組裝送給 AI 的嚴謹 System Prompt（含範例 Schema 與合法狀態鍵清單）。 */
function aiBuildSystemPrompt() {
    const statusList = Object.entries(IDT_STATUS_LABELS).map(([k, v]) => `${k}(${v})`).join('、');
    const example = JSON.stringify(aiSchemaExample(), null, 2);
    return [
        '你是一個嚴謹的 TRPG 規則解析器。請將使用者輸入的「人格卡描述」轉換為單一 JSON 物件，且只輸出 JSON 本體、不要任何說明文字或 markdown 圍欄。',
        '',
        '輸出的 JSON 欄位名稱必須與下方範例結構 100% 吻合（這是系統實際讀取的格式）：',
        example,
        '',
        '欄位規則：',
        '- owner：角色名稱；name：人格卡名稱（兩者必填、字串）。',
        '- rules：陣列，每條是一個獨立會「疊加觸發」的效果。',
        '  - phase："attack"（攻擊／檢定前的 DP・武器傷害・附加成功・威力・最終傷害加值）或 "hit"（命中後對目標/自身施加狀態）。',
        '  - 條件（可省略＝無條件恆生效）：statusKey + min（門檻）+ condOn（"target" 檢查目標 / "self" 檢查攻擊者自身的該狀態）。',
        '  - 數值加值（數字，視情況給）：dp、succ（附加成功）、weaponDamage、spellPower、finalDamage。',
        '  - 狀態施加：targetStatus / selfStatus，格式為 { 狀態鍵: 層數 }。',
        '  - source：此效果來源技能名稱。',
        '  - locked：布林值。如果卡片描述中有提到【重複抽取解鎖】或【三技】，請將該條規則的 locked 設為 true；沒有提到的規則請設為 false 或省略。',
        '- repeatUnlockSkill：字串。如果卡片描述中有提到【重複抽取解鎖】或【三技】，請將該技能名稱填入此欄位；如果沒有，請保持為空字串 ""。',
        '- specialResources：自訂能量／層數系統（如意志力、魔法阿卡納層數），每項 { key, label, default, hint }；無則給空陣列 []。',
        '',
        `合法的狀態鍵（statusKey / targetStatus / selfStatus 只能使用這些英文鍵）：${statusList}。`,
        '',
        '重要：所有可量化的狀態增減、數值加值、條件判定，請盡量轉換並放入 "rules" 陣列中的對應欄位；',
        '若遇到無法量化的複雜效果（如：擊殺時觸發某事件、機率性／擲骰判定、指定友軍、依層數動態縮放的數值），',
        '不要捏造數字，請改將該效果的完整文字描述放進該規則的 "note" 欄位，或放進卡片最外層的 "desc"（需手動判定）欄位。'
    ].join('\n');
}

function openAddIdentityForm() {
    renderAIForge();
}

function cancelAddIdentity() {
    renderIdentityModal();
}

/**
 * 階段 3：呼叫 AI 端點，將自然語言描述轉為 JSON 填入預覽區。
 */
async function generateIdentityFromAI() {
    const promptEl = document.getElementById('ai-identity-prompt');
    const previewEl = document.getElementById('ai-identity-preview');
    const btn = document.getElementById('btn-generate-identity');
    if (!promptEl || !previewEl) return;

    const userText = (promptEl.value || '').trim();
    if (!userText) { if (typeof showToast === 'function') showToast('請先輸入人格卡描述'); return; }

    const endpoint = (getAISetting(AI_ENDPOINT_KEY, AI_DEFAULT_ENDPOINT) || '').trim() || AI_DEFAULT_ENDPOINT;
    const apiKey = (getAISetting(AI_KEY_KEY, '') || '').trim();
    const model = (getAISetting(AI_MODEL_KEY, AI_DEFAULT_MODEL) || '').trim() || AI_DEFAULT_MODEL;
    if (!apiKey) { if (typeof showToast === 'function') showToast('請先在上方填入 API Key'); return; }

    if (btn) { btn.disabled = true; btn.dataset.label = btn.innerText; btn.innerText = '⏳ AI 產生中...'; }

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                temperature: 0.2,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: aiBuildSystemPrompt() },
                    { role: 'user', content: userText }
                ]
            })
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${res.statusText}${errText ? '：' + errText.slice(0, 300) : ''}`);
        }

        const data = await res.json();
        const content = data && data.choices && data.choices[0] && data.choices[0].message
            ? (data.choices[0].message.content || '') : '';
        if (!content) throw new Error('AI 回傳內容為空');

        // 嘗試美化 JSON；若無法解析則原樣放入供使用者手動修正
        let pretty = content.trim();
        try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch (e) { /* 保留原文 */ }
        previewEl.value = pretty;
        if (typeof showToast === 'function') showToast('AI 已產生 JSON，請確認後儲存');
    } catch (err) {
        previewEl.value = `// 產生失敗：${err && err.message ? err.message : err}\n// 請檢查 API 端點 / 金鑰 / 模型名稱，或改用手動填寫 JSON。`;
        if (typeof showToast === 'function') showToast('AI 產生失敗，詳見預覽區');
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = btn.dataset.label || '✨ AI 產生'; }
    }
}

/**
 * 階段 4：將預覽區 JSON 安全解析後存入人格卡資料庫。
 */
function saveAIIdentity() {
    const previewEl = document.getElementById('ai-identity-preview');
    if (!previewEl) return;
    const text = (previewEl.value || '').trim();
    if (!text) { if (typeof showToast === 'function') showToast('預覽區是空的，請先產生或貼上 JSON'); return; }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        if (typeof showToast === 'function') showToast('JSON 格式錯誤，無法解析：' + (e.message || e));
        return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        if (typeof showToast === 'function') showToast('JSON 必須是一個物件');
        return;
    }

    // owner / name 缺漏時補上預設值而非阻擋匯入，避免 AI 漏給欄位導致整張卡無法儲存
    const owner = (parsed.owner || '').toString().trim() || '自訂';
    const name = (parsed.name || '').toString().trim() || '自訂人格卡';

    // 正規化為儲存格式（補預設值，避免 AI 漏給「解鎖三技/重複抽取」等舊版必填欄位導致匯入被擋）
    const raw = {
        id: (parsed.id && String(parsed.id).trim()) || ('custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        owner, name,
        desc: (parsed.desc || '').toString(),
        rules: (Array.isArray(parsed.rules) ? parsed.rules : []).map(r => (r && typeof r === 'object') ? Object.assign({
            phase: 'attack', statusKey: '', min: 0, condOn: 'target', source: '', note: '', locked: false
        }, r) : r),
        specialResources: Array.isArray(parsed.specialResources) ? parsed.specialResources : [],
        repeatUnlockSkill: (parsed.repeatUnlockSkill || parsed.unlockableSkill || parsed.skill3Name || '').toString()
    };

    // 寫入人格卡資料庫並即時註冊進引擎
    try {
        const arr = loadCustomIdentities().filter(c => c.id !== raw.id);
        arr.push(raw);
        saveCustomIdentities(arr);
        registerCustomIdentity(raw);
    } catch (e) {
        if (typeof showToast === 'function') showToast('儲存失敗：' + (e.message || e));
        return;
    }

    identityHudState.owner = owner;
    if (typeof selectIdentityOwner === 'function') selectIdentityOwner(owner, true);
    identityHudState.cards[raw.id] = { owned: true, unlocked: false };
    renderIdentityModal();
    if (typeof showToast === 'function') showToast(`已鍛造人格卡「${name}」`);
}

function renderAIForge() {
    const el = document.getElementById('identity-modal');
    if (!el) return;
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);

    const endpoint = getAISetting(AI_ENDPOINT_KEY, AI_DEFAULT_ENDPOINT);
    const apiKey = getAISetting(AI_KEY_KEY, '');
    const model = getAISetting(AI_MODEL_KEY, AI_DEFAULT_MODEL);

    el.innerHTML = `
        <div class="identity-modal-box">
            <div class="idt-header" id="identity-float-header">
                <span>🤖 AI 人格鍛造爐</span>
                <div class="idt-header-actions">
                    <button class="idt-close" id="identity-float-collapse" title="收起">▾</button>
                    <button class="idt-close" onclick="cancelAddIdentity()">×</button>
                </div>
            </div>
            <div class="idt-body">
                <div class="idt-section">
                    <div class="idt-section-title">① AI 連線設定（儲存在本機）</div>
                    <div class="idt-field"><label>API 端點 Endpoint</label>
                        <input class="idt-input" type="text" value="${esc(endpoint)}" placeholder="${AI_DEFAULT_ENDPOINT}"
                               onchange="setAISetting('${AI_ENDPOINT_KEY}', this.value)"></div>
                    <div class="idt-field"><label>API Key</label>
                        <input class="idt-input" type="password" value="${esc(apiKey)}" placeholder="sk-..." autocomplete="off"
                               onchange="setAISetting('${AI_KEY_KEY}', this.value)"></div>
                    <div class="idt-field"><label>模型 Model</label>
                        <input class="idt-input" type="text" value="${esc(model)}" placeholder="${AI_DEFAULT_MODEL}"
                               onchange="setAISetting('${AI_MODEL_KEY}', this.value)"></div>
                </div>

                <div class="idt-section">
                    <div class="idt-section-title">② 貼上人格卡描述（自然語言）</div>
                    <div class="idt-rule-hint">直接描述這張卡的技能、條件與效果即可；複雜／需擲骰的效果 AI 會放進「需手動判定」說明。</div>
                    <textarea class="idt-input idt-forge-area" id="ai-identity-prompt" rows="5"
                              placeholder="例：格里高爾的『流血突刺』。當目標流血 7 以上時攻擊 +3 DP；命中時施加 2 點流血；擊殺時對周圍敵人施加流血（需 ST 判定）。"></textarea>
                    <button class="idt-btn idt-btn-main" id="btn-generate-identity" onclick="generateIdentityFromAI()">✨ AI 產生</button>
                </div>

                <div class="idt-section">
                    <div class="idt-section-title">③ JSON 預覽（可手動修改以防錯）</div>
                    <textarea class="idt-input idt-forge-area" id="ai-identity-preview" rows="12" spellcheck="false"
                              style="font-family: monospace; white-space: pre;"
                              placeholder="AI 產生的 JSON 會出現在這裡，你也可以直接貼上／修改 JSON。"></textarea>
                </div>

                <div class="idt-action-row">
                    <button class="idt-btn idt-btn-main" id="btn-save-identity" onclick="saveAIIdentity()">💾 儲存人格卡</button>
                    <button class="idt-btn" onclick="cancelAddIdentity()">取消</button>
                </div>
            </div>
        </div>`;
    idtMountFloatPanel();
}

// ===== 開關 =====

function openIdentityModal() {
    let el = document.getElementById('identity-modal');
    if (!el) {
        el = document.createElement('div');
        el.id = 'identity-modal';
        el.className = 'identity-modal-overlay';
        document.body.appendChild(el);
    }
    // 若被收納在右緣邊條，先還原
    if (typeof PanelDock !== 'undefined' && PanelDock.isDocked('identity-modal')) {
        PanelDock.restore('identity-modal');
    }
    // 沿用上次選擇的角色；若沒有（或先前選的角色已不存在）才退回第一個
    if (typeof getIdentityOwners === 'function') {
        const owners = getIdentityOwners();
        if (!identityHudState.owner || !owners.includes(identityHudState.owner)) {
            if (owners.length) selectIdentityOwner(owners[0], true);
        }
    }
    // 我方攻擊者的鎖定與同步交給 renderIdentityModal 每次渲染時處理
    renderIdentityModal();
    el.style.display = 'block';
    if (typeof WindowManager !== 'undefined') WindowManager.bringToFront(el);
}

function closeIdentityModal() {
    if (typeof PanelDock !== 'undefined') PanelDock.remove('identity-modal');
    const el = document.getElementById('identity-modal');
    if (el) el.style.display = 'none';
}

function toggleIdentityModal() {
    const el = document.getElementById('identity-modal');
    const visible = el && el.style.display !== 'none' && el.style.display !== ''
        && !el.classList.contains('dock-hidden');
    if (visible) closeIdentityModal();
    else openIdentityModal();
}

/**
 * 每次重繪後把面板掛上通用浮動面板（標頭拖曳／雙擊收起／右緣磁鐵收納）。
 * renderIdentityModal / renderAIForge 都會整個重寫 innerHTML（標頭是新元素），
 * 故每次渲染後都需重新綁定；位置與收合狀態由 localStorage 記憶，重繪不會跳位。
 */
function idtMountFloatPanel() {
    if (typeof makeFloatingPanel !== 'function') return;
    makeFloatingPanel({
        panelId: 'identity-modal',
        headerId: 'identity-float-header',
        collapseBtnId: 'identity-float-collapse',
        storageKey: 'limbus_identity_panel',
        defaultPos: { x: 60, y: 60 },
        dock: { icon: '🃏', title: '人格卡引擎' },
    });
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
/**
 * 收集某角色目前「已勾選持有」的人格卡。
 *
 * ⚠️ 這是唯一的持有判定入口，面板預覽與實際攻擊都必須走這裡。
 * 先前 combat-modals 的 cmResolveIdentityBonus 自行實作了一份，且對「沒有紀錄的卡」
 * 採取相反的預設（視為持有），於是兩邊會給出不同的卡片組合：
 *   - 玩家從未開過人格卡面板、但單位名稱剛好等於某角色 → 攻擊時套用「該角色全部卡片」的加值，
 *     面板卻顯示空白；
 *   - 人格庫新增卡片（或註冊自訂人格卡）後，舊玩家的紀錄裡沒有該卡 → 同樣被當成持有。
 * 兩者都會讓「明細顯示的」與「實際結算的」對不起來。統一由本函式判定即可根除。
 *
 * @param {string} [owner] - 指定角色；省略時用面板目前選中的角色
 * @returns {Array<{id: string, unlocked: boolean}>}
 */
function collectOwnedIdentities(owner) {
    const useOwner = owner || identityHudState.owner;
    const list = [];
    const ownerCards = (typeof getIdentitiesByOwner === 'function' && useOwner)
        ? getIdentitiesByOwner(useOwner) : [];
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
 * 實際計算疊加結果並寫入 lastResult。與 combat-modals.js 的 cmResolveIdentityBonus（實際攻擊時
 * 的自動套用邏輯）採同一套規則：先攻序位自動推算、不假設嚴重槽／未行動等人工覆寫的條件，
 * 讓這裡看到的預覽與發起攻擊時實際套用的結果一致。
 * @returns {boolean} 是否成功算出結果
 */
function computeIdentityResult() {
    if (typeof evaluatePlayerAttack !== 'function') return false;
    const owned = collectOwnedIdentities();
    if (owned.length === 0) {
        identityHudState.lastResult = null;
        return false;
    }

    const attackerUnit = (typeof findUnitById === 'function' && identityHudState.attackerId)
        ? findUnitById(identityHudState.attackerId) : null;
    const targetUnit = (typeof findUnitById === 'function' && identityHudState.targetId)
        ? findUnitById(identityHudState.targetId) : null;

    const attackerExtra = {};
    if (identityHudState.attackerId && typeof autoInitiativeRank === 'function') {
        attackerExtra.initiativeRank = autoInitiativeRank(identityHudState.attackerId);
    }
    const attacker = buildEngineUnitState(attackerUnit, attackerExtra);
    const target = buildEngineUnitState(targetUnit);

    // 疊加人格卡的「手動資源輸入」到攻擊者狀態，讓條件/動態數值（如魔法阿卡納層數、
    // 意志力正負判定型態）能據此計算。
    applyManualInputsToAttacker(owned, attacker);

    const result = evaluatePlayerAttack(owned, attacker, target);
    // 附加「資源提醒」（如：暗型態自傷扣血、光型態 -4 意志力），供 ST/玩家確認資源增減
    result.reminders = collectIdentityReminders(owned, attacker, target);
    // 附加「未觸發的加值」清單：大多數人格卡的 DP／傷害加值都有觸發條件
    //（目標狀態達門檻、先攻比較、自身資源等），條件未達時引擎不計入。
    // 過去這些效果會直接從結果消失，看起來像「DP 加值沒被顯示」的 bug——
    // 現在明確列出哪些加值存在但未觸發、以及未觸發的原因。
    result.untriggered = collectUntriggeredBonusHooks(owned, attacker, target);
    result.noTarget = !identityHudState.targetId;
    // 「結算後（依實際傷害）」與「被攻擊時」這兩個時機過去完全不在面板上，
    // 玩家看不到浮士德【人民之盾】、伺機而動的傷害門檻、綻放荊棘反傷等效果會怎麼結算。
    result.resolvePreview = collectResolvePreview(owned, attacker, target);
    result.defendPreview = collectDefendPreview(owned, attacker);
    identityHudState.lastResult = result;
    return true;
}

// 引擎數值加值欄位 → 顯示名稱（與 identity-engine.js 的 IDENTITY_BONUS_KEYS 對應）
const IDT_BONUS_FIELD_LABELS = {
    dpBonus: 'DP', weaponDamage: '武器傷害', extraSuccess: '附加成功',
    spellPower: '法術威力', finalDamage: '最終傷害', selfShield: '一次性護盾',
    critVicious: '嚴重轉惡性', explodeStep: '加骰級數'
};

/**
 * 巡覽持有卡的 onAttack / onHit hook，找出「帶有數值加值、但本次結算未計入」者：
 *  - 重複抽取解鎖技未勾選解鎖
 *  - 條件未達（目標／自身狀態門檻、先攻比較等）
 *  - 條件成立但動態數值目前為 0（如魔法阿卡納 0 層）
 * 回傳 [{ identityName, phase, source, bonusTxt, reason }]，供結果面板顯示。
 * @param {Array<{id:string, unlocked:boolean}>} owned
 * @param {object} attacker - 引擎格式的攻擊者狀態
 * @param {object} target - 引擎格式的目標狀態
 */
function collectUntriggeredBonusHooks(owned, attacker, target) {
    const out = [];
    if (typeof getIdentityById !== 'function') return out;
    const bonusKeys = Object.keys(IDT_BONUS_FIELD_LABELS);

    for (const { id, unlocked } of owned) {
        const card = getIdentityById(id);
        if (!card || !card.hooks) continue;

        for (const [phase, hooks] of [['attack', card.hooks.onAttack], ['hit', card.hooks.onHit]]) {
            if (!Array.isArray(hooks)) continue;
            for (const hook of hooks) {
                if (!hook || hook.manual) continue;
                if (!bonusKeys.some(k => hook[k] !== undefined)) continue;

                let reason = '';
                if (hook.locked && !unlocked) {
                    reason = '未勾選解鎖三技';
                } else {
                    let pass = true;
                    if (hook.condition) {
                        try { pass = !!hook.condition(target, attacker); } catch (e) { pass = false; }
                    }
                    if (pass) {
                        // 條件成立：檢查是否有任一非零數值（有→已計入結果，不列）
                        const anyNonZero = bonusKeys.some(k => {
                            if (hook[k] === undefined) return false;
                            try {
                                const v = (typeof hook[k] === 'function') ? hook[k](target, attacker) : hook[k];
                                return (Number(v) || 0) !== 0;
                            } catch (e) { return false; }
                        });
                        if (anyNonZero) continue;
                        reason = '動態數值目前為 0（依資源／狀態層數計算）';
                    } else {
                        reason = '條件未達（目標／自身狀態或先攻門檻）';
                    }
                }

                const bonusTxt = bonusKeys.map(k => {
                    if (hook[k] === undefined) return '';
                    return (typeof hook[k] === 'function')
                        ? `${IDT_BONUS_FIELD_LABELS[k]}+動態`
                        : `${IDT_BONUS_FIELD_LABELS[k]}+${hook[k]}`;
                }).filter(Boolean).join('、');

                out.push({ identityName: card.name || '', phase, source: hook.source || hook.skill || '', bonusTxt, reason });
            }
        }
    }
    return out;
}

/**
 * 產生「結算後（onResolve）」的預覽：依造成的傷害列出各階段會套用什麼。
 * 直接沿用 combat-modals 的階梯表建構器，確保面板預覽與實際結算完全同一套規則。
 * @param {Array<{id:string,unlocked:boolean}>} owned
 * @param {object} attacker
 * @param {object} target
 * @returns {Array<{label:string, selfTxt:string, targetTxt:string}>}
 */
function collectResolvePreview(owned, attacker, target) {
    if (typeof cmBuildResolveTable !== 'function') return [];
    const notes = (m) => Object.entries(m || {})
        .map(([k, v]) => `${identityStatusName(k)}${(parseInt(v) || 0) >= 0 ? '+' : ''}${parseInt(v) || 0}`);
    const table = cmBuildResolveTable(owned, attacker, target, notes);
    return table.map((entry, i) => {
        const next = table[i + 1];
        const from = parseInt(entry.from) || 0;
        const label = (from === 0)
            ? '未造成傷害（含未命中）'
            : (next ? `造成 ${from}～${(parseInt(next.from) || 0) - 1} 點傷害` : `造成 ${from} 點以上傷害`);
        return { label, selfTxt: (entry.selfStatusNotes || []).join('、'), targetTxt: (entry.targetStatusNotes || []).join('、') };
    }).filter(row => row.selfTxt || row.targetTxt);
}

/**
 * 產生「被攻擊時（onDefend）」的預覽：近戰／遠程各算一次。
 * @param {Array<{id:string,unlocked:boolean}>} owned
 * @param {object} selfState - 引擎格式的自身狀態
 * @returns {Array<{label:string, foeTxt:string, selfTxt:string}>}
 */
function collectDefendPreview(owned, selfState) {
    if (typeof evaluatePlayerDefend !== 'function') return [];
    const foeUnit = (typeof findUnitById === 'function' && idtLastAttackerUnitId)
        ? findUnitById(idtLastAttackerUnitId) : null;
    const foeState = buildEngineUnitState(foeUnit);
    return [
        { label: '🗡 被近戰攻擊', melee: true },
        { label: '🏹 被遠程攻擊', melee: false }
    ].map(({ label, melee }) => {
        const res = evaluatePlayerDefend(owned, selfState, foeState, { melee });
        return { label, foeTxt: idtStatusMapNote(res.attackerStatus), selfTxt: idtStatusMapNote(res.selfStatus) };
    }).filter(row => row.foeTxt || row.selfTxt);
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
                // text 可為字串或 (target, attacker) => string：讓提醒直接把算好的數字寫進去
                // （例：「呼吸法 32 層 → 友方攻擊檢定 +4」），玩家不必自己心算門檻。
                let text = rm.text;
                if (typeof text === 'function') {
                    try { text = text(target, attacker); } catch (e) { text = ''; }
                }
                if (show && text) out.push({ card: card.name, text });
            }
        }
        if (card.formNote) out.push({ card: card.name, text: card.formNote, note: true });
    }
    return out;
}

/**
 * 全自動即時重算：不再需要手動按「計算」——卡片勾選、目標變動時直接同步更新，
 * renderIdentityModal 每次渲染前也會呼叫一次，確保結果恆與目前選擇一致。
 */
function refreshIdentityResult() {
    computeIdentityResult();
}

// ===== 回合開始資源 =====
// 舊的「🎯 套用目標狀態／🔵 套用自身狀態」手動按鈕（含二次確認）已移除：
// 狀態套用已全自動化——攻擊宣告狀態於發起攻擊時套用（submitAttackModal），
// 命中狀態（含自身增益）於 ST 命中判定後套用（cmApplyOnHitIdentityStatuses，
// 涵蓋自動擲骰／手動擲骰確認／豁免抵擋三種結算路徑）。
// 結果面板改為「攻擊宣告時／命中時」分階段的唯讀預覽（見 renderIdentityResult）。

/**
 * 執行「回合開始資源獲取」的核心邏輯（手動按鈕與自動觸發共用）。
 * 沿用目前人格卡面板選中角色（identityHudState.owner）已勾選持有的卡片。
 * @param {string} unitId - 要代入引擎與實際套用狀態的單位 id
 * @returns {number} 實際套用的狀態種類數
 */
function performIdentityTurnStart(unitId) {
    if (typeof evaluatePlayerTurnStart !== 'function') return 0;
    // 上回合宣告卻沒打出的主動技加值不應延續到本回合，回合開始時清除
    idtClearPendingActiveBonus(unitId);
    // 動作消耗（迅捷／移動／標準）逐回合重置，讓本回合可再次宣告消耗換取資源
    idtResetActionUsed(unitId);
    const owned = collectOwnedIdentities();
    const attackerUnit = (typeof findUnitById === 'function') ? findUnitById(unitId) : null;
    const res = evaluatePlayerTurnStart(owned, buildEngineUnitState(attackerUnit));
    // 回合開始的 selfStatus 可能含負值（如【狂信】持續到「下一次回合開始前」→ 以負層數自動清除），
    // 故走 delta 版本：正值累加、負值扣減並於歸零時移除。
    let n = applyEngineStatusDeltasToUnit(unitId, res.expectedSelfStatus);
    if (res.poolDelta) applyEnginePoolDelta(res.poolDelta);

    // 護盾值獲取（如羅佳「穩紮穩打」）：加到單位卡的一次性護盾，而非狀態層數
    const shieldGain = (res.totals && parseInt(res.totals.selfShield)) || 0;
    if (shieldGain > 0 && attackerUnit) {
        attackerUnit.shieldTemp = (parseInt(attackerUnit.shieldTemp) || 0) + shieldGain;
        if (typeof broadcastState === 'function') broadcastState();
        if (typeof showToast === 'function') showToast(`🛡 回合開始：獲得 ${shieldGain} 點一次性護盾`);
        n++;
    }

    // 指令對象抽選（食指被動）：持有標記 commandTargetRoll 的卡片時，
    // 骰一顆等同場上敵人數量的面骰決定本回合指令對象
    const hasRollCard = owned.some(entry => {
        const card = (typeof getIdentityById === 'function') ? getIdentityById(entry.id) : null;
        return card && card.commandTargetRoll;
    });
    if (hasRollCard && idtRollCommandTarget()) n++;

    return n;
}

/**
 * 食指（被動）：骰 1D[場上敵人數] 抽選本回合的「指令對象」。
 * 先清除場上所有既有的指令對象標記，再對骰中的敵人套上 1 層指令對象並同步。
 * @returns {boolean} 是否成功抽選
 */
function idtRollCommandTarget() {
    if (typeof state === 'undefined' || !Array.isArray(state.units)) return false;
    // 行動條目（actionSlotOf）只佔先攻格，不是真正的敵人，排除
    const enemies = state.units.filter(u =>
        (u.type === 'enemy' || u.type === 'boss') && !u.actionSlotOf);
    if (!enemies.length) return false;

    const def = (typeof getStatusById === 'function') ? getStatusById('command_target') : null;
    const name = def ? def.name : '指令對象';

    // 清除上一回合的指令對象（不逐一跳 toast，統一在抽選結果提示）
    state.units.forEach(u => {
        if (u.status && u.status[name] !== undefined) {
            delete u.status[name];
            if (typeof syncUnitStatus === 'function') syncUnitStatus(u.id);
        }
    });

    const rolled = Math.floor(Math.random() * enemies.length); // 0-based
    const chosen = enemies[rolled];
    if (typeof addStatusToUnit === 'function') addStatusToUnit(chosen.id, 'command_target', 1);
    if (typeof showToast === 'function') {
        showToast(`🎯 指令抽選：1D${enemies.length} 骰出 ${rolled + 1} → 本回合指令對象「${chosen.name || '敵方單位'}」`);
    }
    return true;
}

function runIdentityTurnStart() {
    if (typeof evaluatePlayerTurnStart !== 'function') return;
    if (!identityHudState.attackerId) { if (typeof showToast === 'function') showToast('請先指定我方單位'); return; }
    const n = performIdentityTurnStart(identityHudState.attackerId);
    if (typeof showToast === 'function') {
        showToast(n ? `回合開始：已對我方套用 ${n} 種資源` : '本組人格卡無回合開始資源');
    }
}

/**
 * 各玩家客戶端偵測到「現在輪到自己的單位行動」時自動呼叫（見 firebase-connection.js
 * 對 state.turnIdx 的監聽）。ST 端沒有玩家的 identityHudState（存在各玩家自己瀏覽器的
 * localStorage），故完全依賴每個玩家自行判斷並在本地觸發，不走 ST 專用的 nextTurn()。
 * @param {object} unit - 剛輪到行動、且 ownerId 為自己的單位
 */
function autoTriggerIdentityTurnStart(unit) {
    if (!unit || typeof myRole === 'undefined' || myRole === 'st') return;
    if (typeof evaluatePlayerTurnStart !== 'function') return;
    if (!identityHudState.owner) return; // 尚未在人格卡面板選擇角色，無從得知持有卡片
    const n = performIdentityTurnStart(unit.id);
    if (n > 0 && typeof showToast === 'function') {
        showToast(`🔄 回合開始：已自動對「${unit.name || '你的單位'}」套用 ${n} 種資源`);
    }
}

// ===== 動作消耗（onActionUsed）=====
// 浮士德【紙條】的指令加護規則是「每消耗一種動作（迅捷／移動／標準）+5 層，上限 9 層」。
// 網站本身只追蹤移動距離（unit.moveUsed），沒有迅捷／標準動作的消耗紀錄，
// 故由玩家在人格卡面板按下對應動作來宣告消耗；每種動作每回合限一次，回合開始自動重置。

/** 三種動作的鍵與顯示名（順序即面板按鈕順序） */
const IDT_ACTION_TYPES = [
    { key: 'swift', name: '迅捷動作', icon: '⚡' },
    { key: 'move', name: '移動動作', icon: '🏃' },
    { key: 'standard', name: '標準動作', icon: '⚔️' }
];

/**
 * 本回合已消耗的動作紀錄：unitId → { swift: true, ... }。
 * 純本地暫存（與 identityHudState 一樣只存在玩家自己的瀏覽器），回合開始時重置。
 */
const idtActionUsed = {};

/** 某單位本回合是否已消耗該動作 */
function idtIsActionUsed(unitId, actionType) {
    return !!(idtActionUsed[unitId] && idtActionUsed[unitId][actionType]);
}

/** 清除某單位的動作消耗紀錄（回合開始時呼叫） */
function idtResetActionUsed(unitId) {
    delete idtActionUsed[unitId];
}

/**
 * 玩家宣告「消耗掉某個動作」：跑 onActionUsed 結算並把資源套用到自己的單位。
 * 每種動作每回合限一次，避免重複點擊灌爆資源。
 * @param {string} actionType - 'swift' | 'move' | 'standard'
 * @returns {number} 實際套用的狀態種類數
 */
function idtUseAction(actionType) {
    const unitId = identityHudState.attackerId;
    if (!unitId) {
        if (typeof showToast === 'function') showToast('請先指定我方單位');
        return 0;
    }
    if (typeof evaluatePlayerActionUsed !== 'function') return 0;

    const meta = IDT_ACTION_TYPES.find(a => a.key === actionType);
    const actionName = meta ? meta.name : actionType;
    if (idtIsActionUsed(unitId, actionType)) {
        if (typeof showToast === 'function') showToast(`本回合的${actionName}已經消耗過了`);
        return 0;
    }

    const owned = collectOwnedIdentities();
    const attackerUnit = (typeof findUnitById === 'function') ? findUnitById(unitId) : null;
    const res = evaluatePlayerActionUsed(owned, buildEngineUnitState(attackerUnit), actionType);
    const n = applyEngineStatusesToUnit(unitId, res.expectedSelfStatus);

    if (!idtActionUsed[unitId]) idtActionUsed[unitId] = {};
    idtActionUsed[unitId][actionType] = true;

    if (typeof showToast === 'function') {
        const notes = Object.entries(res.expectedSelfStatus || {})
            .map(([k, v]) => `${identityStatusName(k)}+${v}`)
            .join('、');
        showToast(notes
            ? `${meta ? meta.icon : ''} 已消耗${actionName}：${notes}`
            : `${meta ? meta.icon : ''} 已消耗${actionName}（本組人格卡無對應資源）`);
    }
    renderIdentityModal();
    return n;
}

/**
 * 渲染「動作消耗」區：僅在持有帶 actionUsedTracker 標記的卡片時顯示
 * （目前為浮士德【紙條】的指令加護）。已消耗的動作按鈕會變為停用狀態。
 * @returns {string} HTML
 */
function renderIdentityActionUsed() {
    const owned = collectOwnedIdentities();
    const trackerCards = owned
        .map(entry => (typeof getIdentityById === 'function') ? getIdentityById(entry.id) : null)
        .filter(card => card && card.actionUsedTracker);
    if (!trackerCards.length) return '';

    const unitId = identityHudState.attackerId;
    const btns = IDT_ACTION_TYPES.map(a => {
        const used = unitId && idtIsActionUsed(unitId, a.key);
        return `<button class="idt-btn idt-action-btn${used ? ' is-used' : ''}"
                    ${used ? 'disabled' : ''}
                    onclick="idtUseAction('${a.key}')"
                    title="宣告消耗${a.name}，自動結算對應的人格卡資源（每回合一次）">
                    ${a.icon} ${a.name}${used ? '（已消耗）' : ''}
                </button>`;
    }).join('');

    const note = trackerCards.map(c => c.formNote).filter(Boolean).join('　');
    return `
        <div class="idt-section idt-action-section">
            <div class="idt-section-title">🕐 動作消耗（每回合各一次，回合開始自動重置）</div>
            <div class="idt-action-btns">${btns}</div>
            ${note ? `<div class="idt-hint">${(typeof escapeHtml === 'function') ? escapeHtml(note) : note}</div>` : ''}
        </div>`;
}

/**
 * 執行「回合結束」人格卡結算（onTurnEnd）：對自身套用回合結束的資源變化。
 * 與回合開始對稱；沿用人格卡面板選中角色已勾選持有的卡片。
 * @param {string} unitId
 * @returns {number} 實際套用的狀態種類數
 */
function performIdentityTurnEnd(unitId) {
    if (typeof evaluatePlayerTurnEnd !== 'function') return 0;
    const owned = collectOwnedIdentities();
    const attackerUnit = (typeof findUnitById === 'function') ? findUnitById(unitId) : null;
    const res = evaluatePlayerTurnEnd(owned, buildEngineUnitState(attackerUnit));
    // onTurnEnd 的 selfStatus 可能含負值（資源衰減）：正值累加、負值扣減並於歸零時移除
    return applyEngineStatusDeltasToUnit(unitId, res.expectedSelfStatus);
}

/**
 * 各玩家客戶端偵測到「自己的單位剛結束行動」時自動呼叫（見 firebase-connection.js
 * 對 state.turnIdx 的監聽）。與 autoTriggerIdentityTurnStart 對稱。
 * @param {object} unit - 剛結束行動、且 ownerId 為自己的單位
 */
function autoTriggerIdentityTurnEnd(unit) {
    if (!unit || typeof myRole === 'undefined' || myRole === 'st') return;
    if (typeof evaluatePlayerTurnEnd !== 'function') return;
    if (!identityHudState.owner) return;
    const n = performIdentityTurnEnd(unit.id);
    if (n > 0 && typeof showToast === 'function') {
        showToast(`🔚 回合結束：已自動對「${unit.name || '你的單位'}」結算 ${n} 種人格卡資源`);
    }
}

// ===== 渲染 =====

/** 目標下拉只列敵方／BOSS 單位（我方攻擊者已鎖定為玩家自己，不再需要選單位）。 */
function renderIdentityUnitOptions(selectedId) {
    let opts = '<option value="">（未指定）</option>';
    if (typeof state !== 'undefined' && Array.isArray(state.units)) {
        for (const u of state.units) {
            if (u.type !== 'enemy' && u.type !== 'boss') continue;
            const sel = (u.id === selectedId) ? ' selected' : '';
            const safe = (typeof escapeHtml === 'function') ? escapeHtml(u.name || '') : (u.name || '');
            opts += `<option value="${u.id}"${sel}>🔴 ${safe}（先攻 ${u.init || 0}）</option>`;
        }
    }
    return opts;
}

/** 顯示鎖定為攻擊者的自身單位名稱（找不到時提示尚未偵測到自己的單位）。 */
function idtSelfUnitLabel() {
    const u = (typeof findUnitById === 'function' && identityHudState.attackerId)
        ? findUnitById(identityHudState.attackerId) : null;
    return u ? (u.name || '（未命名單位）') : '（尚未偵測到你的單位）';
}

/** 取得某卡關鍵狀態的中文名稱清單（引擎英文鍵 → 狀態庫中文名） */
function idtKeyStatusNames(card) {
    if (!Array.isArray(card.keyStatuses)) return [];
    return card.keyStatuses.map(key => {
        const sid = (typeof IDENTITY_STATUS_KEYMAP !== 'undefined' && IDENTITY_STATUS_KEYMAP[key]) || key;
        const def = (typeof getStatusById === 'function') ? getStatusById(sid) : null;
        return def ? { icon: def.icon || '', name: def.name } : { icon: '', name: key };
    });
}

/** 卡片是否符合目前的篩選字串（比對名稱／解鎖技名／各技能名／關鍵狀態中文名） */
function idtCardMatchesFilter(card) {
    const q = (identityHudState.cardFilter || '').trim().toLowerCase();
    if (!q) return true;
    const parts = [card.name || '', card.repeatUnlockSkill || ''];
    idtKeyStatusNames(card).forEach(s => parts.push(s.name));
    if (card.hooks) {
        Object.values(card.hooks).forEach(hookArr => {
            if (Array.isArray(hookArr)) hookArr.forEach(h => { if (h && h.skill) parts.push(h.skill); });
        });
    }
    return parts.join('\n').toLowerCase().includes(q);
}

/** 篩選輸入：只重繪卡片清單，避免整個面板重繪造成輸入框失焦 */
function idtSetCardFilter(value) {
    identityHudState.cardFilter = value || '';
    const list = document.querySelector('#identity-modal .idt-card-list');
    if (list) list.innerHTML = renderIdentityCardList();
}

function renderIdentityCardList() {
    if (typeof getIdentitiesByOwner !== 'function' || !identityHudState.owner) return '';
    const ids = getIdentitiesByOwner(identityHudState.owner);
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);
    const items = ids.map(cardId => {
        const card = (typeof getIdentityById === 'function') ? getIdentityById(cardId) : null;
        if (!card) return '';
        if (!idtCardMatchesFilter(card)) return '';
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
        // 關鍵狀態小標籤：一眼看出這張卡圍繞哪些狀態運作
        const chips = idtKeyStatusNames(card).map(s =>
            `<span class="idt-key-chip">${esc(s.icon)}${esc(s.name)}</span>`).join('');
        return `
            <div class="idt-card ${c.owned ? 'idt-owned' : ''}">
                <label class="idt-own">
                    <input type="checkbox" ${c.owned ? 'checked' : ''} onchange="toggleIdentityCard('${cardId}')">
                    <span class="idt-card-name">${name}${card.custom ? ' <span class="idt-custom-tag">自訂</span>' : ''}</span>
                </label>
                ${chips ? `<div class="idt-key-chips">${chips}</div>` : ''}
                ${unlockCtrl}
                ${delCtrl}
            </div>`;
    }).join('');
    if (items.replace(/\s/g, '') === '' && (identityHudState.cardFilter || '').trim()) {
        return '<div class="idt-no-unlock" style="padding:6px 2px;">沒有符合篩選的人格卡</div>';
    }
    return items;
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

// ===== 主動宣告技（onActive）=====
//
// 宣告技的完整結算流程：按下「宣告」→ 檢查使用次數與資源 → 二次確認 → 扣除資源 →
// 套用效果（狀態／傷害／恢復／資源池）→ 數值加值併入「下一次攻擊」的黑箱計算。
// 之所以把加值暫存而不是當場算進某次攻擊：宣告的時機是「攻擊前」，玩家還沒送出攻擊。
//
// effect 的完整欄位（數值欄位皆可寫成 (ctx) => number，ctx 見 idtBuildDeclareCtx）：
//   ── 自身成本 ──
//     cost:        { charge: 2 }          固定層數，不足則無法宣告
//     costAll:     ['knowledge']          消耗全部層數（消耗量記入 ctx.consumedSelf）
//     poolCost:    { bloodFeast: 2 }      全隊共用資源池
//     selfHp:      { type: 'a', amount: 3 }  對自己造成傷害（閃擊戰術的自傷加骰）
//   ── 目標成本 ──
//     targetCost:      { tremor: 10 }     固定層數，目標不足則無法宣告
//     targetCostMax:   { tremor: 5 }      最多 N 層（有多少扣多少）
//     targetCostAll:   ['tremor']         全部層數
//     targetCostHalve: ['burn']           減半（消耗量 = 原值 − floor(原值/2)）
//   ── 效果 ──
//     selfClear:    ['magicBullet']       自身狀態歸零（非成本，純重置）
//     selfStatus / targetStatus           施加狀態（層數可為 ctx 函式）
//     poolDelta:    { bloodFeast: 1 }     資源池增減
//     targetDamage: { type:'l', amount }  直接對目標造成傷害
//     selfHeal:     { type:'heal-l', amount }  恢復自身傷害
//     targetMaxHpReduce: n | (ctx)=>n     削減目標生命上限（＝震顫的「昏迷閾值前移」）
//   ── 擲骰退費 ──
//     costRoll: { die: 10, refundAtLeast: 8, label }  宣告時擲骰，骰到門檻以上則不扣目標成本
//   ── 併入攻擊的數值加值 ──
//     dpBonus / extraSuccess / spellPower / weaponDamage / finalDamage → 併入「下一次攻擊」
//     nextTurnBonus: { extraSuccess: 2, weaponDamage: 3 } → 改為併入「下一回合」的攻擊
//   ── 前置條件（檢查但不消耗）──
//     requireSelf:   { gale: 10 }        自身層數需達門檻
//     requireTarget: { burn: 15 }        目標層數需達門檻
//   ── 使用限制 ──
//     once: 'battle' | 'turn'
//
// 已宣告、待併入「下一次攻擊」的主動技加值（依攻擊者單位 id 暫存，發起攻擊時取用並清除）。
// { [unitId]: { dp, extraSuccess, damage, notes: [] } }
let idtPendingActiveBonus = {};

// 宣告後要留到「下一回合」才生效的加值（噩夢吞噬、穿刺劍法這類「下一次攻擊 +N」）。
// 與 idtPendingActiveBonus 分開存放，因為回合開始會清空 pending（避免上回合宣告卻沒打出的加值殘留），
// 若共用同一個桶，這類效果會在生效前就被清掉。回合開始時由本桶轉入 pending。
let idtNextTurnActiveBonus = {};

// 宣告技的使用次數紀錄：unitId → { [cardId#index]: { battle: true, round: 3 } }
// 純本地暫存（與 identityHudState 一樣只存在玩家自己的瀏覽器）。
const idtDeclaredUses = {};

/** 某 onActive 是否可由本面板自動宣告：帶結構化 effect（有成本或有可套用的效果）。 */
function idtIsDeclarable(hook) {
    if (!hook || !hook.effect) return false;
    const eff = hook.effect;
    return ['cost', 'costAll', 'poolCost', 'selfHp',
            'targetCost', 'targetCostMax', 'targetCostAll', 'targetCostHalve',
            'selfClear', 'selfStatus', 'targetStatus', 'poolDelta',
            'targetDamage', 'selfHeal', 'targetMaxHpReduce', 'selfShield', 'nextTurnBonus',
            // 純加值型宣告技（無成本，例：鋸刃切割「已為 8 加骰 → +4 DP」）同樣要能按下宣告
            'dpBonus', 'extraSuccess', 'spellPower', 'weaponDamage', 'finalDamage']
        .some(k => eff[k] !== undefined);
}

/** 解析 effect 上「數字或 (ctx)=>數字」的欄位。 */
function idtResolveEffectValue(value, ctx) {
    try {
        const n = (typeof value === 'function') ? value(ctx) : value;
        return Number.isFinite(Number(n)) ? Number(n) : 0;
    } catch (e) { return 0; }
}

/** 把 effect 上的狀態物件（層數可為 ctx 函式）解析成純數字物件。 */
function idtResolveStatusMap(map, ctx) {
    const out = {};
    for (const [k, v] of Object.entries(map || {})) {
        const n = Math.round(idtResolveEffectValue(v, ctx));
        if (n !== 0) out[k] = n;
    }
    return out;
}

/** 取得單位身上某引擎狀態鍵目前的層數。 */
function idtStatusLayers(unit, engKey) {
    if (!unit || !unit.status) return 0;
    const name = identityStatusName(engKey);
    return parseInt(unit.status[name]) || 0;
}

/** 直接設定單位身上某引擎狀態鍵的層數（0 會移除該狀態）。 */
function idtSetStatusLayers(unitId, engKey, layers) {
    if (typeof updateStatusStacks !== 'function') return;
    updateStatusStacks(unitId, identityStatusName(engKey), Math.max(0, parseInt(layers) || 0));
}

/**
 * 對任一單位套用傷害／恢復。
 *
 * 刻意不走 units.js 的 modifyHP()：那個入口帶 canControlUnit() 檢查，玩家無法對敵方使用；
 * 但「震顫引爆」「一點突破」這類宣告技本來就是玩家對敵方造成傷害的正規手段，
 * 與既有「玩家端把命中狀態直接套到敵方單位」（applyEngineStatusesToUnit）是同一類操作。
 * 傷害會寫進戰鬥日誌，ST 端看得到來源。
 * @param {string} unitId
 * @param {string} type - 'b' | 'l' | 'a' | 'heal' | 'heal-b' | 'heal-l' | 'heal-a'
 * @param {number} amount
 */
function idtApplyHpChange(unitId, type, amount) {
    const n = Math.max(0, parseInt(amount) || 0);
    if (!unitId || !n) return;
    const unit = (typeof findUnitById === 'function') ? findUnitById(unitId) : null;
    if (!unit) return;

    if (typeof myRole !== 'undefined' && myRole === 'st') {
        if (typeof modifyHPInternal === 'function') modifyHPInternal(unit, type, n);
        if (typeof broadcastState === 'function') broadcastState();
    } else if (typeof sendToHost === 'function') {
        sendToHost({ type: 'modifyHP', playerId: (typeof myPlayerId !== 'undefined' ? myPlayerId : null),
                     unitId, dmgType: type, amount: n });
    }
}

/** 宣告技的使用紀錄鍵。 */
function idtUseKey(cardId, index) { return `${cardId}#${index}`; }

/**
 * 檢查宣告技的使用次數限制。
 * @returns {{ ok: boolean, reason: string }}
 */
function idtCheckUseLimit(unitId, cardId, index, once) {
    if (!once) return { ok: true, reason: '' };
    const rec = (idtDeclaredUses[unitId] || {})[idtUseKey(cardId, index)];
    if (!rec) return { ok: true, reason: '' };
    if (once === 'battle' && rec.battle) return { ok: false, reason: '本場戰鬥已使用過' };
    if (once === 'turn') {
        const round = (typeof state !== 'undefined' && state.roundNum) || 0;
        if (rec.round === round) return { ok: false, reason: '本回合已使用過' };
    }
    return { ok: true, reason: '' };
}

/** 記錄一次宣告技的使用。 */
function idtRecordUse(unitId, cardId, index, once) {
    if (!once) return;
    if (!idtDeclaredUses[unitId]) idtDeclaredUses[unitId] = {};
    const key = idtUseKey(cardId, index);
    const rec = idtDeclaredUses[unitId][key] || {};
    if (once === 'battle') rec.battle = true;
    if (once === 'turn') rec.round = (typeof state !== 'undefined' && state.roundNum) || 0;
    idtDeclaredUses[unitId][key] = rec;
}

/** 戰鬥結束／重新開始時清除所有宣告技使用紀錄。 */
function idtResetDeclaredUses() {
    for (const k of Object.keys(idtDeclaredUses)) delete idtDeclaredUses[k];
}

/**
 * 先「試算」一次宣告：算出所有成本的實際數量與是否負擔得起，但不真的扣除。
 * 供渲染時顯示成本／停用按鈕，以及宣告時的二次確認文案共用同一份計算，
 * 避免「按鈕說得起、按下去卻失敗」或「確認視窗寫的數字與實際扣的不同」。
 *
 * @param {object} eff - onActive 的 effect
 * @param {object} unit - 宣告者單位
 * @param {object} targetUnit - 目標單位（可為 null）
 * @returns {{ affordable: boolean, blockers: string[], costParts: string[],
 *             selfCost: object, poolCost: object, targetCost: object, selfHp: object|null }}
 */
function idtPlanDeclareCost(eff, unit, targetUnit) {
    const out = { affordable: true, blockers: [], costParts: [],
                  selfCost: {}, poolCost: {}, targetCost: {}, selfHp: null };
    const block = (msg) => { out.affordable = false; out.blockers.push(msg); };

    // ── 前置條件（檢查但不消耗）──
    for (const [engKey, amt] of Object.entries(eff.requireSelf || {})) {
        const need = parseInt(amt) || 0;
        const cur = idtStatusLayers(unit, engKey);
        out.costParts.push(`需自身${identityStatusName(engKey)} ${cur}/${need}`);
        if (cur < need) block(`自身${identityStatusName(engKey)}未達 ${need}（現有 ${cur}）`);
    }
    for (const [engKey, amt] of Object.entries(eff.requireTarget || {})) {
        const need = parseInt(amt) || 0;
        const cur = idtStatusLayers(targetUnit, engKey);
        out.costParts.push(`需目標${identityStatusName(engKey)} ${cur}/${need}`);
        if (!targetUnit) block('尚未指定目標單位');
        else if (cur < need) block(`目標${identityStatusName(engKey)}未達 ${need}（現有 ${cur}）`);
    }

    // ── 自身狀態成本 ──
    for (const [engKey, amt] of Object.entries(eff.cost || {})) {
        const need = parseInt(amt) || 0;
        if (need <= 0) continue;
        const cur = idtStatusLayers(unit, engKey);
        out.selfCost[engKey] = need;
        out.costParts.push(`${identityStatusName(engKey)} ${cur}/${need}`);
        if (cur < need) block(`${identityStatusName(engKey)} 不足（需 ${need}、現有 ${cur}）`);
    }
    for (const engKey of (eff.costAll || [])) {
        const cur = idtStatusLayers(unit, engKey);
        out.selfCost[engKey] = cur;
        out.costParts.push(`${identityStatusName(engKey)} 全部 ${cur}`);
        if (cur <= 0) block(`沒有可消耗的${identityStatusName(engKey)}`);
    }

    // ── 全隊共用資源池成本 ──
    const pools = idtGetTeamPools();
    for (const [key, amt] of Object.entries(eff.poolCost || {})) {
        const need = parseInt(amt) || 0;
        if (need <= 0) continue;
        const def = (typeof IDENTITY_TEAM_POOLS !== 'undefined') ? IDENTITY_TEAM_POOLS[key] : null;
        const label = def ? def.name : key;
        const cur = pools[key] || 0;
        out.poolCost[key] = need;
        out.costParts.push(`${label} ${cur}/${need}`);
        if (cur < need) block(`${label} 不足（需 ${need}、現有 ${cur}）`);
    }

    // ── 目標狀態成本 ──
    const needsTarget = !!(eff.targetCost || eff.targetCostMax || eff.targetCostAll || eff.targetCostHalve
                        || eff.targetStatus || eff.targetDamage || eff.targetMaxHpReduce || eff.requireTarget);
    if (needsTarget && !targetUnit) block('尚未指定目標單位');

    for (const [engKey, amt] of Object.entries(eff.targetCost || {})) {
        const need = parseInt(amt) || 0;
        if (need <= 0) continue;
        const cur = idtStatusLayers(targetUnit, engKey);
        out.targetCost[engKey] = need;
        out.costParts.push(`目標${identityStatusName(engKey)} ${cur}/${need}`);
        if (targetUnit && cur < need) block(`目標的${identityStatusName(engKey)} 不足（需 ${need}、現有 ${cur}）`);
    }
    for (const [engKey, amt] of Object.entries(eff.targetCostMax || {})) {
        const cap = parseInt(amt) || 0;
        const cur = idtStatusLayers(targetUnit, engKey);
        const take = Math.min(cap, cur);
        out.targetCost[engKey] = take;
        out.costParts.push(`目標${identityStatusName(engKey)} ${cur} → 消耗 ${take}（上限 ${cap}）`);
        if (targetUnit && take <= 0) block(`目標沒有可引爆的${identityStatusName(engKey)}`);
    }
    for (const engKey of (eff.targetCostAll || [])) {
        const cur = idtStatusLayers(targetUnit, engKey);
        out.targetCost[engKey] = cur;
        out.costParts.push(`目標${identityStatusName(engKey)} 全部 ${cur}`);
        if (targetUnit && cur <= 0) block(`目標沒有可消耗的${identityStatusName(engKey)}`);
    }
    for (const engKey of (eff.targetCostHalve || [])) {
        const cur = idtStatusLayers(targetUnit, engKey);
        const take = cur - Math.floor(cur / 2);   // 減半後被消耗掉的量
        out.targetCost[engKey] = take;
        out.costParts.push(`目標${identityStatusName(engKey)} ${cur} → ${Math.floor(cur / 2)}（減半）`);
        if (targetUnit && cur <= 0) block(`目標沒有可減半的${identityStatusName(engKey)}`);
    }

    // ── 自傷成本 ──
    if (eff.selfHp) {
        const amount = Math.max(0, parseInt(eff.selfHp.amount) || 0);
        out.selfHp = { type: eff.selfHp.type || 'a', amount };
        if (amount > 0) out.costParts.push(`自身承受 ${amount} 點 ${String(out.selfHp.type).toUpperCase()} 傷`);
    }

    return out;
}

/** 宣告是否需要二次確認：只要會扣掉任何資源／自傷就要，避免誤按把資源灌掉。 */
function idtDeclareHasCost(plan) {
    return Object.keys(plan.selfCost).length > 0
        || Object.keys(plan.poolCost).length > 0
        || Object.keys(plan.targetCost).length > 0
        || !!(plan.selfHp && plan.selfHp.amount > 0);
}

/**
 * 建立效果數值函式可讀的 ctx。
 * selfBefore / targetBefore 是「扣除成本之前」的快照——像震顫引爆這種
 * 「削減量依原本的層數、但只移除其中幾層」的規則，必須讀扣除前的數字才會對。
 * @param {object} unit
 * @param {object} targetUnit
 * @param {object} consumedSelf - 實際從自身扣掉的層數
 * @param {object} consumedTarget - 實際從目標扣掉的層數
 * @param {object} [before] - { self, target } 扣除前的引擎格式快照
 */
function idtBuildDeclareCtx(unit, targetUnit, consumedSelf, consumedTarget, before) {
    return {
        self: unit ? buildEngineUnitState(unit) : { status: {} },
        target: targetUnit ? buildEngineUnitState(targetUnit) : { status: {} },
        selfBefore: (before && before.self) || { status: {} },
        targetBefore: (before && before.target) || { status: {} },
        consumedSelf: consumedSelf || {},
        consumedTarget: consumedTarget || {},
        pools: idtGetTeamPools()
    };
}

/**
 * 削減單位的生命上限（震顫引爆的「昏迷閾值前移」）。
 * hpArr 依新上限截短（先排序保留最嚴重的傷害），與 status-manager 的震顫消耗行為一致。
 * @param {string} unitId
 * @param {number} amount
 * @returns {number} 實際削減量
 */
function idtReduceMaxHp(unitId, amount) {
    const cut = Math.max(0, parseInt(amount) || 0);
    const unit = (typeof findUnitById === 'function') ? findUnitById(unitId) : null;
    if (!unit || !cut) return 0;
    const before = Math.max(1, parseInt(unit.maxHp) || (Array.isArray(unit.hpArr) ? unit.hpArr.length : 1));
    const next = Math.max(1, before - cut);
    if (next === before) return 0;

    if (typeof myRole !== 'undefined' && myRole === 'st') {
        unit.maxHp = next;
        if (Array.isArray(unit.hpArr)) {
            unit.hpArr.sort((a, b) => b - a);
            unit.hpArr = unit.hpArr.slice(0, next);
        }
        if (typeof broadcastState === 'function') broadcastState();
    } else if (typeof sendToHost === 'function') {
        sendToHost({ type: 'modifyMaxHp', playerId: (typeof myPlayerId !== 'undefined' ? myPlayerId : null),
                     unitId, newMaxHp: next });
    }
    return before - next;
}

/** 計算 effect 的數值加值（spellPower／weaponDamage／finalDamage 皆折算為傷害）。 */
function idtEffectBonuses(eff, ctx) {
    const v = (k) => Math.round(idtResolveEffectValue(eff[k], ctx));
    return {
        dp: v('dpBonus'),
        extraSuccess: v('extraSuccess'),
        damage: v('spellPower') + v('weaponDamage') + v('finalDamage')
    };
}

/**
 * 玩家宣告一項主動技（onActive 且帶結構化 effect）。
 *
 * 流程：使用次數檢查 → 資源試算 → 二次確認（有成本時）→ 扣除成本 → 套用效果 →
 *       數值加值併入下一次攻擊（或下一回合）→ 記錄使用次數。
 * @param {string} cardId
 * @param {number} index - onActive 陣列索引
 */
function idtDeclareActiveSkill(cardId, index) {
    const card = (typeof getIdentityById === 'function') ? getIdentityById(cardId) : null;
    if (!card || !card.hooks || !Array.isArray(card.hooks.onActive)) return;
    const hook = card.hooks.onActive[index];
    if (!idtIsDeclarable(hook)) return;
    const eff = hook.effect;
    const skillName = hook.name || hook.source || '宣告技';

    const unitId = identityHudState.attackerId;
    const unit = (typeof findUnitById === 'function' && unitId) ? findUnitById(unitId) : null;
    if (!unit) { if (typeof showToast === 'function') showToast('請先指定我方單位'); return; }

    const targetId = identityHudState.targetId;
    const targetUnit = (typeof findUnitById === 'function' && targetId) ? findUnitById(targetId) : null;

    // 1) 使用次數限制
    const limit = idtCheckUseLimit(unitId, cardId, index, eff.once);
    if (!limit.ok) {
        if (typeof showToast === 'function') showToast(`${skillName}：${limit.reason}`);
        return;
    }

    // 2) 資源試算
    const plan = idtPlanDeclareCost(eff, unit, targetUnit);
    if (!plan.affordable) {
        if (typeof showToast === 'function') showToast(`${skillName}：${plan.blockers[0]}`);
        return;
    }

    // 3) 二次確認（只有「會扣掉東西」的宣告才問；純增益宣告不打斷節奏）
    if (idtDeclareHasCost(plan) && typeof confirm === 'function') {
        const lines = [`宣告「${skillName}」？`, '', '將扣除：'];
        for (const [k, n] of Object.entries(plan.selfCost)) lines.push(`　• 自身 ${identityStatusName(k)} −${n}`);
        for (const [k, n] of Object.entries(plan.poolCost)) {
            const def = (typeof IDENTITY_TEAM_POOLS !== 'undefined') ? IDENTITY_TEAM_POOLS[k] : null;
            lines.push(`　• ${def ? def.name : k}（全隊共用）−${n}`);
        }
        for (const [k, n] of Object.entries(plan.targetCost)) {
            lines.push(`　• 目標「${(targetUnit && targetUnit.name) || '敵方'}」的 ${identityStatusName(k)} −${n}`);
        }
        if (plan.selfHp && plan.selfHp.amount > 0) {
            lines.push(`　• 自身承受 ${plan.selfHp.amount} 點 ${String(plan.selfHp.type).toUpperCase()} 傷`);
        }
        if (eff.once) lines.push('', eff.once === 'battle' ? '※ 本場戰鬥限用一次' : '※ 本回合限用一次');
        if (!confirm(lines.join('\n'))) return;
    }

    // 4) 扣除成本（記下實際消耗量，供效果的動態數值使用）
    // 先拍下「扣除前」的快照：像震顫引爆這種「削減量看原本層數、只移除其中幾層」的規則，
    // 若在扣完之後才讀層數就會少算。
    const before = {
        self: buildEngineUnitState(unit),
        target: targetUnit ? buildEngineUnitState(targetUnit) : { status: {} }
    };
    const consumedSelf = {};
    const consumedTarget = {};
    const costNotes = [];

    // 擲骰退費（噩夢吞噬：擲 1D10，8–10 則本次不扣除目標的層數但仍獲得強化）
    let refundTargetCost = false;
    if (eff.costRoll) {
        const die = Math.max(2, parseInt(eff.costRoll.die) || 10);
        const need = parseInt(eff.costRoll.refundAtLeast) || 0;
        const rolled = Math.floor(Math.random() * die) + 1;
        refundTargetCost = need > 0 && rolled >= need;
        if (typeof showToast === 'function') {
            showToast(`🎲 ${eff.costRoll.label || skillName}：1D${die} 骰出 ${rolled}`
                + (refundTargetCost ? ` → 達 ${need}，本次不扣除目標的層數` : ` → 未達 ${need}，照常扣除`));
        }
    }

    for (const [engKey, n] of Object.entries(plan.selfCost)) {
        if (n <= 0) continue;
        idtSetStatusLayers(unitId, engKey, idtStatusLayers(unit, engKey) - n);
        consumedSelf[engKey] = n;
        costNotes.push(`${identityStatusName(engKey)}-${n}`);
    }
    for (const [key, n] of Object.entries(plan.poolCost)) {
        if (n <= 0) continue;
        const def = (typeof IDENTITY_TEAM_POOLS !== 'undefined') ? IDENTITY_TEAM_POOLS[key] : null;
        idtAdjustTeamPool(key, -n);
        costNotes.push(`${def ? def.name : key}-${n}`);
    }
    for (const [engKey, n] of Object.entries(plan.targetCost)) {
        if (n <= 0 || !targetUnit) continue;
        // 消耗量照記（效果的動態數值依「引爆了多少層」計算），只是實際層數不扣
        consumedTarget[engKey] = n;
        if (refundTargetCost) { costNotes.push(`目標${identityStatusName(engKey)} 免扣（擲骰退費）`); continue; }
        idtSetStatusLayers(targetUnit.id, engKey, idtStatusLayers(targetUnit, engKey) - n);
        costNotes.push(`目標${identityStatusName(engKey)}-${n}`);
    }
    if (plan.selfHp && plan.selfHp.amount > 0) {
        idtApplyHpChange(unitId, plan.selfHp.type, plan.selfHp.amount);
        costNotes.push(`自身 ${plan.selfHp.amount} 點 ${String(plan.selfHp.type).toUpperCase()} 傷`);
    }

    const ctx = idtBuildDeclareCtx(unit, targetUnit, consumedSelf, consumedTarget, before);

    // 5) 套用效果
    const applyNotes = [];
    for (const engKey of (eff.selfClear || [])) {
        const cur = idtStatusLayers(unit, engKey);
        if (cur > 0) { idtSetStatusLayers(unitId, engKey, 0); applyNotes.push(`${identityStatusName(engKey)} 歸零`); }
    }
    const tgtStatus = idtResolveStatusMap(eff.targetStatus, ctx);
    if (Object.keys(tgtStatus).length) {
        if (targetUnit) {
            applyEngineStatusDeltasToUnit(targetUnit.id, tgtStatus);
            applyNotes.push('對目標：' + idtStatusMapNote(tgtStatus));
        } else {
            applyNotes.push('⚠ 未指定目標，未套用：' + idtStatusMapNote(tgtStatus));
        }
    }
    const selfStatus = idtResolveStatusMap(eff.selfStatus, ctx);
    if (Object.keys(selfStatus).length) {
        applyEngineStatusDeltasToUnit(unitId, selfStatus);
        applyNotes.push('對自己：' + idtStatusMapNote(selfStatus));
    }
    if (eff.poolDelta) applyEnginePoolDelta(idtResolveStatusMap(eff.poolDelta, ctx));
    if (eff.targetDamage && targetUnit) {
        const dmg = Math.max(0, Math.round(idtResolveEffectValue(eff.targetDamage.amount, ctx)));
        if (dmg > 0) {
            idtApplyHpChange(targetUnit.id, eff.targetDamage.type || 'l', dmg);
            applyNotes.push(`對目標造成 ${dmg} 點 ${String(eff.targetDamage.type || 'l').toUpperCase()} 傷`);
        }
    }
    if (eff.targetMaxHpReduce !== undefined && targetUnit) {
        const cut = idtReduceMaxHp(targetUnit.id, Math.round(idtResolveEffectValue(eff.targetMaxHpReduce, ctx)));
        if (cut > 0) applyNotes.push(`目標生命上限 −${cut}（昏迷閾值前移）`);
    }
    if (eff.selfHeal) {
        const heal = Math.max(0, Math.round(idtResolveEffectValue(eff.selfHeal.amount, ctx)));
        if (heal > 0) {
            idtApplyHpChange(unitId, eff.selfHeal.type || 'heal-l', heal);
            applyNotes.push(`自身恢復 ${heal} 點傷害`);
        }
    }
    if (eff.selfShield !== undefined) {
        // 一次性護盾（單位卡上的護盾值），與人民之盾狀態不同
        const gain = Math.max(0, Math.round(idtResolveEffectValue(eff.selfShield, ctx)));
        if (gain > 0) {
            unit.shieldTemp = (parseInt(unit.shieldTemp) || 0) + gain;
            if (typeof broadcastState === 'function') broadcastState();
            applyNotes.push(`一次性護盾 +${gain}`);
        }
    }

    // 6) 數值加值併入下一次攻擊（或下一回合的攻擊）
    const b = idtEffectBonuses(eff, ctx);
    if (b.dp || b.extraSuccess || b.damage) idtAddPendingBonus(idtPendingActiveBonus, unitId, b, skillName);

    let nextTurnTxt = '';
    if (eff.nextTurnBonus) {
        const nb = idtEffectBonuses(eff.nextTurnBonus, ctx);
        if (nb.dp || nb.extraSuccess || nb.damage) {
            idtAddPendingBonus(idtNextTurnActiveBonus, unitId, nb, skillName);
            nextTurnTxt = idtBonusText(nb) + '（下一回合生效）';
        }
    }

    // 7) 記錄使用次數
    idtRecordUse(unitId, cardId, index, eff.once);

    const bonusTxt = idtBonusText(b);
    if (typeof showToast === 'function') {
        showToast(`✅ 宣告「${skillName}」`
            + (costNotes.length ? `（消耗 ${costNotes.join('、')}）` : '')
            + (bonusTxt ? `，${bonusTxt} 併入下次攻擊` : '')
            + (nextTurnTxt ? `，${nextTurnTxt}` : '')
            + (applyNotes.length ? `；${applyNotes.join('；')}` : ''));
    }
    renderIdentityModal();
}

/** 把一筆加值累加進指定的暫存桶。 */
function idtAddPendingBonus(bucket, unitId, b, note) {
    const p = bucket[unitId] || { dp: 0, extraSuccess: 0, damage: 0, notes: [] };
    p.dp += b.dp; p.extraSuccess += b.extraSuccess; p.damage += b.damage;
    p.notes.push(note);
    bucket[unitId] = p;
}

/** 把加值物件轉成「DP+2、附加+1、傷害+3」這種顯示字串。 */
function idtBonusText(b) {
    return [b.dp ? `DP+${b.dp}` : '', b.extraSuccess ? `附加+${b.extraSuccess}` : '', b.damage ? `傷害+${b.damage}` : '']
        .filter(Boolean).join('、');
}

/**
 * 取出並清除某單位「待併入攻擊」的主動技加值（combat-modals 於發起攻擊時呼叫）。
 * @param {string} unitId
 * @returns {{dp:number,extraSuccess:number,damage:number,notes:string[]}|null}
 */
function idtConsumePendingActiveBonus(unitId) {
    const p = idtPendingActiveBonus[unitId];
    if (!p) return null;
    delete idtPendingActiveBonus[unitId];
    return p;
}

/**
 * 清除某單位待併入的主動技加值，並把「下一回合才生效」的加值轉入。
 * 回合開始時呼叫：上回合宣告卻沒打出的加值不應延續，但明確標記為「下一回合生效」的必須留下來。
 */
function idtClearPendingActiveBonus(unitId) {
    if (!unitId) return;
    delete idtPendingActiveBonus[unitId];
    const next = idtNextTurnActiveBonus[unitId];
    if (next) {
        idtPendingActiveBonus[unitId] = next;
        delete idtNextTurnActiveBonus[unitId];
        if (typeof showToast === 'function') {
            showToast(`🎯 上回合宣告的加值本回合生效：${idtBonusText(next)}（${next.notes.join('、')}）`);
        }
    }
}

/**
 * 渲染「主動宣告技」區：列出持有卡的 onActive 技能（超載、震顫引爆、消耗資源類等）。
 * 帶結構化 effect 的技能提供「宣告」按鈕：一鍵扣成本、套用效果、加值併入下次攻擊；
 * 資源不足／目標未指定／使用次數已滿時按鈕禁用並標示原因。
 * 純敘述型（無 effect）維持說明顯示，由玩家／ST 依描述判定。
 * 重複抽取解鎖技未勾選解鎖時以半透明＋標籤顯示、不可宣告。
 */
function renderIdentityActiveSkills() {
    const owned = collectOwnedIdentities();
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);
    const unit = (typeof findUnitById === 'function' && identityHudState.attackerId) ? findUnitById(identityHudState.attackerId) : null;
    const targetUnit = (typeof findUnitById === 'function' && identityHudState.targetId) ? findUnitById(identityHudState.targetId) : null;
    const pending = unit ? idtPendingActiveBonus[unit.id] : null;
    const nextTurn = unit ? idtNextTurnActiveBonus[unit.id] : null;

    let rows = '';
    for (const { id, unlocked } of owned) {
        const card = (typeof getIdentityById === 'function') ? getIdentityById(id) : null;
        if (!card || !card.hooks || !Array.isArray(card.hooks.onActive) || !card.hooks.onActive.length) continue;
        const items = card.hooks.onActive.map((h, i) => {
            if (!h) return '';
            const lockedOut = !!h.locked && !unlocked;
            const tag = lockedOut ? '<span class="idt-active-locked-tag">未解鎖</span>' : '';

            let btn = '';
            if (idtIsDeclarable(h) && !lockedOut) {
                const eff = h.effect;
                // 成本試算與宣告時走同一個 idtPlanDeclareCost，按鈕顯示的數字必定等於實際會扣的數字
                const plan = unit ? idtPlanDeclareCost(eff, unit, targetUnit)
                                  : { affordable: false, blockers: ['尚未指定我方單位'], costParts: [] };
                const limit = unit ? idtCheckUseLimit(unit.id, id, i, eff.once) : { ok: true, reason: '' };
                const affordable = plan.affordable && limit.ok;
                const why = !limit.ok ? limit.reason : (plan.blockers[0] || '');

                const costTxt = plan.costParts.length
                    ? `<span class="idt-active-cost">消耗：${esc(plan.costParts.join('、'))}</span>` : '';
                const onceTxt = eff.once
                    ? `<span class="idt-active-once">${eff.once === 'battle' ? '每場一次' : '每回合一次'}</span>` : '';
                const needConfirm = idtDeclareHasCost(plan);
                btn = `${costTxt}${onceTxt}<button class="idt-btn idt-active-declare" ${affordable ? '' : 'disabled'}
                            onclick="idtDeclareActiveSkill('${id}',${i})"
                            title="${affordable ? (needConfirm ? '扣除成本並宣告（會先跳出確認）' : '宣告並套用效果') : esc(why)}">宣告</button>`;
            }
            return `<div class="idt-active-item${lockedOut ? ' idt-active-locked' : ''}">
                        <span class="idt-active-name">${esc(h.name || h.source || '')}${tag}</span>
                        <span class="idt-active-desc">${esc(h.desc || '')}</span>
                        ${btn}
                    </div>`;
        }).join('');
        rows += `<div class="idt-mi-card"><div class="idt-mi-card-name">${esc(card.name)}</div>${items}</div>`;
    }
    if (!rows) return '';

    const banner = (label, p, showClear) => (p && (p.dp || p.extraSuccess || p.damage))
        ? `<div class="idt-active-pending">${label}：${idtBonusText(p)}（${esc(p.notes.join('、'))}）
            ${showClear && unit ? `<button class="idt-btn idt-active-clear" onclick="idtClearPendingActiveBonus('${unit.id}');renderIdentityModal();" title="取消已宣告的加值">清除</button>` : ''}</div>`
        : '';

    return `
        <div class="idt-section">
            <div class="idt-section-title">②‧6 主動宣告技（宣告扣成本、加值自動併入下次攻擊）</div>
            <div class="idt-mi-hint-top">帶成本的技能按「宣告」會先跳出二次確認，確認後才扣除資源（自身層數／全隊資源池／目標身上的層數／自傷）並套用效果；數值加值會自動併入你下一次發起的攻擊。純敘述型技能仍由描述判定。</div>
            ${banner('🎯 已宣告待併入下次攻擊', pending, true)}
            ${banner('⏭ 下一回合開始才生效', nextTurn, false)}
            ${rows}
        </div>`;
}

/**
 * 渲染「全隊共用資源池」區：僅在持有帶 teamPools 標記的卡片時顯示（目前為拉·曼卻領公主的【血宴】）。
 *
 * 之所以獨立成一區、而不塞進單位的狀態列：血宴是全場共用的一個數字，任何單位受到流血傷害都會累積、
 * 任何持有該卡的玩家都能消耗，掛在誰身上都會誤導。實際數值存於 state.teamPools 並即時同步全房間。
 * @returns {string} HTML
 */
function renderIdentityTeamPoolSection() {
    if (typeof IDENTITY_TEAM_POOLS === 'undefined') return '';
    const owned = collectOwnedIdentities();
    const keys = new Set();
    for (const { id } of owned) {
        const card = (typeof getIdentityById === 'function') ? getIdentityById(id) : null;
        if (card && Array.isArray(card.teamPools)) card.teamPools.forEach(k => keys.add(k));
    }
    if (!keys.size) return '';

    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);
    const pools = idtGetTeamPools();
    const rows = [...keys].map(key => {
        const def = IDENTITY_TEAM_POOLS[key];
        if (!def) return '';
        const cur = pools[key] || 0;
        const spent = pools[key + 'Spent'] || 0;
        const pct = def.max ? Math.min(100, Math.round((cur / def.max) * 100)) : 0;
        const steps = [-10, -4, -2, -1, 1, 2, 5, 10];
        const btns = steps.map(d => `<button class="idt-btn idt-pool-btn" onclick="idtAdjustTeamPool('${key}',${d})"
                        title="${d > 0 ? '增加' : '消耗'} ${Math.abs(d)} 點${esc(def.name)}">${d > 0 ? '+' : ''}${d}</button>`).join('');
        return `<div class="idt-pool-row">
                    <div class="idt-pool-head">
                        <span class="idt-pool-name">${def.icon || '🎴'} ${esc(def.name)}</span>
                        <span class="idt-pool-val">${cur} / ${def.max}${def.trackSpent ? `　（本場累計消耗 ${spent}）` : ''}</span>
                    </div>
                    <div class="idt-pool-bar"><div class="idt-pool-fill" style="width:${pct}%"></div></div>
                    <div class="idt-pool-btns">${btns}</div>
                    <div class="idt-hint">${esc(def.desc || '')}</div>
                </div>`;
    }).join('');

    return `
        <div class="idt-section">
            <div class="idt-section-title">②‧5 全隊共用資源池（全房間即時同步）</div>
            <div class="idt-mi-hint-top">這些資源不屬於任何單位，任何人增減都會同步給整場戰鬥；流血傷害的自動累積由 ST 的「回合結束結算」面板套用。</div>
            ${rows}
        </div>`;
}

// 上次重繪時面板上顯示的資源池內容（JSON 快照）。
// state 監聽器每次同步都會呼叫 renderIdentityTeamPools，但多數同步（回合推進、單位移動…）
// 與資源池無關；只有數值真的變了才重繪，避免面板每次同步都整個重建。
let _idtLastPoolsJson = null;

/** 資源池數值變動後才重繪面板（供 Firebase 監聽器在別人增減時呼叫）。 */
function renderIdentityTeamPools() {
    const json = JSON.stringify(idtGetTeamPools());
    if (json === _idtLastPoolsJson) return;
    _idtLastPoolsJson = json;
    const el = document.getElementById('identity-modal');
    if (el && el.style.display === 'block' && el.innerHTML) renderIdentityModal();
}

// ===== 被攻擊反應（onDefend）=====
// 有些人格卡的效果在「你被攻擊時」觸發（公主的綻放荊棘近戰反傷、N公司中錘的狂信反擊流血）。
// 網站的防禦流程只知道「有人要打你」，不知道是近戰還是遠程，故由玩家按下對應按鈕宣告，
// 系統再把反應效果套用到攻擊者與自己身上。攻擊者預設取「最近一次對你發動攻擊的單位」。

/** 最近一次對本玩家單位發動攻擊的單位 id（由 cqOnPendingDefense 記錄）。 */
let idtLastAttackerUnitId = null;

/**
 * 記錄「現在是誰在打我」，供被攻擊反應套用反傷對象。
 * @param {string} unitId
 */
function idtNoteIncomingAttacker(unitId) {
    if (unitId) idtLastAttackerUnitId = unitId;
}

/**
 * 玩家宣告「我被（近戰／遠程）攻擊了」：跑 onDefend 結算並套用效果。
 * @param {boolean} melee - 是否為近戰攻擊（綻放荊棘的反傷僅對近戰生效）
 * @returns {number} 實際套用的效果數
 */
function idtDeclareDefendReaction(melee) {
    if (typeof evaluatePlayerDefend !== 'function') return 0;
    const unitId = identityHudState.attackerId;
    const unit = (typeof findUnitById === 'function' && unitId) ? findUnitById(unitId) : null;
    if (!unit) { if (typeof showToast === 'function') showToast('請先指定我方單位'); return 0; }

    const foeId = idtLastAttackerUnitId || identityHudState.targetId;
    const foeUnit = (typeof findUnitById === 'function' && foeId) ? findUnitById(foeId) : null;

    const owned = collectOwnedIdentities();
    const res = evaluatePlayerDefend(owned, buildEngineUnitState(unit), buildEngineUnitState(foeUnit), { melee: !!melee });

    const notes = [];
    let n = 0;
    // 反傷等施加給攻擊者的效果：沒有明確的攻擊者就不亂套，改提示玩家先選目標
    if (Object.keys(res.attackerStatus || {}).length) {
        if (foeUnit) {
            n += applyEngineStatusDeltasToUnit(foeUnit.id, res.attackerStatus);
            notes.push(`對「${foeUnit.name || '攻擊者'}」：` + idtStatusMapNote(res.attackerStatus));
        } else {
            notes.push('⚠ 未偵測到攻擊者，未套用：' + idtStatusMapNote(res.attackerStatus));
        }
    }
    // 自身效果（綻放荊棘 -1 這類負值）走 delta 版本，歸零時會正確移除狀態
    if (Object.keys(res.selfStatus || {}).length) {
        n += applyEngineStatusDeltasToUnit(unitId, res.selfStatus);
        notes.push('對自己：' + idtStatusMapNote(res.selfStatus));
    }
    if (res.poolDelta && Object.keys(res.poolDelta).length) applyEnginePoolDelta(res.poolDelta);

    if (typeof showToast === 'function') {
        showToast(notes.length
            ? `🛡 已結算${melee ? '近戰' : '遠程'}被攻擊反應：${notes.join('；')}`
            : `🛡 本組人格卡沒有${melee ? '近戰' : '遠程'}被攻擊反應`);
    }
    renderIdentityModal();
    return n;
}

/** 把狀態增減物件轉成「中文名+層數」的說明字串（負值顯示為 -N）。 */
function idtStatusMapNote(map) {
    return Object.entries(map || {})
        .map(([k, v]) => `${identityStatusName(k)}${(parseInt(v) || 0) >= 0 ? '+' : ''}${parseInt(v) || 0}`)
        .join('、');
}

/**
 * 渲染「被攻擊反應」區：僅在持有帶 onDefend hook 的卡片時顯示。
 * @returns {string} HTML
 */
function renderIdentityDefendReactions() {
    const owned = collectOwnedIdentities();
    const items = [];
    for (const { id, unlocked } of owned) {
        const card = (typeof getIdentityById === 'function') ? getIdentityById(id) : null;
        if (!card || !card.hooks || !Array.isArray(card.hooks.onDefend)) continue;
        for (const h of card.hooks.onDefend) {
            if (!h) continue;
            if (h.locked && !unlocked) continue;
            items.push({ card: card.name, source: h.source || h.skill || '', desc: h.desc || '' });
        }
    }
    if (!items.length) return '';

    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);
    const foe = (typeof findUnitById === 'function' && idtLastAttackerUnitId) ? findUnitById(idtLastAttackerUnitId) : null;
    const foeTxt = foe ? `目前偵測到的攻擊者：${esc(foe.name || '敵方單位')}` : '尚未偵測到攻擊者（將退回使用②的目標）';
    const rows = items.map(it => `<div class="idt-active-item">
                    <span class="idt-active-name">${esc(it.card)}</span>
                    <span class="idt-active-desc">${esc(it.source)}${it.desc ? '：' + esc(it.desc) : ''}</span>
                </div>`).join('');

    return `
        <div class="idt-section">
            <div class="idt-section-title">②‧7 被攻擊反應（你被打時觸發）</div>
            <div class="idt-mi-hint-top">系統無從得知這次是近戰還是遠程攻擊，請在被攻擊時按下對應按鈕結算反應效果。${esc(foeTxt)}</div>
            <div class="idt-action-btns">
                <button class="idt-btn idt-action-btn" onclick="idtDeclareDefendReaction(true)"
                        title="宣告本次受到近戰攻擊，結算人格卡的被攻擊反應">🗡 被近戰攻擊</button>
                <button class="idt-btn idt-action-btn" onclick="idtDeclareDefendReaction(false)"
                        title="宣告本次受到遠程攻擊，結算人格卡的被攻擊反應">🏹 被遠程攻擊</button>
            </div>
            ${rows}
        </div>`;
}

function renderIdentityResult() {
    const r = identityHudState.lastResult;
    if (!r) return '<div class="idt-result-empty">請先在 ① 勾選至少一張持有的人格卡，結果會自動算出</div>';

    const bonusRows = [
        ['DP 加值', r.totalDpBonus],
        ['武器傷害', r.totalWeaponDamage],
        ['附加成功', r.totalExtraSuccess],
        ['法術威力', r.totalSpellPower],
        ['最終傷害', r.totalFinalDamage],
        ['一次性護盾', r.totals && r.totals.selfShield],
        // 這兩項不是加值而是攻擊視窗的欄位值，開啟攻擊視窗時會自動預填
        ['嚴重轉惡性（自動預填）', r.totals && r.totals.critVicious],
        ['加骰下推級數（自動預填）', r.totals && r.totals.explodeStep]
    ].filter(([, v]) => (v || 0) !== 0)
     .map(([k, v]) => `<div class="idt-bonus"><span>${k}</span><b>+${v}</b></div>`).join('');

    const fmtStatus = (m) => Object.entries(m || {})
        .map(([k, v]) => {
            const name = identityStatusName(k);
            if (typeof v !== 'number') return `${name}（${v}）`;
            return `${name} ${v >= 0 ? '+' : ''}${v}`;
        }).join('、');

    const autoLogs = r.triggerLogs.filter(l => !l.manual);
    const manualLogs = r.triggerLogs.filter(l => l.manual);

    const logRow = (l) => {
        const parts = [];
        if (l.dpBonus) parts.push(`DP+${l.dpBonus}`);
        if (l.weaponDamage) parts.push(`武器+${l.weaponDamage}`);
        if (l.extraSuccess) parts.push(`附加成功+${l.extraSuccess}`);
        if (l.spellPower) parts.push(`威力+${l.spellPower}`);
        if (l.finalDamage) parts.push(`最終傷害+${l.finalDamage}`);
        if (l.selfShield) parts.push(`護盾+${l.selfShield}`);
        if (l.critVicious) parts.push(`嚴重轉惡性+${l.critVicious}`);
        if (l.explodeStep) parts.push(`加骰下推${l.explodeStep}級`);
        if (l.targetStatus) parts.push('→敵：' + fmtStatus(resolveLogStatus(l.targetStatus, r)));
        if (l.selfStatus) parts.push('→己：' + fmtStatus(resolveLogStatus(l.selfStatus, r)));
        const src = (typeof escapeHtml === 'function') ? escapeHtml(l.source || '') : (l.source || '');
        const phase = l.phase === 'attack' ? '攻擊' : (l.phase === 'hit' ? '命中' : l.phase);
        return `<div class="idt-log"><span class="idt-log-src">[${phase}] ${src}</span><span class="idt-log-eff">${parts.join('，')}</span></div>`;
    };

    // 分階段唯讀預覽：狀態套用已全自動化（宣告時／命中時各走自己的結算路徑），手動套用按鈕已移除
    const atkTgt = fmtStatus(r.onAttackTargetStatus);
    const atkSelf = fmtStatus(r.onAttackSelfStatus);
    const hitTgt = fmtStatus(r.onHitTargetStatus);
    const hitSelf = fmtStatus(r.onHitSelfStatus);
    const line = (icon, label, txt) =>
        `<div class="idt-phase-line">${icon} ${label}：${txt ? `<b>${txt}</b>` : '<span class="idt-phase-none">無</span>'}</div>`;

    let html = '<div class="idt-auto-banner">⚙️ 全自動套用：發起攻擊 → 立即套用「攻擊宣告時」欄位；ST 判定命中 → 自動套用「命中時」欄位（含自身增益）。無需手動操作。</div>';
    if (bonusRows) html += `<div class="idt-bonus-row">${bonusRows}</div>`;
    html += `
        <div class="idt-phase-grid">
            <div class="idt-phase-card idt-phase-attack">
                <div class="idt-phase-title">🗡 攻擊宣告時<span class="idt-phase-when">發起攻擊即套用</span></div>
                ${line('🎯', '對目標', atkTgt)}
                ${line('🔵', '對自身', atkSelf)}
            </div>
            <div class="idt-phase-card idt-phase-hit">
                <div class="idt-phase-title">💥 命中時<span class="idt-phase-when">命中判定後自動套用</span></div>
                ${line('🎯', '對目標', hitTgt)}
                ${line('💠', '自身增益', hitSelf)}
            </div>
        </div>`;

    // 結算後（依實際傷害分歧）：ST 端會依實際打出的傷害查表擇一套用
    if (Array.isArray(r.resolvePreview) && r.resolvePreview.length) {
        const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);
        html += '<div class="idt-log-title">🎲 結算後（ST 依實際傷害擇一自動套用）</div>';
        html += r.resolvePreview.map(row =>
            `<div class="idt-log"><span class="idt-log-src">${esc(row.label)}</span><span class="idt-log-eff">${
                [row.targetTxt ? '→敵：' + esc(row.targetTxt) : '', row.selfTxt ? '→己：' + esc(row.selfTxt) : '']
                    .filter(Boolean).join('，')}</span></div>`).join('');
    }
    // 被攻擊時：需玩家於「被攻擊反應」區宣告近戰／遠程後才結算
    if (Array.isArray(r.defendPreview) && r.defendPreview.length) {
        const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);
        html += '<div class="idt-log-title">🛡 被攻擊時（需於「被攻擊反應」區宣告）</div>';
        html += r.defendPreview.map(row =>
            `<div class="idt-log"><span class="idt-log-src">${esc(row.label)}</span><span class="idt-log-eff">${
                [row.foeTxt ? '→攻擊者：' + esc(row.foeTxt) : '', row.selfTxt ? '→己：' + esc(row.selfTxt) : '']
                    .filter(Boolean).join('，')}</span></div>`).join('');
    }
    if (autoLogs.length) {
        html += '<div class="idt-log-title">觸發明細</div>' + autoLogs.map(logRow).join('');
    }
    // 未觸發的加值：讓玩家一眼看出「加值存在但這次沒觸發」與原因，
    // 而不是加值直接從結果消失（過去常被誤判為 DP 加值顯示錯誤）
    if (Array.isArray(r.untriggered) && r.untriggered.length) {
        const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);
        html += '<div class="idt-log-title idt-untrig-title">⏸ 未觸發的加值（本次不計入）</div>';
        if (r.noTarget) {
            html += '<div class="idt-remind idt-remind-note">尚未在 ② 指定目標單位：所有依「目標狀態門檻」的加值都無法觸發。指定目標後會依其實際狀態即時重算。</div>';
        }
        html += r.untriggered.map(u => {
            const phase = u.phase === 'attack' ? '攻擊' : (u.phase === 'hit' ? '命中' : u.phase);
            return `<div class="idt-log idt-untrig"><span class="idt-log-src">[${phase}] ${esc(u.source)}</span><span class="idt-log-eff">${esc(u.bonusTxt)}｜${esc(u.reason)}</span></div>`;
        }).join('');
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

    // 重繪前記住內容區捲動位置，重繪後還原，避免每次輸入/勾選都跳回頂端
    const oldBody = el.querySelector('.idt-body');
    const currentScroll = oldBody ? oldBody.scrollTop : 0;

    // 我方（攻擊者）恆鎖定為玩家自己控制的單位，每次渲染都重新同步（無下拉可手動更改）
    if (typeof myPlayerId !== 'undefined' && myPlayerId && typeof state !== 'undefined' && Array.isArray(state.units)) {
        const mine = state.units.find(u => u.ownerId === myPlayerId);
        if (mine) identityHudState.attackerId = mine.id;
    }
    // 全自動：每次渲染前先重算，結果面板永遠反映目前的卡片／目標選擇，不需手動按鈕
    computeIdentityResult();

    const owners = (typeof getIdentityOwners === 'function') ? getIdentityOwners() : [];
    const ownerOpts = owners.map(o => {
        const sel = o === identityHudState.owner ? ' selected' : '';
        const safe = (typeof escapeHtml === 'function') ? escapeHtml(o) : o;
        return `<option value="${safe}"${sel}>${safe}</option>`;
    }).join('');

    el.innerHTML = `
        <div class="identity-modal-box">
            <div class="idt-header" id="identity-float-header">
                <span>🃏 人格卡引擎</span>
                <div class="idt-header-actions">
                    <button class="idt-add-btn" title="新增自訂人格卡" onclick="openAddIdentityForm()">＋</button>
                    <button class="idt-close" id="identity-float-collapse" title="收起">▾</button>
                    <button class="idt-close" onclick="closeIdentityModal()">×</button>
                </div>
            </div>
            <div class="idt-body">
                <div class="idt-section">
                    <div class="idt-section-title">① 選擇角色與持有的人格卡</div>
                    <select class="idt-select" onchange="selectIdentityOwner(this.value)">${ownerOpts}</select>
                    <input class="idt-input idt-card-filter" type="text" placeholder="🔍 篩選人格卡（名稱／技能／關鍵狀態）"
                           value="${(typeof escapeHtml === 'function') ? escapeHtml(identityHudState.cardFilter || '') : ''}"
                           oninput="idtSetCardFilter(this.value)">
                    <div class="idt-card-list">${renderIdentityCardList()}</div>
                </div>

                <div class="idt-section">
                    <div class="idt-section-title">② 指定單位（全自動，結果即時更新）</div>
                    <div class="idt-field"><label>我方（攻擊者，恆為你自己的單位）</label>
                        <div class="idt-self-unit">${(typeof escapeHtml === 'function') ? escapeHtml(idtSelfUnitLabel()) : idtSelfUnitLabel()}</div>
                    </div>
                    <div class="idt-field"><label>目標（敵方，自動偵測你上次發起攻擊的對象，也可手動改選）</label>
                        <select class="idt-select" onchange="updateIdentityField('targetId', this.value)">${renderIdentityUnitOptions(identityHudState.targetId)}</select>
                    </div>
                    <div class="idt-action-row">
                        <button class="idt-btn" onclick="runIdentityTurnStart()" title="套用回合開始的資源獲取（呼吸法／充能／人民之盾等）">🔄 回合開始資源</button>
                    </div>
                </div>

                ${renderIdentityActionUsed()}

                ${renderIdentityTeamPoolSection()}

                ${renderIdentityManualInputs()}

                ${renderIdentityActiveSkills()}

                ${renderIdentityDefendReactions()}

                <div class="idt-section">
                    <div class="idt-section-title">③ 結算結果</div>
                    <div class="idt-result">${renderIdentityResult()}</div>
                </div>
            </div>
        </div>`;
    idtMountFloatPanel();

    const newBody = el.querySelector('.idt-body');
    if (newBody) newBody.scrollTop = currentScroll;
}

// ===== 樣式（一次性注入，沿用網站 CSS 變數） =====
function injectIdentityStyles() {
    if (document.getElementById('identity-hud-styles')) return;
    const s = document.createElement('style');
    s.id = 'identity-hud-styles';
    s.textContent = `
        /* 浮動面板：不再是全螢幕遮罩，可拖曳/收起/拖到右緣收納，戰鬥中可與其他視窗並用 */
        .identity-modal-overlay{position:fixed;left:60px;top:60px;z-index:9400;display:none;width:min(560px,94vw);}
        .identity-modal-box{background:var(--bg-panel,#1b1b22);border:1px solid var(--border,#33333a);border-radius:12px;width:100%;max-height:82vh;display:flex;flex-direction:column;color:var(--text,#eee);box-shadow:0 10px 40px rgba(0,0,0,.5);}
        .identity-modal-overlay.collapsed .idt-body{display:none;}
        .idt-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border,#33333a);font-weight:bold;font-size:1.05rem;cursor:move;user-select:none;}
        .idt-close{background:none;border:none;color:var(--text-dim,#999);font-size:1.5rem;cursor:pointer;line-height:1;}
        .idt-body{padding:12px 16px;overflow-y:auto;}
        .idt-section{margin-bottom:14px;}
        .idt-section-title{font-size:.9rem;color:var(--accent-purple,#9b59b6);margin-bottom:8px;font-weight:bold;}
        .idt-select,.idt-input{width:100%;background:var(--bg-input,#111);border:1px solid var(--border,#33333a);color:var(--text,#eee);border-radius:6px;padding:7px 8px;font-size:.9rem;}
        .idt-self-unit{width:100%;background:var(--bg-input,#111);border:1px solid var(--border,#33333a);color:var(--text,#eee);border-radius:6px;padding:7px 8px;font-size:.9rem;box-sizing:border-box;}
        .idt-card-filter{margin-top:8px;}
        .idt-card-list{margin-top:8px;display:flex;flex-direction:column;gap:6px;}
        .idt-key-chips{display:flex;flex-wrap:wrap;gap:4px;padding-left:24px;}
        .idt-key-chip{font-size:.68rem;color:var(--text-dim,#aaa);background:var(--bg-panel,#22222a);border:1px solid var(--border,#33333a);border-radius:8px;padding:1px 7px;white-space:nowrap;}
        .idt-card{border:1px solid var(--border,#33333a);border-radius:8px;padding:8px 10px;background:var(--bg-input,#15151b);display:flex;flex-direction:column;gap:4px;opacity:.6;}
        .idt-card.idt-owned{opacity:1;border-color:var(--accent-purple,#7e57c2);}
        .idt-own{display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:bold;}
        .idt-card-name{font-size:.92rem;}
        .idt-unlock{display:flex;align-items:center;gap:6px;font-size:.82rem;color:var(--accent-orange,#e67e22);cursor:pointer;padding-left:24px;}
        .idt-unlock.idt-disabled{opacity:.4;cursor:not-allowed;}
        .idt-no-unlock{font-size:.78rem;color:var(--text-dim,#777);padding-left:24px;}
        .idt-field{margin-bottom:8px;}
        .idt-field label{display:block;font-size:.8rem;color:var(--text-dim,#aaa);margin-bottom:3px;}
        .idt-action-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}
        .idt-btn{flex:1;min-width:120px;background:var(--bg-input,#222);border:1px solid var(--border,#33333a);color:var(--text,#eee);border-radius:6px;padding:8px;cursor:pointer;font-size:.85rem;}
        .idt-btn-main{background:var(--accent-purple,#7e57c2);border-color:var(--accent-purple,#7e57c2);font-weight:bold;}
        .idt-btn-mini{flex:1;min-width:0;font-size:.78rem;padding:6px 4px;}
        /* 動作消耗（迅捷／移動／標準）：已消耗的動作變灰且不可再按 */
        .idt-action-btns{display:flex;gap:6px;flex-wrap:wrap;}
        /* 全隊共用資源池（血宴）：進度條 + 快速增減按鈕 */
        .idt-pool-row{background:var(--bg-input,#15151b);border:1px solid var(--border,#33333a);border-radius:8px;padding:8px 10px;margin-bottom:8px;}
        .idt-pool-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px;}
        .idt-pool-name{font-weight:bold;font-size:.9rem;}
        .idt-pool-val{font-size:.8rem;color:var(--text-dim,#888);}
        .idt-pool-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;margin-bottom:6px;}
        .idt-pool-fill{height:100%;background:linear-gradient(90deg,#8e2b3f,#d64a63);transition:width .2s;}
        .idt-pool-btns{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px;}
        .idt-pool-btn{padding:2px 8px;font-size:.78rem;min-width:34px;}
        /* 宣告技的「每場/每回合一次」標籤 */
        .idt-active-once{font-size:.7rem;color:var(--accent-orange,#e6a23c);border:1px solid currentColor;border-radius:4px;padding:0 4px;margin-right:6px;white-space:nowrap;}
        .idt-action-btn{flex:1;min-width:104px;font-size:.8rem;padding:7px 4px;}
        .idt-action-btn.is-used{opacity:.42;cursor:not-allowed;border-style:dashed;}
        .idt-hint{font-size:.72rem;color:var(--text-dim,#999);margin-top:6px;line-height:1.5;}
        .idt-result{background:var(--bg-input,#111);border:1px solid var(--border,#33333a);border-radius:8px;padding:10px;min-height:48px;}
        .idt-result-empty{color:var(--text-dim,#777);font-size:.85rem;text-align:center;padding:10px;}
        .idt-bonus-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;}
        .idt-bonus{background:var(--bg-panel,#22222a);border:1px solid var(--border,#33333a);border-radius:6px;padding:6px 10px;font-size:.85rem;}
        .idt-bonus b{color:var(--accent-green,#27ae60);margin-left:6px;}
        .idt-statline{font-size:.85rem;margin:4px 0;}
        .idt-statline b{color:var(--accent-orange,#e67e22);}
        /* 分階段自動套用預覽（攻擊宣告時／命中時） */
        .idt-auto-banner{font-size:.76rem;color:var(--accent-green,#8bd17c);background:rgba(39,174,96,.09);border-left:3px solid var(--accent-green,#27ae60);border-radius:4px;padding:6px 8px;margin-bottom:8px;line-height:1.5;}
        .idt-phase-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin:8px 0;}
        .idt-phase-card{border:1px solid var(--border,#33333a);border-radius:8px;padding:8px 10px;}
        .idt-phase-attack{border-color:var(--accent-purple,#7e57c2);background:rgba(126,87,194,.07);}
        .idt-phase-hit{border-color:var(--accent-orange,#e67e22);background:rgba(230,126,34,.07);}
        .idt-phase-title{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:.84rem;font-weight:bold;margin-bottom:6px;}
        .idt-phase-attack .idt-phase-title{color:var(--accent-purple,#9b59b6);}
        .idt-phase-hit .idt-phase-title{color:var(--accent-orange,#e67e22);}
        .idt-phase-when{font-size:.64rem;font-weight:normal;color:var(--text-dim,#999);background:var(--bg-input,#15151b);border:1px solid var(--border,#33333a);border-radius:6px;padding:1px 6px;white-space:nowrap;}
        .idt-phase-line{font-size:.8rem;margin:3px 0;line-height:1.5;}
        .idt-phase-line b{color:var(--text,#eee);}
        .idt-phase-none{color:var(--text-dim,#777);}
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
        .idt-active-item{display:flex;flex-direction:column;gap:2px;padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.06);}
        .idt-active-item:last-child{border-bottom:none;}
        .idt-active-name{font-size:.82rem;font-weight:bold;color:var(--accent-orange,#e67e22);}
        .idt-active-desc{font-size:.76rem;color:var(--text-dim,#aaa);line-height:1.5;}
        .idt-active-locked{opacity:.5;}
        .idt-active-locked-tag{font-size:.66rem;background:var(--bg-input,#222);border:1px solid var(--border,#33333a);color:var(--text-dim,#999);border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:middle;}
        .idt-active-cost{font-size:.7rem;color:var(--accent-blue,#4aa3ff);margin-right:8px;}
        .idt-active-declare{background:var(--accent-orange,#e67e22);border:none;color:#fff;border-radius:5px;padding:3px 12px;font-size:.76rem;cursor:pointer;align-self:flex-start;margin-top:2px;}
        .idt-active-declare:hover:not([disabled]){filter:brightness(1.12);}
        .idt-active-declare[disabled]{opacity:.45;cursor:not-allowed;}
        .idt-active-pending{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.78rem;color:var(--accent-green,#8bd17c);background:rgba(39,174,96,.1);border:1px solid var(--accent-green,#27ae60);border-radius:6px;padding:5px 8px;margin-bottom:8px;}
        .idt-active-clear{background:none;border:1px solid var(--border,#33333a);color:var(--text-dim,#aaa);border-radius:5px;padding:2px 8px;font-size:.72rem;cursor:pointer;}
        .idt-remind-title{color:var(--accent-blue,#4aa3ff);}
        .idt-untrig-title{color:var(--text-dim,#999);}
        .idt-log.idt-untrig{opacity:.62;}
        .idt-log.idt-untrig .idt-log-eff{color:var(--text-dim,#999);}
        .idt-remind{font-size:.82rem;color:var(--text,#eee);background:rgba(74,163,255,.08);border-left:3px solid var(--accent-blue,#4aa3ff);border-radius:4px;padding:6px 8px;margin:4px 0;line-height:1.5;}
        .idt-remind-note{border-left-color:var(--accent-purple,#7e57c2);background:rgba(126,87,194,.08);color:var(--text-dim,#bbb);font-size:.78rem;}
        .idt-forge-area{width:100%;resize:vertical;line-height:1.5;margin-bottom:8px;}
        #ai-identity-preview{font-size:.8rem;color:var(--accent-green,#8bd17c);}
        #btn-generate-identity[disabled]{opacity:.6;cursor:progress;}
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
    window.runIdentityTurnStart = runIdentityTurnStart;
    window.autoTriggerIdentityTurnStart = autoTriggerIdentityTurnStart;
    window.renderIdentityModal = renderIdentityModal;
    // 動作消耗（指令加護等「消耗動作換資源」的規則）
    window.idtUseAction = idtUseAction;
    // 主動宣告技
    window.idtDeclareActiveSkill = idtDeclareActiveSkill;
    window.idtConsumePendingActiveBonus = idtConsumePendingActiveBonus;
    window.idtClearPendingActiveBonus = idtClearPendingActiveBonus;
    // 自訂人格卡（AI 人格鍛造爐）
    window.openAddIdentityForm = openAddIdentityForm;
    window.cancelAddIdentity = cancelAddIdentity;
    window.setAISetting = setAISetting;
    window.generateIdentityFromAI = generateIdentityFromAI;
    window.saveAIIdentity = saveAIIdentity;
    window.deleteCustomIdentity = deleteCustomIdentity;
    window.setCardInput = setCardInput;
    // 啟動時把使用者儲存的自訂人格卡注入資料庫，並還原上次的選擇。
    // ⚠️ 時序關鍵：IDENTITY_LIBRARY 來自 ES Module（identity-config 已模組化，延遲執行），
    // 本檔為傳統 script，載入當下 IDENTITY_LIBRARY 必定尚未定義；若立刻註冊，
    // registerCustomIdentity 會因 typeof 檢查而「靜默丟棄所有自訂人格卡」——
    // 表現為：玩家選了（自訂）人格後發起攻擊不套用、DP 加值消失、角色從清單消失。
    // 模組保證在 DOMContentLoaded 前執行完畢，故延後到該時點再註冊。
    const idtBootstrap = () => {
        registerAllCustomIdentities();
        loadIdentityState();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', idtBootstrap);
    } else {
        idtBootstrap();
    }
    // 注入樣式（DOM 已就緒時立即注入，否則待載入）
    if (document.head) injectIdentityStyles();
    else document.addEventListener('DOMContentLoaded', injectIdentityStyles);
}

console.log('🃏 人格卡引擎 UI 已載入');

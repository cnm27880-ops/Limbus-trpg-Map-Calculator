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
    if (typeof IDENTITY_LIBRARY === 'undefined' || !raw || !raw.id) return;

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
            <div class="idt-header">
                <span>🤖 AI 人格鍛造爐</span>
                <button class="idt-close" onclick="cancelAddIdentity()">×</button>
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

// ===== 套用（含二次確認防誤觸） =====

/**
 * 套用目標/自身狀態按鈕的二次確認：第一次點擊只將按鈕文字改為「確認套用？」並武裝（armed），
 * 第二次點擊（仍處於武裝狀態）才真正執行 actionFnName；點擊其他地方使按鈕失焦（onblur）會還原。
 * @param {HTMLElement} btn
 * @param {string} actionFnName - 要執行的函式名稱（如 'applyIdentityTargetStatus'）
 */
function idtConfirmClick(btn, actionFnName) {
    if (!btn) return;
    if (btn.dataset.armed === '1') {
        idtResetConfirmBtn(btn);
        if (typeof window[actionFnName] === 'function') window[actionFnName]();
        return;
    }
    btn.dataset.armed = '1';
    btn.textContent = '⚠️ 確認套用？';
}

/** 還原確認按鈕的武裝狀態與文字（失焦或執行後呼叫）。 */
function idtResetConfirmBtn(btn) {
    if (!btn) return;
    btn.dataset.armed = '0';
    btn.textContent = btn.dataset.label || btn.textContent;
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
        + '<button type="button" class="idt-btn idt-btn-mini" data-label="🎯 套用目標狀態" onclick="idtConfirmClick(this, \'applyIdentityTargetStatus\')" onblur="idtResetConfirmBtn(this)">🎯 套用目標狀態</button>'
        + '<button type="button" class="idt-btn idt-btn-mini" data-label="🔵 套用自身狀態" onclick="idtConfirmClick(this, \'applyIdentitySelfStatus\')" onblur="idtResetConfirmBtn(this)">🔵 套用自身狀態</button>'
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
    window.runIdentityCalc = runIdentityCalc;
    window.runIdentityTurnStart = runIdentityTurnStart;
    window.applyIdentityTargetStatus = applyIdentityTargetStatus;
    window.applyIdentitySelfStatus = applyIdentitySelfStatus;
    window.renderIdentityModal = renderIdentityModal;
    // 自訂人格卡（AI 人格鍛造爐）
    window.openAddIdentityForm = openAddIdentityForm;
    window.cancelAddIdentity = cancelAddIdentity;
    window.setAISetting = setAISetting;
    window.generateIdentityFromAI = generateIdentityFromAI;
    window.saveAIIdentity = saveAIIdentity;
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

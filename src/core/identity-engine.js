/**
 * Limbus Command - 人格卡疊加結算引擎（Identity Engine）
 *
 * 核心機制：玩家可同時持有多張人格卡，所有卡片符合條件的效果都會「疊加觸發」。
 * 本引擎只負責純運算，不碰任何 UI 或全域 state，方便單元測試與重複使用。
 *
 * 依賴：IDENTITY_LIBRARY / getIdentityById（src/config/identity-config.js）
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Hook 通用結構（onAttack / onHit 共用同一套處理邏輯，差別僅在語意時機）：
 *   {
 *     condition: (target, attacker) => boolean,   // 省略視為恆真
 *     // 以下數值欄位可為「數字」或「函式 (target, attacker) => number」（支援動態加值）
 *     dpBonus, weaponDamage, extraSuccess, spellPower, finalDamage,
 *     // 狀態欄位的「層數」同樣可為數字或函式 (target, attacker) => number
 *     targetStatus: { depression: 3, ... },
 *     selfStatus:   { swiftness: 1, ... },
 *     source, skill, locked, manual, desc
 *   }
 *
 * 特殊旗標：
 *   - locked: true  → 屬於「重複抽取解鎖」技能，僅在該卡 unlocked 時才計入。
 *   - manual: true  → 需玩家／ST 自行判定的效果（擲骰、友軍指定、複雜結算等）。
 *                     引擎「不」自動計入數值，但資料保留於 triggerLogs.manualEffects 供 UI 顯示。
 * ───────────────────────────────────────────────────────────────────────────
 */

// 引擎會自動累加的數值加值欄位
// selfShield：使自身獲得「單位護盾值」（一次性護盾，見 units.js 護盾系統），
//             與 shield（人民之盾狀態）不同——後者是狀態層數，前者是單位卡上的護盾點數。
const IDENTITY_BONUS_KEYS = ['dpBonus', 'weaponDamage', 'extraSuccess', 'spellPower', 'finalDamage', 'selfShield'];

/** 產生歸零的加值累積物件（兩個評估入口共用，避免未初始化鍵累加出 NaN） */
function makeZeroTotals() {
    const totals = {};
    for (const key of IDENTITY_BONUS_KEYS) totals[key] = 0;
    return totals;
}

/**
 * 將人格卡的輸入項正規化為 { id, unlocked } 結構。
 *
 * playerIdentities 的每一項可為：
 *   - 字串：'gregor_edgar'                          → 視為「重複抽取技尚未解鎖」
 *   - 物件：{ id: 'gregor_edgar', unlocked: true }  → 由玩家勾選決定是否納入重複抽取技
 *
 * 之所以支援物件，是為了滿足「三技能為重複抽取解鎖，需玩家勾選才納入計算」的需求；
 * 在未串接 UI 前，純字串輸入也能正常運作（預設不計入鎖定 hook）。
 *
 * @param {string|object} entry
 * @returns {{ id: string, unlocked: boolean }}
 */
function normalizeIdentityEntry(entry) {
    if (typeof entry === 'string') {
        return { id: entry, unlocked: false };
    }
    if (entry && typeof entry === 'object') {
        return { id: entry.id, unlocked: !!entry.unlocked };
    }
    return { id: null, unlocked: false };
}

/**
 * 判斷某個 hook 是否應納入計算。
 * 標記為 locked（重複抽取解鎖技）的 hook，只有在該卡 unlocked 為 true 時才生效。
 * @param {object} hook
 * @param {boolean} unlocked
 * @returns {boolean}
 */
function isHookActive(hook, unlocked) {
    if (!hook) return false;
    if (hook.locked) return unlocked;
    return true;
}

/**
 * 安全地確保狀態物件具備 status 欄位，避免條件函式存取 undefined.status 時拋錯。
 * @param {object} unitState
 * @returns {object}
 */
function ensureStatefulUnit(unitState) {
    const u = unitState || {};
    if (!u.status || typeof u.status !== 'object') u.status = {};
    return u;
}

/**
 * 解析「數字或函式」為實際數值。
 * @param {number|function} value
 * @param {object} target
 * @param {object} attacker
 * @returns {number}
 */
function resolveAmount(value, target, attacker) {
    try {
        const n = (typeof value === 'function') ? value(target, attacker) : value;
        return Number.isFinite(n) ? n : 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 將一組狀態點數累加進累積物件（疊加，非覆蓋）。層數可為數字或函式。
 * @param {object} accumulator - 累積結果（會被就地修改）
 * @param {object} statusMap - 例如 { depression: 3 } 或 { depression: (t,a)=>... }
 * @param {object} target
 * @param {object} attacker
 */
function accumulateStatus(accumulator, statusMap, target, attacker) {
    if (!statusMap || typeof statusMap !== 'object' || Array.isArray(statusMap)) return;
    for (const [key, value] of Object.entries(statusMap)) {
        const amount = resolveAmount(value, target, attacker);
        if (amount === 0) continue;
        accumulator[key] = (accumulator[key] || 0) + amount;
    }
}

/**
 * 安全評估 hook 條件。條件存取了不存在的欄位時，視為未觸發。
 * @param {object} hook
 * @param {object} target
 * @param {object} attacker
 * @returns {boolean}
 */
function evalCondition(hook, target, attacker) {
    if (!hook.condition) return true;
    try {
        return !!hook.condition(target, attacker);
    } catch (e) {
        return false;
    }
}

/**
 * 處理一組 hook（onAttack 或 onHit），把符合條件者的效果累加進 result。
 * @param {Array<object>} hooks
 * @param {string} phase - 'attack' | 'hit'
 * @param {object} card
 * @param {boolean} unlocked
 * @param {object} target
 * @param {object} attacker
 * @param {object} result
 */
function processHooks(hooks, phase, card, unlocked, target, attacker, result) {
    if (!Array.isArray(hooks)) return;

    for (const hook of hooks) {
        // 單一格式不完整的 hook 不應讓整體結算崩潰，逐項以 try/catch 隔離防呆
        try {
            if (!isHookActive(hook, unlocked)) continue;
            if (!evalCondition(hook, target, attacker)) continue;

            // manual 效果：不自動計入數值，但保留資料供 UI 顯示
            if (hook.manual) {
                result.triggerLogs.push({
                    identityId: card.id,
                    identityName: card.name,
                    phase,
                    source: hook.source || '',
                    skill: hook.skill || '',
                    manual: true,
                    desc: hook.desc || ''
                });
                continue;
            }

            const log = {
                identityId: card.id,
                identityName: card.name,
                phase,
                source: hook.source || '',
                skill: hook.skill || ''
            };

            // 累加數值加值
            for (const key of IDENTITY_BONUS_KEYS) {
                if (hook[key] === undefined) continue;
                const amount = resolveAmount(hook[key], target, attacker);
                if (amount === 0) continue;
                result.totals[key] += amount;
                log[key] = amount;
            }

            // 累加狀態
            if (hook.targetStatus) {
                if (phase === 'attack') accumulateStatus(result.onAttackTargetStatus, hook.targetStatus, target, attacker);
                else accumulateStatus(result.onHitTargetStatus, hook.targetStatus, target, attacker);
                log.targetStatus = hook.targetStatus;
            }
            if (hook.selfStatus) {
                if (phase === 'attack') accumulateStatus(result.onAttackSelfStatus, hook.selfStatus, target, attacker);
                else accumulateStatus(result.onHitSelfStatus, hook.selfStatus, target, attacker);
                log.selfStatus = hook.selfStatus;
            }

            result.triggerLogs.push(log);
        } catch (e) {
            // 格式異常的 hook 直接跳過，不影響其他人格卡的計算
        }
    }
}

/**
 * 評估玩家本次攻擊：遍歷玩家持有的所有人格卡，疊加所有符合條件的 hook 效果。
 *
 * @param {Array<string|object>} playerIdentities - 玩家持有的所有卡片（字串或 {id,unlocked}）
 * @param {object} attackerState - 攻擊者狀態，例如 { status: { breathing: 16 }, initiative: 18 }
 * @param {object} targetState   - 目標狀態，例如 { status: { depression: 8 } }
 * @returns {{
 *   totalDpBonus: number,
 *   totalWeaponDamage: number,
 *   totalExtraSuccess: number,
 *   totalSpellPower: number,
 *   totalFinalDamage: number,
 *   totals: object,
 *   triggerLogs: Array<object>,
 *   expectedTargetStatus: object,
 *   expectedSelfStatus: object
 * }}
 */
function evaluatePlayerAttack(playerIdentities, attackerState, targetState) {
    const attacker = ensureStatefulUnit(attackerState);
    const target = ensureStatefulUnit(targetState);

    const result = {
        totals: makeZeroTotals(),
        triggerLogs: [],
        onAttackTargetStatus: {},
        onAttackSelfStatus: {},
        onHitTargetStatus: {},
        onHitSelfStatus: {}
    };

    if (Array.isArray(playerIdentities)) {
        for (const rawEntry of playerIdentities) {
            const { id, unlocked } = normalizeIdentityEntry(rawEntry);
            const card = (typeof getIdentityById === 'function')
                ? getIdentityById(id)
                : (typeof IDENTITY_LIBRARY !== 'undefined' ? IDENTITY_LIBRARY[id] : null);

            if (!card || !card.hooks) continue;

            processHooks(card.hooks.onAttack, 'attack', card, unlocked, target, attacker, result);
            processHooks(card.hooks.onHit, 'hit', card, unlocked, target, attacker, result);
        }
    }

    // 便利別名（與舊版回傳格式相容）
    result.totalDpBonus = result.totals.dpBonus;
    result.totalWeaponDamage = result.totals.weaponDamage;
    result.totalExtraSuccess = result.totals.extraSuccess;
    result.totalSpellPower = result.totals.spellPower;
    result.totalFinalDamage = result.totals.finalDamage;

    // 合併狀態供 UI 使用（相容 expectedTargetStatus 與 expectedSelfStatus）
    result.expectedTargetStatus = mergeStatuses(result.onAttackTargetStatus, result.onHitTargetStatus);
    result.expectedSelfStatus = mergeStatuses(result.onAttackSelfStatus, result.onHitSelfStatus);

    return result;
}

/**
 * 評估「回合開始」時的資源獲取（呼吸法、人民之盾、充能…）。
 * 與攻擊結算分離，方便 UI 在玩家回合開始時呼叫。
 * onTurnStart hook 結構：{ condition?, selfStatus, source, skill, locked, manual, desc }
 *
 * @param {Array<string|object>} playerIdentities
 * @param {object} attackerState - 玩家自身狀態
 * @returns {{ expectedSelfStatus: object, triggerLogs: Array<object> }}
 */
function evaluatePlayerTurnStart(playerIdentities, attackerState) {
    const attacker = ensureStatefulUnit(attackerState);
    const result = { triggerLogs: [], totals: makeZeroTotals(), onAttackTargetStatus: {}, onAttackSelfStatus: {}, onHitTargetStatus: {}, onHitSelfStatus: {} };

    if (Array.isArray(playerIdentities)) {
        for (const rawEntry of playerIdentities) {
            const { id, unlocked } = normalizeIdentityEntry(rawEntry);
            const card = (typeof getIdentityById === 'function')
                ? getIdentityById(id)
                : (typeof IDENTITY_LIBRARY !== 'undefined' ? IDENTITY_LIBRARY[id] : null);
            if (!card || !card.hooks || !Array.isArray(card.hooks.onTurnStart)) continue;
            // 回合開始的對象只有自己，故 target 以 attacker 代入
            processHooks(card.hooks.onTurnStart, 'turnStart', card, unlocked, attacker, attacker, result);
        }
    }
    result.expectedSelfStatus = mergeStatuses(result.onAttackSelfStatus, result.onHitSelfStatus);
    result.expectedTargetStatus = mergeStatuses(result.onAttackTargetStatus, result.onHitTargetStatus);
    return { expectedSelfStatus: result.expectedSelfStatus, triggerLogs: result.triggerLogs, totals: result.totals };
}



/**
 * 合併多個狀態物件，用於相容 UI 需要的統一 expectedTargetStatus 與 expectedSelfStatus
 */
function mergeStatuses(...statusMaps) {
    const merged = {};
    for (const map of statusMaps) {
        if (!map) continue;
        for (const [key, value] of Object.entries(map)) {
            merged[key] = (merged[key] || 0) + (parseInt(value) || 0);
        }
    }
    return merged;
}

// ===== 瀏覽器全域匯出（與專案其他模組一致，使用全域函式） =====
// 同時相容 Node 環境（單元測試）：若有 module.exports 則一併匯出。
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeIdentityEntry,
        isHookActive,
        evaluatePlayerAttack,
        evaluatePlayerTurnStart
    };
}

console.log('⚙️ 人格卡疊加結算引擎已載入');

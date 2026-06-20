/**
 * Limbus Command - 人格卡疊加結算引擎（Identity Engine）
 *
 * 核心機制：玩家可同時持有多張人格卡，所有卡片符合條件的效果都會「疊加觸發」。
 * 本引擎只負責純運算，不碰任何 UI 或全域 state，方便單元測試與重複使用。
 *
 * 依賴：IDENTITY_LIBRARY / getIdentityById（src/config/identity-config.js）
 */

/**
 * 將人格卡的輸入項正規化為 { id, unlocked } 結構。
 *
 * playerIdentities 的每一項可為：
 *   - 字串：'gregor_edgar'                    → 視為「重複抽取技尚未解鎖」
 *   - 物件：{ id: 'gregor_edgar', unlocked: true } → 由玩家勾選決定是否納入重複抽取技
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
 * 將一組狀態點數累加進累積物件（疊加，非覆蓋）。
 * @param {object} accumulator - 累積結果（會被就地修改）
 * @param {object} statusMap - 例如 { depression: 3 }
 */
function accumulateStatus(accumulator, statusMap) {
    if (!statusMap) return;
    for (const [key, value] of Object.entries(statusMap)) {
        accumulator[key] = (accumulator[key] || 0) + value;
    }
}

/**
 * 評估玩家本次攻擊：遍歷玩家持有的所有人格卡，疊加所有符合條件的 hook 效果。
 *
 * @param {Array<string|object>} playerIdentities - 玩家持有的所有卡片（字串或 {id,unlocked}）
 * @param {object} attackerState - 攻擊者狀態，例如 { status: { swiftness: 2 }, initiative: 18 }
 * @param {object} targetState   - 目標狀態，例如 { status: { depression: 8 } }
 * @returns {{
 *   totalDpBonus: number,
 *   triggerLogs: Array<{ identityId: string, identityName: string, source: string, skill: string, dpBonus: number }>,
 *   expectedTargetStatus: object,
 *   expectedSelfStatus: object
 * }}
 */
function evaluatePlayerAttack(playerIdentities, attackerState, targetState) {
    const attacker = ensureStatefulUnit(attackerState);
    const target = ensureStatefulUnit(targetState);

    const result = {
        totalDpBonus: 0,
        triggerLogs: [],
        expectedTargetStatus: {},
        expectedSelfStatus: {}
    };

    if (!Array.isArray(playerIdentities)) return result;

    for (const rawEntry of playerIdentities) {
        const { id, unlocked } = normalizeIdentityEntry(rawEntry);
        const card = (typeof getIdentityById === 'function')
            ? getIdentityById(id)
            : (typeof IDENTITY_LIBRARY !== 'undefined' ? IDENTITY_LIBRARY[id] : null);

        if (!card || !card.hooks) continue;

        // ---- 1) 攻擊前：累加 DP 加值 ----
        const onAttackHooks = card.hooks.onAttack || [];
        for (const hook of onAttackHooks) {
            if (!isHookActive(hook, unlocked)) continue;
            let satisfied = false;
            try {
                satisfied = hook.condition ? !!hook.condition(target, attacker) : true;
            } catch (e) {
                satisfied = false; // 條件存取了不存在的欄位時，視為未觸發
            }
            if (!satisfied) continue;

            const bonus = hook.dpBonus || 0;
            result.totalDpBonus += bonus;
            result.triggerLogs.push({
                identityId: card.id,
                identityName: card.name,
                source: hook.source || '',
                skill: hook.skill || '',
                dpBonus: bonus
            });
        }

        // ---- 2) 命中後：累加預計施加的狀態 ----
        const onHitHooks = card.hooks.onHit || [];
        for (const hook of onHitHooks) {
            if (!isHookActive(hook, unlocked)) continue;
            let satisfied = false;
            try {
                satisfied = hook.condition ? !!hook.condition(target, attacker) : true;
            } catch (e) {
                satisfied = false;
            }
            if (!satisfied) continue;

            accumulateStatus(result.expectedTargetStatus, hook.targetStatus);
            accumulateStatus(result.expectedSelfStatus, hook.selfStatus);

            result.triggerLogs.push({
                identityId: card.id,
                identityName: card.name,
                source: hook.source || '',
                skill: hook.skill || '',
                dpBonus: 0,
                targetStatus: hook.targetStatus || null,
                selfStatus: hook.selfStatus || null
            });
        }
    }

    return result;
}

// ===== 瀏覽器全域匯出（與專案其他模組一致，使用全域函式） =====
// 同時相容 Node 環境（單元測試）：若有 module.exports 則一併匯出。
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeIdentityEntry,
        isHookActive,
        evaluatePlayerAttack
    };
}

console.log('⚙️ 人格卡疊加結算引擎已載入');

/**
 * Limbus Command - 戰鬥 Modal 綁定
 * 右鍵選單劫持發起的攻擊/威脅 Modal，與表單記憶（localStorage）+ Firebase 戰鬥隊列串接。
 */

const ATTACK_MODAL_MEMO_KEY = 'limbus-attack-modal-memo';
const DEFENSE_MODAL_MEMO_KEY = 'limbus-defense-modal-memo';

let attackModalTarget = null; // { id, name }

function cmLoadMemo(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function cmSaveMemo(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) { /* quota or disabled storage */ }
}

/**
 * 玩家對敵方/BOSS 右鍵點擊「發起攻擊」
 */
function openAttackModal(unitId) {
    const u = typeof findUnitById === 'function' ? findUnitById(unitId) : null;
    if (!u) return;
    attackModalTarget = { id: u.id, name: u.name || '目標' };

    document.getElementById('attack-target-name').innerText = `目標：${u.name || '---'}`;

    const memo = cmLoadMemo(ATTACK_MODAL_MEMO_KEY) || {};
    document.getElementById('attack-dp').value = memo.dp ?? 0;
    document.getElementById('attack-auto').value = memo.auto ?? 0;
    document.getElementById('attack-ignore-def').value = memo.ignoreDef ?? 0;
    document.getElementById('attack-crit-vicious').value = memo.critVicious ?? 0;

    openModal('attack-modal');
}

function closeAttackModal() {
    closeModal('attack-modal');
}

/**
 * ST 對玩家右鍵點擊「發起威脅 (QTE)」：沿用同一個 Modal UI
 */
function openThreatModal(unitId) {
    openAttackModal(unitId);
}

/**
 * 自動套用攻擊方目前在人格卡面板（identity-hud）勾選持有/解鎖的人格卡，
 * 疊加其 onAttack/onHit 數值加值，回傳可併入黑箱計算的 DP/額外成功加總與觸發紀錄。
 * 僅在玩家發起攻擊時套用（ST 發起威脅走的是另一套敵方資料，不涉及玩家人格卡）。
 * @param {object} attackerUnit
 * @param {object} targetUnit
 * @returns {{ dpBonus: number, extraSuccess: number, names: string[] }}
 */
function cmResolveIdentityBonus(attackerUnit, targetUnit) {
    const empty = { dpBonus: 0, extraSuccess: 0, names: [] };
    if (myRole === 'st') return empty;
    if (typeof evaluatePlayerAttack !== 'function' || typeof identityHudState === 'undefined') return empty;

    const owner = identityHudState.owner;
    if (!owner || typeof getIdentitiesByOwner !== 'function') return empty;

    const ownedCards = getIdentitiesByOwner(owner)
        .filter(id => identityHudState.cards[id] && identityHudState.cards[id].owned)
        .map(id => ({ id, unlocked: !!identityHudState.cards[id].unlocked }));
    if (!ownedCards.length) return empty;

    const attackerState = (typeof buildEngineUnitState === 'function') ? buildEngineUnitState(attackerUnit) : (attackerUnit || {});
    const targetState = (typeof buildEngineUnitState === 'function') ? buildEngineUnitState(targetUnit) : (targetUnit || {});
    const result = evaluatePlayerAttack(ownedCards, attackerState, targetState);

    return {
        dpBonus: result.totalDpBonus || 0,
        extraSuccess: result.totalExtraSuccess || 0,
        names: [...new Set(result.triggerLogs.filter(l => !l.manual).map(l => l.identityName).filter(Boolean))]
    };
}

/**
 * 發送按鈕：依目前使用者角色決定走「攻擊」或「威脅」流程
 */
function submitAttackModal() {
    if (!attackModalTarget) return;
    const dp = Number(document.getElementById('attack-dp').value) || 0;
    const auto = Number(document.getElementById('attack-auto').value) || 0;
    const ignoreDef = Math.max(0, Number(document.getElementById('attack-ignore-def').value) || 0);
    const critVicious = Math.max(0, Number(document.getElementById('attack-crit-vicious').value) || 0);

    cmSaveMemo(ATTACK_MODAL_MEMO_KEY, { dp, auto, ignoreDef, critVicious });

    const attackerUnit = (typeof state !== 'undefined' && Array.isArray(state.units))
        ? state.units.find(u => u.ownerId === myPlayerId) : null;
    const targetUnit = typeof findUnitById === 'function' ? findUnitById(attackModalTarget.id) : null;
    const identityBonus = cmResolveIdentityBonus(attackerUnit, targetUnit);

    const attacker = {
        id: myPlayerId, name: myName,
        unitId: attackerUnit ? attackerUnit.id : null,
        dp, auto, ignoreDef, critVicious,
        identityDpBonus: identityBonus.dpBonus,
        identityExtraSuccess: identityBonus.extraSuccess,
        identityNotes: identityBonus.names
    };
    const target = { id: attackModalTarget.id, name: attackModalTarget.name };

    if (myRole === 'st') {
        cqInitiateThreat({ attacker, target });
        if (typeof showToast === 'function') showToast('威脅已發起，等待玩家防禦...');
    } else {
        cqInitiateAttack({ attacker, target });
        const bonusTotal = identityBonus.dpBonus + identityBonus.extraSuccess;
        const bonusMsg = bonusTotal ? `（已自動套用人格卡加值 +${bonusTotal}）` : '';
        if (typeof showToast === 'function') showToast('攻擊已送出，等待系統判定...' + bonusMsg);
    }
    closeAttackModal();
}

/**
 * combat-queue.js 在 pending_defense 狀態時呼叫：若自己是目標玩家，彈出防禦 QTE。
 */
function cqOnPendingDefense(data) {
    const target = data.target || {};
    if (myRole === 'st' || target.id !== myPlayerId) return;

    const memo = cmLoadMemo(DEFENSE_MODAL_MEMO_KEY) || {};
    document.getElementById('defense-dp').value = memo.dp ?? 0;
    document.getElementById('defense-auto').value = memo.auto ?? 0;

    openModal('defense-qte-modal');
}

function submitDefenseModal() {
    const dp = Number(document.getElementById('defense-dp').value) || 0;
    const auto = Number(document.getElementById('defense-auto').value) || 0;

    cmSaveMemo(DEFENSE_MODAL_MEMO_KEY, { dp, auto });

    cqSubmitDefense({ dp, auto });

    closeModal('defense-qte-modal');
    if (typeof showToast === 'function') showToast('防禦已送出，等待系統判定...');
}

/**
 * combat-queue.js 在 st_review 狀態時呼叫（僅 ST 端）：彈出黑箱審核 Modal。
 */
function cqOnSTReview(data) {
    if (myRole !== 'st') return;
    document.getElementById('st-review-suggested').innerText = `系統建議骰數：${data.baseDice ?? 0} 顆`;

    // 顯示攻擊方宣告的特殊參數，供 ST 黑箱判定參考
    const atk = data.attacker || {};
    const ignoreDef = Number(atk.ignoreDef) || 0;
    const critVicious = Number(atk.critVicious) || 0;
    const identityDpBonus = Number(atk.identityDpBonus) || 0;
    const identityExtraSuccess = Number(atk.identityExtraSuccess) || 0;
    const ctx = document.getElementById('st-review-context');
    if (ctx) {
        const notes = [];
        if (ignoreDef > 0) notes.push(`無視防禦 ${ignoreDef} 點`);
        if (critVicious > 0) notes.push(`嚴重轉惡性 ${critVicious} 點`);
        if (identityDpBonus > 0) notes.push(`人格卡 DP +${identityDpBonus}`);
        if (identityExtraSuccess > 0) notes.push(`人格卡額外成功 +${identityExtraSuccess}`);
        if (Array.isArray(atk.identityNotes) && atk.identityNotes.length) notes.push(`套用人格卡：${atk.identityNotes.join('、')}`);
        ctx.innerText = notes.length ? `攻擊方宣告：${notes.join('、')}` : '';
    }

    document.getElementById('st-review-modifier').value = 0;
    openModal('st-review-modal');
}

function confirmSTReview() {
    if (combatQueueLast === null) return;
    const baseDice = (combatQueueLast && combatQueueLast.baseDice) || 0;
    const modifier = Number(document.getElementById('st-review-modifier').value) || 0;
    const finalDice = Math.max(0, baseDice + modifier);

    closeModal('st-review-modal');
    cqBroadcastResult(finalDice, modifier);
}

/**
 * combat-queue.js 在 idle 狀態時呼叫：確保所有戰鬥相關 Modal 皆已關閉。
 */
function cqOnIdle() {
    closeModal('attack-modal');
    closeModal('defense-qte-modal');
    closeModal('st-review-modal');
}

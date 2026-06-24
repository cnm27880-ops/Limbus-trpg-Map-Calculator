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
 * 發送按鈕：依目前使用者角色決定走「攻擊」或「威脅」流程
 */
function submitAttackModal() {
    if (!attackModalTarget) return;
    const dp = Number(document.getElementById('attack-dp').value) || 0;
    const auto = Number(document.getElementById('attack-auto').value) || 0;
    const ignoreDef = Math.max(0, Number(document.getElementById('attack-ignore-def').value) || 0);
    const critVicious = Math.max(0, Number(document.getElementById('attack-crit-vicious').value) || 0);

    cmSaveMemo(ATTACK_MODAL_MEMO_KEY, { dp, auto, ignoreDef, critVicious });

    const attacker = {
        id: myPlayerId, name: myName,
        dp, auto, ignoreDef, critVicious
    };
    const target = { id: attackModalTarget.id, name: attackModalTarget.name };

    if (myRole === 'st') {
        cqInitiateThreat({ attacker, target });
        if (typeof showToast === 'function') showToast('威脅已發起，等待玩家防禦...');
    } else {
        cqInitiateAttack({ attacker, target });
        if (typeof showToast === 'function') showToast('攻擊已送出，等待系統判定...');
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
    const ctx = document.getElementById('st-review-context');
    if (ctx) {
        const notes = [];
        if (ignoreDef > 0) notes.push(`無視防禦 ${ignoreDef} 點`);
        if (critVicious > 0) notes.push(`嚴重轉惡性 ${critVicious} 點`);
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

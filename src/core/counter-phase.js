/**
 * Limbus Command - BOSS多重行動：對抗分配（先攻對抗計算）
 * Firebase 節點 /rooms/{roomId}/counterPhase，獨立於 combatQueue 與 state。
 *
 * 規則（特殊BOSS）：
 * - 每回合開始前，ST 開啟徵詢，玩家端自動跳出勾選視窗，選擇要對抗哪些 BOSS 行動（可複選/不選）
 * - 行動先攻 > 對抗者先攻：該行動 DP + 支線等級x10；先攻 < 對抗者先攻：該行動 DP − 支線等級x10
 * - 同一玩家每多對抗一個行動：該玩家所有被對抗行動 DP 額外 + 支線等級x10
 * - 玩家本回合未對抗任何行動：玩家自身攻擊 DP + 支線等級x10
 */

let counterPhaseState = { started: false, roundId: 0, bossId: null, actions: [], assignments: {}, finalized: false };
let counterPhaseListener = null;
let cpLastPoppedRound = -1;
let cpLastFinalizedRound = -1;

function cpRef() {
    return (typeof roomRef !== 'undefined' && roomRef) ? roomRef.child('counterPhase') : null;
}

/**
 * Firebase 對「全部子項皆為連續數字鍵」的陣列會原樣回傳 array，
 * 但若中間有缺漏鍵或寫入時機不一致，SDK 可能改回傳一般物件，導致 .map/.forEach 整段失效、
 * 畫面只剩下殘存的部分項目（外觀上很像「只顯示 1 個行動」）。讀取後一律正規化回陣列，避免此落差。
 * @param {*} value
 * @returns {array}
 */
function cpAsArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
}

function cpNormalizeState(data) {
    const base = { started: false, roundId: 0, bossId: null, actions: [], assignments: {}, finalized: false };
    if (!data) return base;
    return {
        ...base,
        ...data,
        actions: cpAsArray(data.actions),
        assignments: (data.assignments && typeof data.assignments === 'object') ? data.assignments : {},
        finalized: !!data.finalized
    };
}

function cpSetupListener() {
    const ref = cpRef();
    if (!ref) return;
    if (counterPhaseListener) ref.off('value', counterPhaseListener);

    counterPhaseListener = ref.on('value', snapshot => {
        counterPhaseState = cpNormalizeState(snapshot.val());
        cpHandleUpdate();
    });
    if (typeof unsubscribeListeners !== 'undefined') {
        unsubscribeListeners.push(() => ref.off('value', counterPhaseListener));
    }
}

function cpHandleUpdate() {
    if (typeof renderMultiActionCounterStatus === 'function') renderMultiActionCounterStatus();
    // 浮動面板（玩家端持久面板）每次狀態變動都重新渲染，讓所有人即時看到彼此的對抗分配
    if (typeof cpRenderFloatPanel === 'function') cpRenderFloatPanel();

    if (myRole === 'st' || !counterPhaseState.started) return;
    const mine = (counterPhaseState.assignments || {})[myPlayerId];
    if (mine === undefined && counterPhaseState.roundId !== cpLastPoppedRound) {
        cpLastPoppedRound = counterPhaseState.roundId;
        if (typeof openCounterAssignModal === 'function') openCounterAssignModal();
    }
    // ST 公佈最終結果 → 自動彈出面板讓玩家看到結果（每輪僅一次）
    if (counterPhaseState.finalized && counterPhaseState.roundId !== cpLastFinalizedRound) {
        cpLastFinalizedRound = counterPhaseState.roundId;
        if (typeof cpShowFloatPanel === 'function') cpShowFloatPanel();
        if (typeof cpRenderFloatPanel === 'function') cpRenderFloatPanel();
        if (typeof showToast === 'function') showToast('📢 ST 已公佈本輪對抗分配結果');
    }
}

/**
 * ST：開始新一輪對抗徵詢，從指定 BOSS 的多重行動條目（本體+各行動槽）讀取先攻與DP
 */
function cpStartRound(bossId) {
    const boss = (typeof findUnitById === 'function') ? findUnitById(bossId) : null;
    if (!boss) {
        if (typeof showToast === 'function') showToast('請先選擇 BOSS');
        return;
    }
    const slots = (typeof getActionSlots === 'function') ? getActionSlots(bossId) : [];
    const actions = [{ id: boss.id, init: boss.init || 0, dp: boss.actionDp || 0, label: '行動1·本體' }]
        .concat(slots.map((s, i) => ({ id: s.id, init: s.init || 0, dp: s.actionDp || 0, label: `行動${i + 2}` })));

    const ref = cpRef();
    if (!ref) return;
    ref.set({
        started: true,
        roundId: (counterPhaseState.roundId || 0) + 1,
        bossId,
        actions,
        assignments: {},
        finalized: false
    });
    if (typeof showToast === 'function') showToast('已開始對抗徵詢，玩家端將自動跳出選擇視窗');
}

/**
 * 玩家：送出本回合要對抗的行動清單（ST 公佈結果前可重複送出修改）。
 * Firebase 不儲存空陣列（會直接移除該鍵、看起來像「未送出」），
 * 故「不對抗任何行動」以 'none' 哨兵值表示；讀取端 cpAsArray('none') 會正規化回 []。
 * @param {string[]} actionIds
 */
function cpSubmitAssignment(actionIds) {
    const ref = cpRef();
    if (!ref) return;
    if (counterPhaseState.finalized) {
        if (typeof showToast === 'function') showToast('ST 已公佈本輪結果，無法再修改');
        return;
    }
    ref.child('assignments').update({ [myPlayerId]: (actionIds && actionIds.length) ? actionIds : 'none' });
}

/**
 * ST：手動指定某行動由哪位玩家對抗（playerId 傳空字串＝改為無人對抗）。
 * 會先把該行動從所有玩家的分配中移除，再併入指定玩家的清單。
 * @param {string} actionId
 * @param {string} playerId
 */
function cpSTAssign(actionId, playerId) {
    if (myRole !== 'st') return;
    const ref = cpRef();
    if (!ref) return;
    const next = {};
    Object.keys(counterPhaseState.assignments || {}).forEach(pid => {
        const rest = cpAsArray(counterPhaseState.assignments[pid]).filter(id => id !== actionId);
        next[pid] = rest.length ? rest : 'none';
    });
    if (playerId) {
        const cur = (next[playerId] && next[playerId] !== 'none') ? next[playerId] : [];
        cur.push(actionId);
        next[playerId] = cur;
    }
    ref.child('assignments').set(next);
}

/**
 * ST：公佈本輪最終結果。玩家端會自動彈出面板顯示結果，且不能再修改分配。
 */
function cpFinalizeRound() {
    if (myRole !== 'st') return;
    const ref = cpRef();
    if (!ref || !counterPhaseState.started) return;
    ref.update({ finalized: true });
    if (typeof showToast === 'function') showToast('已公佈本輪對抗分配結果');
}

/**
 * 計算某玩家本回合的對抗修正
 * @returns {{ selfBonus: number, perAction: Record<string, number> }}
 */
function cpResolvePlayerMods(playerId, playerInit) {
    const result = { selfBonus: 0, perAction: {} };
    if (!counterPhaseState.started) return result;
    const boss = (typeof findUnitById === 'function') ? findUnitById(counterPhaseState.bossId) : null;
    const X = ((boss && boss.sideLevel) || 1) * 10;
    const mine = cpAsArray((counterPhaseState.assignments || {})[playerId]);

    if (mine.length === 0) {
        result.selfBonus = X;
        return result;
    }
    mine.forEach(actionId => {
        const action = (counterPhaseState.actions || []).find(a => a.id === actionId);
        if (!action) return;
        const initMod = action.init > playerInit ? X : (action.init < playerInit ? -X : 0);
        const extraMod = (mine.length - 1) * X;
        result.perAction[actionId] = initMod + extraMod;
    });
    return result;
}

/**
 * 取得某行動目前被哪位玩家對抗，以及其 DP 修正（供威脅快選按鈕自動帶入）
 * @returns {{ playerId: string|null, playerName: string, mod: number }}
 */
function cpResolveActionMod(actionId) {
    const empty = { playerId: null, playerName: '', mod: 0 };
    if (!counterPhaseState.started) return empty;
    const playerId = Object.keys(counterPhaseState.assignments || {})
        .find(pid => cpAsArray(counterPhaseState.assignments[pid]).includes(actionId));
    if (!playerId) return empty;

    const playerUnit = (typeof state !== 'undefined' && Array.isArray(state.units))
        ? state.units.find(u => u.ownerId === playerId) : null;
    const mods = cpResolvePlayerMods(playerId, playerUnit ? (playerUnit.init || 0) : 0);
    return { playerId, playerName: (playerUnit && playerUnit.name) || playerId, mod: mods.perAction[actionId] || 0 };
}

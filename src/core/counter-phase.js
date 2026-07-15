/**
 * Limbus Command - BOSS多重行動：對抗分配（先攻對抗計算）
 * Firebase 節點 /rooms/{roomId}/counterPhase，獨立於 combatQueue 與 state。
 *
 * 規則（特殊BOSS）：
 * - 每回合開始前，ST 開啟徵詢，玩家端自動跳出勾選視窗，選擇要對抗哪些 BOSS 行動（可複選/不選）
 * - 行動先攻 > 對抗者先攻：該行動 DP + 支線等級x10；先攻 < 對抗者先攻：該行動 DP − 支線等級x10
 * - 同一玩家每多對抗一個行動：該玩家所有被對抗行動 DP 額外 + 支線等級x10
 * - 玩家本回合未對抗任何行動：玩家自身攻擊 DP + 支線等級x10
 *
 * 【單方面攻擊】（ST 公佈結果後生效）：
 * - 沒有任何玩家宣告對抗的行動 → 轉化為單方面攻擊：
 *   1. 強制鎖定場上血量最低的玩家，並使其陷入「措手不及」——此次措手不及視為
 *      主線給予之支線等級 +1 級。
 *   2. 該次攻擊 BOSS 無視先攻快慢，直接獲得 DP 加值：修正基數以措手不及等級計算，
 *      即 (支線等級 + 1) × 10。
 */

let counterPhaseState = { started: false, roundId: 0, bossId: null, actions: [], assignments: {}, finalized: false };
let counterPhaseListener = null;
let cpLastPoppedRound = -1;
let cpLastFinalizedRound = -1;
// 本次連線已看過的快照狀態（null = 尚未收到首個快照）。
// counterPhase 節點會一直留在 Firebase，頁面載入的首個快照是「存量資料」而非 ST 的即時徵詢，
// 一律不自動彈出面板；只有連線期間 roundId／finalized 發生「即時變化」（ST 按下徵詢/公佈）才彈。
let cpSeenRoundId = null;
let cpSeenFinalized = null;

// 「已自動彈出過的輪次」持久化（依房間分開記憶）：
// counterPhase 節點會一直留在 Firebase（沒有「結束徵詢」的動作），
// 若只用記憶體變數判斷，玩家每次重新整理／重開頁面都會因初始快照再彈一次視窗。
// 持久化後，同一輪徵詢在同一個瀏覽器只自動彈出一次——只有 ST 開啟「新的一輪」才會再跳。
const CP_POPPED_ROUND_KEY = 'limbus-cp-popped-round';
const CP_FINALIZED_ROUND_KEY = 'limbus-cp-finalized-round';

function cpLoadRoundMark(key) {
    try {
        const raw = localStorage.getItem(key);
        const data = raw ? JSON.parse(raw) : null;
        const room = (typeof currentRoomCode !== 'undefined' && currentRoomCode) ? currentRoomCode : '';
        if (data && data.room === room && Number.isFinite(Number(data.roundId))) return Number(data.roundId);
    } catch (e) { /* ignore */ }
    return -1;
}

function cpSaveRoundMark(key, roundId) {
    try {
        const room = (typeof currentRoomCode !== 'undefined' && currentRoomCode) ? currentRoomCode : '';
        localStorage.setItem(key, JSON.stringify({ room, roundId }));
    } catch (e) { /* ignore */ }
}

function cpLoadPoppedRound() { return cpLoadRoundMark(CP_POPPED_ROUND_KEY); }
function cpSavePoppedRound(roundId) { cpSaveRoundMark(CP_POPPED_ROUND_KEY, roundId); }
function cpLoadFinalizedRound() { return cpLoadRoundMark(CP_FINALIZED_ROUND_KEY); }
function cpSaveFinalizedRound(roundId) { cpSaveRoundMark(CP_FINALIZED_ROUND_KEY, roundId); }

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

    // 重新掛監聽（換房/重連）時重置基準：下一個快照視為「載入存量」，不觸發自動彈出
    cpSeenRoundId = null;
    cpSeenFinalized = null;

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

    // 即時變化偵測：首個快照（頁面載入時的存量資料）只記錄基準、絕不自動彈出，
    // 之後 roundId 變化 = ST 開啟新徵詢、finalized false→true = ST 剛公佈結果
    const firstSnapshot = (cpSeenRoundId === null);
    const isLiveNewRound = !firstSnapshot && counterPhaseState.roundId !== cpSeenRoundId;
    const isLiveFinalized = !firstSnapshot && counterPhaseState.finalized && cpSeenFinalized === false;
    cpSeenRoundId = counterPhaseState.roundId;
    cpSeenFinalized = counterPhaseState.finalized;

    if (myRole === 'st' || !counterPhaseState.started) return;
    const mine = (counterPhaseState.assignments || {})[myPlayerId];
    // 自動彈出條件：ST「剛剛」開啟新一輪徵詢（連線期間即時變化）、本輪尚未公佈、自己尚未送出，
    // 且這一輪從未在此瀏覽器彈出過（記憶體＋localStorage 標記為輔）。
    // 頁面載入時的殘留徵詢一律不彈——玩家可從快捷球「本回合對抗分配」自行開啟。
    if (isLiveNewRound && mine === undefined && !counterPhaseState.finalized
        && counterPhaseState.roundId !== cpLastPoppedRound
        && counterPhaseState.roundId !== cpLoadPoppedRound()) {
        cpLastPoppedRound = counterPhaseState.roundId;
        cpSavePoppedRound(counterPhaseState.roundId);
        if (typeof openCounterAssignModal === 'function') openCounterAssignModal();
    }
    // ST「剛剛」公佈最終結果 → 自動彈出面板讓玩家看到結果（每輪僅一次；頁面重整不再重跳）
    if (isLiveFinalized && counterPhaseState.roundId !== cpLastFinalizedRound
        && counterPhaseState.roundId !== cpLoadFinalizedRound()) {
        cpLastFinalizedRound = counterPhaseState.roundId;
        cpSaveFinalizedRound(counterPhaseState.roundId);
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
    // 【部位破壞 / 混亂】：嚴重槽已填滿的 BOSS 依規則本回合混亂、無法行動，
    // 開徵詢前先提醒 ST（仍可堅持開始，例如混亂已於上回合結算完畢）。
    if (typeof isSevereGaugeFull === 'function' && isSevereGaugeFull(boss)) {
        const goOn = confirm('💫 此 BOSS 的嚴重槽已填滿：依規則陷入一回合混亂、本回合無法行動。\n仍要開始本輪對抗徵詢嗎？');
        if (!goOn) return;
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

// ===== 【單方面攻擊】無人對抗的行動 =====

/**
 * 措手不及等級：主線給予之支線等級 +1 級。
 * @param {object|null} boss
 * @returns {number}
 */
function cpUnopposedLevel(boss) {
    return ((boss && boss.sideLevel) || 1) + 1;
}

/**
 * 單方面攻擊的 DP 加值（無視先攻快慢直接獲得）：措手不及等級 × 10。
 * @param {object|null} boss
 * @returns {number}
 */
function cpUnopposedMod(boss) {
    return cpUnopposedLevel(boss) * 10;
}

/**
 * 場上血量最低的玩家單位（單方面攻擊的強制鎖定目標）。
 * 以加權血量百分比比較（B=1/L=2/A=3 的傷害權重），排除行動條目等非實體單位。
 * @returns {object|null}
 */
function cpFindLowestHpPlayer() {
    if (typeof state === 'undefined' || !Array.isArray(state.units)) return null;
    const players = state.units.filter(u => u && u.type === 'player' && !u.actionSlotOf);
    if (!players.length) return null;
    const pct = (u) => (typeof calculateWeightedHpPercent === 'function')
        ? calculateWeightedHpPercent(u)
        : ((u.hpArr || []).filter(x => !x).length / Math.max(1, u.maxHp || (u.hpArr || []).length || 1)) * 100;
    return players.reduce((low, u) => (pct(u) < pct(low) ? u : low), players[0]);
}

/**
 * 取得某行動目前被哪位玩家對抗，以及其 DP 修正（供威脅快選按鈕自動帶入）。
 * ST 公佈結果後仍無人對抗的行動 → 依【單方面攻擊】規則回傳：
 *   unopposed: true、mod = (支線等級+1)×10（無視先攻）、
 *   victimId / victimName = 場上血量最低的玩家（強制鎖定，陷入措手不及）、
 *   surpriseLevel = 措手不及等級（支線等級+1）。
 * @returns {{ playerId: string|null, playerName: string, mod: number,
 *             unopposed?: boolean, surpriseLevel?: number, victimId?: string|null, victimName?: string }}
 */
function cpResolveActionMod(actionId) {
    const empty = { playerId: null, playerName: '', mod: 0 };
    if (!counterPhaseState.started) return empty;
    const playerId = Object.keys(counterPhaseState.assignments || {})
        .find(pid => cpAsArray(counterPhaseState.assignments[pid]).includes(actionId));
    if (!playerId) {
        // 公佈前不視為單方面攻擊（玩家可能還沒送出）；公佈後無人對抗 → 單方面攻擊
        if (!counterPhaseState.finalized) return empty;
        const isAction = (counterPhaseState.actions || []).some(a => a && a.id === actionId);
        if (!isAction) return empty;
        const boss = (typeof findUnitById === 'function') ? findUnitById(counterPhaseState.bossId) : null;
        const victim = cpFindLowestHpPlayer();
        return {
            playerId: null, playerName: '',
            mod: cpUnopposedMod(boss),
            unopposed: true,
            surpriseLevel: cpUnopposedLevel(boss),
            victimId: victim ? victim.id : null,
            victimName: (victim && victim.name) || ''
        };
    }

    const playerUnit = (typeof state !== 'undefined' && Array.isArray(state.units))
        ? state.units.find(u => u.ownerId === playerId) : null;
    const mods = cpResolvePlayerMods(playerId, playerUnit ? (playerUnit.init || 0) : 0);
    return { playerId, playerName: (playerUnit && playerUnit.name) || playerId, mod: mods.perAction[actionId] || 0 };
}

/**
 * Limbus Command - 戰鬥隊列狀態機
 * 管理 Firebase 節點 /rooms/{roomId}/combatQueue，獨立於 state.js 的房間/地圖/單位同步狀態。
 *
 * 狀態流轉：
 * idle -> pending_defense -> calculating -> st_review -> broadcasting -> idle
 *      \-----------------> calculating（玩家主動攻擊，跳過防禦 QTE）
 */

let combatQueueListener = null;
let combatQueueLast = null; // 上一次收到的隊列資料，避免重複觸發彈窗

function cqRef() {
    return roomRef ? roomRef.child('combatQueue') : null;
}

/**
 * 設置 combatQueue 監聽，所有客戶端皆會呼叫。
 * 依據狀態變化派發給 UI 層（combat-modals.js / combat-broadcast.js）與黑箱引擎（ST 端）。
 */
function cqSetupListener() {
    const ref = cqRef();
    if (!ref) return;
    if (combatQueueListener) ref.off('value', combatQueueListener);

    combatQueueListener = ref.on('value', snapshot => {
        const data = snapshot.val();
        cqHandleUpdate(data);
        combatQueueLast = data;
    });
    unsubscribeListeners.push(() => ref.off('value', combatQueueListener));
}

function cqHandleUpdate(data) {
    if (!data || data.status === 'idle') {
        if (typeof cqOnIdle === 'function') cqOnIdle();
        return;
    }

    switch (data.status) {
        case 'pending_defense':
            if (typeof cqOnPendingDefense === 'function') cqOnPendingDefense(data);
            break;
        case 'calculating':
            // 黑箱引擎僅在 ST 端執行
            if (myRole === 'st' && typeof bbRunBlackBoxCalculation === 'function') {
                bbRunBlackBoxCalculation(data);
            }
            break;
        case 'st_review':
            if (myRole === 'st' && typeof cqOnSTReview === 'function') cqOnSTReview(data);
            break;
        case 'broadcasting':
            if (typeof cqOnBroadcasting === 'function') cqOnBroadcasting(data);
            break;
    }
}

/**
 * 玩家對敵方/BOSS 發起攻擊：直接進入 calculating（防禦值由 ST 端黑箱引擎從單位資料取得）。
 */
function cqInitiateAttack(payload) {
    const ref = cqRef();
    if (!ref) return;
    ref.set({
        status: 'calculating',
        attacker: payload.attacker,
        target: payload.target,
        defense: null,
        baseDice: null,
        modifier: null,
        finalDice: null,
        ts: firebase.database.ServerValue.TIMESTAMP
    });
}

/**
 * ST 對玩家發起威脅：進入 pending_defense，等待該玩家填寫防禦 QTE。
 */
function cqInitiateThreat(payload) {
    const ref = cqRef();
    if (!ref) return;
    ref.set({
        status: 'pending_defense',
        attacker: payload.attacker,
        target: payload.target,
        defense: null,
        baseDice: null,
        modifier: null,
        finalDice: null,
        ts: firebase.database.ServerValue.TIMESTAMP
    });
}

/**
 * 玩家送出防禦 QTE 表單後，進入 calculating。
 */
function cqSubmitDefense(defense) {
    const ref = cqRef();
    if (!ref) return;
    ref.update({
        status: 'calculating',
        defense: defense
    });
}

/**
 * ST 端：黑箱引擎完成基礎運算後，寫入 base_dice（與運算過程 debugStr）並轉入 st_review。
 */
function cqEnterSTReview(baseDice, debugStr) {
    const ref = cqRef();
    if (!ref) return;
    ref.update({
        status: 'st_review',
        baseDice: baseDice,
        debugStr: debugStr || ''
    });
}

/**
 * ST 確認最終微調後，寫入 final_dice 並轉入 broadcasting。
 */
function cqBroadcastResult(finalDice, modifier) {
    const ref = cqRef();
    if (!ref) return;
    ref.update({
        status: 'broadcasting',
        modifier: modifier,
        finalDice: finalDice
    });
}

/**
 * ST 端：廣播結束後重置隊列為 idle 並清空暫存資料。
 */
function cqReset() {
    const ref = cqRef();
    if (!ref) return;
    ref.set({ status: 'idle' });
}

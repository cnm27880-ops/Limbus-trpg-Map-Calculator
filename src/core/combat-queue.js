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
let cqLastCalculatedTs = null; // 已執行過黑箱運算的 ts，避免 Firebase 對同一筆寫入重複觸發 value 造成重算覆蓋正確結果

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
        cqLastCalculatedTs = null; // 重置，讓下一場戰鬥可以重新觸發黑箱運算
        if (typeof cqOnIdle === 'function') cqOnIdle();
        return;
    }

    switch (data.status) {
        case 'pending_defense':
            if (typeof cqOnPendingDefense === 'function') cqOnPendingDefense(data);
            break;
        case 'calculating':
            // 黑箱引擎僅在 ST 端執行；Firebase 對同一筆寫入可能觸發多次 value（本地預測 + 伺服器確認），
            // 以 ts（本場戰鬥唯一識別，於 cqInitiateAttack/cqInitiateThreat 設定後即不再變動）避免重算覆蓋已送審的正確結果。
            if (myRole === 'st' && typeof bbRunBlackBoxCalculation === 'function' && data.ts !== cqLastCalculatedTs) {
                cqLastCalculatedTs = data.ts;
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
 * 隊列忙碌中（不存在或 status 不是 idle 都算閒置以外）時，中止發起新攻擊並提示；
 * 否則以交易寫入新隊列——用 transaction 而非 set，確保「檢查閒置」與「寫入」是同一個
 * 對服務端原子操作，避免兩名玩家（或玩家與 ST）幾乎同時發起攻擊時，後者直接覆蓋前者
 * 正在審核中的隊列（前者的攻擊憑空消失，防禦方若已扣資源也白扣）。
 * @param {object} ref - cqRef()
 * @param {object} newData - 要寫入的新隊列內容
 */
function cqTryStartQueue(ref, newData) {
    if (!ref || typeof ref.transaction !== 'function') {
        // 防呆：極舊/測試環境沒有 transaction API 時退回原本的直接寫入，避免完全無法發起攻擊。
        if (ref) ref.set(newData);
        return;
    }
    ref.transaction(
        current => (current && current.status && current.status !== 'idle') ? undefined : newData,
        (error, committed) => {
            if (error) {
                console.error('cqTryStartQueue transaction failed:', error);
                return;
            }
            if (!committed && typeof showToast === 'function') {
                showToast('目前有其他攻擊正在結算中，請稍候再試一次');
            }
        }
    );
}

/**
 * 玩家對敵方/BOSS 發起攻擊：直接進入 calculating（防禦值由 ST 端黑箱引擎從單位資料取得）。
 */
function cqInitiateAttack(payload) {
    const ref = cqRef();
    if (!ref) return;
    cqTryStartQueue(ref, {
        status: 'calculating',
        attacker: payload.attacker,
        target: payload.target,
        targets: payload.targets || null,  // 豁免抵擋模式的多目標清單（各目標分別擲豁免）
        defense: null,
        baseDice: null,
        baseExtraSuccess: null,
        modifier: null,
        finalDice: null,
        finalExtraSuccess: null,
        ts: firebase.database.ServerValue.TIMESTAMP
    });
}

/**
 * ST 對玩家發起威脅：進入 pending_defense，等待該玩家填寫防禦 QTE。
 */
function cqInitiateThreat(payload) {
    const ref = cqRef();
    if (!ref) return;
    cqTryStartQueue(ref, {
        status: 'pending_defense',
        attacker: payload.attacker,
        target: payload.target,
        defense: null,
        baseDice: null,
        baseExtraSuccess: null,
        modifier: null,
        finalDice: null,
        finalExtraSuccess: null,
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
 * ST 端：黑箱引擎完成基礎運算後，寫入 baseDice 與 baseExtraSuccess（兩者分開，不相加）
 * 與運算過程 debugStr，並轉入 st_review。
 * @param {object|null} [extras] - 額外欄位（如豁免抵擋模式的 saveInfo），一併寫入隊列
 */
function cqEnterSTReview(baseDice, baseExtraSuccess, debugStr, extras) {
    const ref = cqRef();
    if (!ref) return;
    ref.update(Object.assign({
        status: 'st_review',
        baseDice: baseDice,
        baseExtraSuccess: baseExtraSuccess,
        debugStr: debugStr || '',
        saveInfo: null  // 預設清空，避免上一場豁免模式的資料殘留到本場防禦扣除模式
    }, (extras && typeof extras === 'object') ? extras : {}));
}

/**
 * ST 確認最終微調後，寫入 finalDice / finalExtraSuccess 並轉入 broadcasting。
 * 微調僅套用於骰數（finalDice），附加成功維持黑箱原值。
 * @param {object|null} rollResult - 自動擲骰結果（null＝手動擲骰）：
 *   { successes, exploded, totalRolled, totalBeforeCap, capApplied, statusBonus, statusBonusText, damage }
 */
function cqBroadcastResult(finalDice, finalExtraSuccess, modifier, rollResult) {
    const ref = cqRef();
    if (!ref) return;
    ref.update({
        status: 'broadcasting',
        modifier: modifier,
        finalDice: finalDice,
        finalExtraSuccess: finalExtraSuccess,
        rollResult: rollResult || null
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

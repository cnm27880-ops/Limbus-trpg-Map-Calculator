/**
 * Limbus Command - 戰鬥隊列狀態機
 * 管理 Firebase 節點 /rooms/{roomId}/combatQueue，獨立於 state.js 的房間/地圖/單位同步狀態。
 *
 * 狀態流轉：
 * idle -> pending_defense -> calculating -> st_review -> broadcasting -> idle
 *      \-----------------> calculating（玩家主動攻擊，跳過防禦 QTE）
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 等候區（combatQueuePending）
 *
 * 「作用中」的結算同時只會有一筆（黑箱運算與 ST 審核面板都是單筆語意），但發起攻擊
 * 不再因此被擋下來：作用中槽位忙碌時，新攻擊會排進等候區 /rooms/{roomId}/combatQueuePending，
 * 待目前這筆結算完畢回到 idle 時，由 ST 端自動把最舊的一筆推進作用中槽位。
 *
 * 這解決了兩個實際問題：
 *   1. 多名玩家可以同時送出攻擊，不會互相擋（先前後者會被 transaction 拒絕並要求重試）。
 *   2. 某筆結算卡住（玩家離線、單位被刪）時，其餘攻擊仍在等候區保留著，
 *      ST 用 cqForceReset() 強制中止後即自動接續，不會整場戰鬥卡死。
 * ───────────────────────────────────────────────────────────────────────────
 */

let combatQueueListener = null;
let combatQueueLast = null; // 上一次收到的隊列資料，避免重複觸發彈窗
let cqLastCalculatedTs = null; // 已執行過黑箱運算的 ts，避免 Firebase 對同一筆寫入重複觸發 value 造成重算覆蓋正確結果
let cqPendingListener = null;
let cqPendingList = [];     // 等候區快照 [{ key, ...payload }]，最舊的在前
let cqAdvancing = false;    // 正在把等候區的下一筆推進作用中槽位（避免重入造成同一筆推兩次）
let cqLastAbortedAt = null; // 已提示過的「ST 強制中止」時間戳，避免同一次中止重複跳提示

function cqRef() {
    return roomRef ? roomRef.child('combatQueue') : null;
}

/** 等候區節點：作用中槽位忙碌時，新發起的攻擊暫存於此，依 push 鍵（時間遞增）排序 */
function cqPendingRef() {
    return roomRef ? roomRef.child('combatQueuePending') : null;
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

    // 等候區：所有人都監聽（玩家可看到自己排在第幾位；ST 負責推進與管理）
    const pRef = cqPendingRef();
    if (pRef) {
        if (cqPendingListener) pRef.off('value', cqPendingListener);
        cqPendingListener = pRef.on('value', snapshot => {
            const val = snapshot.val() || {};
            // push 鍵本身依時間遞增，明確 sort() 確保「最舊的先結算」與物件列舉順序無關
            cqPendingList = Object.keys(val).sort().map(key => Object.assign({ key }, val[key]));
            if (typeof cqOnPendingListChanged === 'function') cqOnPendingListChanged(cqPendingList);
            // 作用中槽位已閒置且等候區有人 → 推進下一筆
            cqTryAdvancePending();
        });
        unsubscribeListeners.push(() => pRef.off('value', cqPendingListener));
    }
}

function cqHandleUpdate(data) {
    // 戰鬥隊列主控台（ST）需要即時反映目前狀態，故每次狀態變動都通知它重繪。
    // 明確把 data 傳過去：combatQueueLast 要等本函式回傳後才會被監聽器更新，
    // 主控台若自行讀取全域變數會慢一拍、顯示上一筆結算的狀態。
    if (typeof stqOnQueueChanged === 'function') stqOnQueueChanged(data);

    if (!data || data.status === 'idle') {
        cqLastCalculatedTs = null; // 重置，讓下一場戰鬥可以重新觸發黑箱運算
        // ST 強制中止：提示其他人這筆結算是被中止的，而非正常跑完
        // （防禦 QTE 突然關閉時，玩家至少知道原因）
        const abortedAt = data && data.abortedAt;
        if (abortedAt && abortedAt !== cqLastAbortedAt) {
            cqLastAbortedAt = abortedAt;
            if (typeof myRole !== 'undefined' && myRole !== 'st' && typeof showToast === 'function') {
                showToast('🛑 ST 已中止目前的結算');
            }
        }
        if (typeof cqOnIdle === 'function') cqOnIdle();
        // 作用中槽位空出來了 → 把等候區最舊的一筆推進來接續結算
        cqTryAdvancePending();
        return;
    }

    // 防禦方單位已不存在（ST 直接刪角色／單位被移除）時，這筆結算永遠等不到防禦，
    // 會把整個隊列卡死。ST 端偵測到即自動中止並接續下一筆，不需要人工介入。
    if (data.status === 'pending_defense' && typeof myRole !== 'undefined' && myRole === 'st') {
        const targetId = data.target && data.target.id;
        const stillExists = targetId && typeof findUnitById === 'function' && findUnitById(targetId);
        if (targetId && !stillExists) {
            if (typeof showToast === 'function') {
                showToast(`⚠️ 防禦方「${(data.target && data.target.name) || '目標'}」已不在場上，自動中止這筆結算`);
            }
            cqForceReset();
            return;
        }
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
 * 發起一筆新結算：作用中槽位閒置時直接寫入；忙碌時改排進等候區。
 *
 * 以 transaction 而非 set 寫入——確保「檢查閒置」與「寫入」對服務端是同一個原子操作，
 * 避免兩名玩家（或玩家與 ST）幾乎同時發起攻擊時，後者直接覆蓋前者正在審核中的隊列
 * （前者的攻擊憑空消失，防禦方若已扣資源也白扣）。
 *
 * 與舊版的差別：交易未提交（槽位忙碌）時不再要求玩家「稍候再試一次」，
 * 而是把這筆攻擊排進等候區，待目前結算完畢自動接續，玩家不必守著畫面重按。
 *
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
            if (!committed) cqEnqueuePending(newData);
        }
    );
}

/**
 * 把一筆攻擊排進等候區。時間戳改用本地時間——等候區項目不參與黑箱運算的 ts 去重，
 * 但需要一個穩定可排序的值供 UI 顯示等候時間（ServerValue.TIMESTAMP 在讀回前是物件）。
 * @param {object} payload - 與作用中槽位相同結構的隊列內容
 */
function cqEnqueuePending(payload) {
    const ref = cqPendingRef();
    if (!ref || typeof ref.push !== 'function') {
        if (typeof showToast === 'function') showToast('目前有其他攻擊正在結算中，請稍候再試一次');
        return;
    }
    const entry = Object.assign({}, payload, { queuedAt: Date.now() });
    ref.push(entry);
    if (typeof showToast === 'function') {
        showToast('⏳ 目前有其他攻擊正在結算，你的攻擊已排入等候區，輪到時會自動結算');
    }
}

/**
 * ST 端：作用中槽位閒置且等候區有人時，把最舊的一筆推進作用中槽位並從等候區移除。
 *
 * 僅 ST 端執行（單一推進者，避免多個客戶端同時推進造成同一筆被結算兩次）；
 * 推進本身仍走 transaction，因此就算 ST 有多個分頁也不會重複寫入。
 */
function cqTryAdvancePending() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    if (cqAdvancing) return;
    if (!cqPendingList.length) return;

    const ref = cqRef();
    const pRef = cqPendingRef();
    if (!ref || !pRef) return;

    const next = cqPendingList[0];
    cqAdvancing = true;

    const commitNext = () => {
        // 推進時重新蓋上伺服器時間戳：ts 是黑箱運算的去重鍵，必須是這筆「開始結算」的時間，
        // 沿用排隊當下的時間會與先前已算過的 ts 混淆。
        const payload = Object.assign({}, next);
        delete payload.key;
        delete payload.queuedAt;
        payload.ts = (typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue)
            ? firebase.database.ServerValue.TIMESTAMP : Date.now();

        if (typeof ref.transaction !== 'function') {
            ref.set(payload);
            pRef.child(next.key).remove();
            cqAdvancing = false;
            return;
        }
        ref.transaction(
            current => (current && current.status && current.status !== 'idle') ? undefined : payload,
            (error, committed) => {
                cqAdvancing = false;
                if (error) {
                    console.error('cqTryAdvancePending transaction failed:', error);
                    return;
                }
                // 只有真的推進成功才從等候區移除，否則這筆會憑空消失
                if (committed) {
                    pRef.child(next.key).remove();
                    if (typeof showToast === 'function') {
                        const who = (next.attacker && next.attacker.name) || '玩家';
                        showToast(`▶️ 等候區接續結算：${who} 的攻擊（尚有 ${cqPendingList.length - 1} 筆等候中）`);
                    }
                }
            }
        );
    };

    // 確認作用中槽位真的閒置後才推進（監聽回流可能落後於實際狀態）
    ref.once('value').then(snap => {
        const cur = snap.val();
        if (cur && cur.status && cur.status !== 'idle') { cqAdvancing = false; return; }
        commitNext();
    }).catch(err => {
        cqAdvancing = false;
        console.error('cqTryAdvancePending read failed:', err);
    });
}

/**
 * ST 端：強制中止目前這筆結算，把作用中槽位打回 idle。
 *
 * 用於玩家中途離線／被叫走沒按結算／角色被刪除等造成的卡死。等候區不受影響，
 * 中止後會自動推進下一筆，戰鬥可以繼續跑。
 * @param {boolean} [alsoClearPending] - 一併清空等候區（整場重來時使用）
 */
function cqForceReset(alsoClearPending) {
    if (typeof myRole !== 'undefined' && myRole !== 'st') {
        if (typeof showToast === 'function') showToast('只有 ST 可以強制中止結算');
        return;
    }
    const ref = cqRef();
    if (!ref) return;

    if (alsoClearPending) {
        const pRef = cqPendingRef();
        if (pRef) pRef.remove();
    }
    // abortedAt 讓其他客戶端能區分「正常結算完畢回到 idle」與「被 ST 強制中止」，
    // 據此提示玩家（尤其是防禦 QTE 被關掉的那位）發生了什麼事。
    ref.set({ status: 'idle', abortedAt: Date.now() });
    if (typeof showToast === 'function') {
        showToast(alsoClearPending ? '🛑 已強制中止結算並清空等候區' : '🛑 已強制中止目前的結算');
    }
}

/**
 * ST 端：某單位被刪除時，若它正是作用中結算或等候區項目的攻擊方／防禦方，
 * 一併中止／清掉，避免留下永遠等不到對象的結算把隊列卡死。
 *
 * 由 deleteUnit() 在刪除後呼叫（監聽器不會因為單位被刪而重新觸發 combatQueue，
 * 所以必須在刪除當下主動處理）。
 * @param {string} unitId - 剛被刪除的單位 id
 */
function cqAbortIfDefenderRemoved(unitId) {
    if (typeof myRole !== 'undefined' && myRole !== 'st') return;
    if (!unitId) return;

    // 等候區：攻擊方或目標是這個單位的都清掉（結算了也沒有意義）
    const pRef = cqPendingRef();
    if (pRef) {
        cqPendingList
            .filter(p => (p.target && p.target.id === unitId)
                || (p.attacker && p.attacker.unitId === unitId))
            .forEach(p => pRef.child(p.key).remove());
    }

    // 作用中槽位：只有還沒跑完的結算需要中止
    const cur = combatQueueLast;
    if (!cur || !cur.status || cur.status === 'idle') return;
    const involved = (cur.target && cur.target.id === unitId)
        || (cur.attacker && cur.attacker.unitId === unitId);
    if (!involved) return;

    if (typeof showToast === 'function') {
        showToast('⚠️ 該單位正參與結算中，已自動中止這筆結算（等候區將自動接續）');
    }
    cqForceReset();
}

/**
 * ST 端：把等候區中的某一筆取消掉（該玩家的攻擊不會被結算）。
 * @param {string} key - 等候區項目的 push 鍵
 */
function cqCancelPending(key) {
    if (typeof myRole !== 'undefined' && myRole !== 'st') return;
    const pRef = cqPendingRef();
    if (!pRef || !key) return;
    pRef.child(key).remove();
    if (typeof showToast === 'function') showToast('已取消等候區中的該筆攻擊');
}

/**
 * ST 端：代玩家送出防禦 QTE（玩家離線／離開座位時接管）。
 *
 * 防禦值預設帶入該單位角色卡上填寫的防禦 DP／附加成功，ST 可自行覆寫。
 * 僅在目前狀態確實是 pending_defense 時才寫入，避免蓋掉已經往下跑的結算。
 * @param {number} dp - 防禦擲骰 DP
 * @param {number} auto - 防禦附加成功
 */
function cqSTSubmitDefenseFor(dp, auto) {
    if (typeof myRole !== 'undefined' && myRole !== 'st') return;
    const ref = cqRef();
    if (!ref) return;
    ref.once('value').then(snap => {
        const cur = snap.val();
        if (!cur || cur.status !== 'pending_defense') {
            if (typeof showToast === 'function') showToast('目前沒有等待防禦的攻擊');
            return;
        }
        ref.update({
            status: 'calculating',
            defense: { dp: Math.max(0, parseInt(dp, 10) || 0), auto: Math.max(0, parseInt(auto, 10) || 0) },
            // 標記為 ST 代填，供審核明細與廣播標示（避免事後看不出這筆防禦不是玩家自己填的）
            defenseByST: true
        });
        if (typeof showToast === 'function') showToast('已由 ST 代填防禦，結算繼續進行');
    }).catch(err => console.error('cqSTSubmitDefenseFor failed:', err));
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

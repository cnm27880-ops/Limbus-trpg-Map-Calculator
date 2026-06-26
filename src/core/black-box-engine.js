/**
 * Limbus Command - 黑箱引擎
 * 注意：此檔案邏輯僅限 myRole === 'st' 的客戶端執行，玩家端僅接收結果廣播。
 */

/**
 * 安全取得一個數值：非 function/缺值/算出 NaN 時都回退為 0，避免任何單一壞資料把整個總和污染成 NaN。
 * @param {*} value
 * @returns {number}
 */
function bbSafeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * 加總某單位身上所有「具備 calcMod 數值定義」的狀態效果，回傳對攻擊/防禦判定的修正值，
 * 並分別附帶「實際影響攻擊 DP」與「實際影響防禦 DP」的標籤（供 debugStr 顯示）。
 * 只有 status-config.js 中明確標註 calcMod 的狀態（如暈眩/麻痺/凍結）會被計入，
 * 其餘狀態仍維持純顯示用，避免對未定義數值規則的效果做出武斷假設。
 * 注意：atkLabels／defLabels 分開記錄，是為了避免「此單位身上某狀態只影響攻擊 DP，
 * 卻在它作為防禦方時也被列進防禦計算說明」這類顯示與實際計算不一致的問題——
 * 呼叫端應依該單位在本次判定中的角色（攻擊方→用 atkLabels；防禦方→用 defLabels）取用。
 * calcMod 的數值定義可能缺漏、或未來改為函式（modifiers.attackDP(unit) 形式），
 * 因此一律透過 bbSafeNumber 取值，並支援 calcMod 為 function 的情況。
 * @param {object} unit - state.units 中的單位（依 unit.status 以中文狀態名稱為鍵）
 * @returns {{ atkDp: number, defMod: number, atkLabels: string[], defLabels: string[] }}
 */
function bbSumStatusCalcMods(unit) {
    const mods = { atkDp: 0, defMod: 0, atkLabels: [], defLabels: [] };
    if (!unit || !unit.status || typeof STATUS_LIBRARY === 'undefined') return mods;
    for (const category of Object.values(STATUS_LIBRARY)) {
        for (const def of category) {
            if (!def || !def.calcMod) continue;
            const stacks = parseInt(unit.status[def.name]) || 0;
            if (!stacks) continue;

            // calcMod 可能是純數值物件，也可能是回傳 { atkDp, defMod } 的函式；兩者都安全處理
            const raw = (typeof def.calcMod === 'function') ? (def.calcMod(unit, stacks) || {}) : def.calcMod;
            const atkPer = bbSafeNumber(raw.atkDp);
            const defPer = bbSafeNumber(raw.defMod);
            if (!atkPer && !defPer) continue;

            const atkDelta = atkPer * stacks;
            const defDelta = defPer * stacks;
            mods.atkDp += atkDelta;
            mods.defMod += defDelta;
            if (atkDelta) mods.atkLabels.push(`${def.name}(${atkDelta > 0 ? '+' : ''}${atkDelta})`);
            if (defDelta) mods.defLabels.push(`${def.name}(${defDelta > 0 ? '+' : ''}${defDelta})`);
        }
    }
    mods.atkDp = bbSafeNumber(mods.atkDp);
    mods.defMod = bbSafeNumber(mods.defMod);
    return mods;
}

/**
 * 隊列進入 calculating 狀態時，由 ST 端自動執行基礎運算。
 *
 * 注意：「攻擊判定 DP」與「附加成功」是兩種不同的東西，全程分開計算與顯示，絕不相加成單一數字：
 *   - DP 桶：攻擊方總攻擊 DP + 人格卡 DP 加值 + 對抗加成 + 雙方狀態 calcMod（暈眩/麻痺/凍結等）－防禦方總防禦 DP
 *     → 得出「骰數」(baseDice)，即實際要投擲的骰子數。
 *   - 附加成功桶：攻擊方附加成功 + 人格卡額外成功 － 防禦方附加成功
 *     → 得出「附加成功」(baseExtraSuccess)，為直接算成功、不參與投骰的固定成功數。
 * 若攻擊方勾選「無視防禦」，依宣告點數直接扣減防禦方 DP（不影響附加成功）。
 * 全程以 bbSafeNumber 過濾任何 undefined/NaN 來源，避免單一壞資料污染整體計算；
 * 並組合 debugStr 隨 baseDice / baseExtraSuccess 一起送進 ST 審核面板，讓計算過程透明可核對。
 */
function bbRunBlackBoxCalculation(data) {
    const attacker = data.attacker || {};

    // ===== DP 桶（攻擊判定）=====
    const atkDpDeclared = bbSafeNumber(attacker.dp);
    const atkIdentityDp = bbSafeNumber(attacker.identityDpBonus);
    const atkCounterDp = bbSafeNumber(attacker.counterPhaseDpBonus);
    // 破甲/高速/破魔：簡化為直接等效 DP，併入攻擊 DP 桶
    const atkArmorPierce = bbSafeNumber(attacker.armorPierce);
    const atkHastePierce = bbSafeNumber(attacker.hastePierce);
    const atkMagicPierce = bbSafeNumber(attacker.magicPierce);
    let atkDpTotal = atkDpDeclared + atkIdentityDp + atkCounterDp + atkArmorPierce + atkHastePierce + atkMagicPierce;

    // 明細分項：把「宣告 DP」與「人格引擎加成」「未對抗加成」「破甲/高速/破魔」拆開列出，
    // 讓 ST 在審核明細中看得到人格引擎實際貢獻多少，而非只看到一個合併後的數字。
    const atkBaseParts = [`宣告${atkDpDeclared}`];
    if (atkIdentityDp) atkBaseParts.push(`人格${atkIdentityDp >= 0 ? '+' : ''}${atkIdentityDp}`);
    if (atkCounterDp) atkBaseParts.push(`未對抗+${atkCounterDp}`);
    if (atkArmorPierce) atkBaseParts.push(`破甲+${atkArmorPierce}`);
    if (atkHastePierce) atkBaseParts.push(`高速+${atkHastePierce}`);
    if (atkMagicPierce) atkBaseParts.push(`破魔+${atkMagicPierce}`);
    const atkDpBaseLabel = atkBaseParts.join('+');

    const attackerUnit = (typeof findUnitById === 'function' && attacker.unitId) ? findUnitById(attacker.unitId) : null;
    const targetUnit = typeof findUnitById === 'function' ? findUnitById(data.target && data.target.id) : null;

    // 攻擊方身上的狀態（如暈眩/麻痺）扣減攻擊判定 DP
    const attackerMods = bbSumStatusCalcMods(attackerUnit);
    atkDpTotal = bbSafeNumber(atkDpTotal + attackerMods.atkDp);

    let defDpTotal = 0;
    let defDpBaseLabel = '0';
    if (data.defense) {
        defDpTotal = bbSafeNumber(data.defense.dp);
        defDpBaseLabel = `${defDpTotal}`;
    } else {
        // 玩家發起攻擊（無防禦 QTE，目標為 BOSS/敵方單位）：採用單位的基礎防禦 DP
        defDpTotal = targetUnit ? bbSafeNumber(targetUnit.defDp) : 0;
        defDpBaseLabel = `${defDpTotal}`;
    }

    // 目標身上的狀態（如麻痺/凍結）扣減防禦判定 DP。
    // 注意：bbSumStatusCalcMods 內部對每一筆狀態是「累加（+=）」而非「覆蓋（=）」，
    // 故多筆減益（如 -134、-3、-3）會正確相加，而不會只剩最後一筆。
    const targetMods = bbSumStatusCalcMods(targetUnit);

    // 防禦最終值＝基礎防禦 DP ＋ 全部狀態修正，並加上下限保護（扣到 0 為止，不可為負）。
    let finalDefense = Math.max(0, bbSafeNumber(defDpTotal + targetMods.defMod));

    // 無視防禦點數：直接扣減防禦方 DP（不會低於 0，且不影響附加成功）
    const ignoreDef = Math.max(0, bbSafeNumber(attacker.ignoreDef));
    if (ignoreDef > 0) finalDefense = Math.max(0, finalDefense - ignoreDef);

    const baseDice = Math.max(0, bbSafeNumber(atkDpTotal - finalDefense));

    // ===== 附加成功桶（與 DP 完全分開計算）=====
    const atkAutoDeclared = bbSafeNumber(attacker.auto);
    const atkIdentityExtra = bbSafeNumber(attacker.identityExtraSuccess);
    const atkExtraTotal = atkAutoDeclared + atkIdentityExtra;

    // BOSS 防禦附加成功（無防禦 QTE 時）是回合刷新資源，非每次攻擊都全額重新提供：
    // defAutoRemaining 由 nextTurn() 在輪到 BOSS 主體行動時重置為 defAuto，
    // 每次被攻擊只消耗「實際被攻擊方附加成功抵銷掉」的量，未用完的部分留到本回合下一次攻擊。
    let defExtraTotal;
    if (data.defense) {
        defExtraTotal = bbSafeNumber(data.defense.auto);
    } else if (targetUnit) {
        if (typeof targetUnit.defAutoRemaining !== 'number') targetUnit.defAutoRemaining = bbSafeNumber(targetUnit.defAuto);
        defExtraTotal = Math.max(0, bbSafeNumber(targetUnit.defAutoRemaining));
    } else {
        defExtraTotal = 0;
    }
    const baseExtraSuccess = Math.max(0, bbSafeNumber(atkExtraTotal - defExtraTotal));

    // 消耗防禦資源池：扣除「實際被用掉抵銷攻擊附加成功」的量，剩餘留到本回合下次攻擊；
    // 防禦方走 QTE（data.defense 存在）時不涉及資源池，跳過。
    if (!data.defense && targetUnit) {
        const consumed = Math.min(defExtraTotal, atkExtraTotal);
        targetUnit.defAutoRemaining = defExtraTotal - consumed;
        if (typeof syncUnitStatus === 'function') syncUnitStatus(targetUnit.id);
    }

    // 攻擊方只取會影響「攻擊 DP」的標籤；防禦方只取會影響「防禦 DP」的標籤——
    // 避免列出不影響本次計算的負面狀態（例如只扣攻擊 DP 的暈眩出現在目標的防禦計算說明中）。
    const atkLabels = [atkDpBaseLabel, ...attackerMods.atkLabels].filter(Boolean);
    const defLabels = [defDpBaseLabel, ...targetMods.defLabels].filter(Boolean);
    const ignoreLabel = ignoreDef > 0 ? `,無視防禦(-${ignoreDef})` : '';
    // 附加成功同樣分項列出人格引擎貢獻
    const atkExtraLabel = atkIdentityExtra ? `宣告${atkAutoDeclared}+人格+${atkIdentityExtra}` : `${atkAutoDeclared}`;
    let diceStr = `骰數: ${baseDice}`;
    if (baseDice <= 0) diceStr = `骰數: 0 (防禦大於攻擊，請投擲機運骰)`;

    const debugStr = `【攻擊判定】攻: ${atkLabels.join('+')} = ${atkDpTotal} | 防: ${defLabels.join('+')}${ignoreLabel} = ${finalDefense} ➡️ ${diceStr}\n`
        + `【附加成功】攻: ${atkExtraLabel} = ${atkExtraTotal} | 防: ${defExtraTotal} ➡️ 附加成功: ${baseExtraSuccess}`;

    cqEnterSTReview(baseDice, baseExtraSuccess, debugStr);
}

/**
 * 戰鬥日誌（系統 A）：於全場廣播時，由 ST 端把這一筆攻擊結果寫入
 * Firebase /rooms/{roomId}/combatLogs，供「戰鬥日誌 / 構築室」分頁渲染。
 * 採單一寫入者（ST）避免重複，並維持最多 100 筆（FIFO）。
 * 本函式為附屬功能，全程 try-catch，任何失敗都不可影響戰鬥主流程。
 * @param {object} entry - { attackerName, defenderName, finalDice, attackerRole: 'player'|'enemy', broadcastText }
 */
function bbPushCombatLog(entry) {
    try {
        if (typeof roomRef === 'undefined' || !roomRef) return;
        if (typeof myRole !== 'undefined' && myRole !== 'st') return;
        if (!entry || typeof entry !== 'object') return;

        const ref = roomRef.child('combatLogs');
        const ts = (typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue)
            ? firebase.database.ServerValue.TIMESTAMP : Date.now();
        ref.push({
            timestamp: ts,
            attackerName: String(entry.attackerName || '未知攻擊者').slice(0, 60),
            defenderName: String(entry.defenderName || '').slice(0, 60),
            finalDice: Number(entry.finalDice) || 0,
            attackerRole: (entry.attackerRole === 'player') ? 'player' : 'enemy',
            broadcastText: String(entry.broadcastText || '').slice(0, 300)
        });

        // FIFO：以 .once 讀取（非監聽，不會造成無限迴圈），超過 100 筆時移除最舊者。
        // push 鍵本身依時間遞增排序，明確 sort() 以確保移除的是最舊的鍵，與物件列舉順序無關。
        ref.once('value').then(snap => {
            const val = snap.val();
            if (!val) return;
            const keys = Object.keys(val).sort();
            if (keys.length > 100) {
                keys.slice(0, keys.length - 100).forEach(k => ref.child(k).remove());
            }
        }).catch(() => {});
    } catch (e) {
        /* 日誌寫入失敗不影響戰鬥 */
    }
}

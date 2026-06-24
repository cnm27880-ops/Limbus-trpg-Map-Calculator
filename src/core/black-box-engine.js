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
 * 並附帶每一筆套用的標籤（供 debugStr 顯示）。
 * 只有 status-config.js 中明確標註 calcMod 的狀態（如暈眩/麻痺/凍結）會被計入，
 * 其餘狀態仍維持純顯示用，避免對未定義數值規則的效果做出武斷假設。
 * calcMod 的數值定義可能缺漏、或未來改為函式（modifiers.attackDP(unit) 形式），
 * 因此一律透過 bbSafeNumber 取值，並支援 calcMod 為 function 的情況。
 * @param {object} unit - state.units 中的單位（依 unit.status 以中文狀態名稱為鍵）
 * @returns {{ atkDp: number, defMod: number, labels: string[] }}
 */
function bbSumStatusCalcMods(unit) {
    const mods = { atkDp: 0, defMod: 0, labels: [] };
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
            if (atkDelta) mods.labels.push(`${def.name}(${atkDelta > 0 ? '+' : ''}${atkDelta})`);
            if (defDelta) mods.labels.push(`${def.name}(${defDelta > 0 ? '+' : ''}${defDelta})`);
        }
    }
    mods.atkDp = bbSafeNumber(mods.atkDp);
    mods.defMod = bbSafeNumber(mods.defMod);
    return mods;
}

/**
 * 隊列進入 calculating 狀態時，由 ST 端自動執行基礎運算。
 * 攻擊方宣告值（DP + 附加成功 + 人格卡加值）與防禦方宣告值（DP + 附加成功）相減，得出 base_dice。
 * 攻擊方/防禦方身上的狀態效果（如暈眩/麻痺/凍結）會自動套用其 calcMod 修正。
 * 若攻擊方勾選「無視防禦」，依宣告點數直接扣減防禦總值。
 * 全程以 bbSafeNumber 過濾任何 undefined/NaN 來源，避免單一壞資料把骰數歸零；
 * 並組合 debugStr 隨 baseDice 一起送進 ST 審核面板，讓計算過程透明可核對。
 */
function bbRunBlackBoxCalculation(data) {
    const attacker = data.attacker || {};
    const atkParts = [
        bbSafeNumber(attacker.dp),
        bbSafeNumber(attacker.auto),
        bbSafeNumber(attacker.identityDpBonus),
        bbSafeNumber(attacker.identityExtraSuccess),
        bbSafeNumber(attacker.counterPhaseDpBonus)
    ];
    let atkTotal = atkParts.reduce((a, b) => a + b, 0);
    const atkBaseLabel = `${atkTotal}`;

    const attackerUnit = (typeof findUnitById === 'function' && attacker.unitId) ? findUnitById(attacker.unitId) : null;
    const targetUnit = typeof findUnitById === 'function' ? findUnitById(data.target && data.target.id) : null;

    // 攻擊方身上的狀態（如暈眩/麻痺）扣減攻擊判定
    const attackerMods = bbSumStatusCalcMods(attackerUnit);
    atkTotal = Math.max(0, bbSafeNumber(atkTotal + attackerMods.atkDp));

    let defTotal = 0;
    let defBaseLabel = '0';
    if (data.defense) {
        defTotal = bbSafeNumber(data.defense.dp) + bbSafeNumber(data.defense.auto);
        defBaseLabel = `${defTotal}`;
    } else {
        // 玩家發起攻擊（無防禦 QTE，目標為 BOSS/敵方單位）：採用單位的基礎防禦／防禦附加成功
        defTotal = targetUnit ? (bbSafeNumber(targetUnit.defDp) + bbSafeNumber(targetUnit.defAuto)) : 0;
        defBaseLabel = `${defTotal}`;
    }

    // 目標身上的狀態（如麻痺/凍結）扣減防禦判定
    const targetMods = bbSumStatusCalcMods(targetUnit);
    defTotal = Math.max(0, bbSafeNumber(defTotal + targetMods.defMod));

    // 無視防禦點數：直接扣減防禦總值（不會低於 0）
    const ignoreDef = Math.max(0, bbSafeNumber(attacker.ignoreDef));
    if (ignoreDef > 0) defTotal = Math.max(0, defTotal - ignoreDef);

    const baseDice = Math.max(0, bbSafeNumber(atkTotal - defTotal));

    const atkLabels = [atkBaseLabel, ...attackerMods.labels].filter(Boolean);
    const defLabels = [defBaseLabel, ...targetMods.labels].filter(Boolean);
    const ignoreLabel = ignoreDef > 0 ? `,無視防禦(-${ignoreDef})` : '';
    const debugStr = `攻: ${atkLabels.join('+')} = ${atkTotal} | 防: ${defLabels.join('+')}${ignoreLabel} = ${defTotal} ➡️ 最終骰數: ${baseDice}`;

    cqEnterSTReview(baseDice, debugStr);
}

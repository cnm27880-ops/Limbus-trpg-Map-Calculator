/**
 * Limbus Command - 黑箱引擎
 * 注意：此檔案邏輯僅限 myRole === 'st' 的客戶端執行，玩家端僅接收結果廣播。
 */

/**
 * 加總某單位身上所有「具備 calcMod 數值定義」的狀態效果，回傳對攻擊/防禦判定的修正值。
 * 只有 status-config.js 中明確標註 calcMod 的狀態（如暈眩/麻痺/凍結）會被計入，
 * 其餘狀態仍維持純顯示用，避免對未定義數值規則的效果做出武斷假設。
 * @param {object} unit - state.units 中的單位（依 unit.status 以中文狀態名稱為鍵）
 * @returns {{ atkDp: number, defMod: number }}
 */
function bbSumStatusCalcMods(unit) {
    const mods = { atkDp: 0, defMod: 0 };
    if (!unit || !unit.status || typeof STATUS_LIBRARY === 'undefined') return mods;
    for (const category of Object.values(STATUS_LIBRARY)) {
        for (const def of category) {
            if (!def.calcMod) continue;
            const stacks = parseInt(unit.status[def.name]) || 0;
            if (!stacks) continue;
            mods.atkDp += (def.calcMod.atkDp || 0) * stacks;
            mods.defMod += (def.calcMod.defMod || 0) * stacks;
        }
    }
    return mods;
}

/**
 * 隊列進入 calculating 狀態時，由 ST 端自動執行基礎運算。
 * 攻擊方宣告值（DP + 附加成功 + 人格卡加值）與防禦方宣告值（DP + 附加成功）相減，得出 base_dice。
 * 攻擊方/防禦方身上的狀態效果（如暈眩/麻痺/凍結）會自動套用其 calcMod 修正。
 * 若攻擊方勾選「無視防禦」，依宣告點數直接扣減防禦總值。
 */
function bbRunBlackBoxCalculation(data) {
    const attacker = data.attacker || {};
    let atkTotal = (Number(attacker.dp) || 0) + (Number(attacker.auto) || 0)
        + (Number(attacker.identityDpBonus) || 0) + (Number(attacker.identityExtraSuccess) || 0);

    const attackerUnit = (typeof findUnitById === 'function' && attacker.unitId) ? findUnitById(attacker.unitId) : null;
    const targetUnit = typeof findUnitById === 'function' ? findUnitById(data.target && data.target.id) : null;

    // 攻擊方身上的狀態（如暈眩/麻痺）扣減攻擊判定
    const attackerMods = bbSumStatusCalcMods(attackerUnit);
    atkTotal = Math.max(0, atkTotal + attackerMods.atkDp);

    // 攻擊方若為 BOSS/敵方單位，套用其 BOSS 戰鬥數值（攻擊 DP 修正）
    if (attackerUnit) atkTotal = Math.max(0, atkTotal + (Number(attackerUnit.bossAtkMod) || 0));

    let defTotal = 0;
    if (data.defense) {
        defTotal = (Number(data.defense.dp) || 0) + (Number(data.defense.auto) || 0);
    } else {
        // 玩家發起攻擊（無防禦 QTE）：嘗試從目標單位資料抓取基礎防禦
        defTotal = (targetUnit && Number(targetUnit.defDp)) || 0;
    }

    // 目標身上的狀態（如麻痺/凍結）扣減防禦判定
    const targetMods = bbSumStatusCalcMods(targetUnit);
    defTotal = Math.max(0, defTotal + targetMods.defMod);

    // 目標若為 BOSS/敵方單位，套用其 BOSS 戰鬥數值（防禦修正）
    if (targetUnit) defTotal = Math.max(0, defTotal + (Number(targetUnit.bossDefMod) || 0));

    // 無視防禦點數：直接扣減防禦總值（不會低於 0）
    const ignoreDef = Math.max(0, Number(attacker.ignoreDef) || 0);
    defTotal = Math.max(0, defTotal - ignoreDef);

    const baseDice = Math.max(0, atkTotal - defTotal);
    cqEnterSTReview(baseDice);
}

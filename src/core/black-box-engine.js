/**
 * Limbus Command - 黑箱引擎
 * 注意：此檔案邏輯僅限 myRole === 'st' 的客戶端執行，玩家端僅接收結果廣播。
 */

/**
 * 隊列進入 calculating 狀態時，由 ST 端自動執行基礎運算。
 * 攻擊方宣告值（DP + 附加成功）與防禦方宣告值（DP + 附加成功）相減，得出 base_dice。
 * 若攻擊方勾選「無視防禦」，防禦總 DP 視為 0。
 */
function bbRunBlackBoxCalculation(data) {
    const attacker = data.attacker || {};
    const atkTotal = (Number(attacker.dp) || 0) + (Number(attacker.auto) || 0);

    let defTotal = 0;
    if (!attacker.ignoreDefense) {
        if (data.defense) {
            defTotal = (Number(data.defense.dp) || 0) + (Number(data.defense.auto) || 0);
        } else {
            // 玩家發起攻擊（無防禦 QTE）：嘗試從目標單位資料抓取基礎防禦
            const targetUnit = typeof findUnitById === 'function' ? findUnitById(data.target && data.target.id) : null;
            defTotal = (targetUnit && Number(targetUnit.defDp)) || 0;
        }
    }

    const baseDice = Math.max(0, atkTotal - defTotal);
    cqEnterSTReview(baseDice);
}

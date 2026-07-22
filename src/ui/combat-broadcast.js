/**
 * Limbus Command - 全場戰鬥廣播
 * 隱藏所有防禦與破甲的計算過程，僅向全場展示最終攻擊骰數。
 */

let combatBroadcastTimer = null;
let combatBroadcastResetTimer = null;

/**
 * combat-queue.js 在 broadcasting 狀態時呼叫，所有客戶端皆會收到。
 */
function cqOnBroadcasting(data) {
    const banner = document.getElementById('combat-broadcast-banner');
    if (!banner) return;

    const attackerName = String((data.attacker && data.attacker.name) || '未知攻擊者');
    const finalDice = Number(data.finalDice) || 0;
    const finalExtraSuccess = Number(data.finalExtraSuccess) || 0;

    banner.textContent = '';
    const roll = data.rollResult || null;

    if (finalDice <= 0) {
        banner.appendChild(document.createTextNode(`【${attackerName}】發起攻擊！👉 🎲 骰數歸零！請投擲機運骰！`));
        if (finalExtraSuccess > 0) {
            banner.appendChild(document.createTextNode(' 附加成功 '));
            const extraSpan = document.createElement('span');
            extraSpan.className = 'combat-broadcast-dice';
            extraSpan.textContent = String(finalExtraSuccess);
            banner.appendChild(extraSpan);
        }
    } else if (roll) {
        // 自動擲骰：直接公佈擲骰結果與最終傷害（含 10 的數量，供人格卡觸發判定）
        const targetName = String((data.target && data.target.name) || '目標');
        const explodeNote = '';
        const tensNote = (Number(roll.tens) || 0) > 0 ? `，🔟×${roll.tens}` : '';
        let text = `【${attackerName}】攻擊【${targetName}】！🎲 擲 ${roll.totalRolled || finalDice} 顆${explodeNote}${tensNote} → 成功 ${roll.successes}`;
        if (roll.extraSuccess > 0) text += ` ＋ 附加 ${roll.extraSuccess}`;
        if (roll.statusBonus > 0) text += ` ＋ ${roll.statusBonusText}`;
        if (roll.strengthBonus > 0) text += ` ＋ 強壯${roll.strengthBonus}`;
        if (roll.capApplied) text += ` ＝ ${roll.totalBeforeCap}，上限 ${roll.cap}`;
        if (roll.enduranceReduction > 0) text += ` － 不屈${roll.enduranceReduction}`;
        banner.appendChild(document.createTextNode(text + ' ➡️ 總傷害 '));
        const dmgSpan = document.createElement('span');
        dmgSpan.className = 'combat-broadcast-dice';
        dmgSpan.textContent = String(roll.damage);
        banner.appendChild(dmgSpan);
        banner.appendChild(document.createTextNode(' 點（已自動套用）'));
    } else {
        banner.appendChild(document.createTextNode(`【${attackerName}】發起攻擊！👉 請投擲 `));
        const diceSpan = document.createElement('span');
        diceSpan.className = 'combat-broadcast-dice';
        diceSpan.textContent = String(finalDice);
        banner.appendChild(diceSpan);
        // 骰數與附加成功是兩種不同的東西，分開顯示，絕不相加成單一數字
        if (finalExtraSuccess > 0) {
            banner.appendChild(document.createTextNode(' 顆攻擊骰，並有 '));
            const extraSpan = document.createElement('span');
            extraSpan.className = 'combat-broadcast-dice';
            extraSpan.textContent = String(finalExtraSuccess);
            banner.appendChild(extraSpan);
            banner.appendChild(document.createTextNode(' 個附加成功！'));
        } else {
            banner.appendChild(document.createTextNode(' 顆攻擊骰！'));
        }
    }

    clearTimeout(combatBroadcastTimer);
    banner.classList.add('show');
    combatBroadcastTimer = setTimeout(() => banner.classList.remove('show'), 4500);

    // 戰鬥日誌（系統 A）：把這次廣播寫入 combatLogs（ST 端單一寫入，函式內已防呆）
    if (typeof bbPushCombatLog === 'function') {
        const defenderName = String((data.target && data.target.name) || '');
        // 以攻擊發起時記下的 attackerRole 區分玩家／ST 操作怪物，而非用 id 前綴猜測
        // （ST 發起威脅時 attacker.id 仍是 ST 自己的 myPlayerId，用前綴判斷會誤判為玩家攻擊）。
        const attackerRole = (data.attacker && data.attacker.attackerRole === 'player') ? 'player' : 'enemy';

        // ===== 回合分析欄位（bbPushCombatLog 僅 ST 端會實際寫入）=====
        const atk = data.attacker || {};
        // 攻擊方總 DP（宣告＋人格卡＋未對抗加成＋穿透等效 DP），口徑與黑箱攻擊桶一致
        const atkDp = (Number(atk.dp) || 0) + (Number(atk.identityDpBonus) || 0)
            + (Number(atk.counterPhaseDpBonus) || 0) + (Number(atk.armorPierce) || 0)
            + (Number(atk.hastePierce) || 0) + (Number(atk.magicPierce) || 0);
        // 防禦方數值：威脅路徑取玩家防禦 QTE 填報值；玩家攻擊路徑取目標單位的基礎防禦
        const targetUnit = (typeof findUnitById === 'function' && data.target) ? findUnitById(data.target.id) : null;
        const defDp = data.defense ? (Number(data.defense.dp) || 0) : (targetUnit ? (Number(targetUnit.defDp) || 0) : 0);
        const defAuto = data.defense ? (Number(data.defense.auto) || 0) : (targetUnit ? (Number(targetUnit.defAuto) || 0) : 0);
        // 結算當下防禦方身上的負面狀態摘要（觀察 BOSS 被玩家疊 debuff 的速度）
        let targetDebuffs = '', targetDebuffTotal = 0;
        if (targetUnit && targetUnit.status && typeof isDebuffStatus === 'function' && typeof getStatusByName === 'function') {
            const parts = [];
            for (const [name, raw] of Object.entries(targetUnit.status)) {
                const def = getStatusByName(name);
                if (!def || !isDebuffStatus(def.id)) continue;
                const stacks = parseInt(raw) || 0;
                if (stacks <= 0) continue;
                parts.push(`${name}x${stacks}`);
                targetDebuffTotal += stacks;
            }
            targetDebuffs = parts.join('、');
        }

        bbPushCombatLog({
            attackerName: attackerName,
            defenderName: defenderName,
            finalDice: finalDice,
            attackerRole: attackerRole,
            broadcastText: banner.textContent || '',
            entryType: 'attack',
            round: (typeof state !== 'undefined' && state.roundNum) || 0,
            extraSuccess: finalExtraSuccess,
            atkDp: atkDp,
            defDp: defDp,
            defAuto: defAuto,
            targetDebuffs: targetDebuffs,
            targetDebuffTotal: targetDebuffTotal,
            // 自動擲骰結果（手動擲骰時為 0，分析端視為無傷害資料）
            damage: roll ? (Number(roll.damage) || 0) : 0,
            rollSuccesses: roll ? (Number(roll.successes) || 0) : 0,
            rollExploded: roll ? (Number(roll.exploded) || 0) : 0,
            rollTens: roll ? (Number(roll.tens) || 0) : 0,
            // 各骰點數明細：供玩家核對「骰到 N 個 10 觸發」類人格卡
            rollDetail: (roll && Array.isArray(roll.rolls)) ? roll.rolls.join(',') : ''
        });
    }

    // 廣播結束後 5 秒，ST 端自動重置隊列為 idle
    if (myRole === 'st') {
        clearTimeout(combatBroadcastResetTimer);
        combatBroadcastResetTimer = setTimeout(() => {
            if (typeof cqReset === 'function') cqReset();
        }, 5000);
    }
}

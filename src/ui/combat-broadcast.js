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

    if (finalDice <= 0) {
        banner.appendChild(document.createTextNode(`【${attackerName}】發起攻擊！👉 🎲 骰數歸零！請投擲機運骰！`));
        if (finalExtraSuccess > 0) {
            banner.appendChild(document.createTextNode(' 附加成功 '));
            const extraSpan = document.createElement('span');
            extraSpan.className = 'combat-broadcast-dice';
            extraSpan.textContent = String(finalExtraSuccess);
            banner.appendChild(extraSpan);
        }
    } else {
        banner.appendChild(document.createTextNode(`【${attackerName}】發起攻擊！碰撞產生優勢！👉 請投擲 `));
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
        bbPushCombatLog({
            attackerName: attackerName,
            defenderName: defenderName,
            finalDice: finalDice,
            attackerRole: attackerRole,
            broadcastText: banner.textContent || ''
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

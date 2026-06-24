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

    const attackerName = (data.attacker && data.attacker.name) || '未知攻擊者';
    const finalDice = data.finalDice ?? 0;

    banner.innerHTML = `【${escapeHtml(attackerName)}】發起攻擊！碰撞產生優勢！👉 請投擲 <span class="combat-broadcast-dice">${finalDice}</span> 顆攻擊骰！`;

    clearTimeout(combatBroadcastTimer);
    banner.classList.add('show');
    combatBroadcastTimer = setTimeout(() => banner.classList.remove('show'), 4500);

    // 廣播結束後 5 秒，ST 端自動重置隊列為 idle
    if (myRole === 'st') {
        clearTimeout(combatBroadcastResetTimer);
        combatBroadcastResetTimer = setTimeout(() => {
            if (typeof cqReset === 'function') cqReset();
        }, 5000);
    }
}

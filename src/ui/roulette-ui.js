/**
 * Limbus Command - 幸運大轉盤 UI 控制器
 *
 * 負責：
 *   - 依 ROULETTE_PRIZES 動態生成轉盤（conic-gradient + 文字標籤）
 *   - 抽取按鈕的權限判斷與旋轉動畫
 *   - 動畫結束後結算（state.addPrizeToPlayer / state.broadcastRouletteResult）
 *   - 全螢幕中獎廣播遮罩
 */

// ===== 模組狀態 =====
let rouletteSpinning = false;       // 是否正在旋轉中
let rouletteCurrentRotation = 0;    // 累積旋轉角度（確保每次都向前轉）
let rouletteWheelBuilt = false;     // 轉盤切片是否已生成
let rouletteBroadcastTimer = null;  // 廣播自動關閉計時器
let lastRouletteBroadcastKey = null;// 已處理過的廣播事件 key（去重）
const rouletteSessionStart = Date.now(); // 用於忽略進房前的舊廣播事件

// ===== 轉盤生成 =====

/**
 * 依 ROULETTE_PRIZES 生成轉盤背景 (conic-gradient) 與文字標籤
 */
function buildRouletteWheel() {
    const wheel = document.getElementById('roulette-wheel');
    if (!wheel || typeof ROULETTE_PRIZES === 'undefined') return;

    const n = ROULETTE_PRIZES.length;        // 20
    const sliceDeg = 360 / n;                 // 18 度

    // conic-gradient：每個獎品一段 18 度（從頂端 0deg 順時針）
    const stops = ROULETTE_PRIZES.map((p, i) =>
        `${p.color} ${i * sliceDeg}deg ${(i + 1) * sliceDeg}deg`
    ).join(', ');
    wheel.style.background = `conic-gradient(from 0deg, ${stops})`;

    // 移除舊標籤後重建
    wheel.querySelectorAll('.roulette-slice-label').forEach(el => el.remove());

    const size = wheel.offsetWidth || 300;
    const radius = size * 0.30; // 文字距圓心的距離

    ROULETTE_PRIZES.forEach((p, i) => {
        const label = document.createElement('div');
        label.className = 'roulette-slice-label';
        // 切片中心角度（自頂端順時針）
        const angle = i * sliceDeg + sliceDeg / 2;
        // 以圓心為原點，旋轉後往外平移；文字保持沿半徑方向
        label.style.transform =
            `rotate(${angle}deg) translateY(-${radius}px) rotate(90deg)`;
        // 名稱過長時截斷，避免溢出切片
        const short = p.name.length > 6 ? p.name.slice(0, 6) + '…' : p.name;
        label.textContent = short;
        label.title = p.name;
        wheel.appendChild(label);
    });

    rouletteWheelBuilt = true;
}

// ===== 開關浮動視窗 =====

/**
 * 開啟轉盤浮動視窗
 */
function openRouletteModal() {
    const modal = document.getElementById('roulette-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    // 視窗顯示後才有正確寬度可計算標籤位置
    buildRouletteWheel();
    renderRouletteUI();
}

/**
 * 關閉轉盤浮動視窗
 */
function closeRouletteModal() {
    const modal = document.getElementById('roulette-modal');
    if (modal) modal.classList.add('hidden');
}

// ===== 渲染 =====

/**
 * 更新剩餘次數顯示與抽取按鈕狀態
 */
function renderRouletteUI() {
    const countEl = document.getElementById('roulette-spins-count');
    const btn = document.getElementById('btn-spin-roulette');

    const me = (typeof myPlayerId !== 'undefined' && state.players)
        ? state.players[myPlayerId]
        : null;
    const spins = me ? (parseInt(me.spins) || 0) : 0;

    if (countEl) countEl.textContent = spins;

    if (btn) {
        // 僅玩家本人、有剩餘次數且未在旋轉時可抽
        const canSpin = !!me && spins > 0 && !rouletteSpinning;
        btn.disabled = !canSpin;
        if (!me) {
            btn.textContent = 'ST 無法抽獎';
        } else if (rouletteSpinning) {
            btn.textContent = '旋轉中…';
        } else if (spins <= 0) {
            btn.textContent = '次數不足';
        } else {
            btn.textContent = '抽取';
        }
    }
}

// ===== 抽取邏輯 =====

/**
 * 依權重隨機挑選一個獎品索引
 * @returns {number} 0 ~ (n-1)
 */
function pickWeightedPrizeIndex() {
    const weights = ROULETTE_PRIZES.map(p => (p.weight > 0 ? p.weight : 0));
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) return Math.floor(Math.random() * ROULETTE_PRIZES.length);

    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i;
    }
    return ROULETTE_PRIZES.length - 1;
}

/**
 * 抽取（旋轉轉盤）
 */
function spinRoulette() {
    if (rouletteSpinning) return;

    const me = (typeof myPlayerId !== 'undefined' && state.players)
        ? state.players[myPlayerId]
        : null;
    if (!me) {
        if (typeof showToast === 'function') showToast('只有玩家可以抽獎');
        return;
    }
    if ((parseInt(me.spins) || 0) <= 0) {
        if (typeof showToast === 'function') showToast('沒有剩餘抽獎次數');
        return;
    }

    const wheel = document.getElementById('roulette-wheel');
    if (!wheel) return;
    if (!rouletteWheelBuilt) buildRouletteWheel();

    rouletteSpinning = true;
    renderRouletteUI();

    const resultText = document.getElementById('roulette-result-text');
    if (resultText) resultText.textContent = '';

    // 1) 先決定中獎索引
    const index = pickWeightedPrizeIndex();
    const prize = ROULETTE_PRIZES[index];
    const sliceDeg = 360 / ROULETTE_PRIZES.length;

    // 2) 計算旋轉角度：將切片中心對齊頂端指針，並多轉 5 圈製造減速感
    const sliceCenter = index * sliceDeg + sliceDeg / 2;
    const targetWithinTurn = (360 - sliceCenter) % 360;
    rouletteCurrentRotation =
        rouletteCurrentRotation - (rouletteCurrentRotation % 360)
        + (360 * 5) + targetWithinTurn;

    // 3) 套用 CSS 旋轉（transition 已在 CSS 設定為 5s）
    wheel.classList.add('spinning');
    wheel.style.transform = `rotate(${rouletteCurrentRotation}deg)`;

    // 4) 動畫結束（5 秒）後結算
    setTimeout(() => {
        wheel.classList.remove('spinning');
        rouletteSpinning = false;

        // 加入獎品並扣除 1 次（內含 Firebase 同步）
        if (state && typeof state.addPrizeToPlayer === 'function') {
            state.addPrizeToPlayer(myPlayerId, prize.id);
        }
        // 廣播給全服觸發動畫
        if (state && typeof state.broadcastRouletteResult === 'function') {
            state.broadcastRouletteResult(
                (typeof myName !== 'undefined' ? myName : '玩家'),
                prize.name
            );
        }

        if (resultText) resultText.textContent = `🎉 抽中：${prize.name}`;
        renderRouletteUI();
    }, 5000);
}

// ===== 全螢幕中獎廣播 =====

/**
 * 處理 Firebase events/roulette 的更新（由 setupRoomListeners 呼叫）
 * @param {Object} data - { playerName, prizeName, ts, nonce }
 */
function handleRouletteBroadcast(data) {
    if (!data) return;

    const key = (data.nonce || '') + '|' + (data.ts || '');
    if (key === lastRouletteBroadcastKey) return; // 去重

    // 忽略進房前就已存在的舊事件（避免一進房就跳動畫）
    if (typeof data.ts === 'number' && data.ts < rouletteSessionStart - 5000) {
        lastRouletteBroadcastKey = key;
        return;
    }

    lastRouletteBroadcastKey = key;
    showRouletteBroadcast(data.playerName, data.prizeName);
}

/**
 * 顯示全螢幕中獎遮罩，3 秒後自動關閉
 * @param {string} playerName
 * @param {string} prizeName
 */
function showRouletteBroadcast(playerName, prizeName) {
    const overlay = document.getElementById('roulette-broadcast-overlay');
    if (!overlay) return;

    const playerEl = document.getElementById('roulette-broadcast-player');
    const prizeEl = document.getElementById('roulette-broadcast-prize');
    if (playerEl) playerEl.textContent = (playerName || '某人') + ' 抽中了';
    if (prizeEl) prizeEl.textContent = prizeName || '';

    overlay.classList.remove('hidden');

    // 重新觸發彈出動畫
    const inner = overlay.querySelector('.roulette-broadcast-inner');
    if (inner) {
        inner.style.animation = 'none';
        void inner.offsetWidth; // 強制 reflow
        inner.style.animation = '';
    }

    if (rouletteBroadcastTimer) clearTimeout(rouletteBroadcastTimer);
    rouletteBroadcastTimer = setTimeout(() => {
        overlay.classList.add('hidden');
    }, 3000);
}

console.log('✅ 幸運大轉盤 UI 已載入');

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
let rouletteTestMode = false;       // 測試模式：可試轉，不消耗次數、不發獎、不廣播
const rouletteSessionStart = Date.now(); // 用於忽略進房前的舊廣播事件

// 視覺顯示順序（ROULETTE_PRIZES 原始索引的排列）。
// 以固定亂數種子洗牌，讓相同/相似獎品不再集中排列，但抽獎邏輯仍以
// 原始索引為準——透過 rouletteDisplayOrder 對應到打散後的視覺切片位置。
let rouletteDisplayOrder = [];

// ===== 洗牌（固定種子） =====

/**
 * mulberry32 種子亂數產生器，確保每次載入的洗牌結果一致
 * @param {number} seed
 * @returns {function(): number} 回傳 0~1 之間亂數的函式
 */
function rouletteSeededRandom(seed) {
    let s = seed >>> 0;
    return function () {
        s |= 0;
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * 取得（必要時建立）固定種子洗牌後的視覺顯示順序
 * @returns {number[]} 長度為獎品數量的索引排列
 */
function getRouletteDisplayOrder() {
    const n = (typeof ROULETTE_PRIZES !== 'undefined') ? ROULETTE_PRIZES.length : 0;
    if (rouletteDisplayOrder.length === n && n > 0) return rouletteDisplayOrder;

    const order = Array.from({ length: n }, (_, i) => i);
    const rand = rouletteSeededRandom(0x9E3779B9); // 固定種子 → 固定排列
    // Fisher–Yates 洗牌
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    rouletteDisplayOrder = order;
    return rouletteDisplayOrder;
}

// ===== 轉盤生成 =====

/**
 * 依 ROULETTE_PRIZES 生成轉盤背景 (conic-gradient) 與文字標籤
 */
function buildRouletteWheel() {
    const wheel = document.getElementById('roulette-wheel');
    if (!wheel || typeof ROULETTE_PRIZES === 'undefined') return;

    const n = ROULETTE_PRIZES.length;        // 20
    const sliceDeg = 360 / n;                 // 18 度
    const order = getRouletteDisplayOrder();  // 打散後的視覺顯示順序

    // conic-gradient：每個視覺切片一段 18 度（從頂端 0deg 順時針）
    // pos = 視覺位置；prizeIdx = 對應的原始獎品索引
    const stops = order.map((prizeIdx, pos) => {
        const p = ROULETTE_PRIZES[prizeIdx];
        return `${p.color} ${pos * sliceDeg}deg ${(pos + 1) * sliceDeg}deg`;
    }).join(', ');
    wheel.style.background = `conic-gradient(from 0deg, ${stops})`;

    // 移除舊標籤後重建
    wheel.querySelectorAll('.roulette-slice-spoke').forEach(el => el.remove());

    order.forEach((prizeIdx, pos) => {
        const p = ROULETTE_PRIZES[prizeIdx];
        // 切片中心角度（自頂端順時針）— 依視覺位置 pos 計算
        const angle = pos * sliceDeg + sliceDeg / 2;

        // 外層「輪輻」：填滿整個轉盤，旋轉至切片方向（文字置於頂端 = 半徑外側）
        const spoke = document.createElement('div');
        spoke.className = 'roulette-slice-spoke';
        spoke.style.transform = `rotate(${angle}deg)`;

        // 內層文字：轉盤上只顯示簡稱（shortName），完整名稱保留於 title 與全螢幕廣播
        // 所有切片統一沿半徑由外向內排列：Emoji（首字元）固定在外圈，文字往圓心方向延伸
        const label = document.createElement('div');
        label.className = 'roulette-slice-label';
        label.textContent = p.shortName || p.name;
        label.title = p.name;

        spoke.appendChild(label);
        wheel.appendChild(spoke);
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

    const isST = (typeof myRole !== 'undefined' && myRole === 'st');

    if (btn) {
        if (rouletteTestMode) {
            // 測試模式：任何人皆可試轉
            btn.disabled = rouletteSpinning;
            btn.textContent = rouletteSpinning ? '旋轉中…' : '🧪 測試抽取';
        } else {
            // 正常模式：僅玩家本人、有剩餘次數且未在旋轉時可抽
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

    // ST 專用：在轉盤視窗內直接前往「轉盤管理」發放次數
    const mgBtn = document.getElementById('roulette-st-manage-btn');
    if (mgBtn) mgBtn.style.display = isST ? 'inline-block' : 'none';
}

/**
 * 測試模式切換
 */
function onRouletteTestModeChange() {
    const chk = document.getElementById('roulette-test-mode');
    rouletteTestMode = !!(chk && chk.checked);
    renderRouletteUI();
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

    // 測試模式略過權限與次數檢查
    if (!rouletteTestMode) {
        if (!me) {
            if (typeof showToast === 'function') showToast('只有玩家可以抽獎（ST 可開啟測試模式）');
            return;
        }
        if ((parseInt(me.spins) || 0) <= 0) {
            if (typeof showToast === 'function') showToast('沒有剩餘抽獎次數');
            return;
        }
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

    // 2) 計算旋轉角度：將該獎品「打散後的視覺切片」中心對齊頂端指針，並多轉 5 圈製造減速感
    const visualPos = getRouletteDisplayOrder().indexOf(index);
    const sliceCenter = visualPos * sliceDeg + sliceDeg / 2;
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

        if (rouletteTestMode) {
            // 測試模式：不發獎、不扣次數、不廣播，僅顯示結果
            if (resultText) resultText.textContent = `🧪 測試結果：${prize.name}`;
        } else {
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
        }

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

    // 僅以 nonce 去重：firebase ServerValue.TIMESTAMP 會先以估算值、再以確認值各觸發
    // 一次監聽（同一 nonce、不同 ts），若把 ts 納入 key 會在抽獎者畫面重複彈出。
    const key = data.nonce || ('ts:' + (data.ts || ''));
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

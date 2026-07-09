/**
 * Limbus Command - 地圖行動軸 / 回合控制 / 換回合精美提示
 *
 * 職責：把「先攻順序 + 換回合操作 + 換回合提示」搬到地圖上，浮於地圖底部中央。
 *   - 行動軸：依先攻順序（state.units 開戰時已按 init 排序）橫向排列每個棋子的頭像晶片，
 *     當前行動者放大並以黃框發光標示；點擊晶片即選取該棋子。玩家看不到隱藏敵人。
 *   - 換回合控制（ST 專屬）：◀ 上一個 / ▶ 下一個 / 🏁 結束戰鬥。手動切換回合的功能保留
 *     （◀▶ 與「單位」分頁的「下一回合」按鈕皆可用）。
 *   - 換回合精美提示：偵測到「回合真的改變」時，於畫面中央播放一次帶頭像的動畫橫幅。
 *
 * 資料來源：state.isCombatActive / state.turnIdx / state.roundNum / state.units。
 * 呼叫時機：由 renderMap() 每次重繪時呼叫 renderTurnAxis()（renderMap 已合流成每影格一次）。
 * 防禦性：所有 DOM / 全域皆以 typeof 與存在性檢查防呆，不影響既有地圖與單位同步。
 */

// 換回合提示的變化偵測：記住「上次觀察到的回合鍵」，只有改變時才播放提示。
let _taLastTurnKey = null;    // `${roundNum}:${activeUnitId}`
let _taInitialized = false;   // 首次觀察不觸發提示（避免剛進房間 / 重新整理就跳橫幅）
let _taBannerTimer = null;

/** 確保行動軸與提示橫幅的 DOM 存在（掛在 #map-viewport 內，浮於地圖上、不隨地圖平移）。 */
function ensureTurnAxisDom() {
    const vp = document.getElementById('map-viewport');
    if (!vp) return null;

    let overlay = document.getElementById('turn-axis-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'turn-axis-overlay';
        overlay.className = 'turn-axis-overlay hidden';
        overlay.innerHTML =
            '<div class="turn-axis-controls" id="turn-axis-controls"></div>' +
            '<div class="turn-axis-track" id="turn-axis-track"></div>';
        vp.appendChild(overlay);
    } else if (overlay.parentNode !== vp) {
        vp.appendChild(overlay);
    }

    if (!document.getElementById('turn-banner')) {
        const banner = document.createElement('div');
        banner.id = 'turn-banner';
        banner.className = 'turn-banner';
        vp.appendChild(banner);
    }
    return overlay;
}

/** 產生棋子頭像（有頭像用背景圖，否則用名字首字）。 */
function taUnitFaceHtml(u, faceClass) {
    const cls = faceClass || 'tc-face';
    if (u.avatar) {
        return `<span class="${cls}" style="background-image:url('${u.avatar}')"></span>`;
    }
    const initial = (u.name && u.name.length) ? u.name[0].toUpperCase() : '?';
    const esc = (typeof escapeHtml === 'function') ? escapeHtml(initial) : initial;
    return `<span class="${cls} ${cls}-text">${esc}</span>`;
}

/** 主渲染：由 renderMap() 每次重繪時呼叫。 */
function renderTurnAxis() {
    const overlay = ensureTurnAxisDom();
    if (!overlay) return;

    const inCombat = (typeof state !== 'undefined') && state.isCombatActive === true;
    if (!inCombat) {
        overlay.classList.add('hidden');
        _taInitialized = true;   // 已觀察過一次（未開戰），下次開戰算「改變」→ 會播第 1 回合提示
        _taLastTurnKey = null;
        return;
    }
    overlay.classList.remove('hidden');

    const isSt = (typeof myRole !== 'undefined' && myRole === 'st');
    const units = Array.isArray(state.units) ? state.units : [];
    const current = units[state.turnIdx] || null;

    // ── 控制列（ST 專屬） ──
    const controls = document.getElementById('turn-axis-controls');
    if (controls) {
        if (isSt) {
            controls.style.display = '';
            if (!controls.dataset.built) {
                controls.innerHTML =
                    '<button class="ta-ctrl" title="上一個行動" onclick="prevTurn()">◀</button>' +
                    '<button class="ta-ctrl ta-ctrl-next" title="下一個行動" onclick="nextTurn()">▶</button>' +
                    '<button class="ta-ctrl ta-ctrl-end" title="結束戰鬥" onclick="toggleCombat()">🏁</button>';
                controls.dataset.built = '1';
            }
        } else {
            controls.style.display = 'none';
        }
    }

    // ── 先攻軌道 ──
    const track = document.getElementById('turn-axis-track');
    if (track) {
        track.textContent = '';
        units.forEach((u, idx) => {
            if (!u) return;
            if (!isSt && u.hidden === true) return;   // 玩家看不到隱藏敵人
            const isCur = (idx === state.turnIdx);
            const chip = document.createElement('div');
            chip.className = 'turn-chip ' + (u.type || '') +
                (isCur ? ' active' : '') + (u.actionSlotOf ? ' slot' : '');
            chip.title = (u.name || '單位') + '（先攻 ' + (u.init || 0) + '）';
            chip.innerHTML = taUnitFaceHtml(u, 'tc-face') +
                `<span class="tc-init">${u.init || 0}</span>`;
            chip.addEventListener('click', () => {
                // 點擊晶片：選取該棋子（僅對已部署且看得到的棋子）
                if (typeof selectUnit === 'function' && u.x >= 0) selectUnit(u.id);
            });
            track.appendChild(chip);
        });
        // 讓當前行動者自動捲到可見範圍中央
        const curEl = track.querySelector('.turn-chip.active');
        if (curEl && typeof curEl.scrollIntoView === 'function') {
            curEl.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        }
    }

    // ── 換回合提示：偵測回合是否真的改變 ──
    const turnKey = (state.roundNum || 0) + ':' + (current ? current.id : 'none');
    if (!_taInitialized) {
        _taInitialized = true;
        _taLastTurnKey = turnKey;   // 首次觀察（例如加入進行中的戰鬥）不觸發
    } else if (turnKey !== _taLastTurnKey) {
        _taLastTurnKey = turnKey;
        if (current) showTurnBanner(current);
    }
}

/** 播放一次換回合精美提示橫幅。 */
function showTurnBanner(unit) {
    const banner = document.getElementById('turn-banner');
    if (!banner || !unit) return;

    // 先攻列表輪回第一位 → 視為新回合，額外顯示「第 N 回合」
    const isNewRound = (state.turnIdx === 0 && (state.roundNum || 0) > 0);
    const roundLine = isNewRound
        ? `<div class="tb-round">第 ${state.roundNum} 回合</div>`
        : '';
    const name = (typeof escapeHtml === 'function') ? escapeHtml(unit.name || '單位') : (unit.name || '單位');

    banner.className = 'turn-banner ' + (unit.type || '');
    banner.innerHTML =
        roundLine +
        '<div class="tb-body">' +
            taUnitFaceHtml(unit, 'tb-face') +
            `<div class="tb-name">${name}<span class="tb-suffix">的回合</span></div>` +
        '</div>';

    // 重啟動畫：先移除 show 並強制回流，再加回，確保每次都從頭播放
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');

    if (_taBannerTimer) clearTimeout(_taBannerTimer);
    _taBannerTimer = setTimeout(() => {
        const b = document.getElementById('turn-banner');
        if (b) b.classList.remove('show');
    }, 2000);
}

/** 上一個行動（ST 專屬，手動回退先攻順序）。不動回合數，只退指標。 */
function prevTurn() {
    if (typeof myRole === 'undefined' || myRole !== 'st') {
        if (typeof showToast === 'function') showToast('只有 ST 可以控制回合');
        return;
    }
    if (!state.isCombatActive || !state.units.length) return;
    const n = state.units.length;
    state.turnIdx = (state.turnIdx - 1 + n) % n;
    if (typeof broadcastState === 'function') broadcastState();
}

// ===== Window bindings =====
if (typeof window !== 'undefined') {
    window.renderTurnAxis = renderTurnAxis;
    window.showTurnBanner = showTurnBanner;
    window.prevTurn = prevTurn;
}

console.log('⏳ 地圖行動軸模組已載入');

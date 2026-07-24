/**
 * Limbus Command - 地圖行動軸 / 回合控制 / 換回合精美提示
 *
 * 職責：把「先攻順序 + 換回合提示」搬到地圖上，浮於地圖底部中央、完全置中，
 * 不再有任何按鈕或面板包裹，只有棋子頭像本身可見。
 *   - 行動軸：依先攻順序（state.units 開戰時已按 init 排序）以置中式輪播呈現每個棋子的
 *     頭像晶片，當前行動者永遠精準置中並以黃框發光標示；點擊晶片即選取該棋子。
 *     玩家看不到隱藏敵人。
 *   - 換回合控制（ST 專屬）：改由方向鍵 ←→ 觸發（見 hotkeys.js 的 canCycleTurnByKeyboard()），
 *     不再有 ◀▶🏁 按鈕。手動切換回合／結束戰鬥仍可透過「單位」分頁的按鈕操作。
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
        // turn-axis-viewport：裁切窗口（固定寬、溢出隱藏＋邊緣淡出遮罩）
        // turn-axis-track：實際承載晶片的內層，靠 transform 平移把當前行動者滑到正中央
        // 沒有任何按鈕/控制列：overlay 只剩這一層，天然完全置中，也沒有面板包住晶片
        overlay.innerHTML =
            '<div class="turn-axis-viewport" id="turn-axis-viewport"><div class="turn-axis-track" id="turn-axis-track"></div></div>';
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
            const effInit = (typeof getEffectiveInit === 'function') ? getEffectiveInit(u) : (u.init || 0);
            chip.title = (u.name || '單位') + '（先攻 ' + effInit + '）';
            chip.innerHTML = taUnitFaceHtml(u, 'tc-face') +
                `<span class="tc-init">${effInit}</span>`;
            chip.addEventListener('click', () => {
                // 點擊晶片：選取該棋子（僅對已部署且看得到的棋子）
                if (typeof selectUnit === 'function' && u.x >= 0) selectUnit(u.id);
            });
            track.appendChild(chip);
        });
        // 讓當前行動者的晶片永遠精準滑到裁切窗口正中央並發光（換人時平滑過渡）
        centerActiveTurnChip(track);
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

/**
 * 讓「目前行動者」的晶片永遠精準滑到 .turn-axis-viewport 裁切窗口正中央，
 * 換人時 CSS transition 會讓整條軌道平滑滑動 —— 如音樂 App 切歌時封面置中的效果。
 * 以 offsetLeft/offsetWidth（layout 座標，不受 transform 影響）計算，避免與
 * 目前套用中的 translateX 互相干擾。
 * @param {HTMLElement} track - #turn-axis-track 元素
 */
function centerActiveTurnChip(track) {
    const viewportEl = track.parentElement;
    if (!viewportEl) return;

    const activeChip = track.querySelector('.turn-chip.active');
    if (!activeChip) {
        track.style.transform = 'translateX(0)';
        return;
    }

    const viewportWidth = viewportEl.clientWidth;
    const chipCenter = activeChip.offsetLeft + activeChip.offsetWidth / 2;
    const offset = viewportWidth / 2 - chipCenter;
    track.style.transform = `translateX(${offset}px)`;
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

// 注意：prevTurn()／nextTurn()／toggleCombat() 的唯一定義在 units.js，
// 這裡不再重複宣告一份（先前重複宣告的 prevTurn 會覆蓋 units.js 版本，
// 導致「上一個」按鈕實際呼叫的是少了列表捲動等收尾邏輯的簡化版）。

// ===== Window bindings =====
if (typeof window !== 'undefined') {
    window.renderTurnAxis = renderTurnAxis;
    window.showTurnBanner = showTurnBanner;

    // 視窗尺寸改變時，裁切窗口寬度跟著變，重新置中目前行動者的晶片
    window.addEventListener('resize', () => {
        const track = document.getElementById('turn-axis-track');
        if (track) centerActiveTurnChip(track);
    });
}

console.log('⏳ 地圖行動軸模組已載入');

/**
 * Limbus Command - 戰鬥隊列主控台（ST 接管權限）
 *
 * 解決的實務問題：整場戰鬥的結算是一條單線流程，只要有一筆卡住（玩家臨時離開沒按結算、
 * 角色被刪除、防禦 QTE 沒人填），後續所有攻擊都跟著卡死，且 ST 沒有任何介入手段。
 *
 * 本面板提供三種接管方式：
 *   1. 強制中止：把作用中的結算打回 idle，等候區隨即自動接續下一筆。
 *   2. 代填防禦：玩家離線時由 ST 代為送出防禦值（預設帶入該單位角色卡上的防禦 DP＋附加成功）。
 *   3. 等候區管理：檢視排隊中的攻擊、逐筆取消，或整批清空。
 *
 * 面板僅 ST 可見；玩家端只會在自己的攻擊排入等候區時看到提示（見 combat-queue.js）。
 *
 * 依賴（皆以 typeof 防呆）：
 *   combat-queue.js（cqForceReset / cqCancelPending / cqSTSubmitDefenseFor / cqPendingList /
 *                    combatQueueLast）、findUnitById / showToast / escapeHtml /
 *                    makeFloatingPanel / PanelDock / WindowManager
 */

const STQ_PANEL_ID = 'st-queue-panel';

/** 隊列狀態 → 中文說明（面板頂部的狀態列） */
const STQ_STATUS_TEXT = {
    idle: { label: '閒置', cls: 'stq-idle', desc: '目前沒有進行中的結算' },
    pending_defense: { label: '等待防禦', cls: 'stq-wait', desc: '等待防禦方玩家送出防禦 QTE' },
    calculating: { label: '黑箱運算中', cls: 'stq-calc', desc: '系統正在計算骰數與附加成功' },
    st_review: { label: '等待 ST 審核', cls: 'stq-review', desc: '審核面板已開啟，等待你確認廣播' },
    broadcasting: { label: '廣播中', cls: 'stq-cast', desc: '結果已公佈，稍後自動回到閒置' }
};

/**
 * 目前隊列狀態。
 * stqOnQueueChanged 會把最新一筆直接遞過來（combatQueueLast 要等監聽器回傳後才更新，
 * 直接讀全域變數會慢一拍），故以此覆寫值優先，沒有時才回退到全域快照。
 */
let stqLatestQueue = null;
function stqCurrentQueue() {
    if (stqLatestQueue) return stqLatestQueue;
    return (typeof combatQueueLast !== 'undefined' && combatQueueLast) ? combatQueueLast : null;
}

// ===== 卡住偵測（TTL 提示，不自動解鎖）=====
// 只提示、不自動強制中止：結算牽涉傷害/資源扣除，若只是玩家網路延遲、其實還在填防禦 QTE，
// 自動解鎖可能誤傷正常進行中的結算。真正要不要中止仍由 ST 按下既有的「強制中止」按鈕決定。
const STQ_STUCK_THRESHOLD_MS = 30000; // 判定「疑似卡住」的等待門檻：30 秒
let stqStuckWarnedTs = null; // 已經提示過的這筆隊列的 ts，避免同一筆重複跳 toast 打擾
let stqTickTimer = null;     // 定期檢查計時器：沒有新的 Firebase 事件時，靠這個讓「已等待秒數」持續更新

/**
 * 取得目前隊列「已進行中」的毫秒數。
 * q.ts 在寫入當下是 firebase.database.ServerValue.TIMESTAMP 佔位物件，要等伺服器回填確認值
 * 才會變成數字，回填前一律視為「還不知道」（回傳 null），避免把佔位物件誤算成距今數十年。
 * @param {object|null} q
 * @returns {number|null}
 */
function stqQueueElapsedMs(q) {
    if (!q || typeof q.ts !== 'number') return null;
    return Date.now() - q.ts;
}

/**
 * 每隔幾秒檢查一次目前隊列是否疑似卡住太久。只有 ST 需要看到這個提示。
 * 由 stqInitPanel() 啟動的 setInterval 呼叫，與 Firebase 監聽器事件無關——
 * 卡住的定義就是「已經一段時間沒有新事件」，所以不能只靠事件觸發，要靠時間本身輪詢。
 */
function stqCheckStuck() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const q = stqCurrentQueue();
    const status = (q && q.status) ? q.status : 'idle';
    if (status === 'idle') {
        stqStuckWarnedTs = null;
        return;
    }
    const elapsed = stqQueueElapsedMs(q);
    if (elapsed === null || elapsed <= STQ_STUCK_THRESHOLD_MS) return;

    if (q.ts !== stqStuckWarnedTs) {
        stqStuckWarnedTs = q.ts;
        if (typeof showToast === 'function') {
            showToast(`⚠️ 戰鬥隊列已等待超過 ${Math.round(STQ_STUCK_THRESHOLD_MS / 1000)} 秒，疑似卡住，請開啟「戰鬥隊列主控台」檢查`);
        }
    }
    // 面板開著時即時更新「已等待秒數」與警示文字（面板關著就只靠上面的 toast 提醒）
    const panel = document.getElementById(STQ_PANEL_ID);
    if (panel && !panel.classList.contains('hidden')) stqRender();
}

/** 目前等候區清單（combat-queue.js 維護的快照） */
function stqPendingList() {
    return (typeof cqPendingList !== 'undefined' && Array.isArray(cqPendingList)) ? cqPendingList : [];
}

/** 開關面板（QAB 選單、快捷鍵共用）。僅 ST 可開。 */
function stqTogglePanel() {
    if (typeof myRole === 'undefined' || myRole !== 'st') {
        if (typeof showToast === 'function') showToast('戰鬥隊列主控台僅 ST 可用');
        return;
    }
    const panel = document.getElementById(STQ_PANEL_ID);
    if (!panel) return;
    const hidden = panel.classList.contains('hidden');
    if (hidden) {
        // 收納在右緣邊條時，顯式開啟一律還原到畫面上
        if (typeof PanelDock !== 'undefined' && PanelDock.isDocked(STQ_PANEL_ID)) PanelDock.restore(STQ_PANEL_ID);
        panel.classList.remove('hidden');
        if (typeof WindowManager !== 'undefined') WindowManager.bringToFront(panel);
        stqRender();
    } else {
        panel.classList.add('hidden');
    }
}

/** 關閉面板 */
function stqClosePanel(event) {
    if (event) event.stopPropagation();
    const panel = document.getElementById(STQ_PANEL_ID);
    if (panel) panel.classList.add('hidden');
}

/**
 * 渲染面板內容：狀態列 ＋ 接管操作 ＋ 等候區清單。
 * 每次隊列或等候區變動都會被呼叫，故整段重繪（內容量小，不需要細粒度更新）。
 */
function stqRender() {
    const body = document.getElementById('stq-body');
    if (!body) return;
    if (typeof myRole === 'undefined' || myRole !== 'st') { body.textContent = '僅 ST 可用'; return; }

    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s == null ? '' : s));
    const q = stqCurrentQueue();
    const status = (q && q.status) ? q.status : 'idle';
    const meta = STQ_STATUS_TEXT[status] || { label: status, cls: 'stq-idle', desc: '' };

    // ===== 狀態列 =====
    const atkName = (q && q.attacker && q.attacker.name) || '';
    const tgtName = (q && q.target && q.target.name) || '';
    const pairTxt = (atkName || tgtName) ? `${esc(atkName || '？')} ➜ ${esc(tgtName || '？')}` : '—';
    let head = `
        <div class="stq-status ${meta.cls}">
            <span class="stq-status-badge">${esc(meta.label)}</span>
            <span class="stq-status-pair">${pairTxt}</span>
        </div>
        <div class="stq-status-desc">${esc(meta.desc)}</div>`;

    // 疑似卡住：閒置以外的狀態已經等待超過門檻，顯示已等待秒數並提醒 ST 檢查
    if (status !== 'idle') {
        const elapsed = stqQueueElapsedMs(q);
        if (elapsed !== null && elapsed > STQ_STUCK_THRESHOLD_MS) {
            head += `
        <div class="stq-warn">⚠️ 已等待 ${Math.round(elapsed / 1000)} 秒，可能卡住了（例如玩家離線／忘記填防禦），建議檢查或直接強制中止。</div>`;
        }
    }

    // ===== 代填防禦（僅在等待防禦時出現）=====
    let defenseBlock = '';
    if (status === 'pending_defense') {
        const targetId = (q.target && q.target.id) || '';
        const unit = (targetId && typeof findUnitById === 'function') ? findUnitById(targetId) : null;
        const missing = targetId && !unit;
        const defDp = unit ? (parseInt(unit.defDp, 10) || 0) : 0;
        const defAuto = unit ? (parseInt(unit.defAuto, 10) || 0) : 0;
        const preset = (typeof formatDicePlus === 'function') ? formatDicePlus(defDp, defAuto) : String(defDp);
        defenseBlock = `
            <div class="stq-section">
                <div class="stq-section-title">🛡 代填防禦（玩家離線／離席時接管）</div>
                ${missing
                    ? '<div class="stq-warn">⚠️ 防禦方單位已不存在，這筆結算無法完成，請直接強制中止。</div>'
                    : `<div class="stq-hint">預設帶入「${esc((unit && unit.name) || '目標')}」角色卡上的防禦值，可直接修改。</div>
                       <div class="stq-row">
                           <input type="text" id="stq-defense-input" class="stq-input" value="${esc(preset)}"
                                  placeholder="防禦 A+B（A＝擲骰數、B＝附加成功）">
                           <button class="stq-btn stq-btn-go" onclick="stqSubmitDefense()">代送防禦</button>
                       </div>`}
            </div>`;
    }

    // ===== 接管操作 =====
    const busy = status !== 'idle';
    const controls = `
        <div class="stq-section">
            <div class="stq-section-title">🛑 強制接管</div>
            <div class="stq-row">
                <button class="stq-btn stq-btn-danger" ${busy ? '' : 'disabled'} onclick="stqForceReset(false)"
                        title="把目前這筆結算打回閒置；等候區會自動接續下一筆">強制中止目前結算</button>
                <button class="stq-btn stq-btn-danger-ghost" onclick="stqForceReset(true)"
                        title="中止目前結算並清空所有等候中的攻擊">中止並清空等候區</button>
            </div>
        </div>`;

    // ===== 等候區 =====
    const pending = stqPendingList();
    let pendingBlock;
    if (!pending.length) {
        pendingBlock = `
            <div class="stq-section">
                <div class="stq-section-title">⏳ 等候區（0）</div>
                <div class="stq-hint">沒有排隊中的攻擊。多名玩家同時送出攻擊時會排在這裡，依序自動結算。</div>
            </div>`;
    } else {
        const rows = pending.map((p, i) => {
            const who = esc((p.attacker && p.attacker.name) || '玩家');
            const to = esc((p.target && p.target.name) || '目標');
            const waited = p.queuedAt ? Math.max(0, Math.round((Date.now() - p.queuedAt) / 1000)) : null;
            const waitTxt = (waited === null) ? '' : `<span class="stq-wait-time">已等 ${waited} 秒</span>`;
            return `
                <div class="stq-pending-row">
                    <span class="stq-pending-no">${i + 1}</span>
                    <span class="stq-pending-pair">${who} ➜ ${to}</span>
                    ${waitTxt}
                    <button class="stq-btn-mini" onclick="stqCancelPending('${esc(p.key)}')" title="取消這筆攻擊">✕</button>
                </div>`;
        }).join('');
        pendingBlock = `
            <div class="stq-section">
                <div class="stq-section-title">⏳ 等候區（${pending.length}）</div>
                <div class="stq-hint">目前結算完畢後會由上而下自動接續。</div>
                ${rows}
            </div>`;
    }

    body.innerHTML = head + defenseBlock + controls + pendingBlock;
}

/** 強制中止（面板按鈕）。清空等候區屬破壞性操作，故二次確認。 */
function stqForceReset(alsoClearPending) {
    if (alsoClearPending) {
        const n = stqPendingList().length;
        const msg = n
            ? `確定要中止目前的結算，並取消等候中的 ${n} 筆攻擊嗎？\n（這些攻擊不會被結算，玩家需重新發起）`
            : '確定要強制中止目前的結算嗎？';
        if (!confirm(msg)) return;
    }
    if (typeof cqForceReset === 'function') cqForceReset(!!alsoClearPending);
    // 中止時把可能還開著的戰鬥彈窗一併關掉，避免 ST 端殘留已失效的審核面板
    if (typeof cqOnIdle === 'function') cqOnIdle();
    stqRender();
}

/** 取消等候區中的某一筆 */
function stqCancelPending(key) {
    if (typeof cqCancelPending === 'function') cqCancelPending(key);
    stqRender();
}

/** 代填防禦：解析 A+B 記法後送出 */
function stqSubmitDefense() {
    const input = document.getElementById('stq-defense-input');
    const raw = input ? input.value : '0';
    const parsed = (typeof parseDicePlus === 'function')
        ? parseDicePlus(raw)
        : { dice: parseInt(raw, 10) || 0, auto: 0 };
    if (typeof cqSTSubmitDefenseFor === 'function') cqSTSubmitDefenseFor(parsed.dice, parsed.auto);
    stqRender();
}

/**
 * combat-queue.js 的回呼：等候區內容變動時重繪面板，並在 QAB 選單標示等候筆數，
 * 讓 ST 就算沒開面板也看得到「有幾筆攻擊在排隊」。
 * @param {Array<object>} list
 */
function cqOnPendingListChanged(list) {
    stqRender();
    // 側邊條圖標上的紅色計數（data-badge 由 CSS 的 ::after 呈現），讓 ST 沒開面板也看得到排隊筆數
    const item = document.getElementById('qab-stq-item');
    if (item) {
        const n = (list || []).length;
        if (n > 0) item.dataset.badge = String(n);
        else delete item.dataset.badge;
    }
}

/**
 * 隊列狀態變動時同步重繪（由 combat-queue.js 的 cqHandleUpdate 呼叫）。
 * @param {object|null} data - 這次收到的隊列內容（null/idle 皆可能）
 */
function stqOnQueueChanged(data) {
    stqLatestQueue = data || null;
    stqRender();
}

/** 僅 ST 可見戰鬥隊列主控台的側邊條入口（與 fogGateUI 同一套 gate 慣例）。 */
function stqGateUI() {
    const isST = (typeof myRole !== 'undefined' && myRole === 'st');
    const item = document.getElementById('qab-stq-item');
    if (item) item.style.display = isST ? '' : 'none';
}

/** 初始化：掛上通用浮動面板行為（拖曳／收起／右緣收納） */
function stqInitPanel() {
    if (typeof makeFloatingPanel !== 'function') return;
    makeFloatingPanel({
        panelId: STQ_PANEL_ID,
        headerId: 'stq-header',
        collapseBtnId: 'stq-collapse',
        storageKey: 'limbus_st_queue_panel',
        defaultPos: { x: Math.max(20, window.innerWidth - 380), y: 120 },
        dock: { icon: '⚔️', title: '戰鬥隊列主控台' },
        restoreDock: true,
    });

    // 卡住偵測輪詢：只讀本機快取、不寫入 Firebase，跟頁面生命週期綁在一起即可，
    // 不需要隨換房/登出特別清理（stqCheckStuck 內部本來就會依 myRole／目前隊列狀態自行判斷要不要動作）。
    if (!stqTickTimer) stqTickTimer = setInterval(stqCheckStuck, 5000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', stqInitPanel);
} else {
    stqInitPanel();
}

console.log('⚔️ 戰鬥隊列主控台已載入');

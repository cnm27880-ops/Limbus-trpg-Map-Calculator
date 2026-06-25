/**
 * Limbus Command - Limbus 24 格刻度時鐘與 E.G.O 侵蝕系統（系統 B）
 *
 * 1. 全域 24 格刻度時鐘：Firebase /rooms/{roomId}/clockTicks（預設 24），所有玩家即時可見。
 * 2. E.G.O 侵蝕控制台（ST 專屬）：刻度增減、罪業抽取（負面狀態 → 侵蝕增幅）、暴走 1D2 判定與全場警告廣播、燃盡。
 *
 * 防禦性：所有操作以 typeof / try-catch 防呆，僅 ST 可寫入；絕不影響地圖、單位與既有 Firebase 同步。
 */

const ERO_CLOCK_MAX = 24;
const ERO_STATUS_ID = 'erosion_amplify';
const ERO_STATUS_NAME = '侵蝕增幅';
const ERO_DEFAULT_THRESHOLD = 20;
// 「負面狀態」判定：可被抽取的罪業 =
//   (a) 分類屬於「負面與失能 / 精神與心智」者，或
//   (b) 分類為「常用」但本質為負面減益的狀態（燃燒/流血/麻痺…，常用分類混有增益故需白名單）。
// 排除增益與資源類（人民之盾/再生/充能/迅捷…）與侵蝕增幅自身，避免把吸收者的能量也算進去。
const ERO_DEBUFF_CATEGORIES = ['debuff', 'mental'];
const ERO_DEBUFF_COMMON_IDS = ['burn', 'bleed', 'fragile', 'stun', 'paralyze', 'freeze', 'entangle', 'tremor', 'nails', 'weakness', 'flaw', 'dazzled'];

let eroClockTicks = ERO_CLOCK_MAX;

// ===== Firebase 監聽（由 setupRoomListeners 呼叫） =====
function erosionSetupListener() {
    if (typeof roomRef === 'undefined' || !roomRef) return;
    eroGateUI();

    // 刻度時鐘
    const clockListener = roomRef.child('clockTicks').on('value', snapshot => {
        if (snapshot.exists()) {
            const v = Number(snapshot.val());
            eroClockTicks = Number.isFinite(v) ? Math.max(0, Math.min(ERO_CLOCK_MAX, v)) : ERO_CLOCK_MAX;
        } else {
            eroClockTicks = ERO_CLOCK_MAX;
            // ST 初始化節點
            if (typeof myRole !== 'undefined' && myRole === 'st') {
                roomRef.child('clockTicks').set(ERO_CLOCK_MAX);
            }
        }
        renderClockDisplay();
        if (document.getElementById('erosion-hud') && !document.getElementById('erosion-hud').classList.contains('hidden')) {
            renderErosionConsole();
        }
    });
    if (typeof unsubscribeListeners !== 'undefined') {
        unsubscribeListeners.push(() => roomRef.child('clockTicks').off('value', clockListener));
    }

    // 侵蝕暴走全場警告廣播
    const eroEventListener = roomRef.child('events/erosion').on('value', snapshot => {
        if (snapshot.exists()) handleErosionBroadcast(snapshot.val());
    });
    if (typeof unsubscribeListeners !== 'undefined') {
        unsubscribeListeners.push(() => roomRef.child('events/erosion').off('value', eroEventListener));
    }
}

/** 僅 ST 可見侵蝕控制台的 QAB 開關。 */
function eroGateUI() {
    const isST = (typeof myRole !== 'undefined' && myRole === 'st');
    const item = document.getElementById('qab-erosion-item');
    if (item) item.style.display = isST ? 'flex' : 'none';
}

// ===== 24 格刻度時鐘渲染 =====
function renderClockDisplay() {
    const box = document.getElementById('limbus-clock-display');
    if (!box) return;
    const ticks = eroClockTicks;
    const full = Math.floor(ticks);
    const hasPartial = (ticks - full) > 0;

    let cells = '';
    for (let i = 1; i <= ERO_CLOCK_MAX; i++) {
        let cls = 'clock-cell';
        if (i <= full) cls += ' filled';
        else if (i === full + 1 && hasPartial) cls += ' partial';
        else cls += ' empty';
        cells += `<div class="${cls}"></div>`;
    }
    const label = (Math.round(ticks * 10) / 10);
    box.innerHTML = `
        <div class="clock-cells">${cells}</div>
        <div class="clock-label">侵蝕刻度 <b>${label}</b> / ${ERO_CLOCK_MAX}</div>`;
}

// ===== 侵蝕控制台（ST） =====
function toggleErosionHud() {
    const hud = document.getElementById('erosion-hud');
    if (!hud) return;
    if (hud.classList.contains('hidden')) {
        renderErosionConsole();
        hud.classList.remove('hidden');
    } else {
        hud.classList.add('hidden');
    }
}
function closeErosionHud() {
    const hud = document.getElementById('erosion-hud');
    if (hud) hud.classList.add('hidden');
}

function eroUnitOptions(filterFn, selectedId) {
    let opts = '<option value="">（請選擇）</option>';
    if (typeof state !== 'undefined' && Array.isArray(state.units)) {
        for (const u of state.units) {
            if (!filterFn(u)) continue;
            const sel = (u.id === selectedId) ? ' selected' : '';
            const safe = (typeof escapeHtml === 'function') ? escapeHtml(u.name || '') : (u.name || '');
            opts += `<option value="${u.id}"${sel}>${safe}</option>`;
        }
    }
    return opts;
}

function eroIsEnemy(u) { return u && (u.type === 'enemy' || u.type === 'boss'); }
function eroIsPlayer(u) { return u && u.type === 'player'; }

function eroGetErosionLayers(unit) {
    if (!unit || !unit.status) return 0;
    return parseInt(unit.status[ERO_STATUS_NAME]) || 0;
}

function renderErosionConsole() {
    const body = document.getElementById('erosion-hud-body');
    if (!body) return;

    // 保留目前選取，避免重繪時清空
    const prevSource = document.getElementById('ero-source')?.value || '';
    const prevAbsorber = document.getElementById('ero-absorber')?.value || '';
    const prevThreshold = document.getElementById('ero-threshold')?.value || ERO_DEFAULT_THRESHOLD;

    const absorber = (typeof findUnitById === 'function' && prevAbsorber) ? findUnitById(prevAbsorber) : null;
    const absorberErosion = eroGetErosionLayers(absorber);
    const threshold = parseInt(prevThreshold) || ERO_DEFAULT_THRESHOLD;
    const overloadReady = absorber && absorberErosion >= threshold;

    body.innerHTML = `
        <div class="ero-section">
            <div class="ero-section-title">🕒 刻度時鐘操作（目前 ${Math.round(eroClockTicks * 10) / 10} / ${ERO_CLOCK_MAX}）</div>
            <div class="ero-btn-row">
                <button class="ero-btn ero-minus" onclick="eroSetClock(-1)">-1 單人復活</button>
                <button class="ero-btn ero-minus" onclick="eroSetClock(-1.5)">-1.5 雙人復活</button>
                <button class="ero-btn ero-minus" onclick="eroSetClock(-6)">-6 全滅</button>
            </div>
            <div class="ero-btn-row">
                <button class="ero-btn ero-plus" onclick="eroSetClock(2)">+2 支線完成</button>
                <button class="ero-btn ero-plus" onclick="eroSetClock(4)">+4 主線完成</button>
                <button class="ero-btn ero-reset" onclick="eroResetClock()">↺ 滿血 (24)</button>
            </div>
        </div>

        <div class="ero-section">
            <div class="ero-section-title">🩸 罪業抽取與侵蝕暴走</div>
            <div class="ero-field"><label>來源（敵方）</label>
                <select id="ero-source" class="ero-select">${eroUnitOptions(eroIsEnemy, prevSource)}</select></div>
            <div class="ero-field"><label>吸收者（玩家）</label>
                <select id="ero-absorber" class="ero-select" onchange="renderErosionConsole()">${eroUnitOptions(eroIsPlayer, prevAbsorber)}</select></div>
            <div class="ero-field"><label>暴走閾值</label>
                <input id="ero-threshold" class="ero-input" type="number" min="1" value="${threshold}" onchange="renderErosionConsole()"></div>

            <div class="ero-status-line">
                吸收者目前侵蝕增幅：<b class="${overloadReady ? 'ero-over' : ''}">${absorberErosion}</b> / ${threshold}
            </div>

            <button class="ero-btn ero-drain" onclick="eroDrainSin()">🩸 抽取罪業</button>

            <div class="ero-overload-area">
                <button class="ero-btn ero-roll" onclick="eroRollTarget()" ${overloadReady ? '' : 'disabled'}>
                    🎲 判定侵蝕目標 (1D2)${overloadReady ? '' : '（未達閾值）'}</button>
                <button class="ero-btn ero-burn" onclick="eroBurnOut()">✨ 燃盡（清空侵蝕）</button>
            </div>
        </div>`;
}

// ===== 刻度操作 =====
function eroWriteClock(next) {
    const clamped = Math.max(0, Math.min(ERO_CLOCK_MAX, Math.round(next * 10) / 10));
    eroClockTicks = clamped;
    if (typeof myRole !== 'undefined' && myRole === 'st' && typeof roomRef !== 'undefined' && roomRef) {
        roomRef.child('clockTicks').set(clamped);
    }
    renderClockDisplay();
    renderErosionConsole();
}
function eroSetClock(delta) { eroWriteClock(eroClockTicks + (Number(delta) || 0)); }
function eroResetClock() { eroWriteClock(ERO_CLOCK_MAX); }

// ===== 罪業抽取 =====
function eroIsDebuffStatusName(name) {
    if (typeof getStatusByName !== 'function' || typeof getStatusCategory !== 'function') return false;
    const def = getStatusByName(name);
    if (!def) return false;
    if (def.id === ERO_STATUS_ID) return false; // 侵蝕增幅本身不算罪業
    const cat = getStatusCategory(def.id);
    if (ERO_DEBUFF_CATEGORIES.includes(cat)) return true;
    return ERO_DEBUFF_COMMON_IDS.includes(def.id);
}

function eroDrainSin() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const sourceId = document.getElementById('ero-source')?.value || '';
    const absorberId = document.getElementById('ero-absorber')?.value || '';
    if (!sourceId || !absorberId) { if (typeof showToast === 'function') showToast('請先選擇來源與吸收者'); return; }

    const source = (typeof findUnitById === 'function') ? findUnitById(sourceId) : null;
    if (!source || !source.status) { if (typeof showToast === 'function') showToast('來源沒有任何狀態'); return; }

    // 加總來源所有「負面狀態」層數，並記下要清除的狀態鍵
    let total = 0;
    const drainedKeys = [];
    for (const [name, val] of Object.entries(source.status)) {
        if (!eroIsDebuffStatusName(name)) continue;
        const layers = parseInt(val) || 0;
        if (layers > 0) { total += layers; drainedKeys.push(name); }
    }

    if (total <= 0) { if (typeof showToast === 'function') showToast('來源沒有可抽取的負面狀態'); return; }

    const gained = Math.floor(total / 2);

    // 扣除（清空）來源被抽取的負面狀態層數
    drainedKeys.forEach(k => { delete source.status[k]; });
    if (typeof syncUnitStatus === 'function') syncUnitStatus(sourceId);

    // 轉化為吸收者的侵蝕增幅層數
    if (gained > 0 && typeof addStatusToUnit === 'function') {
        addStatusToUnit(absorberId, ERO_STATUS_ID, gained);
    }

    if (typeof showToast === 'function') {
        showToast(`抽取罪業：來源 ${total} 層負面 → 吸收者 +${gained} 侵蝕增幅`);
    }
    renderErosionConsole();
}

// ===== 暴走 1D2 判定與全場廣播 =====
function eroRollTarget() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const absorberId = document.getElementById('ero-absorber')?.value || '';
    const threshold = parseInt(document.getElementById('ero-threshold')?.value) || ERO_DEFAULT_THRESHOLD;
    const absorber = (typeof findUnitById === 'function') ? findUnitById(absorberId) : null;
    if (!absorber) { if (typeof showToast === 'function') showToast('請先選擇吸收者'); return; }
    if (eroGetErosionLayers(absorber) < threshold) { if (typeof showToast === 'function') showToast('尚未達到暴走閾值'); return; }

    const roll = Math.random() < 0.5 ? 1 : 2;
    const targetSide = roll === 1 ? '敵方' : '友軍';

    if (typeof roomRef !== 'undefined' && roomRef) {
        roomRef.child('events/erosion').set({
            playerName: String(absorber.name || '某玩家'),
            roll,
            targetSide,
            ts: (typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue)
                ? firebase.database.ServerValue.TIMESTAMP : Date.now(),
            nonce: Math.random().toString(36).slice(2)
        });
    }
}

function eroBurnOut() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const absorberId = document.getElementById('ero-absorber')?.value || '';
    const absorber = (typeof findUnitById === 'function') ? findUnitById(absorberId) : null;
    if (!absorber || !absorber.status) { if (typeof showToast === 'function') showToast('請先選擇吸收者'); return; }
    if (!absorber.status[ERO_STATUS_NAME]) { if (typeof showToast === 'function') showToast('該吸收者沒有侵蝕增幅'); return; }
    delete absorber.status[ERO_STATUS_NAME];
    if (typeof syncUnitStatus === 'function') syncUnitStatus(absorberId);
    if (typeof showToast === 'function') showToast(`已燃盡 ${absorber.name} 的侵蝕增幅`);
    renderErosionConsole();
}

// ===== 全場侵蝕警告廣播（所有客戶端） =====
let eroWarningTimer = null;
function handleErosionBroadcast(val) {
    if (!val || !val.playerName) return;
    // 略過加入房間時收到的舊廣播（避免一進房就跳出過期警告）
    if (typeof val.ts === 'number' && (Date.now() - val.ts) > 15000) return;
    const el = document.getElementById('erosion-warning-toast');
    if (!el) return;
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
    el.innerHTML = `⚠️ 警告！【${esc(val.playerName)}】發生 E.G.O 侵蝕，鎖定【${esc(val.targetSide || '？')}】發動毀滅打擊！`;
    el.classList.add('show');
    clearTimeout(eroWarningTimer);
    eroWarningTimer = setTimeout(() => el.classList.remove('show'), 6000);
}

// ===== Window bindings =====
if (typeof window !== 'undefined') {
    window.erosionSetupListener = erosionSetupListener;
    window.toggleErosionHud = toggleErosionHud;
    window.closeErosionHud = closeErosionHud;
    window.renderErosionConsole = renderErosionConsole;
    window.eroSetClock = eroSetClock;
    window.eroResetClock = eroResetClock;
    window.eroDrainSin = eroDrainSin;
    window.eroRollTarget = eroRollTarget;
    window.eroBurnOut = eroBurnOut;
    window.handleErosionBroadcast = handleErosionBroadcast;
    window.renderClockDisplay = renderClockDisplay;
}

console.log('🔥 E.G.O 侵蝕系統與刻度時鐘已載入');

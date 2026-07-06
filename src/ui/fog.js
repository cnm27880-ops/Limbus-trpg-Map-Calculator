/**
 * Limbus Command - 戰爭迷霧
 *
 * 職責：灰白色煙霧疊加層，蓋在地圖 Token 之上。
 *   - 玩家視角：只看得到自己（ownerId 相符）棋子周圍 1 格半徑的暫時視野（半透明），
 *     棋子「踏入」過的格子則永久清除迷霧；棋子不在場上（未部署）時完全沒有視野。
 *   - ST 視角：不受迷霧限制，永遠看到完整地圖；但可開啟「補畫」工具手動調整
 *     指定玩家（或全部玩家）的已探索紀錄，也可整個重置。
 *   - ST 可把任一棋子標記為「分享視野」，該棋子周圍的視野會同時提供給所有玩家
 *     （例如玩家棋子都不在場上、需要靠船隻視野時）。
 *
 * 資料模型（Firebase，房間共享）：
 *   fog/enabled            boolean，是否啟用戰爭迷霧
 *   fog/revealed/{playerId}/{"x,y"} = true   該玩家永久揭露的格子
 * 「分享視野」直接標記在單位本身（unit.sharedVision），沿用既有的 units 同步機制。
 *
 * 防禦性：所有 Firebase / DOM 操作皆以 typeof 與 try-catch 防呆，絕不影響地圖與單位同步。
 */

const FOG_TEMP_ALPHA = 0.55; // 暫時視野（半透明）
const FOG_FULL_ALPHA = 0.94; // 完全未探索

// ===== 本機狀態 =====
let fogEnabled = false;
let fogRevealedMine = {};   // 我方（本客戶端玩家）永久揭露的格子：{ "x,y": true }
let fogRevealedAll = {};    // 僅 ST 快取：{ playerId: { "x,y": true } }，用於補畫工具預覽
let fogEditTool = null;     // null | 'fog-reveal' | 'fog-hide'（ST 補畫工具目前選取的筆刷）
let fogEditTargetId = 'all'; // ST 選擇要編輯的玩家 id，或 'all'
let fogAnimHandle = null;
let fogHoverCell = null;
let fogLastDrawTs = 0;

function fogKey(x, y) { return x + ',' + y; }

// ===== Firebase 同步（由 setupRoomListeners 呼叫） =====
function fogSetupListener() {
    fogGateUI();
    if (typeof roomRef === 'undefined' || !roomRef) return;

    const enabledListener = roomRef.child('fog/enabled').on('value', snapshot => {
        fogEnabled = snapshot.exists() ? !!snapshot.val() : false;
        if (typeof renderMap === 'function') renderMap();
        fogRenderPanel();
    });
    if (typeof unsubscribeListeners !== 'undefined') {
        unsubscribeListeners.push(() => roomRef.child('fog/enabled').off('value', enabledListener));
    }

    if (typeof myRole !== 'undefined' && myRole === 'st') {
        // ST 快取所有玩家的揭露資料，供補畫工具預覽使用
        const allListener = roomRef.child('fog/revealed').on('value', snapshot => {
            fogRevealedAll = snapshot.val() || {};
            if (fogEditTool && typeof drawFogCanvas === 'function') drawFogCanvas(performance.now() / 1000);
        });
        if (typeof unsubscribeListeners !== 'undefined') {
            unsubscribeListeners.push(() => roomRef.child('fog/revealed').off('value', allListener));
        }
    } else if (typeof myPlayerId !== 'undefined' && myPlayerId) {
        const mineListener = roomRef.child('fog/revealed/' + myPlayerId).on('value', snapshot => {
            fogRevealedMine = snapshot.val() || {};
            if (typeof renderMap === 'function') renderMap();
        });
        if (typeof unsubscribeListeners !== 'undefined') {
            unsubscribeListeners.push(() => roomRef.child('fog/revealed/' + myPlayerId).off('value', mineListener));
        }
    }
}

/** 僅 ST 可見戰爭迷霧管理面板的 QAB 開關。 */
function fogGateUI() {
    const isST = (typeof myRole !== 'undefined' && myRole === 'st');
    const item = document.getElementById('qab-fog-item');
    if (item) item.style.display = isST ? 'flex' : 'none';
}

function fogSetEnabled(on) {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    if (typeof roomRef === 'undefined' || !roomRef) return;
    roomRef.child('fog/enabled').set(!!on);
}

// ===== 視野計算（玩家端） =====

/** 取得目前玩家的視野來源：自己擁有的、以及任何標記「分享視野」的在場棋子。 */
function fogGetVisionSources() {
    if (typeof state === 'undefined' || !Array.isArray(state.units)) return [];
    return state.units.filter(u => u && u.x >= 0 && u.y >= 0 &&
        (u.ownerId === myPlayerId || u.sharedVision === true));
}

/**
 * 重新計算「我」目前的暫時視野（3x3，含棋子本身），並把棋子實際所在格
 * 標記為永久揭露（寫回 Firebase）。回傳暫時視野的 key 集合（Set&lt;string&gt;）。
 */
function fogRecomputeMyVisibility() {
    const temp = new Set();
    if (typeof state === 'undefined' || !state.mapData) return temp;

    const sources = fogGetVisionSources();
    const newlyRevealed = [];

    sources.forEach(u => {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const x = u.x + dx, y = u.y + dy;
                if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue;
                temp.add(fogKey(x, y));
            }
        }
        const ownKey = fogKey(u.x, u.y);
        if (!fogRevealedMine[ownKey]) newlyRevealed.push(ownKey);
    });

    if (newlyRevealed.length && typeof roomRef !== 'undefined' && roomRef && myPlayerId) {
        const updates = {};
        newlyRevealed.forEach(k => { updates[k] = true; fogRevealedMine[k] = true; });
        roomRef.child('fog/revealed/' + myPlayerId).update(updates);
    }

    return temp;
}

// ===== Canvas 渲染層 =====

function fogGridSize() {
    return (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.GRID_SIZE : 50;
}

/** 確保迷霧 canvas 層存在；疊在所有 Token 之上（僅視覺，不攔截指標事件）。 */
function ensureFogCanvas() {
    const grid = document.getElementById('battle-map');
    if (!grid) return null;

    let canvas = document.getElementById('fog-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'fog-canvas';
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.zIndex = '65'; // 高於一般棋子(10+)與BOSS(50+)，讓迷霧真的蓋住看不見的棋子
        canvas.style.pointerEvents = 'none';
        grid.appendChild(canvas);
    }

    const gridSize = fogGridSize();
    const pxW = state.mapW * gridSize;
    const pxH = state.mapH * gridSize;
    canvas.style.width = pxW + 'px';
    canvas.style.height = pxH + 'px';

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.max(1, Math.round(pxW * dpr));
    const bh = Math.max(1, Math.round(pxH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
    }
    canvas._scale = dpr;
    return canvas;
}

/** 主繪製函式：玩家看到動態煙霧，ST 在補畫模式下看到揭露預覽，其餘情況清空畫布。 */
function drawFogCanvas(t) {
    const canvas = document.getElementById('fog-canvas');
    if (!canvas || typeof state === 'undefined' || !state.mapData || !state.mapData.length) return;

    const ctx = canvas.getContext('2d');
    const scale = canvas._scale || 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const w = canvas.width / scale, h = canvas.height / scale;
    ctx.clearRect(0, 0, w, h);

    const gridSize = fogGridSize();
    const isSt = (typeof myRole !== 'undefined' && myRole === 'st');

    if (isSt) {
        if (fogEditTool) drawFogEditPreview(ctx, gridSize);
        return;
    }
    if (!fogEnabled) return;

    const temp = fogRecomputeMyVisibility();

    for (let y = 0; y < state.mapH; y++) {
        for (let x = 0; x < state.mapW; x++) {
            const key = fogKey(x, y);
            if (fogRevealedMine[key]) continue; // 永久清除，不畫迷霧
            fogDrawCell(ctx, x * gridSize, y * gridSize, gridSize, x, y, t, temp.has(key));
        }
    }
}

/** 畫單一格的煙霧：灰白底色 + 隨時間緩慢飄移的柔和光斑，滑鼠靠近時翻騰幅度加大。 */
function fogDrawCell(ctx, px, py, size, gx, gy, t, isTemp) {
    const baseAlpha = isTemp ? FOG_TEMP_ALPHA : FOG_FULL_ALPHA;
    const hovering = !!(fogHoverCell && Math.abs(fogHoverCell.x - gx) <= 1 && Math.abs(fogHoverCell.y - gy) <= 1);
    const alpha = hovering ? baseAlpha * 0.8 : baseAlpha;

    ctx.fillStyle = `rgba(208, 210, 215, ${alpha})`;
    ctx.fillRect(px, py, size, size);

    const amp = hovering ? size * 0.34 : size * 0.16;
    const speed = hovering ? 1.7 : 0.55;
    const seed = gx * 12.9898 + gy * 78.233;

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, size, size);
    ctx.clip();

    for (let i = 0; i < 2; i++) {
        const phase = seed + i * 2.4;
        const ox = Math.sin(t * speed + phase) * amp;
        const oy = Math.cos(t * speed * 0.8 + phase) * amp;
        const cx = px + size / 2 + ox;
        const cy = py + size / 2 + oy;
        const r = size * (hovering ? 0.75 : 0.55);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(236, 237, 241, ${alpha * 0.5})`);
        grad.addColorStop(1, 'rgba(236, 237, 241, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(px, py, size, size);
    }
    ctx.restore();
}

/** ST 補畫模式的靜態預覽：已揭露格子用綠框標記，其餘用淡灰網底表示仍在迷霧中。 */
function drawFogEditPreview(ctx, size) {
    const target = fogEditTargetId;
    let revealedSets;
    if (target === 'all') {
        revealedSets = Object.values(fogRevealedAll || {});
    } else {
        revealedSets = fogRevealedAll && fogRevealedAll[target] ? [fogRevealedAll[target]] : [];
    }

    for (let y = 0; y < state.mapH; y++) {
        for (let x = 0; x < state.mapW; x++) {
            const key = fogKey(x, y);
            const revealed = revealedSets.some(s => s && s[key]);
            const px = x * size, py = y * size;
            if (revealed) {
                ctx.strokeStyle = 'rgba(102, 187, 106, 0.85)';
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 2, py + 2, size - 4, size - 4);
            } else {
                ctx.fillStyle = 'rgba(160, 160, 170, 0.22)';
                ctx.fillRect(px, py, size, size);
            }
        }
    }
}

// ===== 動畫迴圈（節流至約 12fps，足夠呈現緩慢翻滾感） =====
function fogAnimTick(ts) {
    fogAnimHandle = requestAnimationFrame(fogAnimTick);
    if (document.hidden) return;
    if (ts - fogLastDrawTs < 80) return;
    fogLastDrawTs = ts;
    drawFogCanvas(ts / 1000);
}
function fogStartAnim() {
    if (fogAnimHandle) return;
    fogAnimHandle = requestAnimationFrame(fogAnimTick);
}

/** 追蹤滑鼠所在格子，用於煙霧的懸停翻騰效果（被動追蹤，不攔截地圖操作）。 */
function fogInitHoverTracking() {
    window.addEventListener('pointermove', (e) => {
        if (typeof document === 'undefined') return;
        const vp = document.getElementById('map-viewport');
        if (!vp) return;
        const rect = vp.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
            fogHoverCell = null;
            return;
        }
        fogHoverCell = (typeof screenToGrid === 'function') ? screenToGrid(e.clientX, e.clientY) : null;
    });
}

// ===== ST 補畫工具（重用主地圖的繪製工具管線，見 map.js 的 handleMapInput） =====

/** 若目前工具是迷霧筆刷則處理並回傳 true（呼叫端應停止套用地形繪製）；否則回傳 false。 */
function fogHandleToolPaint(tool, x, y) {
    if (tool !== 'fog-reveal' && tool !== 'fog-hide') return false;
    if (typeof myRole === 'undefined' || myRole !== 'st') return true;
    if (typeof roomRef === 'undefined' || !roomRef) return true;

    const key = fogKey(x, y);
    const targets = fogEditTargetId === 'all'
        ? Object.keys((typeof state !== 'undefined' && state.players) || {})
        : [fogEditTargetId];

    if (!targets.length) {
        if (typeof showToast === 'function') showToast('房間內尚無玩家可編輯迷霧');
        return true;
    }

    targets.forEach(pid => {
        if (tool === 'fog-reveal') {
            roomRef.child(`fog/revealed/${pid}/${key}`).set(true);
            if (!fogRevealedAll[pid]) fogRevealedAll[pid] = {};
            fogRevealedAll[pid][key] = true;
        } else {
            roomRef.child(`fog/revealed/${pid}/${key}`).remove();
            if (fogRevealedAll[pid]) delete fogRevealedAll[pid][key];
        }
    });

    if (typeof drawFogCanvas === 'function') drawFogCanvas(performance.now() / 1000);
    return true;
}

function fogToggleEditTool(tool) {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    if (fogEditTool === tool) {
        fogEditTool = null;
        if (typeof setTool === 'function') setTool('cursor');
    } else {
        fogEditTool = tool;
        if (typeof setTool === 'function') setTool(tool);
    }
    fogRenderPanel();
    if (typeof drawFogCanvas === 'function') drawFogCanvas(performance.now() / 1000);
}

function fogSetEditTarget(id) {
    fogEditTargetId = id;
    if (fogEditTool && typeof drawFogCanvas === 'function') drawFogCanvas(performance.now() / 1000);
}

function fogResetTarget() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    if (typeof roomRef === 'undefined' || !roomRef) return;

    const target = fogEditTargetId;
    const label = target === 'all' ? '所有玩家' : ((state.players && state.players[target] && state.players[target].name) || target);
    if (!confirm(`確定要重置「${label}」的迷霧記錄嗎？（已探索的區域會全部恢復成未探索）`)) return;

    if (target === 'all') {
        roomRef.child('fog/revealed').remove();
        fogRevealedAll = {};
        fogRevealedMine = {};
    } else {
        roomRef.child('fog/revealed/' + target).remove();
        if (fogRevealedAll[target]) delete fogRevealedAll[target];
        if (myPlayerId === target) fogRevealedMine = {};
    }

    if (typeof showToast === 'function') showToast(`已重置「${label}」的迷霧`);
    if (typeof drawFogCanvas === 'function') drawFogCanvas(performance.now() / 1000);
}

// ===== 面板開關（浮動面板，與侵蝕控制台相同的收納/拖曳機制） =====

function toggleFogHud() {
    if (typeof myRole === 'undefined' || myRole !== 'st') {
        if (typeof showToast === 'function') showToast('只有 ST 可以管理戰爭迷霧');
        return;
    }
    const hud = document.getElementById('fog-hud');
    if (!hud) return;
    if (typeof PanelDock !== 'undefined' && PanelDock.isDocked('fog-hud')) {
        PanelDock.restore('fog-hud');
        fogRenderPanel();
        hud.classList.remove('hidden');
        return;
    }
    if (hud.classList.contains('hidden')) {
        fogRenderPanel();
        hud.classList.remove('hidden');
        if (typeof WindowManager !== 'undefined') WindowManager.bringToFront(hud);
    } else {
        hud.classList.add('hidden');
    }
}

function closeFogHud() {
    const hud = document.getElementById('fog-hud');
    if (hud) hud.classList.add('hidden');
    if (fogEditTool) {
        fogEditTool = null;
        if (typeof setTool === 'function') setTool('cursor');
        if (typeof drawFogCanvas === 'function') drawFogCanvas(performance.now() / 1000);
    }
}

/** 初始化：戰爭迷霧管理面板接上通用浮動面板（拖曳／雙擊收起／右緣磁鐵收納）。 */
function fogInitFloatPanel() {
    if (typeof makeFloatingPanel !== 'function') return;
    makeFloatingPanel({
        panelId: 'fog-hud',
        headerId: 'fog-hud-header',
        collapseBtnId: 'fog-hud-collapse',
        storageKey: 'limbus_fog_hud_panel',
        defaultPos: { x: Math.max(20, window.innerWidth - 370), y: Math.max(60, window.innerHeight - 420) },
        dock: { icon: '🌫️', title: '戰爭迷霧管理' },
        restoreDock: true,
    });
}

function fogRenderPanel() {
    const body = document.getElementById('fog-hud-body');
    if (!body) return;

    const players = (typeof state !== 'undefined' && state.players) || {};
    const playerEntries = Object.entries(players);
    const sharedUnits = (typeof state !== 'undefined' && Array.isArray(state.units))
        ? state.units.filter(u => u.sharedVision === true) : [];

    body.innerHTML = `
        <div class="fog-section">
            <label class="fog-toggle-row">
                <input type="checkbox" id="fog-enabled-toggle" ${fogEnabled ? 'checked' : ''} onchange="fogSetEnabled(this.checked)">
                <span>啟用戰爭迷霧</span>
            </label>
            <p class="fog-hint">開啟後，玩家只能看見自己棋子周圍 1 格的視野；棋子踏入過的格子會永久清除迷霧。棋子不在場上時完全沒有視野。ST 視角不受影響。</p>
        </div>
        <div class="fog-section">
            <div class="fog-section-title">🖌️ 補畫／重置</div>
            <div class="fog-field">
                <label>編輯對象</label>
                <select id="fog-target-select" class="fog-select" onchange="fogSetEditTarget(this.value)"></select>
            </div>
            <div class="fog-btn-row">
                <button class="fog-btn ${fogEditTool === 'fog-hide' ? 'active' : ''}" onclick="fogToggleEditTool('fog-hide')">🌫️ 補畫迷霧（隱藏）</button>
                <button class="fog-btn ${fogEditTool === 'fog-reveal' ? 'active' : ''}" onclick="fogToggleEditTool('fog-reveal')">🔅 手動顯示（清除）</button>
            </div>
            <button class="fog-btn fog-btn-reset" onclick="fogResetTarget()">🔄 重置此對象的迷霧記錄</button>
        </div>
        <div class="fog-section">
            <div class="fog-section-title">📡 分享視野中的物體</div>
            <div id="fog-shared-list" class="fog-shared-list"></div>
            <p class="fog-hint">在地圖上對任一棋子按右鍵，選擇「分享視野給全員」即可讓所有玩家共用該棋子（例如船隻）周圍的視野。</p>
        </div>
    `;

    const sel = document.getElementById('fog-target-select');
    if (sel) {
        sel.textContent = '';
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = '（全部玩家）';
        sel.appendChild(allOpt);
        playerEntries.forEach(([pid, p]) => {
            const opt = document.createElement('option');
            opt.value = pid;
            opt.textContent = (p && p.name) || pid;
            sel.appendChild(opt);
        });
        sel.value = (fogEditTargetId === 'all' || players[fogEditTargetId]) ? fogEditTargetId : 'all';
    }

    const sharedBox = document.getElementById('fog-shared-list');
    if (sharedBox) {
        sharedBox.textContent = '';
        if (!sharedUnits.length) {
            const empty = document.createElement('div');
            empty.className = 'log-empty';
            empty.textContent = '目前沒有共享視野的物體。';
            sharedBox.appendChild(empty);
        } else {
            sharedUnits.forEach(u => {
                const row = document.createElement('div');
                row.className = 'fog-shared-row';
                const name = document.createElement('span');
                name.textContent = u.name || u.id;
                row.appendChild(name);
                const btn = document.createElement('button');
                btn.className = 'lv-btn lv-btn-del';
                btn.textContent = '取消分享';
                btn.addEventListener('click', () => { if (typeof toggleUnitSharedVision === 'function') toggleUnitSharedVision(u.id); });
                row.appendChild(btn);
                sharedBox.appendChild(row);
            });
        }
    }
}

// ===== 初始化 =====
function fogInit() {
    fogInitFloatPanel();
    fogInitHoverTracking();
    fogStartAnim();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fogInit);
} else {
    fogInit();
}

// ===== Window bindings =====
if (typeof window !== 'undefined') {
    window.fogSetupListener = fogSetupListener;
    window.fogGateUI = fogGateUI;
    window.fogSetEnabled = fogSetEnabled;
    window.fogHandleToolPaint = fogHandleToolPaint;
    window.fogToggleEditTool = fogToggleEditTool;
    window.fogSetEditTarget = fogSetEditTarget;
    window.fogResetTarget = fogResetTarget;
    window.toggleFogHud = toggleFogHud;
    window.closeFogHud = closeFogHud;
    window.fogRenderPanel = fogRenderPanel;
    window.ensureFogCanvas = ensureFogCanvas;
    window.drawFogCanvas = drawFogCanvas;
}

console.log('🌫️ 戰爭迷霧模組已載入');

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

const FOG_TEMP_ALPHA = 0.5;  // 暫時視野（半透明）
const FOG_FULL_ALPHA = 0.88; // 完全未探索
const FOG_MASK_CELL_PX = 16; // 遮罩畫布每格的像素數（刻意降解析度，配合模糊營造柔和邊界，效能也更省）
const FOG_MASK_BLUR_PX = 11; // 遮罩模糊半徑：讓格子邊界暈開，不再稜角分明

// ===== 本機狀態 =====
let fogEnabled = false;
let fogRevealedMine = {};   // 我方（本客戶端玩家）永久揭露的格子：{ "x,y": true }
let fogRevealedAll = {};    // 僅 ST 快取：{ playerId: { "x,y": true } }，用於補畫工具預覽
let fogEditTool = null;     // null | 'fog-reveal' | 'fog-hide'（ST 補畫工具目前選取的筆刷）
let fogEditTargetId = 'all'; // ST 選擇要編輯的玩家 id，或 'all'
let fogStPreview = false;   // ST 專用：預覽「編輯對象」玩家會看到的迷霧畫面（唯讀，不影響實際迷霧資料）
let fogAnimHandle = null;
let fogHoverCell = null;    // 目前滑鼠所在格子座標（整數，用於決定翻騰強化範圍）
let fogHoverPx = null;      // 目前滑鼠在地圖上的精確像素座標（連續值，用於柔和的擾動/擴散效果）
let fogLastDrawTs = 0;
let fogMaskRawCanvas = null;  // 未模糊的每格透明度遮罩（離屏畫布）
let fogMaskBlurCanvas = null; // 模糊後的遮罩（離屏畫布），套用在雲霧材質上決定實際能見度

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
        if (fogStPreview && fogEditTargetId !== 'all') {
            drawFogPreviewAsPlayer(ctx, w, h, t, fogEditTargetId);
        } else if (fogEditTool) {
            drawFogEditPreview(ctx, gridSize);
        }
        return;
    }
    if (!fogEnabled) return;

    const temp = fogRecomputeMyVisibility();
    const alphaGrid = fogBuildAlphaGrid(fogRevealedMine, temp);
    fogDrawCloudLayer(ctx, w, h, t, alphaGrid);
}

/**
 * 依「永久揭露」與「暫時視野」兩個集合，算出每一格的目標透明度（0=完全看得到，
 * FOG_FULL_ALPHA=完全未探索）。這份格狀資料之後會被模糊化，讓格線消失、只留下
 * 一片連續的濃淡變化，不會再有稜角分明的方塊感。
 */
function fogBuildAlphaGrid(revealedSet, tempSet) {
    const grid = [];
    for (let y = 0; y < state.mapH; y++) {
        const row = [];
        for (let x = 0; x < state.mapW; x++) {
            const key = fogKey(x, y);
            let a;
            if (revealedSet && revealedSet[key]) a = 0;
            else if (tempSet.has(key)) a = FOG_TEMP_ALPHA;
            else a = FOG_FULL_ALPHA;
            row.push(a);
        }
        grid.push(row);
    }
    return grid;
}

/** 確保遮罩用的離屏畫布存在，尺寸依地圖大小調整（刻意用較低解析度，模糊後更省效能）。 */
function ensureFogMaskCanvases() {
    if (!fogMaskRawCanvas) fogMaskRawCanvas = document.createElement('canvas');
    if (!fogMaskBlurCanvas) fogMaskBlurCanvas = document.createElement('canvas');
    const w = Math.max(1, Math.round(state.mapW * FOG_MASK_CELL_PX));
    const h = Math.max(1, Math.round(state.mapH * FOG_MASK_CELL_PX));
    if (fogMaskRawCanvas.width !== w || fogMaskRawCanvas.height !== h) {
        fogMaskRawCanvas.width = w;
        fogMaskRawCanvas.height = h;
    }
    if (fogMaskBlurCanvas.width !== w || fogMaskBlurCanvas.height !== h) {
        fogMaskBlurCanvas.width = w;
        fogMaskBlurCanvas.height = h;
    }
    return { raw: fogMaskRawCanvas, blur: fogMaskBlurCanvas };
}

/**
 * 把每格的透明度畫成一張小尺寸遮罩，再用模糊濾鏡暈開格線——這就是「不再稜角分明」
 * 的關鍵：遮罩本身已經是柔和的濃淡漸層，之後拿它去裁切雲霧材質，邊界自然是暈開的，
 * 而不是每一格各自獨立的方塊。
 */
function fogBuildBlurredMask(alphaGrid) {
    const { raw, blur } = ensureFogMaskCanvases();
    const rawCtx = raw.getContext('2d');
    rawCtx.setTransform(1, 0, 0, 1, 0, 0);
    rawCtx.clearRect(0, 0, raw.width, raw.height);
    rawCtx.fillStyle = '#fff';
    for (let y = 0; y < state.mapH; y++) {
        for (let x = 0; x < state.mapW; x++) {
            const a = alphaGrid[y][x];
            if (a <= 0) continue;
            rawCtx.globalAlpha = a;
            rawCtx.fillRect(x * FOG_MASK_CELL_PX, y * FOG_MASK_CELL_PX, FOG_MASK_CELL_PX + 1, FOG_MASK_CELL_PX + 1);
        }
    }
    rawCtx.globalAlpha = 1;

    const blurCtx = blur.getContext('2d');
    blurCtx.setTransform(1, 0, 0, 1, 0, 0);
    blurCtx.clearRect(0, 0, blur.width, blur.height);
    blurCtx.filter = `blur(${FOG_MASK_BLUR_PX}px)`;
    blurCtx.drawImage(raw, 0, 0);
    blurCtx.filter = 'none';
    return blur;
}

/**
 * 在遮罩上挖出滑鼠所在處的柔和缺口，模擬「手撥開霧氣」的擾動／擴散感——
 * 霧氣被撥開的地方會暫時變得比較透明，而不是整格瞬間消失或不變。
 */
function fogApplyHoverDisturbance(blurCanvas) {
    if (!fogHoverPx) return;
    const blurCtx = blurCanvas.getContext('2d');
    const gridSize = fogGridSize();
    const toMask = FOG_MASK_CELL_PX / gridSize;
    const cx = fogHoverPx.x * toMask;
    const cy = fogHoverPx.y * toMask;
    const r = FOG_MASK_CELL_PX * 2.1;

    blurCtx.save();
    blurCtx.globalCompositeOperation = 'destination-out';
    const grad = blurCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    blurCtx.fillStyle = grad;
    blurCtx.beginPath();
    blurCtx.arc(cx, cy, r, 0, Math.PI * 2);
    blurCtx.fill();
    blurCtx.restore();
}

/**
 * 畫出一片連續飄流的雲霧材質，範圍橫跨整張地圖、不受格子邊界限制——多團柔和光斑
 * 以各自的相位緩慢飄移、彼此重疊，營造「身在霧氣中、霧氣繚繞」的流動感；滑鼠附近
 * 的光斑會暫時放大翻騰幅度與速度，呈現被擾動的樣子。畫完後用模糊遮罩裁切能見度。
 */
function fogDrawCloudLayer(ctx, w, h, t, alphaGrid) {
    ctx.save();

    // 基礎柔霧色調（之後會被遮罩裁切出濃淡分佈，本身不分格子）
    ctx.fillStyle = 'rgba(205, 208, 213, 1)';
    ctx.fillRect(0, 0, w, h);

    const gridSize = fogGridSize();
    const spacing = gridSize * 1.7; // 光斑基準間距：刻意跟格線錯開分佈，避免視覺上又對齊回格子
    const nx = Math.max(1, Math.ceil(w / spacing) + 2);
    const ny = Math.max(1, Math.ceil(h / spacing) + 2);

    for (let iy = -1; iy < ny; iy++) {
        for (let ix = -1; ix < nx; ix++) {
            const seed = (ix * 12.9898 + iy * 78.233) * 43758.5453 % 1;
            const baseX = ix * spacing + seed * spacing * 0.6;
            const baseY = iy * spacing + (1 - seed) * spacing * 0.6;

            const distToHover = fogHoverPx ? Math.hypot(baseX - fogHoverPx.x, baseY - fogHoverPx.y) : Infinity;
            const hovering = distToHover < gridSize * 2.6;

            const phase = seed * 62.8;
            const amp = hovering ? gridSize * 1.0 : gridSize * 0.55;
            const speed = hovering ? 1.4 : 0.32 + seed * 0.2;
            const ox = Math.sin(t * speed + phase) * amp;
            const oy = Math.cos(t * speed * 0.82 + phase * 1.3) * amp;
            const cx = baseX + ox;
            const cy = baseY + oy;
            const r = spacing * (hovering ? 1.05 : 0.85);
            const puffAlpha = hovering ? 0.32 : 0.18 + seed * 0.08;

            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            grad.addColorStop(0, `rgba(240, 241, 245, ${puffAlpha})`);
            grad.addColorStop(1, 'rgba(240, 241, 245, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
    }
    ctx.restore();

    // 用模糊後的每格能見度遮罩裁切雲霧：destination-in 會讓結果透明度 = 雲霧本身 × 遮罩，
    // 遮罩本身已模糊過，邊界自然是暈開的濃淡漸層，不是硬邊方塊。
    const blurCanvas = fogBuildBlurredMask(alphaGrid);
    fogApplyHoverDisturbance(blurCanvas);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(blurCanvas, 0, 0, blurCanvas.width, blurCanvas.height, 0, 0, w, h);
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

/**
 * ST 專用「預覽玩家視角」：唯讀模擬指定玩家實際會看到的動態煙霧畫面，
 * 不寫入任何揭露資料，純粹讓 ST 不必另開玩家分頁就能確認迷霧效果。
 */
function drawFogPreviewAsPlayer(ctx, w, h, t, targetId) {
    if (!fogEnabled) return; // 迷霧未啟用時，玩家本來就看不到任何迷霧，預覽維持一致（清空畫布）

    const revealed = (fogRevealedAll && fogRevealedAll[targetId]) || {};
    const sources = (typeof state !== 'undefined' && Array.isArray(state.units))
        ? state.units.filter(u => u && u.x >= 0 && u.y >= 0 && (u.ownerId === targetId || u.sharedVision === true))
        : [];

    const temp = new Set();
    sources.forEach(u => {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const x = u.x + dx, y = u.y + dy;
                if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue;
                temp.add(fogKey(x, y));
            }
        }
    });

    const alphaGrid = fogBuildAlphaGrid(revealed, temp);
    fogDrawCloudLayer(ctx, w, h, t, alphaGrid);
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

/**
 * 追蹤滑鼠在地圖上的精確位置（被動追蹤，不攔截地圖操作），同時記錄格子座標
 * （fogHoverCell，決定翻騰增強範圍）與連續像素座標（fogHoverPx，讓擾動/擴散
 * 效果的中心點平滑跟著游標移動，不會卡在格子邊界跳格）。
 */
function fogInitHoverTracking() {
    window.addEventListener('pointermove', (e) => {
        if (typeof document === 'undefined') return;
        const vp = document.getElementById('map-viewport');
        const grid = document.getElementById('battle-map');
        if (!vp || !grid) return;
        const rect = vp.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
            fogHoverCell = null;
            fogHoverPx = null;
            return;
        }
        fogHoverCell = (typeof screenToGrid === 'function') ? screenToGrid(e.clientX, e.clientY) : null;

        const gridRect = grid.getBoundingClientRect();
        const camScale = (typeof cam !== 'undefined' && cam.scale) ? cam.scale : 1;
        fogHoverPx = {
            x: (e.clientX - gridRect.left) / camScale,
            y: (e.clientY - gridRect.top) / camScale,
        };
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
        fogStPreview = false; // 補畫模式跟預覽模式互斥，避免畫面顯示衝突
        if (typeof setTool === 'function') setTool(tool);
    }
    fogRenderPanel();
    if (typeof drawFogCanvas === 'function') drawFogCanvas(performance.now() / 1000);
}

function fogSetEditTarget(id) {
    fogEditTargetId = id;
    if ((fogEditTool || fogStPreview) && typeof drawFogCanvas === 'function') drawFogCanvas(performance.now() / 1000);
}

/**
 * ST 專用：切換「預覽玩家視角」。開啟後 ST 自己的地圖畫面會即時模擬
 * 「編輯對象」選取的那位玩家實際看到的動態迷霧，純預覽、不寫入任何資料，
 * 不需要另開分頁／請玩家協助測試就能立刻確認迷霧效果。
 */
function fogSetStPreview(on) {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    if (on && fogEditTargetId === 'all') {
        if (typeof showToast === 'function') showToast('請先在下方「編輯對象」選一位玩家，才能預覽該玩家的視角');
        fogRenderPanel();
        return;
    }
    fogStPreview = !!on;
    if (fogStPreview && fogEditTool) {
        fogEditTool = null;
        if (typeof setTool === 'function') setTool('cursor');
    }
    fogRenderPanel();
    if (typeof drawFogCanvas === 'function') drawFogCanvas(performance.now() / 1000);
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
            <div class="fog-field">
                <label>編輯／預覽對象</label>
                <select id="fog-target-select" class="fog-select" onchange="fogSetEditTarget(this.value)"></select>
            </div>
            <label class="fog-toggle-row fog-preview-row">
                <input type="checkbox" id="fog-preview-toggle" ${fogStPreview ? 'checked' : ''} onchange="fogSetStPreview(this.checked)">
                <span>🕵️ 在我（ST）的畫面預覽此玩家看到的迷霧</span>
            </label>
            <p class="fog-hint fog-hint-warn">ST 視角預設不受迷霧限制，不會自動顯示煙霧——想確認效果，請選一位玩家並勾選上方的預覽。</p>
        </div>
        <div class="fog-section">
            <div class="fog-section-title">🖌️ 補畫／重置</div>
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
    window.fogSetStPreview = fogSetStPreview;
    window.fogResetTarget = fogResetTarget;
    window.toggleFogHud = toggleFogHud;
    window.closeFogHud = closeFogHud;
    window.fogRenderPanel = fogRenderPanel;
    window.ensureFogCanvas = ensureFogCanvas;
    window.drawFogCanvas = drawFogCanvas;
}

console.log('🌫️ 戰爭迷霧模組已載入');

/**
 * Limbus Command - 戰爭迷霧
 *
 * 職責：灰白色煙霧疊加層，蓋在地圖 Token 之上。
 *   - 玩家視角：只看得到自己（ownerId 相符）棋子周圍 1 格半徑的暫時視野（半透明），
 *     棋子「踏入」過的格子則永久清除迷霧；棋子不在場上（未部署）時完全沒有視野。
 *   - ST 視角：平時完全看不到迷霧（看得到整張地圖）。當 ST 在地圖上「選中某個玩家的棋子」
 *     時，畫面會即時切換成該玩家的視角（顯示該玩家看到的迷霧）；取消選取就恢復無霧。
 *   - ST 可用「補畫」工具手動調整指定玩家（或全部玩家）的已探索紀錄，也可整個重置。
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

const FOG_TEMP_ALPHA = 0.5;  // 暫時視野（半透明，站在附近但還沒踏進去）
const FOG_FULL_ALPHA = 0.985; // 完全未探索：幾乎不透明，看不到底下的地形顏色
const FOG_MASK_CELL_PX = 16; // 遮罩畫布每格的像素數（刻意降解析度，配合模糊營造柔和邊界，效能也更省）
const FOG_MASK_BLUR_PX = 11; // 遮罩模糊半徑：讓格子邊界暈開，不再稜角分明
const FOG_MAX_CANVAS_DIM = 4096; // 迷霧 canvas 單邊像素上限，避免大地圖在行動裝置上配置失敗導致整片迷霧不顯示

// ===== 本機狀態 =====
let fogEnabled = false;
let fogRevealedMine = {};   // 我方（本客戶端玩家）永久揭露的格子：{ "x,y": true }
let fogRevealedAll = {};    // 僅 ST 快取：{ playerId: { "x,y": true } }，供 ST 檢視玩家視角／補畫使用
let fogEditTool = null;     // null | 'fog-reveal' | 'fog-hide'（ST 補畫工具目前選取的筆刷）
let fogEditTargetId = 'all'; // ST 補畫／重置的對象玩家 id，或 'all'
let fogAnimHandle = null;
let fogLastDrawTs = 0;
let fogMaskRawCanvas = null;  // 未模糊的每格透明度遮罩（離屏畫布）
let fogMaskBlurCanvas = null; // 模糊後的遮罩（離屏畫布），套用在雲霧材質上決定實際能見度

// ===== 效能快取 =====
// 模糊遮罩很貴（每格填色 + canvas blur 濾鏡），但它只在「探索紀錄」或「棋子位置」變動時
// 才會改變；平時每幀只需重畫飄動的雲霧再套用同一張快取遮罩即可，不必每幀重建。
let fogRevealRev = 0;         // 探索紀錄的版本號：任一揭露/隱藏/重置都會 +1，用來判斷遮罩是否需重建
let fogMaskCacheSig = null;   // 上次建好的遮罩對應的簽章
let fogMaskCacheCanvas = null;// 快取的模糊遮罩畫布
let fogPuffSprite = null;     // 預先渲染一次的柔霧光斑，之後每幀只 drawImage 貼上，不再每幀建立漸層
let fogWasDrawn = false;      // 上一幀是否有畫出霧（沒有要畫時可完全跳過，避免空轉造成的重排）

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
        // ST 快取所有玩家的揭露資料，供檢視玩家視角／補畫使用
        const allListener = roomRef.child('fog/revealed').on('value', snapshot => {
            fogRevealedAll = snapshot.val() || {};
            fogRevealRev++;
        });
        if (typeof unsubscribeListeners !== 'undefined') {
            unsubscribeListeners.push(() => roomRef.child('fog/revealed').off('value', allListener));
        }
    } else if (typeof myPlayerId !== 'undefined' && myPlayerId) {
        const mineListener = roomRef.child('fog/revealed/' + myPlayerId).on('value', snapshot => {
            fogRevealedMine = snapshot.val() || {};
            fogRevealRev++;
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

/** 取得某玩家的視野來源：他擁有的、以及任何標記「分享視野」的在場棋子。 */
function fogGetVisionSourcesFor(playerId) {
    if (typeof state === 'undefined' || !Array.isArray(state.units)) return [];
    return state.units.filter(u => u && u.x >= 0 && u.y >= 0 &&
        (u.ownerId === playerId || u.sharedVision === true));
}

/**
 * 計算指定玩家目前的暫時視野（每個來源棋子周圍 3x3），回傳 key 集合。
 * @param {string} playerId
 * @param {boolean} persist true 時把來源棋子所在格寫回該玩家的永久揭露紀錄（僅本人端使用）
 */
function fogComputeVisibility(playerId, persist) {
    const temp = new Set();
    if (typeof state === 'undefined' || !state.mapData) return temp;

    const sources = fogGetVisionSourcesFor(playerId);
    const newlyRevealed = [];

    sources.forEach(u => {
        // u.x/u.y 是棋子佔地的左上角格（大型棋子往右／往下延伸 size 格，見 map.js 的 token 定位邏輯），
        // 視野環必須以整個佔地範圍向外擴 1 格，而非只從左上角格取 3x3，否則大型棋子的視野／揭露
        // 會在右／下側缺一圈（左／上側卻正常有緩衝），形成不對稱的視野破洞。
        const unitSize = u.size || 1;
        for (let dy = -1; dy <= unitSize; dy++) {
            for (let dx = -1; dx <= unitSize; dx++) {
                const x = u.x + dx, y = u.y + dy;
                if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue;
                temp.add(fogKey(x, y));
            }
        }
        if (persist) {
            for (let dy = 0; dy < unitSize; dy++) {
                for (let dx = 0; dx < unitSize; dx++) {
                    const ownKey = fogKey(u.x + dx, u.y + dy);
                    if (!fogRevealedMine[ownKey]) newlyRevealed.push(ownKey);
                }
            }
        }
    });

    if (persist && newlyRevealed.length && typeof roomRef !== 'undefined' && roomRef && myPlayerId) {
        const updates = {};
        newlyRevealed.forEach(k => { updates[k] = true; fogRevealedMine[k] = true; });
        fogRevealRev++;
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
    if (!grid || typeof state === 'undefined' || !state.mapW || !state.mapH) return null;

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
    } else if (canvas.parentNode !== grid) {
        // renderMap 的防呆分支可能整個重設 #battle-map，導致 canvas 被移除；重新掛回
        grid.appendChild(canvas);
    }

    const gridSize = fogGridSize();
    const pxW = state.mapW * gridSize;
    const pxH = state.mapH * gridSize;
    // 只在尺寸真的變動時才寫 style，避免每幀觸發不必要的版面重排（layout thrash）
    if (canvas._cssW !== pxW) { canvas.style.width = pxW + 'px'; canvas._cssW = pxW; }
    if (canvas._cssH !== pxH) { canvas.style.height = pxH + 'px'; canvas._cssH = pxH; }

    // 解析度考量 devicePixelRatio，但夾住單邊上限（與 map-canvas 一致），避免大地圖配置失敗變成整片空白
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderScale = Math.min(dpr, FOG_MAX_CANVAS_DIM / Math.max(pxW, pxH, 1));
    const bw = Math.max(1, Math.round(pxW * renderScale));
    const bh = Math.max(1, Math.round(pxH * renderScale));
    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
    }
    canvas._scale = renderScale;
    return canvas;
}

/**
 * 目前 ST 若選中了某個「玩家的棋子」，回傳該玩家 id（用來把 ST 畫面切成該玩家視角）；
 * 沒選、或選的不是玩家棋子則回傳 null。
 */
function fogSelectedPlayerId() {
    if (typeof selectedUnitId === 'undefined' || selectedUnitId == null) return null;
    const u = (typeof findUnitById === 'function') ? findUnitById(selectedUnitId) : null;
    if (!u || !u.ownerId) return null;
    if (String(u.ownerId).startsWith('st_')) return null; // ST 自己的棋子不算玩家視角
    return u.ownerId;
}

/**
 * 主繪製函式（由動畫迴圈每幀呼叫）：
 *   - 玩家：畫出自己的動態煙霧。
 *   - ST：平時清空（看得見整張地圖）；補畫模式顯示揭露預覽；選中玩家棋子時顯示該玩家視角。
 * 為了不依賴 renderMap 的時機，這裡自己 ensureFogCanvas，確保 canvas 一定存在。
 */
function drawFogCanvas(t) {
    if (typeof state === 'undefined' || !state.mapData || !state.mapData.length) return;

    // 先用最便宜的判斷決定這一幀「要不要畫、畫什麼」，避免在沒霧可畫時還去動 canvas。
    const isSt = (typeof myRole !== 'undefined' && myRole === 'st');
    let mode = null;          // null | 'edit' | 'player'
    let viewedId = null;
    if (isSt) {
        if (fogEditTool) {
            mode = 'edit';                              // 補畫模式：顯示揭露預覽
        } else if (fogEnabled) {
            viewedId = fogSelectedPlayerId();           // 選中玩家棋子 → 切成該玩家視角
            if (viewedId) mode = 'player';
        }
    } else if (fogEnabled) {
        mode = 'player';
        viewedId = (typeof myPlayerId !== 'undefined') ? myPlayerId : null;
        if (!viewedId) mode = null;
    }

    if (!mode) {
        // 這一幀沒有霧要畫。若上一幀畫過，清空一次即可，之後就完全待機（不再每幀動 canvas）。
        if (fogWasDrawn) {
            const c = document.getElementById('fog-canvas');
            if (c) {
                const cx = c.getContext('2d');
                cx.setTransform(1, 0, 0, 1, 0, 0);
                cx.clearRect(0, 0, c.width, c.height);
            }
            fogWasDrawn = false;
        }
        return;
    }

    const canvas = ensureFogCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const scale = canvas._scale || 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const w = canvas.width / scale, h = canvas.height / scale;
    ctx.clearRect(0, 0, w, h);

    if (mode === 'edit') {
        drawFogEditPreview(ctx, fogGridSize());
    } else if (isSt) {
        // ST 檢視玩家視角：唯讀，不寫入任何揭露資料。
        const revealed = (fogRevealedAll && fogRevealedAll[viewedId]) || {};
        const temp = fogComputeVisibility(viewedId, false);
        fogDrawCloudLayer(ctx, w, h, t, revealed, temp, 'st:' + viewedId);
    } else {
        const temp = fogComputeVisibility(myPlayerId, true);
        fogDrawCloudLayer(ctx, w, h, t, fogRevealedMine, temp, 'me:' + myPlayerId);
    }
    fogWasDrawn = true;
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
 * 取得（必要時才重建）模糊過的能見度遮罩。遮罩只在探索紀錄（fogRevealRev）或棋子位置
 * （tempSet）改變時才需要重建；否則直接沿用上次的快取，省下每幀最貴的填格 + blur 濾鏡。
 */
function fogGetBlurredMask(revealedSet, tempSet, viewId) {
    // 簽章：視角 + 地圖尺寸 + 探索版本 + 目前所有暫時視野格（棋子移動時才會變）。
    const tempSig = tempSet.size ? Array.from(tempSet).sort().join(';') : '';
    const sig = viewId + '|' + state.mapW + 'x' + state.mapH + '|' + fogRevealRev + '|' + tempSig;
    if (fogMaskCacheSig === sig && fogMaskCacheCanvas) return fogMaskCacheCanvas;

    const alphaGrid = fogBuildAlphaGrid(revealedSet, tempSet);
    fogMaskCacheCanvas = fogBuildBlurredMask(alphaGrid);
    fogMaskCacheSig = sig;
    return fogMaskCacheCanvas;
}

/** 預先渲染一次的柔霧光斑（白色徑向漸層）。之後每幀只需 drawImage 貼上並調整 globalAlpha。 */
function fogGetPuffSprite() {
    if (fogPuffSprite) return fogPuffSprite;
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(240, 241, 245, 1)');
    grad.addColorStop(1, 'rgba(240, 241, 245, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    fogPuffSprite = c;
    return c;
}

/**
 * 畫出一片連續飄流的雲霧材質，範圍橫跨整張地圖、不受格子邊界限制——多團柔和光斑
 * 以各自的相位緩慢飄移、彼此重疊，營造「身在霧氣中、霧氣繚繞」的流動感。畫完後用
 * 模糊過的每格能見度遮罩裁切，邊界自然是暈開的濃淡漸層，不是硬邊方塊。
 */
function fogDrawCloudLayer(ctx, w, h, t, revealedSet, tempSet, viewId) {
    ctx.save();

    // 基礎柔霧色調（之後會被遮罩裁切出濃淡分佈，本身不分格子）
    ctx.fillStyle = 'rgba(205, 208, 213, 1)';
    ctx.fillRect(0, 0, w, h);

    const gridSize = fogGridSize();
    const spacing = gridSize * 1.7; // 光斑基準間距：刻意跟格線錯開分佈，避免視覺上又對齊回格子
    const nx = Math.max(1, Math.ceil(w / spacing) + 2);
    const ny = Math.max(1, Math.ceil(h / spacing) + 2);
    const sprite = fogGetPuffSprite();   // 每幀重用同一張預渲染光斑，不再每幀建立漸層物件
    const r = spacing * 0.85;
    const amp = gridSize * 0.55;

    for (let iy = -1; iy < ny; iy++) {
        for (let ix = -1; ix < nx; ix++) {
            const seed = (ix * 12.9898 + iy * 78.233) * 43758.5453 % 1;
            const baseX = ix * spacing + seed * spacing * 0.6;
            const baseY = iy * spacing + (1 - seed) * spacing * 0.6;

            const phase = seed * 62.8;
            const speed = 0.32 + seed * 0.2;
            const cx = baseX + Math.sin(t * speed + phase) * amp;
            const cy = baseY + Math.cos(t * speed * 0.82 + phase * 1.3) * amp;

            ctx.globalAlpha = 0.18 + seed * 0.08;
            ctx.drawImage(sprite, cx - r, cy - r, r * 2, r * 2);
        }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    const blurCanvas = fogGetBlurredMask(revealedSet, tempSet, viewId);
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
    fogRevealRev++;

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
    fogRevealRev++;

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
            <p class="fog-hint">開啟後，玩家只能看見自己棋子周圍 1 格的視野；棋子踏入過的格子會永久清除迷霧，棋子不在場上時完全沒有視野。</p>
            <p class="fog-hint fog-hint-tip">👁️ ST 平時看得見整張地圖；<b>在地圖上點選某個玩家的棋子</b>，畫面就會切換成該玩家的視角，取消選取即恢復。</p>
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

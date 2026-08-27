/**
 * Limbus Command - AI 地圖畫布助手
 *
 * 職責：常駐的懸浮面板，左邊聊天、右邊是一塊獨立的「畫布」（不是正式地圖，是安全的草稿區）。
 * ST 跟 AI 討論想要的地圖版面，AI 每次回覆直接把建議畫進畫布（新增地形種類／在畫布格子上
 * 標記地形），可以自由來回調整、完全不影響正式地圖。畫布滿意後存成「地圖庫」裡一筆有名字
 * 的紀錄，之後隨時可以：套用到正式地圖（覆蓋現有版面，套用前會提示確認）、載回畫布繼續編輯、
 * 複製成新的一份、改名、刪除。
 *
 * 沿用「人格鍛造爐」/「怪物庫」的 AI 連線設定（同一組 localStorage 金鑰）。
 * 權限分離：僅 ST 可開啟與操作，玩家看不到入口。
 * 防禦性：所有 Firebase / DOM / AI 操作皆以 typeof 與 try-catch 防呆，絕不影響地圖與單位同步。
 */

// ===== AI 連線設定（沿用既有金鑰）=====
const MAI_AI_ENDPOINT_KEY = 'limbus-ai-endpoint';
const MAI_AI_KEY_KEY = 'limbus-ai-key';
const MAI_AI_MODEL_KEY = 'limbus-ai-model';
const MAI_AI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MAI_AI_DEFAULT_MODEL = 'gpt-4o-mini';
const MAI_MAX_CELLS_IN_CONTEXT = 500; // 序列化畫布給 AI 時，非地板格子的上限（避免超大畫布 token 爆量）
const MAI_DEFAULT_CANVAS_SIZE = 15;
const MAI_MAP_LIB_KEY = 'limbus-map-library';
const MAI_MAP_LIB_BACKUP_KEY = 'limbus-map-library-backup'; // 本機地圖庫「變少」前的自動備份（最後防線）

function maiGetSetting(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}

// ===== 對話狀態（僅存在本機記憶體，重整頁面即清空，符合「臨時討論」定位）=====
let maiMessages = []; // [{ role: 'user'|'assistant'|'system', text }]
let maiBusy = false;

// ===== 畫布狀態（獨立於正式地圖 state.mapData／state.mapPalette）=====
let maiCanvas = maiCreateEmptyCanvas(MAI_DEFAULT_CANVAS_SIZE, MAI_DEFAULT_CANVAS_SIZE);
let maiLoadedLibraryId = null; // 目前畫布是從地圖庫哪一筆載入的（null = 全新畫布，「儲存」時只能存為新的一筆）

// ===== 手動繪製狀態（ST 也能直接動手畫，不必只靠 AI）=====
let maiSelectedTool = 0;    // 目前選取的素材 id（0 = 地板／橡皮擦）
let maiPaintDragActive = false;

function maiCreateEmptyCanvas(w, h) {
    return {
        mapW: w,
        mapH: h,
        mapData: Array.from({ length: h }, () => Array(w).fill(0))
        // 注意：素材（地形定義）不再屬於畫布本身，直接沿用正式地圖共用的 state.mapPalette，
        // 隨取隨用、不需要匯入，新增/刪除也會同時反映在正式地圖的地形工具列上。
    };
}

// ===== 畫布序列化（給 AI 當上下文）=====

function maiSerializeCanvasPalette() {
    const palette = (typeof state !== 'undefined' && Array.isArray(state.mapPalette)) ? state.mapPalette : [];
    return palette.filter(t => t.name !== '地板').map(t => ({ name: t.name, effect: t.effect, moveCostMultiplier: t.moveCostMultiplier || 1 }));
}

function maiSerializeCanvasCells() {
    const nameOf = (id) => {
        const t = (typeof getTileFromPalette === 'function') ? getTileFromPalette(id) : null;
        return t ? t.name : `未知地形#${id}`;
    };
    const cells = [];
    for (let y = 0; y < maiCanvas.mapData.length; y++) {
        const row = maiCanvas.mapData[y] || [];
        for (let x = 0; x < row.length; x++) {
            const val = row[x];
            if (val) cells.push({ x, y, tileName: nameOf(val) });
            if (cells.length >= MAI_MAX_CELLS_IN_CONTEXT) return { cells, truncated: true };
        }
    }
    return { cells, truncated: false };
}

function maiBuildSystemPrompt() {
    const palette = maiSerializeCanvasPalette();
    const { cells, truncated } = maiSerializeCanvasCells();

    return [
        '你是《邊獄公司》(Limbus Company) 戰棋跑團工具的地圖設計副駕駛，跟 ST 在一塊獨立的「畫布」上',
        '討論設計地圖版面。這塊畫布不是正式地圖，你可以自由提案，ST 會自己決定何時存檔、何時套用到正式地圖。',
        '每次回覆都只能輸出一個 JSON 物件、不要任何說明文字或 markdown 圍欄，格式如下：',
        '{',
        '  "reply": "給 ST 看的自然語言回覆（可以說明你的設計想法、或回答 ST 的問題）",',
        '  "newTiles": [ { "name": "...", "color": "#hex", "effect": "【效果名】機制化描述", "moveCostMultiplier": 1 } ],',
        '  "placements": [ { "tileName": "...", "cells": [[x,y], [x,y], ...] } ]',
        '}',
        '',
        'newTiles 和 placements 都是可省略的（純聊天、純回答問題時可以只有 reply，兩者都不給）。',
        '你的建議會直接畫到畫布上（不需要額外確認這一步，畫布本身就是草稿），所以請放心提案、',
        '也可以在 ST 要求調整時直接修改畫布上的格子（例如換一種地形、清空某些格子改回地板：',
        '清空地板可以用 tileName 設為 "地板"）。',
        '注意：newTiles 新增的地形會直接加入正式地圖共用的地形素材庫（跟 ST 手動新增的效果一樣，',
        '所有人立刻看得到），所以請確實想清楚機制再新增，不要重複新增功能相同的地形。',
        '規則：',
        '- 若素材庫已經有合適的地形，placements 直接引用該地形的 name，不要重複新增。',
        '- 只有素材庫真的沒有合適效果時，才透過 newTiles 新增；newTiles 的 name 必須跟 placements 引用的 tileName 對上。',
        '- effect 只是好看的敘述沒有意義，必須是明確可執行的機制（移動消耗、防禦加減、傷害、施加狀態等）。',
        '- moveCostMultiplier：1 = 不影響移動；若 effect 提到「移動困難」「深陷」「泥濘」之類，必須設對應倍率（通常 2），不能只寫在文字裡卻留預設值 1。',
        '- 座標系統：x 是欄（0 到 mapW-1），y 是列（0 到 mapH-1）。cells 只需列出「你建議變更」的格子。',
        '- 不要一次建議動用整塊畫布所有格子，除非 ST 明確要求；先給一個合理範圍的提案。',
        '',
        `目前畫布尺寸：${maiCanvas.mapW} x ${maiCanvas.mapH}（x: 0~${maiCanvas.mapW - 1}，y: 0~${maiCanvas.mapH - 1}）。`,
        `目前地形素材庫（跟正式地圖共用，可直接引用的名稱）：${palette.length ? JSON.stringify(palette) : '（素材庫目前是空的，只有地板）'}`,
        `目前畫布上已標記的非地板格子${truncated ? `（僅列出前 ${MAI_MAX_CELLS_IN_CONTEXT} 格，其餘省略）` : ''}：`,
        cells.length ? JSON.stringify(cells) : '（畫布目前整片都是地板，還沒有任何地形）'
    ].join('\n');
}

// ===== AI 請求 =====

async function maiSendMessage() {
    const input = document.getElementById('mai-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text || maiBusy) return;

    input.value = '';
    maiMessages.push({ role: 'user', text });
    maiRenderMessages();

    const endpoint = (maiGetSetting(MAI_AI_ENDPOINT_KEY, MAI_AI_DEFAULT_ENDPOINT) || '').trim() || MAI_AI_DEFAULT_ENDPOINT;
    const apiKey = (maiGetSetting(MAI_AI_KEY_KEY, '') || '').trim();
    const model = (maiGetSetting(MAI_AI_MODEL_KEY, MAI_AI_DEFAULT_MODEL) || '').trim() || MAI_AI_DEFAULT_MODEL;
    if (!apiKey) {
        maiMessages.push({ role: 'system', text: '請先在「人格鍛造爐」填入 API Key（與怪物庫共用同一組設定）。' });
        maiRenderMessages();
        return;
    }

    maiBusy = true;
    maiRenderMessages();
    try {
        const history = maiMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(0, -1) // 最後一則（剛推入的使用者訊息）另外附加，避免重複
            .map(m => ({ role: m.role, content: m.text }));

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                temperature: 0.6,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: maiBuildSystemPrompt() },
                    ...history,
                    { role: 'user', content: text }
                ]
            })
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${res.statusText}${errText ? '：' + errText.slice(0, 200) : ''}`);
        }
        const data = await res.json();
        const content = (data && data.choices && data.choices[0] && data.choices[0].message)
            ? (data.choices[0].message.content || '') : '';
        if (!content) throw new Error('AI 回傳內容為空');

        let parsed;
        try { parsed = JSON.parse(content); }
        catch (e) { parsed = { reply: content }; } // AI 沒照格式回傳 JSON 時，至少把原文當回覆顯示

        const action = maiNormalizeAction(parsed);
        if (action) maiApplyActionToCanvas(action);
        maiMessages.push({ role: 'assistant', text: String(parsed.reply || '（沒有文字回覆）') });
    } catch (err) {
        maiMessages.push({ role: 'system', text: `AI 請求失敗：${err && err.message ? err.message : err}` });
    } finally {
        maiBusy = false;
        maiRenderMessages();
        maiRenderCanvas();
    }
}

/** 驗證/整理 AI 回傳的 newTiles + placements，過濾越界座標與對不上名稱的引用。回傳 null 代表沒有任何有效建議。 */
function maiNormalizeAction(parsed) {
    const newTiles = Array.isArray(parsed.newTiles) ? parsed.newTiles
        .filter(t => t && t.name && t.name !== '地板')
        .map(t => ({
            name: String(t.name).slice(0, 20),
            color: String(t.color || '#666666').slice(0, 40),
            effect: String(t.effect || '').slice(0, 200),
            moveCostMultiplier: Math.max(0.5, parseFloat(t.moveCostMultiplier) || 1)
        })) : [];

    const knownNames = new Set(['地板', ...maiSerializeCanvasPalette().map(t => t.name), ...newTiles.map(t => t.name)]);

    const placements = Array.isArray(parsed.placements) ? parsed.placements
        .filter(p => p && p.tileName && knownNames.has(p.tileName) && Array.isArray(p.cells))
        .map(p => ({
            tileName: p.tileName,
            cells: p.cells
                .filter(c => Array.isArray(c) && c.length === 2)
                .map(([x, y]) => [parseInt(x), parseInt(y)])
                .filter(([x, y]) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < maiCanvas.mapW && y >= 0 && y < maiCanvas.mapH)
        }))
        .filter(p => p.cells.length) : [];

    if (!newTiles.length && !placements.length) return null;
    return { newTiles, placements };
}

/**
 * 把 AI 的建議直接寫進畫布：placements 只影響畫布本身的草稿格子（不動正式地圖），
 * 但 newTiles 新增的地形定義會直接加進正式地圖共用的 state.mapPalette（跟 ST 手動
 * 新增素材效果一樣，兩邊即時共用），不需要額外的預覽/套用確認。
 */
function maiApplyActionToCanvas(action) {
    if (typeof state === 'undefined') return;
    if (!state.mapPalette) state.mapPalette = [];

    let nextId = Date.now() % 100000 + 1000;
    const nameToId = new Map(state.mapPalette.map(t => [t.name, t.id]));
    let addedAny = false;
    action.newTiles.forEach(t => {
        if (nameToId.has(t.name)) return;
        const id = nextId++;
        state.mapPalette.push({ id, name: t.name, color: t.color, effect: t.effect, moveCostMultiplier: t.moveCostMultiplier });
        nameToId.set(t.name, id);
        addedAny = true;
    });

    action.placements.forEach(p => {
        const tileId = p.tileName === '地板' ? 0 : nameToId.get(p.tileName);
        if (tileId === undefined) return;
        p.cells.forEach(([x, y]) => {
            if (maiCanvas.mapData[y] && x >= 0 && x < maiCanvas.mapData[y].length) {
                maiCanvas.mapData[y][x] = tileId;
            }
        });
    });

    if (addedAny) {
        if (typeof updateToolbar === 'function') updateToolbar();
        if (typeof syncMapPalette === 'function') syncMapPalette();
        if (typeof myRole !== 'undefined' && myRole === 'st' && typeof sendState === 'function') sendState();
        maiRenderMaterials();
    }
}

// ===== 畫布渲染（獨立於正式地圖的小格子預覽） =====

function maiRenderCanvas() {
    const box = document.getElementById('mai-canvas-grid');
    if (!box) return;
    box.style.setProperty('--mai-cols', maiCanvas.mapW);
    box.textContent = '';

    const frag = document.createDocumentFragment();
    for (let y = 0; y < maiCanvas.mapH; y++) {
        for (let x = 0; x < maiCanvas.mapW; x++) {
            const val = maiCanvas.mapData[y][x];
            const cell = document.createElement('div');
            cell.className = 'mai-canvas-cell';
            if (val) {
                const t = (typeof getTileFromPalette === 'function') ? getTileFromPalette(val) : null;
                if (t) {
                    cell.style.background = t.color;
                    cell.title = `${t.name}｜${t.effect || ''}`;
                }
            } else {
                cell.title = '地板';
            }
            // ST 手動繪製：按下開始畫、拖曳中持續套用選取的素材（跟正式地圖的地形工具操作一致）
            cell.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                maiPaintDragActive = true;
                maiPaintCell(x, y);
            });
            cell.addEventListener('pointerenter', () => {
                if (maiPaintDragActive) maiPaintCell(x, y);
            });
            frag.appendChild(cell);
        }
    }
    box.appendChild(frag);

    const sizeLabel = document.getElementById('mai-canvas-size-label');
    if (sizeLabel) sizeLabel.textContent = `${maiCanvas.mapW} x ${maiCanvas.mapH}`;

    maiRenderMaterials();
}

// 放開指標即結束拖曳繪製（可能在格子外放開，故全域監聽保底）
if (typeof window !== 'undefined') {
    window.addEventListener('pointerup', () => { maiPaintDragActive = false; });
    window.addEventListener('pointercancel', () => { maiPaintDragActive = false; });
}

/** 用目前選取的素材塗一格；素材 0 代表地板／橡皮擦。 */
function maiPaintCell(x, y) {
    if (!maiCanvas.mapData[y] || x < 0 || x >= maiCanvas.mapW) return;
    if (maiCanvas.mapData[y][x] === maiSelectedTool) return;
    maiCanvas.mapData[y][x] = maiSelectedTool;
    maiRenderCanvas();
}

// ===== 素材：直接沿用正式地圖共用的 state.mapPalette，隨取隨用，不需要匯入 =====
// 新增／刪除都走跟正式地圖工具列相同的地形編輯器（modals.js 的 openTileEditorModal／
// deletePaletteTile），兩邊即時共用同一份素材庫；AI 在聊天中提出的新地形也是加進這裡。

function maiSelectMaterial(id) {
    maiSelectedTool = id;
    maiRenderMaterials();
}

function maiRenderMaterials() {
    const box = document.getElementById('mai-materials');
    if (!box) return;

    // 地形調色盤裡本來就有一筆真正名為「地板」的資料（id 不保證是 0），
    // 這裡已經有固定的「地板／橡皮擦」代表項目了，要過濾掉避免重複出現。
    const palette = ((typeof state !== 'undefined' && Array.isArray(state.mapPalette)) ? state.mapPalette : [])
        .filter(t => t.name !== '地板');
    // 素材被刪除後，若目前選取的正好是它，重置回地板／橡皮擦，避免拿不存在的素材繼續繪製
    if (maiSelectedTool !== 0 && !palette.some(t => t.id === maiSelectedTool)) {
        maiSelectedTool = 0;
    }

    box.textContent = '';

    const mkSwatch = (id, name, color, removable) => {
        const wrap = document.createElement('div');
        wrap.className = 'mai-material-wrap';

        const btn = document.createElement('button');
        btn.className = 'mai-material-swatch' + (maiSelectedTool === id ? ' active' : '');
        btn.title = name;
        btn.style.background = color;
        btn.addEventListener('click', () => maiSelectMaterial(id));
        wrap.appendChild(btn);

        const label = document.createElement('span');
        label.className = 'mai-material-name';
        label.textContent = name;
        wrap.appendChild(label);

        if (removable) {
            const del = document.createElement('button');
            del.className = 'mai-material-del';
            del.title = `從素材庫移除「${name}」`;
            del.textContent = '×';
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof deletePaletteTile === 'function') deletePaletteTile(id);
            });
            wrap.appendChild(del);
        }
        box.appendChild(wrap);
    };

    mkSwatch(0, '地板／橡皮擦', '#17171b', false);
    palette.forEach(t => mkSwatch(t.id, t.name, t.color, true));
}

function maiResetCanvas() {
    if (!confirm('清空目前畫布？（尚未存到地圖庫的內容會消失）')) return;
    const wInput = document.getElementById('mai-canvas-w');
    const hInput = document.getElementById('mai-canvas-h');
    const w = Math.max(5, Math.min(50, parseInt(wInput?.value) || MAI_DEFAULT_CANVAS_SIZE));
    const h = Math.max(5, Math.min(50, parseInt(hInput?.value) || MAI_DEFAULT_CANVAS_SIZE));
    maiCanvas = maiCreateEmptyCanvas(w, h);
    maiLoadedLibraryId = null;
    maiSelectedTool = 0;
    maiRenderCanvas();
    maiRenderLibrary();
}

// ===== 地圖庫（Firebase 房間共享，localStorage 作為離線快取／備援）=====
//
// 資料安全的核心原則：**房間永遠不能把本機的地圖庫變少。**
//
// 先前這裡把房間當成唯一真相來源，收到什麼就整包覆寫 localStorage。但 localStorage 是
// 使用者唯一的另一份拷貝，所以「房間裡沒有」會直接變成「永遠沒有」。實測會遺失的路徑：
//   1. 以玩家身分加入任何沒有地圖庫的房間（例如去別人的房看看）→ 本機三張地圖全部歸零
//   2. 連線中房間資料被整包重寫（initializeNewRoom() 的 roomRef.set() 不帶 mapLibrary）→ 同樣歸零
// 兩者都無聲無息，使用者只會發現「某次之後地圖就不見了」。
//
// 改為合併（union by id）：房間有的以房間為準、本機獨有的一律保留，遠端資料只會讓本機
// 變多不會變少。使用者自己按下的刪除仍然有效，因為那條路徑直接寫入縮減後的陣列。
let maiLibSynced = null;

function maiReadLocalLibrary() {
    try {
        const raw = localStorage.getItem(MAI_MAP_LIB_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch (e) { return []; }
}

function maiLoadLibrary() {
    if (Array.isArray(maiLibSynced)) return maiLibSynced;
    return maiReadLocalLibrary();
}

/**
 * 寫入本機地圖庫。若這次會讓筆數變少，先把舊的整份存到備份金鑰。
 * 備份是最後一道防線：萬一還有沒想到的路徑把地圖庫清掉，使用者仍可按「還原」救回來。
 */
function maiWriteLocalLibrary(arr) {
    const next = Array.isArray(arr) ? arr.filter(Boolean) : [];
    try {
        const prev = maiReadLocalLibrary();
        if (prev.length > next.length) {
            localStorage.setItem(MAI_MAP_LIB_BACKUP_KEY, JSON.stringify({ savedAt: Date.now(), entries: prev }));
        }
        localStorage.setItem(MAI_MAP_LIB_KEY, JSON.stringify(next));
    } catch (e) { /* 隱私模式／配額用盡：本機留不住，但房間那份仍在 */ }
    return next;
}

/**
 * 以 id 合併兩份地圖庫：房間版本優先，本機獨有的接在後面保留。
 * @param {Array} remote - 房間裡的地圖庫
 * @param {Array} local - 本機快取
 * @returns {Array} 合併後的地圖庫
 */
function maiMergeLibraries(remote, local) {
    const merged = [];
    const seen = new Set();
    for (const e of (Array.isArray(remote) ? remote : [])) {
        if (!e || !e.id || seen.has(e.id)) continue;
        seen.add(e.id);
        merged.push(e);
    }
    for (const e of (Array.isArray(local) ? local : [])) {
        if (!e || !e.id || seen.has(e.id)) continue;
        seen.add(e.id);
        merged.push(e);
    }
    return merged;
}

function maiSaveLibrary(arr) {
    const next = maiWriteLocalLibrary(arr);
    // 先認定本機為真相再往房間推。順序反過來的話，推上去觸發的 value 事件會讀到
    // 還沒更新的 maiLibSynced，把使用者剛刪掉的那筆又合併回來。
    maiLibSynced = next;
    try {
        if (typeof roomRef !== 'undefined' && roomRef && typeof myRole !== 'undefined' && myRole === 'st') {
            roomRef.child('mapLibrary').set(next);
        }
    } catch (e) { /* 同步失敗不影響本機快取 */ }
}

/**
 * 監聽房間地圖庫（由 setupRoomListeners 呼叫）。
 *
 * 三種情況分開處理，兼顧「刪除要能傳播」與「房間空掉不能清空本機」：
 *   ① 本次連線第一次同步：還不知道這個分頁的真相，本機快取一律保留，與房間聯集。
 *      本機獨有的是「還沒上傳」，不是「已被刪除」。
 *   ② 已同步過、房間有內容：房間是共享庫的真相，直接鏡射，ST 的刪除才傳得到其他人。
 *   ③ 已同步過、房間卻空了：房間被整包重寫或被清掉了，但我們手上有本回合的真相，
 *      以本機為準，絕不跟著歸零。（使用者自己刪到最後一張時，maiSaveLibrary 已先把
 *      maiLibSynced 設成 []，所以那是正常的空，會照實反映。）
 */
function maiSetupListener() {
    if (typeof roomRef === 'undefined' || !roomRef) return;
    const ref = roomRef.child('mapLibrary');
    const listener = ref.on('value', snapshot => {
        const val = snapshot.val();
        const remote = Array.isArray(val) ? val.filter(Boolean)
            : (val && typeof val === 'object') ? Object.values(val).filter(Boolean) : [];

        let next;
        if (maiLibSynced === null) next = maiMergeLibraries(remote, maiReadLocalLibrary());  // ①
        else if (remote.length) next = remote;                                               // ②
        else next = maiLibSynced;                                                            // ③

        maiLibSynced = maiWriteLocalLibrary(next);

        // ST 是共享庫的擁有者：本機有而房間沒有的（新房間、房間被重建過）補回去，
        // 讓其他人也看得到。玩家只讀，不會把自己的私藏推上別人的房間。
        try {
            if (next.length > remote.length && typeof myRole !== 'undefined' && myRole === 'st') {
                ref.set(next);
            }
        } catch (e) { /* 補寫失敗不影響本機 */ }

        maiRenderLibrary();
    });
    if (typeof unsubscribeListeners !== 'undefined') {
        unsubscribeListeners.push(() => ref.off('value', listener));
    }
}

/** 讀取自動備份（本機地圖庫變少前留下的那一份）。 */
function maiReadBackup() {
    try {
        const raw = localStorage.getItem(MAI_MAP_LIB_BACKUP_KEY);
        const data = raw ? JSON.parse(raw) : null;
        if (!data || !Array.isArray(data.entries)) return null;
        return { savedAt: data.savedAt || 0, entries: data.entries.filter(Boolean) };
    } catch (e) { return null; }
}

/** 把自動備份合併回地圖庫（只加不減，已存在的 id 不會被覆蓋）。 */
function maiRestoreBackup() {
    const backup = maiReadBackup();
    if (!backup || !backup.entries.length) return;
    const current = maiLoadLibrary();
    const merged = maiMergeLibraries(current, backup.entries);
    const added = merged.length - current.length;
    if (!added) {
        if (typeof showToast === 'function') showToast('備份裡的地圖都還在，不需要還原');
        return;
    }
    if (!confirm(`從備份還原 ${added} 張地圖到地圖庫？（現有的地圖不會被覆蓋）`)) return;
    maiSaveLibrary(merged);
    maiRenderLibrary();
    if (typeof showToast === 'function') showToast(`已還原 ${added} 張地圖`);
}

/** 捨棄自動備份（使用者確認現有地圖庫才是對的）。 */
function maiDiscardBackup() {
    if (!confirm('捨棄這份備份？此動作無法復原。')) return;
    try { localStorage.removeItem(MAI_MAP_LIB_BACKUP_KEY); } catch (e) { /* ignore */ }
    maiRenderLibrary();
}

function maiSaveCanvasToLibrary() {
    const nameInput = document.getElementById('mai-save-name');
    const name = (nameInput?.value || '').trim().slice(0, 30) || `未命名地圖 ${new Date().toLocaleString()}`;

    const lib = maiLoadLibrary();
    if (maiLoadedLibraryId && lib.some(e => e.id === maiLoadedLibraryId)) {
        // 目前畫布是從某一筆載入的：直接覆蓋更新那一筆
        const idx = lib.findIndex(e => e.id === maiLoadedLibraryId);
        lib[idx] = { id: maiLoadedLibraryId, name, mapW: maiCanvas.mapW, mapH: maiCanvas.mapH, mapData: maiCanvas.mapData };
        maiSaveLibrary(lib);
        if (typeof showToast === 'function') showToast(`已更新地圖庫「${name}」`);
    } else {
        const id = 'map_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        lib.push({ id, name, mapW: maiCanvas.mapW, mapH: maiCanvas.mapH, mapData: maiCanvas.mapData });
        maiSaveLibrary(lib);
        maiLoadedLibraryId = id;
        if (typeof showToast === 'function') showToast(`已存入地圖庫「${name}」`);
    }
    if (nameInput) nameInput.value = name;
    maiRenderLibrary();
}

/** 載入地圖庫的一筆到畫布繼續編輯（會覆蓋目前畫布內容，之後「儲存」會覆蓋更新這一筆）。 */
function maiLoadEntryToCanvas(id) {
    const entry = maiLoadLibrary().find(e => e.id === id);
    if (!entry) return;
    if (!confirm(`載入「${entry.name}」到畫布？（目前畫布上尚未存檔的內容會消失）`)) return;

    maiCanvas = {
        mapW: entry.mapW,
        mapH: entry.mapH,
        mapData: entry.mapData.map(row => [...row])
    };
    maiLoadedLibraryId = id;
    maiSelectedTool = 0;
    const nameInput = document.getElementById('mai-save-name');
    if (nameInput) nameInput.value = entry.name;
    maiRenderCanvas();
    if (typeof showToast === 'function') showToast(`已載入「${entry.name}」到畫布`);
}

/** 複製一筆地圖庫紀錄成新的一份，並載入到畫布（原本那份不受影響）。 */
function maiDuplicateEntry(id) {
    const entry = maiLoadLibrary().find(e => e.id === id);
    if (!entry) return;
    const lib = maiLoadLibrary();
    const newEntry = {
        id: 'map_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        name: `${entry.name}（副本）`,
        mapW: entry.mapW,
        mapH: entry.mapH,
        mapData: entry.mapData.map(row => [...row])
    };
    lib.push(newEntry);
    maiSaveLibrary(lib);

    maiCanvas = { mapW: newEntry.mapW, mapH: newEntry.mapH, mapData: newEntry.mapData.map(row => [...row]) };
    maiLoadedLibraryId = newEntry.id;
    maiSelectedTool = 0;
    const nameInput = document.getElementById('mai-save-name');
    if (nameInput) nameInput.value = newEntry.name;
    maiRenderCanvas();
    maiRenderLibrary();
    if (typeof showToast === 'function') showToast(`已複製為「${newEntry.name}」並載入畫布`);
}

function maiRenameEntry(id) {
    const lib = maiLoadLibrary();
    const entry = lib.find(e => e.id === id);
    if (!entry) return;
    const name = prompt('新的名稱：', entry.name);
    if (name === null) return;
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) return;
    entry.name = trimmed;
    maiSaveLibrary(lib);
    if (maiLoadedLibraryId === id) {
        const nameInput = document.getElementById('mai-save-name');
        if (nameInput) nameInput.value = trimmed;
    }
    maiRenderLibrary();
}

function maiDeleteEntry(id) {
    if (!confirm('從地圖庫刪除這筆紀錄？')) return;
    maiSaveLibrary(maiLoadLibrary().filter(e => e.id !== id));
    if (maiLoadedLibraryId === id) maiLoadedLibraryId = null;
    maiRenderLibrary();
}

/**
 * 套用到正式地圖：整個覆蓋目前的地圖版面（會提示確認，因為會蓋掉現有版面）。僅 ST 可操作。
 * 素材本來就是共用的 state.mapPalette，畫布跟正式地圖的地形 id 一直是同一份，不需要再重新映射。
 */
function maiApplyEntryToLiveMap(id) {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const entry = maiLoadLibrary().find(e => e.id === id);
    if (!entry) return;
    if (!confirm(`套用「${entry.name}」到正式地圖？\n這會把地圖尺寸改成 ${entry.mapW}x${entry.mapH}，並覆蓋目前整個地圖版面，此動作無法復原。`)) return;

    state.mapW = entry.mapW;
    state.mapH = entry.mapH;
    state.mapData = entry.mapData.map(row => [...row]);

    if (typeof updateToolbar === 'function') updateToolbar();
    if (typeof renderMap === 'function') renderMap();
    if (typeof sendState === 'function') sendState();
    if (typeof showToast === 'function') showToast(`已套用「${entry.name}」到正式地圖`);
}

function maiRenderLibrary() {
    const box = document.getElementById('mai-library-list');
    if (!box) return;
    const lib = maiLoadLibrary();

    box.textContent = '';

    // 自動備份提示：地圖庫曾經變少過，把救得回來的張數與還原入口直接放在最上面
    const backup = maiReadBackup();
    if (backup && backup.entries.length) {
        const known = new Set(lib.map(e => e && e.id));
        const missing = backup.entries.filter(e => e && !known.has(e.id));
        if (missing.length) {
            const bar = document.createElement('div');
            bar.className = 'mai-lib-backup-bar';
            const txt = document.createElement('span');
            const when = backup.savedAt ? new Date(backup.savedAt).toLocaleString() : '先前';
            txt.textContent = `偵測到備份：有 ${missing.length} 張地圖不在目前的地圖庫裡（備份於 ${when}）`;
            bar.appendChild(txt);
            const restore = document.createElement('button');
            restore.className = 'lv-btn lv-btn-tpl';
            restore.textContent = '↩️ 還原';
            restore.title = '把備份裡缺少的地圖加回地圖庫（不會覆蓋現有的）';
            restore.addEventListener('click', maiRestoreBackup);
            bar.appendChild(restore);
            const discard = document.createElement('button');
            discard.className = 'lv-btn lv-btn-del';
            discard.textContent = '捨棄';
            discard.title = '確認現在的地圖庫才是對的，刪掉這份備份';
            discard.addEventListener('click', maiDiscardBackup);
            bar.appendChild(discard);
            box.appendChild(bar);
        }
    }

    if (!lib.length) {
        const empty = document.createElement('div');
        empty.className = 'log-empty';
        empty.textContent = '地圖庫是空的。在左邊畫布設計滿意後，按「儲存到地圖庫」存起來。';
        box.appendChild(empty);
        return;
    }

    const frag = document.createDocumentFragment();
    for (const entry of lib) {
        const card = document.createElement('div');
        card.className = 'mai-lib-card' + (maiLoadedLibraryId === entry.id ? ' active' : '');

        const info = document.createElement('div');
        info.className = 'mai-lib-info';
        const name = document.createElement('div');
        name.className = 'mai-lib-name';
        name.textContent = entry.name;
        info.appendChild(name);
        const size = document.createElement('div');
        size.className = 'mai-lib-size';
        size.textContent = `${entry.mapW} x ${entry.mapH}`;
        info.appendChild(size);
        card.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'mai-lib-actions';
        const mk = (label, title, fn, cls) => {
            const btn = document.createElement('button');
            btn.className = 'lv-btn ' + cls;
            btn.title = title;
            btn.textContent = label;
            btn.addEventListener('click', () => fn(entry.id));
            return btn;
        };
        actions.appendChild(mk('📥 套用', '套用到正式地圖（覆蓋現有版面）', maiApplyEntryToLiveMap, 'lv-btn-deploy'));
        actions.appendChild(mk('✏️ 編輯', '載入到畫布繼續編輯', maiLoadEntryToCanvas, 'lv-btn-tpl'));
        actions.appendChild(mk('📋 複製', '複製成新的一份', maiDuplicateEntry, 'lv-btn-tpl'));
        actions.appendChild(mk('改名', '重新命名', maiRenameEntry, 'lv-btn-tpl'));
        actions.appendChild(mk('🗑️', '刪除', maiDeleteEntry, 'lv-btn-del'));
        card.appendChild(actions);

        frag.appendChild(card);
    }
    box.appendChild(frag);
}

// ===== 對話渲染 =====

function maiRenderMessages() {
    const box = document.getElementById('mai-messages');
    if (!box) return;

    // 以 DOM 節點 + textContent 建構，避免把 AI 回覆內容經由 innerHTML 注入，杜絕 XSS。
    box.textContent = '';
    if (!maiMessages.length) {
        const empty = document.createElement('div');
        empty.className = 'mai-empty';
        empty.textContent = '跟我說說這張地圖想要什麼氛圍或需要什麼地形，我會直接畫在右邊的畫布上給你看。';
        box.appendChild(empty);
    }

    maiMessages.forEach(m => {
        const row = document.createElement('div');
        row.className = 'mai-msg mai-msg-' + m.role;
        row.textContent = m.text;
        box.appendChild(row);
    });

    if (maiBusy) {
        const loading = document.createElement('div');
        loading.className = 'mai-msg mai-msg-assistant mai-msg-loading';
        loading.textContent = '⏳ AI 思考中...';
        box.appendChild(loading);
    }

    box.scrollTop = box.scrollHeight;
}

function maiHandleInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        maiSendMessage();
    }
}

function maiClearChat() {
    maiMessages = [];
    maiRenderMessages();
}

// ===== 僅 ST 可見 QAB 選單入口 =====
function maiGateUI() {
    const isST = (typeof myRole !== 'undefined' && myRole === 'st');
    const item = document.getElementById('qab-map-ai-item');
    if (item) item.style.display = isST ? 'flex' : 'none';
}

// ===== 浮動面板開關 =====

function maiTogglePanel() {
    if (typeof myRole === 'undefined' || myRole !== 'st') {
        if (typeof showToast === 'function') showToast('只有 ST 可以使用 AI 地圖助手');
        return;
    }
    const overlay = document.getElementById('map-ai-overlay');
    if (!overlay) return;
    if (!overlay.classList.contains('show')) {
        overlay.classList.add('show');
        maiRenderMessages();
        maiRenderCanvas();
        maiRenderLibrary();
    } else {
        overlay.classList.remove('show');
    }
}

function maiClosePanel() {
    const overlay = document.getElementById('map-ai-overlay');
    if (overlay) overlay.classList.remove('show');
}

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
        mapData: Array.from({ length: h }, () => Array(w).fill(0)),
        palette: [] // { id, name, color, effect, moveCostMultiplier }
    };
}

// ===== 畫布序列化（給 AI 當上下文）=====

function maiSerializeCanvasPalette() {
    return maiCanvas.palette.map(t => ({ name: t.name, effect: t.effect, moveCostMultiplier: t.moveCostMultiplier || 1 }));
}

function maiSerializeCanvasCells() {
    const nameOf = (id) => {
        const t = maiCanvas.palette.find(p => p.id === id);
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
        '規則：',
        '- 若畫布現有地形已經有合適的，placements 直接引用該地形的 name，不要重複新增。',
        '- 只有畫布現有地形真的沒有合適效果時，才透過 newTiles 新增；newTiles 的 name 必須跟 placements 引用的 tileName 對上。',
        '- effect 只是好看的敘述沒有意義，必須是明確可執行的機制（移動消耗、防禦加減、傷害、施加狀態等）。',
        '- moveCostMultiplier：1 = 不影響移動；若 effect 提到「移動困難」「深陷」「泥濘」之類，必須設對應倍率（通常 2），不能只寫在文字裡卻留預設值 1。',
        '- 座標系統：x 是欄（0 到 mapW-1），y 是列（0 到 mapH-1）。cells 只需列出「你建議變更」的格子。',
        '- 不要一次建議動用整塊畫布所有格子，除非 ST 明確要求；先給一個合理範圍的提案。',
        '',
        `目前畫布尺寸：${maiCanvas.mapW} x ${maiCanvas.mapH}（x: 0~${maiCanvas.mapW - 1}，y: 0~${maiCanvas.mapH - 1}）。`,
        `目前畫布上的地形（可直接引用的名稱）：${palette.length ? JSON.stringify(palette) : '（畫布目前只有地板，沒有其他地形）'}`,
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

/** 把 AI 的建議直接寫進畫布（畫布本身就是草稿區，不需要額外的預覽/套用確認）。 */
function maiApplyActionToCanvas(action) {
    let nextId = Date.now() % 100000 + 1000;
    const nameToId = new Map(maiCanvas.palette.map(t => [t.name, t.id]));
    action.newTiles.forEach(t => {
        if (nameToId.has(t.name)) return;
        const id = nextId++;
        maiCanvas.palette.push({ id, name: t.name, color: t.color, effect: t.effect, moveCostMultiplier: t.moveCostMultiplier });
        nameToId.set(t.name, id);
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
                const t = maiCanvas.palette.find(p => p.id === val);
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

// ===== 素材（畫布調色盤）管理：可直接沿用正式地圖現有地形，也能隨時新增／刪除 =====

function maiSelectMaterial(id) {
    maiSelectedTool = id;
    maiRenderMaterials();
}

/** 把正式地圖目前的地形調色盤（state.mapPalette）匯入成畫布素材（依名稱去重，不覆蓋畫布已有的同名素材）。 */
function maiImportLiveTerrain() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const live = (typeof state !== 'undefined' && Array.isArray(state.mapPalette)) ? state.mapPalette : [];
    const importable = live.filter(t => t.name !== '地板');
    if (!importable.length) {
        if (typeof showToast === 'function') showToast('正式地圖目前沒有可匯入的地形');
        return;
    }

    let nextId = Date.now() % 100000 + 1000;
    const existingNames = new Set(maiCanvas.palette.map(t => t.name));
    let added = 0;
    importable.forEach(t => {
        if (existingNames.has(t.name)) return;
        maiCanvas.palette.push({
            id: nextId++,
            name: t.name,
            color: t.color,
            effect: t.effect || '',
            moveCostMultiplier: t.moveCostMultiplier || 1
        });
        existingNames.add(t.name);
        added++;
    });

    maiRenderMaterials();
    if (typeof showToast === 'function') {
        showToast(added ? `已匯入 ${added} 種地形作為畫布素材` : '正式地圖的地形都已經在畫布素材裡了');
    }
}

/** 從畫布素材移除一種地形；用到該素材的格子一併恢復成地板。 */
function maiRemoveMaterial(id) {
    const t = maiCanvas.palette.find(p => p.id === id);
    if (!t) return;
    if (!confirm(`從畫布素材移除「${t.name}」？（畫布上用到這個素材的格子會恢復成地板）`)) return;

    maiCanvas.palette = maiCanvas.palette.filter(p => p.id !== id);
    maiCanvas.mapData = maiCanvas.mapData.map(row => row.map(v => v === id ? 0 : v));
    if (maiSelectedTool === id) maiSelectedTool = 0;
    maiRenderCanvas();
}

function maiRenderMaterials() {
    const box = document.getElementById('mai-materials');
    if (!box) return;
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
            del.title = `移除「${name}」`;
            del.textContent = '×';
            del.addEventListener('click', (e) => { e.stopPropagation(); maiRemoveMaterial(id); });
            wrap.appendChild(del);
        }
        box.appendChild(wrap);
    };

    mkSwatch(0, '地板／橡皮擦', '#17171b', false);
    maiCanvas.palette.forEach(t => mkSwatch(t.id, t.name, t.color, true));
}

/** 開啟「新增素材」小表單（獨立於正式地圖的地形編輯器，直接寫進畫布調色盤）。 */
function maiOpenAddMaterialForm() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const existing = document.getElementById('mai-material-form-modal');
    if (existing) existing.remove();

    const html = `
        <div class="modal-overlay show" id="mai-material-form-modal" onclick="if(event.target.id==='mai-material-form-modal')maiCloseAddMaterialForm()">
            <div class="modal tile-editor-modal" onclick="event.stopPropagation()">
                <div class="modal-header modal-header--create">
                    <span style="font-weight:bold;">➕ 新增畫布素材</span>
                    <button onclick="maiCloseAddMaterialForm()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div class="tile-editor-form">
                        <div class="form-group">
                            <label class="tile-editor-label">素材名稱</label>
                            <input type="text" id="mai-mat-name" placeholder="例如：船艙地板" maxlength="20">
                        </div>
                        <div class="form-group">
                            <label class="tile-editor-label">顏色</label>
                            <div class="tile-color-row">
                                <input type="color" id="mai-mat-color" value="#666666" class="tile-color-picker">
                                <span class="tile-color-hex" id="mai-mat-color-hex">#666666</span>
                                <div class="tile-color-preview" id="mai-mat-color-preview" style="background:#666666;"></div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="tile-editor-label">效果描述</label>
                            <textarea id="mai-mat-effect" placeholder="例如：【搖晃】移動消耗x2" rows="3"></textarea>
                        </div>
                        <div class="form-group">
                            <label class="tile-editor-label">移動消耗倍率</label>
                            <input type="number" id="mai-mat-move-cost" value="1" min="0.5" step="0.5" style="width:100px;">
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button onclick="maiCloseAddMaterialForm()" class="modal-btn" style="background:var(--bg-card);">取消</button>
                    <button onclick="maiSaveMaterialFromForm()" class="modal-btn" style="background:var(--accent-green);color:#000;">新增素材</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modals-container').insertAdjacentHTML('beforeend', html);

    const colorInput = document.getElementById('mai-mat-color');
    if (colorInput) {
        colorInput.addEventListener('input', () => {
            const hex = colorInput.value;
            document.getElementById('mai-mat-color-hex').textContent = hex;
            document.getElementById('mai-mat-color-preview').style.background = hex;
        });
    }
}

function maiCloseAddMaterialForm() {
    const modal = document.getElementById('mai-material-form-modal');
    if (modal) modal.remove();
}

function maiSaveMaterialFromForm() {
    const name = document.getElementById('mai-mat-name')?.value.trim();
    if (!name) { if (typeof showToast === 'function') showToast('請輸入素材名稱'); return; }
    const color = document.getElementById('mai-mat-color')?.value || '#666666';
    const effect = document.getElementById('mai-mat-effect')?.value.trim() || '';
    const moveCostMultiplier = Math.max(0.5, parseFloat(document.getElementById('mai-mat-move-cost')?.value) || 1);

    const id = Date.now() % 100000 + 1000;
    maiCanvas.palette.push({ id, name, color, effect, moveCostMultiplier });
    maiSelectedTool = id;
    maiCloseAddMaterialForm();
    maiRenderMaterials();
    if (typeof showToast === 'function') showToast(`已新增素材「${name}」，可直接在畫布上繪製`);
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
let maiLibSynced = null;

function maiLoadLibrary() {
    if (Array.isArray(maiLibSynced)) return maiLibSynced;
    try {
        const raw = localStorage.getItem(MAI_MAP_LIB_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function maiSaveLibrary(arr) {
    try { localStorage.setItem(MAI_MAP_LIB_KEY, JSON.stringify(arr)); } catch (e) { /* quota */ }
    try {
        if (typeof roomRef !== 'undefined' && roomRef && typeof myRole !== 'undefined' && myRole === 'st') {
            roomRef.child('mapLibrary').set(arr);
        }
    } catch (e) { /* 同步失敗不影響本機快取 */ }
    maiLibSynced = Array.isArray(arr) ? arr : [];
}

/** 監聽房間地圖庫（由 setupRoomListeners 呼叫）。首次同步時若房間為空而本機有存貨，ST 自動上傳。 */
function maiSetupListener() {
    if (typeof roomRef === 'undefined' || !roomRef) return;
    const ref = roomRef.child('mapLibrary');
    const listener = ref.on('value', snapshot => {
        const val = snapshot.val();
        const arr = Array.isArray(val) ? val.filter(Boolean)
            : (val && typeof val === 'object') ? Object.values(val).filter(Boolean) : [];
        if (!arr.length && maiLibSynced === null && typeof myRole !== 'undefined' && myRole === 'st') {
            let local = [];
            try { local = JSON.parse(localStorage.getItem(MAI_MAP_LIB_KEY) || '[]') || []; } catch (e) { local = []; }
            maiLibSynced = Array.isArray(local) ? local : [];
            if (maiLibSynced.length) ref.set(maiLibSynced);
        } else {
            maiLibSynced = arr;
            try { localStorage.setItem(MAI_MAP_LIB_KEY, JSON.stringify(arr)); } catch (e) { /* quota */ }
        }
        maiRenderLibrary();
    });
    if (typeof unsubscribeListeners !== 'undefined') {
        unsubscribeListeners.push(() => ref.off('value', listener));
    }
}

function maiSaveCanvasToLibrary() {
    const nameInput = document.getElementById('mai-save-name');
    const name = (nameInput?.value || '').trim().slice(0, 30) || `未命名地圖 ${new Date().toLocaleString()}`;

    const lib = maiLoadLibrary();
    if (maiLoadedLibraryId && lib.some(e => e.id === maiLoadedLibraryId)) {
        // 目前畫布是從某一筆載入的：直接覆蓋更新那一筆
        const idx = lib.findIndex(e => e.id === maiLoadedLibraryId);
        lib[idx] = { id: maiLoadedLibraryId, name, mapW: maiCanvas.mapW, mapH: maiCanvas.mapH, mapData: maiCanvas.mapData, palette: maiCanvas.palette };
        maiSaveLibrary(lib);
        if (typeof showToast === 'function') showToast(`已更新地圖庫「${name}」`);
    } else {
        const id = 'map_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        lib.push({ id, name, mapW: maiCanvas.mapW, mapH: maiCanvas.mapH, mapData: maiCanvas.mapData, palette: maiCanvas.palette });
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
        mapData: entry.mapData.map(row => [...row]),
        palette: entry.palette.map(t => ({ ...t }))
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
        mapData: entry.mapData.map(row => [...row]),
        palette: entry.palette.map(t => ({ ...t }))
    };
    lib.push(newEntry);
    maiSaveLibrary(lib);

    maiCanvas = { mapW: newEntry.mapW, mapH: newEntry.mapH, mapData: newEntry.mapData.map(row => [...row]), palette: newEntry.palette.map(t => ({ ...t })) };
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

/** 套用到正式地圖：整個覆蓋目前的地圖版面與調色盤（會提示確認，因為會蓋掉現有版面）。僅 ST 可操作。 */
function maiApplyEntryToLiveMap(id) {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const entry = maiLoadLibrary().find(e => e.id === id);
    if (!entry) return;
    if (!confirm(`套用「${entry.name}」到正式地圖？\n這會把地圖尺寸改成 ${entry.mapW}x${entry.mapH}，並覆蓋目前整個地圖版面，此動作無法復原。`)) return;

    state.mapW = entry.mapW;
    state.mapH = entry.mapH;
    state.mapData = entry.mapData.map(row => [...row]);

    if (!state.mapPalette) state.mapPalette = [];
    let nextId = Date.now() % 100000 + 1000;
    const nameToId = new Map(state.mapPalette.map(t => [t.name, t.id]));
    const idRemap = new Map(); // 畫布庫的 tile id -> 正式地圖的 tile id
    entry.palette.forEach(t => {
        if (nameToId.has(t.name)) {
            idRemap.set(t.id, nameToId.get(t.name));
            return;
        }
        const newId = nextId++;
        state.mapPalette.push({ id: newId, name: t.name, color: t.color, effect: t.effect, moveCostMultiplier: t.moveCostMultiplier || 1 });
        nameToId.set(t.name, newId);
        idRemap.set(t.id, newId);
    });
    // 重新映射 mapData 裡的 tile id（地圖庫跟正式地圖的調色盤 id 不保證相同）
    state.mapData = state.mapData.map(row => row.map(v => v ? (idRemap.get(v) || 0) : 0));

    if (typeof updateToolbar === 'function') updateToolbar();
    if (typeof renderMap === 'function') renderMap();
    if (typeof syncMapPalette === 'function') syncMapPalette();
    if (typeof sendState === 'function') sendState();
    if (typeof showToast === 'function') showToast(`已套用「${entry.name}」到正式地圖`);
}

function maiRenderLibrary() {
    const box = document.getElementById('mai-library-list');
    if (!box) return;
    const lib = maiLoadLibrary();

    box.textContent = '';
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
        size.textContent = `${entry.mapW} x ${entry.mapH}｜${(entry.palette || []).length} 種地形`;
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

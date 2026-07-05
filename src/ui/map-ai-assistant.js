/**
 * Limbus Command - AI 地圖協作助手
 *
 * 職責：常駐的對話式 AI 副駕駛，讓 ST 一邊看著目前地圖的實際格子排列，一邊跟 AI
 * 討論「這裡該放什麼地形」，AI 可以：
 *   1. 建議新的地形效果（沿用地形庫/地形編輯器同一套 schema：name/color/effect/moveCostMultiplier）
 *   2. 建議把（新的或既有的）地形標記到地圖上的哪些格子
 * 建議一律先以半透明色塊疊加預覽在地圖上，ST 確認滿意後才按「套用」寫入 state.mapData，
 * 不滿意可以直接在對話框繼續要求調整，或按「捨棄」清除預覽（對話紀錄仍保留）。
 *
 * 沿用「人格鍛造爐」/「怪物庫」/「地形庫」的 AI 連線設定（同一組 localStorage 金鑰）。
 * 權限分離：僅 ST 可開啟與操作，玩家看不到入口。
 * 防禦性：所有 Firebase / DOM / AI 操作皆以 typeof 與 try-catch 防呆，絕不影響地圖與單位同步。
 */

// ===== AI 連線設定（沿用既有金鑰）=====
const MAI_AI_ENDPOINT_KEY = 'limbus-ai-endpoint';
const MAI_AI_KEY_KEY = 'limbus-ai-key';
const MAI_AI_MODEL_KEY = 'limbus-ai-model';
const MAI_AI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MAI_AI_DEFAULT_MODEL = 'gpt-4o-mini';
const MAI_MAX_CELLS_IN_CONTEXT = 500; // 序列化目前地圖給 AI 時，非地板格子的上限（避免超大地圖 token 爆量）

function maiGetSetting(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}

// ===== 對話狀態（僅存在本機記憶體，重整頁面即清空，符合「臨時討論」定位）=====
let maiMessages = [];       // [{ role: 'user'|'assistant'|'system', text, action? }]
let maiPendingAction = null; // 目前預覽中、尚未套用/捨棄的建議（來自最新一則 assistant 訊息）
let maiBusy = false;

// ===== 目前地圖狀態序列化（給 AI 當上下文）=====

/** 把目前調色盤整理成給 AI 看的精簡清單。 */
function maiSerializePalette() {
    const palette = (typeof state !== 'undefined' && Array.isArray(state.mapPalette)) ? state.mapPalette : [];
    return palette
        .filter(t => t.name !== '地板')
        .map(t => ({ name: t.name, effect: t.effect, moveCostMultiplier: t.moveCostMultiplier || 1 }));
}

/** 把目前地圖的非地板格子整理成 {x,y,tileName} 清單（超過上限則截斷並註記）。 */
function maiSerializeMapCells() {
    if (typeof state === 'undefined' || !Array.isArray(state.mapData)) return { cells: [], truncated: false };
    const palette = (typeof state.mapPalette !== 'undefined' && Array.isArray(state.mapPalette)) ? state.mapPalette : [];
    const nameOf = (id) => {
        const t = palette.find(p => p.id === id);
        return t ? t.name : `未知地形#${id}`;
    };
    const cells = [];
    for (let y = 0; y < state.mapData.length; y++) {
        const row = state.mapData[y] || [];
        for (let x = 0; x < row.length; x++) {
            const val = row[x];
            if (val) cells.push({ x, y, tileName: nameOf(val) });
            if (cells.length >= MAI_MAX_CELLS_IN_CONTEXT) {
                return { cells, truncated: true };
            }
        }
    }
    return { cells, truncated: false };
}

function maiBuildSystemPrompt() {
    const mapW = (typeof state !== 'undefined' && state.mapW) || 15;
    const mapH = (typeof state !== 'undefined' && state.mapH) || 15;
    const palette = maiSerializePalette();
    const { cells, truncated } = maiSerializeMapCells();

    return [
        '你是《邊獄公司》(Limbus Company) 戰棋跑團工具的地圖設計副駕駛，跟 ST 對話討論地圖上要放什麼地形。',
        '每次回覆都只能輸出一個 JSON 物件、不要任何說明文字或 markdown 圍欄，格式如下：',
        '{',
        '  "reply": "給 ST 看的自然語言回覆（可以說明你的設計想法、或回答 ST 的問題）",',
        '  "newTiles": [ { "name": "...", "color": "#hex", "effect": "【效果名】機制化描述", "moveCostMultiplier": 1 } ],',
        '  "placements": [ { "tileName": "...", "cells": [[x,y], [x,y], ...] } ]',
        '}',
        '',
        'newTiles 和 placements 都是可省略的（純聊天、純回答問題時可以只有 reply，兩者都不給）。',
        '規則：',
        '- 若既有調色盤已經有合適的地形，placements 直接引用該地形的 name，不要重複新增。',
        '- 只有目前調色盤裡真的沒有合適效果時，才透過 newTiles 新增；newTiles 的 name 必須跟 placements 引用的 tileName 對上。',
        '- effect 只是好看的敘述沒有意義，必須是明確可執行的機制（移動消耗、防禦加減、傷害、施加狀態等）。',
        '- moveCostMultiplier：1 = 不影響移動；若 effect 提到「移動困難」「深陷」「泥濘」之類，必須設對應倍率（通常 2），不能只寫在文字裡卻留預設值 1。',
        '- 座標系統：x 是欄（0 到 mapW-1），y 是列（0 到 mapH-1）。cells 只需列出「你建議變更」的格子，不用重複列出已經正確、不需要動的格子。',
        '- 不要一次建議動用整張地圖所有格子，除非 ST 明確要求；先給一個合理範圍的提案，讓 ST 看預覽後再決定要不要擴大。',
        '',
        `目前地圖尺寸：${mapW} x ${mapH}（x: 0~${mapW - 1}，y: 0~${mapH - 1}）。`,
        `目前調色盤（可直接引用的地形名稱）：${palette.length ? JSON.stringify(palette) : '（目前只有地板，沒有其他地形）'}`,
        `目前地圖上已標記的非地板格子${truncated ? `（僅列出前 ${MAI_MAX_CELLS_IN_CONTEXT} 格，地圖較密集，其餘省略）` : ''}：`,
        cells.length ? JSON.stringify(cells) : '（目前整張地圖都是地板，還沒有任何地形）'
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
        maiMessages.push({ role: 'system', text: '請先在「人格鍛造爐」填入 API Key（與怪物庫/地形庫共用同一組設定）。' });
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
        maiMessages.push({ role: 'assistant', text: String(parsed.reply || '（沒有文字回覆）'), action });
        if (action) maiPreviewAction(action);
    } catch (err) {
        maiMessages.push({ role: 'system', text: `AI 請求失敗：${err && err.message ? err.message : err}` });
    } finally {
        maiBusy = false;
        maiRenderMessages();
    }
}

/** 驗證/整理 AI 回傳的 newTiles + placements，過濾越界座標與對不上名稱的引用。回傳 null 代表沒有任何有效建議。 */
function maiNormalizeAction(parsed) {
    const mapW = (typeof state !== 'undefined' && state.mapW) || 15;
    const mapH = (typeof state !== 'undefined' && state.mapH) || 15;

    const newTiles = Array.isArray(parsed.newTiles) ? parsed.newTiles
        .filter(t => t && t.name)
        .map(t => ({
            name: String(t.name).slice(0, 20),
            color: String(t.color || '#666666').slice(0, 40),
            effect: String(t.effect || '').slice(0, 200),
            moveCostMultiplier: Math.max(0.5, parseFloat(t.moveCostMultiplier) || 1)
        })) : [];

    const knownNames = new Set([...maiSerializePalette().map(t => t.name), ...newTiles.map(t => t.name)]);

    const placements = Array.isArray(parsed.placements) ? parsed.placements
        .filter(p => p && p.tileName && knownNames.has(p.tileName) && Array.isArray(p.cells))
        .map(p => ({
            tileName: p.tileName,
            cells: p.cells
                .filter(c => Array.isArray(c) && c.length === 2)
                .map(([x, y]) => [parseInt(x), parseInt(y)])
                .filter(([x, y]) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < mapW && y >= 0 && y < mapH)
        }))
        .filter(p => p.cells.length) : [];

    if (!newTiles.length && !placements.length) return null;
    return { newTiles, placements };
}

// ===== 預覽疊加（半透明色塊，套用前先看過）=====

/** 依 action 解析每個 placement 的顯示顏色（newTiles 優先於既有調色盤同名項）。 */
function maiResolveColor(tileName, action) {
    const fromNew = action.newTiles.find(t => t.name === tileName);
    if (fromNew) return fromNew.color;
    const palette = (typeof state !== 'undefined' && Array.isArray(state.mapPalette)) ? state.mapPalette : [];
    const fromPalette = palette.find(t => t.name === tileName);
    return fromPalette ? fromPalette.color : '#999';
}

function maiEnsureOverlay() {
    const container = document.getElementById('map-container');
    if (!container) return null;
    let svg = document.getElementById('mai-preview-overlay');
    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'mai-preview-overlay';
        container.appendChild(svg);
    }
    return svg;
}

function maiPreviewAction(action) {
    maiPendingAction = action;
    const svg = maiEnsureOverlay();
    if (!svg) return;

    const gridSize = (typeof MAP_DEFAULTS !== 'undefined') ? MAP_DEFAULTS.GRID_SIZE : 50;
    let html = '';
    action.placements.forEach(p => {
        const color = maiResolveColor(p.tileName, action);
        p.cells.forEach(([x, y]) => {
            html += `<rect class="mai-preview-cell" x="${x * gridSize + 2}" y="${y * gridSize + 2}" width="${gridSize - 4}" height="${gridSize - 4}" fill="${color}"/>`;
        });
    });
    svg.innerHTML = html;
}

function maiClearOverlay() {
    const svg = document.getElementById('mai-preview-overlay');
    if (svg) svg.innerHTML = '';
}

// ===== 套用 / 捨棄 =====

function maiApplyAction() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const action = maiPendingAction;
    if (!action) return;

    if (!state.mapPalette) state.mapPalette = [];
    // newTiles：同名沿用既有 id（避免重複），否則配發新 id
    let nextId = Date.now() % 100000 + 1000;
    const nameToId = new Map(state.mapPalette.map(t => [t.name, t.id]));
    action.newTiles.forEach(t => {
        if (nameToId.has(t.name)) return; // 已存在同名地形，不重複新增
        const id = nextId++;
        state.mapPalette.push({ id, name: t.name, color: t.color, effect: t.effect, moveCostMultiplier: t.moveCostMultiplier });
        nameToId.set(t.name, id);
    });

    let painted = 0;
    action.placements.forEach(p => {
        const tileId = nameToId.get(p.tileName);
        if (!tileId) return;
        p.cells.forEach(([x, y]) => {
            if (state.mapData[y] && x >= 0 && x < state.mapData[y].length) {
                state.mapData[y][x] = tileId;
                painted++;
            }
        });
    });

    maiClearOverlay();
    maiPendingAction = null;

    if (typeof updateToolbar === 'function') updateToolbar();
    if (typeof renderMap === 'function') renderMap();
    if (typeof syncMapPalette === 'function') syncMapPalette();
    if (typeof sendState === 'function') sendState();
    if (typeof showToast === 'function') showToast(`已套用 AI 建議（新增 ${action.newTiles.length} 種地形，標記 ${painted} 格）`);
    maiRenderMessages();
}

function maiDiscardAction() {
    maiClearOverlay();
    maiPendingAction = null;
    maiRenderMessages();
}

// ===== 渲染 =====

function maiRenderMessages() {
    const box = document.getElementById('mai-messages');
    if (!box) return;

    // 以 DOM 節點 + textContent 建構，避免把 AI 回覆內容經由 innerHTML 注入，杜絕 XSS。
    box.textContent = '';
    if (!maiMessages.length) {
        const empty = document.createElement('div');
        empty.className = 'mai-empty';
        empty.textContent = '跟我說說這張地圖想要什麼氛圍或需要什麼地形，我會直接在地圖上標記預覽給你看。';
        box.appendChild(empty);
    }

    maiMessages.forEach((m, idx) => {
        const row = document.createElement('div');
        row.className = 'mai-msg mai-msg-' + m.role;
        row.textContent = m.text;
        box.appendChild(row);

        const isLatest = idx === maiMessages.length - 1;
        if (m.action && isLatest && maiPendingAction === m.action) {
            const card = document.createElement('div');
            card.className = 'mai-action-card';

            const summary = document.createElement('div');
            summary.className = 'mai-action-summary';
            const cellCount = m.action.placements.reduce((sum, p) => sum + p.cells.length, 0);
            const parts = [];
            if (m.action.newTiles.length) parts.push(`${m.action.newTiles.length} 種新地形`);
            if (cellCount) parts.push(`${cellCount} 格標記`);
            summary.textContent = `📍 建議：${parts.join('、') || '（無實際變更）'}（已預覽到地圖，半透明色塊）`;
            card.appendChild(summary);

            const btns = document.createElement('div');
            btns.className = 'mai-action-btns';
            const applyBtn = document.createElement('button');
            applyBtn.className = 'modal-btn';
            applyBtn.style.background = 'var(--accent-green)';
            applyBtn.style.color = '#000';
            applyBtn.textContent = '✅ 套用';
            applyBtn.onclick = maiApplyAction;
            const discardBtn = document.createElement('button');
            discardBtn.className = 'modal-btn';
            discardBtn.style.background = 'var(--bg-input)';
            discardBtn.textContent = '✕ 捨棄';
            discardBtn.onclick = maiDiscardAction;
            btns.appendChild(applyBtn);
            btns.appendChild(discardBtn);
            card.appendChild(btns);

            box.appendChild(card);
        }
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
    maiDiscardAction();
    maiRenderMessages();
}

/** 僅 ST 可見 QAB 選單入口（由 setupRoomListeners 呼叫，與侵蝕控制台的 eroGateUI 同一模式）。 */
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
    const panel = document.getElementById('map-ai-panel');
    if (!panel) return;
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        if (typeof WindowManager !== 'undefined') WindowManager.bringToFront(panel);
        maiRenderMessages();
    } else {
        panel.classList.add('hidden');
    }
}

function maiClosePanel() {
    const panel = document.getElementById('map-ai-panel');
    if (panel) panel.classList.add('hidden');
}

function maiInitFloatPanel() {
    if (typeof makeFloatingPanel !== 'function') return;
    makeFloatingPanel({
        panelId: 'map-ai-panel',
        headerId: 'map-ai-panel-header',
        collapseBtnId: 'map-ai-panel-collapse',
        storageKey: 'limbus_map_ai_panel',
        defaultPos: { x: Math.max(20, window.innerWidth - 380), y: 90 },
        dock: { icon: '🧭', title: 'AI 地圖助手' },
        restoreDock: true,
    });
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maiInitFloatPanel);
    } else {
        maiInitFloatPanel();
    }
}

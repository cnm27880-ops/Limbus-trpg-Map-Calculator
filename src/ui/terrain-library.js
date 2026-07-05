/**
 * Limbus Command - AI 地形庫
 *
 * 職責：仿照「怪物庫」的 AI 生成架構，讓 ST 依主題請 AI 生成一組（3~5 種）風格一致的
 * 地形，預覽後存入房間共享的地形庫，需要時再一鍵「套用」到目前的地形調色盤
 * （state.mapPalette），不必每次手動一格一格用地形編輯器慢慢刻。
 *
 * 沿用「人格鍛造爐」/「怪物庫」的 AI 連線設定（同一組 localStorage 金鑰，共用一次設定）。
 * 權限分離：僅 ST 可開啟與操作，玩家看不到入口。
 * 防禦性：所有 Firebase / DOM / AI 操作皆以 typeof 與 try-catch 防呆，絕不影響地圖與單位同步。
 */

// ===== 本地狀態 =====
const TL_TERRAIN_LIB_KEY = 'limbus-terrain-library';
// 沿用人格鍛造爐 / 怪物庫的 AI 連線設定（三處共用同一組 localStorage 金鑰）
const TL_AI_ENDPOINT_KEY = 'limbus-ai-endpoint';
const TL_AI_KEY_KEY = 'limbus-ai-key';
const TL_AI_MODEL_KEY = 'limbus-ai-model';
const TL_AI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TL_AI_DEFAULT_MODEL = 'gpt-4o-mini';

let tlLibSynced = null; // 房間同步後的地形庫（null=尚未同步，回退 localStorage）

function tlGetSetting(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}

// ===== 地形庫（Firebase 房間共享，localStorage 作為離線快取／備援）=====
function tlLoadLibrary() {
    if (Array.isArray(tlLibSynced)) return tlLibSynced;
    try {
        const raw = localStorage.getItem(TL_TERRAIN_LIB_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function tlSaveLibrary(arr) {
    try { localStorage.setItem(TL_TERRAIN_LIB_KEY, JSON.stringify(arr)); } catch (e) { /* quota */ }
    try {
        if (typeof roomRef !== 'undefined' && roomRef && typeof myRole !== 'undefined' && myRole === 'st') {
            roomRef.child('terrainLibrary').set(arr);
        }
    } catch (e) { /* 同步失敗不影響本機快取 */ }
    tlLibSynced = Array.isArray(arr) ? arr : [];
}

/** 監聽房間地形庫（由 setupRoomListeners 呼叫）。首次同步時若房間為空而本機有存貨，ST 自動上傳。 */
function tlSetupListener() {
    if (typeof roomRef === 'undefined' || !roomRef) return;
    const ref = roomRef.child('terrainLibrary');
    const listener = ref.on('value', snapshot => {
        const val = snapshot.val();
        const arr = Array.isArray(val) ? val.filter(Boolean)
            : (val && typeof val === 'object') ? Object.values(val).filter(Boolean) : [];
        if (!arr.length && tlLibSynced === null && typeof myRole !== 'undefined' && myRole === 'st') {
            let local = [];
            try { local = JSON.parse(localStorage.getItem(TL_TERRAIN_LIB_KEY) || '[]') || []; } catch (e) { local = []; }
            tlLibSynced = Array.isArray(local) ? local : [];
            if (tlLibSynced.length) ref.set(tlLibSynced);
        } else {
            tlLibSynced = arr;
            try { localStorage.setItem(TL_TERRAIN_LIB_KEY, JSON.stringify(arr)); } catch (e) { /* quota */ }
        }
        tlRenderLibrary();
    });
    if (typeof unsubscribeListeners !== 'undefined') {
        unsubscribeListeners.push(() => ref.off('value', listener));
    }
}

// ===== AI 生成 =====

function tlSchemaExample() {
    return {
        theme: '陰森沼澤',
        tiles: [
            { name: '腐水泥沼', color: '#3e5c3a', effect: '【深陷】移動消耗x2(困難地形)。回合結束受1點毒素(L)。', moveCostMultiplier: 2 },
            { name: '枯木殘骸', color: '#5d4037', effect: '掩體：防禦+4。', moveCostMultiplier: 1 },
            { name: '磷光孢子', color: '#7cb342', effect: '【致幻】進入時-2意志。', moveCostMultiplier: 1 }
        ]
    };
}

/** 從地形庫抽 1 組作為 few-shot；庫是空的則從內建主題（MAP_PRESETS）隨機挑一組風格範例。 */
function tlPickExamples() {
    const lib = tlLoadLibrary();
    if (lib.length) {
        const picked = lib[Math.floor(Math.random() * lib.length)];
        return { example: { theme: picked.theme, tiles: picked.tiles }, fromLibrary: true };
    }
    if (typeof MAP_PRESETS !== 'undefined' && MAP_PRESETS.length) {
        const preset = MAP_PRESETS[Math.floor(Math.random() * MAP_PRESETS.length)];
        const tiles = preset.tiles
            .filter(t => t.name !== '地板')
            .map(t => ({ name: t.name, color: t.color, effect: t.effect, moveCostMultiplier: t.moveCostMultiplier || 1 }));
        return { example: { theme: preset.name, tiles }, fromLibrary: false };
    }
    return { example: tlSchemaExample(), fromLibrary: false };
}

function tlBuildSystemPrompt(theme) {
    const { example, fromLibrary } = tlPickExamples();
    const exampleText = JSON.stringify(example, null, 2);

    return [
        '你是一個 TRPG 地圖地形設計器（邊獄公司 Limbus Company 戰棋跑團工具）。請依使用者提供的主題，',
        '產生一組（3~5 種）風格一致的地形資料 JSON，且只輸出 JSON 本體、不要任何說明文字或 markdown 圍欄。',
        '',
        fromLibrary
            ? '以下是地形庫中既有主題的真實資料，作為 JSON 結構與命名／效果文字風格的參考範例（Few-shot）：'
            : '以下是系統內建主題的真實地形資料，作為 JSON 結構與命名／效果文字風格的參考範例（Few-shot）：',
        exampleText,
        '',
        '欄位說明：',
        '- theme：字串，這組地形的主題名稱。',
        '- tiles：陣列，每個地形物件包含：',
        '  - name（字串，簡短有畫面感，例如「腐水泥沼」「磷光孢子」）',
        '  - color（字串，CSS 顏色，建議 hex 或 rgba，需符合主題氛圍）',
        '  - effect（字串，仿照範例的風格：可用【效果名稱】開頭，接一句機制化的效果描述，',
        '    例如移動消耗、防禦加減、每回合傷害、施加狀態等；只是好看的敘述沒有意義，必須是明確可執行的機制）',
        '  - moveCostMultiplier（數字，預設 1 代表不影響移動；困難地形設 2 或以上，若地形描述提到',
        '    「移動困難」「深陷」「泥濘」之類，必須確實設對應的倍率，不能只寫在文字裡卻用預設值 1）',
        '',
        '整組地形應該像同一個場景的一部分（例如同一種沼澤／同一艘船的不同角落），彼此有變化但風格統一，',
        '不要每個地形都做同一件事。地形數量建議 3~5 種，避免過多。',
        `主題：「${theme || '未指定，請自由發揮一個符合邊獄公司陰暗詭譎氣氛的主題'}」。`
    ].join('\n');
}

async function tlRequestGenerate() {
    const previewEl = document.getElementById('tl-preview');
    const btn = document.getElementById('tl-generate-btn');
    if (!previewEl) return;

    const theme = (document.getElementById('tl-theme')?.value || '').trim();

    const endpoint = (tlGetSetting(TL_AI_ENDPOINT_KEY, TL_AI_DEFAULT_ENDPOINT) || '').trim() || TL_AI_DEFAULT_ENDPOINT;
    const apiKey = (tlGetSetting(TL_AI_KEY_KEY, '') || '').trim();
    const model = (tlGetSetting(TL_AI_MODEL_KEY, TL_AI_DEFAULT_MODEL) || '').trim() || TL_AI_DEFAULT_MODEL;
    if (!apiKey) {
        if (typeof showToast === 'function') showToast('請先在「人格鍛造爐」填入 API Key（與怪物庫共用同一組設定）');
        return;
    }

    if (btn) { btn.disabled = true; btn.dataset.label = btn.innerText; btn.innerText = '⏳ AI 構築中...'; }
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                temperature: 0.7,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: tlBuildSystemPrompt(theme) },
                    { role: 'user', content: `主題：${theme || '隨機發揮'}。請生成 3~5 種風格一致的地形。` }
                ]
            })
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${res.statusText}${errText ? '：' + errText.slice(0, 300) : ''}`);
        }
        const data = await res.json();
        const content = (data && data.choices && data.choices[0] && data.choices[0].message)
            ? (data.choices[0].message.content || '') : '';
        if (!content) throw new Error('AI 回傳內容為空');
        let pretty = content.trim();
        try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch (e) { /* 保留原文 */ }
        previewEl.value = pretty;
        if (typeof showToast === 'function') showToast('AI 已產生地形組，確認後可存入地形庫');
    } catch (err) {
        previewEl.value = `// 產生失敗：${err && err.message ? err.message : err}\n// 請檢查 API 設定，或手動填寫地形 JSON。`;
        if (typeof showToast === 'function') showToast('AI 構築失敗，詳見預覽區');
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = btn.dataset.label || '🤖 請求 AI 構築地形'; }
    }
}

/** 把任意 AI 回傳結構正規化為地形陣列（接受 {theme,tiles:[]}／{tiles:[]}／裸陣列）。 */
function tlNormalizeTiles(parsed) {
    let list = [];
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && Array.isArray(parsed.tiles)) list = parsed.tiles;
    else if (parsed && typeof parsed === 'object') list = [parsed];
    return list.filter(t => t && t.name).map(t => ({
        name: String(t.name).slice(0, 20),
        color: String(t.color || '#666666').slice(0, 40),
        effect: String(t.effect || '').slice(0, 200),
        moveCostMultiplier: Math.max(0.5, parseFloat(t.moveCostMultiplier) || 1)
    }));
}

function tlSaveGeneratedToLibrary() {
    const previewEl = document.getElementById('tl-preview');
    if (!previewEl) return;
    const text = (previewEl.value || '').trim();
    if (!text) { if (typeof showToast === 'function') showToast('預覽區是空的，請先產生或貼上地形 JSON'); return; }

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { if (typeof showToast === 'function') showToast('JSON 格式錯誤：' + (e.message || e)); return; }

    const tiles = tlNormalizeTiles(parsed);
    if (!tiles.length) { if (typeof showToast === 'function') showToast('找不到有效的地形資料'); return; }

    const theme = String((parsed && parsed.theme) || document.getElementById('tl-theme')?.value || '未命名主題').slice(0, 30);

    const lib = tlLoadLibrary();
    lib.push({ id: 'tset_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), theme, tiles });
    tlSaveLibrary(lib);
    tlRenderLibrary();
    if (typeof showToast === 'function') showToast(`已存入地形庫（「${theme}」，${tiles.length} 種地形）`);
}

function tlDeleteSet(id) {
    tlSaveLibrary(tlLoadLibrary().filter(s => s.id !== id));
    tlRenderLibrary();
}

/** 套用：把地形組的所有地形合併進目前的調色盤（不覆蓋既有地形，各自配發新 id）。僅 ST 可操作。 */
function tlApplySetToPalette(id) {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const set = tlLoadLibrary().find(s => s.id === id);
    if (!set || !Array.isArray(set.tiles) || !set.tiles.length) return;

    if (!state.mapPalette) state.mapPalette = [];
    let nextId = Date.now() % 100000 + 1000;
    set.tiles.forEach(t => {
        state.mapPalette.push({
            id: nextId++,
            name: t.name,
            color: t.color,
            effect: t.effect,
            moveCostMultiplier: t.moveCostMultiplier || 1
        });
    });

    if (typeof updateToolbar === 'function') updateToolbar();
    if (typeof syncMapPalette === 'function') syncMapPalette();
    if (typeof myRole !== 'undefined' && myRole === 'st' && typeof sendState === 'function') sendState();
    if (typeof showToast === 'function') showToast(`已套用「${set.theme}」（新增 ${set.tiles.length} 種地形到調色盤）`);
    tlCloseModal();
}

// ===== 渲染 =====

function tlRenderLibrary() {
    const box = document.getElementById('tl-library-list');
    if (!box) return;
    const lib = tlLoadLibrary();

    // 以 DOM 節點 + textContent 建構，避免把跨客戶端資料經由 innerHTML 注入，杜絕 XSS。
    box.textContent = '';
    if (!lib.length) {
        const empty = document.createElement('div');
        empty.className = 'log-empty';
        empty.textContent = '地形庫是空的。用上方 AI 構築或手動貼上 JSON 後存入。';
        box.appendChild(empty);
        return;
    }

    const frag = document.createDocumentFragment();
    for (const set of lib) {
        const card = document.createElement('div');
        card.className = 'tl-set-card';

        const head = document.createElement('div');
        head.className = 'tl-set-head';

        const swatches = document.createElement('div');
        swatches.className = 'tl-swatches';
        (set.tiles || []).forEach(t => {
            const dot = document.createElement('span');
            dot.className = 'tl-swatch';
            dot.style.background = t.color || '#666';
            dot.title = t.name || '';
            swatches.appendChild(dot);
        });
        head.appendChild(swatches);

        const title = document.createElement('div');
        title.className = 'tl-set-title';
        title.textContent = `${set.theme || '未命名主題'}`;
        head.appendChild(title);

        const count = document.createElement('span');
        count.className = 'tl-set-count';
        count.textContent = `${(set.tiles || []).length} 種`;
        head.appendChild(count);

        card.appendChild(head);

        const tileList = document.createElement('div');
        tileList.className = 'tl-tile-list';
        (set.tiles || []).forEach(t => {
            const row = document.createElement('div');
            row.className = 'tl-tile-row';
            const dot = document.createElement('span');
            dot.className = 'tl-swatch';
            dot.style.background = t.color || '#666';
            row.appendChild(dot);
            const name = document.createElement('span');
            name.className = 'tl-tile-name';
            name.textContent = t.name || '';
            row.appendChild(name);
            const effect = document.createElement('span');
            effect.className = 'tl-tile-effect';
            const moveCostNote = (t.moveCostMultiplier && t.moveCostMultiplier !== 1) ? `（移動×${t.moveCostMultiplier}）` : '';
            effect.textContent = `${t.effect || ''}${moveCostNote}`;
            row.appendChild(effect);
            tileList.appendChild(row);
        });
        card.appendChild(tileList);

        const actions = document.createElement('div');
        actions.className = 'tl-set-actions';
        const applyBtn = document.createElement('button');
        applyBtn.className = 'lv-btn lv-btn-deploy';
        applyBtn.title = '把這組地形加入目前的地形調色盤';
        applyBtn.textContent = '📥 套用到調色盤';
        applyBtn.addEventListener('click', () => tlApplySetToPalette(set.id));
        const delBtn = document.createElement('button');
        delBtn.className = 'lv-btn lv-btn-del';
        delBtn.title = '從地形庫刪除';
        delBtn.textContent = '🗑️';
        delBtn.addEventListener('click', () => tlDeleteSet(set.id));
        actions.appendChild(applyBtn);
        actions.appendChild(delBtn);
        card.appendChild(actions);

        frag.appendChild(card);
    }
    box.appendChild(frag);
}

// ===== Modal 開關 =====

function tlOpenModal() {
    if (typeof myRole === 'undefined' || myRole !== 'st') {
        if (typeof showToast === 'function') showToast('只有 ST 可以使用地形庫');
        return;
    }
    const existing = document.getElementById('terrain-library-modal');
    if (existing) existing.remove();

    const html = `
        <div class="modal-overlay show" id="terrain-library-modal" onclick="if(event.target.id==='terrain-library-modal')tlCloseModal()">
            <div class="modal" style="max-width:520px;" onclick="event.stopPropagation()">
                <div class="modal-header modal-header--create">
                    <span style="font-weight:bold;">🗺️ AI 地形庫</span>
                    <button onclick="tlCloseModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <p class="tl-hint">依主題請 AI 生成一組風格一致的地形（含移動消耗等機制設定），存起來之後隨時「套用」到調色盤，不用每次手刻。</p>

                    <div class="form-group">
                        <label class="tile-editor-label">主題</label>
                        <input type="text" id="tl-theme" placeholder="例：陰森沼澤、機械工廠、鮮血祭壇（留空由 AI 自由發揮）">
                    </div>
                    <button class="modal-btn" id="tl-generate-btn" onclick="tlRequestGenerate()" style="background:var(--accent-purple);width:100%;">🤖 請求 AI 構築地形</button>

                    <div class="form-group">
                        <label class="tile-editor-label">地形 JSON 預覽（可手動修改）</label>
                        <textarea id="tl-preview" class="tl-preview" rows="9" spellcheck="false"
                                  placeholder="AI 產生的地形 JSON 會出現在這裡，你也可以直接貼上／修改後存入地形庫。"></textarea>
                    </div>
                    <button class="modal-btn" onclick="tlSaveGeneratedToLibrary()" style="background:var(--accent-green);color:#000;width:100%;">💾 存入地形庫</button>

                    <div class="tile-editor-divider"></div>

                    <div class="form-group">
                        <label class="tile-editor-label">📦 地形庫</label>
                        <div id="tl-library-list" class="tl-library-list"></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modals-container').insertAdjacentHTML('beforeend', html);
    tlRenderLibrary();
}

function tlCloseModal() {
    const modal = document.getElementById('terrain-library-modal');
    if (modal) modal.remove();
}

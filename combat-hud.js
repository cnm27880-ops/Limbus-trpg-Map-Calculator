/**
 * Limbus Command - 戰鬥 HUD 模組
 * 全域懸浮戰鬥儀表板 (Floating Combat HUD)
 *
 * Features:
 * - Google Sheets API 整合
 * - 拖曳定位 (Draggable)
 * - 收合/展開 (Collapsible)
 * - 防禦切換 (Defense Swap)
 * - localStorage 持久化
 */

// ===== Configuration =====
const HUD_CONFIG = {
    DEFAULT_SPREADSHEET_ID: '1kW0xdl7J7khTgl6cLTn05xjVa6xktMgct-KdwAiitwc',
    DEFAULT_API_KEY: '', // 需要用戶自行設定
    REFRESH_COOLDOWN: 10000, // 10 seconds
    DEFAULT_POSITION: { x: 20, y: 80 }
};

// 取得用戶設定的 API 資訊
function getHUDAPIConfig() {
    const savedApiKey = localStorage.getItem('limbus_hud_api_key') || '';
    const savedSheetId = localStorage.getItem('limbus_hud_sheet_id') || HUD_CONFIG.DEFAULT_SPREADSHEET_ID;
    return {
        apiKey: savedApiKey,
        sheetId: savedSheetId
    };
}

// ===== Cell Coordinate Map =====
const CELL_RANGES = {
    // Resources
    willpool: 'Q3',
    willspent: 'T4',
    energyNames: ['Q7', 'Q8', 'Q9', 'Q10', 'Q11', 'Q12', 'Q13'],
    energyMax: ['W7', 'W8', 'W9', 'W10', 'W11', 'W12', 'W13'],
    energySpent: ['AC7', 'AC8', 'AC9', 'AC10', 'AC11', 'AC12', 'AC13'],

    // Combat Stats
    initiative: 'E49',

    // Saves
    willSaveBase: 'E53',
    willSaveExtra1: 'H53',
    willSaveExtra2: 'I53',
    reflexSaveBase: 'E54',
    reflexSaveExtra1: 'H54',
    reflexSaveExtra2: 'I54',
    fortSaveBase: 'E55',
    fortSaveExtra1: 'H55',
    fortSaveExtra2: 'I55',

    // Defenses
    normalDefBase: 'Y44',
    normalDefExtra: 'AB44',
    blockDefBase: 'Y46',
    blockDefExtra: 'AB46',
    fullDefBase: 'Y48',
    fullDefExtra: 'AB48',
    flatDefValue: 'Y50',

    // Attack Presets (6 presets)
    attacks: [
        { name: 'F59', dp: 'F61', extra: 'F63', limit: 'F64', pen: 'AB62', magic: 'AB63', speed: 'AB64' },
        { name: 'F66', dp: 'F68', extra: 'F70', limit: 'F71', pen: 'AB69', magic: 'AB70', speed: 'AB71' },
        { name: 'F73', dp: 'F75', extra: 'F77', limit: 'F78', pen: 'AB76', magic: 'AB77', speed: 'AB78' },
        { name: 'AH59', dp: 'AH61', extra: 'AH63', limit: 'AH64', pen: 'BD62', magic: 'BD63', speed: 'BD64' },
        { name: 'AH66', dp: 'AH68', extra: 'AH70', limit: 'AH71', pen: 'BD69', magic: 'BD70', speed: 'BD71' },
        { name: 'AH73', dp: 'AH75', extra: 'AH77', limit: 'AH78', pen: 'BD76', magic: 'BD77', speed: 'BD78' }
    ]
};

// ===== HUD State =====
let hudState = {
    isVisible: false,
    isCollapsed: false,
    position: { ...HUD_CONFIG.DEFAULT_POSITION },
    activeDefenseIndex: 1, // Default: 格擋防禦 (Block)
    activeAttackIndex: 0, // Default: 第一個攻擊預設
    boundTab: null,
    lastRefresh: 0,
    data: null
};

// ===== Storage Keys =====
const HUD_STORAGE_KEYS = {
    POSITION: 'limbus_hud_position',
    COLLAPSED: 'limbus_hud_collapsed',
    ACTIVE_TAB: 'limbus_hud_active_tab',
    DEFENSE_INDEX: 'limbus_hud_defense_index',
    ATTACK_INDEX: 'limbus_hud_attack_index'
};

// ===== Initialize HUD =====
function initCombatHUD() {
    loadHUDSettings();
    createHUDElement();
    createImportModal();
    createSettingsModal();

    // Restore HUD if previously bound
    if (hudState.boundTab) {
        showCombatHUD();
        refreshHUDData();
    }

    console.log('Combat HUD: 模組已初始化');
}

// ===== Settings Modal =====
function createSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'hud-settings-modal';
    modal.className = 'sheet-import-modal hidden';

    const config = getHUDAPIConfig();

    modal.innerHTML = `
        <div class="sheet-import-content" style="max-width:450px;">
            <div class="sheet-import-header">
                <h3>HUD 設定</h3>
                <button class="close-btn" onclick="closeHUDSettings()">×</button>
            </div>
            <div class="sheet-import-body">
                <div class="hud-settings-form">
                    <div class="hud-settings-group">
                        <label class="hud-settings-label">Google Sheets API Key <span style="color:var(--accent-red);">*必填</span></label>
                        <input type="text" id="hud-api-key-input" class="hud-settings-input"
                            placeholder="輸入您的 Google API Key"
                            value="${escapeHtml(config.apiKey)}">
                        <div class="hud-settings-hint">
                            請前往 <a href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color:var(--hud-highlight);">Google Cloud Console</a> 建立 API Key
                        </div>
                    </div>
                    <div class="hud-settings-group">
                        <label class="hud-settings-label">Google Spreadsheet ID</label>
                        <input type="text" id="hud-sheet-id-input" class="hud-settings-input"
                            placeholder="輸入 Spreadsheet ID"
                            value="${escapeHtml(config.sheetId)}">
                        <div class="hud-settings-hint">
                            Spreadsheet URL 中的 ID，例如：<br>
                            https://docs.google.com/spreadsheets/d/<strong style="color:var(--accent-yellow);">[這段就是ID]</strong>/edit
                        </div>
                    </div>
                    <div class="hud-settings-actions">
                        <button class="hud-settings-btn secondary" onclick="closeHUDSettings()">取消</button>
                        <button class="hud-settings-btn primary" onclick="saveHUDAPISettings()">儲存設定</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeHUDSettings();
    });
}

function openHUDSettings() {
    const modal = document.getElementById('hud-settings-modal');
    if (modal) {
        // 更新輸入框的值
        const config = getHUDAPIConfig();
        const apiKeyInput = document.getElementById('hud-api-key-input');
        const sheetIdInput = document.getElementById('hud-sheet-id-input');
        if (apiKeyInput) apiKeyInput.value = config.apiKey;
        if (sheetIdInput) sheetIdInput.value = config.sheetId;
        modal.classList.remove('hidden');
    }
}

function closeHUDSettings() {
    const modal = document.getElementById('hud-settings-modal');
    if (modal) modal.classList.add('hidden');
}

function saveHUDAPISettings() {
    const apiKeyInput = document.getElementById('hud-api-key-input');
    const sheetIdInput = document.getElementById('hud-sheet-id-input');

    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
    const sheetId = sheetIdInput ? sheetIdInput.value.trim() : HUD_CONFIG.DEFAULT_SPREADSHEET_ID;

    if (!apiKey) {
        if (typeof showToast === 'function') {
            showToast('請輸入 Google API Key');
        }
        return;
    }

    localStorage.setItem('limbus_hud_api_key', apiKey);
    localStorage.setItem('limbus_hud_sheet_id', sheetId);

    if (typeof showToast === 'function') {
        showToast('設定已儲存');
    }

    closeHUDSettings();
}

// ===== Storage Functions =====
function loadHUDSettings() {
    try {
        const pos = localStorage.getItem(HUD_STORAGE_KEYS.POSITION);
        if (pos) hudState.position = JSON.parse(pos);

        const collapsed = localStorage.getItem(HUD_STORAGE_KEYS.COLLAPSED);
        if (collapsed !== null) hudState.isCollapsed = JSON.parse(collapsed);

        const tab = localStorage.getItem(HUD_STORAGE_KEYS.ACTIVE_TAB);
        if (tab) hudState.boundTab = tab;

        const defIdx = localStorage.getItem(HUD_STORAGE_KEYS.DEFENSE_INDEX);
        if (defIdx !== null) hudState.activeDefenseIndex = parseInt(defIdx);

        const atkIdx = localStorage.getItem(HUD_STORAGE_KEYS.ATTACK_INDEX);
        if (atkIdx !== null) hudState.activeAttackIndex = parseInt(atkIdx);
    } catch (e) {
        console.error('Failed to load HUD settings:', e);
    }
}

function saveHUDSettings() {
    try {
        localStorage.setItem(HUD_STORAGE_KEYS.POSITION, JSON.stringify(hudState.position));
        localStorage.setItem(HUD_STORAGE_KEYS.COLLAPSED, JSON.stringify(hudState.isCollapsed));
        localStorage.setItem(HUD_STORAGE_KEYS.ACTIVE_TAB, hudState.boundTab || '');
        localStorage.setItem(HUD_STORAGE_KEYS.DEFENSE_INDEX, hudState.activeDefenseIndex.toString());
        localStorage.setItem(HUD_STORAGE_KEYS.ATTACK_INDEX, hudState.activeAttackIndex.toString());
    } catch (e) {
        console.error('Failed to save HUD settings:', e);
    }
}

// ===== Create HUD Element =====
function createHUDElement() {
    const hud = document.createElement('div');
    hud.id = 'combat-hud';
    hud.className = 'combat-hud hidden';
    hud.innerHTML = `
        <div class="hud-header" id="hud-header">
            <div class="hud-title">
                <span class="hud-title-text">戰鬥儀表板</span>
                <span class="hud-character-name" id="hud-char-name">未綁定</span>
            </div>
            <div class="hud-controls">
                <button class="hud-btn refresh-btn" id="hud-refresh-btn" onclick="refreshHUDData()" title="重新載入數據">⟳</button>
                <button class="hud-btn" onclick="closeCombatHUD()" title="關閉">×</button>
            </div>
        </div>
        <div class="hud-body" id="hud-body">
            <!-- Content will be dynamically generated -->
            <div style="text-align:center;padding:30px;color:var(--hud-text-dim);">
                載入中...
            </div>
        </div>
    `;

    document.body.appendChild(hud);

    // Apply saved position
    updateHUDPosition();

    // Apply collapsed state
    if (hudState.isCollapsed) {
        hud.classList.add('collapsed');
    }

    // Setup drag functionality
    setupHUDDrag();

    // Setup double-click to collapse
    const header = document.getElementById('hud-header');
    header.addEventListener('dblclick', toggleHUDCollapse);
}

// ===== Create Import Modal =====
function createImportModal() {
    const modal = document.createElement('div');
    modal.id = 'sheet-import-modal';
    modal.className = 'sheet-import-modal hidden';
    modal.innerHTML = `
        <div class="sheet-import-content">
            <div class="sheet-import-header">
                <h3>從 Sheet 匯入角色</h3>
                <button class="close-btn" onclick="closeImportModal()">×</button>
            </div>
            <div class="sheet-import-body" id="sheet-import-body">
                <div class="sheet-import-loading">
                    <div class="spinner"></div>
                    <div>正在載入角色列表...</div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeImportModal();
    });
}

// ===== Import Modal Functions =====
function openImportModal() {
    const modal = document.getElementById('sheet-import-modal');
    modal.classList.remove('hidden');
    fetchSheetTabs();
}

function closeImportModal() {
    const modal = document.getElementById('sheet-import-modal');
    modal.classList.add('hidden');
}

// ===== Google Sheets API Functions =====
async function fetchSheetTabs() {
    const body = document.getElementById('sheet-import-body');
    const config = getHUDAPIConfig();

    // 檢查是否已設定 API Key
    if (!config.apiKey) {
        body.innerHTML = `
            <div class="sheet-import-error">
                請先設定 Google API Key<br>
                <button class="hud-settings-btn primary" style="margin-top:10px;" onclick="closeImportModal(); openHUDSettings();">前往設定</button>
            </div>
        `;
        return;
    }

    body.innerHTML = `
        <div class="sheet-import-loading">
            <div class="spinner"></div>
            <div>正在載入角色列表...</div>
        </div>
    `;

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}?key=${config.apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const sheets = data.sheets || [];

        if (sheets.length === 0) {
            body.innerHTML = '<div class="sheet-import-error">找不到任何角色頁面</div>';
            return;
        }

        // Filter out system sheets (typically starting with underscore or specific names)
        const characterSheets = sheets
            .map(s => s.properties.title)
            .filter(name => !name.startsWith('_') && name !== '模板' && name !== 'Template');

        if (characterSheets.length === 0) {
            body.innerHTML = '<div class="sheet-import-error">找不到任何角色頁面</div>';
            return;
        }

        // Render tab buttons
        body.innerHTML = `
            <div class="sheet-tabs-grid">
                ${characterSheets.map(name => `
                    <button class="sheet-tab-btn" onclick="selectCharacterTab('${escapeHtml(name)}')">${escapeHtml(name)}</button>
                `).join('')}
            </div>
        `;

    } catch (error) {
        console.error('Failed to fetch sheet tabs:', error);
        body.innerHTML = `<div class="sheet-import-error">載入失敗: ${error.message}</div>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function selectCharacterTab(tabName) {
    hudState.boundTab = tabName;
    saveHUDSettings();
    closeImportModal();
    showCombatHUD();
    await refreshHUDData();
}

// ===== Fetch Character Data =====
async function refreshHUDData() {
    // Check cooldown
    const now = Date.now();
    if (now - hudState.lastRefresh < HUD_CONFIG.REFRESH_COOLDOWN) {
        const remaining = Math.ceil((HUD_CONFIG.REFRESH_COOLDOWN - (now - hudState.lastRefresh)) / 1000);
        if (typeof showToast === 'function') {
            showToast(`請等待 ${remaining} 秒後再刷新`);
        }
        return;
    }

    if (!hudState.boundTab) return;

    // Set cooldown state
    const refreshBtn = document.getElementById('hud-refresh-btn');
    if (refreshBtn) {
        refreshBtn.classList.add('cooldown');
        setTimeout(() => refreshBtn.classList.remove('cooldown'), HUD_CONFIG.REFRESH_COOLDOWN);
    }

    hudState.lastRefresh = now;

    // Build ranges array
    const ranges = buildRangesArray(hudState.boundTab);
    const config = getHUDAPIConfig();

    if (!config.apiKey) {
        if (typeof showToast === 'function') {
            showToast('請先設定 Google API Key');
        }
        return;
    }

    try {
        const rangesParam = ranges.map(r => encodeURIComponent(r)).join('&ranges=');
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values:batchGet?ranges=${rangesParam}&key=${config.apiKey}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        hudState.data = parseSheetData(data.valueRanges);
        renderHUDContent();

    } catch (error) {
        console.error('Failed to fetch character data:', error);
        const body = document.getElementById('hud-body');
        if (body) {
            body.innerHTML = `
                <div style="text-align:center;padding:30px;color:var(--hud-danger);">
                    載入失敗: ${error.message}<br>
                    <button class="hud-btn" style="margin-top:10px;width:auto;padding:8px 16px;" onclick="refreshHUDData()">重試</button>
                </div>
            `;
        }
    }
}

function buildRangesArray(tabName) {
    const ranges = [];
    const prefix = `'${tabName}'!`;

    // Resources
    ranges.push(prefix + CELL_RANGES.willpool);
    ranges.push(prefix + CELL_RANGES.willspent);

    // Energy pools
    CELL_RANGES.energyNames.forEach(c => ranges.push(prefix + c));
    CELL_RANGES.energyMax.forEach(c => ranges.push(prefix + c));
    CELL_RANGES.energySpent.forEach(c => ranges.push(prefix + c));

    // Combat stats
    ranges.push(prefix + CELL_RANGES.initiative);

    // Saves
    ranges.push(prefix + CELL_RANGES.willSaveBase);
    ranges.push(prefix + CELL_RANGES.willSaveExtra1);
    ranges.push(prefix + CELL_RANGES.willSaveExtra2);
    ranges.push(prefix + CELL_RANGES.reflexSaveBase);
    ranges.push(prefix + CELL_RANGES.reflexSaveExtra1);
    ranges.push(prefix + CELL_RANGES.reflexSaveExtra2);
    ranges.push(prefix + CELL_RANGES.fortSaveBase);
    ranges.push(prefix + CELL_RANGES.fortSaveExtra1);
    ranges.push(prefix + CELL_RANGES.fortSaveExtra2);

    // Defenses
    ranges.push(prefix + CELL_RANGES.normalDefBase);
    ranges.push(prefix + CELL_RANGES.normalDefExtra);
    ranges.push(prefix + CELL_RANGES.blockDefBase);
    ranges.push(prefix + CELL_RANGES.blockDefExtra);
    ranges.push(prefix + CELL_RANGES.fullDefBase);
    ranges.push(prefix + CELL_RANGES.fullDefExtra);
    ranges.push(prefix + CELL_RANGES.flatDefValue);

    // Attack presets
    CELL_RANGES.attacks.forEach(atk => {
        ranges.push(prefix + atk.name);
        ranges.push(prefix + atk.dp);
        ranges.push(prefix + atk.extra);
        ranges.push(prefix + atk.limit);
        ranges.push(prefix + atk.pen);
        ranges.push(prefix + atk.magic);
        ranges.push(prefix + atk.speed);
    });

    return ranges;
}

function parseSheetData(valueRanges) {
    const getValue = (index) => {
        const range = valueRanges[index];
        if (!range || !range.values || !range.values[0]) return '';
        return range.values[0][0] || '';
    };

    const getNumber = (index) => {
        const val = getValue(index);
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
    };

    let idx = 0;

    // Resources
    const willpool = getNumber(idx++);
    const willspent = getNumber(idx++);

    // Energy pools
    const energyPools = [];
    const energyNamesStart = idx;
    idx += 7;
    const energyMaxStart = idx;
    idx += 7;
    const energySpentStart = idx;
    idx += 7;

    for (let i = 0; i < 7; i++) {
        const name = getValue(energyNamesStart + i);
        if (name && name.trim()) {
            const max = getNumber(energyMaxStart + i);
            const spent = getNumber(energySpentStart + i);
            energyPools.push({
                name: name.trim(),
                max: max,
                current: max - spent
            });
        }
    }

    // Combat stats
    const initiative = getNumber(idx++);

    // Saves
    const willSaveBase = getNumber(idx++);
    const willSaveExtra1 = getNumber(idx++);
    const willSaveExtra2 = getNumber(idx++);
    const reflexSaveBase = getNumber(idx++);
    const reflexSaveExtra1 = getNumber(idx++);
    const reflexSaveExtra2 = getNumber(idx++);
    const fortSaveBase = getNumber(idx++);
    const fortSaveExtra1 = getNumber(idx++);
    const fortSaveExtra2 = getNumber(idx++);

    // Defenses
    const normalDefBase = getNumber(idx++);
    const normalDefExtra = getNumber(idx++);
    const blockDefBase = getNumber(idx++);
    const blockDefExtra = getNumber(idx++);
    const fullDefBase = getNumber(idx++);
    const fullDefExtra = getNumber(idx++);
    const flatDefValue = getNumber(idx++);

    // Attack presets
    const attacks = [];
    for (let i = 0; i < 6; i++) {
        const name = getValue(idx++);
        const dp = getNumber(idx++);
        const extra = getNumber(idx++);
        const limit = getNumber(idx++);
        const penVal = parseInt(getValue(idx++)) || 0;
        const magicVal = parseInt(getValue(idx++)) || 0;
        const speedVal = parseInt(getValue(idx++)) || 0;

        if (name && name.trim()) {
            attacks.push({
                name: name.trim(),
                dp: dp,
                extra: extra,
                limit: limit,
                penVal: penVal,
                magicVal: magicVal,
                speedVal: speedVal
            });
        }
    }

    return {
        willpower: {
            pool: willpool,
            current: willpool - willspent
        },
        energyPools: energyPools,
        initiative: initiative,
        saves: {
            will: { base: willSaveBase, extra: willSaveExtra1 + willSaveExtra2 },
            reflex: { base: reflexSaveBase, extra: reflexSaveExtra1 + reflexSaveExtra2 },
            fort: { base: fortSaveBase, extra: fortSaveExtra1 + fortSaveExtra2 }
        },
        defenses: [
            { type: '普通防禦', base: normalDefBase, extra: normalDefExtra },
            { type: '格擋防禦', base: blockDefBase, extra: blockDefExtra },
            { type: '全力防禦', base: fullDefBase, extra: fullDefExtra },
            { type: '措手不及', base: flatDefValue, extra: 0, single: true }
        ],
        attacks: attacks
    };
}

// ===== Render HUD Content =====
function renderHUDContent() {
    const body = document.getElementById('hud-body');
    const charName = document.getElementById('hud-char-name');

    if (!hudState.data) {
        body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--hud-text-dim);">無數據</div>';
        return;
    }

    charName.textContent = hudState.boundTab || '未綁定';

    const data = hudState.data;

    // Build HTML
    let html = '';

    // Resources Section
    html += `
        <div class="hud-section">
            <div class="hud-section-header">資源</div>
            <div class="hud-section-body">
                ${renderWillpower(data.willpower)}
                ${data.energyPools.length > 0 ? renderEnergyPools(data.energyPools) : ''}
            </div>
        </div>
    `;

    // Combat Stats + Defense Combined Section
    html += `
        <div class="hud-section">
            <div class="hud-section-header">戰鬥數值</div>
            <div class="hud-section-body">
                <div class="combat-stats-compact">
                    <div class="stat-compact">
                        <div class="stat-label">先攻加值</div>
                        <div class="stat-value highlight">+${data.initiative}</div>
                    </div>
                    ${renderDefenseCompact(data.defenses)}
                </div>
                <div class="saves-section">
                    <div class="saves-label">豁免</div>
                    ${renderSaves(data.saves)}
                </div>
            </div>
        </div>
    `;

    // Attack Presets Section
    if (data.attacks.length > 0) {
        html += `
            <div class="hud-section">
                <div class="hud-section-header">攻擊預設</div>
                <div class="hud-section-body">
                    ${renderAttacks(data.attacks)}
                </div>
            </div>
        `;
    }

    body.innerHTML = html;
}

function renderWillpower(wp) {
    const percent = wp.pool > 0 ? (wp.current / wp.pool) * 100 : 0;
    return `
        <div class="resource-bar">
            <div class="resource-header">
                <span class="resource-name">意志池</span>
                <span class="resource-value">${wp.current} / ${wp.pool}</span>
            </div>
            <div class="resource-track">
                <div class="resource-fill willpower" style="width: ${percent}%"></div>
            </div>
        </div>
    `;
}

function renderEnergyPools(pools) {
    return `
        <div class="energy-pools" style="margin-top:10px;">
            ${pools.map(pool => {
                const percent = pool.max > 0 ? (pool.current / pool.max) * 100 : 0;
                return `
                    <div class="energy-pool-item">
                        <div class="energy-pool-name" title="${escapeHtml(pool.name)}">${escapeHtml(pool.name)}</div>
                        <div class="energy-pool-bar">
                            <div class="energy-pool-fill" style="width: ${percent}%"></div>
                        </div>
                        <div class="energy-pool-value">${pool.current}/${pool.max}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderSaves(saves) {
    return `
        <div class="saves-grid">
            <div class="save-item">
                <div class="save-label">意志</div>
                <div class="save-value">${saves.will.base} + ${saves.will.extra}</div>
            </div>
            <div class="save-item">
                <div class="save-label">反射</div>
                <div class="save-value">${saves.reflex.base} + ${saves.reflex.extra}</div>
            </div>
            <div class="save-item">
                <div class="save-label">強韌</div>
                <div class="save-value">${saves.fort.base} + ${saves.fort.extra}</div>
            </div>
        </div>
    `;
}

function renderDefenseCompact(defenses) {
    const activeIdx = hudState.activeDefenseIndex;
    const activeDef = defenses[activeIdx];
    const totalDef = activeDef.single ? activeDef.base : (activeDef.base + activeDef.extra);

    return `
        <div class="defense-compact">
            <div class="defense-compact-header">
                <span class="defense-compact-type" onclick="cycleDefense()" title="點擊切換防禦類型">${activeDef.type}</span>
            </div>
            <div class="defense-compact-value">${totalDef}</div>
            <div class="defense-compact-others">
                ${defenses.map((def, idx) => {
                    if (idx === activeIdx) return '';
                    const val = def.single ? def.base : (def.base + def.extra);
                    return `<span class="defense-mini" onclick="switchDefense(${idx})" title="${def.type}">${val}</span>`;
                }).join('')}
            </div>
        </div>
    `;
}

function cycleDefense() {
    const maxIdx = hudState.data && hudState.data.defenses ? hudState.data.defenses.length - 1 : 3;
    hudState.activeDefenseIndex = (hudState.activeDefenseIndex + 1) % (maxIdx + 1);
    saveHUDSettings();
    renderHUDContent();
}

function renderDefenses(defenses) {
    const activeIdx = hudState.activeDefenseIndex;
    const activeDef = defenses[activeIdx];
    const inactiveDefs = defenses.filter((_, i) => i !== activeIdx);

    return `
        <div class="defense-layout">
            <div class="defense-main">
                <div class="defense-card-big">
                    <div class="defense-type">${activeDef.type}</div>
                    <div class="defense-value">${activeDef.single ? activeDef.base : (activeDef.base + activeDef.extra)}</div>
                    ${!activeDef.single ? `<div class="defense-breakdown">${activeDef.base} + ${activeDef.extra}</div>` : ''}
                </div>
            </div>
            <div class="defense-sidebar">
                ${inactiveDefs.map((def, i) => {
                    const originalIdx = defenses.indexOf(def);
                    return `
                        <div class="defense-card-small" onclick="switchDefense(${originalIdx})">
                            <div class="defense-type">${def.type}</div>
                            <div class="defense-value">${def.single ? def.base : (def.base + def.extra)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderAttacks(attacks) {
    const activeIdx = hudState.activeAttackIndex;
    const activeAtk = attacks[activeIdx];

    // 如果沒有有效的攻擊資料，重置為第一個
    if (!activeAtk && attacks.length > 0) {
        hudState.activeAttackIndex = 0;
        saveHUDSettings();
        return renderAttacks(attacks);
    }

    if (!activeAtk) {
        return '<div style="text-align:center;color:var(--hud-text-dim);padding:20px;">無攻擊預設</div>';
    }

    return `
        <div class="attack-tabs">
            ${attacks.map((atk, idx) => `
                <button class="attack-tab-btn ${idx === activeIdx ? 'active' : ''}"
                        onclick="switchAttack(${idx})"
                        title="${escapeHtml(atk.name)}">
                    ${idx + 1}
                </button>
            `).join('')}
        </div>
        <div class="active-attack-card">
            <div class="attack-card-row">
                <div class="attack-card-name">${escapeHtml(activeAtk.name)}</div>
                <div class="attack-card-dp">${activeAtk.dp} + ${activeAtk.extra}</div>
            </div>
            <div class="attack-card-row">
                <div class="attack-card-tags">
                    ${activeAtk.penVal > 0 ? `<span class="attack-tag pen">破甲 ${activeAtk.penVal}</span>` : ''}
                    ${activeAtk.magicVal > 0 ? `<span class="attack-tag magic">破魔 ${activeAtk.magicVal}</span>` : ''}
                    ${activeAtk.speedVal > 0 ? `<span class="attack-tag speed">高速 ${activeAtk.speedVal}</span>` : ''}
                </div>
                <div class="attack-card-limit">上限: ${activeAtk.limit}</div>
            </div>
        </div>
    `;
}

// ===== Defense Switching =====
function switchDefense(index) {
    hudState.activeDefenseIndex = index;
    saveHUDSettings();
    renderHUDContent();
}

// ===== Attack Switching =====
function switchAttack(index) {
    hudState.activeAttackIndex = index;
    saveHUDSettings();
    renderHUDContent();
}

// ===== HUD Visibility =====
function showCombatHUD() {
    const hud = document.getElementById('combat-hud');
    if (hud) {
        hud.classList.remove('hidden');
        hudState.isVisible = true;
    }
}

function closeCombatHUD() {
    const hud = document.getElementById('combat-hud');
    if (hud) {
        hud.classList.add('hidden');
        hudState.isVisible = false;
    }
}

function toggleCombatHUD() {
    if (hudState.isVisible) {
        closeCombatHUD();
    } else {
        showCombatHUD();
        if (hudState.boundTab) {
            refreshHUDData();
        }
    }
}

// ===== Collapse/Expand =====
function toggleHUDCollapse() {
    const hud = document.getElementById('combat-hud');
    if (!hud) return;

    hudState.isCollapsed = !hudState.isCollapsed;
    hud.classList.toggle('collapsed', hudState.isCollapsed);
    saveHUDSettings();

    // Update minimized bar content if collapsed
    if (hudState.isCollapsed && hudState.data) {
        renderMinimizedBar();
    }
}

function renderMinimizedBar() {
    const body = document.getElementById('hud-body');
    if (!body || !hudState.isCollapsed) return;

    const data = hudState.data;
    if (!data) return;

    body.innerHTML = `
        <div class="hud-minimized-bar">
            <div class="hud-mini-resources">
                <div class="hud-mini-resource">
                    <span class="label">意志</span>
                    <span class="value">${data.willpower.current}/${data.willpower.pool}</span>
                </div>
                ${data.energyPools.slice(0, 2).map(pool => `
                    <div class="hud-mini-resource">
                        <span class="label">${pool.name.substring(0, 3)}</span>
                        <span class="value">${pool.current}/${pool.max}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ===== Drag Functionality =====
function setupHUDDrag() {
    const hud = document.getElementById('combat-hud');
    const header = document.getElementById('hud-header');

    if (!hud || !header) return;

    let isDragging = false;
    let startX, startY;
    let startPosX, startPosY;

    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, { passive: false });

    function startDrag(e) {
        // Ignore if clicking on buttons
        if (e.target.closest('.hud-btn') || e.target.closest('button')) return;

        isDragging = true;

        // Add dragging class to prevent transitions during drag
        hud.classList.add('dragging');

        if (e.type === 'touchstart') {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        } else {
            startX = e.clientX;
            startY = e.clientY;
        }

        // Get the actual current position from the DOM, not from state
        // This ensures accuracy even if state got out of sync
        const rect = hud.getBoundingClientRect();
        startPosX = rect.left;
        startPosY = rect.top;

        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('touchend', stopDrag);

        e.preventDefault();
    }

    function onDrag(e) {
        if (!isDragging) return;

        let clientX, clientY;
        if (e.type === 'touchmove') {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        const deltaX = clientX - startX;
        const deltaY = clientY - startY;

        // Calculate new position with bounds checking
        const newX = startPosX + deltaX;
        const newY = startPosY + deltaY;

        // Get HUD dimensions for boundary calculation
        const hudWidth = hud.offsetWidth || 380;
        const hudHeight = hud.offsetHeight || 200;

        // Keep at least 50px of the HUD visible on screen
        hudState.position.x = Math.max(-hudWidth + 100, Math.min(window.innerWidth - 100, newX));
        hudState.position.y = Math.max(0, Math.min(window.innerHeight - 50, newY));

        updateHUDPosition();
        e.preventDefault();
    }

    function stopDrag() {
        if (isDragging) {
            isDragging = false;
            hud.classList.remove('dragging');
            saveHUDSettings();
        }

        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', onDrag);
        document.removeEventListener('touchend', stopDrag);
    }
}

function updateHUDPosition() {
    const hud = document.getElementById('combat-hud');
    if (hud) {
        hud.style.left = hudState.position.x + 'px';
        hud.style.top = hudState.position.y + 'px';
    }
}

// ===== Unbind Character =====
function unbindHUDCharacter() {
    hudState.boundTab = null;
    hudState.data = null;
    saveHUDSettings();
    closeCombatHUD();
}

// ===== Initialize on DOM Ready =====
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCombatHUD);
    } else {
        // DOM already loaded
        initCombatHUD();
    }
}

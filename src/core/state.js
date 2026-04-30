/**
 * Limbus Command - 狀態管理
 * 集中管理所有全域狀態變數
 */

// ===== 遊戲狀態 =====
let state = {
    units: [],
    turnIdx: 0,
    mapW: MAP_DEFAULTS.WIDTH,
    mapH: MAP_DEFAULTS.HEIGHT,
    mapData: [],
    themeId: 0,
    mapPalette: [],             // 自訂調色盤（混用地形）
    players: {},
    customStatuses: [],  // 房間共享的自訂狀態（透過 Firebase 同步）
    isCombatActive: false,      // 是否處於戰鬥狀態
    activeBossId: null,         // 當前顯示大血條的 BOSS 單位 ID
    lastBatchState: null        // 用於 AOE 的備份狀態
};

// ===== 連線狀態 =====
// 注意：系統使用 Firebase Realtime Database 進行多人同步
let myRole = 'player';  // 'st' 或 'player'
let myName = '';
let myPlayerId = null;
let myPlayerCode = null;

// ===== UI 狀態 =====
let currentTool = 'cursor';
let selectedUnitId = null;
let uploadTargetId = null;

// ===== 相機狀態 =====
let cam = { x: 0, y: 0, scale: 1.0 };
let isDraggingMap = false;
let lastPointer = { x: 0, y: 0 };
let lastDist = 0;  // 用於捏合縮放

// ===== 繪製拖曳狀態 =====
let isPaintingDrag = false;

// ===== 多點觸控狀態 =====
// 用於追蹤是否正在進行雙指縮放操作
// 當此標記為 true 時，pointermove 應忽略拖曳操作
let isPinchZooming = false;

// 注意：Token 拖曳功能已移除 (isDraggingToken, draggedUnit 等)
// 現在使用「點選單位 -> 點擊目標格」的操作模式

// ===== BOSS 計算器狀態 =====
let bossActions = [];

// ===== 狀態操作函數 =====

/**
 * 重置遊戲狀態
 */
function resetState() {
    state = {
        units: [],
        turnIdx: 0,
        mapW: MAP_DEFAULTS.WIDTH,
        mapH: MAP_DEFAULTS.HEIGHT,
        mapData: [],
        themeId: 0,
        mapPalette: [],
        players: {},
        customStatuses: [],
        isCombatActive: false,
        activeBossId: null
    };
}

/**
 * 初始化地圖調色盤
 * 如果 palette 為空，從當前主題複製地形資料
 */
function initMapPalette() {
    if (state.mapPalette && state.mapPalette.length > 0) return;

    const theme = MAP_PRESETS[state.themeId] || MAP_PRESETS[0];
    state.mapPalette = theme.tiles.map(t => ({
        id: t.id,
        name: t.name,
        color: t.color,
        effect: t.effect
    }));
}

/**
 * 從調色盤查找地形定義
 * 優先查 mapPalette，回退查 MAP_PRESETS
 * @param {number} tileId - 地形 ID
 * @returns {Object|null}
 */
function getTileFromPalette(tileId) {
    if (tileId === 0) return null; // 地板

    // 優先從調色盤查找
    if (state.mapPalette && state.mapPalette.length > 0) {
        const found = state.mapPalette.find(t => t.id === tileId);
        if (found) return found;
    }

    // 回退到所有預設主題（舊存檔相容）
    for (const preset of MAP_PRESETS) {
        const found = preset.tiles.find(t => t.id === tileId);
        if (found) return found;
    }

    return null;
}

/**
 * 取得當前主題
 * @returns {Object} 當前地圖主題配置
 */
function getCurrentTheme() {
    return MAP_PRESETS[state.themeId] || MAP_PRESETS[0];
}

/**
 * 根據 ID 查找單位
 * @param {number} id - 單位 ID
 * @returns {Object|undefined} 單位物件或 undefined
 */
function findUnitById(id) {
    return state.units.find(u => u.id === id);
}

/**
 * 檢查當前使用者是否可控制指定單位
 * @param {Object} unit - 單位物件
 * @returns {boolean}
 */
function canControlUnit(unit) {
    if (myRole === 'st') return true;
    return unit.ownerId === myPlayerId;
}

// ===== AOE 批次處理邏輯 =====

/**
 * 儲存當前單位狀態作為備份 (AOE Undo 功能)
 */
function saveBatchState() {
    state.lastBatchState = JSON.parse(JSON.stringify(state.units));
}

/**
 * 還原上一次的單位狀態
 */
function undoLastBatch() {
    if (state.lastBatchState) {
        state.units = JSON.parse(JSON.stringify(state.lastBatchState));
        state.lastBatchState = null;
        broadcastState(); // 同步回所有玩家並重新渲染
    }
}

/**
 * 批次套用動作到選定的單位集合
 * @param {Array} unitIds
 * @param {Object} actionData - { type: 'damage'|'heal'|'status', value: number, statusId: string }
 */
function applyBatchAction(unitIds, actionData) {
    if (!unitIds || unitIds.length === 0) return;
    saveBatchState();

    unitIds.forEach(id => {
        const u = findUnitById(id);
        if (!u) return;

        if (actionData.type === 'damage') {
            const val = parseInt(actionData.value) || 0;
            if (u.shield && u.shield > 0) {
                if (val <= u.shield) {
                    u.shield -= val;
                } else {
                    const remain = val - u.shield;
                    u.shield = 0;
                    u.hp = Math.max(0, u.hp - remain);
                }
            } else {
                u.hp = Math.max(0, u.hp - val);
            }
        } else if (actionData.type === 'heal') {
            const val = parseInt(actionData.value) || 0;
            u.hp = Math.min(u.maxHp, u.hp + val);
        } else if (actionData.type === 'status') {
            if (typeof updateUnitStatus === 'function') {
                // 如果需要增減狀態，呼叫既有邏輯（需確保 updateUnitStatus 支援該參數結構）
                // 這裡實作簡單直接改物件
                if (!u.status) u.status = {};
                const current = u.status[actionData.statusId] || 0;
                const change = parseInt(actionData.value) || 0;
                const newVal = current + change;
                if (newVal <= 0) {
                    delete u.status[actionData.statusId];
                } else {
                    u.status[actionData.statusId] = newVal;
                }
            }
        }
    });

    broadcastState();
}

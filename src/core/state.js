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
    players: {}
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
        players: {}
    };
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

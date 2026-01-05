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
let myPeerId = null;
let myRole = 'player';  // 'st' 或 'player'
let myName = '';
let myPlayerId = null;
let myPlayerCode = null;

let peer = null;
let connections = {};  // ST 儲存所有玩家連線: {peerId: conn}
let hostConn = null;   // 玩家儲存到 ST 的連線
let hostId = null;     // 房間 ID (ST 的 peer ID)

let connectionState = 'disconnected';  // 'disconnected', 'connecting', 'connected'
let heartbeatInterval = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;

// ===== UI 狀態 =====
let currentTool = 'cursor';
let selectedUnitId = null;
let uploadTargetId = null;

// ===== 相機狀態 =====
let cam = { x: 0, y: 0, scale: 1.0 };
let isDraggingMap = false;
let lastPointer = { x: 0, y: 0 };
let lastDist = 0;  // 用於捏合縮放

// ===== Token 拖曳狀態 =====
let isDraggingToken = false;
let draggedUnit = null;
let draggedElement = null;
let dragStartPos = { x: 0, y: 0 };
let tokenStartPos = { x: 0, y: 0 };

// ===== 繪製拖曳狀態 =====
let isPaintingDrag = false;

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

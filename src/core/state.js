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
    mapBgImage: null,           // 地圖背景圖（base64，僅本機儲存）
    players: {},
    customStatuses: [],  // 房間共享的自訂狀態（透過 Firebase 同步）
    statusOverrides: {}, // 常駐狀態的覆寫（id → 修改後的狀態物件，透過 Firebase 同步）
    statusOrder: {},     // 狀態庫各分類的自訂排序（category → [statusId...]，透過 Firebase 同步）
    isCombatActive: false,      // 是否處於戰鬥狀態
    roundNum: 0,                // 戰鬥回合數（開戰=1，先攻列表輪完一圈 +1；未開戰=0）
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
        mapBgImage: null,
        players: {},
        customStatuses: [],
        statusOverrides: {},
        statusOrder: {},
        isCombatActive: false,
        roundNum: 0,
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

// ===== 幸運大轉盤（Roulette）邏輯 =====

/**
 * 確保玩家物件具備轉盤所需欄位（spins / inventory）
 * Firebase 上的舊玩家資料可能缺少這些欄位，讀取後統一補齊。
 * @param {Object} player - 玩家物件
 * @returns {Object} 補齊後的玩家物件
 */
function ensurePlayerRouletteFields(player) {
    if (!player || typeof player !== 'object') return player;
    if (typeof player.spins !== 'number' || player.spins < 0) {
        player.spins = parseInt(player.spins) || 0;
    }
    if (!Array.isArray(player.inventory)) {
        player.inventory = [];
    }
    return player;
}

/**
 * 對 state.players 內所有玩家補齊轉盤欄位
 */
function normalizePlayersRoulette() {
    if (!state.players || typeof state.players !== 'object') return;
    Object.values(state.players).forEach(ensurePlayerRouletteFields);
}

/**
 * 增減指定玩家的抽獎次數，並同步至 Firebase。
 * @param {string} playerId - 玩家 ID
 * @param {number} amount - 增減的次數（可為負）
 */
state.updatePlayerSpins = function (playerId, amount) {
    const player = this.players && this.players[playerId];
    if (!player) return;
    ensurePlayerRouletteFields(player);

    const next = Math.max(0, (parseInt(player.spins) || 0) + (parseInt(amount) || 0));
    player.spins = next;

    // 同步到 Firebase（房間共享）
    if (typeof roomRef !== 'undefined' && roomRef) {
        roomRef.child(`players/${playerId}/spins`).set(next);
    }

    // notify：重繪相關 UI
    notifyRouletteChange();
};

/**
 * 將獎品加入指定玩家的 inventory，並扣除 1 次抽獎次數。
 * @param {string} playerId - 玩家 ID
 * @param {number} prizeId - 獎品 ID（對應 ROULETTE_PRIZES）
 */
state.addPrizeToPlayer = function (playerId, prizeId) {
    const player = this.players && this.players[playerId];
    if (!player) return;
    ensurePlayerRouletteFields(player);

    const prize = (typeof ROULETTE_PRIZES !== 'undefined')
        ? ROULETTE_PRIZES.find(p => p.id === prizeId)
        : null;

    player.inventory.push({
        prizeId: prizeId,
        name: prize ? prize.name : String(prizeId),
        type: prize ? prize.type : 'junk',
        wonAt: Date.now()
    });

    // 扣除 1 次抽獎次數
    player.spins = Math.max(0, (parseInt(player.spins) || 0) - 1);

    // 同步到 Firebase
    if (typeof roomRef !== 'undefined' && roomRef) {
        roomRef.child(`players/${playerId}/inventory`).set(player.inventory);
        roomRef.child(`players/${playerId}/spins`).set(player.spins);
    }

    notifyRouletteChange();
};

/**
 * 廣播一筆抽獎結果到 Firebase（events/roulette），觸發全服中獎動畫。
 * @param {string} playerName - 中獎玩家名稱
 * @param {string} prizeName - 中獎獎品名稱
 */
state.broadcastRouletteResult = function (playerName, prizeName) {
    if (typeof roomRef === 'undefined' || !roomRef) return;
    roomRef.child('events/roulette').set({
        playerName: playerName || '',
        prizeName: prizeName || '',
        ts: (typeof firebase !== 'undefined' && firebase.database)
            ? firebase.database.ServerValue.TIMESTAMP
            : Date.now(),
        // nonce 確保即使連續抽到相同獎品，value 仍會變化以觸發監聽器
        nonce: Math.random().toString(36).slice(2)
    });
};

/**
 * 轉盤資料變更後的通知（重繪轉盤與 ST 管理面板）
 */
function notifyRouletteChange() {
    if (typeof renderRouletteUI === 'function') renderRouletteUI();
    if (typeof renderSTRouletteManager === 'function') renderSTRouletteManager();
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
 * 注意：本系統的血量模型是 hpArr（每格 0=完好/1=B/2=L/3=A），
 * 狀態則以「狀態名稱 → 字串層數」存於 unit.status
 * @param {Array} unitIds
 * @param {Object} actionData - { type: 'damage'|'heal'|'status', value: number, dmgType: 'b'|'l'|'a', statusId: string }
 */
function applyBatchAction(unitIds, actionData) {
    if (!unitIds || unitIds.length === 0) return;
    saveBatchState();

    unitIds.forEach(id => {
        const u = findUnitById(id);
        if (!u) return;

        if (actionData.type === 'damage' || actionData.type === 'heal') {
            const val = parseInt(actionData.value) || 0;
            if (val > 0 && typeof modifyHPInternal === 'function') {
                const hpType = actionData.type === 'heal' ? 'heal' : (actionData.dmgType || 'l');
                modifyHPInternal(u, hpType, val);
            }
        } else if (actionData.type === 'status') {
            // 以 ID 或名稱解析狀態定義（支援自訂狀態）
            let def = (typeof getStatusById === 'function') ? getStatusById(actionData.statusId) : null;
            if (!def && typeof getStatusByName === 'function') def = getStatusByName(actionData.statusId);

            const key = def ? def.name : actionData.statusId;
            const change = parseInt(actionData.value) || 0;
            if (!u.status) u.status = {};

            if (def && def.type === 'binary') {
                // 開關型：正數 = 套用、負數 = 移除
                if (change < 0) {
                    delete u.status[key];
                } else {
                    u.status[key] = '';
                }
            } else {
                // 累積型：與現有層數相加（負數可減層）
                const current = parseInt(u.status[key]) || 0;
                const newVal = current + (change || 1);
                if (newVal <= 0) {
                    delete u.status[key];
                } else {
                    u.status[key] = newVal.toString();
                }
            }
        }
    });

    broadcastState();
}

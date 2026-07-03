/**
 * Limbus Command - 持久化存儲管理
 * 管理房間數據、用戶數據的持久化存儲
 */

// ===== 存儲鍵值 =====
const STORAGE_KEYS = {
    ROOMS: 'limbus_rooms',           // 所有房間數據
    CURRENT_USER: 'limbus_current_user',  // 當前用戶資訊
    USER_PROFILE: 'limbus_user_',    // 用戶資料前綴 (limbus_user_CODE)
    UNIT_TEMPLATES: 'limbus_unit_templates'  // 單位模板
};

// ===== 房間管理 =====

/**
 * 獲取所有房間
 * @returns {Object} 房間映射 {code: roomData}
 */
function getAllRooms() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.ROOMS);
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.error('Failed to load rooms:', e);
        return {};
    }
}

/**
 * 保存所有房間
 * @param {Object} rooms - 房間映射
 */
function saveAllRooms(rooms) {
    try {
        localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(rooms));
    } catch (e) {
        console.error('Failed to save rooms:', e);
    }
}

/**
 * 獲取指定房間
 * @param {string} code - 房間識別碼
 * @returns {Object|null} 房間數據
 */
function getRoom(code) {
    const rooms = getAllRooms();
    return rooms[code] || null;
}

/**
 * 創建或更新房間
 * @param {string} code - 房間識別碼（4位數）
 * @param {Object} data - 房間數據
 * @returns {Object} 保存的房間數據
 */
function saveRoom(code, data) {
    const rooms = getAllRooms();

    const roomData = {
        code: code,
        peerId: data.peerId || null,
        stName: data.stName || '',
        createdAt: data.createdAt || Date.now(),
        lastActive: Date.now(),
        mapState: data.mapState || null,
        gameState: data.gameState || null,
        players: data.players || {}
    };

    rooms[code] = roomData;
    saveAllRooms(rooms);

    return roomData;
}

/**
 * 刪除房間
 * @param {string} code - 房間識別碼
 * @returns {boolean} 是否成功刪除
 */
function deleteRoom(code) {
    const rooms = getAllRooms();
    if (rooms[code]) {
        delete rooms[code];
        saveAllRooms(rooms);
        return true;
    }
    return false;
}

/**
 * 更新房間的最後活動時間
 * @param {string} code - 房間識別碼
 */
function updateRoomActivity(code) {
    const room = getRoom(code);
    if (room) {
        room.lastActive = Date.now();
        saveRoom(code, room);
    }
}

/**
 * 保存房間的遊戲狀態
 * @param {string} code - 房間識別碼
 * @param {Object} gameState - 遊戲狀態
 */
function saveRoomGameState(code, gameState) {
    const room = getRoom(code);
    if (room) {
        room.gameState = gameState;
        room.mapState = {
            units: state.units,
            turnIdx: state.turnIdx,
            mapW: state.mapW,
            mapH: state.mapH,
            mapData: state.mapData,
            themeId: state.themeId
        };
        saveRoom(code, room);
    }
}

// ===== 用戶管理 =====

/**
 * 獲取用戶資料
 * @param {string} code - 用戶識別碼（4位數）
 * @returns {Object|null} 用戶資料
 */
function getUserProfile(code) {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.USER_PROFILE + code);
        return data ? JSON.parse(data) : null;
    } catch (e) {
        console.error('Failed to load user profile:', e);
        return null;
    }
}

/**
 * 保存用戶資料
 * @param {string} code - 用戶識別碼（4位數）
 * @param {Object} profile - 用戶資料
 */
function saveUserProfile(code, profile) {
    try {
        const userData = {
            code: code,
            name: profile.name || '',
            role: profile.role || 'player',
            playerId: profile.playerId || null,
            createdAt: profile.createdAt || Date.now(),
            lastLoginAt: Date.now(),
            rooms: profile.rooms || []  // 用戶參與的房間列表
        };

        localStorage.setItem(STORAGE_KEYS.USER_PROFILE + code, JSON.stringify(userData));
    } catch (e) {
        console.error('Failed to save user profile:', e);
    }
}

/**
 * 獲取當前用戶
 * @returns {Object|null} 當前用戶資訊
 */
function getCurrentUser() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
        return data ? JSON.parse(data) : null;
    } catch (e) {
        return null;
    }
}

/**
 * 設置當前用戶
 * @param {string} code - 用戶識別碼
 * @param {string} name - 用戶名稱
 * @param {string} role - 角色 ('st' 或 'player')
 */
function setCurrentUser(code, name, role) {
    try {
        const userData = {
            code: code,
            name: name,
            role: role,
            loginAt: Date.now()
        };
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(userData));

        // 同時更新用戶資料
        const profile = getUserProfile(code) || {};
        profile.name = name;
        profile.role = role;
        saveUserProfile(code, profile);
    } catch (e) {
        console.error('Failed to set current user:', e);
    }
}

/**
 * 清除當前用戶
 */
function clearCurrentUser() {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
}

/**
 * 登出
 */
function logout() {
    clearCurrentUser();
    location.reload();
}

// ===== 數據清理 =====

/**
 * 清理超過30天未活動的房間
 */
function cleanupOldRooms() {
    const rooms = getAllRooms();
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    let hasChanges = false;

    for (const code in rooms) {
        const room = rooms[code];
        if (now - room.lastActive > thirtyDays) {
            delete rooms[code];
            hasChanges = true;
        }
    }

    if (hasChanges) {
        saveAllRooms(rooms);
    }
}

// 頁面載入時執行清理
if (typeof document !== 'undefined') {
    cleanupOldRooms();
}

// ===== 單位模板管理 =====

/**
 * 獲取所有單位模板
 * @returns {Array} 模板列表
 */
function getUnitTemplates() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.UNIT_TEMPLATES);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('Failed to load unit templates:', e);
        return [];
    }
}

/**
 * 正規化一份模板輸入為統一結構（saveUnitTemplate / updateUnitTemplate 共用）。
 * 模板是「殼子＋數值」合一的完整資料卡：名稱／HP／類型／大小／頭像 ＋ 完整戰鬥數值。
 * @param {Object} template - {name, hp, type, size, avatar, combat}
 *   combat（選填）：{ defDp, defAuto, init, saveWill, saveReflex, saveTenacity, allAttr, allSkill,
 *                    sideLevel, passive, actionDp, actionAoe, actionStatuses:[{id,stacks}], actionNote }
 * @returns {Object} 不含 id/createdAt 的正規化模板資料
 */
function normalizeUnitTemplate(template) {
    const combat = (template.combat && typeof template.combat === 'object') ? template.combat : {};
    const moveSpeed = parseInt(template.moveSpeed);
    return {
        name: template.name || 'Template',
        hp: template.hp || 10,
        type: template.type || 'enemy',
        size: template.size || 1,
        moveSpeed: (Number.isFinite(moveSpeed) && moveSpeed >= 0) ? moveSpeed : 20,  // 移動速度（米），5 米 = 1 格
        avatar: template.avatar || null,
        // 完整戰鬥數值：讓 ST 設定好一隻小怪後可直接套用到其他同類小怪，不必每隻重新填一次
        combat: {
            defDp: parseInt(combat.defDp) || 0,
            defAuto: parseInt(combat.defAuto) || 0,
            init: parseInt(combat.init) || 0,
            saveWill: parseInt(combat.saveWill) || 0,
            saveReflex: parseInt(combat.saveReflex) || 0,
            saveTenacity: parseInt(combat.saveTenacity) || 0,
            allAttr: parseInt(combat.allAttr) || 0,
            allSkill: parseInt(combat.allSkill) || 0,
            sideLevel: Math.max(1, parseInt(combat.sideLevel) || 1),
            passive: String(combat.passive || ''),
            actionDp: parseInt(combat.actionDp) || 0,
            actionAoe: !!combat.actionAoe,
            actionStatuses: Array.isArray(combat.actionStatuses)
                ? combat.actionStatuses
                    .filter(s => s && s.id)
                    .map(s => ({ id: String(s.id), stacks: parseInt(s.stacks) || 0 }))
                : [],
            actionNote: String(combat.actionNote || '')
        }
    };
}

/**
 * 保存單位模板（新增）
 * @param {Object} template - 見 normalizeUnitTemplate
 * @returns {Object} 保存的模板（含 ID）
 */
function saveUnitTemplate(template) {
    try {
        const templates = getUnitTemplates();
        const newTemplate = Object.assign(normalizeUnitTemplate(template), {
            id: Date.now().toString() + '_' + Math.floor(Math.random() * 10000).toString(),
            createdAt: Date.now()
        });

        templates.push(newTemplate);
        localStorage.setItem(STORAGE_KEYS.UNIT_TEMPLATES, JSON.stringify(templates));

        return newTemplate;
    } catch (e) {
        console.error('Failed to save unit template:', e);
        return null;
    }
}

/**
 * 更新既有單位模板（保留原 id / createdAt），讓模板存檔後仍可修改。
 * @param {string} id - 模板 ID
 * @param {Object} template - 見 normalizeUnitTemplate
 * @returns {Object|null} 更新後的模板；找不到時回傳 null
 */
function updateUnitTemplate(id, template) {
    try {
        const templates = getUnitTemplates();
        const idx = templates.findIndex(t => t.id === id);
        if (idx === -1) return null;

        templates[idx] = Object.assign(normalizeUnitTemplate(template), {
            id: templates[idx].id,
            createdAt: templates[idx].createdAt || Date.now(),
            updatedAt: Date.now()
        });
        localStorage.setItem(STORAGE_KEYS.UNIT_TEMPLATES, JSON.stringify(templates));
        return templates[idx];
    } catch (e) {
        console.error('Failed to update unit template:', e);
        return null;
    }
}

/**
 * 依名稱尋找模板（供「同名覆蓋更新」的 upsert 流程）
 * @param {string} name
 * @returns {Object|null}
 */
function findUnitTemplateByName(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    return getUnitTemplates().find(t => t.name === n) || null;
}

/**
 * 依名稱 upsert 模板：同名者存在→覆蓋更新（保留 id），否則新增。
 * 各處「存為模板」按鈕共用，讓「重新儲存同名模板」即等於「修改模板」。
 * @param {Object} template - 見 normalizeUnitTemplate
 * @returns {{ template: Object, updated: boolean }|null}
 */
function upsertUnitTemplateByName(template) {
    const existing = findUnitTemplateByName(template && template.name);
    if (existing) {
        const t = updateUnitTemplate(existing.id, template);
        return t ? { template: t, updated: true } : null;
    }
    const t = saveUnitTemplate(template);
    return t ? { template: t, updated: false } : null;
}

/**
 * 刪除單位模板
 * @param {string} id - 模板 ID
 * @returns {boolean} 是否成功刪除
 */
function deleteUnitTemplate(id) {
    try {
        const templates = getUnitTemplates();
        const idx = templates.findIndex(t => t.id === id);

        if (idx !== -1) {
            templates.splice(idx, 1);
            localStorage.setItem(STORAGE_KEYS.UNIT_TEMPLATES, JSON.stringify(templates));
            return true;
        }
        return false;
    } catch (e) {
        console.error('Failed to delete unit template:', e);
        return false;
    }
}

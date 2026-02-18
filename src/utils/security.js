/**
 * Limbus Command - 安全模組
 * 提供輸入驗證、XSS 防護、速率限制等安全機制
 */

// ===== XSS 防護 =====
/**
 * 安全的 HTML 轉義（防止 XSS 攻擊）
 * 使用字串替換而非 DOM 操作，避免潛在的 mXSS 攻擊
 * @param {string} str - 需要轉義的字串
 * @returns {string} 轉義後的安全字串
 */
function sanitizeHTML(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

/**
 * 驗證並清理使用者名稱
 * @param {string} name - 使用者輸入的名稱
 * @param {number} maxLength - 最大長度（預設 30）
 * @returns {string} 清理後的名稱
 */
function sanitizeName(name, maxLength = 30) {
    if (typeof name !== 'string') return '';
    // 移除控制字元，保留合法 Unicode（包含中文）
    return name.replace(/[\x00-\x1F\x7F]/g, '').trim().substring(0, maxLength);
}

/**
 * 驗證房間代碼格式
 * @param {string} code - 房間代碼
 * @returns {boolean} 是否合法
 */
function isValidRoomCode(code) {
    if (typeof code !== 'string') return false;
    // 房間代碼：4-8 位英數字
    return /^[A-Za-z0-9]{4,8}$/.test(code);
}

/**
 * 驗證恢復代碼格式
 * @param {string} code - 恢復代碼
 * @returns {boolean} 是否合法
 */
function isValidRecoveryCode(code) {
    if (typeof code !== 'string') return false;
    // 恢復代碼：4 位英數字
    return /^[A-Za-z0-9]{4}$/.test(code);
}

// ===== 速率限制 =====
/**
 * 速率限制器
 * 防止短時間內大量操作（例如 Firebase 寫入）
 */
const RateLimiter = {
    _counters: {},

    /**
     * 檢查操作是否被允許
     * @param {string} key - 操作類型識別鍵
     * @param {number} maxOps - 時間窗口內最大操作次數
     * @param {number} windowMs - 時間窗口（毫秒，預設 10 秒）
     * @returns {boolean} 是否允許操作
     */
    check(key, maxOps = 30, windowMs = 10000) {
        const now = Date.now();

        if (!this._counters[key]) {
            this._counters[key] = { count: 0, windowStart: now };
        }

        const counter = this._counters[key];

        // 重置過期的時間窗口
        if (now - counter.windowStart > windowMs) {
            counter.count = 0;
            counter.windowStart = now;
        }

        counter.count++;

        if (counter.count > maxOps) {
            console.warn(`[Security] 速率限制: ${key} 操作過於頻繁 (${counter.count}/${maxOps} in ${windowMs}ms)`);
            return false;
        }

        return true;
    },

    /**
     * 重置指定操作的計數器
     * @param {string} key - 操作類型識別鍵
     */
    reset(key) {
        delete this._counters[key];
    }
};

// ===== 資料驗證 =====
/**
 * 驗證 Firebase 傳入的單位資料
 * @param {Object} data - 從 Firebase 接收的單位資料
 * @returns {Object|null} 驗證並清理後的資料，若無效則回傳 null
 */
function validateUnitData(data) {
    if (!data || typeof data !== 'object') return null;

    return {
        id: typeof data.id === 'string' ? data.id.substring(0, 50) : null,
        name: sanitizeName(data.name || 'Unknown', 50),
        hp: clampInt(data.hp, 1, 9999),
        maxHp: clampInt(data.maxHp, 1, 9999),
        type: ['enemy', 'player', 'boss'].includes(data.type) ? data.type : 'enemy',
        x: typeof data.x === 'number' ? Math.floor(data.x) : -1,
        y: typeof data.y === 'number' ? Math.floor(data.y) : -1,
        init: clampInt(data.init, -999, 999),
        size: [1, 2, 3].includes(data.size) ? data.size : 1,
        ownerId: typeof data.ownerId === 'string' ? data.ownerId.substring(0, 100) : null,
        ownerName: typeof data.ownerName === 'string' ? sanitizeName(data.ownerName, 30) : null,
        avatar: validateAvatarData(data.avatar),
        hpArr: Array.isArray(data.hpArr) ? data.hpArr.map(v => clampInt(v, 0, 3)).slice(0, 9999) : [],
        isBoss: data.type === 'boss' || data.isBoss === true,
        status: validateStatusObject(data.status)
    };
}

/**
 * 驗證頭像資料（Base64 或空）
 * @param {*} avatar - 頭像資料
 * @returns {string} 合法的頭像字串或空字串
 */
function validateAvatarData(avatar) {
    if (typeof avatar !== 'string') return '';
    // 只接受 data:image 開頭的 Base64 資料，限制大小
    if (avatar.startsWith('data:image/') && avatar.length < 500000) {
        return avatar;
    }
    return '';
}

/**
 * 驗證狀態物件
 * @param {Object} status - 狀態物件
 * @returns {Object} 清理後的狀態物件
 */
function validateStatusObject(status) {
    if (!status || typeof status !== 'object') return {};

    const cleaned = {};
    const entries = Object.entries(status);

    // 限制狀態數量，防止惡意灌入大量資料
    const maxStatuses = 50;
    for (let i = 0; i < Math.min(entries.length, maxStatuses); i++) {
        const [key, val] = entries[i];
        const cleanKey = sanitizeName(key, 30);
        if (cleanKey) {
            cleaned[cleanKey] = typeof val === 'string' ? val.substring(0, 100) : String(val || '').substring(0, 100);
        }
    }

    return cleaned;
}

/**
 * 將數值限制在指定範圍內
 * @param {*} val - 輸入值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 限制後的整數
 */
function clampInt(val, min, max) {
    const n = parseInt(val);
    if (isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
}

/**
 * 驗證地圖資料
 * @param {Array} mapData - 2D 地圖陣列
 * @param {number} maxW - 最大寬度
 * @param {number} maxH - 最大高度
 * @returns {Array|null} 驗證後的資料或 null
 */
function validateMapData(mapData, maxW = 50, maxH = 50) {
    if (!Array.isArray(mapData)) return null;
    if (mapData.length > maxH) return null;

    return mapData.map(row => {
        if (!Array.isArray(row)) return [];
        return row.slice(0, maxW).map(cell => {
            const n = parseInt(cell);
            return isNaN(n) ? 0 : Math.max(0, n);
        });
    });
}

// ===== URL 驗證 =====
/**
 * 驗證音樂 URL 是否安全
 * @param {string} url - URL 字串
 * @returns {boolean} 是否安全
 */
function isValidMusicUrl(url) {
    if (typeof url !== 'string') return false;

    try {
        const parsed = new URL(url);
        // 只允許 http/https 協定
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;

        // 允許的域名白名單
        const allowedDomains = [
            'dropbox.com', 'www.dropbox.com', 'dl.dropboxusercontent.com',
            'drive.google.com', 'drive.usercontent.google.com',
            'firebasestorage.googleapis.com',
            'localhost', '127.0.0.1'
        ];

        const hostname = parsed.hostname.toLowerCase();
        return allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d));
    } catch {
        return false;
    }
}

// ===== Prototype Pollution 防護 =====
/**
 * 安全的物件屬性設定（防止 Prototype Pollution）
 * @param {Object} obj - 目標物件
 * @param {string} key - 屬性鍵
 * @param {*} value - 屬性值
 */
function safeSetProperty(obj, key, value) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        console.warn(`[Security] 偵測到 Prototype Pollution 攻擊嘗試: ${key}`);
        return;
    }
    obj[key] = value;
}

/**
 * 安全地合併物件（防止 Prototype Pollution）
 * @param {Object} target - 目標物件
 * @param {Object} source - 來源物件
 * @returns {Object} 合併後的物件
 */
function safeMerge(target, source) {
    if (!source || typeof source !== 'object') return target;

    for (const key of Object.keys(source)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }
        target[key] = source[key];
    }

    return target;
}

console.log('[Security] 安全模組已載入');

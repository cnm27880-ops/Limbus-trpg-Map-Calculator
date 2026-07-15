/**
 * Limbus Command - 工具函數
 * 通用輔助函數集合
 */

// ===== HTML 轉義 =====
/**
 * 轉義 HTML 特殊字元
 * @param {string} text - 原始文字
 * @returns {string} 轉義後的文字
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') text = String(text);
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ===== Toast 通知 =====
/**
 * 顯示 Toast 通知
 * @param {string} message - 通知訊息
 * @param {number} duration - 顯示時間(毫秒)，預設 2000
 */
function showToast(message, duration = 2000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.innerText = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// ===== 剪貼簿 =====
/**
 * 複製房間號碼到剪貼簿
 */
function copyId() {
    // 注意：currentRoomCode 由 firebase-connection.js 提供
    if (typeof currentRoomCode !== 'undefined' && currentRoomCode) {
        navigator.clipboard.writeText(currentRoomCode).then(() => {
            showToast('已複製房間號碼');
        }).catch(() => {
            showToast('複製失敗');
        });
    }
}

/**
 * 複製玩家識別碼
 * @param {string} code - 4 位數識別碼
 */
function copyPlayerCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        showToast('識別碼已複製: ' + code);
    }).catch(() => {
        showToast('複製失敗');
    });
}

/**
 * 複製自己的玩家識別碼
 */
function copyMyCode() {
    if (!myPlayerCode) return;
    copyPlayerCode(myPlayerCode);
}

/**
 * 更新導覽列中的玩家識別碼顯示
 */
function updateCodeDisplay() {
    const codeEl = document.getElementById('my-code');
    if (codeEl && myPlayerCode) {
        codeEl.innerText = myPlayerCode;
        codeEl.style.display = 'inline-block';
    }
    // 代號 chip（可點擊修改的全域顯示名稱）
    const nameEl = document.getElementById('my-name');
    if (nameEl && typeof myName !== 'undefined' && myName) {
        nameEl.innerText = '👤 ' + myName;
        nameEl.style.display = 'inline-block';
    }
}

// ===== ID 生成 =====
/**
 * 產生唯一玩家 ID
 * @returns {string}
 */
function generatePlayerId() {
    return 'player_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * 產生 4 位數玩家識別碼
 * @returns {string}
 */
function generatePlayerCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

// ===== 頁面切換 =====
/**
 * 切換頁面
 * @param {string} pageId - 頁面 ID（map, units, calc）
 */
function switchPage(pageId) {
    // 隱藏所有頁面
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // 顯示目標頁面
    const targetPage = document.getElementById('page-' + pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    // 更新導覽標籤
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    const targetTab = document.querySelector(`.nav-tab[data-page="${pageId}"]`);
    if (targetTab) {
        targetTab.classList.add('active');
    }

    // BOSS 血條 HUD：只在地圖頁顯示
    const bossHud = document.getElementById('boss-hud');
    if (bossHud) {
        if (pageId === 'map') {
            bossHud.classList.remove('hidden');
        } else {
            bossHud.classList.add('hidden');
        }
    }

    // 當切換到地圖頁面時，重新渲染地圖以修復手機版黑屏問題
    if (pageId === 'map') {
        // 使用 requestAnimationFrame 確保 DOM 已更新後再渲染
        requestAnimationFrame(() => {
            if (typeof renderMap === 'function') {
                renderMap();
            }
            // 重新應用相機設定
            if (typeof applyCamera === 'function') {
                applyCamera();
            }
            // 校正歌詞位置（防止分頁切換導致座標偏移）
            if (typeof recalibrateLyricsPositions === 'function') {
                recalibrateLyricsPositions();
            }
        });
    }
}

// ===== 側邊欄 =====
/**
 * 切換側邊欄顯示狀態
 * 手機版：使用 show class 來顯示
 * 電腦版：使用 collapsed class 來隱藏
 */
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');

    if (!sidebar) return;

    // 檢查是否為電腦版 (1024px+)
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches;

    if (isDesktop) {
        // 電腦版：切換 collapsed class
        sidebar.classList.toggle('collapsed');
        if (toggle) toggle.classList.toggle('active', !sidebar.classList.contains('collapsed'));
    } else {
        // 手機版：切換 show class
        sidebar.classList.toggle('show');
        if (toggle) toggle.classList.toggle('active', sidebar.classList.contains('show'));
    }
}

// ===== 加權 HP 百分比 =====
/**
 * 計算單位的加權剩餘 HP 百分比（B=1, L=2, A=3 分，分數越高代表傷害越重）
 * 用於 BOSS 血條 HUD 與隱藏 B/L/A 明細時顯示的百分比血條。
 * @param {Object} unit - 單位物件（含 hpArr / maxHp）
 * @returns {number} 0~100 的剩餘百分比
 */
function calculateWeightedHpPercent(unit) {
    if (!unit) return 100;
    const hpArr = unit.hpArr || [];
    const maxHp = unit.maxHp || hpArr.length || 1;
    const maxWeight = maxHp * 3;
    if (maxWeight <= 0) return 100;
    const damageWeight = hpArr.reduce((sum, x) => sum + (Number(x) || 0), 0);
    const remaining = Math.max(0, maxWeight - damageWeight);
    return (remaining / maxWeight) * 100;
}

// ===== 「A+B」骰數記法 =====
/**
 * 解析「A+B」格式的數值輸入：A＝要進行亂數骰的骰數／DP，B＝擲骰後直接加上的附加成功。
 * 全站攻擊／豁免／防禦欄位共用此記法，取代獨立的「附加成功」欄位。
 * 支援：'12'（無附加）、'12+3'、'-4'（減值）、'-4+2'、數字型別；空值與亂填回 {0,0}。
 * @param {string|number} value
 * @returns {{ dice: number, auto: number }}
 */
function parseDicePlus(value) {
    if (typeof value === 'number') return { dice: Number.isFinite(value) ? Math.trunc(value) : 0, auto: 0 };
    const s = String(value ?? '').trim();
    if (!s) return { dice: 0, auto: 0 };
    const m = s.match(/^(-?\d+)(?:\s*\+\s*(\d+))?$/);
    if (!m) return { dice: parseInt(s, 10) || 0, auto: 0 };
    return { dice: parseInt(m[1], 10) || 0, auto: parseInt(m[2], 10) || 0 };
}

/**
 * 將骰數與附加成功組回「A+B」顯示字串（附加為 0 時只顯示 A）。
 * @param {number} dice
 * @param {number} auto
 * @returns {string}
 */
function formatDicePlus(dice, auto) {
    const d = parseInt(dice) || 0;
    const a = parseInt(auto) || 0;
    return a > 0 ? `${d}+${a}` : String(d);
}

// ===== 嚴重槽（Severe Gauge） =====
/**
 * 統計單位嚴重槽的填格數：每一格 L（2）或 A（3）傷害都佔用一格嚴重槽。
 * @param {Object} unit - 單位物件（含 hpArr）
 * @returns {number}
 */
function countSevereSlots(unit) {
    return ((unit && unit.hpArr) || []).filter(x => (Number(x) || 0) >= 2).length;
}

/**
 * 嚴重槽是否已填滿（所有血格皆為 L 以上傷害）。
 * 規則【部位破壞 / 混亂】：BOSS 的嚴重槽填滿時，陷入一回合混亂、無法行動。
 * @param {Object} unit - 單位物件（含 hpArr / maxHp）
 * @returns {boolean}
 */
function isSevereGaugeFull(unit) {
    if (!unit) return false;
    const maxHp = unit.maxHp || (unit.hpArr || []).length || 0;
    return maxHp > 0 && countSevereSlots(unit) >= maxHp;
}

// ===== HP 狀態描述 =====
/**
 * 取得模糊的 HP 狀態描述（用於隱藏敵人詳細資訊）
 * @param {Object} unit - 單位物件
 * @returns {string} 狀態描述
 */
function getVagueStatus(unit) {
    if (!unit || !unit.hpArr || !unit.maxHp) return "未知";

    const damaged = unit.hpArr.filter(x => x > 0).length;
    const ratio = damaged / unit.maxHp;

    if (ratio === 0) return "完好";
    if (ratio < 0.3) return "輕傷";
    if (ratio < 0.6) return "受傷";
    if (ratio < 0.9) return "重傷";
    return "瀕死";
}

// ===== 單位建立 =====
/**
 * 建立新單位
 * @param {string} name - 名稱
 * @param {number} hp - 最大 HP
 * @param {string} type - 類型 ('enemy' 或 'player')
 * @param {string} ownerId - 擁有者 ID
 * @param {string} ownerName - 擁有者名稱
 * @param {number} size - 單位大小 (1=1x1, 2=2x2, 3=3x3)
 * @returns {Object} 新單位物件
 */
function createUnit(name, hp, type, ownerId = null, ownerName = null, size = 1, moveSpeed = 20) {
    return {
        id: Date.now().toString() + '_' + Math.floor(Math.random() * 1000000).toString(),  // Firebase-safe: 纯字符串 ID (无小数点)
        name: name,
        maxHp: hp,
        hpArr: Array(hp).fill(0),  // 0=完好, 1=B傷, 2=L傷, 3=A傷
        type: type,
        init: 0,       // 先攻序列（排序/顯示；骰先攻結果）
        initBonus: 0,  // 先攻加值（骰先攻 1D10 + 此值）
        x: -1,
        y: -1,
        avatar: null,
        ownerId: ownerId,
        ownerName: ownerName,
        size: size,  // 單位大小：1=普通, 2=大型, 3=巨型
        status: {},  // 單位狀態標籤 (例如: {"燃燒": "3", "流血": "2"})
        hidden: false,  // 是否對玩家隱藏（ST 可見，玩家看不到）
        moveSpeed: moveSpeed,  // 移動速度（米），5 米 = 1 格
        moveUsed: 0  // 本回合已消耗的移動格數（回合開始時歸零）
    };
}

// ===== 戰術移動消耗（5 米 1 格，斜走加倍）=====
/**
 * 計算兩格間的戰術移動消耗：直走 1 格消耗 1，斜走 1 格消耗 2。
 * 先盡量斜走補足較短軸，剩餘距離直走；總消耗 = 直走步數 + 斜走步數 × 2。
 * @param {number} dx - X 位移（格）
 * @param {number} dy - Y 位移（格）
 * @returns {number} 消耗格數（整數）
 */
function calcTacticalCost(dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const diag = Math.min(ax, ay);           // 斜走步數
    const straight = Math.max(ax, ay) - diag; // 直走步數
    return straight + diag * 2;
}

/**
 * 查詢指定格子的地形「移動消耗倍率」（困難地形設定，見地形編輯器）。
 * 地板、超出範圍、或未設定倍率的地形一律回傳 1（不影響移動）。
 * @param {number} x - 格子 X 座標
 * @param {number} y - 格子 Y 座標
 * @returns {number}
 */
function getTileMoveMultiplier(x, y) {
    if (typeof state === 'undefined' || !state.mapData) return 1;
    const val = state.mapData[y] && state.mapData[y][x];
    if (!val) return 1; // 0 = 地板
    const tileDef = (typeof getTileFromPalette === 'function') ? getTileFromPalette(val) : null;
    const m = tileDef && parseFloat(tileDef.moveCostMultiplier);
    return (Number.isFinite(m) && m > 0) ? m : 1;
}

/**
 * 計算兩格間「考慮困難地形」的實際移動消耗：沿 calcTacticalCost 相同的走法
 * （先斜走補齊短軸，再直走剩餘距離）逐格前進，每步消耗（斜走 2／直走 1）
 * 再乘上「進入的那一格」的地形移動消耗倍率後加總。
 * 一般地板（倍率 1）等同於原本的 calcTacticalCost，行為不變。
 * @param {number} fromX - 起點 X
 * @param {number} fromY - 起點 Y
 * @param {number} toX - 終點 X
 * @param {number} toY - 終點 Y
 * @returns {number} 消耗格數（可能含小數，取決於地形倍率設定）
 */
function calcTacticalPathCost(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const diagSteps = Math.min(ax, ay);
    const straightSteps = Math.max(ax, ay) - diagSteps;
    const straightDx = ax > ay ? sx : 0;
    const straightDy = ay > ax ? sy : 0;

    let cx = fromX;
    let cy = fromY;
    let total = 0;

    for (let i = 0; i < diagSteps; i++) {
        cx += sx;
        cy += sy;
        total += 2 * getTileMoveMultiplier(cx, cy);
    }
    for (let i = 0; i < straightSteps; i++) {
        cx += straightDx;
        cy += straightDy;
        total += 1 * getTileMoveMultiplier(cx, cy);
    }

    return total;
}

/**
 * 單位最大可移動格數 = floor(移動速度(米) / 5)，未設定時預設 20 米（4 格）。
 * @param {Object} unit - 單位物件
 * @returns {number}
 */
function getUnitMaxMoveGrids(unit) {
    const speed = parseInt(unit && unit.moveSpeed);
    const meters = (Number.isFinite(speed) && speed >= 0) ? speed : 20;
    return Math.floor(meters / 5);
}

/**
 * 單位本回合剩餘可移動格數（能量條剩餘量）。
 * @param {Object} unit - 單位物件
 * @returns {number}
 */
function getUnitMoveRemaining(unit) {
    const used = parseInt(unit && unit.moveUsed) || 0;
    return Math.max(0, getUnitMaxMoveGrids(unit) - used);
}

// ===== HP 內部修改 =====
/**
 * 內部 HP 修改函數
 * @param {Object} unit - 單位物件
 * @param {string} type - 傷害類型 ('b', 'l', 'a', 'heal', 'heal-b', 'heal-l', 'heal-a')
 * @param {number} amount - 數量
 */
function modifyHPInternal(unit, type, amount) {
    for (let i = 0; i < amount; i++) {
        if (type === 'heal') {
            // 治療任意傷害（優先 A > L > B）
            const idx = unit.hpArr.findIndex(x => x > 0);
            if (idx !== -1) unit.hpArr[idx] = 0;
        } else if (type === 'heal-a') {
            const idx = unit.hpArr.findIndex(x => x === 3);
            if (idx !== -1) unit.hpArr[idx] = 0;
        } else if (type === 'heal-l') {
            const idx = unit.hpArr.findIndex(x => x === 2);
            if (idx !== -1) unit.hpArr[idx] = 0;
        } else if (type === 'heal-b') {
            const idx = unit.hpArr.findIndex(x => x === 1);
            if (idx !== -1) unit.hpArr[idx] = 0;
        } else {
            // 護盾先吸收傷害（每點傷害消耗 1 點護盾；一次性護盾優先消耗）
            if ((unit.shieldTemp || 0) > 0) {
                unit.shieldTemp--;
                continue;
            }
            if ((unit.shieldAuto || 0) > 0) {
                unit.shieldAuto--;
                continue;
            }
            // 造成傷害
            const val = type === 'b' ? 1 : type === 'l' ? 2 : 3;
            const emptyIdx = unit.hpArr.findIndex(x => x === 0);

            if (emptyIdx !== -1) {
                unit.hpArr[emptyIdx] = val;
            } else {
                // 升級現有傷害
                const bIdx = unit.hpArr.findIndex(x => x === 1);
                if (bIdx !== -1 && val >= 1) {
                    unit.hpArr[bIdx] = 2;
                } else {
                    const lIdx = unit.hpArr.findIndex(x => x === 2);
                    if (lIdx !== -1 && val >= 1) {
                        unit.hpArr[lIdx] = 3;
                    }
                }
            }
        }
        // 排序：最嚴重的傷害在前
        unit.hpArr.sort((a, b) => b - a);
    }
}

// ===== ES Module 匯出 + 全域相容層（Phase 2 漸進模組化）=====
// 本檔已轉為 ES module，經 src/entry.js 匯入。匯出供未來模組 import 使用；
// 同時掛回 window，確保仍為 classic script 的既有檔案以全域呼叫 showToast / escapeHtml /
// createUnit 等仍正常運作。
export {
    escapeHtml, showToast, copyId, copyPlayerCode, copyMyCode, updateCodeDisplay,
    generatePlayerId, generatePlayerCode, switchPage, toggleSidebar,
    calculateWeightedHpPercent, getVagueStatus, createUnit, modifyHPInternal,
    countSevereSlots, isSevereGaugeFull, parseDicePlus, formatDicePlus,
    calcTacticalCost, getUnitMaxMoveGrids, getUnitMoveRemaining,
    calcTacticalPathCost, getTileMoveMultiplier,
};

if (typeof window !== 'undefined') {
    Object.assign(window, {
        escapeHtml, showToast, copyId, copyPlayerCode, copyMyCode, updateCodeDisplay,
        generatePlayerId, generatePlayerCode, switchPage, toggleSidebar,
        calculateWeightedHpPercent, getVagueStatus, createUnit, modifyHPInternal,
        countSevereSlots, isSevereGaugeFull, parseDicePlus, formatDicePlus,
        calcTacticalCost, getUnitMaxMoveGrids, getUnitMoveRemaining,
    calcTacticalPathCost, getTileMoveMultiplier,
    });
}

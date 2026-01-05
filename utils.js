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
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
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
 * 複製自己的 Peer ID 到剪貼簿
 */
function copyId() {
    if (!myPeerId) return;
    navigator.clipboard.writeText(myPeerId).then(() => {
        showToast('已複製 ID');
    }).catch(() => {
        showToast('複製失敗');
    });
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
}

// ===== 側邊欄 =====
/**
 * 切換側邊欄顯示狀態
 */
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    
    if (sidebar) sidebar.classList.toggle('show');
    if (toggle) toggle.classList.toggle('active');
}

// ===== HP 狀態描述 =====
/**
 * 取得模糊的 HP 狀態描述（用於隱藏敵人詳細資訊）
 * @param {Object} unit - 單位物件
 * @returns {string} 狀態描述
 */
function getVagueStatus(unit) {
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
 * @returns {Object} 新單位物件
 */
function createUnit(name, hp, type, ownerId = null, ownerName = null) {
    return {
        id: Date.now().toString() + '_' + Math.floor(Math.random() * 1000000).toString(),  // Firebase-safe: 纯字符串 ID (无小数点)
        name: name,
        maxHp: hp,
        hpArr: Array(hp).fill(0),  // 0=完好, 1=B傷, 2=L傷, 3=A傷
        type: type,
        init: 0,
        x: -1,
        y: -1,
        avatar: null,
        ownerId: ownerId,
        ownerName: ownerName
    };
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

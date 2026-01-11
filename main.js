/**
 * Limbus Command - 主程式
 * 應用程式進入點與初始化
 */

// ===== 快速操作球狀態 =====
let qabMenuOpen = false;

/**
 * 切換快速操作球選單
 */
function toggleQABMenu() {
    qabMenuOpen = !qabMenuOpen;
    const menu = document.getElementById('qab-menu');
    const mainBtn = document.getElementById('qab-main');

    if (menu) {
        menu.classList.toggle('show', qabMenuOpen);
    }
    if (mainBtn) {
        mainBtn.classList.toggle('active', qabMenuOpen);
    }
}

/**
 * 關閉快速操作球選單
 */
function closeQABMenu() {
    qabMenuOpen = false;
    const menu = document.getElementById('qab-menu');
    const mainBtn = document.getElementById('qab-main');

    if (menu) menu.classList.remove('show');
    if (mainBtn) mainBtn.classList.remove('active');
}

/**
 * 舊版相容函數
 */
function toggleQuickActions() {
    toggleQABMenu();
}

// ===== 頁面載入初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    // 初始化 Modal
    if (typeof initModals === 'function') initModals();
    
    // 初始化計算器
    if (typeof initCalculator === 'function') initCalculator();
    
    // 初始化檔案上傳
    if (typeof initFileUpload === 'function') initFileUpload();
    
    // 檢查現有 Session
    if (typeof checkExistingSession === 'function') checkExistingSession();
    
    // 初始化鍵盤控制 (新增功能)
    initKeyboardControls();
    
    console.log('Limbus Command v7.5 initialized');
});

// ===== 版本資訊 =====
const APP_VERSION = '7.5';
const APP_NAME = 'Limbus Command';

/**
 * 取得版本資訊
 * @returns {Object}
 */
function getAppInfo() {
    return {
        name: APP_NAME,
        version: APP_VERSION,
        buildDate: '2024'
    };
}

// ===== 鍵盤控制邏輯 (新增) =====
function initKeyboardControls() {
    document.addEventListener('keydown', (e) => {
        // 如果正在輸入文字或沒有選取單位，則忽略
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (selectedUnitId === null) return;

        const u = state.units.find(u => u.id === selectedUnitId);
        
        // 檢查單位是否存在、是否在地圖上(x!=-1)、是否有權限控制
        if (!u || u.x === -1) return;
        if (typeof canControlUnit === 'function' && !canControlUnit(u)) return;

        let dx = 0;
        let dy = 0;

        switch(e.key) {
            case 'ArrowUp': dy = -1; break;
            case 'ArrowDown': dy = 1; break;
            case 'ArrowLeft': dx = -1; break;
            case 'ArrowRight': dx = 1; break;
            case 'Escape': 
                if (typeof clearSelection === 'function') clearSelection(); 
                return; 
            default: return; // 其他按鍵不處理
        }

        e.preventDefault(); // 防止網頁捲動

        // 計算新座標
        const newX = Math.max(0, Math.min(state.mapW - 1, u.x + dx));
        const newY = Math.max(0, Math.min(state.mapH - 1, u.y + dy));

        // 避免重複發送相同位置
        if (newX === u.x && newY === u.y) return;

        if (myRole === 'st') {
            u.x = newX;
            u.y = newY;
            sendState();
            renderAll();
        } else {
            sendToHost({
                type: 'moveUnit',
                playerId: myPlayerId,
                unitId: u.id,
                x: newX,
                y: newY
            });
            // 玩家端預先渲染以獲得即時回饋 (實際以 ST 回傳為準)
            // 這裡暫時修改本地數據以達到流暢效果
            u.x = newX;
            u.y = newY;
            renderAll(); 
        }
    });
}

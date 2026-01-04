/**
 * Limbus Command - 主程式
 * 應用程式進入點與初始化
 */

// ===== 頁面載入初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    // 初始化 Modal
    initModals();
    
    // 初始化計算器
    initCalculator();
    
    // 初始化檔案上傳
    initFileUpload();
    
    // 檢查現有 Session
    checkExistingSession();
    
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

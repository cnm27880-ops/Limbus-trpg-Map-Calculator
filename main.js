// js/main.js

// ===== 頁面載入初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    initModals();
    initCalculator();
    initFileUpload();
    checkExistingSession();
    
    // ★★★ 新增：初始化鍵盤控制 ★★★
    initKeyboardControls();
    
    console.log('Limbus Command v7.5 initialized');
});

const APP_VERSION = '7.5';
const APP_NAME = 'Limbus Command';

function getAppInfo() {
    return { name: APP_NAME, version: APP_VERSION, buildDate: '2024' };
}

// ★★★ 新增：鍵盤控制函數 ★★★
function initKeyboardControls() {
    document.addEventListener('keydown', (e) => {
        // 如果正在輸入文字或沒有選取單位，則忽略
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || selectedUnitId === null) return;

        const u = state.units.find(u => u.id === selectedUnitId);
        // 檢查是否存在、是否在地圖上(x!=-1)、是否有權限
        if (!u || u.x === -1 || !canControlUnit(u)) return;

        let dx = 0;
        let dy = 0;

        switch(e.key) {
            case 'ArrowUp': dy = -1; break;
            case 'ArrowDown': dy = 1; break;
            case 'ArrowLeft': dx = -1; break;
            case 'ArrowRight': dx = 1; break;
            case 'Escape': clearSelection(); return; // ESC 取消選取
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
            // 玩家端預先渲染以獲得即時回饋
            // 注意：實際狀態會等 ST 確認後同步，這裡僅做視覺優化
            renderAll(); 
        }
    });
}

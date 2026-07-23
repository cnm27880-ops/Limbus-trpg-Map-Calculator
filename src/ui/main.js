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

    // 如果開啟選單，添加點擊外部關閉的監聽器。
    // 改用「防誤關」辨識機制：只有在選單外真正點擊（按下＋放開、位移很小）才關閉，
    // 避免指標稍微滑出就誤關。
    if (qabMenuOpen) {
        setTimeout(armQabOutsideDismiss, 10);
    } else if (qabOutsideDetach) {
        qabOutsideDetach();
        qabOutsideDetach = null;
    }
}

let qabOutsideDetach = null;
function armQabOutsideDismiss() {
    if (qabOutsideDetach) { qabOutsideDetach(); qabOutsideDetach = null; }
    const isOutside = (t) => {
        const qab = document.getElementById('quick-action-ball');
        return !qab || !qab.contains(t);
    };
    if (typeof attachOutsideDismiss !== 'function') {
        document.addEventListener('click', handleQABOutsideClick);
        return;
    }
    qabOutsideDetach = attachOutsideDismiss(isOutside, () => closeQABMenu());
}

/**
 * 處理點擊選單外部關閉（辨識機制未載入時的保底）
 */
function handleQABOutsideClick(e) {
    const qabContainer = document.getElementById('quick-action-ball');
    if (qabContainer && !qabContainer.contains(e.target)) {
        closeQABMenu();
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
    if (qabOutsideDetach) { qabOutsideDetach(); qabOutsideDetach = null; }
    document.removeEventListener('click', handleQABOutsideClick);
}

// ===== 媒體中心（音樂 / 歌詞 分頁融合） =====

/**
 * 開啟媒體中心並切換到指定分頁
 * @param {string} [tab='music'] - 'music' | 'lyrics'
 */
function openMediaPanel(tab) {
    const panel = document.getElementById('media-panel');
    if (!panel) return;
    panel.classList.add('expanded');
    const ov = document.getElementById('drawer-overlay');
    if (ov) ov.classList.add('show');
    switchMediaTab(tab || 'music');
}

/**
 * 關閉媒體中心
 */
function closeMediaPanel() {
    const panel = document.getElementById('media-panel');
    if (panel) panel.classList.remove('expanded');
    const ov = document.getElementById('drawer-overlay');
    if (ov) ov.classList.remove('show');
}

/**
 * 切換媒體中心開關（QAB 選單入口）
 */
function toggleMediaPanel() {
    const panel = document.getElementById('media-panel');
    if (!panel) return;
    if (panel.classList.contains('expanded')) closeMediaPanel();
    else openMediaPanel('music');
}

/**
 * 切換媒體中心分頁（歌詞分頁僅 ST 可用）
 * @param {string} tab - 'music' | 'lyrics'
 */
function switchMediaTab(tab) {
    // 權限：歌詞工具僅 ST 可用，玩家強制回到音樂分頁
    if (tab === 'lyrics' && typeof myRole !== 'undefined' && myRole !== 'st') {
        if (typeof showToast === 'function') showToast('歌詞工具僅 ST 可用');
        tab = 'music';
    }
    const panel = document.getElementById('media-panel');
    if (!panel) return;
    panel.classList.add('expanded');
    ['music', 'lyrics'].forEach(t => {
        const pane = document.getElementById('media-pane-' + t);
        const btn = document.getElementById('media-tab-' + t);
        const active = (t === tab);
        if (pane) pane.classList.toggle('hidden', !active);
        if (btn) btn.classList.toggle('active', active);
    });
}

/**
 * 相容舊呼叫：開啟音樂分頁
 */
function toggleMusicPanel() {
    openMediaPanel('music');
}

/**
 * 相容舊呼叫：開啟歌詞分頁
 */
function toggleLyricsPanel() {
    openMediaPanel('lyrics');
}

// ===== 頁面載入初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    // 初始化 Modal
    if (typeof initModals === 'function') initModals();
    
    // 初始化檔案上傳
    if (typeof initFileUpload === 'function') initFileUpload();

    // 載入地圖背景圖（本機儲存）
    if (typeof loadMapBgFromStorage === 'function') loadMapBgFromStorage();

    // 檢查現有 Session
    if (typeof checkExistingSession === 'function') checkExistingSession();
    
    // 初始化鍵盤控制 (新增功能)
    initKeyboardControls();

    // 初始化測距尺事件 (Alt + 拖曳)
    if (typeof initRulerEvents === 'function') initRulerEvents();

    // 初始化棋子長按拖曳移動事件
    if (typeof initTokenDragEvents === 'function') initTokenDragEvents();

    console.log('Limbus Command v7.5 initialized');
});

// ===== 鍵盤控制邏輯 =====
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
            broadcastState();
        } else {
            // 玩家移動攔截器：戰術消耗超過剩餘移動能量則擋下（ST 不受限）
            if (typeof applyMoveCost === 'function' && !applyMoveCost(u, newX, newY)) return;
            sendToHost({
                type: 'moveUnit',
                playerId: myPlayerId,
                unitId: u.id,
                x: newX,
                y: newY,
                moveUsed: u.moveUsed || 0
            });
            // 玩家端預先渲染以獲得即時回饋 (實際以 ST 回傳為準)
            // 這裡暫時修改本地數據以達到流暢效果
            u.x = newX;
            u.y = newY;
            renderAll(); 
        }
    });
}

// ===== 滾輪切換控制（wheel-cycle / wheel-toggle）=====
/**
 * 滑鼠滾輪快速切換：
 *   - select.wheel-cycle：滾輪循環切換選項（向下滾＝下一個），並觸發 change
 *   - .wheel-toggle：內含 checkbox 的開關（如單位卡的扣血/治療模式），滾輪直接切換
 * 切換瞬間以黃色描邊閃爍（.wheel-flash）標示狀態改變。
 * 註：多重行動面板的 AOE / 豁免抵擋開關改為點擊切換（避免滾輪切換太敏感）。
 */
function initWheelControls() {
    document.addEventListener('wheel', (e) => {
        if (!e.target || !e.target.closest) return;

        // 下拉選單：滾輪循環切換
        const sel = e.target.closest('select.wheel-cycle');
        if (sel && !sel.disabled && sel.options.length > 0) {
            e.preventDefault();
            const dir = e.deltaY > 0 ? 1 : -1;
            const n = sel.options.length;
            sel.selectedIndex = (sel.selectedIndex + dir + n) % n;
            sel.dispatchEvent(new Event('change', { bubbles: false }));
            sel.classList.remove('wheel-flash');
            void sel.offsetWidth;
            sel.classList.add('wheel-flash');
            return;
        }

        // 開關：滾輪直接切換勾選狀態
        const toggle = e.target.closest('.wheel-toggle');
        if (toggle) {
            const input = toggle.querySelector('input[type="checkbox"]');
            if (input && !input.disabled) {
                e.preventDefault();
                input.checked = !input.checked;
                input.dispatchEvent(new Event('change', { bubbles: false }));
                const track = toggle.querySelector('.toggle-track, .aoe-track, .save-track') || toggle;
                track.classList.remove('wheel-flash');
                void track.offsetWidth;
                track.classList.add('wheel-flash');
            }
        }
    }, { passive: false });
}

if (typeof window !== 'undefined') {
    initWheelControls();
}

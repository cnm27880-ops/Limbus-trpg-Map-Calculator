/**
 * Limbus Command - 快捷鍵模組
 * 提供鍵盤快捷鍵支援，提升操作效率
 */

// ===== 快捷鍵設定 =====
const HOTKEYS = {
    // ===== 頁面切換 =====
    '1': {
        action: () => switchPage('map'),
        description: '切換到地圖頁面',
        category: 'navigation'
    },
    '2': {
        action: () => switchPage('units'),
        description: '切換到單位頁面',
        category: 'navigation'
    },
    '3': {
        action: () => switchPage('calc'),
        description: '切換到計算頁面',
        category: 'navigation'
    },

    // ===== 工具切換 =====
    'q': {
        action: () => setTool('cursor'),
        description: '選取工具',
        category: 'tools'
    },
    'w': {
        action: () => setTool('floor'),
        description: '清除地形',
        category: 'tools'
    },

    // ===== 常用操作 =====
    'Space': {
        action: () => {
            if (myRole === 'st') nextTurn();
        },
        description: '下一回合（僅 ST）',
        category: 'actions'
    },
    'Escape': {
        action: () => {
            clearSelection();
            closeAllModals();
        },
        description: '取消選取 / 關閉視窗',
        category: 'actions'
    },
    'Delete': {
        action: () => deleteSelectedUnit(),
        description: '刪除選取的單位',
        category: 'actions'
    },

    // ===== 視角控制 =====
    'r': {
        action: () => resetCamera(),
        description: '重置視角',
        category: 'camera'
    },
    // 注意：方向鍵由 main.js 的 initKeyboardControls 處理
    // 當有選取單位時用於移動單位，否則用於移動視角
    'ArrowUp': {
        action: () => {
            if (!isUnitSelectedAndDeployed()) moveCamera(0, 80);
        },
        description: '移動單位/視角',
        category: 'camera'
    },
    'ArrowDown': {
        action: () => {
            if (!isUnitSelectedAndDeployed()) moveCamera(0, -80);
        },
        description: '移動單位/視角',
        category: 'camera'
    },
    'ArrowLeft': {
        action: () => {
            if (!isUnitSelectedAndDeployed()) moveCamera(80, 0);
        },
        description: '移動單位/視角',
        category: 'camera'
    },
    'ArrowRight': {
        action: () => {
            if (!isUnitSelectedAndDeployed()) moveCamera(-80, 0);
        },
        description: '移動單位/視角',
        category: 'camera'
    },
    '+': {
        action: () => zoomCamera(0.1),
        description: '放大視角',
        category: 'camera'
    },
    '-': {
        action: () => zoomCamera(-0.1),
        description: '縮小視角',
        category: 'camera'
    },
    '=': {
        action: () => zoomCamera(0.1),
        description: '放大視角',
        category: 'camera',
        hidden: true  // 隱藏（與 + 相同）
    },

    // ===== 面板控制 =====
    'Tab': {
        action: (e) => {
            e.preventDefault();
            toggleSidebar();
        },
        description: '切換側邊欄',
        category: 'panels',
        preventDefault: true
    },
    // 'l' 快捷鍵保留給未來功能使用
    '?': {
        action: () => toggleHotkeyHelp(),
        description: '顯示快捷鍵說明',
        category: 'panels'
    },
    'h': {
        action: () => {
            if (typeof toggleCombatHUD === 'function') toggleCombatHUD();
        },
        description: '切換戰鬥儀表板',
        category: 'panels'
    },
    't': {
        action: () => {
            if (typeof handleTap === 'function') handleTap();
        },
        description: 'Tap Tempo 測速',
        category: 'panels'
    }
};

// ===== 快捷鍵類別標籤 =====
const CATEGORY_LABELS = {
    navigation: '頁面切換',
    tools: '工具',
    actions: '操作',
    camera: '視角控制',
    panels: '面板'
};

// ===== 狀態變數 =====
let hotkeyHelpVisible = false;
let hotkeysEnabled = true;

// ===== 核心函數 =====

/**
 * 處理鍵盤事件
 * @param {KeyboardEvent} e - 鍵盤事件
 */
function handleKeydown(e) {
    // 如果快捷鍵被禁用，直接返回
    if (!hotkeysEnabled) return;

    // 如果正在錄製歌詞定點，空白鍵留給錄製模式
    if (typeof recIsRecording !== 'undefined' && recIsRecording && e.key === ' ') return;

    // 如果正在輸入文字，不觸發快捷鍵
    const activeEl = document.activeElement;
    const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.isContentEditable
    );

    if (isTyping) return;

    // 檢查是否有 Modal 開啟（除了 Escape 鍵）
    const hasOpenModal = document.querySelector('.modal-overlay.show');
    if (hasOpenModal && e.key !== 'Escape') return;

    // 取得按鍵（統一處理）
    let key = e.key;

    // 處理特殊按鍵名稱
    if (key === ' ') key = 'Space';

    // 查找對應的快捷鍵
    const hotkey = HOTKEYS[key] || HOTKEYS[key.toLowerCase()];

    if (hotkey && typeof hotkey.action === 'function') {
        // 防止預設行為（如果需要）
        if (hotkey.preventDefault || key === 'Space' || key === 'Tab') {
            e.preventDefault();
        }

        // 執行動作
        try {
            hotkey.action(e);
        } catch (err) {
            console.warn('快捷鍵執行錯誤:', err);
        }
    }
}

/**
 * 檢查是否有選取並部署在地圖上的單位
 * 用於判斷方向鍵應該移動單位還是視角
 * @returns {boolean}
 */
function isUnitSelectedAndDeployed() {
    if (typeof selectedUnitId === 'undefined' || !selectedUnitId) return false;
    if (typeof state === 'undefined' || !state.units) return false;

    const unit = state.units.find(u => u.id === selectedUnitId);
    if (!unit || unit.x < 0 || unit.y < 0) return false;

    // 檢查是否有權限控制此單位
    if (typeof canControlUnit === 'function' && !canControlUnit(unit)) return false;

    return true;
}

/**
 * 移動相機視角
 * @param {number} dx - X 軸移動量
 * @param {number} dy - Y 軸移動量
 */
function moveCamera(dx, dy) {
    if (typeof cam !== 'undefined') {
        cam.x += dx;
        cam.y += dy;
        if (typeof applyCamera === 'function') {
            applyCamera();
        }
    }
}

// 注意：zoomCamera 已在 camera.js 中定義，不需要重複定義
// 快捷鍵直接調用 camera.js 中的 zoomCamera(delta) 函數

/**
 * 刪除選取的單位
 */
function deleteSelectedUnit() {
    if (typeof selectedUnitId !== 'undefined' && selectedUnitId) {
        deleteUnit(selectedUnitId);
    }
}

/**
 * 關閉所有 Modal
 */
function closeAllModals() {
    const modals = document.querySelectorAll('.modal-overlay.show');
    modals.forEach(modal => {
        modal.classList.remove('show');
    });
}

// ===== 快捷鍵說明面板 =====

/**
 * 切換快捷鍵說明面板
 */
function toggleHotkeyHelp() {
    hotkeyHelpVisible = !hotkeyHelpVisible;
    const panel = document.getElementById('hotkey-help');

    if (panel) {
        panel.classList.toggle('hidden', !hotkeyHelpVisible);

        if (hotkeyHelpVisible) {
            renderHotkeyHelp();

            // 關閉其他面板（音樂面板）
            const musicPanel = document.getElementById('music-player-panel');
            if (musicPanel) {
                musicPanel.classList.remove('expanded');
                const musicBtn = document.getElementById('qab-music-btn');
                if (musicBtn) musicBtn.classList.remove('active');
            }
        }
    }
}

/**
 * 渲染快捷鍵說明內容
 */
function renderHotkeyHelp() {
    const panel = document.getElementById('hotkey-help');
    if (!panel) return;

    // 按類別分組
    const grouped = {};
    Object.entries(HOTKEYS).forEach(([key, config]) => {
        if (config.hidden) return;  // 跳過隱藏的快捷鍵

        const category = config.category || 'other';
        if (!grouped[category]) {
            grouped[category] = [];
        }
        grouped[category].push({ key, ...config });
    });

    // 建立 HTML (包含標題列和關閉按鈕)
    let html = `
        <div class="hotkey-help-header">
            <span class="hotkey-help-title">快捷鍵說明</span>
            <button class="hotkey-help-close" onclick="toggleHotkeyHelp()" title="關閉">×</button>
        </div>
    `;
    html += '<div class="hotkey-help-content">';

    Object.entries(grouped).forEach(([category, hotkeys]) => {
        const label = CATEGORY_LABELS[category] || category;
        html += `<div class="hotkey-category">`;
        html += `<div class="hotkey-category-title">${label}</div>`;

        hotkeys.forEach(({ key, description }) => {
            const displayKey = formatKeyDisplay(key);
            html += `
                <div class="hotkey-item">
                    <span class="hotkey-key">${displayKey}</span>
                    <span class="hotkey-desc">${description}</span>
                </div>
            `;
        });

        html += `</div>`;
    });

    html += '</div>';
    panel.innerHTML = html;
}

/**
 * 格式化按鍵顯示
 * @param {string} key - 按鍵名稱
 * @returns {string} 格式化後的顯示文字
 */
function formatKeyDisplay(key) {
    const keyMap = {
        'Space': '空白鍵',
        'Escape': 'Esc',
        'Delete': 'Del',
        'ArrowUp': '↑',
        'ArrowDown': '↓',
        'ArrowLeft': '←',
        'ArrowRight': '→',
        'Tab': 'Tab'
    };

    return keyMap[key] || key.toUpperCase();
}

// ===== 控制函數 =====

/**
 * 啟用快捷鍵
 */
function enableHotkeys() {
    hotkeysEnabled = true;
}

/**
 * 禁用快捷鍵
 */
function disableHotkeys() {
    hotkeysEnabled = false;
}

// ===== 初始化 =====

/**
 * 初始化快捷鍵系統
 */
function initHotkeys() {
    // 綁定鍵盤事件
    document.addEventListener('keydown', handleKeydown);

    console.log('⌨️ 快捷鍵系統已初始化');
}

// 頁面載入時初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHotkeys);
} else {
    setTimeout(initHotkeys, 100);
}

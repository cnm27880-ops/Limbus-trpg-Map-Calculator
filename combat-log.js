/**
 * Limbus Command - 戰鬥日誌模組
 * 記錄戰鬥中的所有重要事件
 */

// ===== 日誌設定 =====
const LOG_CONFIG = {
    maxEntries: 500,        // 最多保留的日誌條目數
    autoScroll: true,       // 自動滾動到最新
    timestampFormat: 'HH:mm:ss'  // 時間格式
};

// ===== 日誌資料 =====
let combatLogs = [];
let logIdCounter = 0;
let isLogCollapsed = false;

// ===== 日誌類型定義 =====
const LOG_TYPES = {
    turn: {
        icon: '🔄',
        color: 'var(--accent-yellow)',
        label: '回合'
    },
    move: {
        icon: '👣',
        color: 'var(--accent-blue)',
        label: '移動'
    },
    damage: {
        icon: '⚔️',
        color: 'var(--accent-red)',
        label: '傷害'
    },
    heal: {
        icon: '💚',
        color: 'var(--accent-green)',
        label: '治療'
    },
    dp: {
        icon: '🎲',
        color: 'var(--accent-purple)',
        label: 'DP計算'
    },
    status: {
        icon: '✨',
        color: 'var(--accent-orange)',
        label: '狀態'
    },
    unit: {
        icon: '👤',
        color: 'var(--text-dim)',
        label: '單位'
    },
    system: {
        icon: '⚙️',
        color: 'var(--text-dim)',
        label: '系統'
    }
};

// ===== 核心函數 =====

/**
 * 新增日誌條目
 * @param {string} type - 日誌類型 (turn, move, damage, heal, dp, status, unit, system)
 * @param {string} message - 日誌訊息
 * @param {object} details - 額外詳細資訊（可選）
 */
function addLog(type, message, details = null) {
    const logType = LOG_TYPES[type] || LOG_TYPES.system;
    const timestamp = new Date();

    const entry = {
        id: ++logIdCounter,
        type: type,
        icon: logType.icon,
        color: logType.color,
        message: message,
        details: details,
        timestamp: timestamp,
        timeStr: formatTime(timestamp)
    };

    combatLogs.push(entry);

    // 限制日誌數量
    if (combatLogs.length > LOG_CONFIG.maxEntries) {
        combatLogs = combatLogs.slice(-LOG_CONFIG.maxEntries);
    }

    // 更新 UI
    renderLogEntry(entry);

    // 自動滾動
    if (LOG_CONFIG.autoScroll) {
        scrollLogToBottom();
    }

    return entry;
}

/**
 * 格式化時間
 * @param {Date} date - 日期物件
 * @returns {string} 格式化後的時間字串
 */
function formatTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

/**
 * 渲染單一日誌條目
 * @param {object} entry - 日誌條目
 */
function renderLogEntry(entry) {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;

    const entryEl = document.createElement('div');
    entryEl.className = 'log-entry';
    entryEl.dataset.logId = entry.id;
    entryEl.dataset.logType = entry.type;

    entryEl.innerHTML = `
        <span class="log-time">${entry.timeStr}</span>
        <span class="log-icon" style="color:${entry.color}">${entry.icon}</span>
        <span class="log-message">${escapeHtml(entry.message)}</span>
    `;

    // 如果有詳細資訊，添加展開功能
    if (entry.details) {
        entryEl.classList.add('has-details');
        entryEl.title = '點擊查看詳細資訊';
        entryEl.onclick = () => showLogDetails(entry);
    }

    logContent.appendChild(entryEl);
}

/**
 * 渲染所有日誌
 */
function renderAllLogs() {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;

    logContent.innerHTML = '';
    combatLogs.forEach(entry => renderLogEntry(entry));

    if (LOG_CONFIG.autoScroll) {
        scrollLogToBottom();
    }
}

/**
 * 滾動日誌到底部
 */
function scrollLogToBottom() {
    const logContent = document.getElementById('log-content');
    if (logContent) {
        setTimeout(() => {
            logContent.scrollTop = logContent.scrollHeight;
        }, 10);
    }
}

/**
 * 顯示日誌詳細資訊
 * @param {object} entry - 日誌條目
 */
function showLogDetails(entry) {
    if (!entry.details) return;

    let detailsText = '';
    if (typeof entry.details === 'string') {
        detailsText = entry.details;
    } else {
        detailsText = JSON.stringify(entry.details, null, 2);
    }

    alert(`📋 詳細資訊\n\n${detailsText}`);
}

// ===== 日誌控制 =====

/**
 * 清除所有日誌
 */
function clearLog() {
    if (!confirm('確定要清除所有戰鬥日誌嗎？')) return;

    combatLogs = [];
    const logContent = document.getElementById('log-content');
    if (logContent) {
        logContent.innerHTML = '';
    }

    addLog('system', '日誌已清除');
}

/**
 * 匯出日誌為文字檔
 */
function exportLog() {
    if (combatLogs.length === 0) {
        showToast('沒有日誌可匯出');
        return;
    }

    // 建立日誌文字內容
    const header = `=== Limbus Command 戰鬥日誌 ===\n`;
    const exportTime = `匯出時間: ${new Date().toLocaleString('zh-TW')}\n`;
    const separator = `${'='.repeat(40)}\n\n`;

    const logText = combatLogs.map(entry => {
        const typeLabel = LOG_TYPES[entry.type]?.label || entry.type;
        let line = `[${entry.timeStr}] [${typeLabel}] ${entry.message}`;

        if (entry.details) {
            if (typeof entry.details === 'string') {
                line += `\n    └─ ${entry.details}`;
            } else {
                line += `\n    └─ ${JSON.stringify(entry.details)}`;
            }
        }

        return line;
    }).join('\n');

    const content = header + exportTime + separator + logText;

    // 建立下載連結
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `combat-log-${formatDateForFilename(new Date())}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('日誌已匯出');
}

/**
 * 格式化日期用於檔案名稱
 * @param {Date} date - 日期物件
 * @returns {string} 格式化後的日期字串
 */
function formatDateForFilename(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}${m}${d}-${h}${min}`;
}

/**
 * 切換日誌面板折疊狀態
 */
function toggleLog() {
    isLogCollapsed = !isLogCollapsed;
    const logPanel = document.getElementById('combat-log');
    const toggleBtn = document.querySelector('.log-toggle-btn');

    if (logPanel) {
        logPanel.classList.toggle('collapsed', isLogCollapsed);
    }

    if (toggleBtn) {
        toggleBtn.textContent = isLogCollapsed ? '展開' : '折疊';
    }
}

/**
 * 顯示/隱藏日誌面板
 */
function toggleLogPanel() {
    const logPanel = document.getElementById('combat-log');
    if (logPanel) {
        logPanel.classList.toggle('hidden');
    }
}

// ===== 便捷日誌函數 =====

/**
 * 記錄回合切換
 * @param {object} unit - 當前行動的單位
 * @param {number} turnNumber - 回合編號
 */
function logTurnChange(unit, turnNumber) {
    const unitName = unit?.name || '未知單位';
    addLog('turn', `回合 ${turnNumber}: ${unitName} 的行動`, {
        unitId: unit?.id,
        unitType: unit?.type,
        init: unit?.init
    });
}

/**
 * 記錄單位移動
 * @param {object} unit - 移動的單位
 * @param {object} from - 起始位置 {x, y}
 * @param {object} to - 目標位置 {x, y}
 */
function logUnitMove(unit, from, to) {
    const unitName = unit?.name || '未知單位';

    if (from.x < 0 || from.y < 0) {
        // 部署
        addLog('move', `${unitName} 部署到 (${to.x}, ${to.y})`);
    } else {
        // 移動
        const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
        addLog('move', `${unitName} 移動: (${from.x},${from.y}) → (${to.x},${to.y}) [${distance}格]`);
    }
}

/**
 * 記錄傷害
 * @param {object} unit - 受傷的單位
 * @param {string} dmgType - 傷害類型 (b, l, a)
 * @param {number} amount - 傷害數量
 */
function logDamage(unit, dmgType, amount) {
    const unitName = unit?.name || '未知單位';
    const dmgLabel = dmgType === 'a' ? 'A傷' : dmgType === 'l' ? 'L傷' : 'B傷';
    addLog('damage', `${unitName} 受到 ${amount} 點 ${dmgLabel}`);
}

/**
 * 記錄治療
 * @param {object} unit - 被治療的單位
 * @param {number} amount - 治療數量
 */
function logHeal(unit, amount) {
    const unitName = unit?.name || '未知單位';
    addLog('heal', `${unitName} 治療了 ${amount} 格 HP`);
}

/**
 * 記錄 DP 計算結果
 * @param {number} result - DP 結果
 * @param {object} details - 計算詳情
 */
function logDPCalculation(result, details) {
    let message;
    if (result > 0) {
        message = `DP 計算結果: ${result}dp (成功)`;
    } else if (result === 0) {
        message = `DP 計算結果: 機運骰`;
    } else {
        message = `DP 計算結果: ${result}dp (機運骰)`;
    }

    addLog('dp', message, details);
}

/**
 * 記錄狀態變更
 * @param {object} unit - 單位
 * @param {string} statusName - 狀態名稱
 * @param {string} action - 動作 (add, update, remove)
 * @param {string} value - 狀態數值
 */
function logStatusChange(unit, statusName, action, value = '') {
    const unitName = unit?.name || '未知單位';
    let message;

    switch (action) {
        case 'add':
            message = `${unitName} 獲得狀態: ${statusName}${value ? ` (${value})` : ''}`;
            break;
        case 'update':
            message = `${unitName} 狀態更新: ${statusName} → ${value}`;
            break;
        case 'remove':
            message = `${unitName} 移除狀態: ${statusName}`;
            break;
        default:
            message = `${unitName} 狀態變更: ${statusName}`;
    }

    addLog('status', message);
}

/**
 * 記錄單位新增
 * @param {object} unit - 新增的單位
 */
function logUnitAdd(unit) {
    const unitName = unit?.name || '未知單位';
    const unitType = unit?.type === 'enemy' ? '敵方' : '我方';
    addLog('unit', `新增${unitType}單位: ${unitName}`);
}

/**
 * 記錄單位刪除
 * @param {object} unit - 刪除的單位
 */
function logUnitDelete(unit) {
    const unitName = unit?.name || '未知單位';
    addLog('unit', `移除單位: ${unitName}`);
}

/**
 * 記錄排序事件
 */
function logSort() {
    addLog('system', '單位已依先攻值排序');
}

// ===== 初始化 =====

/**
 * 初始化戰鬥日誌系統
 */
function initCombatLog() {
    console.log('📋 戰鬥日誌系統已初始化');
    addLog('system', '戰鬥日誌系統已啟動');
}

// 頁面載入時初始化（如果 DOM 已就緒）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCombatLog);
} else {
    // DOM 已經就緒
    setTimeout(initCombatLog, 100);
}

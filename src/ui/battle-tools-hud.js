/**
 * Limbus Command - BOSS 戰鬥面板（ST 專用）
 *
 * 原「戰鬥工具」三分頁（招式 / 計算 / BOSS）已精簡：
 *   - 招式分頁移除（怪物每招改由「多重行動設定」逐招填 DP / 狀態）
 *   - 計算分頁移除（改用導覽列「計算」頁面）
 *   - 保留 BOSS 戰計算，並把「群體操作 (AOE)」整合進同一面板
 *
 * 沿用 setupPanelDrag / setupPanelCollapse / clampHudPosition（src/ui/st-skill-hud.js）。
 */

const BATTLE_TOOLS_POS_KEY = 'limbus_battle_tools_pos';
const BATTLE_TOOLS_STATE_KEY = 'limbus_battle_tools_state';

let battleToolsState = {
    isVisible: false,
    isCollapsed: false,
    position: { x: 60, y: 90 }
};

// ===== 持久化 =====
function loadBattleToolsSettings() {
    try {
        const pos = localStorage.getItem(BATTLE_TOOLS_POS_KEY);
        if (pos) {
            const p = JSON.parse(pos);
            if (p.x !== undefined) battleToolsState.position = p;
        }
        const st = localStorage.getItem(BATTLE_TOOLS_STATE_KEY);
        if (st) {
            const s = JSON.parse(st);
            if (s.collapsed !== undefined) battleToolsState.isCollapsed = s.collapsed;
        }
    } catch (e) {}
}

function saveBattleToolsSettings() {
    try {
        localStorage.setItem(BATTLE_TOOLS_POS_KEY, JSON.stringify(battleToolsState.position));
        localStorage.setItem(BATTLE_TOOLS_STATE_KEY, JSON.stringify({
            collapsed: battleToolsState.isCollapsed
        }));
    } catch (e) {}
}

function btIsST() {
    return typeof myRole !== 'undefined' && myRole === 'st';
}

// ===== 建立面板 =====
function createBattleToolsHUD() {
    if (document.getElementById('battle-tools-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'battle-tools-hud';
    hud.className = 'skill-hud hidden';  // 重用面板的拖曳/外框樣式
    hud.innerHTML = `
        <div class="skill-hud-header" id="battle-tools-header">
            <span class="skill-hud-title">👹 BOSS 戰鬥面板</span>
            <div class="skill-hud-controls">
                <button class="skill-hud-btn" onclick="closeBattleTools()" title="關閉">×</button>
            </div>
        </div>
        <div class="battle-tools-body">
            <!-- 群體操作 (AOE) -->
            <div class="skill-hud-aoe-section" id="skill-hud-aoe" style="padding:8px; border-bottom:1px solid var(--border); background:var(--bg-panel);">
                <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="toggleStAoePanel()">
                    <span style="font-weight:bold; color:var(--accent-red);">💥 群體操作 (AOE)</span>
                    <span id="st-aoe-toggle-icon">▼</span>
                </div>
                <div id="st-aoe-panel-content" style="display:none; margin-top:8px;">
                    <div style="display:flex; gap:5px; margin-bottom:5px; flex-wrap:wrap;">
                        <button class="skill-action-btn" style="flex:1; min-width:70px;" onclick="stAoeSelect('players')">全選玩家</button>
                        <button class="skill-action-btn" style="flex:1; min-width:70px;" onclick="stAoeSelect('enemies')">全選敵人</button>
                        <button class="skill-action-btn" style="flex:1; min-width:60px;" onclick="stAoeSelect('all')">全選</button>
                        <button class="skill-action-btn" style="flex:1; min-width:60px;" onclick="stAoeSelect('none')">取消全選</button>
                        <button class="skill-action-btn" style="flex:1; min-width:60px;" onclick="stAoeSelect('invert')">反選</button>
                    </div>
                    <div id="st-aoe-target-list" style="max-height:100px; overflow-y:auto; border:1px solid var(--border); padding:5px; margin-bottom:5px; font-size:0.8rem;">
                        <!-- Checkbox list of units injected via JS -->
                    </div>
                    <div style="display:flex; gap:5px; margin-bottom:5px; align-items:center;">
                        <label style="font-size:0.8rem; color:var(--text-dim); flex-shrink:0;">數值</label>
                        <input type="number" id="st-aoe-value-input" value="1" min="1" style="flex:1; min-width:0; padding:4px;">
                        <select id="st-aoe-dmg-type" style="flex:0 0 auto; padding:4px;" title="傷害類型">
                            <option value="b">B傷</option>
                            <option value="l" selected>L傷</option>
                            <option value="a">A傷</option>
                        </select>
                        <button class="skill-action-btn" style="flex:0 0 auto; background:var(--accent-red); color:#fff;" onclick="executeStAoeAction('damage')">傷害</button>
                        <button class="skill-action-btn" style="flex:0 0 auto; background:var(--accent-green); color:#fff;" onclick="executeStAoeAction('heal')">治癒</button>
                    </div>
                    <div style="display:flex; gap:5px; margin-bottom:5px;">
                        <input type="text" id="st-aoe-status-id" list="st-aoe-status-options" placeholder="狀態名稱（例：流血）" style="flex:2; min-width:0; padding:4px;">
                        <input type="number" id="st-aoe-status-val" value="1" placeholder="層數" title="層數（負數可減層）" style="flex:1; min-width:0; padding:4px;">
                        <button class="skill-action-btn" style="flex:0 0 auto;" onclick="executeStAoeAction('status')">套用狀態</button>
                    </div>
                    <div style="display:flex; gap:5px;">
                        <button class="skill-action-btn" style="flex:1; background:#555; color:#fff;" onclick="undoStAoe()">復原上一步</button>
                    </div>
                </div>
            </div>
            <!-- BOSS 戰計算 -->
            <div class="skill-hud-body" id="boss-battle-body"></div>
        </div>
    `;
    document.body.appendChild(hud);
    hud.style.left = battleToolsState.position.x + 'px';
    hud.style.top = battleToolsState.position.y + 'px';
    if (battleToolsState.isCollapsed) hud.classList.add('collapsed');

    if (typeof setupPanelDrag === 'function') {
        setupPanelDrag('battle-tools-hud', 'battle-tools-header', battleToolsState, saveBattleToolsSettings);
    }
    if (typeof setupPanelCollapse === 'function') {
        setupPanelCollapse('battle-tools-header', battleToolsState, 'battle-tools-hud', saveBattleToolsSettings,
            null, () => renderBattleToolsActive());
    }
}

// ===== 渲染內容 =====
function renderBattleToolsActive() {
    if (typeof renderBossBattleContent === 'function') renderBossBattleContent();
    if (typeof renderStAoeTargetList === 'function') renderStAoeTargetList();
}

// ===== 開 / 關 / 切換 =====
function openBattleTools() {
    if (!btIsST()) {
        if (typeof showToast === 'function') showToast('BOSS 戰鬥面板僅 ST 可用');
        return;
    }
    createBattleToolsHUD();
    const hud = document.getElementById('battle-tools-hud');
    if (hud) hud.classList.remove('hidden');
    if (typeof clampHudPosition === 'function') clampHudPosition(battleToolsState, 'battle-tools-hud');
    battleToolsState.isVisible = true;
    saveBattleToolsSettings();
    renderBattleToolsActive();
}

function closeBattleTools() {
    const hud = document.getElementById('battle-tools-hud');
    if (hud) hud.classList.add('hidden');
    battleToolsState.isVisible = false;
    saveBattleToolsSettings();
}

function toggleBattleTools() {
    if (battleToolsState.isVisible) closeBattleTools();
    else openBattleTools();
}

// ===== 對外（沿用舊識別字，導向本面板） =====
window.openBattleTools = openBattleTools;
window.closeBattleTools = closeBattleTools;
window.toggleBattleTools = toggleBattleTools;
window.showBossBattleHUD = openBattleTools;
window.closeBossBattleHUD = closeBattleTools;
window.toggleBossBattleHUD = toggleBattleTools;

// ===== 視窗縮放時夾限位置 =====
window.addEventListener('resize', () => {
    if (battleToolsState.isVisible && typeof clampHudPosition === 'function') {
        clampHudPosition(battleToolsState, 'battle-tools-hud');
    }
});

// ===== 初始化 =====
loadBattleToolsSettings();
// 不自動開啟（需要 myRole 已就緒），由 QAB 選單觸發

console.log('👹 BOSS 戰鬥面板已載入');

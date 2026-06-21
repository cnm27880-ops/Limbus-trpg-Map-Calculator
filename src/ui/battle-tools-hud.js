/**
 * Limbus Command - 戰鬥工具整合面板（分頁融合）
 *
 * 將原本三個獨立的懸浮視窗合併為單一可拖曳視窗，以分頁切換：
 *   - 🗡️ 招式：怪物招式面板（renderSkillHudContent → #skill-hud-body / #skill-hud-aoe）
 *   - 🎲 計算：懸浮計算器（moveCalcToHUD → #calc-hud-body）
 *   - 👹 BOSS：特殊BOSS戰（renderBossBattleContent → #boss-battle-body，僅 ST）
 *
 * 設計理念：沿用既有的 .skill-hud 視窗外框與 setupPanelDrag / setupPanelCollapse，
 * 並覆寫舊的 show/close/toggle 函式，使既有呼叫者（招式套用計算、AOE、防禦載入…）
 * 自動導向本整合面板，不需改動各自的渲染邏輯。
 */

const BATTLE_TOOLS_POS_KEY = 'limbus_battle_tools_pos';
const BATTLE_TOOLS_STATE_KEY = 'limbus_battle_tools_state';

let battleToolsState = {
    isVisible: false,
    isCollapsed: false,
    activeTab: 'skill',           // 'skill' | 'calc' | 'boss'
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
            if (s.activeTab) battleToolsState.activeTab = s.activeTab;
        }
    } catch (e) {}
}

function saveBattleToolsSettings() {
    try {
        localStorage.setItem(BATTLE_TOOLS_POS_KEY, JSON.stringify(battleToolsState.position));
        localStorage.setItem(BATTLE_TOOLS_STATE_KEY, JSON.stringify({
            collapsed: battleToolsState.isCollapsed,
            activeTab: battleToolsState.activeTab
        }));
    } catch (e) {}
}

function btIsST() {
    return typeof myRole !== 'undefined' && myRole === 'st';
}

// ===== 建立整合視窗 =====
function createBattleToolsHUD() {
    if (document.getElementById('battle-tools-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'battle-tools-hud';
    hud.className = 'skill-hud hidden';  // 重用招式面板的拖曳/外框樣式
    hud.innerHTML = `
        <div class="skill-hud-header" id="battle-tools-header">
            <span class="skill-hud-title">⚔️ 戰鬥工具</span>
            <div class="battle-tools-tabs">
                <button class="bt-tab active" id="bt-tab-skill" onclick="switchBattleTab('skill')" title="怪物招式">🗡️</button>
                <button class="bt-tab" id="bt-tab-calc" onclick="switchBattleTab('calc')" title="DP 計算器">🎲</button>
                <button class="bt-tab" id="bt-tab-boss" onclick="switchBattleTab('boss')" title="特殊BOSS戰（ST）">👹</button>
            </div>
            <div class="skill-hud-controls">
                <button class="skill-hud-btn" id="bt-skill-mode-btn" onclick="toggleSkillHudMode()" title="切換招式編輯模式">📝</button>
                <button class="skill-hud-btn" onclick="closeBattleTools()" title="關閉">×</button>
            </div>
        </div>
        <div class="battle-tools-body">
            <!-- 招式分頁 -->
            <div class="bt-pane" id="bt-pane-skill">
                <div class="skill-hud-aoe-section" id="skill-hud-aoe" style="padding:8px; border-bottom:1px solid var(--border); background:var(--bg-panel); display:none;">
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
                <div class="skill-hud-body" id="skill-hud-body"></div>
            </div>
            <!-- 計算分頁 -->
            <div class="bt-pane hidden" id="bt-pane-calc">
                <div class="calc-hud-body" id="calc-hud-body"></div>
            </div>
            <!-- BOSS 分頁 -->
            <div class="bt-pane hidden" id="bt-pane-boss">
                <div class="skill-hud-body" id="boss-battle-body"></div>
            </div>
        </div>
    `;
    document.body.appendChild(hud);
    hud.style.left = battleToolsState.position.x + 'px';
    hud.style.top = battleToolsState.position.y + 'px';
    if (battleToolsState.isCollapsed) hud.classList.add('collapsed');

    // 玩家隱藏 BOSS 分頁（ST 專用）
    if (!btIsST()) {
        const bossTab = document.getElementById('bt-tab-boss');
        if (bossTab) bossTab.style.display = 'none';
    }

    if (typeof setupPanelDrag === 'function') {
        setupPanelDrag('battle-tools-hud', 'battle-tools-header', battleToolsState, saveBattleToolsSettings);
    }
    if (typeof setupPanelCollapse === 'function') {
        setupPanelCollapse('battle-tools-header', battleToolsState, 'battle-tools-hud', saveBattleToolsSettings,
            null, () => renderBattleToolsActive());
    }
}

// ===== 渲染當前分頁內容 =====
function renderBattleToolsActive() {
    const tab = battleToolsState.activeTab;
    if (tab === 'skill') {
        if (typeof renderSkillHudContent === 'function') renderSkillHudContent();
    } else if (tab === 'calc') {
        if (typeof moveCalcToHUD === 'function') moveCalcToHUD();
    } else if (tab === 'boss') {
        if (typeof renderBossBattleContent === 'function') renderBossBattleContent();
    }
}

// ===== 分頁切換 =====
function switchBattleTab(tab) {
    if (tab === 'boss' && !btIsST()) {
        if (typeof showToast === 'function') showToast('特殊BOSS戰面板僅 ST 可用');
        return;
    }
    createBattleToolsHUD();

    // 離開計算分頁時把計算器移回「計算」頁面，確保導覽列的計算分頁仍可用
    if (battleToolsState.activeTab === 'calc' && tab !== 'calc' && typeof moveCalcBack === 'function') {
        moveCalcBack();
    }
    battleToolsState.activeTab = tab;

    ['skill', 'calc', 'boss'].forEach(t => {
        const pane = document.getElementById('bt-pane-' + t);
        const btn = document.getElementById('bt-tab-' + t);
        const active = (t === tab);
        if (pane) pane.classList.toggle('hidden', !active);
        if (btn) btn.classList.toggle('active', active);
    });

    // 招式編輯模式按鈕僅在招式分頁顯示
    const modeBtn = document.getElementById('bt-skill-mode-btn');
    if (modeBtn) modeBtn.style.display = (tab === 'skill') ? '' : 'none';

    renderBattleToolsActive();
    saveBattleToolsSettings();
}

// ===== 開 / 關 / 切換 =====
function openBattleTools(tab) {
    createBattleToolsHUD();
    const hud = document.getElementById('battle-tools-hud');
    if (hud) hud.classList.remove('hidden');
    if (typeof clampHudPosition === 'function') clampHudPosition(battleToolsState, 'battle-tools-hud');
    battleToolsState.isVisible = true;

    // 預設分頁：指定 → 指定；否則沿用上次；玩家若停在 BOSS 分頁則退回招式
    let target = tab || battleToolsState.activeTab || 'skill';
    if (target === 'boss' && !btIsST()) target = 'skill';
    switchBattleTab(target);
}

function closeBattleTools() {
    // 關閉時把計算器移回「計算」頁面
    if (battleToolsState.activeTab === 'calc' && typeof moveCalcBack === 'function') {
        moveCalcBack();
    }
    const hud = document.getElementById('battle-tools-hud');
    if (hud) hud.classList.add('hidden');
    battleToolsState.isVisible = false;
    saveBattleToolsSettings();
}

function toggleBattleTools() {
    if (battleToolsState.isVisible) closeBattleTools();
    else openBattleTools();
}

// ===== 覆寫舊的三視窗 show/close/toggle，導向整合面板 =====
// （非模組腳本中，覆寫 window 屬性即可改變後續以識別字呼叫的解析結果）
window.showSkillHUD = function () { openBattleTools('skill'); };
window.closeSkillHUD = function () { closeBattleTools(); };
window.toggleSkillHUD = function () {
    if (battleToolsState.isVisible && battleToolsState.activeTab === 'skill') closeBattleTools();
    else openBattleTools('skill');
};

window.showCalcHUD = function () { openBattleTools('calc'); };
window.closeCalcHUD = function () { closeBattleTools(); };
window.toggleCalcHUD = function () {
    if (battleToolsState.isVisible && battleToolsState.activeTab === 'calc') closeBattleTools();
    else openBattleTools('calc');
};

window.showBossBattleHUD = function () { openBattleTools('boss'); };
window.closeBossBattleHUD = function () { closeBattleTools(); };
window.toggleBossBattleHUD = function () {
    if (battleToolsState.isVisible && battleToolsState.activeTab === 'boss') closeBattleTools();
    else openBattleTools('boss');
};

window.openBattleTools = openBattleTools;
window.closeBattleTools = closeBattleTools;
window.toggleBattleTools = toggleBattleTools;
window.switchBattleTab = switchBattleTab;

// ===== 視窗縮放時夾限位置 =====
window.addEventListener('resize', () => {
    if (battleToolsState.isVisible && typeof clampHudPosition === 'function') {
        clampHudPosition(battleToolsState, 'battle-tools-hud');
    }
});

// ===== 初始化 =====
loadBattleToolsSettings();
// 不自動開啟（需要 myRole 已就緒），由 QAB 選單觸發

console.log('⚔️ 戰鬥工具整合面板已載入');

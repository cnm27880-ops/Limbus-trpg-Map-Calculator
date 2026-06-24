/**
 * Limbus Command - 特殊 BOSS 戰計算面板 (ST 專用)
 *
 * 規則（特殊BOSS）：
 * - BOSS 每回合七個行動，每個行動有獨立先攻
 * - 行動先攻高於對抗玩家 → 該行動 DP +（支線等級×10）；低於 → −（支線等級×10）
 * - 玩家對抗複數行動：每多對抗一個，BOSS 所有針對該玩家的行動 DP 額外 +（支線等級×10）
 * - 玩家本回合未對抗任何行動 → 該玩家自身 DP +（支線等級×10）
 *
 * 資料來源：
 * - 玩家數值 → 計算器的「玩家數值備忘錄」（playerMemoData）
 * - 行動先攻 → BOSS 的多重行動條目（getActionSlots）
 * - 玩家先攻 → 場上同名單位的先攻（可手動覆寫）
 */

const BOSS_BATTLE_STATE_KEY = 'limbus_boss_battle_state';
const BOSS_BATTLE_POS_KEY = 'limbus_boss_battle_pos';

let bossBattleState = {
    isVisible: false,
    isCollapsed: false,
    position: { x: 60, y: 80 },
    sideLevel: 1,        // 支線等級（修正值 = 等級 × 10）
    bossId: null,
    bossAtkMod: 0,       // BOSS 攻擊 DP 修正（增益/減益總和，手動填）
    bossDefMod: 0,       // BOSS 防禦修正
    actions: [],         // [{init, baseDp, counter}] counter = 對抗玩家名稱（'' = 無人）
    playerInits: {}      // 玩家名稱 → 先攻覆寫值
};

// ===== 持久化 =====
function loadBossBattleSettings() {
    try {
        const pos = localStorage.getItem(BOSS_BATTLE_POS_KEY);
        if (pos) {
            const p = JSON.parse(pos);
            if (p.x !== undefined) bossBattleState.position = p;
        }
        const st = localStorage.getItem(BOSS_BATTLE_STATE_KEY);
        if (st) {
            const s = JSON.parse(st);
            ['isVisible', 'isCollapsed', 'sideLevel', 'bossId', 'bossAtkMod', 'bossDefMod', 'actions', 'playerInits']
                .forEach(k => { if (s[k] !== undefined) bossBattleState[k] = s[k]; });
        }
    } catch (e) {}
}

function saveBossBattleSettings() {
    try {
        localStorage.setItem(BOSS_BATTLE_POS_KEY, JSON.stringify(bossBattleState.position));
        const { position, ...rest } = bossBattleState;
        localStorage.setItem(BOSS_BATTLE_STATE_KEY, JSON.stringify(rest));
    } catch (e) {}
}

// ===== 開關 =====
function createBossBattleHUD() {
    if (document.getElementById('boss-battle-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'boss-battle-hud';
    hud.className = 'skill-hud hidden';  // 重用怪物招式面板的拖曳/外框樣式
    hud.innerHTML = `
        <div class="skill-hud-header" id="boss-battle-header">
            <span class="skill-hud-title">👹 特殊BOSS戰</span>
            <div class="skill-hud-controls">
                <button class="skill-hud-btn" onclick="closeBossBattleHUD()" title="關閉">×</button>
            </div>
        </div>
        <div class="skill-hud-body" id="boss-battle-body"></div>
    `;
    document.body.appendChild(hud);
    hud.style.left = bossBattleState.position.x + 'px';
    hud.style.top = bossBattleState.position.y + 'px';
    if (bossBattleState.isCollapsed) hud.classList.add('collapsed');

    setupPanelDrag('boss-battle-hud', 'boss-battle-header', bossBattleState, saveBossBattleSettings);
    setupPanelCollapse('boss-battle-header', bossBattleState, 'boss-battle-hud', saveBossBattleSettings,
        null, () => renderBossBattleContent());
}

function showBossBattleHUD() {
    if (myRole !== 'st') {
        showToast('特殊BOSS戰面板僅 ST 可用');
        return;
    }
    createBossBattleHUD();
    const hud = document.getElementById('boss-battle-hud');
    if (hud) hud.classList.remove('hidden');
    if (typeof clampHudPosition === 'function') clampHudPosition(bossBattleState, 'boss-battle-hud');
    bossBattleState.isVisible = true;
    saveBossBattleSettings();
    renderBossBattleContent();
}

function closeBossBattleHUD() {
    const hud = document.getElementById('boss-battle-hud');
    if (hud) hud.classList.add('hidden');
    bossBattleState.isVisible = false;
    saveBossBattleSettings();
}

function toggleBossBattleHUD() {
    if (bossBattleState.isVisible) closeBossBattleHUD();
    else showBossBattleHUD();
}

// ===== 資料取得 =====
function bbGetMemoPlayers() {
    return (typeof playerMemoData !== 'undefined' && Array.isArray(playerMemoData))
        ? playerMemoData.filter(p => p.name && p.name.trim())
        : [];
}

function bbGetBossCandidates() {
    return (state.units || []).filter(u => !u.actionSlotOf && (u.type === 'boss' || u.type === 'enemy'));
}

/**
 * 解析玩家先攻：手動覆寫優先，其次找場上同名單位
 */
function bbResolvePlayerInit(name) {
    const override = bossBattleState.playerInits[name];
    if (override !== undefined && override !== '' && override !== null) {
        return parseInt(override) || 0;
    }
    const unit = (state.units || []).find(u => !u.actionSlotOf && u.name === name);
    return unit ? (unit.init || 0) : 0;
}

/**
 * 從 BOSS 的多重行動條目讀取行動先攻（保留已填的基礎DP與對抗者）
 */
function bbLoadActionsFromBoss() {
    const boss = findUnitById(bossBattleState.bossId);
    if (!boss) {
        showToast('請先選擇 BOSS');
        return;
    }
    const slots = (typeof getActionSlots === 'function') ? getActionSlots(boss.id) : [];
    const old = bossBattleState.actions || [];
    const newActions = [{ init: boss.init || 0, baseDp: old[0]?.baseDp || 0, counter: old[0]?.counter || '' }];
    slots.forEach((s, i) => {
        newActions.push({
            init: s.init || 0,
            baseDp: old[i + 1]?.baseDp || 0,
            counter: old[i + 1]?.counter || ''
        });
    });
    bossBattleState.actions = newActions;
    saveBossBattleSettings();
    renderBossBattleContent();
    showToast(`已讀取 ${newActions.length} 個行動的先攻`);
}

// ===== 欄位更新 =====
function bbUpdate(field, value) {
    if (field === 'sideLevel') {
        bossBattleState.sideLevel = Math.max(1, parseInt(value) || 1);
    } else if (field === 'bossId') {
        bossBattleState.bossId = value || null;
    } else if (field === 'bossAtkMod' || field === 'bossDefMod') {
        bossBattleState[field] = parseInt(value) || 0;
    }
    saveBossBattleSettings();
    if (field === 'bossId') renderBossBattleContent();
    else renderBossBattleResults();
}

function bbUpdateAction(index, field, value) {
    const a = bossBattleState.actions[index];
    if (!a) return;
    if (field === 'counter') a.counter = value;
    else a[field] = parseInt(value) || 0;
    saveBossBattleSettings();
    renderBossBattleResults();
}

function bbUpdatePlayerInit(name, value) {
    bossBattleState.playerInits[name] = value;
    saveBossBattleSettings();
    renderBossBattleResults();
}

function bbAddAction() {
    bossBattleState.actions.push({ init: 0, baseDp: 0, counter: '' });
    saveBossBattleSettings();
    renderBossBattleContent();
}

function bbRemoveAction(index) {
    bossBattleState.actions.splice(index, 1);
    saveBossBattleSettings();
    renderBossBattleContent();
}

// ===== 渲染 =====
function renderBossBattleContent() {
    const body = document.getElementById('boss-battle-body');
    if (!body) return;

    const players = bbGetMemoPlayers();
    const bosses = bbGetBossCandidates();
    const boss = findUnitById(bossBattleState.bossId);

    // BOSS 選擇選項
    const bossOptions = ['<option value="">— 選擇 BOSS —</option>']
        .concat(bosses.map(b =>
            `<option value="${b.id}" ${b.id === bossBattleState.bossId ? 'selected' : ''}>${escapeHtml(b.name || '未命名')}</option>`
        )).join('');

    // BOSS 身上狀態提示（供 ST 決定攻防修正）
    let bossStatusHint = '';
    if (boss && boss.status && Object.keys(boss.status).length > 0) {
        const chips = Object.entries(boss.status).map(([n, v]) =>
            `<span class="bb-status-chip">${escapeHtml(n)}${v ? ' ' + escapeHtml(v) : ''}</span>`).join('');
        bossStatusHint = `<div class="bb-hint">BOSS 目前狀態（請依效果填入下方修正）：${chips}</div>`;
    }

    // 行動列表
    const playerOpts = name =>
        ['<option value="">無人對抗</option>'].concat(players.map(p =>
            `<option value="${escapeHtml(p.name)}" ${p.name === name ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
        )).join('');

    const actionRows = (bossBattleState.actions || []).map((a, i) => `
        <div class="bb-action-row">
            <span class="bb-action-label">行動${i + 1}${i === 0 ? '·本體' : ''}</span>
            <input type="number" class="bb-num" title="先攻" placeholder="先攻" value="${a.init}"
                   onchange="bbUpdateAction(${i}, 'init', this.value)">
            <input type="number" class="bb-num" title="基礎DP（選填）" placeholder="DP" value="${a.baseDp || ''}"
                   onchange="bbUpdateAction(${i}, 'baseDp', this.value)">
            <select class="bb-counter-select" onchange="bbUpdateAction(${i}, 'counter', this.value)">
                ${playerOpts(a.counter)}
            </select>
            <button class="bb-mini-btn" onclick="bbRemoveAction(${i})" title="移除此行動">×</button>
        </div>
    `).join('');

    // 玩家數值（含先攻）
    const playerRows = players.length === 0
        ? '<div class="bb-hint">備忘錄沒有玩家資料——請先到計算器的「玩家數值備忘錄」填入 攻DP/附成/防禦/防附</div>'
        : players.map(p => `
            <div class="bb-player-row">
                <span class="bb-player-name">${escapeHtml(p.name)}</span>
                <span class="bb-player-stats" title="攻擊DP / 攻擊附加成功 / 防禦 / 防禦附加成功">
                    ⚔${p.dp || 0}+${p.atkBonus || 0} ｜ 🛡${p.def || 0}+${p.defBonus || 0}
                </span>
                <label class="bb-init-label">先攻</label>
                <input type="number" class="bb-num" value="${bbResolvePlayerInit(p.name)}"
                       onchange="bbUpdatePlayerInit('${escapeHtml(p.name)}', this.value)">
            </div>
        `).join('');

    body.innerHTML = `
        <div class="bb-section">
            <div class="bb-row">
                <label>支線等級</label>
                <input type="number" class="bb-num" min="1" value="${bossBattleState.sideLevel}"
                       onchange="bbUpdate('sideLevel', this.value)">
                <span class="bb-x-value">修正值 ×${bossBattleState.sideLevel * 10}</span>
            </div>
            <div class="bb-row">
                <label>BOSS</label>
                <select class="bb-counter-select" style="flex:1;" onchange="bbUpdate('bossId', this.value)">${bossOptions}</select>
                <button class="bb-mini-btn" style="width:auto;padding:0 8px;" onclick="bbLoadActionsFromBoss()" title="從多重行動條目讀取先攻">🔄 讀取行動</button>
            </div>
            ${bossStatusHint}
            <div class="bb-row">
                <label>BOSS 攻DP修正</label>
                <input type="number" class="bb-num" value="${bossBattleState.bossAtkMod}"
                       onchange="bbUpdate('bossAtkMod', this.value)">
                <label>防禦修正</label>
                <input type="number" class="bb-num" value="${bossBattleState.bossDefMod}"
                       onchange="bbUpdate('bossDefMod', this.value)">
            </div>
        </div>

        <div class="bb-section">
            <div class="bb-section-title">BOSS 行動（先攻 / 基礎DP / 對抗者）</div>
            ${actionRows || '<div class="bb-hint">尚無行動——選擇 BOSS 後按「🔄 讀取行動」，或手動新增</div>'}
            <button class="skill-add-btn" style="margin-top:4px;padding:4px;" onclick="bbAddAction()">+ 新增行動</button>
        </div>

        <div class="bb-section">
            <div class="bb-section-title">玩家（數值來自備忘錄，先攻可覆寫）</div>
            ${playerRows}
        </div>

        <div class="bb-section">
            <div class="bb-section-title">📊 計算結果</div>
            <div id="bb-results"></div>
        </div>
    `;

    renderBossBattleResults();
}

/**
 * 依規則計算每個行動的 DP 修正並渲染結果
 */
function renderBossBattleResults() {
    const container = document.getElementById('bb-results');
    if (!container) return;

    const X = bossBattleState.sideLevel * 10;
    const actions = bossBattleState.actions || [];
    const players = bbGetMemoPlayers();

    if (actions.length === 0) {
        container.innerHTML = '<div class="bb-hint">填好行動與對抗分配後自動計算</div>';
        return;
    }

    // 每位玩家對抗的行動數
    const counterCount = {};
    actions.forEach(a => {
        if (a.counter) counterCount[a.counter] = (counterCount[a.counter] || 0) + 1;
    });

    let html = '';

    actions.forEach((a, i) => {
        if (!a.counter) {
            html += `<div class="bb-result-row bb-result-none">行動${i + 1}（先攻 ${a.init}）：無人對抗</div>`;
            return;
        }
        const pInit = bbResolvePlayerInit(a.counter);
        const initMod = a.init > pInit ? X : (a.init < pInit ? -X : 0);
        const extraMod = ((counterCount[a.counter] || 1) - 1) * X;
        const totalMod = initMod + extraMod + bossBattleState.bossAtkMod;

        const parts = [];
        if (initMod > 0) parts.push(`先攻較快 +${initMod}`);
        else if (initMod < 0) parts.push(`先攻較慢 ${initMod}`);
        else parts.push('先攻同值 ±0');
        if (extraMod > 0) parts.push(`複數對抗 +${extraMod}`);
        if (bossBattleState.bossAtkMod !== 0) {
            parts.push(`狀態修正 ${bossBattleState.bossAtkMod > 0 ? '+' : ''}${bossBattleState.bossAtkMod}`);
        }

        const memoP = players.find(p => p.name === a.counter);
        const defInfo = memoP ? `｜${escapeHtml(a.counter)} 防禦 ${memoP.def || 0}（附成+${memoP.defBonus || 0}）` : '';
        const finalDp = (a.baseDp || 0) > 0
            ? `<span class="bb-final-dp">最終DP ${a.baseDp + totalMod}</span>`
            : `<span class="bb-final-dp">DP修正 ${totalMod > 0 ? '+' : ''}${totalMod}</span>`;

        html += `
            <div class="bb-result-row">
                <div class="bb-result-head">行動${i + 1}（先攻 ${a.init}）→ ${escapeHtml(a.counter)}（先攻 ${pInit}）</div>
                <div class="bb-result-detail">${parts.join(' ＋ ').replace(/＋ -/g, '− ')} ＝ ${finalDp}${defInfo}</div>
            </div>
        `;
    });

    // 未對抗任何行動的玩家 → 自身 DP +X
    const idlePlayers = players.filter(p => !counterCount[p.name]);
    if (idlePlayers.length > 0) {
        html += idlePlayers.map(p =>
            `<div class="bb-result-row bb-result-bonus">🔸 ${escapeHtml(p.name)} 未對抗任何行動：本回合自身 DP +${X}（攻擊 DP ${ (p.dp || 0) + X }）</div>`
        ).join('');
    }

    // 玩家攻擊 BOSS 的提示
    if (bossBattleState.bossDefMod !== 0) {
        html += `<div class="bb-result-row bb-result-bonus">🛡 玩家攻擊 BOSS 時：BOSS 防禦修正 ${bossBattleState.bossDefMod > 0 ? '+' : ''}${bossBattleState.bossDefMod}</div>`;
    }

    container.innerHTML = html;
}

// ===== 右鍵棋子：單位 BOSS 戰鬥數值設定 =====
/**
 * 開啟某單位的 BOSS 戰鬥數值設定（ST 專用）。
 * 數值直接存在單位上（bossAtkMod / bossDefMod / sideLevel），並與黑箱計算連動：
 *   - 玩家攻擊此單位時，bossDefMod 併入該單位防禦總值
 *   - 此單位（BOSS/敵方）攻擊玩家時，bossAtkMod 併入攻擊總值
 * @param {string} unitId
 */
function openBossUnitModal(unitId) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以設定 BOSS 戰鬥數值');
        return;
    }
    const u = findUnitById(unitId);
    if (!u) return;

    const existing = document.getElementById('boss-unit-modal');
    if (existing) existing.remove();

    const html = `
        <div class="modal-overlay show" id="boss-unit-modal" onclick="if(event.target.id==='boss-unit-modal')closeBossUnitModal()">
            <div class="modal" style="max-width:400px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <span style="font-weight:bold;">👹 BOSS 戰鬥數值 - ${escapeHtml(u.name || '單位')}</span>
                    <button onclick="closeBossUnitModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>支線等級（修正基數 = 等級 × 10）</label>
                        <input type="number" id="boss-unit-side-level" value="${u.sideLevel || 1}" min="1" max="99">
                    </div>
                    <div class="form-group">
                        <label>攻擊 DP 修正（此單位攻擊玩家時，攻擊總值 +此值）</label>
                        <input type="number" id="boss-unit-atk-mod" value="${u.bossAtkMod || 0}">
                    </div>
                    <div class="form-group">
                        <label>防禦修正（玩家攻擊此單位時，防禦總值 +此值）</label>
                        <input type="number" id="boss-unit-def-mod" value="${u.bossDefMod || 0}">
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-dim);line-height:1.5;">
                        這些數值會在右鍵「發起攻擊／威脅」的黑箱判定時自動套用，無需另外開啟 BOSS 戰面板。
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeBossUnitModal()" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="saveBossUnitModal('${u.id}')" style="background:var(--accent-green);color:#000;">儲存</button>
                </div>
            </div>
        </div>
    `;
    const container = document.getElementById('modals-container') || document.body;
    container.insertAdjacentHTML('beforeend', html);
}

function closeBossUnitModal() {
    const modal = document.getElementById('boss-unit-modal');
    if (modal) modal.remove();
}

function saveBossUnitModal(unitId) {
    if (myRole !== 'st') return;
    const u = findUnitById(unitId);
    if (!u) return;
    u.sideLevel = Math.max(1, parseInt(document.getElementById('boss-unit-side-level')?.value) || 1);
    u.bossAtkMod = parseInt(document.getElementById('boss-unit-atk-mod')?.value) || 0;
    u.bossDefMod = parseInt(document.getElementById('boss-unit-def-mod')?.value) || 0;
    if (typeof broadcastState === 'function') broadcastState();
    closeBossUnitModal();
    if (typeof showToast === 'function') showToast(`已更新 ${u.name || '單位'} 的 BOSS 戰鬥數值`);
}

// ===== Window bindings =====
window.toggleBossBattleHUD = toggleBossBattleHUD;
window.showBossBattleHUD = showBossBattleHUD;
window.openBossUnitModal = openBossUnitModal;
window.closeBossUnitModal = closeBossUnitModal;
window.saveBossUnitModal = saveBossUnitModal;
window.closeBossBattleHUD = closeBossBattleHUD;
window.bbUpdate = bbUpdate;
window.bbUpdateAction = bbUpdateAction;
window.bbUpdatePlayerInit = bbUpdatePlayerInit;
window.bbAddAction = bbAddAction;
window.bbRemoveAction = bbRemoveAction;
window.bbLoadActionsFromBoss = bbLoadActionsFromBoss;

// ===== Init =====
loadBossBattleSettings();
// 不自動開啟（需要 myRole 已就緒），由 QAB 選單觸發

console.log('👹 特殊BOSS戰計算面板已載入');

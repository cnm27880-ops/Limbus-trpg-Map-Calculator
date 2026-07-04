/**
 * Limbus Command - AOE 群體選取模式（長按 T）
 *
 * 取代舊「多重行動設定」面板中的 AOE 結算按鈕，將群體操作邏輯轉移到全新的「選取模式」：
 *   1. 長按 T 鍵進入選取模式（body.aoe-select-active + 提示橫幅）。
 *   2. 點擊地圖 Token 切換紅色光暈選取（.selected-aoe），再次點擊移除。
 *   3. 鬆開 T 鍵後，若清單有單位，彈出操作視窗：
 *        - 玩家：手動輸入數值 / 治療 / 狀態。
 *        - ST（BOSS）：自動讀取作用中 BOSS 多重行動面板裡 actionAoe:true 的行動資料。
 *   4. 結算傷害／治療／狀態時，透過 log-view.js 寫入戰鬥日誌，紀錄所有被選取單位名稱。
 *
 * 核心結算沿用 state.js 的 applyBatchAction / undoLastBatch，不重複實作傷害模型。
 * 防禦性：所有 DOM / 鍵盤 / 結算操作皆以 typeof 與 try-catch 防呆，絕不影響地圖與單位同步。
 */

// 長按判定門檻（毫秒）：短於此值視為誤觸，不進入選取模式
const AOE_LONGPRESS_MS = 250;

let aoeSelectMode = false;
let aoeKeyHeld = false;
let aoeLongPressTimer = null;
const aoeSelectedIds = new Set();

/** 供 map.js 判斷目前是否處於選取模式（攔截 Token 點擊） */
function aoeIsSelecting() {
    return aoeSelectMode;
}

function aoeIsTypingTarget(el) {
    return el && (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
    );
}

// ===== 長按 T 鍵：進入 / 結算 =====

function aoeOnKeyDown(e) {
    if (e.key !== 't' && e.key !== 'T') return;
    if (e.repeat) return; // 忽略按住時的自動重複
    // 群體操作為 ST 限定工具：玩家端結算無法透過 sendState 同步（會造成本地改動後消失），
    // 因此只允許 ST 進入選取模式，與舊版 AOE（ST 限定多重行動面板）行為一致。
    if (typeof myRole !== 'undefined' && myRole !== 'st') return;
    if (aoeIsTypingTarget(document.activeElement)) return;
    // 有其他 Modal 開啟時不啟動（避免與審核／攻擊／設定視窗衝突）
    if (document.querySelector('.modal-overlay.show')) return;
    if (aoeKeyHeld) return;

    aoeKeyHeld = true;
    clearTimeout(aoeLongPressTimer);
    aoeLongPressTimer = setTimeout(aoeEnterSelectMode, AOE_LONGPRESS_MS);
}

function aoeOnKeyUp(e) {
    if (e.key !== 't' && e.key !== 'T') return;
    aoeKeyHeld = false;
    clearTimeout(aoeLongPressTimer);

    if (!aoeSelectMode) return; // 還沒達到長按門檻就鬆開：視為誤觸
    aoeExitSelectMode();

    if (aoeSelectedIds.size > 0) {
        aoeOpenOperationModal();
    } else if (typeof showToast === 'function') {
        showToast('未選取任何單位，已退出群體選取');
    }
}

function aoeEnterSelectMode() {
    aoeSelectMode = true;
    aoeSelectedIds.clear();
    document.body.classList.add('aoe-select-active');
    aoeRefreshTokenHighlights();
    aoeShowHint();
}

function aoeExitSelectMode() {
    aoeSelectMode = false;
    document.body.classList.remove('aoe-select-active');
    aoeHideHint();
    // 視覺光暈在開啟操作視窗前先清除（選取清單 aoeSelectedIds 仍保留供結算使用）
    document.querySelectorAll('.token.selected-aoe').forEach(t => t.classList.remove('selected-aoe'));
}

// ===== 提示橫幅 =====

function aoeShowHint() {
    let hint = document.getElementById('aoe-select-hint');
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'aoe-select-hint';
        hint.className = 'aoe-select-hint';
        document.body.appendChild(hint);
    }
    aoeUpdateHint();
    hint.classList.add('show');
}

function aoeUpdateHint() {
    const hint = document.getElementById('aoe-select-hint');
    if (!hint) return;
    hint.textContent = `💥 群體選取模式：點擊棋子加入／移除（已選 ${aoeSelectedIds.size} 個）｜鬆開 T 結算`;
}

function aoeHideHint() {
    const hint = document.getElementById('aoe-select-hint');
    if (hint) hint.classList.remove('show');
}

// ===== Token 點擊（由 map.js 的 token onpointerup 攔截呼叫） =====

function aoeToggleUnit(unitId) {
    if (!aoeSelectMode || !unitId) return false;
    if (aoeSelectedIds.has(unitId)) aoeSelectedIds.delete(unitId);
    else aoeSelectedIds.add(unitId);
    aoeRefreshTokenHighlights();
    aoeUpdateHint();
    return true;
}

/** 依目前選取集合，同步所有 Token 的紅色光暈 class */
function aoeRefreshTokenHighlights() {
    document.querySelectorAll('.token').forEach(t => {
        const id = t.dataset.unitId;
        t.classList.toggle('selected-aoe', !!id && aoeSelectedIds.has(id));
    });
}

// ===== 結算操作視窗 =====

/** 取得目前選取且仍存在的單位物件（排除多重行動條目） */
function aoeResolveSelectedUnits() {
    const units = [];
    aoeSelectedIds.forEach(id => {
        const u = (typeof findUnitById === 'function') ? findUnitById(id) : null;
        if (u && !u.actionSlotOf) units.push(u);
    });
    return units;
}

/** 解析攻擊者名稱：ST 取作用中 BOSS 名稱，玩家取自己控制的單位名稱 */
function aoeResolveAttackerName() {
    if (typeof myRole !== 'undefined' && myRole === 'st') {
        const boss = (typeof state !== 'undefined' && state.activeBossId && typeof findUnitById === 'function')
            ? findUnitById(state.activeBossId) : null;
        if (boss && boss.name) return boss.name;
        return 'BOSS';
    }
    if (typeof state !== 'undefined' && Array.isArray(state.units) && typeof myPlayerId !== 'undefined') {
        const mine = state.units.find(u => u.ownerId === myPlayerId);
        if (mine && mine.name) return mine.name;
    }
    return (typeof myName !== 'undefined' && myName) ? myName : '攻擊者';
}

/**
 * 取得作用中 BOSS 標記為 actionAoe:true 的行動資料（本體 + 多重行動條目）。
 * @returns {Array<{label:string, dp:number, statuses:Array}>}
 */
function aoeGetBossAoeActions() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return [];
    if (typeof state === 'undefined' || !state.activeBossId || typeof findUnitById !== 'function') return [];
    const boss = findUnitById(state.activeBossId);
    if (!boss) return [];

    const all = [boss];
    if (typeof getActionSlots === 'function') all.push(...getActionSlots(boss.id));

    return all
        .map((u, i) => ({
            label: `行動${i + 1}${i === 0 ? '·本體' : ''}`,
            dp: u.actionDp || 0,
            statuses: Array.isArray(u.actionStatuses) ? u.actionStatuses.map(s => ({ ...s })) : [],
            aoe: !!u.actionAoe
        }))
        .filter(a => a.aoe);
}

function aoeCloseOperationModal() {
    const modal = document.getElementById('aoe-op-modal');
    if (modal) modal.remove();
    aoeSelectedIds.clear();
    aoeRefreshTokenHighlights();
}

function aoeOpenOperationModal() {
    // 移除任何殘留的舊視窗（例如先前被 Esc 隱藏但未銷毀的節點），避免重複 id
    const stale = document.getElementById('aoe-op-modal');
    if (stale) stale.remove();

    const units = aoeResolveSelectedUnits();
    if (!units.length) {
        if (typeof showToast === 'function') showToast('選取的單位已不存在');
        aoeSelectedIds.clear();
        return;
    }

    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
    const isST = (typeof myRole !== 'undefined' && myRole === 'st');
    const attackerName = aoeResolveAttackerName();

    // 被選取單位名稱卡片
    const targetChips = units.map(u => `<span class="aoe-target-chip">${esc(u.name || '未命名')}</span>`).join('');

    // ST：作用中 BOSS 的 AOE 行動快選（自動帶入 DP / 狀態）
    const bossActions = isST ? aoeGetBossAoeActions() : [];
    let bossActionsHtml = '';
    if (isST && bossActions.length) {
        const btns = bossActions.map((a, i) => {
            const stTxt = a.statuses.length
                ? a.statuses.map(s => {
                    const nm = (typeof getStatusDisplayName === 'function') ? getStatusDisplayName(s.id) : s.id;
                    return esc(nm) + (s.stacks > 0 ? ' x' + s.stacks : '');
                }).join('、')
                : '無狀態';
            return `<button type="button" class="aoe-boss-action-btn" onclick="aoeFillFromBossAction(${i})">${esc(a.label)}<small>DP ${a.dp}｜${stTxt}</small></button>`;
        }).join('');
        bossActionsHtml = `
            <div class="identity-card aoe-boss-actions">
                <div class="identity-card-title">⚔ ${esc(attackerName)} 的 AOE 行動（點選自動帶入）</div>
                <div class="aoe-boss-action-btns">${btns}</div>
            </div>`;
    } else if (isST) {
        bossActionsHtml = `<div class="bb-hint">作用中 BOSS 沒有標記為 AOE 的行動，請於「多重行動設定」勾選 AOE，或在下方手動輸入。</div>`;
    }

    const html = `
        <div class="modal-overlay show" id="aoe-op-modal" onclick="if(event.target.id==='aoe-op-modal')aoeCloseOperationModal()">
            <div class="modal" style="max-width:440px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <span style="font-weight:bold;">💥 群體操作 (AOE)</span>
                    <button onclick="aoeCloseOperationModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div class="identity-card aoe-targets-card">
                        <div class="identity-card-title">🎯 選取目標（${units.length}）</div>
                        <div class="aoe-target-chips">${targetChips}</div>
                    </div>

                    ${bossActionsHtml}

                    <!-- 攻擊動作：傷害 / 治療 -->
                    <div class="identity-card aoe-action-card aoe-action-attack">
                        <div class="identity-card-title">攻擊動作</div>
                        <div class="aoe-field-row">
                            <label class="aoe-field-label">結算</label>
                            <select id="aoe-resolve-mode" onchange="aoeOnModeChange()" title="直接傷害：數值照扣。豁免抵擋：各目標自動擲豁免骰，傷害 = 攻擊成功數 − 豁免成功數">
                                <option value="direct">直接傷害</option>
                                <option value="save">豁免抵擋</option>
                            </select>
                            <select id="aoe-save-type" style="display:none;" title="目標用哪一項豁免抵擋">
                                <option value="saveReflex">反射豁免</option>
                                <option value="saveWill">意志豁免</option>
                                <option value="saveTenacity">強韌豁免</option>
                            </select>
                        </div>
                        <div class="aoe-field-row">
                            <label class="aoe-field-label" id="aoe-value-label">數值</label>
                            <input type="number" id="aoe-value-input" value="1" min="1">
                            <select id="aoe-dmg-type" title="傷害類型">
                                <option value="b">B 傷</option>
                                <option value="l" selected>L 傷</option>
                                <option value="a">A 傷</option>
                            </select>
                        </div>
                        <label class="aoe-autoroll-row" id="aoe-autoroll-row" style="display:none;font-size:0.78rem;color:var(--text-dim);cursor:pointer;"
                               title="開啟：把「數值」視為攻擊骰數（DP），系統自動擲骰得出成功數。關閉：把「數值」視為已擲出的攻擊成功數直接使用。">
                            <input type="checkbox" id="aoe-atk-autoroll" checked> 🎲 數值為攻擊骰數（DP），自動擲骰
                        </label>
                        <div class="aoe-btn-row">
                            <button class="identity-btn identity-btn-danger" onclick="aoeExecute('damage')">💥 群體傷害</button>
                            <button class="identity-btn identity-btn-heal" onclick="aoeExecute('heal')">💚 群體治療</button>
                        </div>
                    </div>

                    <!-- 資源狀態：套用狀態 -->
                    <div class="identity-card aoe-action-card aoe-action-status">
                        <div class="identity-card-title">資源 / 狀態</div>
                        <div class="aoe-field-row">
                            <input type="text" id="aoe-status-id" list="aoe-status-options" placeholder="狀態名稱（例：流血）">
                            <input type="number" id="aoe-status-val" value="1" title="層數（負數可減層）" style="max-width:72px;">
                        </div>
                        <div class="aoe-btn-row">
                            <button class="identity-btn" onclick="aoeExecute('status')">套用狀態</button>
                            <button class="identity-btn identity-btn-muted" onclick="aoeUndo()">↶ 復原上一步</button>
                        </div>
                    </div>
                    <datalist id="aoe-status-options"></datalist>
                </div>
            </div>
        </div>`;

    const container = document.getElementById('modals-container') || document.body;
    container.insertAdjacentHTML('beforeend', html);
    aoeBuildStatusDatalist();

    // ST：預設帶入第一個 BOSS AOE 行動的數值
    if (isST && bossActions.length) aoeFillFromBossAction(0);
}

/** 結算模式切換：豁免抵擋模式時顯示豁免類型與自動擲骰選項，並調整數值欄說明 */
function aoeOnModeChange() {
    const mode = document.getElementById('aoe-resolve-mode')?.value || 'direct';
    const isSave = mode === 'save';
    const saveSel = document.getElementById('aoe-save-type');
    const rollRow = document.getElementById('aoe-autoroll-row');
    const valLabel = document.getElementById('aoe-value-label');
    if (saveSel) saveSel.style.display = isSave ? '' : 'none';
    if (rollRow) rollRow.style.display = isSave ? '' : 'none';
    if (valLabel) valLabel.textContent = isSave ? '攻擊值' : '數值';
}

/** 把第 index 個 BOSS AOE 行動的 DP / 狀態帶入操作視窗 */
function aoeFillFromBossAction(index) {
    const actions = aoeGetBossAoeActions();
    const a = actions[index];
    if (!a) return;
    const valInput = document.getElementById('aoe-value-input');
    if (valInput) valInput.value = a.dp || 0;
    if (a.statuses.length) {
        const s = a.statuses[0];
        const nameInput = document.getElementById('aoe-status-id');
        const stackInput = document.getElementById('aoe-status-val');
        if (nameInput) nameInput.value = (typeof getStatusDisplayName === 'function') ? getStatusDisplayName(s.id) : s.id;
        if (stackInput) stackInput.value = s.stacks || 1;
    }
    if (typeof showToast === 'function') showToast(`已帶入 ${a.label} 數值，確認後即可結算`);
}

/** 建立狀態名稱自動補全清單（預設庫 + 自訂狀態） */
function aoeBuildStatusDatalist() {
    const dl = document.getElementById('aoe-status-options');
    if (!dl) return;
    const names = [];
    if (typeof getAllStatuses === 'function') getAllStatuses().forEach(s => names.push(s.name));
    if (typeof state !== 'undefined' && Array.isArray(state.customStatuses)) {
        state.customStatuses.forEach(s => { if (s && s.name) names.push(s.name); });
    }
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
    dl.innerHTML = [...new Set(names)].map(n => `<option value="${esc(n)}"></option>`).join('');
}

/**
 * 結算群體操作：套用傷害／治療／狀態並寫入戰鬥日誌。
 * @param {'damage'|'heal'|'status'} type
 */
function aoeExecute(type) {
    const units = aoeResolveSelectedUnits();
    if (!units.length) {
        if (typeof showToast === 'function') showToast('選取的單位已不存在');
        return;
    }
    const unitIds = units.map(u => u.id);
    const targetNames = units.map(u => u.name || '未命名');
    const attackerName = aoeResolveAttackerName();

    const actionData = { type };

    if (type === 'damage' || type === 'heal') {
        const val = parseInt(document.getElementById('aoe-value-input')?.value, 10);
        if (isNaN(val) || val <= 0) {
            if (typeof showToast === 'function') showToast('請輸入有效數值');
            return;
        }
        // 豁免抵擋模式：各目標自動擲豁免骰，傷害 = 攻擊成功數 − 豁免成功數（逐目標不同）
        if (type === 'damage' && (document.getElementById('aoe-resolve-mode')?.value === 'save')) {
            aoeExecuteSaveMode(units, val, document.getElementById('aoe-dmg-type')?.value || 'l', attackerName);
            return;
        }
        actionData.value = val;
        if (type === 'damage') actionData.dmgType = document.getElementById('aoe-dmg-type')?.value || 'l';
    } else if (type === 'status') {
        const statusId = (document.getElementById('aoe-status-id')?.value || '').trim();
        if (!statusId) {
            if (typeof showToast === 'function') showToast('請輸入狀態名稱');
            return;
        }
        actionData.statusId = statusId;
        actionData.value = parseInt(document.getElementById('aoe-status-val')?.value, 10) || 0;
    }

    if (typeof applyBatchAction !== 'function') {
        if (typeof showToast === 'function') showToast('結算引擎未就緒');
        return;
    }
    applyBatchAction(unitIds, actionData);

    // 寫入戰鬥日誌（log-view.js）：紀錄攻擊者與所有被選取單位名稱
    if (typeof logAoeAction === 'function') {
        logAoeAction(attackerName, targetNames, actionData);
    }

    if (typeof showToast === 'function') {
        if (type === 'damage') {
            const typeLabel = { b: 'B', l: 'L', a: 'A' }[actionData.dmgType] || '';
            showToast(`對 ${unitIds.length} 個目標造成 ${actionData.value} 點 ${typeLabel} 傷`);
        } else if (type === 'heal') {
            showToast(`為 ${unitIds.length} 個目標治療 ${actionData.value} 點`);
        } else {
            showToast(`對 ${unitIds.length} 個目標套用狀態 ${actionData.statusId}`);
        }
    }

    if (typeof renderMap === 'function') renderMap();
    if (typeof renderAll === 'function') renderAll();

    aoeCloseOperationModal();
}

// ===== 豁免抵擋模式（BOSS AOE vs 玩家三豁免）=====
/**
 * 豁免抵擋結算：
 *   1. 取得攻擊成功數——自動擲骰開啟時把「攻擊值」當骰數（DP）擲 D10 骰池（8+ 成功，10 加骰）；
 *      關閉時把「攻擊值」直接視為已擲出的成功數。
 *   2. 每個目標以其三豁免其中一項（右鍵「角色數值」填寫）為骰數自動擲豁免。
 *   3. 傷害 = max(0, 攻擊成功數 − 豁免成功數)，逐目標套用（會先消耗護盾）。
 * 結算後彈出逐目標結果清單，並寫入戰鬥日誌。
 * @param {Array} units - 目標單位
 * @param {number} atkValue - 攻擊值（骰數或成功數，依自動擲骰開關）
 * @param {string} dmgType - 'b' | 'l' | 'a'
 * @param {string} attackerName - 攻擊者名稱（日誌用）
 */
function aoeExecuteSaveMode(units, atkValue, dmgType, attackerName) {
    if (typeof bbRollAttackDice !== 'function' || typeof modifyHPInternal !== 'function') {
        if (typeof showToast === 'function') showToast('結算引擎未就緒');
        return;
    }
    const saveKey = document.getElementById('aoe-save-type')?.value || 'saveReflex';
    const saveNames = { saveWill: '意志', saveReflex: '反射', saveTenacity: '強韌' };
    const saveName = saveNames[saveKey] || '豁免';
    const autoRoll = document.getElementById('aoe-atk-autoroll')?.checked !== false;

    // 攻擊成功數
    let atkSuccess, atkDetail;
    if (autoRoll) {
        const r = bbRollAttackDice(atkValue, 10);
        atkSuccess = r.successes;
        atkDetail = `擲 ${atkValue} 顆 → ${r.successes} 成功${r.explodedCount ? `（加骰 ${r.explodedCount}）` : ''}`;
    } else {
        atkSuccess = Math.max(0, atkValue);
        atkDetail = `${atkSuccess} 成功（手動輸入）`;
    }

    // 逐目標擲豁免並套用傷害（modifyHPInternal 會先消耗護盾再扣血）
    const typeLabel = { b: 'B', l: 'L', a: 'A' }[dmgType] || '';
    const results = units.map(u => {
        const pool = Math.max(0, parseInt(u[saveKey]) || 0);
        const r = bbRollAttackDice(pool, 10);
        const dmg = Math.max(0, atkSuccess - r.successes);
        if (dmg > 0) modifyHPInternal(u, dmgType, dmg);
        return { name: u.name || '未命名', pool, save: r.successes, dmg };
    });

    if (typeof broadcastState === 'function') broadcastState();

    // 戰鬥日誌
    if (typeof bbPushCombatLog === 'function') {
        const detail = results.map(r => `${r.name} 豁免${r.save} 受${r.dmg}`).join('、');
        bbPushCombatLog({
            entryType: 'aoe',
            attackerName: attackerName || 'BOSS',
            attackerRole: 'enemy',
            defenderName: results.map(r => r.name).join(', '),
            broadcastText: `【${attackerName || 'BOSS'}】發動 AOE（${saveName}豁免抵擋，攻擊 ${atkSuccess} 成功）：${detail}`,
            round: (typeof state !== 'undefined' && state.roundNum) || 0
        });
    }

    // 逐目標結果清單（取代原操作視窗）
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
    const rows = results.map(r => `
        <div class="aoe-save-result-row${r.dmg > 0 ? ' hit' : ' resisted'}">
            <span class="asr-name">${esc(r.name)}</span>
            <span class="asr-roll">${saveName} ${r.pool} 顆 → ${r.save} 成功</span>
            <span class="asr-dmg">${r.dmg > 0 ? `受 ${r.dmg} ${typeLabel}傷` : '完全抵擋'}</span>
        </div>`).join('');
    aoeCloseOperationModal();
    const html = `
        <div class="modal-overlay show" id="aoe-save-results" onclick="if(event.target.id==='aoe-save-results')document.getElementById('aoe-save-results').remove()">
            <div class="modal" style="max-width:420px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <span style="font-weight:bold;">🎲 豁免抵擋結果</span>
                    <button onclick="document.getElementById('aoe-save-results').remove()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div style="font-size:0.85rem;color:var(--accent-orange);margin-bottom:4px;">⚔ 攻擊：${esc(atkDetail)}</div>
                    ${rows}
                    <div style="font-size:0.72rem;color:var(--text-dim);margin-top:6px;">傷害已套用（護盾優先消耗）。豁免骰數在棋子右鍵「📊 角色數值」填寫。</div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="document.getElementById('aoe-save-results').remove()" style="background:var(--accent-green);color:#000;">確認</button>
                </div>
            </div>
        </div>`;
    (document.getElementById('modals-container') || document.body).insertAdjacentHTML('beforeend', html);

    if (typeof renderAll === 'function') renderAll();
}

function aoeUndo() {
    if (typeof undoLastBatch === 'function') {
        undoLastBatch();
        if (typeof showToast === 'function') showToast('已復原上一步群體操作');
        if (typeof renderAll === 'function') renderAll();
    }
}

// ===== 初始化 =====

/** 取消選取模式（不結算）：供視窗失焦等異常情境清理，避免卡在選取狀態 */
function aoeCancelSelectMode() {
    aoeKeyHeld = false;
    clearTimeout(aoeLongPressTimer);
    if (aoeSelectMode) {
        aoeExitSelectMode();
        aoeSelectedIds.clear();
    }
}

function initAoeSelect() {
    document.addEventListener('keydown', aoeOnKeyDown);
    document.addEventListener('keyup', aoeOnKeyUp);
    // 視窗失焦時保險：若 T 在按住中（keyup 可能不會送達），取消選取模式，
    // 避免長按計時器或選取狀態卡死。
    window.addEventListener('blur', aoeCancelSelectMode);
    console.log('💥 AOE 群體選取模式（長按 T）已初始化');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAoeSelect);
} else {
    initAoeSelect();
}

// ===== Window bindings =====
if (typeof window !== 'undefined') {
    window.aoeIsSelecting = aoeIsSelecting;
    window.aoeToggleUnit = aoeToggleUnit;
    window.aoeOpenOperationModal = aoeOpenOperationModal;
    window.aoeCloseOperationModal = aoeCloseOperationModal;
    window.aoeExecute = aoeExecute;
    window.aoeUndo = aoeUndo;
    window.aoeFillFromBossAction = aoeFillFromBossAction;
    window.aoeOnModeChange = aoeOnModeChange;
    window.aoeExecuteSaveMode = aoeExecuteSaveMode;
}

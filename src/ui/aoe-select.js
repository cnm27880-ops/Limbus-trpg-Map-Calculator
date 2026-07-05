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
        // 優先取 👑 標記的BOSS，沒有的話找第一個本體BOSS
        let boss = (state.activeBossId && typeof findUnitById === 'function') ? findUnitById(state.activeBossId) : null;
        if (!boss) {
            const allUnits = typeof state !== 'undefined' ? state.units : [];
            boss = allUnits.find(u => (u.type === 'boss' || u.isBoss) && !u.actionSlotOf);
        }
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
 * @returns {Array<{label:string, dp:number, statuses:Array, saveType:string}>}
 */
function aoeGetBossAoeActions() {
    if (typeof myRole === 'undefined' || myRole !== 'st') return [];
    if (typeof state === 'undefined' || typeof findUnitById !== 'function') return [];

    // 優先取「作用中的BOSS」（👑按鈕設定的），沒設的話找第一個有行動的本體BOSS
    let boss = state.activeBossId ? findUnitById(state.activeBossId) : null;
    if (!boss) {
        // 找不到時：找任何「本體BOSS」（有行動設定但不是行動條目）
        const allUnits = typeof state !== 'undefined' ? state.units : [];
        boss = allUnits.find(u => (u.type === 'boss' || u.isBoss) && !u.actionSlotOf && (!!u.actionAoe || (typeof getActionSlots === 'function' && getActionSlots(u.id).some(s => !!s.actionAoe))));
    }
    if (!boss) return [];

    const all = [boss];
    if (typeof getActionSlots === 'function') all.push(...getActionSlots(boss.id));

    const validateSaveType = t => (['saveWill', 'saveReflex', 'saveTenacity'].includes(t)) ? t : 'saveReflex';

    return all
        .map((u, i) => ({
            label: `行動${i + 1}${i === 0 ? '·本體' : ''}`,
            dp: u.actionDp || 0,
            statuses: Array.isArray(u.actionStatuses) ? u.actionStatuses.map(s => ({ ...s })) : [],
            aoe: !!u.actionAoe,
            saveType: validateSaveType(u.actionSaveType)
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
    const saveNames = { saveWill: '意志', saveReflex: '反射', saveTenacity: '強韌' };
    const saveOrder = ['saveReflex', 'saveWill', 'saveTenacity'];  // 豁免下拉預設順序

    // 被選取單位名稱卡片
    const targetChips = units.map(u => `<span class="aoe-target-chip">${esc(u.name || '未命名')}</span>`).join('');

    // ST：作用中 BOSS 的 AOE 行動快選（自動帶入 DP / 預設豁免 / 狀態）
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
            const saveTxt = `｜預設${saveNames[a.saveType] || '反射'}豁免`;
            return `<button type="button" class="aoe-boss-action-btn" onclick="aoeFillFromBossAction(${i})">${esc(a.label)}<small>DP ${a.dp}${saveTxt}｜${stTxt}</small></button>`;
        }).join('');
        bossActionsHtml = `
            <div class="identity-card aoe-boss-actions">
                <div class="identity-card-title">⚔ ${esc(attackerName)} 的 AOE 行動（點選自動帶入）</div>
                <div class="aoe-boss-action-btns">${btns}</div>
            </div>`;
    } else if (isST) {
        bossActionsHtml = `<div class="bb-hint">作用中 BOSS 沒有標記為 AOE 的行動，請於「多重行動設定」勾選 AOE，或在下方手動輸入。</div>`;
    }

    // 直接產生每個目標的「豁免類型」下拉列：預設 = 動作指定的豁免，ST 可逐個覆寫
    const saveTypeRowsHtml = units.map((u) => {
        const opts = saveOrder.map(k =>
            `<option value="${k}">${saveNames[k]} (${parseInt(u[k]) || 0})</option>`
        ).join('');
        const vals = saveOrder.map(k =>
            `${saveNames[k]} <b>${parseInt(u[k]) || 0}</b>`
        ).join(' / ');
        return `
            <div class="aoe-save-row" data-unit-id="${esc(u.id)}">
                <span class="aoe-save-name">${esc(u.name || '未命名')}</span>
                <select class="aoe-target-save" id="aoe-target-save-${esc(u.id)}" title="此目標要用哪一項豁免">${opts}</select>
                <span class="aoe-save-vals">${vals}</span>
            </div>`;
    }).join('');

    const html = `
        <div class="modal-overlay show" id="aoe-op-modal" onclick="if(event.target.id==='aoe-op-modal')aoeCloseOperationModal()">
            <div class="modal" style="max-width:480px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <span style="font-weight:bold;">💥 群體操作 (AOE)</span>
                    <button onclick="aoeCloseOperationModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <!-- 1) 選取目標 -->
                    <div class="identity-card aoe-targets-card">
                        <div class="identity-card-title">🎯 選取目標（${units.length}）</div>
                        <div class="aoe-target-chips">${targetChips}</div>
                    </div>

                    <!-- 2) BOSS 動作快選（僅 ST） -->
                    ${bossActionsHtml}

                    <!-- 3) 結算方式（單選：決定下方顯示的區塊） -->
                    <div class="identity-card aoe-action-card aoe-action-mode">
                        <div class="identity-card-title">⚙ 結算方式</div>
                        <div class="aoe-mode-tabs" role="tablist">
                            <button type="button" class="aoe-mode-tab active" data-mode="direct" onclick="aoeOnModeChange('direct')">⚔ 直接傷害</button>
                            <button type="button" class="aoe-mode-tab" data-mode="save" onclick="aoeOnModeChange('save')">🛡 豁免抵擋</button>
                            <button type="button" class="aoe-mode-tab" data-mode="heal" onclick="aoeOnModeChange('heal')">💚 群體治療</button>
                            <button type="button" class="aoe-mode-tab" data-mode="status" onclick="aoeOnModeChange('status')">🏷 附加狀態</button>
                        </div>
                        <input type="hidden" id="aoe-resolve-mode" value="direct">
                    </div>

                    <!-- 4) 直接傷害區塊 -->
                    <div class="identity-card aoe-action-card aoe-action-section aoe-section-direct">
                        <div class="identity-card-title">⚔ 直接傷害</div>
                        <div class="aoe-field-row">
                            <label class="aoe-field-label">攻擊值</label>
                            <input type="number" id="aoe-value-input" value="5" min="0">
                            <select id="aoe-dmg-type" title="傷害類型">
                                <option value="b">B 傷</option>
                                <option value="l" selected>L 傷</option>
                                <option value="a">A 傷</option>
                            </select>
                        </div>
                        <label class="aoe-autoroll-row" title="把「攻擊值」視為攻擊骰數（DP）自動擲骰；若關閉則視為已擲成功數。">
                            <input type="checkbox" id="aoe-atk-autoroll" checked> 🎲 數值為攻擊骰數（DP），自動擲骰
                        </label>
                    </div>

                    <!-- 5) 豁免抵擋區塊（每位目標可獨立指定豁免類型） -->
                    <div class="identity-card aoe-action-card aoe-action-section aoe-section-save" style="display:none;">
                        <div class="identity-card-title">🛡 豁免抵擋</div>
                        <div class="aoe-field-row">
                            <label class="aoe-field-label">攻擊 DP</label>
                            <input type="number" id="aoe-save-atk-dp" value="5" min="0">
                            <label class="aoe-autoroll-row" title="勾選：把攻擊 DP 自動擲骰；取消：視為已擲成功數" style="margin-left:auto;">
                                <input type="checkbox" id="aoe-save-atk-autoroll" checked> 🎲 自動擲骰
                            </label>
                        </div>
                        <div style="font-size:0.78rem;color:var(--text-dim);margin:4px 0 6px;">每位目標各自的豁免（ST 可逐個覆寫預設的豁免類型；該玩家需先在右鍵「📊 角色數值」填寫三豁免）</div>
                        <div class="aoe-target-save-list" id="aoe-target-save-list">${saveTypeRowsHtml}</div>
                        <div class="aoe-field-row" style="margin-top:8px;">
                            <label class="aoe-field-label">傷種</label>
                            <select id="aoe-save-dmg-type">
                                <option value="b">B 傷</option>
                                <option value="l" selected>L 傷</option>
                                <option value="a">A 傷</option>
                            </select>
                        </div>
                        <label class="aoe-autoroll-row" title="勾選：對命中目標套用動作指定的狀態（流血/燃燒 等）；取消：僅結算傷害。">
                            <input type="checkbox" id="aoe-save-apply-status" checked> 🩹 命中施加動作附加狀態（流血/燃燒 等）
                        </label>
                    </div>

                    <!-- 6) 群體治療區塊 -->
                    <div class="identity-card aoe-action-card aoe-action-section aoe-section-heal" style="display:none;">
                        <div class="identity-card-title">💚 群體治療</div>
                        <div class="aoe-field-row">
                            <label class="aoe-field-label">治療值</label>
                            <input type="number" id="aoe-heal-value" value="3" min="0">
                        </div>
                    </div>

                    <!-- 7) 附加狀態區塊 -->
                    <div class="identity-card aoe-action-card aoe-action-section aoe-section-status" style="display:none;">
                        <div class="identity-card-title">🏷 附加狀態</div>
                        <div class="aoe-field-row">
                            <label class="aoe-field-label">狀態名稱</label>
                            <input type="text" id="aoe-status-id" list="aoe-status-options" placeholder="例：流血">
                            <input type="number" id="aoe-status-val" value="1" title="層數（負數可減層）" style="max-width:72px;">
                        </div>
                        <div id="aoe-status-chosen" style="margin-top:6px;font-size:0.78rem;color:var(--text-dim);"></div>
                    </div>
                    <datalist id="aoe-status-options"></datalist>

                    <!-- 8) 執行 -->
                    <div class="aoe-btn-row" style="margin-top:10px;display:flex;gap:8px;">
                        <button class="identity-btn identity-btn-primary" style="flex:1;background:var(--accent-green);color:#000;" onclick="aoeExecute()">🎲 結算</button>
                        <button class="identity-btn identity-btn-muted" onclick="aoeUndo()">↶ 復原</button>
                        <button class="identity-btn identity-btn-muted" onclick="aoeCloseOperationModal()">✕ 取消</button>
                    </div>
                </div>
            </div>
        </div>`;

    const container = document.getElementById('modals-container') || document.body;
    container.insertAdjacentHTML('beforeend', html);
    aoeBuildStatusDatalist();

    // ST：預設帶入第一個 BOSS AOE 行動的數值（DP、預設豁免類型、狀態）
    if (isST && bossActions.length) aoeFillFromBossAction(0);
}

/**
 * 結算方式切換：顯示對應區塊，更新隱藏欄位，刷新分頁樣式。
 * @param {'direct'|'save'|'heal'|'status'} mode
 */
function aoeOnModeChange(mode) {
    if (!mode) {
        mode = document.getElementById('aoe-resolve-mode')?.value || 'direct';
    }
    const hidden = document.getElementById('aoe-resolve-mode');
    if (hidden) hidden.value = mode;

    document.querySelectorAll('#aoe-op-modal .aoe-mode-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    document.querySelectorAll('#aoe-op-modal .aoe-action-section').forEach(sec => {
        sec.style.display = 'none';
    });
    const targetSection = document.querySelector(`#aoe-op-modal .aoe-section-${mode}`);
    if (targetSection) targetSection.style.display = '';
}

/**
 * 把第 index 個 BOSS AOE 行動的 DP / 預設豁免 / 狀態帶入操作視窗。
 * 並把每位目標的「豁免類型」下拉預設為該行動指定的豁免。
 * @param {number} index
 */
function aoeFillFromBossAction(index) {
    const actions = aoeGetBossAoeActions();
    const a = actions[index];
    if (!a) return;
    const saveNames = { saveWill: '意志', saveReflex: '反射', saveTenacity: '強韌' };
    const directValInput = document.getElementById('aoe-value-input');
    const saveDpInput = document.getElementById('aoe-save-atk-dp');
    if (directValInput) directValInput.value = a.dp || 0;
    if (saveDpInput) saveDpInput.value = a.dp || 0;

    // 把動作預設豁免類型套到每位目標的下拉選單
    const desired = a.saveType || 'saveReflex';
    document.querySelectorAll('#aoe-op-modal .aoe-target-save').forEach(sel => {
        sel.value = desired;
    });

    // 套用動作附帶的狀態到「附加狀態」模式的第一個狀態欄
    const statusNameInput = document.getElementById('aoe-status-id');
    const statusValInput = document.getElementById('aoe-status-val');
    const statusChosenBox = document.getElementById('aoe-status-chosen');
    const escFn = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
    if (a.statuses.length) {
        const s = a.statuses[0];
        const dispName = (typeof getStatusDisplayName === 'function') ? getStatusDisplayName(s.id) : s.id;
        if (statusNameInput) statusNameInput.value = dispName;
        if (statusValInput) statusValInput.value = s.stacks || 1;
        if (statusChosenBox) {
            const list = a.statuses.map(s => {
                const nm = (typeof getStatusDisplayName === 'function') ? getStatusDisplayName(s.id) : s.id;
                return `${escFn(nm)} x${s.stacks}`;
            }).join('、');
            statusChosenBox.innerHTML = `💡 此動作附加：${list}（若選「豁免抵擋」並啟用「命中施加動作附加狀態」，則只對受到大於 0 傷害的目標生效；也可改切到「附加狀態」分頁直接全部套用）`;
        }
    } else if (statusChosenBox) {
        statusChosenBox.innerHTML = '';
    }

    if (typeof showToast === 'function') showToast(`已帶入 ${a.label}：DP ${a.dp}、預設${saveNames[a.saveType] || '反射'}豁免${a.statuses.length ? '、附加狀態' : ''}`);
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
 * 把 BOSS AOE 動作的單項附加狀態（{id, stacks}）套用到指定目標。
 * 用名稱（getStatusDisplayName / getStatusByName）解析狀態定義；
 * 累積型與現有層數相加、開關型以當前是否擁有決定 on/off。
 * @param {Object} unit - 目標單位
 * @param {{id:string, stacks:number}} st - 動作附加狀態
 */
function aoeApplyStatusToUnit(unit, st) {
    if (!unit || !st || !st.id) return;
    // 解析狀態定義（先 id 再名稱）
    let def = null;
    if (typeof getStatusById === 'function') def = getStatusById(st.id);
    if (!def && typeof getStatusByName === 'function') def = getStatusByName(st.id);

    const key = def ? def.name : st.id;
    const stacks = parseInt(st.stacks) || 0;

    if (!unit.status) unit.status = {};
    const current = parseInt(unit.status[key]) || 0;

    if (def && def.type === 'binary') {
        // 開關型：有 stacks 就套用、無則移除
        if (stacks > 0) {
            unit.status[key] = '';
        } else {
            delete unit.status[key];
        }
    } else {
        // 累積型：累加（不會自動移除低層數）
        const next = current + (stacks || 1);
        if (next <= 0) delete unit.status[key];
        else unit.status[key] = String(next);
    }
}

/**
 * 結算群體操作：依目前選定的結算方式（直接傷害／豁免抵擋／治療／附加狀態）執行。
 * 舊版（接受 type 參數）已被新版以隱藏欄位讀取取代；為相容既有呼叫端仍保留 type 參數：
 *   - type === 'damage' / 'heal' / 'status'：舊版直譯
 *   - 未提供 type：依隱藏欄位 #aoe-resolve-mode 自動分派
 */
function aoeExecute(type) {
    const units = aoeResolveSelectedUnits();
    if (!units.length) {
        if (typeof showToast === 'function') showToast('選取的單位已不存在');
        return;
    }
    const mode = type || document.getElementById('aoe-resolve-mode')?.value || 'direct';

    if (mode === 'save') {
        // 豁免抵擋：每位目標用自己的下拉豁免類型；下方獨立處理（需擲骰）
        const atkDp = parseInt(document.getElementById('aoe-save-atk-dp')?.value, 10) || 0;
        const dmgType = document.getElementById('aoe-save-dmg-type')?.value || 'l';
        const autoRoll = document.getElementById('aoe-save-atk-autoroll')?.checked !== false;
        const applyStatus = document.getElementById('aoe-save-apply-status')?.checked !== false;
        if (atkDp <= 0 && autoRoll) {
            if (typeof showToast === 'function') showToast('請輸入攻擊 DP（大於 0）');
            return;
        }
        aoeExecuteSaveMode(units, atkDp, dmgType, autoRoll, applyStatus);
        return;
    }

    const unitIds = units.map(u => u.id);
    const targetNames = units.map(u => u.name || '未命名');
    const attackerName = aoeResolveAttackerName();

    const actionData = { type: mode === 'heal' ? 'heal' : (mode === 'status' ? 'status' : 'damage') };

    if (mode === 'heal' || mode === 'damage') {
        const inputId = mode === 'heal' ? 'aoe-heal-value' : 'aoe-value-input';
        const val = parseInt(document.getElementById(inputId)?.value, 10);
        if (isNaN(val) || val <= 0) {
            if (typeof showToast === 'function') showToast('請輸入有效數值');
            return;
        }
        actionData.value = val;
        if (mode === 'damage') actionData.dmgType = document.getElementById('aoe-dmg-type')?.value || 'l';
    } else if (mode === 'status') {
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
        if (mode === 'damage') {
            const typeLabel = { b: 'B', l: 'L', a: 'A' }[actionData.dmgType] || '';
            showToast(`對 ${unitIds.length} 個目標造成 ${actionData.value} 點 ${typeLabel} 傷`);
        } else if (mode === 'heal') {
            showToast(`為 ${unitIds.length} 個目標治療 ${actionData.value} 點`);
        } else if (mode === 'status') {
            showToast(`對 ${unitIds.length} 個目標套用狀態 ${actionData.statusId} ${actionData.value ? 'x' + actionData.value : ''}`);
        }
    }

    if (typeof renderMap === 'function') renderMap();
    if (typeof renderAll === 'function') renderAll();

    aoeCloseOperationModal();
}

// ===== 豁免抵擋模式（BOSS AOE vs 玩家三豁免）=====
/**
 * 豁免抵擋結算：
 *   1. 取得攻擊成功數——自動擲骰開啟時把「攻擊 DP」當骰數擲 D10 骰池（8+ 成功，10 加骰）；
 *      關閉時把「攻擊 DP」直接視為已擲出的成功數。
 *   2. 每個目標以其「自己的下拉豁免類型」為骰數自動擲豁免（ST 可逐個覆寫）。
 *   3. 傷害 = max(0, 攻擊成功數 − 豁免成功數)，逐目標套用（會先消耗護盾）。
 *   4. 若啟用「命中施加動作附加狀態」，僅對「實際受到大於 0 點傷害」的目標施加動作指定的狀態。
 * 結算後彈出逐目標結果清單，並寫入戰鬥日誌。
 * @param {Array} units - 目標單位
 * @param {number} atkValue - 攻擊 DP（骰數或成功數，依自動擲骰開關）
 * @param {string} dmgType - 'b' | 'l' | 'a'
 * @param {boolean} autoRoll - 是否自動擲骰
 * @param {boolean} applyStatus - 是否對命中目標施加 BOSS 動作附加狀態
 */
function aoeExecuteSaveMode(units, atkValue, dmgType, autoRoll, applyStatus) {
    if (typeof bbRollAttackDice !== 'function' || typeof modifyHPInternal !== 'function') {
        if (typeof showToast === 'function') showToast('結算引擎未就緒');
        return;
    }
    const saveNames = { saveWill: '意志', saveReflex: '反射', saveTenacity: '強韌' };
    const validateSave = k => (k === 'saveWill' || k === 'saveReflex' || k === 'saveTenacity') ? k : 'saveReflex';
    const attackerName = aoeResolveAttackerName();

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

    // BOSS 動作指定的附加狀態（若有，目前從作用中 BOSS 的 AOE 行動讀取；若 ST 沒選則為空陣列）
    let actionStatuses = [];
    if (applyStatus && typeof state !== 'undefined' && typeof findUnitById === 'function') {
        let boss = state.activeBossId ? findUnitById(state.activeBossId) : null;
        if (!boss) {
            const allUnits = state.units || [];
            boss = allUnits.find(u => (u.type === 'boss' || u.isBoss) && !u.actionSlotOf);
        }
        if (boss) {
            if (Array.isArray(boss.actionStatuses)) actionStatuses = boss.actionStatuses.map(s => ({ ...s }));
            if (typeof getActionSlots === 'function') {
                const slots = getActionSlots(boss.id);
                slots.forEach(s => {
                    if (s.actionAoe && Array.isArray(s.actionStatuses)) {
                        s.actionStatuses.forEach(st => actionStatuses.push({ ...st }));
                    }
                });
            }
        }
    }

    // 逐目標擲豁免並套用傷害（modifyHPInternal 會先消耗護盾再扣血）
    const typeLabel = { b: 'B', l: 'L', a: 'A' }[dmgType] || '';
    const results = units.map(u => {
        // 每位目標獨立的下拉豁免類型（沒有的話退回預設反射）
        const sel = document.getElementById(`aoe-target-save-${u.id}`);
        const saveKey = validateSave(sel?.value || 'saveReflex');
        const pool = Math.max(0, parseInt(u[saveKey]) || 0);
        const r = bbRollAttackDice(pool, 10);
        const dmg = Math.max(0, atkSuccess - r.successes);
        if (dmg > 0) modifyHPInternal(u, dmgType, dmg);
        return { unit: u, name: u.name || '未命名', saveKey, pool, save: r.successes, dmg, saveName: saveNames[saveKey] };
    });

    // 對「實際命中（受傷 > 0）」的目標施加動作附加狀態
    let statusAppliedTo = [];
    if (applyStatus && actionStatuses.length) {
        results.forEach(r => {
            if (r.dmg > 0) {
                actionStatuses.forEach(st => {
                    aoeApplyStatusToUnit(r.unit, st);
                    statusAppliedTo.push(`${r.name}${st.stacks ? 'x' + st.stacks : ''}`);
                });
            }
        });
    }

    if (typeof broadcastState === 'function') broadcastState();

    // 戰鬥日誌
    if (typeof bbPushCombatLog === 'function') {
        const detail = results.map(r => `${r.name} ${r.saveName}${r.save} 受${r.dmg}`).join('、');
        const statusTxt = statusAppliedTo.length ? `；附加狀態：${[...new Set(statusAppliedTo)].join('、')}` : '';
        bbPushCombatLog({
            entryType: 'aoe',
            attackerName: attackerName || 'BOSS',
            attackerRole: 'enemy',
            defenderName: results.map(r => r.name).join(', '),
            broadcastText: `【${attackerName || 'BOSS'}】發動 AOE（豁免抵擋，攻擊 ${atkSuccess} 成功）：${detail}${statusTxt}`,
            round: (typeof state !== 'undefined' && state.roundNum) || 0
        });
    }

    // 逐目標結果清單（取代原操作視窗）
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
    const rows = results.map(r => `
        <div class="aoe-save-result-row${r.dmg > 0 ? ' hit' : ' resisted'}">
            <span class="asr-name">${esc(r.name)}</span>
            <span class="asr-roll">${esc(r.saveName)} ${r.pool} 顆 → ${r.save} 成功</span>
            <span class="asr-dmg">${r.dmg > 0 ? `受 ${r.dmg} ${typeLabel}傷` : '完全抵擋'}</span>
        </div>`).join('');
    const statusLog = (applyStatus && actionStatuses.length)
        ? `<div style="font-size:0.78rem;color:var(--text-dim);margin-top:6px;">💡 附加狀態：動作共 ${actionStatuses.length} 項，命中目標（${statusAppliedTo.length ? [...new Set(results.filter(x => x.dmg > 0).map(x => x.name))].join('、') : '無'}）已套用。</div>`
        : '';
    aoeCloseOperationModal();
    const html = `
        <div class="modal-overlay show" id="aoe-save-results" onclick="if(event.target.id==='aoe-save-results')document.getElementById('aoe-save-results').remove()">
            <div class="modal" style="max-width:460px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <span style="font-weight:bold;">🎲 豁免抵擋結果</span>
                    <button onclick="document.getElementById('aoe-save-results').remove()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div style="font-size:0.85rem;color:var(--accent-orange);margin-bottom:4px;">⚔ 攻擊：${esc(atkDetail)}</div>
                    ${rows}
                    ${statusLog}
                    <div style="font-size:0.72rem;color:var(--text-dim);margin-top:6px;">傷害已套用（護盾優先消耗）。每位目標用自己的下拉豁免，未填寫豁免值則豁免 0。</div>
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

/**
 * Limbus Command - 戰鬥 Modal 綁定
 * 右鍵選單劫持發起的攻擊/威脅 Modal，與表單記憶（localStorage）+ Firebase 戰鬥隊列串接。
 */

const ATTACK_MODAL_MEMO_KEY = 'limbus-attack-modal-memo';
const DEFENSE_MODAL_MEMO_KEY = 'limbus-defense-modal-memo';

let attackModalTarget = null; // { id, name }
let threatPendingStatuses = []; // ST 威脅時，所選 BOSS 行動要施加給目標的狀態 [{id,stacks}]

function cmLoadMemo(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function cmSaveMemo(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) { /* quota or disabled storage */ }
}

/**
 * 玩家對敵方/BOSS 右鍵點擊「發起攻擊」
 */
function openAttackModal(unitId) {
    const u = typeof findUnitById === 'function' ? findUnitById(unitId) : null;
    if (!u) return;
    attackModalTarget = { id: u.id, name: u.name || '目標' };

    document.getElementById('attack-target-name').innerText = `目標：${u.name || '---'}`;

    const memo = cmLoadMemo(ATTACK_MODAL_MEMO_KEY) || {};
    document.getElementById('attack-dp').value = memo.dp ?? 0;
    document.getElementById('attack-auto').value = memo.auto ?? 0;
    document.getElementById('attack-ignore-def').value = memo.ignoreDef ?? 0;
    document.getElementById('attack-crit-vicious').value = memo.critVicious ?? 0;
    document.getElementById('attack-armor-pierce').value = memo.armorPierce ?? 0;
    document.getElementById('attack-haste-pierce').value = memo.hastePierce ?? 0;
    document.getElementById('attack-magic-pierce').value = memo.magicPierce ?? 0;

    // ST 威脅：列出作用中 BOSS 的各行動，供一鍵帶入 DP 與待施加狀態
    threatPendingStatuses = [];
    cmRenderThreatActions();

    openModal('attack-modal');

    // ST 開啟威脅視窗時，自動點選第一個可用行動，預先帶入其 DP / 狀態（仍可再手動切換）
    if (myRole === 'st') {
        setTimeout(() => {
            const firstBtn = document.querySelector('#attack-boss-actions .threat-action-btn');
            if (firstBtn) firstBtn.click();
        }, 0);
    }
}

/**
 * 渲染 ST 威脅時的「BOSS 行動」選擇列。玩家攻擊或無作用中 BOSS 時隱藏。
 */
function cmRenderThreatActions() {
    const box = document.getElementById('attack-boss-actions');
    if (!box) return;
    box.style.display = 'none';
    box.innerHTML = '';
    if (myRole !== 'st') return;
    if (typeof state === 'undefined' || !state.activeBossId) return;
    const boss = (typeof findUnitById === 'function') ? findUnitById(state.activeBossId) : null;
    if (!boss) return;

    // 本體（行動1）+ 各行動條目（AOE 行動不走單體威脅流程，請改用多重行動面板的群體操作）
    const allActions = [boss];
    if (typeof getActionSlots === 'function') allActions.push(...getActionSlots(boss.id));

    const btns = allActions.map((u, i) => {
        if (u.actionAoe) return '';
        const dp = u.actionDp || 0;
        const statuses = Array.isArray(u.actionStatuses) ? u.actionStatuses : [];
        const stTxt = statuses.length
            ? statuses.map(s => {
                const nm = (typeof getStatusDisplayName === 'function') ? getStatusDisplayName(s.id) : s.id;
                return nm + (s.stacks > 0 ? ('x' + s.stacks) : '');
              }).join('、')
            : '無狀態';
        return `<button type="button" class="threat-action-btn" onclick="cmApplyThreatAction('${u.id}')">行動${i + 1}${i === 0 ? '·本體' : ''}<small>DP ${dp}｜${escapeHtml(stTxt)}</small></button>`;
    }).filter(Boolean).join('');

    box.innerHTML = `<div class="threat-action-label">⚔ ${escapeHtml(boss.name || 'BOSS')} 行動（點選帶入 DP 與狀態）</div><div class="threat-action-btns">${btns}</div>`;
    box.style.display = 'block';
}

/**
 * 套用某 BOSS 行動：帶入 DP 並暫存其狀態（送出威脅時施加給目標）。
 */
function cmApplyThreatAction(unitId) {
    const u = (typeof findUnitById === 'function') ? findUnitById(unitId) : null;
    if (!u) return;
    const counterMod = (typeof cpResolveActionMod === 'function') ? cpResolveActionMod(unitId) : { mod: 0, playerName: '' };
    const dp = (u.actionDp || 0) + (counterMod.mod || 0);
    document.getElementById('attack-dp').value = dp;
    threatPendingStatuses = Array.isArray(u.actionStatuses) ? u.actionStatuses.map(s => ({ ...s })) : [];
    const modTxt = counterMod.mod ? `（含對抗${escapeHtml(counterMod.playerName)} ${counterMod.mod > 0 ? '+' : ''}${counterMod.mod}）` : '';
    if (typeof showToast === 'function') showToast(`已帶入 ${u.name || '行動'}：DP ${dp}${modTxt}`);
}

function closeAttackModal() {
    closeModal('attack-modal');
}

/**
 * ST 對玩家右鍵點擊「發起威脅 (QTE)」：沿用同一個 Modal UI
 */
function openThreatModal(unitId) {
    openAttackModal(unitId);
}

/**
 * 自動套用攻擊方目前在人格卡面板（identity-hud）勾選持有/解鎖的人格卡，
 * 疊加其 onAttack/onHit 數值加值，回傳可併入黑箱計算的 DP/額外成功加總與觸發紀錄。
 * 僅在玩家發起攻擊時套用（ST 發起威脅走的是另一套敵方資料，不涉及玩家人格卡）。
 * @param {object} attackerUnit
 * @param {object} targetUnit
 * @returns {{ dpBonus: number, extraSuccess: number, names: string[] }}
 */
function cmResolveIdentityBonus(attackerUnit, targetUnit) {
    // 所有欄位都給預設值，確保呼叫端（submitAttackModal / cqOnSTReview）即使走早退路徑也能安全存取
    const empty = { dpBonus: 0, extraSuccess: 0, names: [], targetStatus: {}, statusNotes: [], selfStatus: {}, selfStatusNotes: [] };
    if (myRole === 'st') return empty;
    if (typeof evaluatePlayerAttack !== 'function' || typeof identityHudState === 'undefined') return empty;

    const owner = identityHudState.owner;
    if (!owner || typeof getIdentitiesByOwner !== 'function') return empty;

    const ownedCards = getIdentitiesByOwner(owner)
        .filter(id => identityHudState.cards[id] && identityHudState.cards[id].owned)
        .map(id => ({ id, unlocked: !!identityHudState.cards[id].unlocked }));
    if (!ownedCards.length) return empty;

    const attackerState = (typeof buildEngineUnitState === 'function') ? buildEngineUnitState(attackerUnit) : (attackerUnit || {});
    const targetState = (typeof buildEngineUnitState === 'function') ? buildEngineUnitState(targetUnit) : (targetUnit || {});
    const result = evaluatePlayerAttack(ownedCards, attackerState, targetState);

    // 人格引擎在攻擊／命中時會對目標（減益）與攻擊者自身（如迅捷/呼吸法等資源）施加的狀態。
    // 整理成「中文狀態名＋層數」清單，供發起攻擊時自動施加並在 ST 明細中列出。
    const buildStatusNotes = (statusMap) => Object.entries(statusMap).map(([engKey, layers]) => {
        const amount = parseInt(layers) || 0;
        if (!amount) return '';
        const name = (typeof identityStatusName === 'function') ? identityStatusName(engKey) : engKey;
        return `${name}+${amount}`;
    }).filter(Boolean);

    const targetStatus = result.expectedTargetStatus || {};
    const selfStatus = result.expectedSelfStatus || {};

    return {
        dpBonus: result.totalDpBonus || 0,
        extraSuccess: result.totalExtraSuccess || 0,
        names: [...new Set(result.triggerLogs.filter(l => !l.manual).map(l => l.identityName).filter(Boolean))],
        targetStatus,
        statusNotes: buildStatusNotes(targetStatus),
        selfStatus,
        selfStatusNotes: buildStatusNotes(selfStatus)
    };
}

/**
 * 發送按鈕：依目前使用者角色決定走「攻擊」或「威脅」流程
 */
function submitAttackModal() {
    if (!attackModalTarget) return;
    // 嚴格整數轉型（parseInt 基底 10），避免字串相加（"10"+"5"→"105"）等型別污染
    const dp = parseInt(document.getElementById('attack-dp').value, 10) || 0;
    const auto = parseInt(document.getElementById('attack-auto').value, 10) || 0;
    const ignoreDef = Math.max(0, parseInt(document.getElementById('attack-ignore-def').value, 10) || 0);
    const critVicious = Math.max(0, parseInt(document.getElementById('attack-crit-vicious').value, 10) || 0);
    // 破甲/高速/破魔：簡化為直接等效 DP，併入黑箱計算的攻擊 DP 桶（見 black-box-engine.js）
    const armorPierce = Math.max(0, parseInt(document.getElementById('attack-armor-pierce').value, 10) || 0);
    const hastePierce = Math.max(0, parseInt(document.getElementById('attack-haste-pierce').value, 10) || 0);
    const magicPierce = Math.max(0, parseInt(document.getElementById('attack-magic-pierce').value, 10) || 0);

    cmSaveMemo(ATTACK_MODAL_MEMO_KEY, { dp, auto, ignoreDef, critVicious, armorPierce, hastePierce, magicPierce });

    // 攻擊方單位：玩家＝自己控制的單位；ST 發起威脅＝目前作用中的 BOSS（用於套用 BOSS 攻擊修正）
    let attackerUnit = null;
    if (typeof state !== 'undefined' && Array.isArray(state.units)) {
        attackerUnit = (myRole === 'st')
            ? (state.activeBossId ? state.units.find(u => u.id === state.activeBossId) : null)
            : state.units.find(u => u.ownerId === myPlayerId);
    }
    const targetUnit = typeof findUnitById === 'function' ? findUnitById(attackModalTarget.id) : null;
    const identityBonus = cmResolveIdentityBonus(attackerUnit, targetUnit);

    // 玩家發起攻擊：若本回合未對抗任何 BOSS 行動，自動套用對抗分配的自身 DP 加成
    let counterPhaseDpBonus = 0;
    if (myRole !== 'st' && attackerUnit && typeof cpResolvePlayerMods === 'function') {
        counterPhaseDpBonus = cpResolvePlayerMods(myPlayerId, attackerUnit.init || 0).selfBonus;
    }

    const attacker = {
        id: myPlayerId, name: myName,
        unitId: attackerUnit ? attackerUnit.id : null,
        // ST 在此 Modal 一律操作 BOSS/怪物發起威脅，即便 id 仍是 ST 的 myPlayerId 也不算玩家攻擊；
        // 火力統計／AI 遭遇構築需以此區分，避免 ST 擲骰污染玩家平均火力。
        attackerRole: (myRole === 'st') ? 'enemy' : 'player',
        dp, auto, ignoreDef, critVicious,
        armorPierce, hastePierce, magicPierce,
        identityDpBonus: identityBonus.dpBonus,
        identityExtraSuccess: identityBonus.extraSuccess,
        identityNotes: identityBonus.names,
        identityStatusNotes: identityBonus.statusNotes || [],
        identitySelfStatusNotes: identityBonus.selfStatusNotes || [],
        counterPhaseDpBonus
    };
    const target = { id: attackModalTarget.id, name: attackModalTarget.name };

    if (myRole === 'st') {
        cqInitiateThreat({ attacker, target });
        // 所選 BOSS 行動的狀態自動施加到目標玩家單位
        if (threatPendingStatuses.length && typeof addStatusToUnit === 'function') {
            const applied = [];
            threatPendingStatuses.forEach(s => {
                addStatusToUnit(target.id, s.id, s.stacks > 0 ? s.stacks : null);
                const nm = (typeof getStatusDisplayName === 'function') ? getStatusDisplayName(s.id) : s.id;
                applied.push(nm + (s.stacks > 0 ? ' x' + s.stacks : ''));
            });
            if (applied.length && typeof showToast === 'function') showToast('已對目標施加：' + applied.join('、'));
        }
        threatPendingStatuses = [];
        if (typeof showToast === 'function') showToast('威脅已發起，等待玩家防禦...');
    } else {
        cqInitiateAttack({ attacker, target });

        // 人格引擎判定本次攻擊／命中會對目標施加的負面狀態，於發起攻擊時自動套用到目標單位，
        // 讓 ST 不需在審核時手動補上玩家人格給予的減益。
        if (identityBonus.targetStatus && typeof applyEngineStatusesToUnit === 'function') {
            const applied = applyEngineStatusesToUnit(target.id, identityBonus.targetStatus);
            if (applied && identityBonus.statusNotes.length && typeof showToast === 'function') {
                showToast('人格效果已對目標施加：' + identityBonus.statusNotes.join('、'));
            }
        }

        // 對稱處理：人格引擎判定本次攻擊／命中會對攻擊者自身施加的狀態（如迅捷、呼吸法等資源），
        // 同樣於發起攻擊時自動套用到攻擊者自己的單位。
        if (identityBonus.selfStatus && attackerUnit && typeof applyEngineStatusesToUnit === 'function') {
            const appliedSelf = applyEngineStatusesToUnit(attackerUnit.id, identityBonus.selfStatus);
            if (appliedSelf && identityBonus.selfStatusNotes.length && typeof showToast === 'function') {
                showToast('已對自己套用：' + identityBonus.selfStatusNotes.join('、'));
            }
        }

        const bonusTotal = identityBonus.dpBonus + identityBonus.extraSuccess;
        const bonusMsg = bonusTotal ? `（已自動套用人格卡加值 +${bonusTotal}）` : '';
        if (typeof showToast === 'function') showToast('攻擊已送出，等待系統判定...' + bonusMsg);
    }
    closeAttackModal();
}

/**
 * combat-queue.js 在 pending_defense 狀態時呼叫：若自己是目標玩家，彈出防禦 QTE。
 */
function cqOnPendingDefense(data) {
    if (myRole === 'st') return;
    const target = data.target || {};
    // target.id 是棋子(Token)的 unit.id，不是玩家帳號 ID，必須先找到對應單位再比對其 ownerId
    const targetUnit = typeof findUnitById === 'function' ? findUnitById(target.id) : null;
    if (!targetUnit || targetUnit.ownerId !== myPlayerId) return;

    const memo = cmLoadMemo(DEFENSE_MODAL_MEMO_KEY) || {};
    document.getElementById('defense-dp').value = memo.dp ?? 0;
    document.getElementById('defense-auto').value = memo.auto ?? 0;

    openModal('defense-qte-modal');
}

function submitDefenseModal() {
    // 嚴格整數轉型，與攻擊端一致，避免型別污染
    const dp = parseInt(document.getElementById('defense-dp').value, 10) || 0;
    const auto = parseInt(document.getElementById('defense-auto').value, 10) || 0;

    cmSaveMemo(DEFENSE_MODAL_MEMO_KEY, { dp, auto });

    cqSubmitDefense({ dp, auto });

    closeModal('defense-qte-modal');
    if (typeof showToast === 'function') showToast('防禦已送出，等待系統判定...');
}

/**
 * combat-queue.js 在 st_review 狀態時呼叫（僅 ST 端）：彈出黑箱審核 Modal。
 */
function cqOnSTReview(data) {
    if (myRole !== 'st') return;
    const baseDice = data.baseDice ?? 0;
    const baseExtraSuccess = data.baseExtraSuccess ?? 0;

    // 把黑箱算出的初步骰數／附加成功直接釘在 Modal 的 data-* 屬性上。
    // 「確認廣播」時改由這裡讀取，避免依賴 combatQueueLast 全域變數的更新時序，
    // 杜絕廣播骰數變成 0 的狀態遺失（State Loss）問題。
    const reviewModal = document.getElementById('st-review-modal');
    if (reviewModal) {
        reviewModal.dataset.baseDice = String(baseDice);
        reviewModal.dataset.baseExtraSuccess = String(baseExtraSuccess);
    }

    // DP 與附加成功是兩種不同的東西，分開顯示，絕不相加成單一數字
    const extraTxt = baseExtraSuccess > 0 ? ` + 附加成功 ${baseExtraSuccess}` : '';
    document.getElementById('st-review-suggested').innerText = `系統建議骰數：${baseDice} 顆${extraTxt}`;

    // 顯示攻擊方宣告的特殊參數，供 ST 黑箱判定參考
    const atk = data.attacker || {};
    const ignoreDef = Number(atk.ignoreDef) || 0;
    const critVicious = Number(atk.critVicious) || 0;
    const identityDpBonus = Number(atk.identityDpBonus) || 0;
    const identityExtraSuccess = Number(atk.identityExtraSuccess) || 0;
    const counterPhaseDpBonus = Number(atk.counterPhaseDpBonus) || 0;
    const ctx = document.getElementById('st-review-context');
    if (ctx) {
        // 以 DOM 節點 + textContent 建構（不用 innerHTML），從根本杜絕 XSS：
        // data.* 來自跨客戶端的戰鬥隊列，可能含使用者輸入的人格卡/狀態名稱。
        ctx.textContent = '';

        // 卡片清單：每筆修正獨立色塊，依語意上色（加成=綠 / 減益=紅 / 資源類=藍），
        // ST 可一眼用顏色判斷修正方向，不必逐字閱讀。
        const rows = [];
        if (ignoreDef > 0)            rows.push({ label: '無視防禦', value: `${ignoreDef} 點`, cls: 'is-resource' });
        if (critVicious > 0)          rows.push({ label: '嚴重轉惡性', value: `${critVicious} 點`, cls: 'is-resource' });
        if (identityDpBonus > 0)      rows.push({ label: '人格卡 DP', value: `+${identityDpBonus}`, cls: 'is-bonus' });
        if (identityExtraSuccess > 0) rows.push({ label: '人格卡額外成功', value: `+${identityExtraSuccess}`, cls: 'is-bonus' });
        if (counterPhaseDpBonus > 0)  rows.push({ label: '未對抗加成 DP', value: `+${counterPhaseDpBonus}`, cls: 'is-bonus' });
        if (Array.isArray(atk.identityNotes) && atk.identityNotes.length)
            rows.push({ label: '套用人格卡', value: atk.identityNotes.join('、'), cls: 'is-bonus' });
        if (Array.isArray(atk.identityStatusNotes) && atk.identityStatusNotes.length)
            rows.push({ label: '對目標施加', value: atk.identityStatusNotes.join('、'), cls: 'is-penalty' });
        if (Array.isArray(atk.identitySelfStatusNotes) && atk.identitySelfStatusNotes.length)
            rows.push({ label: '對自己施加', value: atk.identitySelfStatusNotes.join('、'), cls: 'is-bonus' });

        if (rows.length) {
            const list = document.createElement('div');
            list.className = 'calc-detail-list';
            rows.forEach(r => {
                const row = document.createElement('div');
                row.className = 'calc-detail-row ' + r.cls;
                const label = document.createElement('span');
                label.className = 'calc-detail-label';
                label.textContent = r.label;
                const value = document.createElement('span');
                value.className = 'calc-detail-value';
                value.textContent = r.value;
                row.appendChild(label);
                row.appendChild(value);
                list.appendChild(row);
            });
            ctx.appendChild(list);
        }

        // 動態隱藏：完整公式流水帳預設收合，點「展開」才看到，減少視覺噪音
        if (data.debugStr) {
            const details = document.createElement('details');
            details.className = 'calc-detail-collapse';
            const summary = document.createElement('summary');
            summary.textContent = '展開完整計算公式';
            const raw = document.createElement('div');
            raw.className = 'calc-detail-raw';
            raw.textContent = data.debugStr;
            details.appendChild(summary);
            details.appendChild(raw);
            ctx.appendChild(details);
        }
    }

    document.getElementById('st-review-modifier').value = 0;
    openModal('st-review-modal');
}

function confirmSTReview() {
    // 優先從 Modal 的 data-* 屬性讀取初步骰數（cqOnSTReview 渲染時已釘上），
    // 全域 combatQueueLast 僅作為退路，避免監聽器更新時序造成骰數讀成 0。
    const reviewModal = document.getElementById('st-review-modal');
    const ds = reviewModal ? reviewModal.dataset : {};
    const dsDice = parseInt(ds.baseDice, 10);
    const dsExtra = parseInt(ds.baseExtraSuccess, 10);
    const baseDice = Number.isFinite(dsDice) ? dsDice : ((combatQueueLast && combatQueueLast.baseDice) || 0);
    const baseExtraSuccess = Number.isFinite(dsExtra) ? dsExtra : ((combatQueueLast && combatQueueLast.baseExtraSuccess) || 0);

    const STModifier = document.getElementById('st-review-modifier').value;
    const modifier = parseInt(STModifier, 10) || 0;
    // 微調僅套用於骰數，附加成功維持黑箱原值（兩者分開，不相加）
    const finalDice = Math.max(0, parseInt(baseDice, 10) + modifier);

    closeModal('st-review-modal');
    cqBroadcastResult(finalDice, baseExtraSuccess, modifier);
}

/**
 * combat-queue.js 在 idle 狀態時呼叫：確保所有戰鬥相關 Modal 皆已關閉。
 */
function cqOnIdle() {
    closeModal('attack-modal');
    closeModal('defense-qte-modal');
    closeModal('st-review-modal');
}

/**
 * counter-phase.js 偵測到本回合徵詢已開始、且自己尚未送出分配時自動呼叫（玩家端）：
 * 開啟（並渲染）浮動面板，供玩家勾選要對抗哪些 BOSS 行動。
 * 面板送出後不會關閉，會持續顯示每個行動目前被誰對抗（以棋子名稱顯示）或「等待對抗中……」，
 * 玩家可雙擊縮放、可關閉，並能由右下快捷球「本回合對抗分配」重新開啟。
 */
function openCounterAssignModal() {
    cpShowFloatPanel();
    cpRenderFloatPanel();
}

/**
 * 渲染浮動面板內容。尚未送出：顯示可勾選的行動清單與送出按鈕；
 * 已送出：顯示唯讀狀態（行動對應的棋子名稱，或「等待對抗中……」），並持續即時更新。
 */
function cpRenderFloatPanel() {
    const body = document.getElementById('counter-float-body');
    if (!body) return;
    const item = document.getElementById('qab-counter-panel-item');

    if (typeof counterPhaseState === 'undefined' || !counterPhaseState.started) {
        body.textContent = '尚未開始本輪徵詢';
        if (item) item.style.display = 'none';
        return;
    }
    if (item && myRole !== 'st') item.style.display = 'flex';

    const actions = counterPhaseState.actions || [];
    const assignments = counterPhaseState.assignments || {};
    const mine = (myRole !== 'st') ? assignments[myPlayerId] : undefined;
    const hasSubmitted = mine !== undefined;

    if (!hasSubmitted && myRole !== 'st') {
        const rows = actions.map(a => `
            <label class="counter-assign-row">
                <input type="checkbox" value="${a.id}" class="counter-float-check counter-assign-check">
                <span>${escapeHtml(a.label)}（先攻 ${a.init}）</span>
            </label>
        `).join('');
        body.innerHTML = `
            <p style="font-size:0.8rem;color:var(--text-dim);margin:0 0 6px;">勾選你這回合要對抗的 BOSS 行動（可複選，可不選）。未勾選任何行動，本回合你的攻擊 DP 會自動加成。</p>
            ${rows || '<div class="bb-hint">尚無行動資料</div>'}
            <button class="modal-btn" onclick="submitCounterAssign()" style="background:var(--accent-green);width:100%;margin-top:8px;">送出</button>
        `;
        return;
    }

    // 已送出（或 ST 檢視）：唯讀顯示每個行動目前對抗狀態
    const rows = actions.map(a => {
        const r = (typeof cpResolveActionMod === 'function') ? cpResolveActionMod(a.id) : { playerName: '', mod: 0 };
        const statusHtml = r.playerId
            ? `<span class="ca-taken">${escapeHtml(r.playerName)}（DP ${r.mod >= 0 ? '+' : ''}${r.mod}）</span>`
            : `<span class="ca-waiting">等待對抗中……</span>`;
        return `<div class="counter-float-row"><span>${escapeHtml(a.label)}</span>${statusHtml}</div>`;
    }).join('');
    const submittedCount = Object.keys(assignments).length;
    body.innerHTML = `<div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">已送出 ${submittedCount} 人</div>${rows}`;
}

function submitCounterAssign() {
    const checks = document.querySelectorAll('#counter-float-body .counter-assign-check:checked');
    const ids = Array.from(checks).map(c => c.value);
    cpSubmitAssignment(ids);
    if (typeof showToast === 'function') showToast('已送出本回合對抗分配');
    // assignments 會透過 Firebase 監聽回流並自動重新渲染為唯讀狀態，這裡先樂觀渲染避免畫面延遲
    cpRenderFloatPanel();
}

/** 顯示浮動面板（不重置縮放狀態）。 */
function cpShowFloatPanel() {
    const panel = document.getElementById('counter-float-panel');
    if (panel) panel.classList.remove('hidden');
}

/** 關閉浮動面板（玩家可隨時關閉，之後可由快捷球重新開啟）。 */
function cpCloseFloatPanel(event) {
    if (event) event.stopPropagation();
    const panel = document.getElementById('counter-float-panel');
    if (panel) panel.classList.add('hidden');
}

/** 快捷球「本回合對抗分配」選單項：重新開啟並渲染浮動面板。 */
function cpToggleFloatPanel() {
    const panel = document.getElementById('counter-float-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    cpRenderFloatPanel();
}

/** 雙擊面板標頭區域切換縮放（zoomed）大小，方便詳細查看。 */
function cpToggleZoomFloatPanel(event) {
    if (event && event.target && event.target.closest('.counter-float-close')) return;
    const panel = document.getElementById('counter-float-panel');
    if (panel) panel.classList.toggle('zoomed');
}

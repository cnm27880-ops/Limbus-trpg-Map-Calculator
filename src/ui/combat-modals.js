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
 * 解析目前的攻擊者單位：ST 取作用中 BOSS（優先 👑 標記，否則第一個本體 BOSS），
 * 玩家取自己控制的單位。邏輯與 aoe-select.js 的 aoeResolveAttackerName 一致。
 * @returns {Object|null}
 */
function cmResolveAttackerUnit() {
    if (typeof myRole !== 'undefined' && myRole === 'st') {
        let boss = (state.activeBossId && typeof findUnitById === 'function') ? findUnitById(state.activeBossId) : null;
        if (!boss && typeof state !== 'undefined' && Array.isArray(state.units)) {
            boss = state.units.find(u => (u.type === 'boss' || u.isBoss) && !u.actionSlotOf);
        }
        return boss || null;
    }
    if (typeof state !== 'undefined' && Array.isArray(state.units) && typeof myPlayerId !== 'undefined') {
        return state.units.find(u => u.ownerId === myPlayerId) || null;
    }
    return null;
}

/**
 * 兩單位間的棋盤格距離（king-move／Chebyshev：斜角不額外計算），
 * 配合「移動消耗 1格=5米，攻擊距離 1格=1米」的換算慣例——攻擊距離看的是實際直線距離，不是移動消耗。
 * 任一單位尚未上場（x/y < 0）時回傳 null。
 * @returns {number|null}
 */
function cmCalcGridDistance(a, b) {
    if (!a || !b || a.x < 0 || a.y < 0 || b.x < 0 || b.y < 0) return null;
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 更新攻擊 Modal 頂部「距離攻擊者 X 格」的顯示。 */
function cmUpdateAttackDistance(target) {
    const el = document.getElementById('attack-target-distance');
    if (!el) return;
    const attacker = cmResolveAttackerUnit();
    const dist = cmCalcGridDistance(attacker, target);
    el.textContent = (dist === null) ? '' : `距離攻擊者 ${dist} 格`;
}

/**
 * 玩家對敵方/BOSS 右鍵點擊「發起攻擊」
 */
function openAttackModal(unitId) {
    const u = typeof findUnitById === 'function' ? findUnitById(unitId) : null;
    if (!u) return;
    attackModalTarget = { id: u.id, name: u.name || '目標' };

    document.getElementById('attack-target-name').innerText = `目標：${u.name || '---'}`;
    cmUpdateAttackDistance(u);

    const memo = cmLoadMemo(ATTACK_MODAL_MEMO_KEY) || {};
    document.getElementById('attack-dp').value = memo.dp ?? 0;
    document.getElementById('attack-auto').value = memo.auto ?? 0;
    document.getElementById('attack-ignore-def').value = memo.ignoreDef ?? 0;
    document.getElementById('attack-crit-vicious').value = memo.critVicious ?? 0;
    document.getElementById('attack-armor-pierce').value = memo.armorPierce ?? 0;
    document.getElementById('attack-haste-pierce').value = memo.hastePierce ?? 0;
    document.getElementById('attack-magic-pierce').value = memo.magicPierce ?? 0;
    const capInput = document.getElementById('attack-damage-cap');
    if (capInput) capInput.value = memo.damageCap ?? 0;
    const explodeSel = document.getElementById('attack-explode');
    if (explodeSel) explodeSel.value = String(memo.explodeAt ?? 10);
    // 結算模式（防禦扣除 / 豁免抵擋）與豁免類型
    const modeSel = document.getElementById('attack-resolve-mode');
    if (modeSel) modeSel.value = (memo.resolveMode === 'save') ? 'save' : 'def';
    const saveTypeSel = document.getElementById('attack-save-type');
    if (saveTypeSel) saveTypeSel.value = ['saveWill', 'saveReflex', 'saveTenacity'].includes(memo.saveType) ? memo.saveType : 'saveReflex';
    cmOnAttackModeChange();

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
        const saveTag = u.actionSaveResist ? '｜🛡豁免' : '';
        return `<button type="button" class="threat-action-btn" onclick="cmApplyThreatAction('${u.id}')">行動${i + 1}${i === 0 ? '·本體' : ''}<small>DP ${dp}${saveTag}｜${escapeHtml(stTxt)}</small></button>`;
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

    // 行動標記「豁免抵擋」時，自動切換結算模式並帶入該行動指定的豁免類型
    const modeSel = document.getElementById('attack-resolve-mode');
    const saveTypeSel = document.getElementById('attack-save-type');
    if (modeSel) {
        modeSel.value = u.actionSaveResist ? 'save' : 'def';
        if (u.actionSaveResist && saveTypeSel) {
            saveTypeSel.value = ['saveWill', 'saveReflex', 'saveTenacity'].includes(u.actionSaveType) ? u.actionSaveType : 'saveReflex';
        }
        cmOnAttackModeChange();
    }

    const modTxt = counterMod.mod ? `（含對抗${escapeHtml(counterMod.playerName)} ${counterMod.mod > 0 ? '+' : ''}${counterMod.mod}）` : '';
    const saveTxt = u.actionSaveResist ? '｜豁免抵擋' : '';
    if (typeof showToast === 'function') showToast(`已帶入 ${u.name || '行動'}：DP ${dp}${modTxt}${saveTxt}`);
}

function closeAttackModal() {
    closeModal('attack-modal');
}

/** 攻擊結算模式切換：豁免抵擋時顯示豁免類型、攻擊欄改名「豁免攻擊」、開啟多目標選擇 */
function cmOnAttackModeChange() {
    const mode = document.getElementById('attack-resolve-mode')?.value || 'def';
    const isSave = mode === 'save';
    const saveField = document.getElementById('attack-save-type-field');
    if (saveField) saveField.style.display = isSave ? '' : 'none';
    const dpLabel = document.getElementById('attack-dp-label');
    if (dpLabel) dpLabel.textContent = isSave ? '豁免攻擊（骰數）' : '總攻擊 DP';
    cmRenderAttackTargets();
}

/**
 * 豁免抵擋模式的多目標選擇：列出可攻擊的單位晶片（可複選），
 * 右鍵發起的原始目標預設勾選。玩家攻擊列敵方/BOSS；ST 威脅列玩家角色。
 */
function cmRenderAttackTargets() {
    const box = document.getElementById('attack-multi-targets');
    if (!box) return;
    const mode = document.getElementById('attack-resolve-mode')?.value || 'def';
    if (mode !== 'save' || typeof state === 'undefined' || !Array.isArray(state.units)) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
    }
    const isSt = (typeof myRole !== 'undefined' && myRole === 'st');
    const candidates = state.units.filter(u => {
        if (u.actionSlotOf) return false;  // 多重行動條目非實體
        if (isSt) return u.type === 'player' || (u.ownerId && !String(u.ownerId).startsWith('st_'));
        return u.type === 'enemy' || u.type === 'boss' || u.isBoss === true;
    });
    if (!candidates.length) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
    }
    const attacker = cmResolveAttackerUnit();
    const chips = candidates.map(u => {
        const dist = cmCalcGridDistance(attacker, u);
        const distTxt = (dist === null) ? '' : ` <span class="atk-target-dist">${dist}格</span>`;
        return `
        <label class="atk-target-chip">
            <input type="checkbox" class="atk-target-check" value="${u.id}" ${attackModalTarget && u.id === attackModalTarget.id ? 'checked' : ''}>
            ${escapeHtml(u.name || '未命名')}${distTxt}
        </label>`;
    }).join('');
    box.innerHTML = `<div class="amt-title">🎯 攻擊對象（可複選，各目標分別擲豁免）</div><div class="amt-chips">${chips}</div>`;
    box.style.display = 'block';
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

    let owner = identityHudState.owner;
    if (!owner && typeof getIdentityOwners === 'function') {
        const allOwners = getIdentityOwners();
        if (attackerUnit && allOwners.includes(attackerUnit.name)) owner = attackerUnit.name;
        else if (allOwners.includes(myName)) owner = myName;
    }
    if (!owner || typeof getIdentitiesByOwner !== 'function') return empty;

    const ownedCards = getIdentitiesByOwner(owner).map(id => {
        const c = identityHudState.cards[id];
        return { id, owned: c ? c.owned : true, unlocked: c ? !!c.unlocked : false };
    }).filter(c => c.owned).map(c => ({ id: c.id, unlocked: c.unlocked }));
    if (!ownedCards.length) return empty;

    // 與人格卡面板的計算一致：帶入先攻序位（延續進攻／向您致敬等依序位的條件）
    const attackerExtra = {};
    if (attackerUnit && typeof autoInitiativeRank === 'function') {
        attackerExtra.initiativeRank = autoInitiativeRank(attackerUnit.id);
    }
    const attackerState = (typeof buildEngineUnitState === 'function') ? buildEngineUnitState(attackerUnit, attackerExtra) : (attackerUnit || {});
    const targetState = (typeof buildEngineUnitState === 'function') ? buildEngineUnitState(targetUnit) : (targetUnit || {});
    // 疊加人格卡面板填寫的手動資源（意志力／魔法阿卡納層數等），
    // 否則依這些資源觸發的 DP／武器傷害加值在實際攻擊時永遠不會生效（面板顯示有、實戰卻沒有）
    if (typeof applyManualInputsToAttacker === 'function') {
        applyManualInputsToAttacker(ownedCards, attackerState);
    }
    const result = evaluatePlayerAttack(ownedCards, attackerState, targetState);

    // 人格引擎在攻擊／命中時會對目標（減益）與攻擊者自身（如迅捷/呼吸法等資源）施加的狀態。
    // 整理成「中文狀態名＋層數」清單，供發起攻擊時自動施加並在 ST 明細中列出。
    const buildStatusNotes = (statusMap) => Object.entries(statusMap).map(([engKey, layers]) => {
        const amount = parseInt(layers) || 0;
        if (!amount) return '';
        const name = (typeof identityStatusName === 'function') ? identityStatusName(engKey) : engKey;
        return `${name}+${amount}`;
    }).filter(Boolean);

    const onAttackTargetStatus = result.onAttackTargetStatus || {};
    const onAttackSelfStatus = result.onAttackSelfStatus || {};
    const onHitTargetStatus = result.onHitTargetStatus || {};
    const onHitSelfStatus = result.onHitSelfStatus || {};

    return {
        dpBonus: result.totalDpBonus || 0,
        extraSuccess: result.totalExtraSuccess || 0,
        names: [...new Set(result.triggerLogs.filter(l => !l.manual).map(l => l.identityName).filter(Boolean))],
        onAttackTargetStatus,
        statusNotes: buildStatusNotes(onAttackTargetStatus),
        onAttackSelfStatus,
        selfStatusNotes: buildStatusNotes(onAttackSelfStatus),
        onHitTargetStatus,
        onHitTargetStatusNotes: buildStatusNotes(onHitTargetStatus),
        onHitSelfStatus,
        onHitSelfStatusNotes: buildStatusNotes(onHitSelfStatus)
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
    // 自動擲骰參數：攻擊上限（0=無上限；BOSS 不受上限影響）與加骰門檻（10/9/8）
    const damageCap = Math.max(0, parseInt(document.getElementById('attack-damage-cap')?.value, 10) || 0);
    const explodeAt = parseInt(document.getElementById('attack-explode')?.value, 10) || 10;
    // 結算模式：防禦扣除（def，現行）或豁免抵擋（save：攻全額骰、目標擲豁免、傷害＝差值）
    const resolveMode = (document.getElementById('attack-resolve-mode')?.value === 'save') ? 'save' : 'def';
    const saveTypeRaw = document.getElementById('attack-save-type')?.value;
    const saveType = ['saveWill', 'saveReflex', 'saveTenacity'].includes(saveTypeRaw) ? saveTypeRaw : 'saveReflex';

    cmSaveMemo(ATTACK_MODAL_MEMO_KEY, { dp, auto, ignoreDef, critVicious, armorPierce, hastePierce, magicPierce, damageCap, explodeAt, resolveMode, saveType });

    // 攻擊方單位：玩家＝自己控制的單位；ST 發起威脅＝目前作用中的 BOSS（用於套用 BOSS 攻擊修正）
    let attackerUnit = null;
    if (typeof state !== 'undefined' && Array.isArray(state.units)) {
        attackerUnit = (myRole === 'st')
            ? (state.activeBossId ? state.units.find(u => u.id === state.activeBossId) : null)
            : state.units.find(u => u.ownerId === myPlayerId);
    }
    const targetUnit = typeof findUnitById === 'function' ? findUnitById(attackModalTarget.id) : null;
    const identityBonus = cmResolveIdentityBonus(attackerUnit, targetUnit);

    // 玩家發起攻擊：若本回合未對抗任何 BOSS 行動，自動套用對抗分配的自身 DP 加成。
    // 「未對抗加成」是 BOSS 多重行動（對抗分配）專屬規則——只有攻擊「該 BOSS 本體或其行動條目」
    // 時才生效；攻擊一般小怪／其他敵方單位不觸發。
    let counterPhaseDpBonus = 0;
    if (myRole !== 'st' && attackerUnit && typeof cpResolvePlayerMods === 'function'
        && typeof counterPhaseState !== 'undefined' && counterPhaseState.started) {
        const cpBossId = counterPhaseState.bossId;
        const isCounterBossTarget = !!(targetUnit && cpBossId
            && (targetUnit.id === cpBossId || targetUnit.actionSlotOf === cpBossId));
        if (isCounterBossTarget) {
            counterPhaseDpBonus = cpResolvePlayerMods(myPlayerId, attackerUnit.init || 0).selfBonus;
        }
    }

    const attacker = {
        // 廣播顯示名以「攻擊單位的名稱」為準（而非玩家代號 myName）；無單位時才退回代號
        id: myPlayerId, name: (attackerUnit && attackerUnit.name) ? attackerUnit.name : myName,
        unitId: attackerUnit ? attackerUnit.id : null,
        // ST 在此 Modal 一律操作 BOSS/怪物發起威脅，即便 id 仍是 ST 的 myPlayerId 也不算玩家攻擊；
        // 火力統計／AI 遭遇構築需以此區分，避免 ST 擲骰污染玩家平均火力。
        attackerRole: (myRole === 'st') ? 'enemy' : 'player',
        dp, auto, ignoreDef, critVicious,
        armorPierce, hastePierce, magicPierce,
        damageCap, explodeAt,
        resolveMode, saveType,
        identityDpBonus: identityBonus.dpBonus,
        identityExtraSuccess: identityBonus.extraSuccess,
        identityNotes: identityBonus.names,
        identityStatusNotes: identityBonus.statusNotes || [],
        identitySelfStatusNotes: identityBonus.selfStatusNotes || [],
        onHitTargetStatus: identityBonus.onHitTargetStatus || {},
        onHitTargetStatusNotes: identityBonus.onHitTargetStatusNotes || [],
        onHitSelfStatus: identityBonus.onHitSelfStatus || {},
        onHitSelfStatusNotes: identityBonus.onHitSelfStatusNotes || [],
        counterPhaseDpBonus
    };
    const target = { id: attackModalTarget.id, name: attackModalTarget.name };

    // 豁免抵擋模式：收集勾選的多個攻擊對象（各目標分別擲豁免）；未勾任何目標時退回原始右鍵目標
    let targets = null;
    if (resolveMode === 'save') {
        const checked = Array.from(document.querySelectorAll('#attack-multi-targets .atk-target-check:checked'));
        targets = checked
            .map(c => {
                const u = (typeof findUnitById === 'function') ? findUnitById(c.value) : null;
                return u ? { id: u.id, name: u.name || '目標' } : null;
            })
            .filter(Boolean);
        if (!targets.length) targets = [target];
    }

    if (myRole === 'st') {
        // 豁免抵擋模式：不需要玩家填防禦 QTE（用目標填好的三豁免自動對擲），直接進入計算
        if (resolveMode === 'save') {
            cqInitiateAttack({ attacker, target: targets[0], targets });
        } else {
            cqInitiateThreat({ attacker, target });
        }
        // 所選 BOSS 行動的狀態自動施加到目標玩家單位（豁免模式套用到全部勾選目標）
        if (threatPendingStatuses.length && typeof addStatusToUnit === 'function') {
            const applied = [];
            const statusTargets = (resolveMode === 'save') ? targets : [target];
            statusTargets.forEach(t => {
                threatPendingStatuses.forEach(s => {
                    addStatusToUnit(t.id, s.id, s.stacks > 0 ? s.stacks : null);
                });
            });
            threatPendingStatuses.forEach(s => {
                const nm = (typeof getStatusDisplayName === 'function') ? getStatusDisplayName(s.id) : s.id;
                applied.push(nm + (s.stacks > 0 ? ' x' + s.stacks : ''));
            });
            if (applied.length && typeof showToast === 'function') showToast('已對目標施加：' + applied.join('、'));
        }
        threatPendingStatuses = [];
        if (typeof showToast === 'function') {
            showToast(resolveMode === 'save' ? '威脅已發起（豁免抵擋），攻擊骰已自動擲出，請至審核面板輸入豁免...' : '威脅已發起，等待玩家防禦...');
        }
    } else {
        cqInitiateAttack(resolveMode === 'save' ? { attacker, target: targets[0], targets } : { attacker, target });

        // 人格引擎判定本次攻擊會對目標施加的負面狀態，於發起攻擊時自動套用到目標單位，
        // 讓 ST 不需在審核時手動補上玩家人格給予的減益。
        if (identityBonus.onAttackTargetStatus && typeof applyEngineStatusesToUnit === 'function') {
            const applied = applyEngineStatusesToUnit(target.id, identityBonus.onAttackTargetStatus);
            if (applied && identityBonus.statusNotes.length && typeof showToast === 'function') {
                showToast('攻擊宣告效果已對目標施加：' + identityBonus.statusNotes.join('、'));
            }
        }

        // 對稱處理：人格引擎判定本次攻擊會對攻擊者自身施加的狀態（如迅捷、呼吸法等資源），
        // 同樣於發起攻擊時自動套用到攻擊者自己的單位。
        if (identityBonus.onAttackSelfStatus && attackerUnit && typeof applyEngineStatusesToUnit === 'function') {
            const appliedSelf = applyEngineStatusesToUnit(attackerUnit.id, identityBonus.onAttackSelfStatus);
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
    const saveInfo = (data.saveInfo && typeof data.saveInfo === 'object') ? data.saveInfo : null;
    if (reviewModal) {
        reviewModal.dataset.baseDice = String(baseDice);
        reviewModal.dataset.baseExtraSuccess = String(baseExtraSuccess);
        // 防禦方 id 一併釘上：確認廣播時自動消耗其受擊消耗狀態（破裂/震顫）
        reviewModal.dataset.targetId = (data.target && data.target.id) ? String(data.target.id) : '';
        // 豁免抵擋模式：完整 saveInfo（攻擊擲骰結果＋目標清單）釘上，確認時對擲
        reviewModal.dataset.saveInfo = saveInfo ? JSON.stringify(saveInfo) : '';
    }

    // 豁免抵擋模式：攻擊已自動擲出，顯示成功數並開啟豁免輸入區；防禦扣除模式維持原顯示
    const saveSection = document.getElementById('st-review-save-section');
    const modifierLabel = document.getElementById('st-review-modifier-label');
    if (saveInfo && saveInfo.atkRoll) {
        const ar = saveInfo.atkRoll;
        const extraTxt = baseExtraSuccess > 0 ? ` ＋ 附加成功 ${baseExtraSuccess}` : '';
        document.getElementById('st-review-suggested').innerText =
            `🎲 攻擊已擲：${ar.totalRolled} 顆 → ${ar.successes} 成功${extraTxt}（${saveInfo.saveName || '豁免'}抵擋）`;
        if (saveSection) {
            saveSection.style.display = 'block';
            const saveLabel = document.getElementById('st-review-save-label');
            if (saveLabel) saveLabel.textContent = `${saveInfo.saveName || '豁免'}豁免骰數（套用到所有目標）`;
            const saveDiceInput = document.getElementById('st-review-save-dice');
            if (saveDiceInput) saveDiceInput.value = Math.max(0, parseInt(saveInfo.saveDice, 10) || 0);
            const saveExtraInput = document.getElementById('st-review-save-extra');
            if (saveExtraInput) saveExtraInput.value = 0;
            const targetBox = document.getElementById('st-review-save-targets');
            if (targetBox) {
                targetBox.textContent = '目標：' + (saveInfo.targets || [])
                    .map(t => `${t.name}（${saveInfo.saveName || '豁免'} ${t.saveDice} 顆）`)
                    .join('、');
            }
        }
        if (modifierLabel) modifierLabel.textContent = '最終調整（直接增減傷害）';
    } else {
        if (saveSection) saveSection.style.display = 'none';
        if (modifierLabel) modifierLabel.textContent = '最終微調增減';
        // DP 與附加成功是兩種不同的東西，分開顯示，絕不相加成單一數字
        const extraTxt = baseExtraSuccess > 0 ? ` + 附加成功 ${baseExtraSuccess}` : '';
        document.getElementById('st-review-suggested').innerText = `系統建議骰數：${baseDice} 顆${extraTxt}`;
    }

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
        if (saveInfo) rows.push({
            label: '結算模式',
            value: `豁免抵擋：目標${saveInfo.saveName || '豁免'} ${Math.max(0, parseInt(saveInfo.saveDice, 10) || 0)} 顆自動對擲（傷害 = 攻擊成功+附加 − 豁免成功）`,
            cls: 'is-resource'
        });
        // 無視防禦已由黑箱引擎直接扣減防禦、反映在「系統建議骰數」中；明確標示為已套用（綠色加成），
        // 避免 ST 誤以為尚未計入而再手動扣一次，導致最終傷害反而變低。
        if (ignoreDef > 0)            rows.push({ label: '無視防禦', value: `−${ignoreDef} 防禦（已計入建議骰數）`, cls: 'is-bonus' });
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
        if (Array.isArray(atk.onHitTargetStatusNotes) && atk.onHitTargetStatusNotes.length)
            rows.push({ label: '命中對目標施加', value: atk.onHitTargetStatusNotes.join('、'), cls: 'is-penalty' });
        if (Array.isArray(atk.onHitSelfStatusNotes) && atk.onHitSelfStatusNotes.length)
            rows.push({ label: '命中對自己施加', value: atk.onHitSelfStatusNotes.join('、'), cls: 'is-bonus' });

        // 防禦方身上的「受擊消耗」狀態（破裂/震顫）：提示 ST 本次結算需計入其效果，
        // 確認廣播後會自動清除層數
        const targetUnit = (data.target && data.target.id && typeof findUnitById === 'function')
            ? findUnitById(data.target.id) : null;
        const consumable = (typeof listConsumeOnAttackedStatuses === 'function')
            ? listConsumeOnAttackedStatuses(targetUnit) : [];
        if (consumable.length) {
            rows.push({
                label: '目標受擊消耗',
                value: consumable.map(s => `${s.name} ${s.stacks} 層`).join('、') + '（廣播後自動清除）',
                cls: 'is-penalty'
            });
        }

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
    // 還原上次的自動擲骰開關選擇（預設開啟）
    const autorollBox = document.getElementById('st-review-autoroll');
    if (autorollBox) {
        let saved = null;
        try { saved = localStorage.getItem('limbus-st-autoroll'); } catch (e) { /* ignore */ }
        autorollBox.checked = saved === null ? true : saved === '1';
    }
    openModal('st-review-modal');
}

const ST_AUTOROLL_KEY = 'limbus-st-autoroll';

function confirmSTReview() {
    // 優先從 Modal 的 data-* 屬性讀取初步骰數（cqOnSTReview 渲染時已釘上），
    // 全域 combatQueueLast 僅作為退路，避免監聽器更新時序造成骰數讀成 0。
    const reviewModal = document.getElementById('st-review-modal');
    const ds = reviewModal ? reviewModal.dataset : {};

    // 豁免抵擋模式：攻擊已於黑箱端擲出，此處只需擲目標豁免並對銷，走專屬流程
    let saveInfo = null;
    if (ds.saveInfo) {
        try { saveInfo = JSON.parse(ds.saveInfo); } catch (e) { saveInfo = null; }
    }
    if (saveInfo && saveInfo.atkRoll) {
        confirmSTReviewSaveMode(saveInfo);
        return;
    }

    const dsDice = parseInt(ds.baseDice, 10);
    const dsExtra = parseInt(ds.baseExtraSuccess, 10);
    const baseDice = Number.isFinite(dsDice) ? dsDice : ((combatQueueLast && combatQueueLast.baseDice) || 0);
    const baseExtraSuccess = Number.isFinite(dsExtra) ? dsExtra : ((combatQueueLast && combatQueueLast.baseExtraSuccess) || 0);

    const STModifier = document.getElementById('st-review-modifier').value;
    const modifier = parseInt(STModifier, 10) || 0;
    // 微調僅套用於骰數，附加成功維持黑箱原值（兩者分開，不相加）
    const finalDice = Math.max(0, parseInt(baseDice, 10) + modifier);

    // 記住自動擲骰開關的選擇
    const autorollBox = document.getElementById('st-review-autoroll');
    const autoroll = autorollBox ? autorollBox.checked : false;
    try { localStorage.setItem(ST_AUTOROLL_KEY, autoroll ? '1' : '0'); } catch (e) { /* ignore */ }

    // ===== 自動擲骰＋套用傷害（骰數 0 的機運骰情境維持手動）=====
    let rollResult = null;
    const targetId = ds.targetId || '';
    if (autoroll && finalDice > 0 && typeof bbRollAttackDice === 'function') {
        rollResult = cmAutoRollAndApply(finalDice, baseExtraSuccess, targetId);
    }

    closeModal('st-review-modal');
    cqBroadcastResult(finalDice, baseExtraSuccess, modifier, rollResult);

    // 攻擊結算完成：自動消耗防禦方身上的受擊消耗狀態（破裂/震顫），ST 不必手動歸零。
    // ⚠️ 順序關鍵：必須在「命中狀態套用」之前消耗——
    //   1) cmAutoRollAndApply 已把本次攻擊前既有的破裂層數計入傷害，此處清掉的是那批；
    //   2) 本次命中新施加的破裂/震顫屬於「下一次攻擊」的資源，若先套用再消耗，
    //      會被立刻清空且震顫錯誤地立即削減生命上限。
    if (targetId && typeof consumeOnAttackedStatuses === 'function') {
        const result = consumeOnAttackedStatuses(targetId);
        if (result.consumed.length && typeof showToast === 'function') {
            let msg = '💥 已自動消耗目標的 ' + result.consumed.map(s => `${s.name} ${s.stacks} 層`).join('、');
            if (result.maxHpCut > 0) msg += `；生命上限 −${result.maxHpCut}`;
            showToast(msg);
        }
    }

    // 命中判定後套用「命中時施加」的人格卡狀態（成功數 > 0 視為命中）。
    // 手動擲骰（autoroll 關閉）時無從得知命中與否，由 ST 依審核提示列自行套用。
    if (autoroll && rollResult && rollResult.successes > 0 && combatQueueLast && combatQueueLast.attacker) {
        const atk = combatQueueLast.attacker;
        if (atk.onHitTargetStatus && typeof applyEngineStatusesToUnit === 'function' && targetId) {
            const appliedTgt = applyEngineStatusesToUnit(targetId, atk.onHitTargetStatus);
            if (appliedTgt && atk.onHitTargetStatusNotes && atk.onHitTargetStatusNotes.length && typeof showToast === 'function') {
                showToast('命中效果已對目標施加：' + atk.onHitTargetStatusNotes.join('、'));
            }
        }
        if (atk.onHitSelfStatus && typeof applyEngineStatusesToUnit === 'function' && atk.unitId) {
            const appliedSelf = applyEngineStatusesToUnit(atk.unitId, atk.onHitSelfStatus);
            if (appliedSelf && atk.onHitSelfStatusNotes && atk.onHitSelfStatusNotes.length && typeof showToast === 'function') {
                showToast('命中效果已對自己套用：' + atk.onHitSelfStatusNotes.join('、'));
            }
        }
    }
}

/**
 * ST 端：自動擲骰並把最終傷害套用到防禦方（防禦扣除模式）。
 * 傷害計算：擲骰成功數（8/9/10 成功、依攻擊方宣告的加骰門檻追加骰子）＋ 附加成功
 * ＋ 目標身上的破裂（受擊消耗）與易損層數 → 合計後玩家攻擊受「攻擊上限」封頂
 * （破裂/易損計入上限內；BOSS 攻擊不受限）
 * → 以 L 傷套用（「嚴重轉惡性」宣告點數的部分轉為 A 傷），走護盾吸收邏輯。
 * 擲骰明細（各骰點數、10 的數量）隨廣播同步，供「骰到兩個 10 觸發」類人格卡判定。
 * 注意：豁免抵擋模式走 confirmSTReviewSaveMode，不經此函式。
 * @returns {object} rollResult（隨廣播同步給所有客戶端顯示）
 */
function cmAutoRollAndApply(finalDice, extraSuccess, targetId) {
    const atk = (combatQueueLast && combatQueueLast.attacker) || {};
    const isPlayerAttack = atk.attackerRole === 'player';
    const explodeAt = parseInt(atk.explodeAt, 10) || 10;

    const roll = bbRollAttackDice(finalDice, explodeAt);
    const tens = roll.rolls.filter(d => d === 10).length;

    // 目標身上的破裂（本次受擊消耗）與易損：受到的傷害 +層數（計入攻擊上限）
    const targetUnit = (typeof findUnitById === 'function' && targetId) ? findUnitById(targetId) : null;
    let statusBonus = 0;
    const statusBonusParts = [];
    if (targetUnit && targetUnit.status && typeof getStatusByName === 'function') {
        for (const [name, raw] of Object.entries(targetUnit.status)) {
            const def = getStatusByName(name);
            if (!def) continue;
            const stacks = parseInt(raw) || 0;
            if (stacks <= 0) continue;
            // 破裂＝受擊消耗且加傷；易損＝常駐加傷
            if (def.id === 'fragile' || def.id === 'vulnerable') {
                statusBonus += stacks;
                statusBonusParts.push(`${name}+${stacks}`);
            }
        }
    }

    // 總和 = 成功數 + 附加成功 + 破裂/易損加傷 → 攻擊上限封頂（僅玩家攻擊；BOSS 無上限）
    const totalBeforeCap = roll.successes + (Number(extraSuccess) || 0) + statusBonus;
    const cap = isPlayerAttack ? Math.max(0, parseInt(atk.damageCap, 10) || 0) : 0;
    const capApplied = (cap > 0 && totalBeforeCap > cap);
    const damage = capApplied ? cap : totalBeforeCap;

    // 套用傷害：L 傷為主，「嚴重轉惡性」宣告的點數轉為 A 傷；走護盾吸收
    if (targetUnit && Array.isArray(targetUnit.hpArr) && typeof modifyHPInternal === 'function' && damage > 0) {
        const aPart = Math.min(Math.max(0, parseInt(atk.critVicious, 10) || 0), damage);
        const lPart = damage - aPart;
        if (aPart > 0) modifyHPInternal(targetUnit, 'a', aPart);
        if (lPart > 0) modifyHPInternal(targetUnit, 'l', lPart);
    }
    if (typeof broadcastState === 'function') broadcastState();

    return {
        rolls: roll.rolls,             // 各骰點數明細（供「骰到 N 個 10 觸發」類人格卡判定）
        tens: tens,                    // 骰出 10 的數量
        successes: roll.successes,
        exploded: roll.explodedCount,
        totalRolled: roll.totalRolled,
        explodeAt: explodeAt,
        extraSuccess: Number(extraSuccess) || 0,
        totalBeforeCap: totalBeforeCap,
        cap: cap,
        capApplied: capApplied,
        statusBonus: statusBonus,
        statusBonusText: statusBonusParts.join('、'),
        damage: damage
    };
}

/**
 * ST 端：豁免抵擋模式的確認結算。
 * 攻擊已於黑箱端擲出（saveInfo.atkRoll.successes）；此處讀取 ST 輸入的
 * 豁免骰數／豁免附加成功／最終調整，替每個目標各擲一次豁免骰對銷：
 *   每目標傷害 = max(0, 攻擊成功 + 攻擊附加 − 豁免成功 − 豁免附加 + 最終調整)
 * 逐目標套用（護盾優先消耗），結算後廣播逐目標結果並寫入戰鬥日誌。
 * @param {object} saveInfo - 黑箱釘上的豁免資訊（含 atkRoll 與 targets）
 */
function confirmSTReviewSaveMode(saveInfo) {
    const atk = (combatQueueLast && combatQueueLast.attacker) || {};
    const reviewModal = document.getElementById('st-review-modal');
    const baseExtra = Math.max(0, parseInt(reviewModal && reviewModal.dataset.baseExtraSuccess, 10) || 0);
    const atkSuccess = Math.max(0, parseInt(saveInfo.atkRoll.successes, 10) || 0);

    const saveDiceInput = Math.max(0, parseInt(document.getElementById('st-review-save-dice')?.value, 10) || 0);
    const saveExtra = Math.max(0, parseInt(document.getElementById('st-review-save-extra')?.value, 10) || 0);
    const adjust = parseInt(document.getElementById('st-review-modifier')?.value, 10) || 0;
    const saveName = saveInfo.saveName || '豁免';

    const targets = (Array.isArray(saveInfo.targets) && saveInfo.targets.length)
        ? saveInfo.targets
        : [{ id: (combatQueueLast && combatQueueLast.target && combatQueueLast.target.id) || '', name: '目標', saveDice: saveDiceInput }];

    // 攻擊命中總量（成功 + 附加），逐目標扣豁免；「嚴重轉惡性」點數部分轉 A 傷
    const atkHitTotal = atkSuccess + baseExtra;
    const critVicious = Math.max(0, parseInt(atk.critVicious, 10) || 0);

    const results = targets.map(t => {
        // ST 輸入的豁免骰數統一套用到所有目標（面板預填第一個目標的預設值，ST 可改）；
        // saveDiceInput 為 0 且該目標有自帶預設時，回退用目標預設，避免誤填 0 導致全額傷害
        const pool = saveDiceInput > 0 ? saveDiceInput : Math.max(0, parseInt(t.saveDice, 10) || 0);
        const saveRoll = (typeof bbRollAttackDice === 'function') ? bbRollAttackDice(pool, 10) : { successes: 0 };
        const dmg = Math.max(0, atkHitTotal - saveRoll.successes - saveExtra + adjust);

        const u = (typeof findUnitById === 'function' && t.id) ? findUnitById(t.id) : null;
        if (u && Array.isArray(u.hpArr) && typeof modifyHPInternal === 'function' && dmg > 0) {
            const aPart = Math.min(critVicious, dmg);
            const lPart = dmg - aPart;
            if (aPart > 0) modifyHPInternal(u, 'a', aPart);
            if (lPart > 0) modifyHPInternal(u, 'l', lPart);
        }
        return { name: (u && u.name) || t.name || '目標', pool, saveSuccess: saveRoll.successes, dmg };
    });

    if (typeof broadcastState === 'function') broadcastState();

    const attackerName = String(atk.name || 'BOSS');
    const detail = results.map(r => `${r.name}(${saveName}${r.saveSuccess}→受${r.dmg})`).join('、');
    const summary = `【${attackerName}】豁免抵擋：攻擊 ${atkSuccess}${baseExtra ? `+附${baseExtra}` : ''} 成功｜${detail}`;

    // 戰鬥日誌
    if (typeof bbPushCombatLog === 'function') {
        bbPushCombatLog({
            entryType: 'attack',
            attackerName: attackerName,
            attackerRole: (atk.attackerRole === 'player') ? 'player' : 'enemy',
            defenderName: results.map(r => r.name).join(', '),
            broadcastText: summary,
            round: (typeof state !== 'undefined' && state.roundNum) || 0,
            damage: results.reduce((s, r) => s + r.dmg, 0)
        });
    }

    // 全場廣播橫幅
    const banner = document.getElementById('combat-broadcast-banner');
    if (banner) {
        banner.textContent = summary;
        banner.classList.add('show');
        setTimeout(() => banner.classList.remove('show'), 4500);
    }

    closeModal('st-review-modal');
    if (reviewModalClearSaveInfo) reviewModalClearSaveInfo();

    // 逐目標結果清單彈窗（ST 端確認用）
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
    const rows = results.map(r => `
        <div class="aoe-save-result-row${r.dmg > 0 ? ' hit' : ' resisted'}">
            <span class="asr-name">${esc(r.name)}</span>
            <span class="asr-roll">${esc(saveName)} ${r.pool} 顆 → ${r.saveSuccess} 成功</span>
            <span class="asr-dmg">${r.dmg > 0 ? `受 ${r.dmg} 傷` : '完全抵擋'}</span>
        </div>`).join('');
    const html = `
        <div class="modal-overlay show" id="save-mode-results" onclick="if(event.target.id==='save-mode-results')document.getElementById('save-mode-results').remove()">
            <div class="modal" style="max-width:420px;" onclick="event.stopPropagation()">
                <div class="modal-header modal-header--combat">
                    <span style="font-weight:bold;">🎲 豁免抵擋結果</span>
                    <button onclick="document.getElementById('save-mode-results').remove()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div style="font-size:0.85rem;color:var(--accent-orange);margin-bottom:4px;">⚔ 攻擊 ${atkSuccess} 成功${baseExtra ? ` ＋ 附加 ${baseExtra}` : ''}${adjust ? `，調整 ${adjust > 0 ? '+' : ''}${adjust}` : ''}</div>
                    ${rows}
                    <div style="font-size:0.72rem;color:var(--text-dim);margin-top:6px;">傷害已套用（護盾優先消耗）。</div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="document.getElementById('save-mode-results').remove()" style="background:var(--accent-green);color:#000;">確認</button>
                </div>
            </div>
        </div>`;
    (document.getElementById('modals-container') || document.body).insertAdjacentHTML('beforeend', html);

    if (typeof cqReset === 'function') cqReset();
    if (typeof renderAll === 'function') renderAll();
}

/** 清掉審核 Modal 上釘的 saveInfo，避免殘留到下一場防禦扣除攻擊 */
function reviewModalClearSaveInfo() {
    const m = document.getElementById('st-review-modal');
    if (m) { delete m.dataset.saveInfo; }
    const sec = document.getElementById('st-review-save-section');
    if (sec) sec.style.display = 'none';
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
 * 渲染浮動面板內容（依狀態分三種視圖）：
 *  1) 未送出／按「修改」且未公佈：可勾選的行動清單＋送出按鈕（送出後、公佈前可再修改）
 *  2) 已送出、未公佈：即時顯示各行動目前由誰對抗＋「修改我的選擇」按鈕
 *  3) ST 已公佈：最終結果視圖（含自己的 DP 修正摘要），鎖定不可再改
 */
let cpEditingAssign = false;   // 玩家按「修改我的選擇」進入重新勾選模式
let cpEditingRound = -1;       // 修改模式對應的輪次（換輪自動退出）

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
    const finalized = !!counterPhaseState.finalized;
    const mine = (myRole !== 'st') ? assignments[myPlayerId] : undefined;
    const hasSubmitted = mine !== undefined;
    const myIds = (typeof cpAsArray === 'function') ? cpAsArray(mine) : (Array.isArray(mine) ? mine : []);
    if (cpEditingRound !== counterPhaseState.roundId) cpEditingAssign = false;

    // 視圖 1：可勾選（未送出，或按了「修改」且 ST 尚未公佈）
    if (myRole !== 'st' && !finalized && (!hasSubmitted || cpEditingAssign)) {
        const rows = actions.map(a => `
            <label class="counter-assign-row">
                <input type="checkbox" value="${a.id}" class="counter-float-check counter-assign-check" ${myIds.includes(a.id) ? 'checked' : ''}>
                <span>${escapeHtml(a.label)}（先攻 ${a.init}）</span>
            </label>
        `).join('');
        body.innerHTML = `
            <p style="font-size:0.8rem;color:var(--text-dim);margin:0 0 6px;">勾選你這回合要對抗的 BOSS 行動（可複選，可不選）。送出後在 ST 公佈結果前仍可修改。未勾選任何行動，本回合你的攻擊 DP 會自動加成。</p>
            ${rows || '<div class="bb-hint">尚無行動資料</div>'}
            <button class="modal-btn" onclick="submitCounterAssign()" style="background:var(--accent-green);width:100%;margin-top:8px;">送出${hasSubmitted ? '修改' : ''}</button>
        `;
        return;
    }

    // 視圖 2 / 3：唯讀顯示每個行動目前（或最終）的對抗狀態
    const rows = actions.map(a => {
        const r = (typeof cpResolveActionMod === 'function') ? cpResolveActionMod(a.id) : { playerName: '', mod: 0 };
        const statusHtml = r.playerId
            ? `<span class="ca-taken">${escapeHtml(r.playerName)}（DP ${r.mod >= 0 ? '+' : ''}${r.mod}）</span>`
            : `<span class="ca-waiting">${finalized ? '無人對抗' : '等待對抗中……'}</span>`;
        return `<div class="counter-float-row"><span>${escapeHtml(a.label)}</span>${statusHtml}</div>`;
    }).join('');
    const submittedCount = Object.keys(assignments).length;

    const head = finalized
        ? '<div class="cp-final-badge">📢 最終結果已公佈</div>'
        : `<div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">已送出 ${submittedCount} 人（ST 公佈前可修改）</div>`;

    let footer = '';
    if (myRole !== 'st' && !finalized && hasSubmitted) {
        footer = '<button class="modal-btn" onclick="cpEditAssign()" style="background:var(--bg-card);width:100%;margin-top:8px;">✏️ 修改我的選擇</button>';
    } else if (myRole !== 'st' && finalized) {
        // 自己的最終修正摘要
        const meUnit = (typeof state !== 'undefined' && Array.isArray(state.units))
            ? state.units.find(u => u.ownerId === myPlayerId) : null;
        const mods = (typeof cpResolvePlayerMods === 'function')
            ? cpResolvePlayerMods(myPlayerId, meUnit ? (meUnit.init || 0) : 0)
            : { selfBonus: 0 };
        footer = mods.selfBonus > 0
            ? `<div class="cp-self-bonus">你本回合未對抗任何行動：自身攻擊 DP <b>+${mods.selfBonus}</b></div>`
            : `<div class="cp-self-bonus">你本回合對抗 ${myIds.length} 個行動（BOSS 該行動 DP 修正見上方清單）</div>`;
    }
    body.innerHTML = head + rows + footer;
}

/** 玩家：重新進入勾選模式修改自己的分配（ST 公佈前有效） */
function cpEditAssign() {
    if (counterPhaseState.finalized) return;
    cpEditingAssign = true;
    cpEditingRound = counterPhaseState.roundId;
    cpRenderFloatPanel();
}

function submitCounterAssign() {
    const checks = document.querySelectorAll('#counter-float-body .counter-assign-check:checked');
    const ids = Array.from(checks).map(c => c.value);
    cpSubmitAssignment(ids);
    cpEditingAssign = false;
    if (typeof showToast === 'function') showToast('已送出本回合對抗分配');
    // assignments 會透過 Firebase 監聽回流並自動重新渲染為唯讀狀態，這裡先樂觀渲染避免畫面延遲
    cpRenderFloatPanel();
}

/**
 * 顯示浮動面板。
 * 若被收納在右緣邊條：預設「尊重收納狀態」不強制彈出（閃爍邊條提示），
 * 玩家自己按住圖標拖出來看；forceRestore=true（快捷球等顯式操作）才還原（置中出現）。
 */
function cpShowFloatPanel(forceRestore) {
    const panel = document.getElementById('counter-float-panel');
    if (!panel) return;
    // 收納狀態同時檢查 PanelDock（記憶體）與 localStorage（持久化）：
    // 頁面載入初期若收納還原尚未完成，僅靠記憶體判斷會把收納中的面板誤彈出到畫面上
    let dockPersisted = false;
    try { dockPersisted = !!(JSON.parse(localStorage.getItem('limbus_counter_float_panel') || '{}').isDocked); } catch (e) { /* ignore */ }
    if ((typeof PanelDock !== 'undefined' && PanelDock.isDocked('counter-float-panel')) || dockPersisted) {
        if (!forceRestore) {
            if (typeof PanelDock !== 'undefined') {
                PanelDock.setHint(true);
                setTimeout(() => PanelDock.setHint(false), 1600);
            }
            if (typeof showToast === 'function') showToast('⚔️ 對抗分配面板收納於右側邊條，按住圖標拖出查看');
            return;
        }
        if (typeof PanelDock !== 'undefined') PanelDock.restore('counter-float-panel');
    }
    panel.classList.remove('hidden');
    if (typeof WindowManager !== 'undefined') WindowManager.bringToFront(panel);
}

/** 關閉浮動面板（玩家可隨時關閉，之後可由快捷球重新開啟）。 */
function cpCloseFloatPanel(event) {
    if (event) event.stopPropagation();
    const panel = document.getElementById('counter-float-panel');
    if (panel) panel.classList.add('hidden');
}

/** 快捷球「本回合對抗分配」選單項：顯式開啟 → 即使收納中也還原（置中出現）。 */
function cpToggleFloatPanel() {
    cpShowFloatPanel(true);
    cpRenderFloatPanel();
}

/**
 * 初始化：把對抗分配面板接上通用浮動面板（標頭拖曳／雙擊收起／右緣磁鐵收納）。
 * 舊的「雙擊縮放 (zoomed)」已由標準的收起／展開取代。
 */
function cpInitFloatPanel() {
    if (typeof makeFloatingPanel !== 'function') return;
    makeFloatingPanel({
        panelId: 'counter-float-panel',
        headerId: 'counter-float-header',
        collapseBtnId: 'counter-float-collapse',
        storageKey: 'limbus_counter_float_panel',
        // 預設置中偏上（不擋戰場中央操作，也不再窩在右下角）
        defaultPos: { x: Math.max(20, Math.round((window.innerWidth - 330) / 2)), y: Math.max(60, Math.round(window.innerHeight * 0.18)) },
        dock: { icon: '⚔️', title: '本回合對抗分配' },
        restoreDock: true,
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cpInitFloatPanel);
} else {
    cpInitFloatPanel();
}

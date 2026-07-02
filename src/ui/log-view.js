/**
 * Limbus Command - 戰鬥日誌與 AI 遭遇構築室（系統 A）
 *
 * 職責：
 *  1. 監聽 Firebase /rooms/{roomId}/combatLogs，以聊天室風格渲染最近 100 筆戰鬥廣播。
 *  2. ST 面板：統計最近 20 筆玩家攻擊的「平均擲骰數」(Average DPS)。
 *  3. ST 面板：AI 動態遭遇生成器 —— 依玩家火力請 AI 產生可承受該火力的怪物 JSON，
 *     預覽後一鍵存入「怪物庫」(localStorage)，並可一鍵部署到場上。
 *
 * 權限分離：玩家只渲染「戰鬥日誌區」；ST 另外顯示右側「AI 遭遇生成面板」與 DPS 統計。
 * 防禦性：所有 Firebase / DOM / AI 操作皆以 typeof 與 try-catch 防呆，絕不影響地圖與單位同步。
 */

// ===== 本地狀態 =====
const LV_MONSTER_LIB_KEY = 'limbus-monster-library';
// 沿用人格鍛造爐的 AI 連線設定（同一組 localStorage 金鑰）
const LV_AI_ENDPOINT_KEY = 'limbus-ai-endpoint';
const LV_AI_KEY_KEY = 'limbus-ai-key';
const LV_AI_MODEL_KEY = 'limbus-ai-model';
const LV_AI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const LV_AI_DEFAULT_MODEL = 'gpt-4o-mini';

let lvCombatLogs = []; // [{ timestamp, attackerName, defenderName, finalDice, attackerRole: 'player'|'enemy', broadcastText }]
let lvLogEditMode = false;
let lvSelectedLogs = new Set();

function lvGetSetting(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}

// ===== Firebase 監聽（由 setupRoomListeners 呼叫，沿用 cqSetupListener 模式） =====
function logViewSetupListener() {
    if (typeof roomRef === 'undefined' || !roomRef) return;
    // 套用權限：玩家隱藏 AI 構築面板與 DPS 統計
    lvApplyRolePermissions();

    const ref = roomRef.child('combatLogs').limitToLast(100);
    const listener = ref.on('value', snapshot => {
        const val = snapshot.val();
        lvCombatLogs = val
            ? Object.keys(val).map(k => {
                if (val[k]) val[k].id = k;
                return val[k];
            }).filter(Boolean)
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
            : [];
        renderCombatLogs();
        lvRenderDpsStat();
    });
    if (typeof unsubscribeListeners !== 'undefined') {
        unsubscribeListeners.push(() => roomRef.child('combatLogs').off('value', listener));
    }

    lvRenderMonsterLibrary();
}

function lvApplyRolePermissions() {
    const isST = (typeof myRole !== 'undefined' && myRole === 'st');
    const encPanel = document.getElementById('encounter-panel');
    if (encPanel) encPanel.style.display = isST ? 'flex' : 'none';
    const dps = document.getElementById('log-dps-stat');
    if (dps) dps.style.display = isST ? 'block' : 'none';

    // Add edit button if ST
    if (isST) {
        let logHeader = document.querySelector('.log-panel-header');
        if (logHeader && !document.getElementById('log-edit-toggle')) {
            const editGroup = document.createElement('div');
            editGroup.style.display = 'flex';
            editGroup.style.gap = '5px';

            const editBtn = document.createElement('button');
            editBtn.id = 'log-edit-toggle';
            editBtn.className = 'action-btn';
            editBtn.style.padding = '2px 8px';
            editBtn.innerHTML = '✎ 編輯日誌';
            editBtn.onclick = toggleLogEditMode;

            const delBtn = document.createElement('button');
            delBtn.id = 'log-delete-selected';
            delBtn.className = 'action-btn danger';
            delBtn.style.padding = '2px 8px';
            delBtn.style.display = 'none';
            delBtn.innerHTML = '🗑️ 刪除選取項目';
            delBtn.onclick = deleteSelectedLogs;

            editGroup.appendChild(editBtn);
            editGroup.appendChild(delBtn);

            logHeader.appendChild(editGroup);
        }
    }
}


function toggleLogEditMode() {
    lvLogEditMode = !lvLogEditMode;
    lvSelectedLogs.clear();

    const delBtn = document.getElementById('log-delete-selected');
    if (delBtn) delBtn.style.display = lvLogEditMode ? 'inline-block' : 'none';

    const editBtn = document.getElementById('log-edit-toggle');
    if (editBtn) editBtn.innerHTML = lvLogEditMode ? '完成編輯' : '✎ 編輯日誌';

    renderCombatLogs();
}

function toggleLogSelection(id) {
    if (lvSelectedLogs.has(id)) {
        lvSelectedLogs.delete(id);
    } else {
        lvSelectedLogs.add(id);
    }
}

function deleteSelectedLogs() {
    if (lvSelectedLogs.size === 0) return;
    if (typeof roomRef === 'undefined' || !roomRef) return;

    const updates = {};
    lvSelectedLogs.forEach(id => {
        updates[`combatLogs/${id}`] = null;
    });

    roomRef.update(updates).then(() => {
        lvSelectedLogs.clear();
        toggleLogEditMode(); // Exit edit mode after deletion
    }).catch(e => console.error('Failed to delete logs:', e));
}

// ===== 戰鬥日誌渲染 =====
function renderCombatLogs() {
    const list = document.getElementById('combat-log-list');
    if (!list) return;

    // 以 DOM 節點 + textContent 建構，避免把跨客戶端的使用者資料（玩家名稱等）
    // 透過 innerHTML 注入，從根本杜絕 XSS。
    list.textContent = '';

    if (!lvCombatLogs.length) {
        const empty = document.createElement('div');
        empty.className = 'log-empty';
        empty.textContent = '尚無戰鬥紀錄。發起攻擊並廣播後，日誌會即時出現在這裡。';
        list.appendChild(empty);
        return;
    }

    const frag = document.createDocumentFragment();
    for (const log of lvCombatLogs) {
        const t = log.timestamp ? new Date(log.timestamp) : null;
        const timeStr = t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';

        // 編輯模式下整行用 <label> 包覆 checkbox：點擊行內任何地方都會原生觸發勾選，
        // 不需手動轉發點擊事件，也不會有「點兩次互相抵銷」的問題。
        const editable = lvLogEditMode && log.id;
        const row = document.createElement(editable ? 'label' : 'div');
        row.className = 'log-row ' + (log.attackerRole === 'player' ? 'log-row-player' : 'log-row-enemy');

        if (editable) {
            row.classList.add('log-row-editable');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.style.marginRight = '8px';
            cb.checked = lvSelectedLogs.has(log.id);
            cb.onchange = () => toggleLogSelection(log.id);
            row.appendChild(cb);
            row.style.display = 'flex';
            row.style.alignItems = 'center';
        }

        const contentDiv = document.createElement('div');
        contentDiv.style.flex = '1';

        // 戰鬥起訖標記列：置中顯示，方便一眼看出戰鬥區段
        if (log.entryType === 'battle_start' || log.entryType === 'battle_end') {
            row.classList.add('log-row-marker');
        }

        const head = document.createElement('div');
        head.className = 'log-row-head';
        const attacker = document.createElement('span');
        attacker.className = 'log-attacker';
        attacker.textContent = log.attackerName || '未知';
        // 回合徽章：顯示這筆攻擊發生在第幾回合
        if ((Number(log.round) || 0) > 0 && log.entryType !== 'battle_start' && log.entryType !== 'battle_end') {
            const roundChip = document.createElement('span');
            roundChip.className = 'log-round-chip';
            roundChip.textContent = `R${log.round}`;
            head.appendChild(roundChip);
        }
        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = timeStr;
        head.appendChild(attacker);
        head.appendChild(time);

        const body = document.createElement('div');
        body.className = 'log-row-body';
        body.textContent = log.broadcastText
            ? log.broadcastText
            : `【${log.attackerName || '???'}】對【${log.defenderName || '???'}】發動攻擊 👉 ${Number(log.finalDice) || 0} 顆骰`;

        contentDiv.appendChild(head);
        contentDiv.appendChild(body);
        row.appendChild(contentDiv);
        frag.appendChild(row);
    }
    list.appendChild(frag);

    // 自動捲到最新
    list.scrollTop = list.scrollHeight;
}

/**
 * 群體操作 (AOE) 戰鬥日誌：由 aoe-select.js 在結算 AOE 傷害／治療／狀態時呼叫。
 * 自動把攻擊者與「選取清單中的所有單位名稱」寫成一行日誌，例如：
 *   「【BOSS】對 [單位A, 單位B, 單位C] 發動了 AOE 攻擊，造成 12 L傷害」
 * 實際寫入沿用 bbPushCombatLog（ST 單一寫入者、try-catch 防呆），不影響戰鬥主流程。
 * @param {string} attackerName - 攻擊者名稱（ST 為作用中 BOSS，玩家為自身單位）
 * @param {string[]} targetNames - 被選取的所有單位名稱
 * @param {{type:string, value?:number, dmgType?:string, statusId?:string}} actionData
 */
function logAoeAction(attackerName, targetNames, actionData) {
    try {
        const names = (Array.isArray(targetNames) ? targetNames : []).filter(Boolean);
        if (!names.length) return;
        const namesStr = names.join(', ');
        const atk = attackerName || '未知';
        const data = actionData || {};

        let effect;
        if (data.type === 'damage') {
            const typeLabel = { b: 'B', l: 'L', a: 'A' }[data.dmgType] || '';
            effect = `造成 ${Number(data.value) || 0} ${typeLabel}傷害`;
        } else if (data.type === 'heal') {
            effect = `治療 ${Number(data.value) || 0} 點生命`;
        } else if (data.type === 'status') {
            const stacks = parseInt(data.value, 10) || 0;
            effect = `施加狀態「${data.statusId}」${stacks ? ' x' + stacks : ''}`;
        } else {
            effect = '發動了群體效果';
        }

        const verb = data.type === 'heal' ? '進行了 AOE 支援' : '發動了 AOE 攻擊';
        const text = `【${atk}】對 [${namesStr}] ${verb}，${effect}`;

        if (typeof bbPushCombatLog === 'function') {
            bbPushCombatLog({
                attackerName: atk,
                defenderName: namesStr,
                finalDice: 0,
                attackerRole: (typeof myRole !== 'undefined' && myRole === 'st') ? 'enemy' : 'player',
                broadcastText: text,
                entryType: 'aoe',
                round: (typeof state !== 'undefined' && state.roundNum) || 0
            });
        }
    } catch (e) {
        /* 日誌寫入失敗不影響戰鬥 */
    }
}

/**
 * 最近 N 筆「玩家攻擊」的平均擲骰數。供 DPS 統計與 AI 遭遇生成器參考。
 * @param {number} n
 * @returns {{ avg: number, count: number }}
 */
function getRecentPlayerAverageDice(n) {
    const limit = n || 20;
    // 只取 attackerRole === 'player' 的日誌，避免 ST 操作怪物的擲骰污染玩家平均火力統計
    const playerLogs = lvCombatLogs.filter(l => l && l.attackerRole === 'player');
    const recent = playerLogs.slice(-limit);
    if (!recent.length) return { avg: 0, count: 0 };
    const sum = recent.reduce((a, l) => a + (Number(l.finalDice) || 0), 0);
    return { avg: Math.round((sum / recent.length) * 10) / 10, count: recent.length };
}

/**
 * 回合分析：取「最近一場戰鬥」（最後一個 battle_start 之後的日誌；沒有標記則退回全部日誌），
 * 統計玩家攻擊、附加成功、防禦、敵方負面狀態疊層曲線等，供 ST 檢視與 AI 遭遇構築使用。
 * @returns {object|null} 無資料時回傳 null
 */
function lvComputeBattleAnalysis() {
    if (!lvCombatLogs.length) return null;

    // 切出最近一場戰鬥的區段
    let startIdx = -1, endIdx = lvCombatLogs.length;
    for (let i = lvCombatLogs.length - 1; i >= 0; i--) {
        const t = lvCombatLogs[i] && lvCombatLogs[i].entryType;
        if (t === 'battle_start') { startIdx = i; break; }
    }
    if (startIdx >= 0) {
        const endMark = lvCombatLogs.findIndex((l, i) => i > startIdx && l && l.entryType === 'battle_end');
        if (endMark >= 0) endIdx = endMark + 1;
    }
    const segment = lvCombatLogs.slice(Math.max(0, startIdx), endIdx);
    const attacks = segment.filter(l => l && (l.entryType === 'attack' || l.entryType === undefined));
    if (!attacks.length) return null;

    const ended = segment.some(l => l && l.entryType === 'battle_end');
    const rounds = Math.max(0, ...segment.map(l => Number(l.round) || 0));

    const avgOf = (arr, key) => arr.length
        ? Math.round(arr.reduce((a, l) => a + (Number(l[key]) || 0), 0) / arr.length * 10) / 10 : 0;
    const maxOf = (arr, key) => arr.length ? Math.max(...arr.map(l => Number(l[key]) || 0)) : 0;

    const playerAtk = attacks.filter(l => l.attackerRole === 'player');
    const enemyAtk = attacks.filter(l => l.attackerRole !== 'player');

    // 每回合曲線：玩家骰數均值 + 敵方（被玩家攻擊的目標）負面狀態最高總層數
    const byRound = [];
    for (let r = 1; r <= rounds; r++) {
        const pa = playerAtk.filter(l => (Number(l.round) || 0) === r);
        const debuffPeak = maxOf(playerAtk.filter(l => (Number(l.round) || 0) <= r), 'targetDebuffTotal');
        byRound.push({ round: r, playerAttacks: pa.length, avgDice: avgOf(pa, 'finalDice'), debuffPeak });
    }

    return {
        ended, rounds,
        playerAttackCount: playerAtk.length,
        playerAvgDice: avgOf(playerAtk, 'finalDice'),
        playerMaxDice: maxOf(playerAtk, 'finalDice'),
        playerAvgExtra: avgOf(playerAtk, 'extraSuccess'),
        playerAvgAtkDp: avgOf(playerAtk, 'atkDp'),
        // 玩家被威脅時的防禦（敵方攻擊列的 defDp/defAuto 即玩家防禦 QTE 填報值）
        enemyAttackCount: enemyAtk.length,
        enemyAvgDice: avgOf(enemyAtk, 'finalDice'),
        playerAvgDefDp: avgOf(enemyAtk, 'defDp'),
        playerAvgDefAuto: avgOf(enemyAtk, 'defAuto'),
        // 敵方被疊 debuff 的速度：最終峰值與首次超過 10 層的回合
        debuffPeak: maxOf(playerAtk, 'targetDebuffTotal'),
        debuffFastRound: (byRound.find(r => r.debuffPeak >= 10) || {}).round || 0,
        lastTargetDebuffs: (playerAtk.slice(-1)[0] || {}).targetDebuffs || '',
        byRound
    };
}

/** 把回合分析整理成給 AI 的文字摘要（也用於 ST 檢視） */
function lvAnalysisSummaryText(a) {
    if (!a) return '';
    const lines = [
        `本場戰鬥${a.ended ? '已結束' : '進行中'}，共 ${a.rounds || '?'} 回合。`,
        `玩家攻擊 ${a.playerAttackCount} 次：平均擲骰 ${a.playerAvgDice} 顆（最高 ${a.playerMaxDice}）、平均附加成功 ${a.playerAvgExtra}、平均宣告攻擊 DP ${a.playerAvgAtkDp}。`,
        `敵方攻擊 ${a.enemyAttackCount} 次（平均骰數 ${a.enemyAvgDice}）；玩家防禦 QTE 平均：防禦 DP ${a.playerAvgDefDp}、防禦附加成功 ${a.playerAvgDefAuto}。`,
        `敵方單位被玩家疊負面狀態的峰值為 ${a.debuffPeak} 層` +
            (a.debuffFastRound ? `（第 ${a.debuffFastRound} 回合即突破 10 層——玩家疊 debuff 速度快）` : '') +
            (a.lastTargetDebuffs ? `；最近一次結算時目標身上：${a.lastTargetDebuffs}` : '') + '。'
    ];
    if (a.byRound.length) {
        lines.push('逐回合（玩家攻擊次數/平均骰數/敵方累積 debuff 峰值）：' +
            a.byRound.map(r => `R${r.round}: ${r.playerAttacks}次/${r.avgDice}顆/${r.debuffPeak}層`).join('；'));
    }
    return lines.join('\n');
}

function lvRenderDpsStat() {
    const el = document.getElementById('log-dps-stat');
    if (!el) return;
    if (typeof myRole === 'undefined' || myRole !== 'st') { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const { avg, count } = getRecentPlayerAverageDice(20);
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
    let html = `🎯 玩家火力統計：最近 <b>${count}</b> 筆攻擊，平均擲骰數 <b class="dps-value">${avg}</b> 顆`;

    // 最近一場戰鬥的回合分析（可展開）
    const a = lvComputeBattleAnalysis();
    if (a) {
        html += `
        <details class="log-analysis">
            <summary>📊 回合分析（${a.ended ? '最近一場' : '本場進行中'}｜${a.rounds || '?'} 回合）</summary>
            <div class="log-analysis-body">${esc(lvAnalysisSummaryText(a)).replace(/\n/g, '<br>')}</div>
        </details>`;
    }
    el.innerHTML = html;
}

// ===== AI 動態遭遇生成器（ST） =====
function lvEncounterSchemaExample() {
    return {
        monsters: [
            { name: '腐化的協會清掃工', hp: 18, defDp: 9, defAuto: 1, atkDp: 11, init: 6,
              passive: '腐化滲出：每回合結束時，對交戰中的玩家施加 1 點流血；自身流血免疫。',
              notes: '近戰；命中時施加 2 點流血。' }
        ]
    };
}

/**
 * 從圖鑑（怪物庫）中隨機抽取 1~2 隻作為 Few-shot 範例；圖鑑為空則回退到標準 Schema 範本。
 * @returns {{ examples: object[], fromBestiary: boolean }}
 */
function lvPickBestiaryExamples() {
    const lib = lvLoadMonsterLibrary();
    if (!lib.length) return { examples: [lvEncounterSchemaExample()], fromBestiary: false };

    const shuffled = lib.slice().sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(2, shuffled.length));
    const examples = picked.map(m => ({
        monsters: [{
            name: m.name, hp: m.hp, defDp: m.defDp, defAuto: m.defAuto,
            atkDp: m.atkDp, init: m.init, passive: m.passive || '', notes: m.notes || ''
        }]
    }));
    return { examples, fromBestiary: true };
}

function lvBuildEncounterSystemPrompt(avgDice, theme, difficulty) {
    const { examples, fromBestiary } = lvPickBestiaryExamples();
    const exampleText = examples.map(e => JSON.stringify(e, null, 2)).join('\n');

    // 最近一場戰鬥的回合分析：讓 AI 依實戰數據（含 debuff 疊速）設計反制被動
    const analysis = (typeof lvComputeBattleAnalysis === 'function') ? lvComputeBattleAnalysis() : null;
    const analysisText = analysis ? lvAnalysisSummaryText(analysis) : '';

    return [
        '你是一個 TRPG 遭遇設計器。請依使用者提供的主題與難度，產生一組怪物的 JSON 資料，且只輸出 JSON 本體、不要任何說明文字或 markdown 圍欄。',
        '',
        fromBestiary
            ? '以下是圖鑑（怪物庫）中既有怪物的真實資料，作為 JSON 結構與數值強度的參考範例（Few-shot）。請務必沿用相同的欄位與資料型態：'
            : '圖鑑目前是空的，下方為系統支援的標準怪物 JSON Schema 範本，輸出格式必須與其 100% 吻合（這是系統實際讀取的怪物格式）：',
        exampleText,
        '',
        '欄位說明：',
        '- monsters：陣列，每個怪物物件包含：',
        '  - name（字串）、hp（最大生命，整數）、defDp（防禦 DP，整數）、defAuto（防禦附加成功，整數）、',
        '    atkDp（行動攻擊 DP，整數）、init（先攻值，整數）、',
        '    passive（被動能力，字串：1~3 條以分號分隔的被動效果，需針對下方實戰數據設計出「有挑戰性但可被破解」的反制）、',
        '    notes（特殊說明，字串，可空）。',
        '',
        `數學平衡要求：目前玩家的平均攻擊擲骰數約為 ${avgDice} 顆。請依此火力設計怪物，使其「能承受該火力但不會無敵」：`,
        `防禦 defDp 通常略低於玩家平均擲骰數、生命 hp 約為平均擲骰數的 2~4 倍（依難度調整）。`,
        analysisText ? '' : null,
        analysisText ? '===== 最近一場戰鬥的實戰數據（回合分析）=====' : null,
        analysisText || null,
        analysisText ? [
            '請針對上述數據設計被動能力（passive），例如：',
            '- 玩家附加成功高 → 給怪物「附加成功抵銷」或「防禦附加成功隨回合成長」類被動；',
            '- 玩家疊負面狀態速度快（debuff 峰值高／早） → 給「每回合清除 N 層負面」「負面狀態達 X 層時反擊」或「特定狀態免疫」類被動；',
            '- 玩家防禦 QTE 偏低 → 提高 atkDp 或給「攻擊附帶狀態」的被動施壓；',
            '- 戰鬥回合數過短（玩家速殺） → 提高 hp 或給「首回合承傷減半」等展開型被動。',
            '被動必須留有可破解的弱點（例如免疫單一狀態而非全部、清除量有限），不可設計成無敵。'
        ].join('\n') : null,
        `主題：「${theme || '未指定'}」；難度：「${difficulty || '普通'}」。難度越高，hp / defDp / atkDp 越高、被動越刁鑽、怪物數量可酌增（建議 1~4 隻）。`
    ].filter(l => l !== null).join('\n');
}

async function requestAIEncounter() {
    const previewEl = document.getElementById('encounter-preview');
    const btn = document.getElementById('btn-generate-encounter');
    if (!previewEl) return;

    const theme = (document.getElementById('encounter-theme')?.value || '').trim();
    const difficulty = document.getElementById('encounter-difficulty')?.value || '普通';
    const { avg } = getRecentPlayerAverageDice(20);

    const endpoint = (lvGetSetting(LV_AI_ENDPOINT_KEY, LV_AI_DEFAULT_ENDPOINT) || '').trim() || LV_AI_DEFAULT_ENDPOINT;
    const apiKey = (lvGetSetting(LV_AI_KEY_KEY, '') || '').trim();
    const model = (lvGetSetting(LV_AI_MODEL_KEY, LV_AI_DEFAULT_MODEL) || '').trim() || LV_AI_DEFAULT_MODEL;
    if (!apiKey) {
        if (typeof showToast === 'function') showToast('請先在「人格鍛造爐」填入 API Key（兩處共用同一組設定）');
        return;
    }

    if (btn) { btn.disabled = true; btn.dataset.label = btn.innerText; btn.innerText = '⏳ AI 構築中...'; }
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                temperature: 0.5,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: lvBuildEncounterSystemPrompt(avg, theme, difficulty) },
                    { role: 'user', content: `主題：${theme || '隨機'}。難度：${difficulty}。請依玩家平均擲骰數 ${avg} 構築遭遇。` }
                ]
            })
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${res.statusText}${errText ? '：' + errText.slice(0, 300) : ''}`);
        }
        const data = await res.json();
        const content = (data && data.choices && data.choices[0] && data.choices[0].message)
            ? (data.choices[0].message.content || '') : '';
        if (!content) throw new Error('AI 回傳內容為空');
        let pretty = content.trim();
        try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch (e) { /* 保留原文 */ }
        previewEl.value = pretty;
        if (typeof showToast === 'function') showToast('AI 已產生遭遇，確認後可存入怪物庫');
    } catch (err) {
        previewEl.value = `// 產生失敗：${err && err.message ? err.message : err}\n// 請檢查 API 設定，或手動填寫怪物 JSON。`;
        if (typeof showToast === 'function') showToast('AI 構築失敗，詳見預覽區');
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = btn.dataset.label || '🤖 請求 AI 構築遭遇'; }
    }
}

// ===== 怪物庫（localStorage） =====
function lvLoadMonsterLibrary() {
    try {
        const raw = localStorage.getItem(LV_MONSTER_LIB_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}
function lvSaveMonsterLibrary(arr) {
    try { localStorage.setItem(LV_MONSTER_LIB_KEY, JSON.stringify(arr)); } catch (e) { /* quota */ }
}

/** 把任意 AI 回傳結構正規化為怪物陣列（接受 {monsters:[]}／陣列／單一物件）。 */
function lvNormalizeMonsters(parsed) {
    let list = [];
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && Array.isArray(parsed.monsters)) list = parsed.monsters;
    else if (parsed && typeof parsed === 'object') list = [parsed];
    return list.filter(m => m && (m.name || m.hp)).map(m => ({
        name: String(m.name || '無名怪物').slice(0, 50),
        hp: Math.max(1, parseInt(m.hp) || 10),
        defDp: Math.max(0, parseInt(m.defDp) || 0),
        defAuto: Math.max(0, parseInt(m.defAuto) || 0),
        atkDp: Math.max(0, parseInt(m.atkDp) || 0),
        init: parseInt(m.init) || 0,
        passive: String(m.passive || '').slice(0, 400),
        notes: String(m.notes || '').slice(0, 300)
    }));
}

function saveEncounterToLibrary() {
    const previewEl = document.getElementById('encounter-preview');
    if (!previewEl) return;
    const text = (previewEl.value || '').trim();
    if (!text) { if (typeof showToast === 'function') showToast('預覽區是空的，請先產生或貼上怪物 JSON'); return; }

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { if (typeof showToast === 'function') showToast('JSON 格式錯誤：' + (e.message || e)); return; }

    const monsters = lvNormalizeMonsters(parsed);
    if (!monsters.length) { if (typeof showToast === 'function') showToast('找不到有效的怪物資料'); return; }

    const lib = lvLoadMonsterLibrary();
    monsters.forEach(m => lib.push(Object.assign({ id: 'mon_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }, m)));
    lvSaveMonsterLibrary(lib);
    lvRenderMonsterLibrary();
    if (typeof showToast === 'function') showToast(`已存入怪物庫（新增 ${monsters.length} 隻）`);
}

function lvDeleteMonster(id) {
    lvSaveMonsterLibrary(lvLoadMonsterLibrary().filter(m => m.id !== id));
    lvRenderMonsterLibrary();
}

/** 部署：依怪物庫資料建立敵方單位並同步（僅 ST）。單位置於場外（x/y=-1），ST 再點擊地圖放置。 */
function lvDeployMonster(id) {
    if (typeof myRole === 'undefined' || myRole !== 'st') return;
    const mon = lvLoadMonsterLibrary().find(m => m.id === id);
    if (!mon || typeof createUnit !== 'function') return;

    const u = createUnit(mon.name, mon.hp, 'enemy');
    u.init = mon.init || 0;
    u.defDp = mon.defDp || 0;
    u.defAuto = mon.defAuto || 0;
    u.actionDp = mon.atkDp || 0;
    // 被動能力直接寫入單位（BOSS/小怪設定面板的「被動能力」欄位會顯示）
    if (mon.passive) u.passive = mon.passive;
    if (mon.notes) u.actionNote = mon.notes;

    if (typeof state !== 'undefined' && Array.isArray(state.units)) state.units.push(u);
    if (typeof broadcastState === 'function') broadcastState();
    else if (typeof syncUnits === 'function') syncUnits();
    if (typeof showToast === 'function') showToast(`已部署「${mon.name}」到單位列表，請至地圖點擊放置`);
}

function lvRenderMonsterLibrary() {
    const box = document.getElementById('monster-library-list');
    if (!box) return;
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
    const lib = lvLoadMonsterLibrary();
    if (!lib.length) {
        box.innerHTML = '<div class="log-empty">怪物庫是空的。用上方 AI 構築或手動貼上 JSON 後存入。</div>';
        return;
    }
    box.innerHTML = lib.map(m => `
        <div class="monster-lib-card">
            <div class="monster-lib-info">
                <div class="monster-lib-name">${esc(m.name)}</div>
                <div class="monster-lib-stats">HP ${m.hp}｜防 ${m.defDp}(+${m.defAuto})｜攻DP ${m.atkDp}｜先攻 ${m.init}</div>
                ${m.passive ? `<div class="monster-lib-passive">🧬 ${esc(m.passive)}</div>` : ''}
                ${m.notes ? `<div class="monster-lib-notes">${esc(m.notes)}</div>` : ''}
            </div>
            <div class="monster-lib-actions">
                <button class="lv-btn lv-btn-deploy" onclick="lvDeployMonster('${m.id}')" title="建立此敵方單位">⚔ 部署</button>
                <button class="lv-btn lv-btn-del" onclick="lvDeleteMonster('${m.id}')" title="從怪物庫刪除">🗑️</button>
            </div>
        </div>`).join('');
}

// ===== Window bindings =====
if (typeof window !== 'undefined') {
    window.logViewSetupListener = logViewSetupListener;
    window.renderCombatLogs = renderCombatLogs;
    window.getRecentPlayerAverageDice = getRecentPlayerAverageDice;
    window.logAoeAction = logAoeAction;
    window.requestAIEncounter = requestAIEncounter;
    window.saveEncounterToLibrary = saveEncounterToLibrary;
    window.lvDeployMonster = lvDeployMonster;
    window.lvDeleteMonster = lvDeleteMonster;
    window.lvRenderMonsterLibrary = lvRenderMonsterLibrary;
}

console.log('📜 戰鬥日誌 / 構築室已載入');

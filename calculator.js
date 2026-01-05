/**
 * Limbus Command - 計算器模組
 * DP 計算與 BOSS 模式計算
 */

// ===== 計算器初始化 =====
/**
 * 初始化計算器（建立防禦標籤和輸入欄位）
 */
function initCalculator() {
    // 建立防禦標籤
    const defTagsContainer = document.getElementById('def-tags');
    if (defTagsContainer) {
        defTagsContainer.innerHTML = DEF_TYPES.map(d => {
            return `<span class="def-tag ${d.type}" data-def="${d.id}" onclick="toggleDefTag('${d.id}')">${d.name}</span>`;
        }).join('');
    }

    // 建立防禦輸入欄位
    const defInputsContainer = document.getElementById('def-inputs');
    if (defInputsContainer) {
        defInputsContainer.innerHTML = DEF_TYPES.map(d => {
            return `<div class="def-input-row" id="def-${d.id}">
                <span style="width:50px;font-size:0.8rem;">${d.name}</span>
                <input type="number" data-def="${d.id}" value="0">
            </div>`;
        }).join('');
    }
}

// ===== 標籤切換 =====
/**
 * 切換防禦標籤
 * @param {string} id - 防禦類型 ID
 */
function toggleDefTag(id) {
    const tag = document.querySelector(`.def-tag[data-def="${id}"]`);
    if (tag) tag.classList.toggle('active');
    
    const row = document.getElementById(`def-${id}`);
    if (row) {
        row.classList.toggle('show');
        if (!row.classList.contains('show')) {
            const input = row.querySelector('input');
            if (input) input.value = 0;
        }
    }
}

/**
 * 切換攻擊標籤
 * @param {string} type - 攻擊類型 (pen, speed, magic)
 */
function toggleAtkTag(type) {
    const tag = document.querySelector(`.atk-tag[data-type="${type}"]`);
    if (tag) tag.classList.toggle('active');
    
    const row = document.getElementById(`row-${type}`);
    if (row) {
        row.classList.toggle('show');
        if (!row.classList.contains('show')) {
            const input = row.querySelector('input');
            if (input) input.value = 0;
        }
    }
}

// ===== 主要計算 =====
/**
 * 計算 DP
 */
function calculateDP() {
    // 攻擊方數值
    let atk = parseInt(document.getElementById('c-atk').value) || 0;
    let auto = parseInt(document.getElementById('c-atk-auto').value) || 0;
    let will = parseInt(document.getElementById('c-will').value) || 0;
    
    let pen = parseInt(document.getElementById('c-pen').value) || 0;
    let spd = parseInt(document.getElementById('c-speed').value) || 0;
    let mag = parseInt(document.getElementById('c-magic').value) || 0;
    
    // 收集防禦數值
    let defs = {};
    DEF_TYPES.forEach(t => {
        const input = document.querySelector(`input[data-def="${t.id}"]`);
        defs[t.id] = parseInt(input?.value) || 0;
    });
    
    // 破甲處理
    if (pen > 0 && defs.shield > 0) {
        let r = Math.min(pen, defs.shield);
        defs.shield -= r;
        pen -= r;
    }
    if (pen > 0 && defs.armor > 0) {
        let r = Math.min(pen, defs.armor);
        defs.armor -= r;
        pen -= r;
    }
    if (pen > 0 && defs.natural > 0) {
        defs.natural -= Math.min(pen, defs.natural);
    }
    
    // 高速處理
    if (spd > 0 && defs.block > 0) {
        let r = Math.min(spd, defs.block);
        defs.block -= r;
        spd -= r;
    }
    if (spd > 0 && defs.dodge > 0) {
        let r = Math.min(spd, defs.dodge);
        defs.dodge -= r;
        spd -= r;
    }
    if (spd > 0 && defs.base > 0) {
        defs.base -= Math.min(spd, defs.base);
    }
    
    // 破魔處理
    if (mag > 0 && defs.force > 0) {
        let r = Math.min(mag, defs.force);
        defs.force -= r;
        mag -= r;
    }
    if (mag > 0 && defs.deflect > 0) {
        let r = Math.min(mag, defs.deflect);
        defs.deflect -= r;
        mag -= r;
    }
    if (mag > 0 && defs.magicArmor > 0) {
        defs.magicArmor -= Math.min(mag, defs.magicArmor);
    }
    
    // 受擊次數衰減
    let hits = parseInt(document.getElementById('c-hits').value) || 0;
    while (hits > 0) {
        if (defs.block > 0) {
            defs.block = Math.max(0, defs.block - 2);
        } else if (defs.shieldBlock > 0) {
            defs.shieldBlock = Math.max(0, defs.shieldBlock - 2);
        } else if (defs.dodge > 0) {
            defs.dodge = Math.max(0, defs.dodge - 2);
        }
        hits--;
    }
    
    // 計算總防禦
    let totalDef = Object.values(defs).reduce((a, b) => a + b, 0);
    let defAuto = parseInt(document.getElementById('c-def-auto').value) || 0;

    // ===== 分離計算：DP 和附加成功分開處理 =====
    // 攻擊方：DP 部分（破甲/破魔/高速只扣抵這部分）
    let atkDP = atk + will;
    // 攻擊方：附加成功
    let atkAutoSuccess = auto;

    // 防禦方：DP 部分
    let defDP = totalDef;
    // 防禦方：附加成功
    let defAutoSuccess = defAuto;

    // DP 扣抵
    let finalDP = atkDP - defDP;
    // 附加成功扣抵（獨立計算，不受破甲等影響）
    let finalAutoSuccess = atkAutoSuccess - defAutoSuccess;

    const rm = document.getElementById('result-main');
    const rd = document.getElementById('result-detail');

    // 結果顯示
    if (finalDP > 0) {
        // 成功，顯示 XXdp+Y 格式
        if (finalAutoSuccess > 0) {
            rm.innerText = `${finalDP}dp+${finalAutoSuccess}`;
        } else if (finalAutoSuccess === 0) {
            rm.innerText = `${finalDP}dp`;
        } else {
            rm.innerText = `${finalDP}dp${finalAutoSuccess}`;  // 負數會自動帶負號
        }
        rm.style.color = 'var(--accent-green)';
        rd.innerText = `攻擊 ${atkDP}dp+${atkAutoSuccess} - 防禦 ${defDP}dp+${defAutoSuccess}`;
    } else if (finalDP === 0 && finalAutoSuccess > 0) {
        // DP 為 0 但有附加成功
        rm.innerText = `${finalAutoSuccess} 附加成功`;
        rm.style.color = 'var(--accent-yellow)';
        rd.innerText = `DP 抵銷，剩餘附加成功 ${finalAutoSuccess}`;
    } else {
        // 機運骰
        rm.innerText = `機運骰`;
        rm.style.color = 'var(--accent-red)';
        rd.innerText = `DP ${finalDP} (≤0)，轉為機運骰判定`;
    }
}

/**
 * 重置計算器
 */
function resetCalc() {
    // 重置數字輸入
    document.querySelectorAll('#page-calc input[type="number"]').forEach(input => {
        if (input.id !== 'boss-tier') {
            input.value = 0;
        }
    });
    document.getElementById('c-atk').value = 10;
    
    // 移除標籤啟用狀態
    document.querySelectorAll('#page-calc .def-tag.active, #page-calc .atk-tag.active').forEach(el => {
        el.classList.remove('active');
    });
    
    // 隱藏輸入列
    document.querySelectorAll('.def-input-row').forEach(el => {
        el.classList.remove('show');
    });
    document.querySelectorAll('#page-calc .calc-field.def-input-row').forEach(el => {
        el.classList.remove('show');
    });
    
    // 重置結果
    const rm = document.getElementById('result-main');
    const rd = document.getElementById('result-detail');
    if (rm) {
        rm.innerText = '---';
        rm.style.color = 'var(--accent-green)';
    }
    if (rd) {
        rd.innerText = '一般計算結果顯示於此\n(BOSS模式請看上方預覽面板)';
    }
}

// ===== BOSS 模式 =====
/**
 * 切換 BOSS 模式
 */
function toggleBossMode() {
    const checkbox = document.getElementById('boss-mode');
    const options = document.getElementById('boss-options');
    if (options) {
        options.classList.toggle('show', checkbox?.checked);
    }
}

/**
 * 新增 BOSS 行動
 */
function addBossAction() {
    bossActions.push({ 
        id: Date.now(), 
        winner: 'boss'  // 預設 boss 先攻快
    });
    renderBossActions();
    updateBossSummary();
}

/**
 * 移除 BOSS 行動
 * @param {number} id - 行動 ID
 */
function removeBossAction(id) {
    bossActions = bossActions.filter(a => a.id !== id);
    renderBossActions();
    updateBossSummary();
}

/**
 * 設定 BOSS 行動勝者
 * @param {number} id - 行動 ID
 * @param {string} winner - 勝者 ('boss' 或 'player')
 */
function setBossActionWinner(id, winner) {
    const action = bossActions.find(a => a.id === id);
    if (action) {
        action.winner = winner;
        updateBossSummary();
    }
}

/**
 * 渲染 BOSS 行動列表
 */
function renderBossActions() {
    const container = document.getElementById('boss-actions-list');
    if (!container) return;

    container.innerHTML = bossActions.map((a, i) => `
        <div class="boss-action-item">
            <span class="boss-action-num">#${i + 1}</span>
            <label>
                <input type="radio" name="ba-${a.id}" ${a.winner === 'boss' ? 'checked' : ''} 
                    onchange="setBossActionWinner(${a.id},'boss')"> Boss快
            </label>
            <label>
                <input type="radio" name="ba-${a.id}" ${a.winner === 'player' ? 'checked' : ''} 
                    onchange="setBossActionWinner(${a.id},'player')"> 玩家快
            </label>
            <button onclick="removeBossAction(${a.id})" 
                style="margin-left:auto;color:var(--text-dim);background:none;">✕</button>
        </div>
    `).join('');
}

/**
 * 更新 BOSS 計算摘要
 */
function updateBossSummary() {
    const tier = parseInt(document.getElementById('boss-tier').value) || 1;
    const engage = document.getElementById('boss-engage').value;
    const content = document.getElementById('boss-summary-content');
    if (!content) return;

    const baseVal = tier * 10;
    
    // 完全未對抗的情況
    if (engage === 'no') {
        content.innerHTML = `
            <div class="boss-summary-line">
                <span>本回合未對抗，玩家 DP</span>
                <span class="val-pos">+${baseVal}</span>
            </div>
        `;
        return;
    }

    // 沒有行動
    if (bossActions.length === 0) {
        content.innerHTML = '<div style="color:gray;">請新增行動以計算</div>';
        return;
    }

    let html = '';
    
    // 複數行動懲罰計算
    const extraCount = Math.max(0, bossActions.length - 1);
    const multiPenalty = extraCount * baseVal;
    
    if (extraCount > 0) {
        html += `
            <div class="boss-summary-line">
                <span>複數行動懲罰 (${extraCount}個額外)</span>
                <span class="val-neg">Boss DP +${multiPenalty}</span>
            </div>
        `;
    } else {
        html += `
            <div class="boss-summary-line">
                <span>單一行動</span>
                <span class="val-neutral">無懲罰</span>
            </div>
        `;
    }

    html += '<hr style="border:0;border-top:1px dashed #444;width:100%;margin:4px 0;">';

    // 每個行動的計算
    bossActions.forEach((a, idx) => {
        let speedMod = 0;
        
        if (a.winner === 'boss') {
            speedMod = baseVal;  // Boss 快，Boss DP +10
        } else {
            speedMod = -baseVal; // 玩家快，Boss DP -10
        }
        
        const total = speedMod + multiPenalty;
        const colorClass = total > 0 ? 'val-neg' : (total < 0 ? 'val-pos' : 'val-neutral');
        const sign = total > 0 ? '+' : '';
        
        html += `
            <div class="boss-summary-line">
                <span>行動 #${idx + 1} (${a.winner === 'boss' ? 'Boss快' : '玩家快'})</span>
                <span class="${colorClass}">Boss DP ${sign}${total}</span>
            </div>
            <div style="font-size:0.7rem;color:#666;text-align:right;margin-top:-2px;">
                (速度${speedMod > 0 ? '+' : ''}${speedMod} + 懲罰+${multiPenalty})
            </div>
        `;
    });

    content.innerHTML = html;
}

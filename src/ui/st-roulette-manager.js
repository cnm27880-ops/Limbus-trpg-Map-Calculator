/**
 * Limbus Command - ST 轉盤管理面板
 *
 * 提供 ST：
 *   - 列出所有已連線玩家
 *   - 增減每位玩家的抽獎次數 (state.updatePlayerSpins)
 *   - 檢視每位玩家的 inventory
 *   - 碎片統計與合成（D5 / C10 / B15 / A20 / S25）
 */

// 記錄哪些玩家展開了「統計與合成」區（key：playerId）
const stRouletteSynthExpanded = new Set();

// ===== 開關面板 =====

/**
 * 開啟 ST 轉盤管理面板
 */
function openSTRouletteManager() {
    if (typeof myRole !== 'undefined' && myRole !== 'st') {
        if (typeof showToast === 'function') showToast('僅 ST 可使用轉盤管理');
        return;
    }
    const panel = document.getElementById('st-roulette-manager');
    if (!panel) return;
    panel.classList.remove('hidden');
    renderSTRouletteManager();
}

/**
 * 關閉 ST 轉盤管理面板
 */
function closeSTRouletteManager() {
    const panel = document.getElementById('st-roulette-manager');
    if (panel) panel.classList.add('hidden');
}

// ===== 渲染 =====

/**
 * 渲染玩家清單與庫存
 */
function renderSTRouletteManager() {
    const container = document.getElementById('st-roulette-player-list');
    if (!container) return;

    const players = (state && state.players && typeof state.players === 'object')
        ? state.players
        : {};
    const entries = Object.entries(players);

    if (entries.length === 0) {
        container.innerHTML = '<div class="st-rm-empty">目前沒有已連線的玩家</div>';
        return;
    }

    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));

    container.innerHTML = entries.map(([pid, p]) => {
        const name = esc(p.name || '未知玩家');
        const spins = parseInt(p.spins) || 0;
        const online = p.online === true;
        const inventory = Array.isArray(p.inventory) ? p.inventory : [];

        // 庫存清單
        let invHtml;
        if (inventory.length === 0) {
            invHtml = '<span class="st-rm-inv-empty">（無）</span>';
        } else {
            invHtml = inventory.map(item => {
                const itemName = esc(item && item.name ? item.name : '未知');
                const type = (item && item.type) ? item.type : 'junk';
                return `<span class="st-rm-inv-item type-${esc(type)}">${itemName}</span>`;
            }).join('');
        }

        // 合成統計區（展開時才顯示）
        let synthHtml = '';
        if (stRouletteSynthExpanded.has(pid)) {
            synthHtml = renderSynthResults(pid, inventory, esc);
        }

        return `
            <div class="st-rm-player">
                <div class="st-rm-player-head">
                    <div class="st-rm-player-name">
                        ${name}
                        ${online ? '' : '<span class="st-rm-offline">(離線)</span>'}
                    </div>
                    <div class="st-rm-spins">
                        <button class="st-rm-spin-btn minus" onclick="stAdjustSpins('${esc(pid)}', -1)" title="-1 次數">−</button>
                        <span class="st-rm-spins-val">${spins}</span>
                        <button class="st-rm-spin-btn plus" onclick="stAdjustSpins('${esc(pid)}', 1)" title="+1 次數">＋</button>
                    </div>
                </div>
                <div class="st-rm-section-title">庫存 (${inventory.length})</div>
                <div class="st-rm-inventory">${invHtml}</div>
                <div class="st-rm-synth-bar">
                    <button class="st-rm-synth-toggle" onclick="stToggleSynth('${esc(pid)}')">
                        ${stRouletteSynthExpanded.has(pid) ? '收合統計' : '統計與合成'}
                    </button>
                </div>
                ${synthHtml}
            </div>
        `;
    }).join('');
}

/**
 * 產生某玩家的碎片合成統計 HTML
 * @param {string} pid - 玩家 ID
 * @param {Array} inventory - 玩家庫存
 * @param {Function} esc - HTML 轉義函式
 * @returns {string}
 */
function renderSynthResults(pid, inventory, esc) {
    const rules = (typeof FRAGMENT_SYNTHESIS_RULES !== 'undefined') ? FRAGMENT_SYNTHESIS_RULES : [];
    if (rules.length === 0) return '';

    const rows = rules.map(rule => {
        const count = inventory.filter(it =>
            it && typeof it.name === 'string' && it.name.startsWith(rule.prefix)
        ).length;
        const ready = count >= rule.required;

        return `
            <div class="st-rm-synth-row ${ready ? 'ready' : ''}">
                <span>${esc(rule.grade)} 級碎片</span>
                <span class="st-rm-synth-count">${count} / ${rule.required}</span>
                ${ready
                    ? `<span class="st-rm-synth-ready-label">${esc(rule.grade)}級可合成！</span>
                       <button class="st-rm-synth-do-btn" onclick="stExecuteSynthesis('${esc(pid)}', '${esc(rule.grade)}')">執行合成</button>`
                    : `<button class="st-rm-synth-do-btn" disabled>不足</button>`
                }
            </div>
        `;
    }).join('');

    return `<div class="st-rm-synth-results">${rows}</div>`;
}

// ===== 操作 =====

/**
 * 增減玩家抽獎次數
 * @param {string} playerId
 * @param {number} amount
 */
function stAdjustSpins(playerId, amount) {
    if (typeof myRole !== 'undefined' && myRole !== 'st') return;
    if (state && typeof state.updatePlayerSpins === 'function') {
        state.updatePlayerSpins(playerId, amount);
    }
    renderSTRouletteManager();
}

/**
 * 切換某玩家的合成統計展開狀態
 * @param {string} playerId
 */
function stToggleSynth(playerId) {
    if (stRouletteSynthExpanded.has(playerId)) {
        stRouletteSynthExpanded.delete(playerId);
    } else {
        stRouletteSynthExpanded.add(playerId);
    }
    renderSTRouletteManager();
}

/**
 * 執行碎片合成：移除 N 個碎片，新增 1 個對應成品
 * @param {string} playerId
 * @param {string} grade - 'D' | 'C' | 'B' | 'A' | 'S'
 */
function stExecuteSynthesis(playerId, grade) {
    if (typeof myRole !== 'undefined' && myRole !== 'st') return;

    const rules = (typeof FRAGMENT_SYNTHESIS_RULES !== 'undefined') ? FRAGMENT_SYNTHESIS_RULES : [];
    const rule = rules.find(r => r.grade === grade);
    if (!rule) return;

    const player = state.players && state.players[playerId];
    if (!player || !Array.isArray(player.inventory)) return;

    // 移除 required 個符合前綴的碎片
    let removed = 0;
    const newInventory = [];
    for (const item of player.inventory) {
        if (removed < rule.required &&
            item && typeof item.name === 'string' && item.name.startsWith(rule.prefix)) {
            removed++;
            continue; // 移除此碎片
        }
        newInventory.push(item);
    }

    if (removed < rule.required) {
        if (typeof showToast === 'function') showToast(`${grade} 級碎片不足，無法合成`);
        return;
    }

    // 加入合成成品
    newInventory.push({
        prizeId: null,
        name: rule.result,
        type: 'fragment-product',
        wonAt: Date.now()
    });

    player.inventory = newInventory;

    // 同步到 Firebase（僅 ST）
    if (typeof roomRef !== 'undefined' && roomRef) {
        roomRef.child(`players/${playerId}/inventory`).set(newInventory);
    }

    if (typeof showToast === 'function') showToast(`已合成「${rule.result}」`);
    renderSTRouletteManager();
}

console.log('✅ ST 轉盤管理面板已載入');

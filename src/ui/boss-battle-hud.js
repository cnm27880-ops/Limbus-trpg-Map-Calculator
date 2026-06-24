/**
 * Limbus Command - 右鍵棋子：戰鬬數值設定（ST 專用）
 *
 * 原獨立的「特殊BOSS戰」浮動面板（先攻對抗手動分配計算器）已移除：
 *   - 先攻對抗計算改為自動化（src/core/counter-phase.js，由「多重行動設定」觸發徵詢）
 *   - 群體操作 (AOE) 已併入「多重行動設定」面板
 *
 * 本檔僅保留：右鍵棋子的「戰鬥數值設定」Modal，可用於 BOSS 與一般敵方單位，
 * 直接把怪物的完整資料卡存在該單位上，並與黑箱計算連動：
 *   - defDp / defAuto：玩家攻擊此單位、且此單位未走防禦 QTE 時，作為其防禦基礎值
 *   - 狀態身上若有 calcMod 定義（暈眩/麻痺/凍結）一樣會疊加套用
 *   - sideLevel：供「多重行動設定」的先攻對抗自動計算使用（修正基數 = 等級 × 10）
 *   - saveWill / saveReflex / saveTenacity、allAttr、allSkill：僅記錄＋顯示，
 *     供 ST 套用狀態/判定時參考，目前規則未提供明確數值公式，故不自動套入計算
 */

/**
 * 開啟某單位的戰鬥數值設定（ST 專用）
 * @param {string} unitId
 */
function openBossUnitModal(unitId) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以設定戰鬥數值');
        return;
    }
    const u = findUnitById(unitId);
    if (!u) return;

    const existing = document.getElementById('boss-unit-modal');
    if (existing) existing.remove();

    const html = `
        <div class="modal-overlay show" id="boss-unit-modal" onclick="if(event.target.id==='boss-unit-modal')closeBossUnitModal()">
            <div class="modal" style="max-width:420px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <span style="font-weight:bold;">👹 戰鬥數值設定 - ${escapeHtml(u.name || '單位')}</span>
                    <button onclick="closeBossUnitModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>先攻加值</label>
                        <input type="number" id="boss-unit-init" value="${u.init || 0}">
                    </div>
                    <div class="form-group">
                        <label>生命上限</label>
                        <input type="number" id="boss-unit-max-hp" value="${u.maxHp || 1}" min="1">
                    </div>
                    <div class="form-group" style="display:flex;gap:8px;">
                        <label style="flex:1;">防禦<input type="number" id="boss-unit-def-dp" value="${u.defDp || 0}"></label>
                        <label style="flex:1;">防禦附加成功<input type="number" id="boss-unit-def-auto" value="${u.defAuto || 0}"></label>
                    </div>
                    <div class="form-group">
                        <label>三豁免（意志 / 反射 / 強韌）</label>
                        <div style="display:flex;gap:6px;">
                            <input type="number" id="boss-unit-save-will" value="${u.saveWill || 0}" placeholder="意志">
                            <input type="number" id="boss-unit-save-reflex" value="${u.saveReflex || 0}" placeholder="反射">
                            <input type="number" id="boss-unit-save-tenacity" value="${u.saveTenacity || 0}" placeholder="強韌">
                        </div>
                    </div>
                    <div class="form-group" style="display:flex;gap:8px;">
                        <label style="flex:1;">全屬性<input type="number" id="boss-unit-all-attr" value="${u.allAttr || 0}"></label>
                        <label style="flex:1;">全技能<input type="number" id="boss-unit-all-skill" value="${u.allSkill || 0}"></label>
                    </div>
                    <div class="form-group">
                        <label>支線等級（多重行動「對抗分配」修正基數 = 等級 × 10）</label>
                        <input type="number" id="boss-unit-side-level" value="${u.sideLevel || 1}" min="1" max="99">
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-dim);line-height:1.5;">
                        防禦／防禦附加成功會在玩家發起攻擊（無防禦QTE）時自動套入黑箱計算；
                        三豁免／全屬性／全技能目前僅記錄＋顯示，供套用狀態或臨場判定參考，不會自動套入計算。
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

    u.init = parseInt(document.getElementById('boss-unit-init')?.value) || 0;
    u.maxHp = Math.max(1, parseInt(document.getElementById('boss-unit-max-hp')?.value) || 1);
    u.defDp = parseInt(document.getElementById('boss-unit-def-dp')?.value) || 0;
    u.defAuto = parseInt(document.getElementById('boss-unit-def-auto')?.value) || 0;
    u.saveWill = parseInt(document.getElementById('boss-unit-save-will')?.value) || 0;
    u.saveReflex = parseInt(document.getElementById('boss-unit-save-reflex')?.value) || 0;
    u.saveTenacity = parseInt(document.getElementById('boss-unit-save-tenacity')?.value) || 0;
    u.allAttr = parseInt(document.getElementById('boss-unit-all-attr')?.value) || 0;
    u.allSkill = parseInt(document.getElementById('boss-unit-all-skill')?.value) || 0;
    u.sideLevel = Math.max(1, parseInt(document.getElementById('boss-unit-side-level')?.value) || 1);

    if (Array.isArray(u.hpArr) && u.hpArr.length !== u.maxHp) {
        const old = u.hpArr;
        u.hpArr = Array.from({ length: u.maxHp }, (_, i) => old[i] || 0);
    }

    if (typeof broadcastState === 'function') broadcastState();
    closeBossUnitModal();
    if (typeof showToast === 'function') showToast(`已更新 ${u.name || '單位'} 的戰鬥數值`);
}

// ===== Window bindings =====
window.openBossUnitModal = openBossUnitModal;
window.closeBossUnitModal = closeBossUnitModal;
window.saveBossUnitModal = saveBossUnitModal;

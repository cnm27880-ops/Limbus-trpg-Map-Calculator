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
        <div class="float-modal" id="boss-unit-modal">
            <div class="modal-header" id="boss-unit-float-header">
                <span style="font-weight:bold;">👹 戰鬥數值設定 - ${escapeHtml(u.name || '單位')}</span>
                <span class="float-modal-btns">
                    <button class="float-modal-icon-btn" id="boss-unit-collapse-btn" title="收起">▾</button>
                    <button class="float-modal-icon-btn" onclick="closeBossUnitModal()" title="關閉">×</button>
                </span>
            </div>
            <div class="modal-body">
                <div class="stat-grid cols-3">
                    <label class="stat-field"><span>生命上限</span><input type="number" id="boss-unit-max-hp" value="${u.maxHp || 1}" min="1"></label>
                    <label class="stat-field"><span>防禦</span><input type="number" id="boss-unit-def-dp" value="${u.defDp || 0}"></label>
                    <label class="stat-field"><span>防禦附加成功</span><input type="number" id="boss-unit-def-auto" value="${u.defAuto || 0}"></label>
                </div>
                <div class="stat-field">
                    <span>三豁免（意志 / 反射 / 強韌）</span>
                    <div class="stat-grid cols-3">
                        <input type="number" id="boss-unit-save-will" value="${u.saveWill || 0}" placeholder="意志">
                        <input type="number" id="boss-unit-save-reflex" value="${u.saveReflex || 0}" placeholder="反射">
                        <input type="number" id="boss-unit-save-tenacity" value="${u.saveTenacity || 0}" placeholder="強韌">
                    </div>
                </div>
                <div class="stat-grid cols-3">
                    <label class="stat-field"><span>全屬性</span><input type="number" id="boss-unit-all-attr" value="${u.allAttr || 0}"></label>
                    <label class="stat-field"><span>全技能</span><input type="number" id="boss-unit-all-skill" value="${u.allSkill || 0}"></label>
                    <label class="stat-field"><span>支線等級</span><input type="number" id="boss-unit-side-level" value="${u.sideLevel || 1}" min="1" max="99" title="「對抗分配」修正基數 = 等級 × 10"></label>
                </div>
                <div class="stat-grid cols-3">
                    <label class="stat-field"><span>先攻加值</span><input type="number" id="boss-unit-init" value="${u.init || 0}"></label>
                </div>
                <div class="stat-field">
                    <span>被動能力／特性（逐條新增，供 ST 臨場參考）</span>
                    <div id="boss-unit-passive-editor"></div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn" onclick="saveBossUnitAsTemplate('${u.id}')" style="background:var(--accent-purple);color:#fff;margin-right:auto;" title="把目前設定的完整戰鬥數值存為模板，之後套用到其他同類小怪不必重新填一次">💾 存為模板</button>
                <button class="modal-btn" onclick="closeBossUnitModal()" style="background:var(--bg-card);">取消</button>
                <button class="modal-btn" onclick="saveBossUnitModal('${u.id}')" style="background:var(--accent-green);color:#000;">儲存</button>
            </div>
        </div>
    `;
    const container = document.getElementById('modals-container') || document.body;
    container.insertAdjacentHTML('beforeend', html);
    if (typeof initPassiveEditor === 'function') initPassiveEditor('boss-unit-passive-editor', u.passive);
    // 轉為可拖曳 / 雙擊收起的浮動面板（記憶位置與收合狀態），預設落在右側不擋戰場
    if (typeof makeFloatingPanel === 'function') {
        makeFloatingPanel({
            panelId: 'boss-unit-modal',
            headerId: 'boss-unit-float-header',
            collapseBtnId: 'boss-unit-collapse-btn',
            storageKey: 'limbus_boss_unit_panel',
            defaultPos: { x: Math.max(20, window.innerWidth - 400), y: 64 },
            dock: { icon: '🗡️', title: `戰鬥數值 - ${u.name || '單位'}` },
        });
    }
}

function closeBossUnitModal() {
    // 面板被程式關閉（儲存）時，若已收納在右緣邊條需一併清掉圖標
    if (typeof PanelDock !== 'undefined') PanelDock.remove('boss-unit-modal');
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
    // 防禦附加成功的「本回合剩餘資源池」同步重置：
    // 黑箱引擎只在 defAutoRemaining 不是數字時才用 defAuto 初始化，
    // 若單位曾被攻擊過（資源池已是 0 等數字），事後調高 defAuto 會完全無效——
    // 故每次在數值面板儲存時，一律以新的 defAuto 重置剩餘池。
    u.defAutoRemaining = u.defAuto;
    u.saveWill = parseInt(document.getElementById('boss-unit-save-will')?.value) || 0;
    u.saveReflex = parseInt(document.getElementById('boss-unit-save-reflex')?.value) || 0;
    u.saveTenacity = parseInt(document.getElementById('boss-unit-save-tenacity')?.value) || 0;
    u.allAttr = parseInt(document.getElementById('boss-unit-all-attr')?.value) || 0;
    u.allSkill = parseInt(document.getElementById('boss-unit-all-skill')?.value) || 0;
    u.sideLevel = Math.max(1, parseInt(document.getElementById('boss-unit-side-level')?.value) || 1);
    u.passive = (typeof readPassiveEditor === 'function') ? readPassiveEditor('boss-unit-passive-editor') : (u.passive || '');

    if (Array.isArray(u.hpArr) && u.hpArr.length !== u.maxHp) {
        const old = u.hpArr;
        u.hpArr = Array.from({ length: u.maxHp }, (_, i) => old[i] || 0);
    }

    if (typeof broadcastState === 'function') broadcastState();
    closeBossUnitModal();
    if (typeof showToast === 'function') showToast(`已更新 ${u.name || '單位'} 的戰鬥數值`);
}

/**
 * 把目前這個單位的完整資料（基礎欄位＋戰鬥數值）另存為「單位模板」，
 * 讓 ST 設定好一隻小怪後可直接套用到其他同類小怪，不必每隻重新填一次。
 * 讀取的是 Modal 目前輸入框的值（尚未儲存也可先存模板），而非單位物件上的舊值。
 * @param {string} unitId
 */
function saveBossUnitAsTemplate(unitId) {
    if (myRole !== 'st') return;
    const u = findUnitById(unitId);
    if (!u) return;
    if (typeof saveUnitTemplate !== 'function') {
        if (typeof showToast === 'function') showToast('模板功能不可用');
        return;
    }

    const templateData = {
        name: u.name || 'Template',
        hp: Math.max(1, parseInt(document.getElementById('boss-unit-max-hp')?.value) || u.maxHp || 10),
        type: u.type || 'enemy',
        size: u.size || 1,
        avatar: u.avatar || null,
        combat: {
            defDp: parseInt(document.getElementById('boss-unit-def-dp')?.value) || 0,
            defAuto: parseInt(document.getElementById('boss-unit-def-auto')?.value) || 0,
            init: parseInt(document.getElementById('boss-unit-init')?.value) || 0,
            saveWill: parseInt(document.getElementById('boss-unit-save-will')?.value) || 0,
            saveReflex: parseInt(document.getElementById('boss-unit-save-reflex')?.value) || 0,
            saveTenacity: parseInt(document.getElementById('boss-unit-save-tenacity')?.value) || 0,
            allAttr: parseInt(document.getElementById('boss-unit-all-attr')?.value) || 0,
            allSkill: parseInt(document.getElementById('boss-unit-all-skill')?.value) || 0,
            sideLevel: Math.max(1, parseInt(document.getElementById('boss-unit-side-level')?.value) || 1),
            passive: (typeof readPassiveEditor === 'function') ? readPassiveEditor('boss-unit-passive-editor') : (u.passive || ''),
            actionDp: u.actionDp || 0,
            actionAoe: !!u.actionAoe,
            actionStatuses: Array.isArray(u.actionStatuses) ? u.actionStatuses.map(s => ({ ...s })) : [],
            actionNote: u.actionNote || ''
        }
    };

    // 同名模板存在時詢問是否覆蓋更新（模板可修改：調整數值後重存同名即更新）
    const result = (typeof saveTemplateWithOverwritePrompt === 'function')
        ? saveTemplateWithOverwritePrompt(templateData)
        : (saveUnitTemplate(templateData) ? { template: templateData, updated: false } : null);

    if (result) {
        const verb = result.updated ? '更新' : '存為';
        if (typeof showToast === 'function') showToast(`已將「${u.name || '單位'}」的完整戰鬥數值${verb}模板：${result.template.name}`);
    } else {
        if (typeof showToast === 'function') showToast('儲存模板失敗');
    }
}

// ===== Window bindings =====
window.openBossUnitModal = openBossUnitModal;
window.closeBossUnitModal = closeBossUnitModal;
window.saveBossUnitModal = saveBossUnitModal;
window.saveBossUnitAsTemplate = saveBossUnitAsTemplate;

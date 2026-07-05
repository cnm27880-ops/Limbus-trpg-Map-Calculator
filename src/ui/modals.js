/**
 * Limbus Command - Modal 模組
 * 處理所有彈出視窗
 */

// ===== Modal 初始化 =====
/**
 * 初始化所有 Modal
 */
function initModals() {
    const container = document.getElementById('modals-container');
    if (!container) return;

    container.innerHTML = `
        <!-- Add Unit Modal -->
        <div class="modal-overlay" id="modal-add-unit">
            <div class="modal">
                <div class="modal-header modal-header--create">
                    <span>新增單位</span>
                    <button onclick="closeModal('modal-add-unit')">×</button>
                </div>
                <div class="modal-body">
                    <!-- 模板選擇區 -->
                    <div style="display:flex;gap:8px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border);min-width:0;">
                        <select id="template-select" onchange="loadUnitTemplate(this.value)" style="flex:1;min-width:0;">
                            <option value="">-- 載入模板 --</option>
                        </select>
                        <button class="modal-btn tm-open-btn" onclick="openTemplateManager()" style="flex:0 0 auto;" title="模板管理：查看／修改數值／刪除">🗂 管理</button>
                    </div>

                    <!-- 頭像預覽區 -->
                    <div id="template-avatar-preview" style="display:none;text-align:center;margin-bottom:12px;">
                        <div style="width:64px;height:64px;border-radius:50%;margin:0 auto;background-size:cover;background-position:center;border:2px solid var(--border);" id="template-avatar-img"></div>
                        <button onclick="clearTemplateAvatar()" style="margin-top:6px;font-size:0.75rem;background:none;border:none;color:var(--accent-red);cursor:pointer;">清除頭像</button>
                    </div>

                    <input type="text" id="add-name" placeholder="名稱">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <input type="number" id="add-hp" value="10" placeholder="HP">
                        <select id="add-type">
                            <option value="enemy">敵方</option>
                            <option value="player">我方</option>
                            <option value="boss">BOSS (首領)</option>
                        </select>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
                        <div class="calc-field">
                            <span class="calc-label">單位大小</span>
                            <select id="add-size">
                                <option value="1">1x1 (普通)</option>
                                <option value="2">2x2 (大型)</option>
                                <option value="3">3x3 (巨型)</option>
                            </select>
                        </div>
                        <div class="calc-field" style="display:flex;align-items:flex-end;">
                            <label><input type="checkbox" id="add-avatar"> 上傳頭像</label>
                        </div>
                    </div>

                    <!-- 進階戰鬥數值：直接在此填好即可存成完整模板，不必先建單位再回頭存 -->
                    <details id="add-combat-details" style="margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;">
                        <summary style="cursor:pointer;font-size:0.85rem;color:var(--accent-purple);font-weight:600;">⚔ 戰鬥數值（進階，可留空）</summary>
                        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px;">
                            <div class="calc-field"><span class="calc-label">防禦 DP</span><input type="number" id="add-c-defdp" value="0"></div>
                            <div class="calc-field"><span class="calc-label">防禦附加成功</span><input type="number" id="add-c-defauto" value="0"></div>
                            <div class="calc-field"><span class="calc-label">先攻加值</span><input type="number" id="add-c-init" value="0" title="骰先攻時 1D10 + 此加值 = 先攻序列"></div>
                            <div class="calc-field"><span class="calc-label">意志豁免</span><input type="number" id="add-c-savewill" value="0"></div>
                            <div class="calc-field"><span class="calc-label">反射豁免</span><input type="number" id="add-c-savereflex" value="0"></div>
                            <div class="calc-field"><span class="calc-label">堅韌豁免</span><input type="number" id="add-c-savetenacity" value="0"></div>
                            <div class="calc-field"><span class="calc-label">全屬性</span><input type="number" id="add-c-allattr" value="0"></div>
                            <div class="calc-field"><span class="calc-label">全技能</span><input type="number" id="add-c-allskill" value="0"></div>
                            <div class="calc-field"><span class="calc-label">支線等級</span><input type="number" id="add-c-sidelevel" value="1" min="1"></div>
                        </div>
                        <div class="calc-field" style="margin-top:8px;"><span class="calc-label">行動 DP（攻擊）</span><input type="number" id="add-c-actiondp" value="0"></div>
                        <div class="calc-field" style="margin-top:8px;"><span class="calc-label">被動能力（每行一條）</span><textarea id="add-c-passive" rows="2" style="width:100%;resize:vertical;"></textarea></div>
                        <div class="calc-field" style="margin-top:8px;"><span class="calc-label">行動說明</span><input type="text" id="add-c-actionnote" value=""></div>
                    </details>

                    <!-- 隱藏欄位：儲存模板頭像 / 完整戰鬥數值（JSON）/ 模板移動速度 -->
                    <input type="hidden" id="add-template-avatar" value="">
                    <input type="hidden" id="add-template-combat" value="">
                    <input type="hidden" id="add-template-movespeed" value="">
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-add-unit')" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="saveAsUnitTemplate()" style="background:var(--accent-purple);color:#fff;">💾 存為模板</button>
                    <button class="modal-btn" onclick="confirmAddUnit()" style="background:var(--accent-green);color:#000;">確認</button>
                </div>
            </div>
        </div>

        <!-- Batch Modal -->
        <div class="modal-overlay" id="modal-batch">
            <div class="modal">
                <div class="modal-header modal-header--create">
                    <span>批量新增</span>
                    <button onclick="closeModal('modal-batch')">×</button>
                </div>
                <div class="modal-body">
                    <!-- 模板選擇區：載入完整模板（殼子＋戰鬥數值），批量生成同類小怪 -->
                    <div style="display:flex;gap:8px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border);">
                        <select id="batch-template-select" onchange="loadBatchTemplate(this.value)" style="flex:1;">
                            <option value="">-- 載入模板（含完整戰鬥數值） --</option>
                        </select>
                    </div>
                    <!-- 隱藏欄位：批量套用的模板頭像 / 完整戰鬥數值（JSON） -->
                    <input type="hidden" id="batch-template-avatar" value="">
                    <input type="hidden" id="batch-template-combat" value="">
                    <input type="text" id="batch-prefix" placeholder="前綴 (例: 雜兵)">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div class="calc-field">
                            <span class="calc-label">起始編號</span>
                            <input type="number" id="batch-start" value="1">
                        </div>
                        <div class="calc-field">
                            <span class="calc-label">數量</span>
                            <input type="number" id="batch-count" value="5">
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div class="calc-field">
                            <span class="calc-label">HP</span>
                            <input type="number" id="batch-hp" value="10">
                        </div>
                        <div class="calc-field">
                            <span class="calc-label">類型</span>
                            <select id="batch-type">
                                <option value="enemy">敵方</option>
                                <option value="player">我方</option>
                                <option value="boss">BOSS (首領)</option>
                            </select>
                        </div>
                    </div>
                    <div class="calc-field" style="margin-top:10px;">
                        <span class="calc-label">單位大小</span>
                        <select id="batch-size" style="width:100%;">
                            <option value="1">1x1 (普通)</option>
                            <option value="2">2x2 (大型)</option>
                            <option value="3">3x3 (巨型)</option>
                        </select>
                    </div>
                    <!-- 批量頭像：同一批雜兵長一樣，選一張圖套用到全部生成單位 -->
                    <div class="calc-field" style="margin-top:10px;">
                        <span class="calc-label">頭像（套用到本批全部單位）</span>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <div id="batch-avatar-preview" style="width:44px;height:44px;border-radius:50%;flex:0 0 auto;background:var(--bg-input) center / cover no-repeat;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:0.7rem;">無</div>
                            <button class="modal-btn" onclick="pickBatchAvatar()" style="background:var(--bg-input);flex:1;">📷 選擇圖片</button>
                            <button class="modal-btn" onclick="clearBatchAvatar()" style="background:var(--bg-input);" title="清除頭像">✕</button>
                        </div>
                        <input type="file" id="batch-avatar-file" accept="image/*" style="display:none;">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-batch')" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="confirmBatchAdd()" style="background:var(--accent-green);color:#000;">確認</button>
                </div>
            </div>
        </div>

        <!-- HP Modify Modal -->
        <div class="modal-overlay" id="modal-hp">
            <div class="modal">
                <div class="modal-header">
                    <span id="hp-modal-title">修改 HP</span>
                    <button onclick="closeModal('modal-hp')">×</button>
                </div>
                <div class="modal-body">
                    <div id="hp-modal-mode-damage" style="display:none;">
                        <div style="margin-bottom:10px;color:var(--text-dim);">選擇傷害類型：</div>
                        <div style="display:flex;gap:8px;margin-bottom:15px;">
                            <button class="action-btn dmg-b" style="flex:1;padding:12px;" onclick="setHpModalType('b', this)">B 傷 (鈍擊)</button>
                            <button class="action-btn dmg-l" style="flex:1;padding:12px;" onclick="setHpModalType('l', this)">L 傷 (穿刺)</button>
                            <button class="action-btn dmg-a" style="flex:1;padding:12px;" onclick="setHpModalType('a', this)">A 傷 (惡化)</button>
                        </div>
                    </div>
                    <div id="hp-modal-mode-heal" style="display:none;">
                        <div style="margin-bottom:10px;color:var(--text-dim);">選擇要治療的傷勢類型：</div>
                        <div style="display:flex;gap:8px;margin-bottom:15px;">
                            <button class="action-btn dmg-b" style="flex:1;padding:12px;" onclick="setHpModalType('heal-b', this)">治療 B 傷</button>
                            <button class="action-btn dmg-l" style="flex:1;padding:12px;" onclick="setHpModalType('heal-l', this)">治療 L 傷</button>
                            <button class="action-btn dmg-a" style="flex:1;padding:12px;" onclick="setHpModalType('heal-a', this)">治療 A 傷</button>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span class="calc-label" style="white-space:nowrap;">數量：</span>
                        <input type="number" id="hp-amount" value="1" min="1" style="flex:1;text-align:center;font-size:1.2rem;">
                    </div>
                    <input type="hidden" id="hp-target-id">
                    <input type="hidden" id="hp-action-type" value="b">
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-hp')" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="confirmHpModify()" style="background:var(--accent-green);color:#000;">確認</button>
                </div>
            </div>
        </div>

        <!-- Modify Max HP Modal -->
        <div class="modal-overlay" id="modal-max-hp">
            <div class="modal">
                <div class="modal-header modal-header--info">
                    <span id="max-hp-modal-title">修改生命上限</span>
                    <button onclick="closeModal('modal-max-hp')">×</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom:10px;color:var(--text-dim);font-size:0.9rem;">
                        設定新的生命上限（HP 上限）。<br>
                        <span style="color:var(--accent-orange);font-size:0.8rem;">增加上限會新增完好的 HP 格；減少上限會從末尾移除。</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span class="calc-label" style="white-space:nowrap;">新的 HP 上限：</span>
                        <input type="number" id="max-hp-value" value="10" min="1" style="flex:1;text-align:center;font-size:1.2rem;">
                    </div>
                    <input type="hidden" id="max-hp-target-id">
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-max-hp')" style="background:var(--bg-card);">取消</button>
                    <button class="modal-btn" onclick="confirmMaxHpModify()" style="background:var(--accent-green);color:#000;">確認</button>
                </div>
            </div>
        </div>

        <!-- 狀態 Modal 已移至 status-manager.js 動態生成 -->

        <!-- Assign Owner Modal (分配權限) -->
        <div class="modal-overlay" id="modal-assign-owner">
            <div class="modal">
                <div class="modal-header modal-header--info">
                    <span id="assign-modal-title">分配棋子給...</span>
                    <button onclick="closeModal('modal-assign-owner')">×</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom:10px;color:var(--text-dim);font-size:0.9rem;">選擇要將此棋子分配給的玩家：</div>
                    <div id="assign-player-list" style="max-height:300px;overflow-y:auto;"></div>
                    <input type="hidden" id="assign-target-unit-id">
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeModal('modal-assign-owner')" style="background:var(--bg-card);">取消</button>
                </div>
            </div>
        </div>
    `;
}

// ===== Modal 控制 =====
/**
 * 開啟 Modal
 * @param {string} id - Modal ID
 */
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('show');
}

/**
 * 關閉 Modal
 * @param {string} id - Modal ID
 */
function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('show');
}

/**
 * 開啟新增單位 Modal
 */
function openAddUnitModal() {
    // 刷新模板下拉選單
    refreshTemplateSelect();

    // 重置表單
    document.getElementById('add-name').value = '';
    document.getElementById('add-hp').value = '10';
    document.getElementById('add-type').value = 'enemy';
    document.getElementById('add-size').value = '1';
    document.getElementById('add-avatar').checked = false;
    document.getElementById('add-template-avatar').value = '';
    document.getElementById('add-template-combat').value = '';
    document.getElementById('add-template-movespeed').value = '';
    document.getElementById('template-select').value = '';
    fillAddCombatFields(null);
    const combatDetails = document.getElementById('add-combat-details');
    if (combatDetails) combatDetails.open = false;

    // 隱藏頭像預覽
    const preview = document.getElementById('template-avatar-preview');
    if (preview) preview.style.display = 'none';

    openModal('modal-add-unit');
}

/**
 * 刷新模板下拉選單（新增單位 Modal 與批量新增 Modal 共用同一份模板庫）
 * @param {string} [selectId='template-select'] - 下拉選單元素 ID
 */
function refreshTemplateSelect(selectId = 'template-select') {
    const select = document.getElementById(selectId);
    if (!select) return;

    const templates = typeof getUnitTemplates === 'function' ? getUnitTemplates() : [];

    // 重建選項（附上防禦/行動 DP 摘要，方便一眼分辨數值版本）
    select.innerHTML = '<option value="">-- 載入模板（含完整戰鬥數值） --</option>';
    templates.forEach(t => {
        const c = (t.combat && typeof t.combat === 'object') ? t.combat : {};
        const opt = document.createElement('option');
        opt.value = t.id;
        const typeTxt = t.type === 'boss' ? 'BOSS' : t.type === 'enemy' ? '敵方' : '我方';
        const combatTxt = (c.defDp || c.defAuto || c.actionDp)
            ? `, 防${c.defDp || 0}(+${c.defAuto || 0}), 攻DP${c.actionDp || 0}` : '';
        opt.textContent = `${t.name} (HP:${t.hp}, ${typeTxt}${combatTxt})`;
        select.appendChild(opt);
    });
}

/**
 * 把戰鬥數值填入新增單位 Modal 的進階欄位（null = 全部歸零重置）
 * @param {Object|null} combat - 見 storage.js normalizeUnitTemplate 的 combat 結構
 */
function fillAddCombatFields(combat) {
    const c = (combat && typeof combat === 'object') ? combat : {};
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('add-c-defdp', parseInt(c.defDp) || 0);
    setVal('add-c-defauto', parseInt(c.defAuto) || 0);
    setVal('add-c-init', parseInt(c.initBonus !== undefined ? c.initBonus : c.init) || 0);
    setVal('add-c-savewill', parseInt(c.saveWill) || 0);
    setVal('add-c-savereflex', parseInt(c.saveReflex) || 0);
    setVal('add-c-savetenacity', parseInt(c.saveTenacity) || 0);
    setVal('add-c-allattr', parseInt(c.allAttr) || 0);
    setVal('add-c-allskill', parseInt(c.allSkill) || 0);
    setVal('add-c-sidelevel', Math.max(1, parseInt(c.sideLevel) || 1));
    setVal('add-c-actiondp', parseInt(c.actionDp) || 0);
    setVal('add-c-passive', String(c.passive || ''));
    setVal('add-c-actionnote', String(c.actionNote || ''));
}

/**
 * 讀回進階欄位，疊在載入模板暫存的完整戰鬥數值之上
 * （actionAoe / actionStatuses 等表單沒有的欄位由暫存 JSON 保留，不會遺失）
 * @returns {Object|null} 合併後的 combat；完全沒有數值時回傳 null
 */
function readAddCombatFields() {
    let base = null;
    try {
        const raw = document.getElementById('add-template-combat').value;
        base = raw ? JSON.parse(raw) : null;
    } catch (e) { base = null; }

    const num = id => parseInt(document.getElementById(id)?.value) || 0;
    const txt = id => String(document.getElementById(id)?.value || '');
    const fields = {
        defDp: num('add-c-defdp'),
        defAuto: num('add-c-defauto'),
        initBonus: num('add-c-init'),
        saveWill: num('add-c-savewill'),
        saveReflex: num('add-c-savereflex'),
        saveTenacity: num('add-c-savetenacity'),
        allAttr: num('add-c-allattr'),
        allSkill: num('add-c-allskill'),
        sideLevel: Math.max(1, parseInt(document.getElementById('add-c-sidelevel')?.value) || 1),
        actionDp: num('add-c-actiondp'),
        passive: txt('add-c-passive'),
        actionNote: txt('add-c-actionnote')
    };

    const merged = Object.assign({}, base || {}, fields);
    // 全部為預設值且沒有載入模板 → 視為未填寫，維持與舊行為一致（不掛 combat）
    const hasValue = base !== null
        || Object.values(fields).some(v => (typeof v === 'number' ? v !== 0 : v.trim() !== ''))
        || fields.sideLevel !== 1;
    return hasValue ? merged : null;
}

/**
 * 載入單位模板
 * @param {string} templateId - 模板 ID
 */
function loadUnitTemplate(templateId) {
    if (!templateId) {
        // 選擇了空選項，重置頭像預覽與戰鬥數值暫存
        document.getElementById('add-template-avatar').value = '';
        document.getElementById('add-template-combat').value = '';
        document.getElementById('add-template-movespeed').value = '';
        document.getElementById('template-avatar-preview').style.display = 'none';
        fillAddCombatFields(null);
        return;
    }

    const templates = typeof getUnitTemplates === 'function' ? getUnitTemplates() : [];
    const template = templates.find(t => t.id === templateId);

    if (!template) {
        showToast('找不到該模板');
        return;
    }

    // 填入表單
    document.getElementById('add-name').value = template.name || '';
    document.getElementById('add-hp').value = template.hp || 10;
    document.getElementById('add-type').value = template.type || 'enemy';
    document.getElementById('add-size').value = template.size || 1;
    document.getElementById('add-template-movespeed').value = (template.moveSpeed !== undefined) ? template.moveSpeed : '';

    // 完整戰鬥數值：主要欄位直接填入進階區塊供檢視/修改；
    // 表單沒有的欄位（actionAoe/actionStatuses 等）暫存於隱藏欄位，儲存時合併保留。
    document.getElementById('add-template-combat').value =
        (template.combat && typeof template.combat === 'object') ? JSON.stringify(template.combat) : '';
    fillAddCombatFields(template.combat);
    const details = document.getElementById('add-combat-details');
    if (details && template.combat) details.open = true;

    // 處理頭像
    if (template.avatar) {
        document.getElementById('add-template-avatar').value = template.avatar;
        document.getElementById('add-avatar').checked = false;  // 不需要另外上傳
        // 顯示頭像預覽
        const preview = document.getElementById('template-avatar-preview');
        const img = document.getElementById('template-avatar-img');
        if (preview && img) {
            const safeAvatarUrl = (template.avatar && template.avatar.startsWith('data:image/')) ? template.avatar : '';
            img.style.backgroundImage = safeAvatarUrl ? `url(${safeAvatarUrl})` : 'none';
            preview.style.display = 'block';
        }
    } else {
        document.getElementById('add-template-avatar').value = '';
        document.getElementById('template-avatar-preview').style.display = 'none';
    }

    showToast(`已載入模板：${template.name}`);
}

/**
 * 各處「存為模板」按鈕共用的儲存流程：
 * 同名模板已存在時詢問是否覆蓋更新（確定＝更新原模板，讓模板可修改；取消＝另存為新模板）。
 * @param {Object} template - 見 storage.js normalizeUnitTemplate
 * @returns {{ template: Object, updated: boolean }|null}
 */
function saveTemplateWithOverwritePrompt(template) {
    if (typeof saveUnitTemplate !== 'function') return null;
    const existing = (typeof findUnitTemplateByName === 'function') ? findUnitTemplateByName(template.name) : null;
    if (existing && typeof updateUnitTemplate === 'function') {
        if (confirm(`已有同名模板「${template.name}」。\n\n確定＝以目前數值覆蓋更新該模板\n取消＝另存為一個新模板`)) {
            const t = updateUnitTemplate(existing.id, template);
            return t ? { template: t, updated: true } : null;
        }
    }
    const t = saveUnitTemplate(template);
    return t ? { template: t, updated: false } : null;
}

/**
 * 存為單位模板（新增單位 Modal）。
 * 模板為「殼子＋數值」合一：除了名稱/HP/類型/大小/頭像，
 * 也一併保留目前已載入的完整戰鬥數值（隱藏欄位），不會存成只有殼子的閹割版。
 */
function saveAsUnitTemplate() {
    const name = document.getElementById('add-name').value;
    if (!name || name.trim() === '') {
        showToast('請先輸入單位名稱');
        return;
    }

    const hp = parseInt(document.getElementById('add-hp').value) || 10;
    const type = document.getElementById('add-type').value;
    const size = parseInt(document.getElementById('add-size').value) || 1;
    const avatar = document.getElementById('add-template-avatar').value || null;
    // 戰鬥數值：進階欄位（可直接在本表單填寫）疊在載入模板的完整數值之上
    const combat = readAddCombatFields();
    // 移速：表單已無移速欄（移至單位卡編輯），沿用載入模板的值，未載入則交由預設（20）
    const moveSpeed = parseInt(document.getElementById('add-template-movespeed').value);

    if (typeof saveUnitTemplate !== 'function') {
        showToast('模板功能不可用');
        return;
    }

    const result = saveTemplateWithOverwritePrompt({
        name: name.trim(),
        hp: hp,
        type: type,
        size: size,
        moveSpeed: Number.isFinite(moveSpeed) ? moveSpeed : 20,
        avatar: avatar,
        combat: combat
    });

    if (result) {
        showToast(result.updated ? `已更新模板：${result.template.name}` : `已儲存模板：${result.template.name}`);
        refreshTemplateSelect();
        // 選中剛儲存的模板
        document.getElementById('template-select').value = result.template.id;
    } else {
        showToast('儲存模板失敗');
    }
}

/**
 * 清除模板頭像
 */
function clearTemplateAvatar() {
    document.getElementById('add-template-avatar').value = '';
    document.getElementById('template-avatar-preview').style.display = 'none';
}

/**
 * 開啟批量新增 Modal
 */
function openBatchModal() {
    // 與「新增單位」共用同一份模板庫，批量生成同類小怪不必逐隻新增
    refreshTemplateSelect('batch-template-select');
    const sel = document.getElementById('batch-template-select');
    if (sel) sel.value = '';
    const avatarEl = document.getElementById('batch-template-avatar');
    if (avatarEl) avatarEl.value = '';
    const combatEl = document.getElementById('batch-template-combat');
    if (combatEl) combatEl.value = '';
    updateBatchAvatarPreview('');
    openModal('modal-batch');
}

/** 更新批量頭像預覽圈（空字串 = 無頭像） */
function updateBatchAvatarPreview(avatar) {
    const preview = document.getElementById('batch-avatar-preview');
    if (!preview) return;
    const safe = (avatar && typeof avatar === 'string' && avatar.startsWith('data:image/')) ? avatar : '';
    preview.style.backgroundImage = safe ? `url(${safe})` : 'none';
    preview.textContent = safe ? '' : '無';
}

/** 批量頭像：開檔案選擇器，選好後壓縮處理並套用到本批全部單位 */
function pickBatchAvatar() {
    const fileInput = document.getElementById('batch-avatar-file');
    if (!fileInput) return;
    fileInput.onchange = e => {
        const file = e.target.files[0];
        e.target.value = ''; // 允許重選同一張圖
        if (!file) return;
        if (!file.type.startsWith('image/')) { showToast('請選擇圖片檔案'); return; }
        if (file.size > 5 * 1024 * 1024) { showToast('圖片過大（最大 5MB）'); return; }
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
                // processAvatarImage（units.js）：置中裁切 + 壓縮，與單體頭像上傳同規格
                const data = (typeof processAvatarImage === 'function') ? processAvatarImage(img) : ev.target.result;
                const avatarEl = document.getElementById('batch-template-avatar');
                if (avatarEl) avatarEl.value = data;
                updateBatchAvatarPreview(data);
                showToast('頭像已選擇，將套用到本批全部單位');
            };
            img.onerror = () => showToast('圖片載入失敗');
            img.src = ev.target.result;
        };
        reader.onerror = () => showToast('檔案讀取失敗');
        reader.readAsDataURL(file);
    };
    fileInput.click();
}

/** 清除批量頭像 */
function clearBatchAvatar() {
    const avatarEl = document.getElementById('batch-template-avatar');
    if (avatarEl) avatarEl.value = '';
    updateBatchAvatarPreview('');
}

/**
 * 批量新增：載入模板 → 帶入前綴/HP/類型/大小，並暫存頭像與完整戰鬥數值
 * @param {string} templateId
 */
function loadBatchTemplate(templateId) {
    const avatarEl = document.getElementById('batch-template-avatar');
    const combatEl = document.getElementById('batch-template-combat');
    if (!templateId) {
        if (avatarEl) avatarEl.value = '';
        if (combatEl) combatEl.value = '';
        updateBatchAvatarPreview('');
        return;
    }

    const templates = typeof getUnitTemplates === 'function' ? getUnitTemplates() : [];
    const template = templates.find(t => t.id === templateId);
    if (!template) {
        showToast('找不到該模板');
        return;
    }

    document.getElementById('batch-prefix').value = template.name || 'Unit';
    document.getElementById('batch-hp').value = template.hp || 10;
    document.getElementById('batch-type').value = template.type || 'enemy';
    document.getElementById('batch-size').value = template.size || 1;
    if (avatarEl) avatarEl.value = template.avatar || '';
    updateBatchAvatarPreview(template.avatar || '');
    if (combatEl) combatEl.value =
        (template.combat && typeof template.combat === 'object') ? JSON.stringify(template.combat) : '';

    showToast(`已載入模板：${template.name}（批量生成將套用完整戰鬥數值）`);
}

// ===== 新增單位 =====
/**
 * 確認新增單位
 */
function confirmAddUnit() {
    const name = document.getElementById('add-name').value || 'Unit';
    const hp = parseInt(document.getElementById('add-hp').value) || 10;
    const type = document.getElementById('add-type').value;
    const size = parseInt(document.getElementById('add-size').value) || 1;
    const moveSpeedRaw = parseInt(document.getElementById('add-template-movespeed').value);
    const moveSpeed = (Number.isFinite(moveSpeedRaw) && moveSpeedRaw >= 0) ? Math.min(999, moveSpeedRaw) : 20;
    const useAvatar = document.getElementById('add-avatar').checked;
    const templateAvatar = document.getElementById('add-template-avatar').value || '';
    // 戰鬥數值：進階欄位（含載入模板後的修改）疊在模板完整數值之上
    const templateCombat = readAddCombatFields();

    if (myRole === 'st') {
        const u = createUnit(name, hp, type, myPlayerId, myName, size, moveSpeed);

        // 優先使用模板頭像，否則觸發上傳
        if (templateAvatar) {
            u.avatar = templateAvatar;
        } else if (useAvatar) {
            uploadTargetId = u.id;
            document.getElementById('file-upload').click();
        }

        if (templateCombat && typeof templateCombat === 'object') {
            Object.assign(u, templateCombat);
        }

        state.units.push(u);
        closeModal('modal-add-unit');
        broadcastState();
    } else {
        sendToHost({
            type: 'addUnit',
            playerId: myPlayerId,
            name: name,
            hp: hp,
            unitType: type,
            playerName: myName,
            size: size,
            moveSpeed: moveSpeed,            // 移動速度（米），5 米 = 1 格
            avatar: templateAvatar || null,  // 傳送模板頭像給 ST
            combat: templateCombat || null   // 傳送模板戰鬥數值給 ST
        });
        closeModal('modal-add-unit');
        showToast('已請求新增單位');
    }
}

/**
 * 確認批量新增
 */
function confirmBatchAdd() {
    if (myRole !== 'st') {
        showToast('只有 ST 可以批量新增');
        return;
    }

    const prefix = document.getElementById('batch-prefix').value || 'Unit';
    const start = parseInt(document.getElementById('batch-start').value) || 1;
    const count = Math.min(parseInt(document.getElementById('batch-count').value) || 5, 50); // 限制最多 50 個
    const hp = Math.max(1, Math.min(parseInt(document.getElementById('batch-hp').value) || 10, 9999));
    const type = document.getElementById('batch-type').value;
    const size = parseInt(document.getElementById('batch-size').value) || 1;

    // 模板帶入的頭像與完整戰鬥數值：套用到每一隻批量生成的單位
    const templateAvatar = document.getElementById('batch-template-avatar')?.value || '';
    let templateCombat = null;
    try {
        const raw = document.getElementById('batch-template-combat')?.value;
        templateCombat = raw ? JSON.parse(raw) : null;
    } catch (e) { templateCombat = null; }

    for (let i = 0; i < count; i++) {
        const u = createUnit(`${prefix}${start + i}`, hp, type, myPlayerId, myName, size);
        if (templateAvatar) u.avatar = templateAvatar;
        if (templateCombat && typeof templateCombat === 'object') Object.assign(u, templateCombat);
        state.units.push(u);
    }

    closeModal('modal-batch');
    broadcastState();
}

// ===== HP 修改 Modal =====
/**
 * 開啟 HP 修改 Modal
 * @param {number} id - 單位 ID
 * @param {string} mode - 模式 ('damage' 或 'heal')
 */
function openHpModal(id, mode) {
    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    document.getElementById('hp-target-id').value = id;
    document.getElementById('hp-amount').value = 1;
    document.getElementById('hp-action-type').value = mode === 'heal' ? 'heal-b' : 'b';

    document.getElementById('hp-modal-title').innerText = mode === 'heal' ? `治療：${u.name}` : `傷害：${u.name}`;
    document.getElementById('hp-modal-mode-damage').style.display = mode === 'damage' ? 'block' : 'none';
    document.getElementById('hp-modal-mode-heal').style.display = mode === 'heal' ? 'block' : 'none';

    // 重置按鈕高亮
    document.querySelectorAll('#modal-hp .action-btn').forEach(btn => {
        btn.style.boxShadow = '';
    });
    
    // 高亮第一個選項
    const firstBtn = document.querySelector(mode === 'heal' ? '#hp-modal-mode-heal .action-btn' : '#hp-modal-mode-damage .action-btn');
    if (firstBtn) firstBtn.style.boxShadow = '0 0 0 2px var(--accent-yellow)';

    openModal('modal-hp');
}

/**
 * 設定 HP Modal 類型
 * @param {string} type - 類型
 * @param {HTMLElement} btnElement - 被點擊的按鈕元素
 */
function setHpModalType(type, btnElement) {
    document.getElementById('hp-action-type').value = type;

    // 更新按鈕高亮
    document.querySelectorAll('#modal-hp .action-btn').forEach(btn => {
        btn.style.boxShadow = '';
    });
    if (btnElement) {
        btnElement.style.boxShadow = '0 0 0 2px var(--accent-yellow)';
    }
}

/**
 * 確認 HP 修改
 */
function confirmHpModify() {
    const id = document.getElementById('hp-target-id').value;  // 直接获取字符串 ID
    const amount = parseInt(document.getElementById('hp-amount').value) || 1;
    const type = document.getElementById('hp-action-type').value;

    modifyHP(id, type, amount);
    closeModal('modal-hp');
}

// ===== 狀態 Modal =====
// 注意：狀態管理功能已移至 status-manager.js
// openStatusModal, selectStatus, addStatusToUnit 等函數在該檔案中定義

// ===== 分配權限 Modal =====
/**
 * 開啟分配權限 Modal
 * @param {string} unitId - 要分配的單位 ID
 */
function openAssignOwnerModal(unitId) {
    // 只有 ST 可以分配權限
    if (myRole !== 'st') {
        showToast('只有 ST 可以分配棋子權限');
        return;
    }

    const u = findUnitById(unitId);
    if (!u) {
        showToast('找不到該單位');
        return;
    }

    // 設定目標單位 ID
    document.getElementById('assign-target-unit-id').value = unitId;
    document.getElementById('assign-modal-title').innerText = `分配「${u.name}」給...`;

    // 取得玩家列表
    const playerList = document.getElementById('assign-player-list');

    // 使用 getAllUsers() 取得所有使用者（如果函數存在）
    let users = [];
    if (typeof getAllUsers === 'function') {
        users = getAllUsers();
    } else if (typeof roomUsers !== 'undefined') {
        // 回退方案：直接從 roomUsers 取得
        for (const [userId, userData] of Object.entries(roomUsers)) {
            users.push({
                id: userId,
                name: userData.name || '未知',
                role: userData.role || 'player',
                online: userData.online || false
            });
        }
    }

    // 如果沒有玩家，顯示提示
    if (users.length === 0) {
        playerList.innerHTML = `
            <div style="text-align:center;color:var(--text-dim);padding:20px;">
                目前沒有其他玩家在房間內
            </div>
        `;
        openModal('modal-assign-owner');
        return;
    }

    // 渲染玩家列表
    playerList.innerHTML = users.map(user => {
        const isCurrentOwner = u.ownerId === user.id;
        const isST = user.role === 'st';
        const statusDot = user.online ? '🟢' : '⚪';
        const roleTag = isST ? '<span style="color:var(--accent-yellow);font-size:0.75rem;">[ST]</span>' : '';
        const ownerTag = isCurrentOwner ? '<span style="color:var(--accent-green);font-size:0.75rem;margin-left:4px;">(目前擁有者)</span>' : '';

        return `
            <div class="assign-player-item" style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                padding:12px;
                margin-bottom:8px;
                background:var(--bg-input);
                border:1px solid ${isCurrentOwner ? 'var(--accent-green)' : 'var(--border)'};
                border-radius:8px;
                cursor:pointer;
                transition:all 0.2s;
            " onclick="assignOwner('${escapeHtml(unitId)}', '${escapeHtml(user.id)}', '${escapeHtml(user.name)}')"
            onmouseover="this.style.borderColor='var(--accent-yellow)'"
            onmouseout="this.style.borderColor='${isCurrentOwner ? 'var(--accent-green)' : 'var(--border)'}'">
                <div>
                    <span style="margin-right:6px;">${statusDot}</span>
                    <span style="font-weight:600;">${escapeHtml(user.name)}</span>
                    ${roleTag}
                    ${ownerTag}
                </div>
                <div style="color:var(--text-dim);font-size:0.8rem;">
                    ${user.id.substring(0, 12)}...
                </div>
            </div>
        `;
    }).join('');

    openModal('modal-assign-owner');
}

/**
 * 分配單位給指定玩家
 * @param {string} unitId - 單位 ID
 * @param {string} newOwnerId - 新擁有者 ID
 * @param {string} newOwnerName - 新擁有者名稱
 */
function assignOwner(unitId, newOwnerId, newOwnerName) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以分配權限');
        return;
    }

    const u = findUnitById(unitId);
    if (!u) {
        showToast('找不到該單位');
        return;
    }

    // 更新本地狀態
    u.ownerId = newOwnerId;
    u.ownerName = newOwnerName;

    // 同步到 Firebase
    if (roomRef) {
        roomRef.child(`units/${unitId}/ownerId`).set(newOwnerId);
        roomRef.child(`units/${unitId}/ownerName`).set(newOwnerName);
    }

    // 關閉 Modal 並顯示提示
    closeModal('modal-assign-owner');
    showToast(`已將「${u.name}」分配給 ${newOwnerName}`);

    // 重新渲染
    renderAll();
}

// ===== 地形編輯器 Modal =====

/**
 * 開啟地形編輯器 Modal
 * @param {number|null} existingTileId - 若提供則為編輯模式
 */
function openTileEditorModal(existingTileId = null) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以編輯地形');
        return;
    }

    const isEdit = existingTileId !== null;
    let tile = null;
    if (isEdit) {
        tile = (typeof getTileFromPalette === 'function')
            ? getTileFromPalette(existingTileId)
            : (state.mapPalette || []).find(t => t.id === existingTileId);
    }

    // 預設值
    const tileName = tile ? tile.name : '';
    const tileColor = tile ? tile.color : '#666666';
    // 將 rgba/named colors 轉為 hex 以供 color picker
    const colorHex = colorToHex(tileColor);
    const tileEffect = tile ? tile.effect : '';
    const tileMoveCost = tile && tile.moveCostMultiplier ? tile.moveCostMultiplier : 1;

    // 建立「從預設庫匯入」選項列表
    let presetOptions = '';
    MAP_PRESETS.forEach((preset, pi) => {
        preset.tiles.forEach(t => {
            presetOptions += `<option value="${pi}_${t.id}">${preset.name} - ${t.name}</option>`;
        });
    });

    const modalHtml = `
        <div class="modal-overlay show" id="tile-editor-modal" onclick="closeTileEditorOnOverlay(event)">
            <div class="modal tile-editor-modal" onclick="event.stopPropagation()">
                <div class="modal-header modal-header--create">
                    <span style="font-weight:bold;">🎨 ${isEdit ? '編輯地形' : '新增地形'}</span>
                    <button onclick="closeTileEditorModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body">
                    <!-- 從預設庫匯入 -->
                    <div class="tile-import-section">
                        <label class="tile-editor-label">從預設庫匯入</label>
                        <div style="display:flex;gap:6px;">
                            <select id="tile-import-select" class="tile-editor-select">
                                <option value="">-- 選擇預設地形 --</option>
                                ${presetOptions}
                            </select>
                            <button onclick="importPresetTile()" class="modal-btn" style="background:var(--accent-blue);white-space:nowrap;padding:8px 12px;">匯入</button>
                        </div>
                    </div>

                    <div class="tile-editor-divider"></div>

                    <!-- 自訂表單 -->
                    <div class="tile-editor-form">
                        <div class="form-group">
                            <label class="tile-editor-label">地形名稱</label>
                            <input type="text" id="tile-edit-name" value="${escapeHtml(tileName)}" placeholder="例如：熔岩地帶" maxlength="20">
                        </div>

                        <div class="form-group">
                            <label class="tile-editor-label">顏色</label>
                            <div class="tile-color-row">
                                <input type="color" id="tile-edit-color" value="${colorHex}" class="tile-color-picker">
                                <span class="tile-color-hex" id="tile-color-hex">${colorHex}</span>
                                <div class="tile-color-preview" id="tile-color-preview" style="background:${colorHex};"></div>
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="tile-editor-label">效果描述</label>
                            <textarea id="tile-edit-effect" placeholder="例如：每回合受 2 點火焰傷害" rows="3">${escapeHtml(tileEffect)}</textarea>
                        </div>

                        <div class="form-group">
                            <label class="tile-editor-label">移動消耗倍率</label>
                            <input type="number" id="tile-edit-move-cost" value="${tileMoveCost}" min="0.5" step="0.5" style="width:100px;">
                            <div class="tile-editor-hint">困難地形：進入這格會照倍率乘算格數消耗（例：2 = 消耗雙倍移動力）。1 = 正常，不影響移動。</div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    ${isEdit ? `<button onclick="deletePaletteTile(${existingTileId})" class="modal-btn" style="background:var(--accent-red);margin-right:auto;">刪除</button>` : ''}
                    <button onclick="closeTileEditorModal()" class="modal-btn" style="background:var(--bg-card);">取消</button>
                    <button onclick="saveTileFromEditor(${isEdit ? existingTileId : 'null'})" class="modal-btn" style="background:var(--accent-green);color:#000;">
                        ${isEdit ? '儲存變更' : '新增地形'}
                    </button>
                </div>
            </div>
        </div>
    `;

    const container = document.getElementById('modals-container');
    const existing = document.getElementById('tile-editor-modal');
    if (existing) existing.remove();
    container.insertAdjacentHTML('beforeend', modalHtml);

    // 顏色選取器即時預覽
    const colorInput = document.getElementById('tile-edit-color');
    if (colorInput) {
        colorInput.addEventListener('input', () => {
            const hex = colorInput.value;
            document.getElementById('tile-color-hex').textContent = hex;
            document.getElementById('tile-color-preview').style.background = hex;
        });
    }
}

/**
 * 從預設庫匯入地形到編輯表單
 */
function importPresetTile() {
    const select = document.getElementById('tile-import-select');
    if (!select || !select.value) {
        showToast('請先選擇一個預設地形');
        return;
    }

    const [presetIdx, tileId] = select.value.split('_').map(Number);
    const preset = MAP_PRESETS[presetIdx];
    if (!preset) return;

    const tile = preset.tiles.find(t => t.id === tileId);
    if (!tile) return;

    // 填入表單
    document.getElementById('tile-edit-name').value = tile.name;
    document.getElementById('tile-edit-color').value = colorToHex(tile.color);
    document.getElementById('tile-color-hex').textContent = colorToHex(tile.color);
    document.getElementById('tile-color-preview').style.background = tile.color;
    document.getElementById('tile-edit-effect').value = tile.effect;
    const moveCostInput = document.getElementById('tile-edit-move-cost');
    if (moveCostInput) moveCostInput.value = tile.moveCostMultiplier || 1;
}

/**
 * 儲存地形（新增或編輯）
 * @param {number|null} existingId - 若提供則更新現有地形
 */
function saveTileFromEditor(existingId) {
    const name = document.getElementById('tile-edit-name')?.value.trim();
    const color = document.getElementById('tile-edit-color')?.value || '#666666';
    const effect = document.getElementById('tile-edit-effect')?.value.trim() || '';
    const moveCostMultiplier = Math.max(0.5, parseFloat(document.getElementById('tile-edit-move-cost')?.value) || 1);

    if (!name) {
        showToast('請輸入地形名稱');
        return;
    }

    if (!state.mapPalette) state.mapPalette = [];

    if (existingId !== null) {
        // 編輯模式：更新現有地形
        const idx = state.mapPalette.findIndex(t => t.id === existingId);
        if (idx !== -1) {
            state.mapPalette[idx].name = name;
            state.mapPalette[idx].color = color;
            state.mapPalette[idx].effect = effect;
            state.mapPalette[idx].moveCostMultiplier = moveCostMultiplier;
        }
        showToast(`已更新地形「${name}」`);
    } else {
        // 新增模式：生成唯一 ID
        const newId = Date.now() % 100000 + 1000;
        state.mapPalette.push({ id: newId, name, color, effect, moveCostMultiplier });
        showToast(`已新增地形「${name}」`);
    }

    closeTileEditorModal();
    updateToolbar();

    // 同步到 Firebase
    if (typeof syncMapPalette === 'function') syncMapPalette();
    if (myRole === 'st') sendState();

    // 重繪地圖以反映顏色變更
    renderMap();
}

/**
 * 從調色盤刪除地形
 * @param {number} tileId - 地形 ID
 */
function deletePaletteTile(tileId) {
    if (!confirm('確定要從調色盤移除此地形？\n（已繪製在地圖上的格子不會消失，但無法再使用此工具繪製）')) return;

    state.mapPalette = (state.mapPalette || []).filter(t => t.id !== tileId);

    closeTileEditorModal();
    updateToolbar();
    showToast('地形已從調色盤移除');

    if (typeof syncMapPalette === 'function') syncMapPalette();
    if (myRole === 'st') sendState();
}

/**
 * 關閉地形編輯器 Modal
 */
function closeTileEditorModal() {
    const modal = document.getElementById('tile-editor-modal');
    if (modal) modal.remove();
}

function closeTileEditorOnOverlay(event) {
    if (event.target.id === 'tile-editor-modal') closeTileEditorModal();
}

/**
 * 將 CSS 顏色轉換為 hex
 * @param {string} color - CSS 顏色值
 * @returns {string} hex 格式
 */
function colorToHex(color) {
    if (!color) return '#666666';
    // 已經是 hex
    if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;

    // 使用 canvas 轉換
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = color;
    return ctx.fillStyle; // 瀏覽器會自動轉為 hex
}

// ===== 修改生命上限 Modal =====
/**
 * 開啟修改生命上限 Modal
 * @param {string} id - 單位 ID
 */
function openMaxHpModal(id) {
    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    document.getElementById('max-hp-target-id').value = id;
    document.getElementById('max-hp-value').value = u.maxHp || 10;
    document.getElementById('max-hp-modal-title').innerText = `修改生命上限：${u.name}`;

    openModal('modal-max-hp');
}

/**
 * 確認修改生命上限
 */
function confirmMaxHpModify() {
    const id = document.getElementById('max-hp-target-id').value;
    const newMaxHp = parseInt(document.getElementById('max-hp-value').value);

    if (!newMaxHp || newMaxHp < 1) {
        showToast('HP 上限必須至少為 1');
        return;
    }

    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法修改其他人的單位');
        return;
    }

    if (myRole === 'st') {
        const oldMaxHp = u.maxHp || u.hpArr.length;
        if (newMaxHp > oldMaxHp) {
            // 增加上限：新增完好的 HP 格
            const diff = newMaxHp - oldMaxHp;
            for (let i = 0; i < diff; i++) {
                u.hpArr.push(0);
            }
        } else if (newMaxHp < oldMaxHp) {
            // 減少上限：從末尾移除（優先移除完好格）
            // 先排序使受傷格在前、完好格在後
            u.hpArr.sort((a, b) => b - a);
            u.hpArr = u.hpArr.slice(0, newMaxHp);
        }
        u.maxHp = newMaxHp;
        // 重新排序
        u.hpArr.sort((a, b) => b - a);

        closeModal('modal-max-hp');
        broadcastState();
        showToast(`已將「${u.name}」的生命上限修改為 ${newMaxHp}`);
    } else {
        sendToHost({
            type: 'modifyMaxHp',
            playerId: myPlayerId,
            unitId: id,
            newMaxHp: newMaxHp
        });
        closeModal('modal-max-hp');
        showToast('已請求修改生命上限');
    }
}



// ===== 模板管理器（查看／修改數值／刪除） =====
/**
 * 開啟模板管理 Modal：列出所有已儲存的單位模板，
 * 每筆可展開行內編輯（名稱/HP/類型/大小/移速/完整戰鬥數值）、儲存與刪除。
 */
function openTemplateManager() {
    closeTemplateManager();
    const html = `
        <div class="modal-overlay show" id="template-manager-modal" onclick="if(event.target.id==='template-manager-modal')closeTemplateManager()">
            <div class="modal" style="max-width:560px;" onclick="event.stopPropagation()">
                <div class="modal-header modal-header--info">
                    <span>🗂 模板管理</span>
                    <button onclick="closeTemplateManager()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body" style="max-height:65vh;overflow-y:auto;">
                    <div id="tm-list"></div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn" onclick="closeTemplateManager()" style="background:var(--bg-card);">關閉</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modals-container').insertAdjacentHTML('beforeend', html);
    tmRenderList();
}

function closeTemplateManager() {
    const modal = document.getElementById('template-manager-modal');
    if (modal) modal.remove();
}

/** 渲染模板清單（每筆：摘要列 + 可展開的編輯表單） */
function tmRenderList() {
    const box = document.getElementById('tm-list');
    if (!box) return;
    const templates = (typeof getUnitTemplates === 'function') ? getUnitTemplates() : [];

    if (!templates.length) {
        box.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);">尚無模板。可在「新增單位」填好數值後按「存為模板」。</div>';
        return;
    }

    box.innerHTML = templates.map(t => {
        const c = (t.combat && typeof t.combat === 'object') ? t.combat : {};
        const typeTxt = t.type === 'boss' ? 'BOSS' : t.type === 'enemy' ? '敵方' : '我方';
        const safeAvatar = (t.avatar && typeof t.avatar === 'string' && t.avatar.startsWith('data:image/')) ? t.avatar : '';
        const avatarStyle = safeAvatar ? `background-image:url(${safeAvatar});` : '';
        const avatarInitial = safeAvatar ? '' : escapeHtml((t.name || '?')[0]);
        const chips = [
            ['tm-chip-hp', `HP ${t.hp}`],
            [`tm-chip-type-${t.type || 'enemy'}`, typeTxt],
            ['', `${t.size || 1}x${t.size || 1}`],
            ['tm-chip-move', `🏃 ${t.moveSpeed !== undefined ? t.moveSpeed : 20}米`],
            ['tm-chip-def', `防 ${c.defDp || 0}(+${c.defAuto || 0})`],
            ['tm-chip-atk', `攻DP ${c.actionDp || 0}`],
            ['', `先攻加值 ${(c.initBonus !== undefined ? c.initBonus : c.init) || 0}`]
        ].map(([cls, txt]) => `<span class="tm-chip ${cls}">${escapeHtml(txt)}</span>`).join('');
        return `
            <div class="tm-card tm-type-${t.type || 'enemy'}" id="tm-card-${t.id}">
                <div class="tm-card-head">
                    <div class="tm-card-avatar" style="${avatarStyle}">${avatarInitial}</div>
                    <div class="tm-card-info">
                        <div class="tm-card-name">${escapeHtml(t.name || '')}</div>
                        <div class="tm-card-chips">${chips}</div>
                    </div>
                    <div class="tm-card-btns">
                        <button class="tm-btn tm-btn-edit" onclick="tmToggleEdit('${t.id}')">✏ 編輯</button>
                        <button class="tm-btn tm-btn-del" onclick="tmDelete('${t.id}')">🗑 刪除</button>
                    </div>
                </div>
                <div class="tm-edit-form" id="tm-edit-${t.id}" style="display:none;"></div>
            </div>
        `;
    }).join('');
}

/** 展開／收合某模板的行內編輯表單 */
function tmToggleEdit(id) {
    const form = document.getElementById('tm-edit-' + id);
    if (!form) return;
    if (form.style.display !== 'none') {
        form.style.display = 'none';
        form.innerHTML = '';
        return;
    }
    const t = ((typeof getUnitTemplates === 'function') ? getUnitTemplates() : []).find(x => x.id === id);
    if (!t) return;
    const c = (t.combat && typeof t.combat === 'object') ? t.combat : {};

    const numField = (label, fid, val, extra = '') => `
        <div class="calc-field"><span class="calc-label">${label}</span>
        <input type="number" id="tm-${fid}-${id}" value="${val}" ${extra}></div>`;

    form.innerHTML = `
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;">
            <div class="calc-field"><span class="calc-label">名稱</span>
                <input type="text" id="tm-name-${id}" value="${escapeHtml(t.name || '')}"></div>
            <div class="calc-field"><span class="calc-label">類型</span>
                <select id="tm-type-${id}">
                    <option value="enemy" ${t.type === 'enemy' ? 'selected' : ''}>敵方</option>
                    <option value="player" ${t.type === 'player' ? 'selected' : ''}>我方</option>
                    <option value="boss" ${t.type === 'boss' ? 'selected' : ''}>BOSS</option>
                </select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:6px;">
            ${numField('HP', 'hp', t.hp || 10, 'min="1"')}
            <div class="calc-field"><span class="calc-label">大小</span>
                <select id="tm-size-${id}">
                    <option value="1" ${(t.size || 1) === 1 ? 'selected' : ''}>1x1</option>
                    <option value="2" ${t.size === 2 ? 'selected' : ''}>2x2</option>
                    <option value="3" ${t.size === 3 ? 'selected' : ''}>3x3</option>
                </select></div>
            ${numField('移速(米)', 'movespeed', t.moveSpeed !== undefined ? t.moveSpeed : 20, 'min="0"')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:6px;">
            ${numField('防禦 DP', 'defdp', c.defDp || 0)}
            ${numField('防禦附加', 'defauto', c.defAuto || 0)}
            ${numField('先攻加值', 'init', (c.initBonus !== undefined ? c.initBonus : c.init) || 0)}
            ${numField('意志豁免', 'savewill', c.saveWill || 0)}
            ${numField('反射豁免', 'savereflex', c.saveReflex || 0)}
            ${numField('堅韌豁免', 'savetenacity', c.saveTenacity || 0)}
            ${numField('全屬性', 'allattr', c.allAttr || 0)}
            ${numField('全技能', 'allskill', c.allSkill || 0)}
            ${numField('支線等級', 'sidelevel', c.sideLevel || 1, 'min="1"')}
        </div>
        <div style="margin-top:6px;">${numField('行動 DP（攻擊）', 'actiondp', c.actionDp || 0)}</div>
        <div class="calc-field" style="margin-top:6px;"><span class="calc-label">被動能力（每行一條）</span>
            <textarea id="tm-passive-${id}" rows="2" style="width:100%;resize:vertical;">${escapeHtml(String(c.passive || ''))}</textarea></div>
        <div class="calc-field" style="margin-top:6px;"><span class="calc-label">行動說明</span>
            <input type="text" id="tm-actionnote-${id}" value="${escapeHtml(String(c.actionNote || ''))}"></div>
        <button class="modal-btn" onclick="tmSave('${id}')" style="background:var(--accent-green);color:#000;width:100%;margin-top:10px;">💾 儲存修改</button>
    `;
    form.style.display = 'block';
}

/** 儲存行內編輯：保留頭像與表單沒有的欄位（actionAoe / actionStatuses 等） */
function tmSave(id) {
    const t = ((typeof getUnitTemplates === 'function') ? getUnitTemplates() : []).find(x => x.id === id);
    if (!t || typeof updateUnitTemplate !== 'function') return;

    const val = fid => document.getElementById(`tm-${fid}-${id}`)?.value;
    const num = fid => parseInt(val(fid)) || 0;
    const name = String(val('name') || '').trim();
    if (!name) {
        showToast('模板名稱不可為空');
        return;
    }

    const baseCombat = (t.combat && typeof t.combat === 'object') ? t.combat : {};
    const updated = updateUnitTemplate(id, {
        name: name,
        hp: Math.max(1, num('hp') || 10),
        type: val('type') || 'enemy',
        size: parseInt(val('size')) || 1,
        moveSpeed: Math.max(0, num('movespeed')),
        avatar: t.avatar || null,
        combat: Object.assign({}, baseCombat, {
            defDp: num('defdp'),
            defAuto: num('defauto'),
            initBonus: num('init'),
            saveWill: num('savewill'),
            saveReflex: num('savereflex'),
            saveTenacity: num('savetenacity'),
            allAttr: num('allattr'),
            allSkill: num('allskill'),
            sideLevel: Math.max(1, num('sidelevel') || 1),
            actionDp: num('actiondp'),
            passive: String(val('passive') || ''),
            actionNote: String(val('actionnote') || '')
        })
    });

    if (updated) {
        showToast(`已更新模板：${updated.name}`);
        tmRenderList();
        // 同步刷新新增單位 Modal 的下拉選單（若開著）
        if (typeof refreshTemplateSelect === 'function') {
            refreshTemplateSelect();
            refreshTemplateSelect('batch-template-select');
        }
    } else {
        showToast('更新模板失敗');
    }
}

/** 刪除模板（confirm 防誤觸） */
function tmDelete(id) {
    const t = ((typeof getUnitTemplates === 'function') ? getUnitTemplates() : []).find(x => x.id === id);
    if (!t) return;
    if (!confirm(`確定要刪除模板「${t.name}」嗎？`)) return;
    if (typeof deleteUnitTemplate === 'function' && deleteUnitTemplate(id)) {
        showToast(`已刪除模板：${t.name}`);
        tmRenderList();
        if (typeof refreshTemplateSelect === 'function') {
            refreshTemplateSelect();
            refreshTemplateSelect('batch-template-select');
        }
    } else {
        showToast('刪除模板失敗');
    }
}

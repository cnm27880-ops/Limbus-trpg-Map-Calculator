/**
 * Limbus Command - ST 招式巨集儀表板 (ST Skill Macro HUD)
 * + 懸浮計算器 (Floating Calculator HUD)
 *
 * Features:
 * - ST 快速點選發動敵人攻擊 / 賦予狀態
 * - 與計算器雙向聯動
 * - 可拖曳、雙擊摺疊
 * - localStorage 持久化
 */

// ===== Constants =====
const SKILL_HUD_STORAGE = 'limbus_st_skills';
const SKILL_HUD_POS_KEY = 'limbus_skill_hud_pos';
const SKILL_HUD_STATE_KEY = 'limbus_skill_hud_state';
const CALC_HUD_POS_KEY = 'limbus_calc_hud_pos';
const CALC_HUD_STATE_KEY = 'limbus_calc_hud_state';

// ===== State =====
let skillHudState = {
    isVisible: false,
    isCollapsed: false,
    position: { x: 20, y: 300 },
    editingId: null,  // currently editing skill id
    mode: 'battle'    // 'battle' or 'edit'
};

let calcHudState = {
    isVisible: false,
    isCollapsed: false,
    position: { x: 400, y: 80 }
};

// ===== Skill Data CRUD =====

function loadSkillLibrary() {
    try {
        const saved = localStorage.getItem(SKILL_HUD_STORAGE);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return parsed;
        }
    } catch (e) {}
    return [];
}

function saveSkillLibrary(skills) {
    try {
        localStorage.setItem(SKILL_HUD_STORAGE, JSON.stringify(skills));
    } catch (e) {}
}

function generateSkillId() {
    return 'skill_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
}

function addSkill(skillData) {
    const skills = loadSkillLibrary();
    const skill = {
        id: generateSkillId(),
        category: skillData.category || '未分類',
        name: skillData.name || '新招式',
        dp: parseInt(skillData.dp) || 0,
        pen: parseInt(skillData.pen) || 0,
        speed: parseInt(skillData.speed) || 0,
        magic: parseInt(skillData.magic) || 0,
        statusId: skillData.statusId || '',
        statusStacks: parseInt(skillData.statusStacks) || 0
    };
    skills.push(skill);
    saveSkillLibrary(skills);
    return skill;
}

function updateSkill(id, data) {
    const skills = loadSkillLibrary();
    const idx = skills.findIndex(s => s.id === id);
    if (idx === -1) return;
    Object.assign(skills[idx], data);
    saveSkillLibrary(skills);
}

function deleteSkill(id) {
    const skills = loadSkillLibrary().filter(s => s.id !== id);
    saveSkillLibrary(skills);
}

function getSkillsByCategory() {
    const skills = loadSkillLibrary();
    const groups = {};
    skills.forEach(s => {
        const cat = s.category || '未分類';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(s);
    });
    return groups;
}

// ===== Skill HUD Persistence =====

function loadSkillHudSettings() {
    try {
        const pos = localStorage.getItem(SKILL_HUD_POS_KEY);
        if (pos) {
            const p = JSON.parse(pos);
            if (p.x !== undefined) skillHudState.position = p;
        }
        const st = localStorage.getItem(SKILL_HUD_STATE_KEY);
        if (st) {
            const s = JSON.parse(st);
            if (s.collapsed !== undefined) skillHudState.isCollapsed = s.collapsed;
            if (s.visible !== undefined) skillHudState.isVisible = s.visible;
        }
    } catch (e) {}
}

function saveSkillHudSettings() {
    try {
        localStorage.setItem(SKILL_HUD_POS_KEY, JSON.stringify(skillHudState.position));
        localStorage.setItem(SKILL_HUD_STATE_KEY, JSON.stringify({
            collapsed: skillHudState.isCollapsed,
            visible: skillHudState.isVisible
        }));
    } catch (e) {}
}

function loadCalcHudSettings() {
    try {
        const pos = localStorage.getItem(CALC_HUD_POS_KEY);
        if (pos) {
            const p = JSON.parse(pos);
            if (p.x !== undefined) calcHudState.position = p;
        }
        const st = localStorage.getItem(CALC_HUD_STATE_KEY);
        if (st) {
            const s = JSON.parse(st);
            if (s.collapsed !== undefined) calcHudState.isCollapsed = s.collapsed;
            if (s.visible !== undefined) calcHudState.isVisible = s.visible;
        }
    } catch (e) {}
}

function saveCalcHudSettings() {
    try {
        localStorage.setItem(CALC_HUD_POS_KEY, JSON.stringify(calcHudState.position));
        localStorage.setItem(CALC_HUD_STATE_KEY, JSON.stringify({
            collapsed: calcHudState.isCollapsed,
            visible: calcHudState.isVisible
        }));
    } catch (e) {}
}

// ===== Generic Draggable Panel Setup =====

function setupPanelDrag(panelId, headerId, stateObj, saveFn) {
    const panel = document.getElementById(panelId);
    const header = document.getElementById(headerId);
    if (!panel || !header) return;

    let isDragging = false, hasMoved = false;
    const THRESHOLD = 5;
    let startX, startY, startPosX, startPosY;

    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, { passive: false });

    function startDrag(e) {
        if (e.target.closest('button')) return;
        isDragging = true; hasMoved = false;
        if (e.type === 'touchstart') {
            startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        } else {
            startX = e.clientX; startY = e.clientY;
        }
        const rect = panel.getBoundingClientRect();
        startPosX = rect.left; startPosY = rect.top;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('touchend', stopDrag);
        if (e.type === 'touchstart') e.preventDefault();
    }

    function onDrag(e) {
        if (!isDragging) return;
        let cx, cy;
        if (e.type === 'touchmove') { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
        else { cx = e.clientX; cy = e.clientY; }
        const dx = cx - startX, dy = cy - startY;
        if (!hasMoved && Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        if (!hasMoved) { hasMoved = true; panel.classList.add('dragging'); }
        const w = panel.offsetWidth || 340, h = panel.offsetHeight || 200;
        stateObj.position.x = Math.max(-w + 100, Math.min(window.innerWidth - 100, startPosX + dx));
        stateObj.position.y = Math.max(0, Math.min(window.innerHeight - 50, startPosY + dy));
        panel.style.left = stateObj.position.x + 'px';
        panel.style.top = stateObj.position.y + 'px';
        e.preventDefault();
    }

    function stopDrag() {
        if (isDragging) {
            isDragging = false;
            if (hasMoved) { panel.classList.remove('dragging'); saveFn(); }
            hasMoved = false;
        }
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', onDrag);
        document.removeEventListener('touchend', stopDrag);
    }
}

// ===== Generic Collapse Setup =====

function setupPanelCollapse(headerId, stateObj, panelId, saveFn, renderCollapsed, renderExpanded) {
    const header = document.getElementById(headerId);
    if (!header) return;

    let collapseTimer = null, justExpanded = false;

    header.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
        if (!stateObj.isCollapsed && !justExpanded) {
            stateObj.isCollapsed = true;
            document.getElementById(panelId).classList.add('collapsed');
            saveFn();
            if (renderCollapsed) renderCollapsed();
        }
        justExpanded = false;
    });

    header.addEventListener('click', (e) => {
        if (!stateObj.isCollapsed) return;
        if (e.target.closest('button')) return;
        if (collapseTimer) clearTimeout(collapseTimer);
        collapseTimer = setTimeout(() => {
            collapseTimer = null;
            if (stateObj.isCollapsed) {
                justExpanded = true;
                stateObj.isCollapsed = false;
                document.getElementById(panelId).classList.remove('collapsed');
                saveFn();
                if (renderExpanded) renderExpanded();
                setTimeout(() => { justExpanded = false; }, 400);
            }
        }, 250);
    });
}

// ===== Skill HUD Creation =====

function createSkillHUD() {
    if (document.getElementById('st-skill-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'st-skill-hud';
    hud.className = 'skill-hud hidden';
    hud.innerHTML = `
        <div class="skill-hud-header" id="skill-hud-header">
            <span class="skill-hud-title">🗡️ 怪物招式</span>
            <div class="skill-hud-controls">
                <button class="skill-hud-btn" onclick="toggleSkillHudMode()" title="切換模式">📝</button>
                <button class="skill-hud-btn" onclick="closeSkillHUD()" title="關閉">×</button>
            </div>
        </div>
        <div class="skill-hud-body" id="skill-hud-body"></div>
    `;
    document.body.appendChild(hud);
    hud.style.left = skillHudState.position.x + 'px';
    hud.style.top = skillHudState.position.y + 'px';

    if (skillHudState.isCollapsed) hud.classList.add('collapsed');

    setupPanelDrag('st-skill-hud', 'skill-hud-header', skillHudState, saveSkillHudSettings);
    setupPanelCollapse('skill-hud-header', skillHudState, 'st-skill-hud', saveSkillHudSettings,
        null, () => renderSkillHudContent());

    renderSkillHudContent();
}

// ===== Floating Calculator HUD Creation =====

function createCalcHUD() {
    if (document.getElementById('calc-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'calc-hud';
    hud.className = 'calc-hud hidden';
    hud.innerHTML = `
        <div class="calc-hud-header" id="calc-hud-header">
            <span class="calc-hud-title">🎲 DP 計算器</span>
            <div class="calc-hud-controls">
                <button class="skill-hud-btn" onclick="closeCalcHUD()" title="關閉">×</button>
            </div>
        </div>
        <div class="calc-hud-body" id="calc-hud-body"></div>
    `;
    document.body.appendChild(hud);
    hud.style.left = calcHudState.position.x + 'px';
    hud.style.top = calcHudState.position.y + 'px';

    if (calcHudState.isCollapsed) hud.classList.add('collapsed');

    setupPanelDrag('calc-hud', 'calc-hud-header', calcHudState, saveCalcHudSettings);
    setupPanelCollapse('calc-hud-header', calcHudState, 'calc-hud', saveCalcHudSettings);
}

// Move .calc-container from #page-calc into the floating panel (avoids duplicate IDs)
function moveCalcToHUD() {
    const pageCalc = document.getElementById('page-calc');
    const hudBody = document.getElementById('calc-hud-body');
    if (!pageCalc || !hudBody) return;
    const container = pageCalc.querySelector('.calc-container');
    if (container && !hudBody.contains(container)) {
        hudBody.appendChild(container);
    }
}

// Move .calc-container back to #page-calc when floating panel closes
function moveCalcBack() {
    const pageCalc = document.getElementById('page-calc');
    const hudBody = document.getElementById('calc-hud-body');
    if (!pageCalc || !hudBody) return;
    const container = hudBody.querySelector('.calc-container');
    if (container) {
        pageCalc.appendChild(container);
    }
}

// ===== Show/Hide/Toggle =====

function showSkillHUD() {
    createSkillHUD();
    const hud = document.getElementById('st-skill-hud');
    if (hud) hud.classList.remove('hidden');
    skillHudState.isVisible = true;
    saveSkillHudSettings();
    renderSkillHudContent();
}

function closeSkillHUD() {
    const hud = document.getElementById('st-skill-hud');
    if (hud) hud.classList.add('hidden');
    skillHudState.isVisible = false;
    saveSkillHudSettings();
}

function toggleSkillHUD() {
    if (skillHudState.isVisible) closeSkillHUD();
    else showSkillHUD();
}

function showCalcHUD() {
    createCalcHUD();
    const hud = document.getElementById('calc-hud');
    if (hud) hud.classList.remove('hidden');
    calcHudState.isVisible = true;
    saveCalcHudSettings();
    moveCalcToHUD();
}

function closeCalcHUD() {
    moveCalcBack();
    const hud = document.getElementById('calc-hud');
    if (hud) hud.classList.add('hidden');
    calcHudState.isVisible = false;
    saveCalcHudSettings();
}

function toggleCalcHUD() {
    if (calcHudState.isVisible) closeCalcHUD();
    else showCalcHUD();
}

// ===== Skill HUD Rendering =====

function toggleSkillHudMode() {
    skillHudState.mode = skillHudState.mode === 'battle' ? 'edit' : 'battle';
    skillHudState.editingId = null;
    renderSkillHudContent();
}

function renderSkillHudContent() {
    const body = document.getElementById('skill-hud-body');
    if (!body) return;

    if (skillHudState.mode === 'edit') {
        renderSkillEditMode(body);
    } else {
        renderSkillBattleMode(body);
    }
}

function renderSkillBattleMode(body) {
    const groups = getSkillsByCategory();
    const catNames = Object.keys(groups);

    if (catNames.length === 0) {
        body.innerHTML = `
            <div class="skill-empty">
                尚無招式<br>
                <button class="skill-add-btn" style="margin-top:10px;" onclick="skillHudState.mode='edit'; renderSkillHudContent();">+ 新增招式</button>
            </div>`;
        return;
    }

    let html = '';
    catNames.forEach(cat => {
        const safeCatId = encodeURIComponent(cat).replace(/%/g, '_');
        html += `<div class="skill-category" id="skill-cat-${safeCatId}">`;
        html += `<div class="skill-category-header" onclick="this.parentElement.classList.toggle('collapsed-cat')">
                    <span class="cat-toggle">▼</span> ${escapeHtml(cat)} (${groups[cat].length})
                 </div>`;
        html += '<div class="skill-card-list">';
        groups[cat].forEach(skill => {
            html += renderSkillCard(skill);
        });
        html += '</div></div>';
    });

    body.innerHTML = html;
}

function renderSkillCard(skill) {
    const statusName = getStatusName(skill.statusId);
    let statsHtml = `<span class="skill-stat dp">DP ${skill.dp}</span>`;
    if (skill.pen > 0) statsHtml += `<span class="skill-stat pen">破甲 ${skill.pen}</span>`;
    if (skill.speed > 0) statsHtml += `<span class="skill-stat speed">高速 ${skill.speed}</span>`;
    if (skill.magic > 0) statsHtml += `<span class="skill-stat magic">破魔 ${skill.magic}</span>`;
    if (skill.statusId && statusName) {
        statsHtml += `<span class="skill-stat status">${statusName}${skill.statusStacks > 0 ? ' x' + skill.statusStacks : ''}</span>`;
    }

    return `<div class="skill-card">
        <div class="skill-card-top">
            <span class="skill-card-name">${escapeHtml(skill.name)}</span>
        </div>
        <div class="skill-card-stats">${statsHtml}</div>
        <div class="skill-card-actions">
            <button class="skill-action-btn calc-fill" onclick="applySkillToCalc('${skill.id}')">填入計算器</button>
            ${skill.statusId ? `<button class="skill-action-btn status-apply" onclick="applySkillStatus('${skill.id}')">套用狀態</button>` : ''}
            <button class="skill-action-btn" onclick="startEditSkill('${skill.id}')">編輯</button>
        </div>
    </div>`;
}

function renderSkillEditMode(body) {
    const skills = loadSkillLibrary();
    let html = '<div style="margin-bottom:8px;font-size:0.8rem;color:var(--text-dim);">編輯模式 — 新增或修改招式</div>';

    if (skillHudState.editingId) {
        const skill = skills.find(s => s.id === skillHudState.editingId);
        if (skill) {
            html += renderSkillEditForm(skill);
            body.innerHTML = html;
            return;
        }
    }

    // Show list with edit buttons + add new form
    skills.forEach(s => {
        html += `<div class="skill-card" style="cursor:pointer;" onclick="startEditSkill('${s.id}')">
            <div class="skill-card-top">
                <span class="skill-card-name">${escapeHtml(s.name)}</span>
                <span style="font-size:0.7rem;color:var(--text-dim);">${escapeHtml(s.category)}</span>
            </div>
        </div>`;
    });

    html += renderSkillEditForm(null); // new skill form
    body.innerHTML = html;
}

function renderSkillEditForm(skill) {
    const isNew = !skill;
    const id = skill ? skill.id : 'new';
    const statusOptions = buildStatusOptions(skill ? skill.statusId : '');

    return `<div class="skill-edit-form" id="skill-form-${id}">
        <div style="font-weight:bold;font-size:0.85rem;color:var(--accent-red);margin-bottom:4px;">
            ${isNew ? '+ 新增招式' : '編輯：' + escapeHtml(skill.name)}
        </div>
        <div class="skill-edit-row">
            <label>類別</label>
            <input type="text" id="sf-cat-${id}" value="${skill ? escapeHtml(skill.category) : ''}" placeholder="例：BOSS 克羅默">
        </div>
        <div class="skill-edit-row">
            <label>招式名</label>
            <input type="text" id="sf-name-${id}" value="${skill ? escapeHtml(skill.name) : ''}" placeholder="例：血肉橫飛">
        </div>
        <div class="skill-edit-row">
            <label>DP</label>
            <input type="number" id="sf-dp-${id}" value="${skill ? skill.dp : 10}" min="0">
            <label>破甲</label>
            <input type="number" id="sf-pen-${id}" value="${skill ? skill.pen : 0}" min="0">
        </div>
        <div class="skill-edit-row">
            <label>高速</label>
            <input type="number" id="sf-speed-${id}" value="${skill ? skill.speed : 0}" min="0">
            <label>破魔</label>
            <input type="number" id="sf-magic-${id}" value="${skill ? skill.magic : 0}" min="0">
        </div>
        <div class="skill-edit-row">
            <label>狀態</label>
            <select id="sf-status-${id}">${statusOptions}</select>
        </div>
        <div class="skill-edit-row">
            <label>層數</label>
            <input type="number" id="sf-stacks-${id}" value="${skill ? skill.statusStacks : 0}" min="0">
        </div>
        <div class="skill-edit-btns">
            <button class="skill-save-btn" onclick="saveSkillForm('${id}')">
                ${isNew ? '新增' : '儲存'}
            </button>
            ${!isNew ? `<button class="skill-delete-btn" onclick="confirmDeleteSkill('${id}')">刪除</button>` : ''}
            <button class="skill-cancel-btn" onclick="skillHudState.editingId=null; renderSkillHudContent();">取消</button>
        </div>
    </div>`;
}

function buildStatusOptions(selectedId) {
    let opts = '<option value="">-- 無 --</option>';
    if (typeof STATUS_LIBRARY === 'undefined') return opts;

    Object.keys(STATUS_LIBRARY).forEach(catKey => {
        const cat = STATUS_LIBRARY[catKey];
        if (!cat || !cat.statuses) return;
        opts += `<optgroup label="${cat.name || catKey}">`;
        cat.statuses.forEach(s => {
            const sel = s.id === selectedId ? ' selected' : '';
            opts += `<option value="${s.id}"${sel}>${s.icon || ''} ${s.name}</option>`;
        });
        opts += '</optgroup>';
    });
    return opts;
}

function getStatusName(statusId) {
    if (!statusId || typeof STATUS_LIBRARY === 'undefined') return '';
    for (const catKey of Object.keys(STATUS_LIBRARY)) {
        const cat = STATUS_LIBRARY[catKey];
        if (!cat || !cat.statuses) continue;
        const found = cat.statuses.find(s => s.id === statusId);
        if (found) return (found.icon || '') + ' ' + found.name;
    }
    return statusId;
}

function getStatusDisplayName(statusId) {
    if (!statusId || typeof STATUS_LIBRARY === 'undefined') return statusId;
    for (const catKey of Object.keys(STATUS_LIBRARY)) {
        const cat = STATUS_LIBRARY[catKey];
        if (!cat || !cat.statuses) continue;
        const found = cat.statuses.find(s => s.id === statusId);
        if (found) return found.name;
    }
    return statusId;
}

// ===== Form Actions =====

function startEditSkill(id) {
    skillHudState.editingId = id;
    skillHudState.mode = 'edit';
    renderSkillHudContent();
}

function saveSkillForm(id) {
    const cat = document.getElementById('sf-cat-' + id);
    const name = document.getElementById('sf-name-' + id);
    const dp = document.getElementById('sf-dp-' + id);
    const pen = document.getElementById('sf-pen-' + id);
    const speed = document.getElementById('sf-speed-' + id);
    const magic = document.getElementById('sf-magic-' + id);
    const status = document.getElementById('sf-status-' + id);
    const stacks = document.getElementById('sf-stacks-' + id);

    if (!name || !name.value.trim()) {
        if (typeof showToast === 'function') showToast('請輸入招式名稱');
        return;
    }

    const data = {
        category: cat ? cat.value.trim() || '未分類' : '未分類',
        name: name.value.trim(),
        dp: dp ? parseInt(dp.value) || 0 : 0,
        pen: pen ? parseInt(pen.value) || 0 : 0,
        speed: speed ? parseInt(speed.value) || 0 : 0,
        magic: magic ? parseInt(magic.value) || 0 : 0,
        statusId: status ? status.value : '',
        statusStacks: stacks ? parseInt(stacks.value) || 0 : 0
    };

    if (id === 'new') {
        addSkill(data);
        if (typeof showToast === 'function') showToast('已新增招式：' + data.name);
    } else {
        updateSkill(id, data);
        if (typeof showToast === 'function') showToast('已更新招式：' + data.name);
    }

    skillHudState.editingId = null;
    renderSkillHudContent();
}

function confirmDeleteSkill(id) {
    const skills = loadSkillLibrary();
    const skill = skills.find(s => s.id === id);
    if (!skill) return;
    if (confirm('確定要刪除「' + skill.name + '」？')) {
        deleteSkill(id);
        skillHudState.editingId = null;
        renderSkillHudContent();
        if (typeof showToast === 'function') showToast('已刪除招式：' + skill.name);
    }
}

// ===== Core Interaction: Calculator Integration =====

function applySkillToCalc(skillId) {
    const skills = loadSkillLibrary();
    const skill = skills.find(s => s.id === skillId);
    if (!skill) return;

    // Try floating calc first, then page calc
    const atkInput = document.getElementById('c-atk');
    const penInput = document.getElementById('c-pen');
    const speedInput = document.getElementById('c-speed');
    const magicInput = document.getElementById('c-magic');

    if (atkInput) atkInput.value = skill.dp;
    if (penInput) penInput.value = skill.pen;
    if (speedInput) speedInput.value = skill.speed;
    if (magicInput) magicInput.value = skill.magic;

    // Activate tags if values > 0
    if (skill.pen > 0 && typeof toggleAtkTag === 'function') {
        const tag = document.querySelector('.atk-tag[data-type="pen"]');
        if (tag && !tag.classList.contains('active')) toggleAtkTag('pen');
    }
    if (skill.speed > 0 && typeof toggleAtkTag === 'function') {
        const tag = document.querySelector('.atk-tag[data-type="speed"]');
        if (tag && !tag.classList.contains('active')) toggleAtkTag('speed');
    }
    if (skill.magic > 0 && typeof toggleAtkTag === 'function') {
        const tag = document.querySelector('.atk-tag[data-type="magic"]');
        if (tag && !tag.classList.contains('active')) toggleAtkTag('magic');
    }

    // Auto-show calc HUD if not visible
    if (!calcHudState.isVisible) showCalcHUD();

    if (typeof showToast === 'function') showToast('已載入招式：' + skill.name);
}

// ===== Core Interaction: Status Application =====

function applySkillStatus(skillId) {
    const skills = loadSkillLibrary();
    const skill = skills.find(s => s.id === skillId);
    if (!skill || !skill.statusId) return;

    // Check for selected unit
    if (typeof selectedUnitId === 'undefined' || !selectedUnitId) {
        if (typeof showToast === 'function') showToast('請先在地圖上選取目標單位！');
        return;
    }

    // Find unit name
    let unitName = selectedUnitId;
    if (typeof state !== 'undefined' && state.units) {
        const unit = state.units.find(u => u.id === selectedUnitId);
        if (unit) unitName = unit.name || unit.id;
    }

    const statusDisplayName = getStatusDisplayName(skill.statusId);

    // Use existing status manager
    if (typeof addStatusToUnit === 'function') {
        addStatusToUnit(selectedUnitId, skill.statusId, skill.statusStacks > 0 ? skill.statusStacks : null);
        if (typeof showToast === 'function') {
            showToast('已對 ' + unitName + ' 施加 ' + statusDisplayName +
                (skill.statusStacks > 0 ? ' x' + skill.statusStacks : ''));
        }
    } else {
        if (typeof showToast === 'function') showToast('狀態管理器未載入');
    }
}

// ===== Combat HUD -> Calculator Integration =====

function applyDefenseToCalc(defType, value) {
    // defType should match DEF_TYPES id (base, dodge, block, shield, armor, natural, etc.)
    const input = document.querySelector(`input[data-def="${defType}"]`);
    if (input) {
        input.value = value;
        // Activate the tag
        const tag = document.querySelector(`.def-tag[data-def="${defType}"]`);
        if (tag && !tag.classList.contains('active') && typeof toggleDefTag === 'function') {
            toggleDefTag(defType);
        }
    }
    if (!calcHudState.isVisible) showCalcHUD();
    if (typeof showToast === 'function') showToast('已載入防禦值：' + value);
}

function applyAttackToCalc(dp, pen, speed, magic, name) {
    const atkInput = document.getElementById('c-atk');
    const penInput = document.getElementById('c-pen');
    const speedInput = document.getElementById('c-speed');
    const magicInput = document.getElementById('c-magic');

    if (atkInput) atkInput.value = dp || 0;
    if (penInput) penInput.value = pen || 0;
    if (speedInput) speedInput.value = speed || 0;
    if (magicInput) magicInput.value = magic || 0;

    if (pen > 0 && typeof toggleAtkTag === 'function') {
        const tag = document.querySelector('.atk-tag[data-type="pen"]');
        if (tag && !tag.classList.contains('active')) toggleAtkTag('pen');
    }
    if (speed > 0 && typeof toggleAtkTag === 'function') {
        const tag = document.querySelector('.atk-tag[data-type="speed"]');
        if (tag && !tag.classList.contains('active')) toggleAtkTag('speed');
    }
    if (magic > 0 && typeof toggleAtkTag === 'function') {
        const tag = document.querySelector('.atk-tag[data-type="magic"]');
        if (tag && !tag.classList.contains('active')) toggleAtkTag('magic');
    }

    if (!calcHudState.isVisible) showCalcHUD();
    if (typeof showToast === 'function') showToast('已載入攻擊：' + (name || 'DP ' + dp));
}

// ===== Window bindings =====
window.toggleSkillHUD = toggleSkillHUD;
window.showSkillHUD = showSkillHUD;
window.closeSkillHUD = closeSkillHUD;
window.toggleCalcHUD = toggleCalcHUD;
window.showCalcHUD = showCalcHUD;
window.closeCalcHUD = closeCalcHUD;
window.toggleSkillHudMode = toggleSkillHudMode;
window.applySkillToCalc = applySkillToCalc;
window.applySkillStatus = applySkillStatus;
window.startEditSkill = startEditSkill;
window.saveSkillForm = saveSkillForm;
window.confirmDeleteSkill = confirmDeleteSkill;
window.applyDefenseToCalc = applyDefenseToCalc;
window.applyAttackToCalc = applyAttackToCalc;
window.renderSkillHudContent = renderSkillHudContent;

// ===== Init =====
function initSkillHUD() {
    loadSkillHudSettings();
    loadCalcHudSettings();

    // Auto-show if previously visible
    if (skillHudState.isVisible) showSkillHUD();
    if (calcHudState.isVisible) showCalcHUD();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSkillHUD);
} else {
    initSkillHUD();
}

console.log('ST Skill Macro HUD + Floating Calculator loaded');

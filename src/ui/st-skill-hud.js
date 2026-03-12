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
const MONSTER_META_STORAGE = 'limbus_st_monster_meta';

// ===== State =====
let skillHudState = {
    isVisible: false,
    isCollapsed: false,
    position: { x: 20, y: 300 },
    editingId: null,       // currently editing skill id
    editingMonster: null,  // currently editing monster category name
    mode: 'battle'         // 'battle' or 'edit'
};

let calcHudState = {
    isVisible: false,
    isCollapsed: false,
    position: { x: 400, y: 80 }
};

// ===== Editing State for Status Tags =====
let editingStatuses = [];  // [{id, stacks}] - temp state for skill edit form
let editingPassives = [];  // [{name, desc}] - temp state for monster edit form

// Normalize old (statusId) and new (statuses[]) format
function normalizeSkillStatuses(skill) {
    if (skill.statuses && Array.isArray(skill.statuses)) return skill.statuses;
    if (skill.statusId) return [{ id: skill.statusId, stacks: skill.statusStacks || 0 }];
    return [];
}

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
        successBonus: parseInt(skillData.successBonus) || 0,
        trigger: skillData.trigger || '',
        description: skillData.description || '',
        statuses: skillData.statuses || []
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

// ===== Monster Meta CRUD =====

function loadMonsterMeta() {
    try {
        const saved = localStorage.getItem(MONSTER_META_STORAGE);
        if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
}

function saveMonsterMeta(meta) {
    try {
        localStorage.setItem(MONSTER_META_STORAGE, JSON.stringify(meta));
    } catch (e) {}
}

function getMonsterInfo(category) {
    const meta = loadMonsterMeta();
    return meta[category] || null;
}

function updateMonsterInfo(category, data) {
    const meta = loadMonsterMeta();
    meta[category] = data;
    saveMonsterMeta(meta);
}

function deleteMonsterInfo(category) {
    const meta = loadMonsterMeta();
    delete meta[category];
    saveMonsterMeta(meta);
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

    // Double-click to collapse
    header.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        if (!stateObj.isCollapsed) {
            stateObj.isCollapsed = true;
            document.getElementById(panelId).classList.add('collapsed');
            saveFn();
            if (renderCollapsed) renderCollapsed();
        }
    });

    // Single click to expand
    header.addEventListener('click', (e) => {
        if (!stateObj.isCollapsed) return;
        if (e.target.closest('button')) return;

        stateObj.isCollapsed = false;
        document.getElementById(panelId).classList.remove('collapsed');
        saveFn();
        if (renderExpanded) renderExpanded();
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

    if (skillHudState.editingMonster) {
        renderMonsterEditMode(body, skillHudState.editingMonster);
    } else if (skillHudState.mode === 'edit') {
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
        const monsterInfo = getMonsterInfo(cat);
        html += `<div class="skill-category" id="skill-cat-${safeCatId}">`;
        html += `<div class="skill-category-header">
                    <span class="cat-toggle" onclick="this.parentElement.parentElement.classList.toggle('collapsed-cat')">▼</span>
                    <span class="cat-name" onclick="this.parentElement.parentElement.classList.toggle('collapsed-cat')">${escapeHtml(cat)} (${groups[cat].length})</span>
                    <button class="cat-edit-btn" onclick="event.stopPropagation(); startEditMonster(decodeURIComponent('${encodeURIComponent(cat)}'))" title="編輯怪物資訊">&#9998;</button>
                 </div>`;
        if (monsterInfo) html += renderMonsterInfoSection(monsterInfo);
        html += '<div class="skill-card-list">';
        groups[cat].forEach(skill => {
            html += renderSkillCard(skill);
        });
        html += '</div></div>';
    });

    body.innerHTML = html;
}

function renderSkillCard(skill) {
    const statuses = normalizeSkillStatuses(skill);
    let statsHtml = `<span class="skill-stat dp">DP ${skill.dp}</span>`;
    if (skill.pen > 0) statsHtml += `<span class="skill-stat pen">破甲 ${skill.pen}</span>`;
    if (skill.speed > 0) statsHtml += `<span class="skill-stat speed">高速 ${skill.speed}</span>`;
    if (skill.magic > 0) statsHtml += `<span class="skill-stat magic">破魔 ${skill.magic}</span>`;
    if (skill.successBonus > 0) statsHtml += `<span class="skill-stat success-bonus">附加成功 ${skill.successBonus}</span>`;
    if (skill.trigger) statsHtml += `<span class="skill-stat trigger">${escapeHtml(skill.trigger)}</span>`;
    statuses.forEach(s => {
        const name = getStatusName(s.id);
        if (name) statsHtml += `<span class="skill-stat status">${name}${s.stacks > 0 ? ' x' + s.stacks : ''}</span>`;
    });

    const hasStatus = statuses.length > 0;
    const descHtml = skill.description ? `<div class="skill-card-desc">${escapeHtml(skill.description)}</div>` : '';
    return `<div class="skill-card">
        <div class="skill-card-top">
            <span class="skill-card-name">${escapeHtml(skill.name)}</span>
        </div>
        <div class="skill-card-stats">${statsHtml}</div>
        ${descHtml}
        <div class="skill-card-actions">
            <button class="skill-action-btn calc-fill" onclick="applySkillToCalc('${skill.id}')">填入計算器</button>
            ${hasStatus ? `<button class="skill-action-btn status-apply" onclick="applySkillStatus('${skill.id}')">套用狀態</button>` : ''}
            <button class="skill-action-btn" onclick="startEditSkill('${skill.id}')">編輯</button>
        </div>
    </div>`;
}

// ===== Monster Info Rendering =====

function renderMonsterInfoSection(info) {
    let badges = '';

    if (info.hp) badges += `<span class="monster-stat hp">HP ${info.hp}</span>`;
    if (info.initiative) badges += `<span class="monster-stat init">先攻 ${info.initiative}</span>`;
    if (info.defenseBase) {
        badges += `<span class="monster-stat def">防禦 ${info.defenseBase}${info.defenseBonus ? '+' + info.defenseBonus : ''}</span>`;
    }
    if (info.allAttr) {
        badges += `<span class="monster-stat attr">全屬性 ${info.allAttr}${info.allAttrBonus ? '(+' + info.allAttrBonus + ')' : ''}</span>`;
    }
    if (info.allSkill) {
        badges += `<span class="monster-stat skill-val">全技能 ${info.allSkill}${info.allSkillBonus ? '(+' + info.allSkillBonus + ')' : ''}</span>`;
    }
    if (info.savesBase) {
        badges += `<span class="monster-stat save">三豁免 ${info.savesBase}${info.savesBonus ? '+' + info.savesBonus : ''}</span>`;
    }
    if (info.defaultSpeed) badges += `<span class="monster-stat spd">高速 ${info.defaultSpeed}</span>`;
    if (info.defaultPen) badges += `<span class="monster-stat pen-val">破甲 ${info.defaultPen}</span>`;

    let passiveHtml = '';
    if (info.passives && info.passives.length > 0) {
        passiveHtml = '<div class="monster-passives">';
        info.passives.forEach(p => {
            passiveHtml += `<div class="monster-passive-item"><span class="passive-name">${escapeHtml(p.name)}</span>：${escapeHtml(p.desc)}</div>`;
        });
        passiveHtml += '</div>';
    }

    if (!badges && !passiveHtml) return '';

    return `<div class="monster-info-section">
        ${badges ? '<div class="monster-info-stats">' + badges + '</div>' : ''}
        ${passiveHtml}
    </div>`;
}

function startEditMonster(category) {
    skillHudState.editingMonster = category;
    const info = getMonsterInfo(category);
    editingPassives = (info && info.passives) ? info.passives.map(p => ({...p})) : [];
    renderSkillHudContent();
}

function renderMonsterEditMode(body, category) {
    const info = getMonsterInfo(category) || {};
    const safeCat = escapeHtml(category);
    const encodedCat = encodeURIComponent(category);

    const passivesHtml = editingPassives.length > 0
        ? editingPassives.map((p, idx) =>
            `<div class="passive-edit-row">
                <input type="text" class="passive-name-input" value="${escapeHtml(p.name)}" placeholder="名稱"
                    onchange="updateEditingPassive(${idx},'name',this.value)">
                <input type="text" class="passive-desc-input" value="${escapeHtml(p.desc)}" placeholder="效果描述"
                    onchange="updateEditingPassive(${idx},'desc',this.value)">
                <button class="status-tag-remove" onclick="removeEditingPassive(${idx})" title="移除">×</button>
            </div>`
        ).join('')
        : '<div style="font-size:0.75rem;color:var(--text-dim);">尚未新增被動</div>';

    body.innerHTML = `
        <div class="monster-edit-form">
            <div style="font-weight:bold;font-size:0.85rem;color:var(--accent-yellow);margin-bottom:8px;">
                編輯怪物資訊：${safeCat}
            </div>
            <div class="skill-edit-row">
                <label>HP</label>
                <input type="number" id="mf-hp" value="${info.hp || 0}" min="0">
                <label>先攻</label>
                <input type="number" id="mf-init" value="${info.initiative || 0}" min="0">
            </div>
            <div class="skill-edit-row">
                <label>全屬性</label>
                <input type="number" id="mf-attr" value="${info.allAttr || 0}" min="0">
                <label>附加</label>
                <input type="number" id="mf-attr-bonus" value="${info.allAttrBonus || 0}" min="0">
            </div>
            <div class="skill-edit-row">
                <label>全技能</label>
                <input type="number" id="mf-skill" value="${info.allSkill || 0}" min="0">
                <label>附加</label>
                <input type="number" id="mf-skill-bonus" value="${info.allSkillBonus || 0}" min="0">
            </div>
            <div class="skill-edit-row">
                <label>三豁免</label>
                <input type="number" id="mf-saves" value="${info.savesBase || 0}" min="0">
                <label>加值</label>
                <input type="number" id="mf-saves-bonus" value="${info.savesBonus || 0}" min="0">
            </div>
            <div class="skill-edit-row">
                <label>防禦</label>
                <input type="number" id="mf-def" value="${info.defenseBase || 0}" min="0">
                <label>加值</label>
                <input type="number" id="mf-def-bonus" value="${info.defenseBonus || 0}" min="0">
            </div>
            <div class="skill-edit-row">
                <label>高速</label>
                <input type="number" id="mf-speed" value="${info.defaultSpeed || 0}" min="0">
                <label>破甲</label>
                <input type="number" id="mf-pen" value="${info.defaultPen || 0}" min="0">
            </div>
            <div class="skill-status-section">
                <label style="font-size:0.75rem;color:var(--text-dim);margin-bottom:4px;display:block;">被動能力</label>
                <div id="monster-passives-list">
                    ${passivesHtml}
                </div>
                <button class="skill-add-btn" style="margin-top:4px;padding:4px;" onclick="addEditingPassive()">+ 新增被動</button>
            </div>
            <div class="skill-edit-btns">
                <button class="skill-save-btn" onclick="saveMonsterForm(decodeURIComponent('${encodedCat}'))">儲存</button>
                <button class="skill-delete-btn" onclick="if(confirm('確定清除此怪物資訊？')){deleteMonsterInfo(decodeURIComponent('${encodedCat}')); skillHudState.editingMonster=null; renderSkillHudContent();}">清除</button>
                <button class="skill-cancel-btn" onclick="skillHudState.editingMonster=null; renderSkillHudContent();">取消</button>
            </div>
        </div>`;
}

function saveMonsterForm(category) {
    const data = {
        hp: parseInt(document.getElementById('mf-hp')?.value) || 0,
        initiative: parseInt(document.getElementById('mf-init')?.value) || 0,
        allAttr: parseInt(document.getElementById('mf-attr')?.value) || 0,
        allAttrBonus: parseInt(document.getElementById('mf-attr-bonus')?.value) || 0,
        allSkill: parseInt(document.getElementById('mf-skill')?.value) || 0,
        allSkillBonus: parseInt(document.getElementById('mf-skill-bonus')?.value) || 0,
        savesBase: parseInt(document.getElementById('mf-saves')?.value) || 0,
        savesBonus: parseInt(document.getElementById('mf-saves-bonus')?.value) || 0,
        defenseBase: parseInt(document.getElementById('mf-def')?.value) || 0,
        defenseBonus: parseInt(document.getElementById('mf-def-bonus')?.value) || 0,
        defaultSpeed: parseInt(document.getElementById('mf-speed')?.value) || 0,
        defaultPen: parseInt(document.getElementById('mf-pen')?.value) || 0,
        passives: editingPassives.filter(p => p.name.trim() || p.desc.trim())
    };

    updateMonsterInfo(category, data);
    skillHudState.editingMonster = null;
    renderSkillHudContent();
    if (typeof showToast === 'function') showToast('已儲存怪物資訊：' + category);
}

function renderSkillEditMode(body) {
    const skills = loadSkillLibrary();
    let html = '<div style="margin-bottom:8px;font-size:0.8rem;color:var(--text-dim);">編輯模式 — 新增或修改招式</div>';

    if (skillHudState.editingId) {
        const skill = skills.find(s => s.id === skillHudState.editingId);
        if (skill) {
            editingStatuses = normalizeSkillStatuses(skill).map(s => ({...s}));
            html += renderSkillEditForm(skill);
            body.innerHTML = html;
            return;
        }
    }

    // New form: reset editingStatuses
    editingStatuses = [];

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

    // Build selected statuses HTML from editingStatuses
    const selectedHtml = editingStatuses.length > 0
        ? editingStatuses.map((s, idx) => {
            const name = getStatusName(s.id);
            return `<div class="status-tag">
                <span class="status-tag-name">${name || s.id}</span>
                <label class="status-tag-stacks-label">x</label>
                <input type="number" class="status-tag-stacks" value="${s.stacks}" min="0"
                    onchange="updateEditingStatusStacks(${idx}, parseInt(this.value)||0)">
                <button class="status-tag-remove" onclick="removeEditingStatus(${idx})" title="移除">×</button>
            </div>`;
        }).join('')
        : '<div style="font-size:0.75rem;color:var(--text-dim);">尚未選擇狀態</div>';

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
            <label>附加成功</label>
            <input type="number" id="sf-success-${id}" value="${skill ? (skill.successBonus || 0) : 0}" min="0">
        </div>
        <div class="skill-edit-row">
            <label>效果描述</label>
            <textarea id="sf-desc-${id}" rows="2" placeholder="例：目標意志力扣除10點" style="flex:1;padding:5px 8px;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-main);font-size:0.8rem;resize:vertical;font-family:inherit;">${skill && skill.description ? escapeHtml(skill.description) : ''}</textarea>
        </div>
        <div class="skill-edit-row">
            <label>觸發時機</label>
            <select id="sf-trigger-${id}">
                <option value=""${!skill || !skill.trigger ? ' selected' : ''}>（無）</option>
                <option value="攻擊後"${skill && skill.trigger === '攻擊後' ? ' selected' : ''}>攻擊後</option>
                <option value="造成傷害後"${skill && skill.trigger === '造成傷害後' ? ' selected' : ''}>造成傷害後</option>
                <option value="命中後"${skill && skill.trigger === '命中後' ? ' selected' : ''}>命中後</option>
                <option value="被攻擊時"${skill && skill.trigger === '被攻擊時' ? ' selected' : ''}>被攻擊時</option>
                <option value="被命中時"${skill && skill.trigger === '被命中時' ? ' selected' : ''}>被命中時</option>
                <option value="受傷時"${skill && skill.trigger === '受傷時' ? ' selected' : ''}>受傷時</option>
                <option value="回合開始"${skill && skill.trigger === '回合開始' ? ' selected' : ''}>回合開始</option>
                <option value="回合結束"${skill && skill.trigger === '回合結束' ? ' selected' : ''}>回合結束</option>
                <option value="持續"${skill && skill.trigger === '持續' ? ' selected' : ''}>持續</option>
            </select>
        </div>
        <div class="skill-status-section">
            <label style="font-size:0.75rem;color:var(--text-dim);margin-bottom:4px;display:block;">狀態效果</label>
            <div class="skill-status-search-wrap">
                <input type="text" id="sf-status-search-${id}" class="skill-status-search"
                    placeholder="輸入關鍵字搜尋狀態..." oninput="filterSkillStatuses(this.value, '${id}')">
                <div class="skill-status-suggestions" id="status-suggest-${id}"></div>
            </div>
            <div class="skill-status-selected" id="status-selected-${id}">
                ${selectedHtml}
            </div>
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

// ===== Status Fuzzy Search + Tag Selection =====

function filterSkillStatuses(query, formId) {
    const suggestBox = document.getElementById('status-suggest-' + formId);
    if (!suggestBox) return;
    if (!query || !query.trim() || typeof STATUS_LIBRARY === 'undefined') {
        suggestBox.innerHTML = '';
        return;
    }
    const q = query.toLowerCase().trim();
    const results = [];
    const alreadyIds = new Set(editingStatuses.map(s => s.id));

    Object.keys(STATUS_LIBRARY).forEach(catKey => {
        const cat = STATUS_LIBRARY[catKey];
        if (!cat || !Array.isArray(cat)) return;
        cat.forEach(s => {
            if (alreadyIds.has(s.id)) return; // skip already selected
            if (s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) {
                results.push(s);
            }
        });
    });

    suggestBox.innerHTML = results.slice(0, 8).map(s =>
        `<div class="status-suggest-item" onclick="selectSkillStatus('${s.id}', '${formId}')">
            ${s.icon || ''} ${escapeHtml(s.name)}
            <span style="font-size:0.65rem;color:var(--text-dim);margin-left:auto;">${s.type === 'stack' ? '可疊加' : '二元'}</span>
        </div>`
    ).join('');

    if (results.length === 0) {
        suggestBox.innerHTML = '<div class="status-suggest-empty">找不到符合的狀態</div>';
    }
}

function selectSkillStatus(statusId, formId) {
    if (editingStatuses.some(s => s.id === statusId)) return;
    editingStatuses.push({ id: statusId, stacks: 0 });
    renderSelectedStatuses(formId);
    // Clear search
    const searchInput = document.getElementById('sf-status-search-' + formId);
    if (searchInput) searchInput.value = '';
    const suggestBox = document.getElementById('status-suggest-' + formId);
    if (suggestBox) suggestBox.innerHTML = '';
}

function removeEditingStatus(index) {
    editingStatuses.splice(index, 1);
    // Re-render: find the visible form
    const formId = skillHudState.editingId || 'new';
    renderSelectedStatuses(formId);
}

function updateEditingStatusStacks(index, stacks) {
    if (editingStatuses[index]) {
        editingStatuses[index].stacks = stacks;
    }
}

function renderSelectedStatuses(formId) {
    const container = document.getElementById('status-selected-' + formId);
    if (!container) return;

    if (editingStatuses.length === 0) {
        container.innerHTML = '<div style="font-size:0.75rem;color:var(--text-dim);">尚未選擇狀態</div>';
        return;
    }

    container.innerHTML = editingStatuses.map((s, idx) => {
        const name = getStatusName(s.id);
        return `<div class="status-tag">
            <span class="status-tag-name">${name || s.id}</span>
            <label class="status-tag-stacks-label">x</label>
            <input type="number" class="status-tag-stacks" value="${s.stacks}" min="0"
                onchange="updateEditingStatusStacks(${idx}, parseInt(this.value)||0)">
            <button class="status-tag-remove" onclick="removeEditingStatus(${idx})" title="移除">×</button>
        </div>`;
    }).join('');
}

function getStatusName(statusId) {
    if (!statusId || typeof STATUS_LIBRARY === 'undefined') return '';
    for (const catKey of Object.keys(STATUS_LIBRARY)) {
        const cat = STATUS_LIBRARY[catKey];
        if (!cat || !Array.isArray(cat)) continue;
        const found = cat.find(s => s.id === statusId);
        if (found) return (found.icon || '') + ' ' + found.name;
    }
    return statusId;
}

// ===== Passive Editing Helpers =====

function addEditingPassive() {
    editingPassives.push({ name: '', desc: '' });
    renderSkillHudContent();
}

function removeEditingPassive(index) {
    editingPassives.splice(index, 1);
    renderSkillHudContent();
}

function updateEditingPassive(index, field, value) {
    if (editingPassives[index]) {
        editingPassives[index][field] = value;
    }
}

function getStatusDisplayName(statusId) {
    if (!statusId || typeof STATUS_LIBRARY === 'undefined') return statusId;
    for (const catKey of Object.keys(STATUS_LIBRARY)) {
        const cat = STATUS_LIBRARY[catKey];
        if (!cat || !Array.isArray(cat)) continue;
        const found = cat.find(s => s.id === statusId);
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
    const successEl = document.getElementById('sf-success-' + id);
    const triggerEl = document.getElementById('sf-trigger-' + id);

    if (!name || !name.value.trim()) {
        if (typeof showToast === 'function') showToast('請輸入招式名稱');
        return;
    }

    const descEl = document.getElementById('sf-desc-' + id);

    const data = {
        category: cat ? cat.value.trim() || '未分類' : '未分類',
        name: name.value.trim(),
        dp: dp ? parseInt(dp.value) || 0 : 0,
        pen: pen ? parseInt(pen.value) || 0 : 0,
        speed: speed ? parseInt(speed.value) || 0 : 0,
        magic: magic ? parseInt(magic.value) || 0 : 0,
        successBonus: successEl ? parseInt(successEl.value) || 0 : 0,
        description: descEl ? descEl.value.trim() : '',
        trigger: triggerEl ? triggerEl.value : '',
        statuses: editingStatuses.map(s => ({...s}))
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
    if (!skill) return;

    const statuses = normalizeSkillStatuses(skill);
    if (statuses.length === 0) return;

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

    // Use existing status manager
    if (typeof addStatusToUnit !== 'function') {
        if (typeof showToast === 'function') showToast('狀態管理器未載入');
        return;
    }

    const appliedNames = [];
    statuses.forEach(s => {
        addStatusToUnit(selectedUnitId, s.id, s.stacks > 0 ? s.stacks : null);
        appliedNames.push(getStatusDisplayName(s.id) + (s.stacks > 0 ? ' x' + s.stacks : ''));
    });

    if (typeof showToast === 'function') {
        showToast('已對 ' + unitName + ' 施加 ' + appliedNames.join(', '));
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
window.filterSkillStatuses = filterSkillStatuses;
window.selectSkillStatus = selectSkillStatus;
window.removeEditingStatus = removeEditingStatus;
window.updateEditingStatusStacks = updateEditingStatusStacks;
window.startEditMonster = startEditMonster;
window.saveMonsterForm = saveMonsterForm;
window.deleteMonsterInfo = deleteMonsterInfo;
window.addEditingPassive = addEditingPassive;
window.removeEditingPassive = removeEditingPassive;
window.updateEditingPassive = updateEditingPassive;

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

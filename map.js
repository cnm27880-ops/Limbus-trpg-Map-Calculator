/**
 * Limbus Command - 地圖模組
 * 處理地圖渲染、工具、地形等
 */

// ===== 地圖初始化 =====
/**
 * 初始化地圖資料
 */
function initMapData() {
    state.mapData = Array(state.mapH).fill().map(() => Array(state.mapW).fill(0));
}

// ===== 主題與工具 =====
/**
 * 更換地圖主題
 * @param {string|number} id - 主題 ID
 */
function changeMapTheme(id) {
    if (myRole !== 'st') return;
    state.themeId = parseInt(id);
    updateToolbar();
    sendState();
    renderAll();
}

/**
 * 更新工具列
 */
function updateToolbar() {
    const container = document.getElementById('dynamic-tools');
    if (!container) return;

    const staticTools = container.querySelectorAll('[data-tool="cursor"], [data-tool="floor"]');
    container.innerHTML = '';
    staticTools.forEach(t => container.appendChild(t));

    const theme = getCurrentTheme();
    theme.tiles.forEach(tile => {
        if (tile.name === '地板') return;
        
        const btn = document.createElement('button');
        btn.className = 'tool-btn';
        btn.dataset.tool = tile.id;
        btn.title = tile.name;
        btn.onclick = () => setTool(tile.id);
        
        const dot = document.createElement('div');
        dot.className = 'color-indicator';
        dot.style.backgroundColor = tile.color;
        
        btn.innerText = tile.name.substring(0, 1);
        btn.appendChild(dot);
        container.appendChild(btn);
    });
}

/**
 * 設定當前工具
 * @param {string|number} tool - 工具 ID
 */
function setTool(tool) {
    currentTool = tool;
    
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
    if (btn) btn.classList.add('active');

    if (myRole === 'st') {
        const info = document.getElementById('tile-effect-desc');
        const theme = getCurrentTheme();
        let desc = "";
        
        if (tool === 'floor') {
            desc = "清除格子";
        } else if (tool === 'cursor') {
            desc = "選擇單位 / 查看格子";
        } else {
            const t = theme.tiles.find(x => x.id == tool);
            if (t) desc = `${t.name}: ${t.effect}`;
        }
        
        if (info) info.innerText = desc;
    }
}

/**
 * 調整地圖大小
 */
function resizeMap() {
    const w = parseInt(document.getElementById('map-w').value);
    const h = parseInt(document.getElementById('map-h').value);
    
    if (w < MAP_DEFAULTS.MIN_SIZE || h < MAP_DEFAULTS.MIN_SIZE || 
        w > MAP_DEFAULTS.MAX_SIZE || h > MAP_DEFAULTS.MAX_SIZE) {
        return showToast(`尺寸 ${MAP_DEFAULTS.MIN_SIZE}~${MAP_DEFAULTS.MAX_SIZE}`);
    }
    
    const newData = Array(h).fill().map(() => Array(w).fill(0));
    for (let y = 0; y < Math.min(h, state.mapH); y++) {
        for (let x = 0; x < Math.min(w, state.mapW); x++) {
            newData[y][x] = state.mapData[y][x];
        }
    }
    
    state.mapW = w;
    state.mapH = h;
    state.mapData = newData;
    sendState();
    renderAll();
}

// ===== 地圖渲染 =====
/**
 * 渲染地圖
 */
function renderMap() {
    const grid = document.getElementById('battle-map');
    if (!grid) return;

    const gridSize = MAP_DEFAULTS.GRID_SIZE;
    
    grid.style.gridTemplateColumns = `repeat(${state.mapW}, var(--grid-size))`;
    grid.innerHTML = '';
    
    // 設定容器尺寸
    const pxW = state.mapW * gridSize;
    const pxH = state.mapH * gridSize;
    grid.style.width = pxW + 'px';
    grid.style.height = pxH + 'px';
    
    const container = document.getElementById('map-container');
    if (container) {
        container.style.width = pxW + 'px';
        container.style.height = pxH + 'px';
        container.style.marginLeft = `-${pxW / 2}px`;
        container.style.marginTop = `-${pxH / 2}px`;
    }

    const theme = getCurrentTheme();

    // 渲染格子
    for (let y = 0; y < state.mapH; y++) {
        for (let x = 0; x < state.mapW; x++) {
            const val = state.mapData[y][x];
            const div = document.createElement('div');
            div.className = 'cell';
            
            // 部署高亮邏輯
            if (currentTool === 'cursor' && selectedUnitId !== null) {
                const u = findUnitById(selectedUnitId);
                if (u && u.x === -1 && canControlUnit(u)) {
                    div.classList.add('deploy-target');
                }
            }

            // 套用地形樣式
            let tileDef = theme.tiles.find(t => t.id === val);
            
            // 舊存檔相容性
            if (!tileDef && state.themeId === 0) {
                if (val === 1) tileDef = theme.tiles.find(t => t.name === '牆壁');
                else if (val === 2) tileDef = theme.tiles.find(t => t.name === '掩體');
                else if (val === 3) tileDef = theme.tiles.find(t => t.name === '險地');
            }

            if (tileDef) {
                div.style.backgroundColor = tileDef.color;
                if (tileDef.name.includes('牆') || tileDef.name.includes('掩體')) {
                    div.style.backgroundImage = 'repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(0,0,0,0.2) 4px,rgba(0,0,0,0.2) 8px)';
                }
            }

            // 互動事件
            div.onpointerdown = (e) => {
                if (isDraggingMap || isDraggingToken) return;
                if (currentTool === 'cursor' && selectedUnitId !== null) {
                    const u = findUnitById(selectedUnitId);
                    if (u && canControlUnit(u)) {
                        e.stopPropagation();
                    }
                }
                handleMapInput(x, y, e);
            };
            
            div.onpointerenter = (e) => {
                if (e.buttons === 1 && !isDraggingMap && !isDraggingToken) {
                    handleMapInput(x, y, e);
                }
            };
            
            grid.appendChild(div);
        }
    }
    
    // 渲染 Tokens
    state.units.filter(u => u.x >= 0).forEach(u => {
        const t = document.createElement('div');
        t.className = `token ${u.type} ${u.id === selectedUnitId ? 'selected' : ''}`;
        t.dataset.unitId = u.id;

        t.style.left = (u.x * gridSize + 2) + 'px';
        t.style.top = (u.y * gridSize + 2) + 'px';

        if (u.avatar) {
            t.style.backgroundImage = `url(${u.avatar})`;
        } else {
            t.innerText = u.name[0].toUpperCase();
        }

        t.onpointerdown = (e) => {
            if (currentTool !== 'cursor') return;
            e.stopPropagation();
            e.preventDefault();

            selectUnit(u.id);

            if (canControlUnit(u)) {
                startTokenDrag(e, u, t);
            }
        };
        
        grid.appendChild(t);
    });
}

/**
 * 處理地圖輸入
 * @param {number} x - X 座標
 * @param {number} y - Y 座標
 * @param {Event} e - 事件物件
 */
function handleMapInput(x, y, e) {
    if (currentTool === 'cursor') {
        if (selectedUnitId !== null) {
            const u = findUnitById(selectedUnitId);
            if (u && canControlUnit(u)) {
                if (myRole === 'st') {
                    u.x = x;
                    u.y = y;
                    selectedUnitId = null;
                    sendState();
                    renderAll();
                } else {
                    sendToHost({
                        type: 'moveUnit',
                        playerId: myPlayerId,
                        unitId: u.id,
                        x: x,
                        y: y
                    });
                    selectedUnitId = null;
                    renderAll();
                }
            }
        }
        return;
    }
    
    if (myRole !== 'st') return;

    let newVal = (currentTool === 'floor') ? 0 : parseInt(currentTool);
    
    if (state.mapData[y][x] !== newVal) {
        state.mapData[y][x] = newVal;

        // 繪製拖曳時只更新視覺，不完全重新渲染
        if (isPaintingDrag && e && e.target && e.target.classList.contains('cell')) {
            const theme = getCurrentTheme();
            const tileDef = theme.tiles.find(t => t.id === newVal);
            
            if (tileDef) {
                e.target.style.backgroundColor = tileDef.color;
                if (tileDef.name.includes('牆') || tileDef.name.includes('掩體')) {
                    e.target.style.backgroundImage = 'repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(0,0,0,0.2) 4px,rgba(0,0,0,0.2) 8px)';
                } else {
                    e.target.style.backgroundImage = '';
                }
            } else {
                e.target.style.backgroundColor = '';
                e.target.style.backgroundImage = '';
            }
        } else {
            renderAll();
        }
    }
}

// ===== 選擇與部署 =====
/**
 * 選擇單位
 * @param {number} id - 單位 ID
 */
function selectUnit(id) {
    selectedUnitId = id;
    renderMap();
}

/**
 * 清除選擇
 */
function clearSelection() {
    selectedUnitId = null;
    currentTool = 'cursor';
    renderAll();
}

/**
 * 開始部署單位
 * @param {number} id - 單位 ID
 */
function startDeploy(id) {
    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法操控其他人的單位');
        return;
    }

    switchPage('map');
    selectedUnitId = id;
    renderMap();
    showToast('請在地圖上點擊位置部署');
}

/**
 * 收回單位
 * @param {number} id - 單位 ID
 */
function recallUnit(id) {
    const u = findUnitById(id);
    if (!u) return;

    if (!canControlUnit(u)) {
        showToast('你無法操控其他人的單位');
        return;
    }

    if (myRole === 'st') {
        u.x = -1;
        u.y = -1;
        sendState();
        renderAll();
    } else {
        sendToHost({
            type: 'moveUnit',
            playerId: myPlayerId,
            unitId: id,
            x: -1,
            y: -1
        });
    }
}

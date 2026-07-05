/**
 * Limbus Command - 地圖管理模組
 * 儲存、載入、管理自訂地圖
 */

// ===== 儲存鍵名 =====
const SAVED_MAPS_KEY = 'limbus-command-saved-maps';

// ===== 地圖管理函數 =====

/**
 * 獲取所有已儲存的地圖
 * @returns {Array} 地圖列表
 */
function getSavedMaps() {
    try {
        return JSON.parse(localStorage.getItem(SAVED_MAPS_KEY)) || [];
    } catch {
        return [];
    }
}

/**
 * 儲存地圖列表
 * @param {Array} maps - 地圖列表
 */
function saveMapsToStorage(maps) {
    localStorage.setItem(SAVED_MAPS_KEY, JSON.stringify(maps));
}

/**
 * 開啟地圖管理 Modal
 */
function openMapManagerModal() {
    if (myRole !== 'st') {
        showToast('只有 ST 可以管理地圖');
        return;
    }

    const maps = getSavedMaps();

    const modalHtml = `
        <div class="modal-overlay show" id="map-manager-modal" onclick="closeMapManagerOnOverlay(event)">
            <div class="modal map-manager-modal" onclick="event.stopPropagation()">
                <div class="modal-header modal-header--info">
                    <span style="font-weight:bold;">🗺️ 地圖管理</span>
                    <button onclick="closeMapManagerModal()" style="background:none;font-size:1.2rem;">×</button>
                </div>
                <div class="modal-body" style="padding:0;">
                    <!-- 儲存當前地圖 -->
                    <div class="map-save-section">
                        <div class="section-title">💾 儲存當前地圖</div>
                        <div class="save-form">
                            <input type="text" id="save-map-name" placeholder="輸入地圖名稱..." maxlength="30">
                            <button onclick="saveCurrentMap()" class="save-btn">儲存</button>
                        </div>
                        <div class="map-info">
                            目前尺寸: ${state.mapW} x ${state.mapH}
                        </div>
                    </div>

                    <!-- 已儲存的地圖列表 -->
                    <div class="map-list-section">
                        <div class="section-title">📂 已儲存的地圖 (${maps.length})</div>
                        <div class="map-list" id="saved-maps-list">
                            ${renderSavedMapsList(maps)}
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button onclick="closeMapManagerModal()" class="modal-btn">關閉</button>
                </div>
            </div>
        </div>
    `;

    // 使用 insertAdjacentHTML 避免覆蓋其他 modal
    const container = document.getElementById('modals-container');
    // 移除之前可能存在的地圖管理 modal
    const existingModal = document.getElementById('map-manager-modal');
    if (existingModal) existingModal.remove();
    container.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * 關閉地圖管理 Modal
 */
function closeMapManagerModal() {
    const modal = document.getElementById('map-manager-modal');
    if (modal) modal.remove();
}

/**
 * 點擊 overlay 關閉
 */
function closeMapManagerOnOverlay(event) {
    if (event.target.id === 'map-manager-modal') {
        closeMapManagerModal();
    }
}

/**
 * 渲染已儲存地圖列表
 * @param {Array} maps - 地圖列表
 */
function renderSavedMapsList(maps) {
    if (maps.length === 0) {
        return '<div class="no-maps">尚未儲存任何地圖</div>';
    }

    return maps.map((map, index) => {
        const date = new Date(map.createdAt).toLocaleString('zh-TW', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        return `
            <div class="saved-map-item" data-map-index="${index}">
                <div class="map-item-info">
                    <div class="map-item-name">${escapeHtml(map.name)}</div>
                    <div class="map-item-meta">
                        ${map.mapW} x ${map.mapH} · ${date}
                    </div>
                </div>
                <div class="map-item-actions">
                    <button onclick="loadSavedMap(${index})" class="map-action-btn load" title="載入此地圖">
                        📂 載入
                    </button>
                    <button onclick="deleteSavedMap(${index})" class="map-action-btn delete" title="刪除此地圖">
                        🗑️
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 儲存當前地圖
 */
function saveCurrentMap() {
    const nameInput = document.getElementById('save-map-name');
    const name = nameInput?.value.trim();

    if (!name) {
        showToast('請輸入地圖名稱');
        nameInput?.focus();
        return;
    }

    const maps = getSavedMaps();

    // 檢查是否超過上限 (最多 20 個)
    if (maps.length >= 20) {
        showToast('已達到儲存上限 (20 張)，請先刪除一些地圖');
        return;
    }

    // 創建地圖資料（包含調色盤）
    const mapData = {
        id: 'map_' + Date.now(),
        name: name,
        createdAt: Date.now(),
        mapW: state.mapW,
        mapH: state.mapH,
        themeId: state.themeId,
        mapData: JSON.parse(JSON.stringify(state.mapData)), // 深拷貝
        mapPalette: JSON.parse(JSON.stringify(state.mapPalette || []))
    };

    // 新增到列表開頭
    maps.unshift(mapData);
    saveMapsToStorage(maps);

    // 更新列表顯示
    const listContainer = document.getElementById('saved-maps-list');
    if (listContainer) {
        listContainer.innerHTML = renderSavedMapsList(maps);
    }

    // 清空輸入框
    if (nameInput) nameInput.value = '';

    showToast(`地圖「${name}」已儲存`);
}

/**
 * 載入已儲存的地圖
 * @param {number} index - 地圖索引
 */
function loadSavedMap(index) {
    const maps = getSavedMaps();
    const map = maps[index];

    if (!map) {
        showToast('找不到此地圖');
        return;
    }

    // 確認載入
    if (!confirm(`確定要載入地圖「${map.name}」嗎？\n\n⚠️ 當前地圖將被覆蓋！`)) {
        return;
    }

    // 載入地圖資料
    state.mapW = map.mapW;
    state.mapH = map.mapH;
    state.themeId = map.themeId;
    state.mapData = JSON.parse(JSON.stringify(map.mapData)); // 深拷貝

    // 載入調色盤（舊存檔相容）
    if (map.mapPalette && map.mapPalette.length > 0) {
        state.mapPalette = JSON.parse(JSON.stringify(map.mapPalette));
    } else {
        state.mapPalette = [];
        if (typeof initMapPalette === 'function') initMapPalette();
    }

    // 更新 UI
    document.getElementById('map-w').value = state.mapW;
    document.getElementById('map-h').value = state.mapH;
    document.getElementById('map-theme-select').value = state.themeId;

    // 更新工具列和渲染
    updateToolbar();
    renderMap();

    // 同步到 Firebase
    if (myRole === 'st') {
        sendState();
    }

    closeMapManagerModal();
    showToast(`已載入地圖「${map.name}」`);
}

/**
 * 刪除已儲存的地圖
 * @param {number} index - 地圖索引
 */
function deleteSavedMap(index) {
    const maps = getSavedMaps();
    const map = maps[index];

    if (!map) {
        showToast('找不到此地圖');
        return;
    }

    if (!confirm(`確定要刪除地圖「${map.name}」嗎？`)) {
        return;
    }

    // 從列表中移除
    maps.splice(index, 1);
    saveMapsToStorage(maps);

    // 更新列表顯示
    const listContainer = document.getElementById('saved-maps-list');
    if (listContainer) {
        listContainer.innerHTML = renderSavedMapsList(maps);
    }

    // 更新標題中的數量
    const titleEl = document.querySelector('.map-list-section .section-title');
    if (titleEl) {
        titleEl.textContent = `📂 已儲存的地圖 (${maps.length})`;
    }

    showToast('地圖已刪除');
}

/**
 * 匯出地圖為 JSON
 * @param {number} index - 地圖索引
 */
function exportMap(index) {
    const maps = getSavedMaps();
    const map = maps[index];

    if (!map) {
        showToast('找不到此地圖');
        return;
    }

    const dataStr = JSON.stringify(map, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${map.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showToast('地圖已匯出');
}

/**
 * 匯入地圖 (從 JSON 檔案)
 */
function importMap() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const mapData = JSON.parse(ev.target.result);

                // 驗證資料結構
                if (!mapData.mapW || !mapData.mapH || !mapData.mapData) {
                    throw new Error('無效的地圖格式');
                }

                // 匯入調色盤（如有）
                if (!mapData.mapPalette) {
                    mapData.mapPalette = [];
                }

                // 確保有名稱
                if (!mapData.name) {
                    mapData.name = file.name.replace('.json', '');
                }

                // 更新 ID 和時間戳
                mapData.id = 'map_' + Date.now();
                mapData.createdAt = Date.now();

                // 儲存
                const maps = getSavedMaps();
                if (maps.length >= 20) {
                    showToast('已達到儲存上限，請先刪除一些地圖');
                    return;
                }

                maps.unshift(mapData);
                saveMapsToStorage(maps);

                // 更新列表
                const listContainer = document.getElementById('saved-maps-list');
                if (listContainer) {
                    listContainer.innerHTML = renderSavedMapsList(maps);
                }

                showToast(`已匯入地圖「${mapData.name}」`);
            } catch (err) {
                showToast('匯入失敗：' + err.message);
            }
        };
        reader.readAsText(file);
    };

    input.click();
}

console.log('🗺️ 地圖管理模組已載入');

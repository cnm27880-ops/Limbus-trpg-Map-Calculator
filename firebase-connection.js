/**
 * Limbus Command - Firebase 連線模組
 * 處理房間建立、加入、即時同步等功能
 */

// ===== 全域變數 =====
let currentRoomCode = null;  // 當前房間號碼
let roomRef = null;           // Firebase 房間參考
let unsubscribeListeners = [];  // 用於儲存監聽器，方便清理

// ===== 連線狀態 UI =====
/**
 * 更新連線狀態 UI
 * @param {string} status - 狀態 ('connected', 'connecting', 'disconnected')
 * @param {string} text - 顯示文字（選填）
 */
function setConnectionStatus(status, text = null) {
    const dot = document.getElementById('conn-dot');
    const txt = document.getElementById('conn-text');
    if (!dot || !txt) return;

    dot.className = 'conn-dot';

    switch (status) {
        case 'connected':
            dot.classList.add('online');
            txt.innerText = text || '已連線';
            txt.style.color = 'var(--accent-green)';
            break;
        case 'connecting':
            dot.classList.add('connecting');
            txt.innerText = text || '連線中';
            txt.style.color = 'var(--accent-yellow)';
            break;
        case 'disconnected':
        default:
            dot.classList.add('offline');
            txt.innerText = text || '離線';
            txt.style.color = 'var(--accent-red)';
            break;
    }
}

// ===== 登入流程 =====
function showJoinStep() {
    document.getElementById('login-main').classList.add('hidden');
    document.getElementById('login-st').classList.add('hidden');
    document.getElementById('login-join').classList.remove('hidden');
}

function showSTStep() {
    document.getElementById('login-main').classList.add('hidden');
    document.getElementById('login-join').classList.add('hidden');
    document.getElementById('login-room-manager').classList.add('hidden');
    document.getElementById('login-st').classList.remove('hidden');
}

function showMainStep() {
    document.getElementById('login-st').classList.add('hidden');
    document.getElementById('login-join').classList.add('hidden');
    document.getElementById('login-room-manager').classList.add('hidden');
    document.getElementById('login-main').classList.remove('hidden');
}

// ===== 房間管理（舊版兼容，未來可移除） =====
function showRoomManager() {
    showToast('房間管理功能即將推出');
    // Firebase 版本可以從資料庫直接查詢所有房間
}

// ===== 初始化系統 =====
/**
 * 初始化系統 - ST 或玩家登入
 * @param {string} role - 角色 ('st' 或 'player')
 */
function initSystem(role) {
    const name = document.getElementById('input-name').value.trim();
    if (!name) return showToast('請輸入代號');

    myName = name;
    myRole = role;

    // 顯示載入畫面
    document.getElementById('login-main').classList.add('hidden');
    document.getElementById('login-st').classList.add('hidden');
    document.getElementById('login-join').classList.add('hidden');
    document.getElementById('login-loading').classList.remove('hidden');
    setConnectionStatus('connecting', '連線到 Firebase...');

    if (role === 'st') {
        // ST 建立或加入房間
        const inputCode = document.getElementById('input-st-code')?.value?.trim();

        if (inputCode && inputCode.length === 4) {
            // 使用指定的房間號碼
            joinRoom(inputCode, true);
        } else {
            // 自動生成房間號碼
            const randomCode = generateRoomCode();
            createRoom(randomCode);
        }
    } else {
        // 玩家加入房間
        const roomCode = document.getElementById('input-host-id').value.trim();
        const playerCode = document.getElementById('input-player-code')?.value?.trim();

        if (!roomCode) {
            showToast('請輸入房間號碼');
            document.getElementById('login-loading').classList.add('hidden');
            document.getElementById('login-join').classList.remove('hidden');
            return;
        }

        if (playerCode && playerCode.length === 4) {
            myPlayerCode = playerCode;
        } else {
            myPlayerCode = generatePlayerCode();
        }

        myPlayerId = 'player_' + myPlayerCode;
        joinRoom(roomCode, false);
    }
}

/**
 * 生成 4 位數房間號碼
 */
function generateRoomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * 建立新房間
 * @param {string} roomCode - 房間號碼
 */
function createRoom(roomCode) {
    currentRoomCode = roomCode;
    myPlayerCode = roomCode;  // ST 的識別碼就是房間號碼
    myPlayerId = 'st_' + roomCode;

    roomRef = database.ref('rooms/' + roomCode);

    // 檢查房間是否已存在
    roomRef.once('value')
        .then(snapshot => {
            if (snapshot.exists()) {
                // 房間已存在，顯示警告
                const existingData = snapshot.val();
                const lastActive = existingData.info?.lastActive || 0;
                const fiveMinutes = 5 * 60 * 1000;

                if (Date.now() - lastActive < fiveMinutes) {
                    showToast('此房間號碼最近仍在使用中，建議更換');
                    document.getElementById('login-loading').classList.add('hidden');
                    document.getElementById('login-st').classList.remove('hidden');
                    return;
                }

                showToast('恢復房間：' + roomCode);
                // 載入現有資料
                loadRoomData(snapshot.val());
            } else {
                // 建立新房間
                showToast('已建立房間：' + roomCode);
                initializeNewRoom();
            }

            // 設置監聽器
            setupRoomListeners();

            // 隱藏登入畫面
            document.getElementById('login-layer').classList.add('hidden');
            setConnectionStatus('connected', 'ST 已就緒');

            // 顯示 UI
            document.getElementById('st-map-controls').style.display = 'flex';
            document.getElementById('units-toolbar').style.display = 'flex';
            document.getElementById('tile-info-panel').style.display = 'block';
            document.getElementById('my-id').innerText = roomCode;
            updateCodeDisplay();

            // 初始化地圖
            updateToolbar();
            renderAll();

            if (typeof initCameraEvents === 'function') {
                initCameraEvents();
            }
        })
        .catch(error => {
            console.error('建立房間失敗:', error);
            showToast('建立房間失敗: ' + error.message);
            document.getElementById('login-loading').classList.add('hidden');
            document.getElementById('login-st').classList.remove('hidden');
        });
}

/**
 * 初始化新房間資料
 */
function initializeNewRoom() {
    // 初始化本地狀態
    state.mapW = MAP_DEFAULTS.WIDTH;
    state.mapH = MAP_DEFAULTS.HEIGHT;
    state.themeId = 0;
    state.units = [];
    state.turnIdx = 0;
    state.players = {};
    initMapData();

    // 上傳到 Firebase
    const roomData = {
        info: {
            stName: myName,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            lastActive: firebase.database.ServerValue.TIMESTAMP
        },
        state: {
            mapW: state.mapW,
            mapH: state.mapH,
            themeId: state.themeId,
            turnIdx: state.turnIdx
        },
        mapData: state.mapData,
        units: {},
        players: {}
    };

    roomRef.set(roomData);
}

/**
 * 加入房間
 * @param {string} roomCode - 房間號碼
 * @param {boolean} isST - 是否為 ST
 */
function joinRoom(roomCode, isST) {
    currentRoomCode = roomCode;
    roomRef = database.ref('rooms/' + roomCode);

    // 檢查房間是否存在
    roomRef.once('value')
        .then(snapshot => {
            if (!snapshot.exists()) {
                if (isST) {
                    // ST 建立新房間
                    createRoom(roomCode);
                } else {
                    // 玩家找不到房間
                    showToast('房間不存在，請檢查房間號碼');
                    document.getElementById('login-loading').classList.add('hidden');
                    document.getElementById('login-join').classList.remove('hidden');
                }
                return;
            }

            // 載入房間資料
            loadRoomData(snapshot.val());

            // 玩家加入：註冊自己到玩家列表
            if (!isST) {
                const playerData = {
                    name: myName,
                    code: myPlayerCode,
                    online: true,
                    joinedAt: firebase.database.ServerValue.TIMESTAMP
                };
                roomRef.child('players/' + myPlayerId).set(playerData);
                showToast(`已加入房間！識別碼：${myPlayerCode}`);
            }

            // 設置監聽器
            setupRoomListeners();

            // 隱藏登入畫面
            document.getElementById('login-layer').classList.add('hidden');
            setConnectionStatus('connected');

            // 顯示 UI
            if (!isST) {
                document.getElementById('st-map-controls').style.display = 'none';
            }
            document.getElementById('units-toolbar').style.display = 'flex';
            document.getElementById('my-id').innerText = roomCode;
            updateCodeDisplay();

            renderAll();

            if (typeof initCameraEvents === 'function') {
                initCameraEvents();
            }
        })
        .catch(error => {
            console.error('加入房間失敗:', error);
            showToast('加入房間失敗: ' + error.message);
            document.getElementById('login-loading').classList.add('hidden');
            if (isST) {
                document.getElementById('login-st').classList.remove('hidden');
            } else {
                document.getElementById('login-join').classList.remove('hidden');
            }
        });
}

/**
 * 從 Firebase 載入房間資料
 */
function loadRoomData(data) {
    if (data.state) {
        state.mapW = data.state.mapW || MAP_DEFAULTS.WIDTH;
        state.mapH = data.state.mapH || MAP_DEFAULTS.HEIGHT;
        state.themeId = data.state.themeId || 0;
        state.turnIdx = data.state.turnIdx || 0;
    }

    if (data.mapData) {
        state.mapData = data.mapData;
    } else {
        initMapData();
    }

    if (data.units) {
        // 將 Firebase 物件轉換為陣列
        state.units = Object.values(data.units);
    } else {
        state.units = [];
    }

    if (data.players) {
        state.players = data.players;
    } else {
        state.players = {};
    }
}

/**
 * 設置 Firebase 監聽器
 */
function setupRoomListeners() {
    // 監聽地圖資料變更
    const mapDataListener = roomRef.child('mapData').on('value', snapshot => {
        if (snapshot.exists()) {
            state.mapData = snapshot.val();
            renderMap();
        }
    });
    unsubscribeListeners.push(() => roomRef.child('mapData').off('value', mapDataListener));

    // 監聽單位變更
    const unitsListener = roomRef.child('units').on('value', snapshot => {
        if (snapshot.exists()) {
            state.units = Object.values(snapshot.val());
        } else {
            state.units = [];
        }
        renderUnitsList();
        renderSidebarUnits();
        renderMap();  // 重繪地圖上的 token
    });
    unsubscribeListeners.push(() => roomRef.child('units').off('value', unitsListener));

    // 監聽狀態變更
    const stateListener = roomRef.child('state').on('value', snapshot => {
        if (snapshot.exists()) {
            const newState = snapshot.val();
            if (newState.mapW !== state.mapW || newState.mapH !== state.mapH) {
                state.mapW = newState.mapW;
                state.mapH = newState.mapH;
                renderMap();
            }
            if (newState.themeId !== state.themeId) {
                state.themeId = newState.themeId;
                updateToolbar();
                renderMap();
            }
            state.turnIdx = newState.turnIdx || 0;
            renderUnitsList();
        }
    });
    unsubscribeListeners.push(() => roomRef.child('state').off('value', stateListener));

    // 監聽玩家列表
    const playersListener = roomRef.child('players').on('value', snapshot => {
        if (snapshot.exists()) {
            state.players = snapshot.val();
        }
    });
    unsubscribeListeners.push(() => roomRef.child('players').off('value', playersListener));

    // 定期更新活動時間（每 30 秒）
    const activityInterval = setInterval(() => {
        roomRef.child('info/lastActive').set(firebase.database.ServerValue.TIMESTAMP);
    }, 30000);
    unsubscribeListeners.push(() => clearInterval(activityInterval));
}

/**
 * 清理監聽器
 */
function cleanupListeners() {
    unsubscribeListeners.forEach(unsubscribe => unsubscribe());
    unsubscribeListeners = [];
}

// ===== 資料同步函數 =====

/**
 * 更新地圖資料到 Firebase
 */
function syncMapData() {
    if (!roomRef) return;
    roomRef.child('mapData').set(state.mapData);
}

/**
 * 更新單位到 Firebase
 */
function syncUnits() {
    if (!roomRef) return;

    // 將陣列轉換為物件（使用單位 ID 作為 key）
    const unitsObj = {};
    state.units.forEach(unit => {
        unitsObj[unit.id] = unit;
    });

    roomRef.child('units').set(unitsObj);
}

/**
 * 更新狀態到 Firebase
 */
function syncState() {
    if (!roomRef) return;

    roomRef.child('state').update({
        mapW: state.mapW,
        mapH: state.mapH,
        themeId: state.themeId,
        turnIdx: state.turnIdx
    });
}

/**
 * 完整同步（用於大規模變更）
 */
function sendState() {
    if (myRole === 'st') {
        syncMapData();
        syncUnits();
        syncState();
    }
    // 玩家不需要主動同步，只能透過特定操作更新
}

/**
 * 廣播狀態（相容性函數）
 */
function broadcastState() {
    sendState();
    renderAll();
}

// ===== 玩家操作函數 =====

/**
 * 玩家發送訊息（修改為直接更新 Firebase）
 */
function sendToHost(message) {
    if (!roomRef) return;

    switch (message.type) {
        case 'moveUnit':
            // 直接更新單位位置
            roomRef.child(`units/${message.unitId}/x`).set(message.x);
            roomRef.child(`units/${message.unitId}/y`).set(message.y);
            break;

        case 'addUnit':
            const newUnit = createUnit(message.name, message.hp, message.unitType, myPlayerId, myName);
            roomRef.child(`units/${newUnit.id}`).set(newUnit);
            break;

        case 'deleteUnit':
            roomRef.child(`units/${message.unitId}`).remove();
            break;

        case 'modifyHP':
            const unit = state.units.find(u => u.id === message.unitId);
            if (unit) {
                modifyHPInternal(unit, message.dmgType, message.amount);
                roomRef.child(`units/${message.unitId}/hpArr`).set(unit.hpArr);
            }
            break;

        case 'updateInit':
            roomRef.child(`units/${message.unitId}/init`).set(message.init);
            break;

        case 'uploadAvatar':
            roomRef.child(`units/${message.unitId}/avatar`).set(message.avatar);
            break;
    }
}

// ===== 剪貼簿與 UI =====

function copyId() {
    if (!currentRoomCode) return;
    navigator.clipboard.writeText(currentRoomCode).then(() => {
        showToast('已複製房間號碼');
    }).catch(() => {
        showToast('複製失敗');
    });
}

function copyMyCode() {
    if (!myPlayerCode) return;
    navigator.clipboard.writeText(myPlayerCode).then(() => {
        showToast('識別碼已複製: ' + myPlayerCode);
    }).catch(() => {
        showToast('複製失敗');
    });
}

function updateCodeDisplay() {
    const codeEl = document.getElementById('my-code');
    if (codeEl && myPlayerCode) {
        codeEl.innerText = myPlayerCode;
        codeEl.style.display = 'inline-block';
    }
}

// ===== 頁面離開時清理 =====
window.addEventListener('beforeunload', () => {
    if (roomRef && myPlayerId && myRole === 'player') {
        // 標記玩家離線
        roomRef.child(`players/${myPlayerId}/online`).set(false);
    }
    cleanupListeners();
});

console.log('✅ Firebase 連線模組已載入');

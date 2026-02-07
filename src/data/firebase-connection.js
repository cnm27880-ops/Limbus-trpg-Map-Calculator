/**
 * Limbus Command - Firebase 連線模組
 * 處理房間建立、加入、即時同步等功能
 */

// ===== 全域變數 =====
let currentRoomCode = null;  // 當前房間號碼
let roomRef = null;           // Firebase 房間參考
let unsubscribeListeners = [];  // 用於儲存監聯器，方便清理
let heartbeatInterval = null;  // 心跳計時器
let isConnected = false;       // Firebase 連線狀態
let roomUsers = {};            // 房間內的使用者列表（用於分配權限）

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

// ===== 房間管理 =====
/**
 * 顯示房間管理器並載入所有房間
 */
function showRoomManager() {
    // 隱藏其他登入畫面，顯示房間管理器
    document.getElementById('login-main').classList.add('hidden');
    document.getElementById('login-st').classList.add('hidden');
    document.getElementById('login-join').classList.add('hidden');
    document.getElementById('login-room-manager').classList.remove('hidden');

    const container = document.getElementById('room-list-container');
    if (!container) return;

    // 顯示載入中
    container.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:20px;">載入中...</div>';

    // 從 Firebase 取得所有房間
    database.ref('rooms').once('value')
        .then(snapshot => {
            if (!snapshot.exists()) {
                container.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:20px;">目前沒有任何房間</div>';
                return;
            }

            const rooms = snapshot.val();
            const roomList = [];

            // 將房間轉換為陣列並排序
            Object.keys(rooms).forEach(code => {
                const room = rooms[code];
                roomList.push({
                    code: code,
                    stName: room.info?.stName || '未知',
                    createdAt: room.info?.createdAt || 0,
                    lastActive: room.info?.lastActive || 0,
                    unitCount: room.units ? Object.keys(room.units).length : 0,
                    playerCount: room.players ? Object.keys(room.players).length : 0
                });
            });

            // 按最後活動時間排序（最新在前）
            roomList.sort((a, b) => b.lastActive - a.lastActive);

            // 渲染房間列表
            if (roomList.length === 0) {
                container.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:20px;">目前沒有任何房間</div>';
                return;
            }

            container.innerHTML = roomList.map(room => {
                const now = Date.now();
                const timeDiff = now - room.lastActive;
                const isActive = timeDiff < 24 * 60 * 60 * 1000; // 24 小時內
                const isRecent = timeDiff < 5 * 60 * 1000; // 5 分鐘內

                // 格式化時間
                let timeStr = '';
                if (timeDiff < 60 * 1000) {
                    timeStr = '剛才';
                } else if (timeDiff < 60 * 60 * 1000) {
                    timeStr = Math.floor(timeDiff / 60000) + ' 分鐘前';
                } else if (timeDiff < 24 * 60 * 60 * 1000) {
                    timeStr = Math.floor(timeDiff / 3600000) + ' 小時前';
                } else {
                    timeStr = Math.floor(timeDiff / 86400000) + ' 天前';
                }

                const borderColor = isRecent ? 'var(--accent-green)' : (isActive ? 'var(--accent-yellow)' : 'var(--border)');

                return `
                    <div style="
                        background: var(--bg-card);
                        border: 2px solid ${borderColor};
                        border-radius: 8px;
                        padding: 12px;
                        margin-bottom: 10px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 10px;
                    ">
                        <div style="flex: 1; min-width: 150px;">
                            <div style="font-family: 'JetBrains Mono', monospace; font-size: 1.2rem; color: var(--accent-yellow); margin-bottom: 4px;">
                                ${escapeHtml(room.code)}
                            </div>
                            <div style="font-size: 0.85rem; color: var(--text-main);">
                                ST: ${escapeHtml(room.stName)}
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-dim);">
                                ${room.unitCount} 單位 · ${room.playerCount} 玩家 · ${timeStr}
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button onclick="enterRoomFromManager('${room.code}')" style="
                                background: var(--accent-green);
                                color: #000;
                                border: none;
                                padding: 8px 16px;
                                border-radius: 6px;
                                font-weight: bold;
                                cursor: pointer;
                            ">進入</button>
                            <button onclick="deleteRoomFromManager('${room.code}')" style="
                                background: var(--accent-red);
                                color: #000;
                                border: none;
                                padding: 8px 12px;
                                border-radius: 6px;
                                cursor: pointer;
                            ">🗑️</button>
                        </div>
                    </div>
                `;
            }).join('');
        })
        .catch(error => {
            console.error('載入房間列表失敗:', error);
            container.innerHTML = `<div style="text-align:center;color:var(--accent-red);padding:20px;">載入失敗: ${error.message}</div>`;
        });
}

/**
 * 從房間管理器進入房間
 * @param {string} code - 房間號碼
 */
function enterRoomFromManager(code) {
    // 填入房間號碼並返回 ST 登入畫面
    document.getElementById('input-st-code').value = code;
    showSTStep();
    showToast('已填入房間號碼，點擊「建立房間」以 ST 身份進入');
}

/**
 * 從房間管理器刪除房間
 * @param {string} code - 房間號碼
 */
function deleteRoomFromManager(code) {
    if (!confirm(`確定要刪除房間 ${code} 嗎？此操作無法復原！`)) {
        return;
    }

    database.ref('rooms/' + code).remove()
        .then(() => {
            showToast('房間已刪除');
            showRoomManager(); // 重新載入列表
        })
        .catch(error => {
            console.error('刪除房間失敗:', error);
            showToast('刪除失敗: ' + error.message);
        });
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

            // 註冊 ST 到 users 路徑
            registerUserPresence();

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

            // 顯示登出按鈕
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) logoutBtn.style.display = 'flex';

            // 顯示 ST 音樂控制區塊
            const musicStControls = document.getElementById('bgm-st-controls');
            if (musicStControls) musicStControls.style.display = 'block';

            // 初始化音樂播放器
            if (typeof initAudio === 'function') initAudio();

            // 儲存 Session
            saveSession({
                playerCode: myPlayerCode,
                playerId: myPlayerId,
                name: myName,
                roomCode: roomCode,
                role: 'st'
            });

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

            // 玩家加入：註冊自己到玩家列表和使用者列表
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

            // 註冊到 users 路徑（ST 和玩家都需要）
            registerUserPresence();

            // 設置監聽器
            setupRoomListeners();

            // 隱藏登入畫面
            document.getElementById('login-layer').classList.add('hidden');
            setConnectionStatus('connected');

            // 顯示 UI
            if (!isST) {
                document.getElementById('st-map-controls').style.display = 'none';
            } else {
                // ST 的音樂控制區塊
                const musicStControls = document.getElementById('bgm-st-controls');
                if (musicStControls) musicStControls.style.display = 'block';
            }
            document.getElementById('units-toolbar').style.display = 'flex';
            document.getElementById('my-id').innerText = roomCode;
            updateCodeDisplay();

            // 顯示登出按鈕
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) logoutBtn.style.display = 'flex';

            // 初始化音樂播放器
            if (typeof initAudio === 'function') initAudio();

            // 儲存 Session
            saveSession({
                playerCode: myPlayerCode,
                playerId: myPlayerId,
                name: myName,
                roomCode: roomCode,
                role: isST ? 'st' : 'player'
            });

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
        // 將 Firebase 物件轉換為陣列，並根據 sortOrder 排序
        const unitsArray = Object.values(data.units);
        unitsArray.sort((a, b) => {
            const orderA = a.sortOrder !== undefined ? a.sortOrder : Infinity;
            const orderB = b.sortOrder !== undefined ? b.sortOrder : Infinity;
            return orderA - orderB;
        });
        state.units = unitsArray;
    } else {
        state.units = [];
    }

    if (data.players) {
        state.players = data.players;
    } else {
        state.players = {};
    }

    if (data.customStatuses) {
        state.customStatuses = Object.values(data.customStatuses);
    } else {
        state.customStatuses = [];
    }

    // 載入調色盤
    if (data.mapPalette) {
        state.mapPalette = Array.isArray(data.mapPalette) ? data.mapPalette : Object.values(data.mapPalette);
    } else {
        state.mapPalette = [];
        if (typeof initMapPalette === 'function') initMapPalette();
    }
}

/**
 * 設置 Firebase 監聯器
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

    // 監聽調色盤變更
    const paletteListener = roomRef.child('mapPalette').on('value', snapshot => {
        if (snapshot.exists()) {
            const val = snapshot.val();
            state.mapPalette = Array.isArray(val) ? val : Object.values(val);
        } else {
            state.mapPalette = [];
            if (typeof initMapPalette === 'function') initMapPalette();
        }
        updateToolbar();
        renderMap();
    });
    unsubscribeListeners.push(() => roomRef.child('mapPalette').off('value', paletteListener));

    // 監聽單位變更
    const unitsListener = roomRef.child('units').on('value', snapshot => {
        if (snapshot.exists()) {
            // 將物件轉換為陣列，並根據 sortOrder 排序以維持順序
            const unitsArray = Object.values(snapshot.val());
            unitsArray.sort((a, b) => {
                // 如果有 sortOrder 就按照 sortOrder 排序
                // 否則按照 id 排序（向後相容）
                const orderA = a.sortOrder !== undefined ? a.sortOrder : Infinity;
                const orderB = b.sortOrder !== undefined ? b.sortOrder : Infinity;
                return orderA - orderB;
            });
            state.units = unitsArray;
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

    // 監聽自訂狀態變更（房間共享）
    const customStatusesListener = roomRef.child('customStatuses').on('value', snapshot => {
        if (snapshot.exists()) {
            state.customStatuses = Object.values(snapshot.val());
        } else {
            state.customStatuses = [];
        }
        // 如果狀態 Modal 正在開啟且在自訂分類，刷新網格
        const statusGrid = document.getElementById('status-grid');
        if (statusGrid && typeof currentStatusCategory !== 'undefined' && currentStatusCategory === 'custom') {
            statusGrid.innerHTML = renderStatusGrid('custom');
        }
    });
    unsubscribeListeners.push(() => roomRef.child('customStatuses').off('value', customStatusesListener));

    // 監聽使用者在線列表（用於分配權限功能）
    const usersListener = roomRef.child('users').on('value', snapshot => {
        if (snapshot.exists()) {
            roomUsers = snapshot.val();
        } else {
            roomUsers = {};
        }
    });
    unsubscribeListeners.push(() => roomRef.child('users').off('value', usersListener));

    // 監聽音樂狀態變更
    const musicListener = roomRef.child('music').on('value', snapshot => {
        if (typeof handleMusicUpdate === 'function') {
            handleMusicUpdate(snapshot.val());
        }
    });
    unsubscribeListeners.push(() => roomRef.child('music').off('value', musicListener));

    // 定期更新活動時間（每 30 秒）
    const activityInterval = setInterval(() => {
        roomRef.child('info/lastActive').set(firebase.database.ServerValue.TIMESTAMP);
    }, 30000);
    unsubscribeListeners.push(() => clearInterval(activityInterval));

    // 設置連線監控和心跳機制
    setupConnectionMonitor();
}

/**
 * 設置 Firebase 連線監控和心跳機制
 * 確保長時間閒置不會導致斷線
 */
function setupConnectionMonitor() {
    // 監聽 Firebase 連線狀態
    const connectedRef = database.ref('.info/connected');
    const connectionListener = connectedRef.on('value', (snapshot) => {
        const wasConnected = isConnected;
        isConnected = snapshot.val() === true;

        if (isConnected) {
            // 連線成功
            setConnectionStatus('connected');
            console.log('✅ Firebase 連線已建立');

            // 啟動心跳機制
            startHeartbeat();

            // 如果是重新連線，顯示提示
            if (wasConnected === false && roomRef) {
                showToast('連線已恢復');
            }
        } else {
            // 連線中斷
            setConnectionStatus('disconnected', '連線中斷');
            console.log('⚠️ Firebase 連線已中斷');

            // 停止心跳
            stopHeartbeat();
        }
    });
    unsubscribeListeners.push(() => connectedRef.off('value', connectionListener));

    // 設置玩家 presence（在線狀態）
    if (roomRef && myPlayerId) {
        const presenceRef = roomRef.child(`presence/${myPlayerId}`);

        // 連線時設為在線
        presenceRef.set(true);

        // 斷線時自動設為離線
        presenceRef.onDisconnect().set(false);

        unsubscribeListeners.push(() => {
            presenceRef.onDisconnect().cancel();
        });
    }
}

/**
 * 啟動心跳機制
 * 每 45 秒發送一次心跳，維持 Firebase 連線活躍
 */
function startHeartbeat() {
    // 先停止現有的心跳
    stopHeartbeat();

    // 心跳間隔設為 45 秒（Firebase 預設超時約 60 秒）
    const HEARTBEAT_INTERVAL = 45000;

    heartbeatInterval = setInterval(() => {
        if (roomRef && isConnected) {
            // 使用當前用戶的 presence 路徑發送心跳
            // 這會保持 WebSocket 連線活躍
            const heartbeatPath = myPlayerId
                ? `presence/${myPlayerId}/lastSeen`
                : 'info/lastActive';

            roomRef.child(heartbeatPath).set(firebase.database.ServerValue.TIMESTAMP)
                .catch(err => {
                    console.warn('心跳發送失敗:', err);
                });

            // 同時更新使用者在線狀態
            if (typeof updateUserPresence === 'function') {
                updateUserPresence();
            }
        }
    }, HEARTBEAT_INTERVAL);

    console.log('💓 心跳機制已啟動（間隔 45 秒）');
}

/**
 * 停止心跳機制
 */
function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        console.log('💔 心跳機制已停止');
    }
}

/**
 * 清理監聽器
 */
function cleanupListeners() {
    // 停止心跳機制
    stopHeartbeat();

    // 清理所有 Firebase 監聽器
    unsubscribeListeners.forEach(unsubscribe => unsubscribe());
    unsubscribeListeners = [];
}

// ===== 使用者在線系統 =====

/**
 * 註冊使用者到 users 路徑並設置 onDisconnect
 */
function registerUserPresence() {
    if (!roomRef || !myPlayerId) return;

    const userRef = roomRef.child('users/' + myPlayerId);
    const userData = {
        name: myName,
        role: myRole,
        online: true,
        last_active: firebase.database.ServerValue.TIMESTAMP
    };

    // 寫入使用者資料
    userRef.set(userData);

    // 設置斷線時自動更新狀態
    userRef.child('online').onDisconnect().set(false);
    userRef.child('last_active').onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);

    unsubscribeListeners.push(() => {
        userRef.child('online').onDisconnect().cancel();
        userRef.child('last_active').onDisconnect().cancel();
    });
}

/**
 * 更新使用者活動時間（由心跳機制調用）
 */
function updateUserPresence() {
    if (!roomRef || !myPlayerId) return;
    roomRef.child('users/' + myPlayerId + '/last_active').set(firebase.database.ServerValue.TIMESTAMP);
}

/**
 * 取得房間內的在線使用者列表
 * @returns {Array} 使用者陣列 [{userId, name, role, online, last_active}]
 */
function getOnlineUsers() {
    const users = [];
    const now = Date.now();
    const OFFLINE_THRESHOLD = 5 * 60 * 1000; // 5 分鐘內視為在線

    for (const [userId, userData] of Object.entries(roomUsers)) {
        // 過濾掉離線太久的使用者
        const lastActive = userData.last_active || 0;
        const isRecent = (now - lastActive) < OFFLINE_THRESHOLD;
        const isOnline = userData.online || isRecent;

        if (isOnline) {
            users.push({
                id: userId,
                name: userData.name || '未知',
                role: userData.role || 'player',
                online: userData.online,
                last_active: lastActive
            });
        }
    }

    return users;
}

/**
 * 取得所有使用者列表（包含離線使用者）
 * @returns {Array} 使用者陣列
 */
function getAllUsers() {
    const users = [];
    for (const [userId, userData] of Object.entries(roomUsers)) {
        users.push({
            id: userId,
            name: userData.name || '未知',
            role: userData.role || 'player',
            online: userData.online || false,
            last_active: userData.last_active || 0
        });
    }
    return users;
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
 * 更新調色盤到 Firebase
 */
function syncMapPalette() {
    if (!roomRef) return;
    roomRef.child('mapPalette').set(state.mapPalette || []);
}

/**
 * 更新單位到 Firebase
 * 注意：會自動為每個單位設定 sortOrder 以保持排序順序
 */
function syncUnits() {
    if (!roomRef) return;

    // 將陣列轉換為物件（使用單位 ID 作為 key）
    // 同時保存 sortOrder 以維持排序順序
    const unitsObj = {};
    state.units.forEach((unit, index) => {
        // 設定 sortOrder 以保持陣列順序
        unit.sortOrder = index;
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
        syncMapPalette();
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

// ===== 自訂狀態同步 =====

/**
 * 新增自訂狀態到房間（透過 Firebase 同步給所有人）
 * @param {Object} statusObj - 自訂狀態物件
 */
function addCustomStatusToRoom(statusObj) {
    if (!roomRef) return;

    if (myRole === 'st') {
        // ST 直接寫入 Firebase
        if (!state.customStatuses) state.customStatuses = [];
        state.customStatuses.push(statusObj);
        roomRef.child('customStatuses/' + statusObj.id).set(statusObj);
    } else {
        // 玩家透過 sendToHost 請求
        sendToHost({
            type: 'addCustomStatus',
            playerId: myPlayerId,
            statusObj: statusObj
        });
    }
}

/**
 * 從房間移除自訂狀態
 * @param {string} statusId - 狀態 ID
 */
function removeCustomStatusFromRoom(statusId) {
    if (!roomRef) return;

    if (myRole === 'st') {
        state.customStatuses = (state.customStatuses || []).filter(s => s.id !== statusId);
        roomRef.child('customStatuses/' + statusId).remove();
    }
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
            const newUnit = createUnit(message.name, message.hp, message.unitType, message.playerId, message.playerName, message.size || 1);
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

        case 'modifyMaxHp':
            const maxHpUnit = state.units.find(u => u.id === message.unitId);
            if (maxHpUnit && message.newMaxHp >= 1) {
                const oldMax = maxHpUnit.maxHp || maxHpUnit.hpArr.length;
                const newMax = message.newMaxHp;
                if (newMax > oldMax) {
                    const diff = newMax - oldMax;
                    for (let i = 0; i < diff; i++) {
                        maxHpUnit.hpArr.push(0);
                    }
                } else if (newMax < oldMax) {
                    maxHpUnit.hpArr.sort((a, b) => b - a);
                    maxHpUnit.hpArr = maxHpUnit.hpArr.slice(0, newMax);
                }
                maxHpUnit.maxHp = newMax;
                maxHpUnit.hpArr.sort((a, b) => b - a);
                roomRef.child(`units/${message.unitId}/maxHp`).set(newMax);
                roomRef.child(`units/${message.unitId}/hpArr`).set(maxHpUnit.hpArr);
            }
            break;

        case 'uploadAvatar':
            roomRef.child(`units/${message.unitId}/avatar`).set(message.avatar);
            break;

        case 'updateStatus':
            const statusUnit = state.units.find(u => u.id === message.unitId);
            if (statusUnit) {
                // 支援兩種格式：整個 status 物件或單一狀態更新
                if (message.status !== undefined) {
                    // 新格式：直接傳入整個 status 物件
                    statusUnit.status = message.status || {};
                    roomRef.child(`units/${message.unitId}/status`).set(statusUnit.status);
                } else {
                    // 舊格式：單一狀態更新
                    if (!statusUnit.status) statusUnit.status = {};

                    // 刪除舊狀態（如果名稱改變）
                    if (message.oldName && message.oldName !== message.statusName && statusUnit.status[message.oldName] !== undefined) {
                        delete statusUnit.status[message.oldName];
                    }

                    // 更新或刪除狀態
                    if (message.statusValue === '' || message.statusValue === null) {
                        delete statusUnit.status[message.statusName];
                        if (message.oldName && message.oldName !== message.statusName) {
                            delete statusUnit.status[message.oldName];
                        }
                    } else {
                        statusUnit.status[message.statusName] = message.statusValue;
                    }

                    // 同步到 Firebase
                    roomRef.child(`units/${message.unitId}/status`).set(statusUnit.status);
                }
            }
            break;

        case 'addCustomStatus':
            // 玩家請求新增自訂狀態到房間
            if (message.statusObj && message.statusObj.id) {
                roomRef.child('customStatuses/' + message.statusObj.id).set(message.statusObj);
            }
            break;
    }
}

// ===== 剪貼簿與 UI =====
// 注意：copyId(), copyMyCode(), updateCodeDisplay() 已在 utils.js 中定義
// 此處不再重複定義以保持程式碼簡潔

// ===== 頁面離開時清理 =====
window.addEventListener('beforeunload', () => {
    if (roomRef && myPlayerId && myRole === 'player') {
        // 標記玩家離線
        roomRef.child(`players/${myPlayerId}/online`).set(false);
    }
    cleanupListeners();
});

// ===== Session 管理 =====
const SESSION_KEY = 'limbus_session';

/**
 * 儲存 Session 到 localStorage
 * @param {Object} sessionData - Session 資料
 */
function saveSession(sessionData) {
    try {
        const session = {
            playerCode: sessionData.playerCode,
            playerId: sessionData.playerId,
            name: sessionData.name,
            roomCode: sessionData.roomCode,
            role: sessionData.role,
            savedAt: Date.now(),
            loggedOut: false  // 明確標記為未登出（清除之前可能的登出標記）
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        console.log('Session 已儲存:', session);
    } catch (e) {
        console.error('儲存 Session 失敗:', e);
    }
}

/**
 * 讀取 Session
 * @returns {Object|null} Session 資料
 */
function getSession() {
    try {
        const data = localStorage.getItem(SESSION_KEY);
        return data ? JSON.parse(data) : null;
    } catch (e) {
        console.error('讀取 Session 失敗:', e);
        return null;
    }
}

/**
 * 清除 Session
 */
function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

/**
 * 登出並重置
 * 保留識別碼以便下次登入，並重新載入頁面
 */
function logoutAndReset() {
    if (confirm('確定要登出嗎？')) {
        // 保留識別碼以便下次登入（不完全清除 session）
        const session = getSession();
        if (session) {
            // 標記為已登出，但保留識別碼供下次預填
            session.loggedOut = true;
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } else {
            clearSession();
        }

        // 如果是玩家，標記離線
        if (roomRef && myPlayerId && myRole === 'player') {
            roomRef.child(`players/${myPlayerId}/online`).set(false);
        }

        // 清理監聽器
        cleanupListeners();

        // 停止音樂
        if (typeof stopBGM === 'function') {
            stopBGM();
        }

        // 清理戰鬥儀表板狀態
        if (typeof unbindHUDCharacter === 'function') {
            unbindHUDCharacter();
        }

        // 重新載入頁面
        showToast('正在登出...');
        setTimeout(() => {
            location.reload();
        }, 500);
    }
}

/**
 * 檢查並嘗試自動登入
 * 在頁面載入時呼叫
 */
function checkExistingSession() {
    const session = getSession();

    if (!session) {
        // 沒有 Session，顯示登入畫面
        prefillInputsFromStorage();
        return;
    }

    // 檢查 Session 是否過期（超過 7 天）
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - session.savedAt > sevenDays) {
        clearSession();
        prefillInputsFromStorage();
        return;
    }

    // 如果是手動登出的，預填輸入框但不自動登入
    if (session.loggedOut) {
        prefillInputsFromStorage();
        return;
    }

    // 嘗試自動登入
    showToast(`歡迎回來，${session.name}！正在自動連線...`);

    // 恢復身份
    myName = session.name;
    myPlayerCode = session.playerCode;
    myPlayerId = session.playerId;
    myRole = session.role;

    // 顯示載入畫面
    document.getElementById('login-main').classList.add('hidden');
    document.getElementById('login-loading').classList.remove('hidden');
    document.getElementById('loading-status').innerText = `正在連線到房間 ${session.roomCode}...`;

    // 連線到房間
    if (session.role === 'st') {
        joinRoom(session.roomCode, true);
    } else {
        joinRoom(session.roomCode, false);
    }
}

/**
 * 預填輸入框
 * 從 localStorage 或上次的 Session 讀取
 */
function prefillInputsFromStorage() {
    const session = getSession();

    // 嘗試預填名稱
    const nameInput = document.getElementById('input-name');
    if (nameInput && session && session.name) {
        nameInput.value = session.name;
    }

    // 嘗試預填玩家識別碼
    const playerCodeInput = document.getElementById('input-player-code');
    if (playerCodeInput && session && session.playerCode) {
        playerCodeInput.value = session.playerCode;
    }

    // 嘗試預填 ST 識別碼
    const stCodeInput = document.getElementById('input-st-code');
    if (stCodeInput && session && session.role === 'st' && session.playerCode) {
        stCodeInput.value = session.playerCode;
    }
}

console.log('✅ Firebase 連線模組已載入');

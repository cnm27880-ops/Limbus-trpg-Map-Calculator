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

// ===== Phase 1B：寫入粒度優化用的快照 =====
// 這些快照記錄「Firebase 上目前已知的狀態」，由各監聽器在收到資料時更新（確認寫入後才更新），
// 讓 sync 函式只需寫出「有變動」的部分，避免每次都整包覆寫。
let _syncedUnits = {};          // id -> 上次 Firebase 已知的單位（深拷貝），供 syncUnits 做 diff
let _syncedMapDataStr = null;   // 上次 Firebase 已知的 mapData（JSON 字串）
let _syncedPaletteStr = null;   // 上次 Firebase 已知的 mapPalette（JSON 字串）

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
                            <button onclick="enterRoomFromManager('${escapeHtml(room.code)}')" style="
                                background: var(--accent-green);
                                color: #000;
                                border: none;
                                padding: 8px 16px;
                                border-radius: 6px;
                                font-weight: bold;
                                cursor: pointer;
                            ">進入</button>
                            <button onclick="deleteRoomFromManager('${escapeHtml(room.code)}')" style="
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
            container.innerHTML = `<div style="text-align:center;color:var(--accent-red);padding:20px;">載入失敗: ${escapeHtml(error.message)}</div>`;
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
    // Firebase SDK 由 CDN 載入；載入失敗（斷網、被防火牆擋）時 database 不存在，
    // 若不先檢查會直接丟例外，畫面卡在「連線中...」沒有任何提示。
    // 注意：database 是 firebase-config.js 的頂層 const，初始化失敗時直接引用會踩 TDZ，
    // 必須改查 window.database。
    if (typeof firebase === 'undefined' || !window.database) {
        showToast('無法載入 Firebase SDK，請檢查網路連線後重新整理頁面', 4000);
        setConnectionStatus('disconnected', 'SDK 載入失敗');
        return;
    }

    // 代號不再於登入時輸入：改由登入後自行修改。實際代號在 joinRoom / createRoom 決定
    // （返回玩家沿用既有代號，新玩家給預設）。身分與棋子權限只綁 4 碼識別碼。
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
    if (!myName) myName = 'ST';  // 登入不再輸入代號，ST 給預設（登入後可自行修改）

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

            // 顯示 ST 歌詞錄製/清單區塊
            const lyricsStControls = document.getElementById('lyrics-st-controls');
            if (lyricsStControls) lyricsStControls.style.display = 'block';

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
            turnIdx: state.turnIdx,
            isCombatActive: false,
            roundNum: 0,
            activeBossId: null
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
    if (isST && !myName) myName = 'ST';  // ST 代號預設（登入不再輸入，可登入後自行修改）

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
            const data = snapshot.val();
            loadRoomData(data);

            // 玩家加入：註冊自己到玩家列表和使用者列表
            if (!isST) {
                // 保留返回玩家既有的轉盤資料（spins / inventory），避免重新加入時被重置
                const existingPlayer = (data.players && data.players[myPlayerId]) || {};
                // 代號解析：返回玩家（用同一識別碼登入）沿用既有代號，保留棋子權限；
                // 全新玩家跳一次「設定代號」提示（可取消 → 用預設「玩家####」）。
                // 身分只綁識別碼，代號僅為顯示名，改名不影響權限。
                if (existingPlayer.name) {
                    myName = existingPlayer.name;
                } else if (!myName) {
                    let input = null;
                    try {
                        input = prompt('歡迎加入！設定你的代號（其他人看到的名稱，之後可在右上角 👤 修改）', '');
                    } catch (e) { /* prompt 不可用時退回預設 */ }
                    const trimmed = (input || '').trim().substring(0, 30);
                    myName = trimmed || ('玩家' + myPlayerCode);
                }
                const playerData = {
                    name: myName,
                    code: myPlayerCode,
                    online: true,
                    joinedAt: firebase.database.ServerValue.TIMESTAMP,
                    spins: (typeof existingPlayer.spins === 'number') ? existingPlayer.spins : 0,  // 幸運大轉盤：剩餘抽獎次數
                    inventory: Array.isArray(existingPlayer.inventory) ? existingPlayer.inventory : []  // 幸運大轉盤：已抽中的獎品/碎片
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

                // 玩家端隱藏音樂播放/暫停/停止按鈕（由 ST 統一控制）
                const playBtn = document.getElementById('bgm-play-btn');
                const stopBtn = document.getElementById('bgm-stop-btn');
                if (playBtn) playBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'none';

                // 玩家端隱藏歌詞功能：歌詞選擇器按鈕 + 媒體中心的「歌詞」分頁（ST 專用）
                const lyricPickBtn = document.getElementById('bgm-lyrics-pick-btn');
                if (lyricPickBtn) lyricPickBtn.style.display = 'none';
                const lyricsTab = document.getElementById('media-tab-lyrics');
                if (lyricsTab) lyricsTab.style.display = 'none';

                // 特殊BOSS戰分頁（ST 專用）於建立「戰鬥工具」面板時依角色自動隱藏
            } else {
                // ST 的音樂控制區塊
                const musicStControls = document.getElementById('bgm-st-controls');
                if (musicStControls) musicStControls.style.display = 'block';
                // ST 的歌詞錄製/清單區塊
                const lyricsStControls = document.getElementById('lyrics-st-controls');
                if (lyricsStControls) lyricsStControls.style.display = 'block';
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
        state.isCombatActive = data.state.isCombatActive || false;
        state.roundNum = data.state.roundNum || 0;
        state.activeBossId = data.state.activeBossId || null;
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
    // 補齊轉盤欄位（spins / inventory）
    if (typeof normalizePlayersRoulette === 'function') normalizePlayersRoulette();

    if (data.customStatuses) {
        state.customStatuses = Object.values(data.customStatuses);
    } else {
        state.customStatuses = [];
    }

    // 載入常駐狀態覆寫
    state.statusOverrides = (data.statusOverrides && typeof data.statusOverrides === 'object')
        ? data.statusOverrides
        : {};

    // 載入狀態庫自訂排序
    state.statusOrder = (data.statusOrder && typeof data.statusOrder === 'object')
        ? data.statusOrder
        : {};

    // 載入地圖背景圖（房間共享）
    if (typeof data.mapBg === 'string' && data.mapBg.startsWith('data:image/')) {
        state.mapBgImage = data.mapBg;
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
    // 進入新房間：重置寫入粒度快照（由下方各監聽器在收到資料後重新填入）
    _syncedUnits = {};
    _syncedMapDataStr = null;
    _syncedPaletteStr = null;

    // 監聽地圖資料變更
    const mapDataListener = roomRef.child('mapData').on('value', snapshot => {
        if (snapshot.exists()) {
            const raw = snapshot.val();
            // 驗證地圖資料格式
            if (typeof validateMapData === 'function') {
                const validated = validateMapData(raw, 50, 50);
                if (validated) {
                    state.mapData = validated;
                } else {
                    console.warn('[Security] 地圖資料格式不正確，已忽略');
                    return;
                }
            } else {
                state.mapData = raw;
            }
            // 記錄 Firebase 已確認的 mapData，供 syncMapData 判斷是否需要再寫入
            _syncedMapDataStr = JSON.stringify(state.mapData);
            scheduleRenderMap();
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
        // 記錄 Firebase 已確認的 palette，供 syncMapPalette 判斷是否需要再寫入
        _syncedPaletteStr = JSON.stringify(state.mapPalette || []);
        updateToolbar();
        scheduleRenderMap();
    });
    unsubscribeListeners.push(() => roomRef.child('mapPalette').off('value', paletteListener));

    // 監聽地圖背景圖變更（ST 上傳後同步給所有玩家）
    const mapBgListener = roomRef.child('mapBg').on('value', snapshot => {
        const val = snapshot.exists() ? snapshot.val() : null;
        if (typeof val === 'string' && val.startsWith('data:image/') && val.length < 3000000) {
            state.mapBgImage = val;
        } else if (!val) {
            // 節點不存在：若 ST 本機留有舊版背景圖（更新前只存 localStorage），補同步到房間
            if (myRole === 'st' && state.mapBgImage) {
                roomRef.child('mapBg').set(state.mapBgImage);
                return; // 寫入後監聽器會再次觸發
            }
            state.mapBgImage = null;
        } else {
            console.warn('[Security] 背景圖資料格式不正確，已忽略');
            return;
        }
        if (typeof applyMapBg === 'function') applyMapBg();
    });
    unsubscribeListeners.push(() => roomRef.child('mapBg').off('value', mapBgListener));

    // 監聽單位變更
    const unitsListener = roomRef.child('units').on('value', snapshot => {
        if (snapshot.exists()) {
            const rawVal = snapshot.val();
            if (!rawVal || typeof rawVal !== 'object') {
                state.units = [];
                _syncedUnits = {};
                return;
            }
            // 將物件轉換為陣列，過濾無效資料，並根據 sortOrder 排序以維持順序
            const unitsArray = Object.values(rawVal).filter(u => u && typeof u === 'object' && u.id);
            // 驗證每個單位的關鍵欄位
            unitsArray.forEach(u => {
                u.name = (typeof u.name === 'string') ? u.name.substring(0, 50) : 'Unknown';
                u.maxHp = (typeof u.maxHp === 'number' && u.maxHp > 0 && u.maxHp <= 9999) ? u.maxHp : 10;
                u.type = ['enemy', 'player', 'boss'].includes(u.type) ? u.type : 'enemy';
                u.init = (typeof u.init === 'number') ? Math.max(-999, Math.min(999, Math.floor(u.init))) : 0;
                u.size = [1, 2, 3].includes(u.size) ? u.size : 1;
                u.hidden = u.hidden === true;  // 確保 hidden 永遠是 boolean（舊單位沒有此欄位時為 false）
                // 護盾欄位消毒（0~999 的整數）
                const clampShield = v => (typeof v === 'number' && v > 0) ? Math.min(999, Math.floor(v)) : 0;
                u.shieldAutoMax = clampShield(u.shieldAutoMax);
                u.shieldAuto = clampShield(u.shieldAuto);
                u.shieldTemp = clampShield(u.shieldTemp);
                u.avatar = (typeof u.avatar === 'string' && u.avatar.startsWith('data:image/') && u.avatar.length < 500000) ? u.avatar : (u.avatar || null);
                if (u.status && typeof u.status === 'object') {
                    // 過濾掉 __proto__ 等危險鍵
                    const safeStatus = {};
                    for (const key of Object.keys(u.status)) {
                        if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
                            safeStatus[key] = String(u.status[key] || '').substring(0, 100);
                        }
                    }
                    u.status = safeStatus;
                } else {
                    u.status = {};
                }
            });
            unitsArray.sort((a, b) => {
                // 如果有 sortOrder 就按照 sortOrder 排序
                // 否則按照 id 排序（向後相容）
                const orderA = a.sortOrder !== undefined ? a.sortOrder : Infinity;
                const orderB = b.sortOrder !== undefined ? b.sortOrder : Infinity;
                return orderA - orderB;
            });
            state.units = unitsArray;
            // 記錄 Firebase 已確認的單位狀態（深拷貝），供 syncUnits 做欄位級 diff
            _syncedUnits = _snapshotUnits(unitsArray);
        } else {
            state.units = [];
            _syncedUnits = {};
        }
        scheduleUnitsAndMapRefresh();  // 單位清單／側欄／地圖，合流成每影格一次重繪
    });
    unsubscribeListeners.push(() => roomRef.child('units').off('value', unitsListener));

    // 監聯狀態變更
    const stateListener = roomRef.child('state').on('value', snapshot => {
        if (snapshot.exists()) {
            const newState = snapshot.val();
            if (!newState || typeof newState !== 'object') return;
            // 驗證地圖尺寸（限制在合理範圍）
            const validW = (typeof newState.mapW === 'number') ? Math.max(5, Math.min(50, Math.floor(newState.mapW))) : state.mapW;
            const validH = (typeof newState.mapH === 'number') ? Math.max(5, Math.min(50, Math.floor(newState.mapH))) : state.mapH;
            if (validW !== state.mapW || validH !== state.mapH) {
                state.mapW = validW;
                state.mapH = validH;
            }
            const validThemeId = (typeof newState.themeId === 'number') ? Math.max(0, Math.floor(newState.themeId)) : state.themeId;
            if (validThemeId !== state.themeId) {
                state.themeId = validThemeId;
                updateToolbar();
            }
            const prevTurnIdx = state.turnIdx;
            state.turnIdx = (typeof newState.turnIdx === 'number') ? Math.max(-1, Math.floor(newState.turnIdx)) : 0;
            state.isCombatActive = newState.isCombatActive === true;
            state.roundNum = (typeof newState.roundNum === 'number') ? Math.max(0, Math.floor(newState.roundNum)) : 0;
            state.activeBossId = (typeof newState.activeBossId === 'string') ? newState.activeBossId : null;
            renderUnitsList();
            renderUnitsToolbar();
            scheduleRenderMap();

            // 回合開始技能自動觸發：偵測到 turnIdx「真的改變」且新的當前行動單位是自己的單位時，
            // 由本客戶端自行用本地端 identityHudState（存在各玩家自己瀏覽器 localStorage）
            // 觸發回合開始資源結算。刻意不放在 ST 專用的 nextTurn()（units.js），因為 ST 端
            // 沒有玩家的 identityHudState 資料；每個玩家的客戶端各自判斷「現在是不是輪到我」。
            // prevTurnIdx 剛加入房間時已由 loadRoomData 設成與本次相同的值，故不會在剛連線/
            // 重新整理時誤觸發（此時兩者相等，不算「改變」）。
            if (state.turnIdx !== prevTurnIdx && state.isCombatActive && Array.isArray(state.units) &&
                typeof myPlayerId !== 'undefined' && myPlayerId &&
                typeof autoTriggerIdentityTurnStart === 'function') {
                const activeUnit = state.units[state.turnIdx];
                if (activeUnit && activeUnit.ownerId === myPlayerId) {
                    autoTriggerIdentityTurnStart(activeUnit);
                }
            }
        }
    });
    unsubscribeListeners.push(() => roomRef.child('state').off('value', stateListener));

    // 監聽玩家列表
    const playersListener = roomRef.child('players').on('value', snapshot => {
        if (snapshot.exists()) {
            state.players = snapshot.val();
        } else {
            state.players = {};
        }
        // 補齊轉盤欄位（spins / inventory）並刷新相關 UI
        if (typeof normalizePlayersRoulette === 'function') normalizePlayersRoulette();
        if (typeof renderRouletteUI === 'function') renderRouletteUI();
        if (typeof renderSTRouletteManager === 'function') renderSTRouletteManager();
    });
    unsubscribeListeners.push(() => roomRef.child('players').off('value', playersListener));

    // 監聽幸運大轉盤廣播事件（全服中獎動畫）
    const rouletteListener = roomRef.child('events/roulette').on('value', snapshot => {
        if (snapshot.exists() && typeof handleRouletteBroadcast === 'function') {
            handleRouletteBroadcast(snapshot.val());
        }
    });
    unsubscribeListeners.push(() => roomRef.child('events/roulette').off('value', rouletteListener));

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

    // 監聽常駐狀態覆寫變更（房間共享）
    const statusOverridesListener = roomRef.child('statusOverrides').on('value', snapshot => {
        state.statusOverrides = snapshot.exists() ? (snapshot.val() || {}) : {};
        // 圖示/名稱可能變更，重繪單位列表與開啟中的狀態網格
        if (typeof renderUnitsList === 'function') renderUnitsList();
        if (typeof renderSidebarUnits === 'function') renderSidebarUnits();
        const overrideGrid = document.getElementById('status-grid');
        if (overrideGrid && typeof currentStatusCategory !== 'undefined' && typeof renderStatusGrid === 'function') {
            overrideGrid.innerHTML = renderStatusGrid(currentStatusCategory);
        }
    });
    unsubscribeListeners.push(() => roomRef.child('statusOverrides').off('value', statusOverridesListener));

    // 監聽狀態庫排序變更（房間共享）
    const statusOrderListener = roomRef.child('statusOrder').on('value', snapshot => {
        state.statusOrder = snapshot.exists() ? (snapshot.val() || {}) : {};
        const orderGrid = document.getElementById('status-grid');
        if (orderGrid && typeof currentStatusCategory !== 'undefined' && typeof renderStatusGrid === 'function') {
            orderGrid.innerHTML = renderStatusGrid(currentStatusCategory);
        }
        const orderTabs = document.getElementById('status-category-tabs');
        if (orderTabs && typeof renderCategoryTabs === 'function') {
            orderTabs.innerHTML = renderCategoryTabs();
        }
    });
    unsubscribeListeners.push(() => roomRef.child('statusOrder').off('value', statusOrderListener));

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

    // 監聽歌詞狀態變更
    const lyricsListener = roomRef.child('lyrics').on('value', snapshot => {
        if (typeof handleLyricsUpdate === 'function') {
            handleLyricsUpdate(snapshot.val());
        }
    });
    unsubscribeListeners.push(() => roomRef.child('lyrics').off('value', lyricsListener));

    // 定期更新活動時間（每 30 秒）
    const activityInterval = setInterval(() => {
        roomRef.child('info/lastActive').set(firebase.database.ServerValue.TIMESTAMP);
    }, CONNECTION_CONFIG.ACTIVITY_UPDATE_INTERVAL);
    unsubscribeListeners.push(() => clearInterval(activityInterval));

    // 設置連線監控和心跳機制
    setupConnectionMonitor();

    // 設置戰鬥隊列監聽（盲盒戰鬥與 QTE 系統，獨立於上述同步狀態）
    if (typeof cqSetupListener === 'function') cqSetupListener();

    // 設置 BOSS 多重行動對抗分配監聽（獨立於上述同步狀態）
    if (typeof cpSetupListener === 'function') cpSetupListener();

    // 系統 A：戰鬥日誌 / 構築室監聽（combatLogs）
    if (typeof logViewSetupListener === 'function') logViewSetupListener();

    // 系統 B：刻度時鐘與 E.G.O 侵蝕監聽（clockTicks / events/erosion）
    if (typeof erosionSetupListener === 'function') erosionSetupListener();

    // AI 地圖助手：QAB 選單可見性 + 地圖庫房間共享（對話本身/畫布不經 Firebase，只有存檔的地圖庫同步）
    if (typeof maiGateUI === 'function') maiGateUI();
    if (typeof maiSetupListener === 'function') maiSetupListener();

    // 戰爭迷霧：啟用開關 + 各玩家的已探索紀錄
    if (typeof fogSetupListener === 'function') fogSetupListener();
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

            // 紀錄玩家「最後上線時間」（供 ST 辨識並清除幽靈帳號）
            trackPlayerLastOnline();

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

    const HEARTBEAT_INTERVAL = CONNECTION_CONFIG.HEARTBEAT_INTERVAL;

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
 * 紀錄玩家「最後上線時間」
 * - 連線時：將 players/{id}/lastOnline 設為伺服器時間、isOnline 設為 true
 * - 斷線時：透過 onDisconnect() 自動將 isOnline 設為 false，並再次更新 lastOnline
 * 僅針對玩家節點（ST 不在 players 節點下，故略過）。
 */
function trackPlayerLastOnline() {
    if (!roomRef || !myPlayerId || myRole !== 'player') return;

    const playerRef = roomRef.child('players/' + myPlayerId);

    // 連線時更新上線狀態與時間
    playerRef.child('isOnline').set(true);
    playerRef.child('lastOnline').set(firebase.database.ServerValue.TIMESTAMP);

    // 斷線時自動標記離線並再次紀錄最後上線時間
    playerRef.child('isOnline').onDisconnect().set(false);
    playerRef.child('lastOnline').onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);

    unsubscribeListeners.push(() => {
        playerRef.child('isOnline').onDisconnect().cancel();
        playerRef.child('lastOnline').onDisconnect().cancel();
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
    const OFFLINE_THRESHOLD = CONNECTION_CONFIG.OFFLINE_THRESHOLD;

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
    // 只有在 mapData 真的變動時才寫入，避免移動單位等操作也整張地圖覆寫
    const str = JSON.stringify(state.mapData);
    if (str === _syncedMapDataStr) return;
    roomRef.child('mapData').set(state.mapData);
    // 樂觀更新；若寫入成功，mapData 監聽器也會以 Firebase 確認值再次校正
    _syncedMapDataStr = str;
}

/**
 * 更新調色盤到 Firebase
 */
function syncMapPalette() {
    if (!roomRef) return;
    const str = JSON.stringify(state.mapPalette || []);
    if (str === _syncedPaletteStr) return;
    roomRef.child('mapPalette').set(state.mapPalette || []);
    _syncedPaletteStr = str;
}

// ===== 寫入粒度優化：輔助函式 =====

/**
 * 深拷貝單位（用於快照）
 */
function _cloneUnit(u) {
    return JSON.parse(JSON.stringify(u));
}

/**
 * 將單位陣列轉成 id -> 深拷貝 的快照表
 */
function _snapshotUnits(arr) {
    const map = {};
    (arr || []).forEach(u => { if (u && u.id) map[u.id] = _cloneUnit(u); });
    return map;
}

/**
 * 與順序無關的深度比較（避免因物件鍵順序不同而誤判為變動）
 */
function _deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== 'object' || typeof b !== 'object') return a === b;
    const aArr = Array.isArray(a), bArr = Array.isArray(b);
    if (aArr !== bArr) return false;
    if (aArr) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!_deepEqual(a[i], b[i])) return false;
        return true;
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!_deepEqual(a[k], b[k])) return false;
    }
    return true;
}

/**
 * 更新地圖背景圖到 Firebase（僅 ST，上傳/清除時呼叫）
 */
function syncMapBg() {
    if (!roomRef || myRole !== 'st') return;
    roomRef.child('mapBg').set(state.mapBgImage || null);
}

/**
 * 更新單位到 Firebase
 * 注意：會自動為每個單位設定 sortOrder 以保持排序順序
 */
function syncUnits() {
    if (!roomRef) return;

    // 以快照（_syncedUnits = Firebase 已知狀態）做欄位級 diff，只寫出有變動的部分，
    // 改用單次 multi-path update() 取代整包 set()，大幅減少頻寬（尤其是 base64 頭像）。
    const updates = {};   // 相對 roomRef 的多路徑更新
    const seen = new Set();

    state.units.forEach((unit, index) => {
        unit.sortOrder = index;          // 維持排序順序（變動時只會寫 sortOrder 一個欄位）
        seen.add(unit.id);

        const prev = _syncedUnits[unit.id];
        if (!prev) {
            // 新單位：整筆寫入
            updates['units/' + unit.id] = unit;
            return;
        }

        // 既有單位：逐欄位比對
        for (const key of Object.keys(unit)) {
            if (!_deepEqual(unit[key], prev[key])) {
                // Firebase 不接受 undefined；以 null 代表刪除
                updates['units/' + unit.id + '/' + key] = (unit[key] === undefined) ? null : unit[key];
            }
        }
        // 快照有、但目前單位已不存在的欄位 → 刪除
        for (const key of Object.keys(prev)) {
            if (!Object.prototype.hasOwnProperty.call(unit, key)) {
                updates['units/' + unit.id + '/' + key] = null;
            }
        }
    });

    // 已被移除的單位 → 刪除整筆
    for (const id of Object.keys(_syncedUnits)) {
        if (!seen.has(id)) updates['units/' + id] = null;
    }

    if (Object.keys(updates).length === 0) return;   // 無變動，省下一次寫入

    roomRef.update(updates);
    // 註：不在此處更新 _syncedUnits，改由 units 監聽器在 Firebase 確認後更新，
    // 確保快照永遠反映「實際寫入 Firebase 的狀態」，避免寫入失敗時漏寫。
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
        turnIdx: state.turnIdx,
        isCombatActive: state.isCombatActive || false,
        roundNum: state.roundNum || 0,
        activeBossId: state.activeBossId || null
    });
}

/**
 * 完整同步（用於大規模變更）
 */
function sendState() {
    if (myRole === 'st') {
        // 注意：sendState 是 ST 自己的權威狀態同步（非玩家輸入），不可加速率限制節流。
        // 戰鬥中頻繁操作（多重行動編輯、AOE、HP/護盾調整等）很容易在短時間內觸發多次同步；
        // 過去曾對此加上「每 10 秒 30 次」的節流，超過時會直接丟棄該次同步且只 console.warn，
        // 導致 ST 本地畫面看起來已儲存、但 Firebase 從未真正寫入，造成多重行動/HP 等資料在
        // 其他端或重新整理後消失。真正需要防護濫用的是玩家→host 訊息（sendToHost 已有節流）。
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

/**
 * 更新房間內的自訂狀態（僅 ST）
 * @param {Object} statusObj - 自訂狀態物件（含 id）
 */
function updateCustomStatusInRoom(statusObj) {
    if (!roomRef || myRole !== 'st' || !statusObj || !statusObj.id) return;
    state.customStatuses = (state.customStatuses || []).map(s => s.id === statusObj.id ? statusObj : s);
    roomRef.child('customStatuses/' + statusObj.id).set(statusObj);
}

/**
 * 設定常駐狀態的覆寫（僅 ST）
 * @param {Object} overrideObj - 覆寫物件（含 id，欄位會合併到原始定義之上）
 */
function setStatusOverrideInRoom(overrideObj) {
    if (!roomRef || myRole !== 'st' || !overrideObj || !overrideObj.id) return;
    if (!state.statusOverrides) state.statusOverrides = {};
    state.statusOverrides[overrideObj.id] = overrideObj;
    roomRef.child('statusOverrides/' + overrideObj.id).set(overrideObj);
}

/**
 * 移除常駐狀態的覆寫，還原為預設定義（僅 ST）
 * @param {string} statusId - 狀態 ID
 */
function removeStatusOverrideFromRoom(statusId) {
    if (!roomRef || myRole !== 'st') return;
    if (state.statusOverrides) delete state.statusOverrides[statusId];
    roomRef.child('statusOverrides/' + statusId).remove();
}

/**
 * 設定某分類的狀態排序（僅 ST）
 * @param {string} category - 分類 ID
 * @param {string[]} orderIds - 排序後的狀態 ID 陣列
 */
function setStatusOrderInRoom(category, orderIds) {
    if (!roomRef || myRole !== 'st' || !category) return;
    if (!state.statusOrder) state.statusOrder = {};
    state.statusOrder[category] = orderIds;
    roomRef.child('statusOrder/' + category).set(orderIds);
}

/**
 * 移動狀態到另一個分類（僅 ST）
 * - 自訂狀態：改寫自身 category
 * - 常駐狀態：以覆寫設定 category
 * @param {string} statusId - 狀態 ID
 * @param {string} newCategory - 目標分類 ID
 */
function setStatusCategoryInRoom(statusId, newCategory) {
    if (!roomRef || myRole !== 'st' || !statusId || !newCategory) return;
    const custom = (state.customStatuses || []).find(s => s.id === statusId);
    if (custom) {
        const updated = { ...custom, category: newCategory };
        updateCustomStatusInRoom(updated);
    } else {
        const existing = (state.statusOverrides && state.statusOverrides[statusId]) || {};
        setStatusOverrideInRoom({ ...existing, id: statusId, category: newCategory });
    }
}

// ===== 玩家操作函數 =====

/**
 * 玩家發送訊息（修改為直接更新 Firebase）
 */
function sendToHost(message) {
    if (!roomRef) return;

    // 速率限制：玩家每 10 秒最多 20 次操作
    if (typeof RateLimiter !== 'undefined' && !RateLimiter.check('sendToHost', 20, 10000)) {
        showToast('操作過於頻繁，請稍候再試');
        return;
    }

    switch (message.type) {
        case 'moveUnit':
            // 直接更新單位位置
            roomRef.child(`units/${message.unitId}/x`).set(message.x);
            roomRef.child(`units/${message.unitId}/y`).set(message.y);
            // 同步移動能量消耗（戰術移動系統：本回合已消耗格數）
            if (message.moveUsed !== undefined) {
                roomRef.child(`units/${message.unitId}/moveUsed`).set(Math.max(0, parseInt(message.moveUsed) || 0));
            }
            break;

        case 'addUnit':
            const newUnit = createUnit(message.name, message.hp, message.unitType, message.playerId, message.playerName, message.size || 1, parseInt(message.moveSpeed) || 20);
            if (message.avatar) newUnit.avatar = message.avatar;
            // 模板帶來的完整戰鬥數值（defDp/defAuto/三豁免/全屬性技能/支線等級/本體行動DP・狀態）
            if (message.combat && typeof message.combat === 'object') Object.assign(newUnit, message.combat);
            roomRef.child(`units/${newUnit.id}`).set(newUnit);
            break;

        case 'deleteUnit':
            roomRef.child(`units/${message.unitId}`).remove();
            break;

        case 'renameUnit':
            roomRef.child(`units/${message.unitId}/name`).set(String(message.name || '').substring(0, 50));
            break;

        case 'modifyHP':
            const unit = state.units.find(u => u.id === message.unitId);
            if (unit) {
                modifyHPInternal(unit, message.dmgType, message.amount);
                roomRef.child(`units/${message.unitId}/hpArr`).set(unit.hpArr);
                // 護盾可能在 modifyHPInternal 中被消耗，一併同步
                roomRef.child(`units/${message.unitId}/shieldTemp`).set(unit.shieldTemp || 0);
                roomRef.child(`units/${message.unitId}/shieldAuto`).set(unit.shieldAuto || 0);
            }
            break;

        case 'updateShield':
            const shieldUnit = state.units.find(u => u.id === message.unitId);
            if (shieldUnit) {
                const clampShieldVal = v => Math.max(0, Math.min(999, parseInt(v) || 0));
                shieldUnit.shieldAutoMax = clampShieldVal(message.shieldAutoMax);
                shieldUnit.shieldAuto = clampShieldVal(message.shieldAuto);
                shieldUnit.shieldTemp = clampShieldVal(message.shieldTemp);
                roomRef.child(`units/${message.unitId}/shieldAutoMax`).set(shieldUnit.shieldAutoMax);
                roomRef.child(`units/${message.unitId}/shieldAuto`).set(shieldUnit.shieldAuto);
                roomRef.child(`units/${message.unitId}/shieldTemp`).set(shieldUnit.shieldTemp);
            }
            break;

        case 'updateInit':
            roomRef.child(`units/${message.unitId}/init`).set(message.init);
            break;

        case 'updateMoveSpeed':
            // 移動速度（米）：戰術移動限制來源，夾限 0~999
            roomRef.child(`units/${message.unitId}/moveSpeed`).set(Math.max(0, Math.min(999, parseInt(message.moveSpeed) || 0)));
            break;

        case 'updatePlayerStats': {
            // 玩家角色數值：三豁免（A+B 分存骰數/附加成功）＋措手不及防禦＋移速（米）＋先攻加值，
            // 右鍵「角色數值」Modal 儲存
            const clampSaveVal = v => Math.max(-999, Math.min(999, parseInt(v) || 0));
            const clampAutoVal = v => Math.max(0, Math.min(999, parseInt(v) || 0));
            roomRef.child(`units/${message.unitId}`).update({
                saveWill: clampSaveVal(message.saveWill),
                saveWillAuto: clampAutoVal(message.saveWillAuto),
                saveReflex: clampSaveVal(message.saveReflex),
                saveReflexAuto: clampAutoVal(message.saveReflexAuto),
                saveTenacity: clampSaveVal(message.saveTenacity),
                saveTenacityAuto: clampAutoVal(message.saveTenacityAuto),
                surpriseDp: clampSaveVal(message.surpriseDp),
                surpriseAuto: clampAutoVal(message.surpriseAuto),
                moveSpeed: Math.max(0, Math.min(999, parseInt(message.moveSpeed) || 0)),
                initBonus: clampSaveVal(message.initBonus)
            });
            break;
        }

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

        case 'resetUnitHp':
            const resetUnit = state.units.find(u => u.id === message.unitId);
            if (resetUnit && resetUnit.hpArr) {
                resetUnit.hpArr = resetUnit.hpArr.map(() => 0);
                roomRef.child(`units/${message.unitId}/hpArr`).set(resetUnit.hpArr);
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
const SESSION_KEY = CONNECTION_CONFIG.STORAGE_KEY;

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
 * 修改自己的「代號」（全域顯示名稱，任何人皆可改自己的）。
 * 代號只是其他人看到的名稱，與登入識別碼、棋子權限完全無關，改名不會失去任何權限。
 * 與「棋子代號」（unit.ownerName，由 ST 設定）是兩回事。
 */
function renameMyCodename() {
    const cur = (typeof myName !== 'undefined' && myName) ? myName : '';
    const input = prompt('修改你的代號（其他人看到的名稱；與登入識別碼、棋子權限無關）', cur);
    if (input === null) return;                       // 取消
    const name = input.trim().substring(0, 30);
    if (!name) { showToast('代號不可空白'); return; }
    if (name === cur) return;

    myName = name;
    if (roomRef && myPlayerId) {
        // 玩家寫入 players 節點；ST 沒有 players 條目，只更新 users
        if (myRole !== 'st') roomRef.child('players/' + myPlayerId + '/name').set(name);
        roomRef.child('users/' + myPlayerId + '/name').set(name);
    }
    // 同步更新本機 session，避免下次自動登入又還原成舊代號
    const s = getSession();
    if (s) saveSession(Object.assign({}, s, { name: name }));

    if (typeof updateCodeDisplay === 'function') updateCodeDisplay();
    if (typeof renderAll === 'function') renderAll();
    showToast('代號已更新');
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

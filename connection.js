/**
 * Limbus Command - 連線管理
 * 處理 PeerJS 連線、心跳、重連等邏輯
 */

// ===== 連線狀態 UI =====
/**
 * 更新連線狀態 UI
 * @param {string} status - 狀態 ('connected', 'connecting', 'disconnected')
 * @param {string} text - 顯示文字（選填）
 */
function setConnectionStatus(status, text = null) {
    connectionState = status;
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

// ===== Session 儲存 =====
/**
 * 儲存 Session 到 localStorage
 */
function saveSession() {
    const session = {
        name: myName,
        role: myRole,
        hostId: hostId,
        peerId: myPeerId,
        playerId: myPlayerId,
        playerCode: myPlayerCode,
        timestamp: Date.now()
    };
    localStorage.setItem(CONNECTION_CONFIG.STORAGE_KEY, JSON.stringify(session));
}

/**
 * 從 localStorage 載入 Session
 * @returns {Object|null}
 */
function loadSession() {
    try {
        const data = localStorage.getItem(CONNECTION_CONFIG.STORAGE_KEY);
        return data ? JSON.parse(data) : null;
    } catch {
        return null;
    }
}

/**
 * 清除 Session
 */
function clearSession() {
    localStorage.removeItem(CONNECTION_CONFIG.STORAGE_KEY);
}

/**
 * 清除 Session 並重新整理頁面
 */
function clearSessionAndRefresh() {
    clearSession();
    location.reload();
}

// ===== 心跳機制 =====
/**
 * 啟動心跳檢測
 */
function startHeartbeat() {
    stopHeartbeat();
    
    heartbeatInterval = setInterval(() => {
        if (myRole === 'st') {
            // ST 發送心跳給所有玩家
            for (const peerId in connections) {
                const conn = connections[peerId];
                if (conn && conn.open) {
                    try {
                        conn.send({ type: 'heartbeat', timestamp: Date.now() });
                    } catch (e) {
                        console.warn('Heartbeat failed for', peerId);
                    }
                }
            }
        } else if (hostConn && hostConn.open) {
            // 玩家發送心跳給 ST
            try {
                hostConn.send({ 
                    type: 'heartbeat', 
                    playerId: myPlayerId, 
                    timestamp: Date.now() 
                });
            } catch (e) {
                console.warn('Heartbeat failed');
                handleConnectionLost();
            }
        } else if (connectionState === 'connected') {
            handleConnectionLost();
        }
    }, CONNECTION_CONFIG.HEARTBEAT_INTERVAL);
}

/**
 * 停止心跳檢測
 */
function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// ===== 斷線處理 =====
/**
 * 處理連線中斷
 */
function handleConnectionLost() {
    if (connectionState === 'disconnected') return;

    setConnectionStatus('disconnected', '斷線');
    showToast('連線中斷，嘗試重連...');
    attemptReconnect();
}

/**
 * 嘗試重新連線
 */
function attemptReconnect() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }

    if (reconnectAttempts >= CONNECTION_CONFIG.MAX_RECONNECT_ATTEMPTS) {
        showToast('重連失敗，請手動重新連線');
        setConnectionStatus('disconnected', '重連失敗');
        return;
    }

    reconnectAttempts++;
    const delay = CONNECTION_CONFIG.RECONNECT_DELAY * Math.min(reconnectAttempts, 5);
    setConnectionStatus('connecting', `重連中 (${reconnectAttempts}/${CONNECTION_CONFIG.MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimeout = setTimeout(() => {
        if (myRole === 'st') {
            if (peer && peer.disconnected && !peer.destroyed) {
                peer.reconnect();
            }
        } else if (hostId) {
            if (hostConn) {
                try { hostConn.close(); } catch (e) {}
            }
            connectToHost(hostId);
        }
    }, delay);
}

/**
 * 重置重連狀態
 */
function resetReconnectState() {
    reconnectAttempts = 0;
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
}

// ===== 頁面可見性處理 =====
/**
 * 設置頁面可見性處理器（處理手機背景/前景切換）
 */
function setupVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('Page visible, checking connection...');

            if (myRole === 'player' && hostConn) {
                if (!hostConn.open) {
                    handleConnectionLost();
                } else {
                    hostConn.send({ type: 'requestState', playerId: myPlayerId });
                }
            }

            setTimeout(() => {
                renderAll();
            }, 100);
        } else {
            console.log('Page hidden');
        }
    });

    window.addEventListener('focus', () => {
        setTimeout(() => {
            if (myRole === 'player' && hostConn && hostConn.open) {
                hostConn.send({ type: 'requestState', playerId: myPlayerId });
            }
            renderAll();
        }, 200);
    });
}

// ===== 登入流程 =====
/**
 * 檢查是否有現有的 Session
 */
function checkExistingSession() {
    const session = loadSession();
    if (session && session.name) {
        document.getElementById('input-name').value = session.name;
        if (session.hostId && session.role === 'player') {
            document.getElementById('input-host-id').value = session.hostId;
        }
        if (session.playerCode) {
            document.getElementById('input-player-code').value = session.playerCode;
        }
        if (session.role === 'st' || session.hostId) {
            showReconnectOption(session);
        }
    }
}

/**
 * 顯示重新連線選項
 * @param {Object} session - Session 資料
 */
function showReconnectOption(session) {
    const mainBox = document.getElementById('login-main');
    let reconnectDiv = document.getElementById('reconnect-option');
    
    if (!reconnectDiv) {
        reconnectDiv = document.createElement('div');
        reconnectDiv.id = 'reconnect-option';
        reconnectDiv.style.cssText = 'margin-top:15px;padding:12px;background:rgba(67,160,71,0.1);border:1px solid var(--accent-green);border-radius:8px;';

        const codeDisplay = session.playerCode
            ? `<div style="margin:10px 0;">
                   <div style="font-size:0.75rem;color:var(--text-dim);margin-bottom:4px;">你的識別碼：</div>
                   <div class="player-code" onclick="copyPlayerCode('${session.playerCode}')">${session.playerCode}</div>
                   <div style="font-size:0.65rem;color:var(--text-dim);">點擊複製，用於跨裝置重連</div>
               </div>`
            : '';

        reconnectDiv.innerHTML = `
            <div style="color:var(--accent-green);font-size:0.9rem;margin-bottom:8px;">🔄 偵測到上次連線</div>
            <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:8px;">
                ${session.role === 'st' ? '身份: ST (房主)' : '房間: ' + (session.hostId || '').substring(0, 8) + '...'}
            </div>
            ${codeDisplay}
            <button class="login-btn" style="background:var(--accent-green);padding:10px;" onclick="reconnectSession()">快速重連</button>
            <button class="login-btn btn-back" style="padding:8px;margin-top:6px;" onclick="clearSessionAndRefresh()">清除並重新開始</button>
        `;
        mainBox.appendChild(reconnectDiv);
    }
}

/**
 * 快速重連
 */
function reconnectSession() {
    const session = loadSession();
    if (!session) return showToast('無法讀取連線資料');

    document.getElementById('input-name').value = session.name;
    if (session.role === 'st') {
        initSystem('st', session.peerId);
    } else if (session.hostId) {
        document.getElementById('input-host-id').value = session.hostId;
        initSystem('player');
    }
}

function showJoinStep() {
    document.getElementById('login-main').classList.add('hidden');
    document.getElementById('login-st').classList.add('hidden');
    document.getElementById('login-join').classList.remove('hidden');

    const session = loadSession();
    if (session && session.hostId) {
        document.getElementById('input-host-id').value = session.hostId;
    }
}

function showSTStep() {
    document.getElementById('login-main').classList.add('hidden');
    document.getElementById('login-join').classList.add('hidden');
    document.getElementById('login-st').classList.remove('hidden');
}

function showMainStep() {
    document.getElementById('login-st').classList.add('hidden');
    document.getElementById('login-join').classList.add('hidden');
    document.getElementById('login-main').classList.remove('hidden');
}

// ===== 主要初始化 =====
/**
 * 初始化系統
 * @param {string} role - 角色 ('st' 或 'player')
 * @param {string} savedPeerId - 儲存的 Peer ID（用於 ST 重連）
 */
function initSystem(role, savedPeerId = null) {
    const name = document.getElementById('input-name').value.trim();
    if (!name) return showToast('請輸入代號');

    myName = name;
    myRole = role;

    // 初始化或恢復玩家 ID
    const session = loadSession();
    const inputPlayerCode = document.getElementById('input-player-code')?.value?.trim();

    if (inputPlayerCode && inputPlayerCode.length === 4) {
        myPlayerCode = inputPlayerCode;
        myPlayerId = 'code_' + inputPlayerCode;
    } else if (session && session.playerId) {
        myPlayerId = session.playerId;
        myPlayerCode = session.playerCode || generatePlayerCode();
    } else {
        myPlayerId = generatePlayerId();
        myPlayerCode = generatePlayerCode();
    }

    // 更新 UI
    document.getElementById('login-main').classList.add('hidden');
    document.getElementById('login-join').classList.add('hidden');
    document.getElementById('login-loading').classList.remove('hidden');

    setConnectionStatus('connecting', '建立連線中...');
    document.getElementById('loading-status').innerText = '正在連接伺服器...';

    // 建立 Peer 連線
    const peerOptions = {};
    if (role === 'st' && savedPeerId) {
        peer = new Peer(savedPeerId, peerOptions);
    } else {
        peer = new Peer(peerOptions);
    }

    peer.on('open', id => {
        myPeerId = id;

        if (role === 'st') {
            hostId = id;
            setConnectionStatus('connected', 'ST 已就緒');
        }

        document.getElementById('my-id').innerText = id;
        document.getElementById('login-layer').classList.add('hidden');

        saveSession();
        setupVisibilityHandler();

        if (role === 'st') {
            document.getElementById('st-map-controls').style.display = 'flex';
            document.getElementById('units-toolbar').style.display = 'flex';
            document.getElementById('tile-info-panel').style.display = 'block';

            if (!state.mapData || state.mapData.length === 0) {
                initMapData();
            }
            updateToolbar();
            renderAll();
            startHeartbeat();
            showToast(`房間已建立！你的識別碼：${myPlayerCode}`);
        } else {
            document.getElementById('st-map-controls').style.display = 'none';
            document.getElementById('units-toolbar').style.display = 'flex';

            const inputHostId = document.getElementById('input-host-id').value.trim();
            if (inputHostId) {
                hostId = inputHostId;
                saveSession();
                connectToHost(inputHostId);
            }
        }
        initCameraEvents();
    });

    peer.on('connection', c => {
        handleNewConnection(c);
    });

    peer.on('error', err => {
        console.error('Peer error:', err);
        if (err.type === 'unavailable-id') {
            showToast('房間ID已被佔用，產生新ID...');
            peer = new Peer();
            peer.on('open', id => {
                myPeerId = id;
                hostId = id;
                document.getElementById('my-id').innerText = id;
                document.getElementById('login-layer').classList.add('hidden');
                saveSession();
                initMapData();
                updateToolbar();
                renderAll();
                initCameraEvents();
            });
            peer.on('connection', c => handleNewConnection(c));
        } else {
            showToast('連線錯誤: ' + err.type);
            document.getElementById('login-layer').classList.remove('hidden');
            document.getElementById('login-loading').classList.add('hidden');
        }
    });

    peer.on('disconnected', () => {
        showToast('與伺服器斷線，嘗試重連...');
        setTimeout(() => {
            if (peer && !peer.destroyed) {
                peer.reconnect();
            }
        }, 2000);
    });
}

// ===== 連線處理 =====
/**
 * 連線到 Host（玩家使用）
 * @param {string} targetHostId - Host ID
 */
function connectToHost(targetHostId) {
    if (!targetHostId) return;
    hostId = targetHostId;

    setConnectionStatus('connecting', '連接房間中...');
    document.getElementById('loading-status').innerText = '正在連接房間...';

    hostConn = peer.connect(targetHostId, { reliable: true });

    hostConn.on('open', () => {
        setConnectionStatus('connected');
        resetReconnectState();
        showToast(`已連接！你的識別碼：${myPlayerCode}`);

        hostConn.send({
            type: 'join',
            peerId: myPeerId,
            playerId: myPlayerId,
            playerCode: myPlayerCode,
            playerName: myName
        });
        saveSession();
        startHeartbeat();
    });

    hostConn.on('data', data => {
        handlePlayerMessage(data);
    });

    hostConn.on('close', () => {
        console.log('Connection to host closed');
        hostConn = null;
        handleConnectionLost();
    });

    hostConn.on('error', err => {
        console.error('Connection error:', err);
        setConnectionStatus('disconnected', '連線錯誤');
        showToast('連線錯誤: ' + err.type);
        setTimeout(() => attemptReconnect(), CONNECTION_CONFIG.RECONNECT_DELAY);
    });
}

/**
 * 處理新玩家連線（ST 使用）
 * @param {Object} conn - PeerJS 連線物件
 */
function handleNewConnection(conn) {
    const playerId = conn.peer;
    connections[playerId] = conn;

    conn.on('open', () => {
        console.log('Player connected:', playerId);
    });

    conn.on('data', data => {
        handleSTMessage(conn, data);
    });

    conn.on('close', () => {
        console.log('Player disconnected:', playerId);
        delete connections[playerId];
        if (state.players[playerId]) {
            state.players[playerId].online = false;
            broadcastState();
        }
    });
}

/**
 * ST 接收玩家訊息
 * @param {Object} conn - 連線物件
 * @param {Object} data - 訊息資料
 */
function handleSTMessage(conn, data) {
    const peerId = conn.peer;
    const playerId = data.playerId || peerId;

    switch (data.type) {
        case 'heartbeat':
            if (conn.open) {
                conn.send({ type: 'heartbeat-ack', timestamp: Date.now() });
            }
            if (state.players[playerId] && state.players[playerId].peerId !== peerId) {
                state.players[playerId].peerId = peerId;
                delete connections[state.players[playerId].peerId];
                connections[peerId] = conn;
            }
            break;

        case 'requestState':
            if (conn.open) {
                conn.send({ type: 'state', payload: state });
            }
            break;

        case 'join':
            state.players[playerId] = {
                id: playerId,
                peerId: peerId,
                code: data.playerCode,
                name: data.playerName,
                online: true
            };
            showToast(`${data.playerName} 加入了房間 (${data.playerCode || ''})`);
            broadcastState();
            break;

        case 'addUnit':
            const unit = createUnit(data.name, data.hp, data.unitType);
            unit.ownerId = playerId;
            unit.ownerName = state.players[playerId]?.name || data.playerName;
            state.units.push(unit);
            broadcastState();
            break;

        case 'moveUnit':
            const u = state.units.find(u => u.id === data.unitId);
            if (u && u.ownerId === playerId) {
                u.x = data.x;
                u.y = data.y;
                broadcastState();
            }
            break;

        case 'modifyHP':
            const unit2 = state.units.find(u => u.id === data.unitId);
            if (unit2 && unit2.ownerId === playerId) {
                modifyHPInternal(unit2, data.dmgType, data.amount);
                broadcastState();
            }
            break;

        case 'deleteUnit':
            const idx = state.units.findIndex(u => u.id === data.unitId && u.ownerId === playerId);
            if (idx !== -1) {
                state.units.splice(idx, 1);
                broadcastState();
            }
            break;

        case 'updateInit':
            const unit3 = state.units.find(u => u.id === data.unitId);
            if (unit3 && unit3.ownerId === playerId) {
                unit3.init = data.init;
                broadcastState();
            }
            break;

        case 'uploadAvatar':
            const unit4 = state.units.find(u => u.id === data.unitId);
            if (unit4 && unit4.ownerId === playerId) {
                unit4.avatar = data.avatar;
                broadcastState();
            }
            break;
    }
}

/**
 * 玩家接收 ST 訊息
 * @param {Object} data - 訊息資料
 */
function handlePlayerMessage(data) {
    switch (data.type) {
        case 'state':
            state = data.payload;
            setConnectionStatus('connected');
            renderAll();
            break;

        case 'heartbeat':
            if (hostConn && hostConn.open) {
                hostConn.send({ 
                    type: 'heartbeat-ack', 
                    playerId: myPlayerId, 
                    timestamp: Date.now() 
                });
            }
            setConnectionStatus('connected');
            break;

        case 'heartbeat-ack':
            setConnectionStatus('connected');
            resetReconnectState();
            break;
    }
}

/**
 * ST 廣播狀態給所有玩家
 */
function broadcastState() {
    const message = { type: 'state', payload: state };
    for (const playerId in connections) {
        const conn = connections[playerId];
        if (conn && conn.open) {
            conn.send(message);
        }
    }
    renderAll();
}

/**
 * 玩家發送訊息給 ST
 * @param {Object} message - 訊息物件
 */
function sendToHost(message) {
    if (hostConn && hostConn.open) {
        hostConn.send(message);
    }
}

/**
 * 發送狀態（相容性函數）
 */
function sendState() {
    if (myRole === 'st') {
        broadcastState();
    }
}

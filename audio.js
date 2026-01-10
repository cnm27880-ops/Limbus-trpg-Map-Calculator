/**
 * Limbus Command - 背景音樂模組
 * 處理 BGM 播放、音量控制及同步功能
 */

// ===== 音樂狀態 =====
let bgmAudio = null;
let bgmVolume = 0.5;  // 本地音量 (0-1)
let bgmMuted = false;
let bgmInitialized = false;
let bgmUserInteracted = false;  // 用戶是否已互動（用於處理自動播放政策）
let bgmPendingPlay = null;  // 等待播放的 URL

// ===== 初始化 =====
/**
 * 初始化音樂播放器
 * 創建隱藏的 <audio> 元素
 */
function initAudio() {
    if (bgmInitialized) return;

    // 創建 audio 元素
    bgmAudio = document.createElement('audio');
    bgmAudio.id = 'bgm-audio';
    bgmAudio.loop = true;
    bgmAudio.preload = 'auto';
    bgmAudio.volume = bgmVolume;
    bgmAudio.style.display = 'none';
    document.body.appendChild(bgmAudio);

    // 監聽音頻事件
    bgmAudio.addEventListener('canplay', () => {
        console.log('BGM: 音頻已載入，準備播放');
    });

    bgmAudio.addEventListener('error', (e) => {
        console.error('BGM: 音頻載入失敗', e);
        showToast('音樂載入失敗，請檢查 URL');
    });

    bgmAudio.addEventListener('play', () => {
        updateMusicPlayerUI();
    });

    bgmAudio.addEventListener('pause', () => {
        updateMusicPlayerUI();
    });

    // 從 localStorage 載入音量設定
    const savedVolume = localStorage.getItem('limbus_bgm_volume');
    if (savedVolume !== null) {
        bgmVolume = parseFloat(savedVolume);
        bgmAudio.volume = bgmVolume;
    }

    // 設置用戶互動監聽（用於處理瀏覽器自動播放政策）
    setupAutoplayHandler();

    bgmInitialized = true;
    console.log('BGM: 音樂模組已初始化');
}

/**
 * 設置自動播放政策處理
 * 現代瀏覽器會阻止自動播放，需要用戶互動後才能播放
 */
function setupAutoplayHandler() {
    const handleInteraction = () => {
        if (!bgmUserInteracted) {
            bgmUserInteracted = true;
            console.log('BGM: 用戶已互動，可以播放音樂');

            // 如果有等待播放的音樂
            if (bgmPendingPlay) {
                playBGM(bgmPendingPlay, true);
                bgmPendingPlay = null;
            }
        }
    };

    // 監聽各種用戶互動事件
    ['click', 'touchstart', 'keydown'].forEach(event => {
        document.addEventListener(event, handleInteraction, { once: true, passive: true });
    });
}

// ===== 播放控制 =====
/**
 * 播放 BGM
 * @param {string} url - 音樂 URL
 * @param {boolean} force - 強制播放（忽略自動播放限制檢查）
 */
function playBGM(url, force = false) {
    if (!bgmAudio) initAudio();
    if (!url) return;

    // 如果用戶尚未互動且不是強制播放，儲存等待播放的 URL
    if (!bgmUserInteracted && !force) {
        bgmPendingPlay = url;
        showBGMInteractionPrompt();
        return;
    }

    // 如果 URL 相同且正在播放，不重複載入
    if (bgmAudio.src === url && !bgmAudio.paused) {
        return;
    }

    // 設置新的音源
    if (bgmAudio.src !== url) {
        bgmAudio.src = url;
    }

    // 播放
    const playPromise = bgmAudio.play();

    if (playPromise !== undefined) {
        playPromise.then(() => {
            console.log('BGM: 開始播放');
            updateMusicPlayerUI();
        }).catch(error => {
            console.warn('BGM: 自動播放被阻止', error);
            bgmPendingPlay = url;
            showBGMInteractionPrompt();
        });
    }
}

/**
 * 停止 BGM
 */
function stopBGM() {
    if (!bgmAudio) return;
    bgmAudio.pause();
    updateMusicPlayerUI();
}

/**
 * 暫停/繼續 BGM
 */
function toggleBGM() {
    if (!bgmAudio) return;

    if (bgmAudio.paused) {
        if (bgmAudio.src) {
            const playPromise = bgmAudio.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn('BGM: 播放失敗', error);
                    showBGMInteractionPrompt();
                });
            }
        }
    } else {
        bgmAudio.pause();
    }
    updateMusicPlayerUI();
}

/**
 * 設置音量
 * @param {number} val - 音量值 (0-1)
 */
function setVolume(val) {
    bgmVolume = Math.max(0, Math.min(1, val));
    if (bgmAudio) {
        bgmAudio.volume = bgmVolume;
    }
    // 儲存到 localStorage
    localStorage.setItem('limbus_bgm_volume', bgmVolume.toString());
    updateMusicPlayerUI();
}

/**
 * 切換靜音
 */
function toggleMute() {
    bgmMuted = !bgmMuted;
    if (bgmAudio) {
        bgmAudio.muted = bgmMuted;
    }
    updateMusicPlayerUI();
}

// ===== UI 更新 =====
/**
 * 顯示需要用戶互動的提示
 */
function showBGMInteractionPrompt() {
    showToast('請點擊頁面任意處以啟用音樂播放');
}

/**
 * 更新音樂播放器 UI
 */
function updateMusicPlayerUI() {
    const playBtn = document.getElementById('bgm-play-btn');
    const volumeSlider = document.getElementById('bgm-volume');
    const muteBtn = document.getElementById('bgm-mute-btn');
    const nowPlaying = document.getElementById('bgm-now-playing');

    if (playBtn) {
        playBtn.textContent = (bgmAudio && !bgmAudio.paused) ? '⏸' : '▶';
        playBtn.title = (bgmAudio && !bgmAudio.paused) ? '暫停' : '播放';
    }

    if (volumeSlider) {
        volumeSlider.value = bgmVolume * 100;
    }

    if (muteBtn) {
        muteBtn.textContent = bgmMuted ? '🔇' : '🔊';
        muteBtn.title = bgmMuted ? '取消靜音' : '靜音';
    }

    if (nowPlaying && bgmAudio) {
        // 顯示當前播放的音樂名稱
        const currentMusic = getMusicState();
        if (currentMusic && currentMusic.currentName) {
            nowPlaying.textContent = currentMusic.currentName;
        } else if (bgmAudio.src) {
            nowPlaying.textContent = '播放中...';
        } else {
            nowPlaying.textContent = '無音樂';
        }
    }
}

// ===== 播放清單管理 =====
/**
 * 取得當前音樂狀態（從本地 state 或 Firebase）
 * @returns {Object|null} 音樂狀態
 */
function getMusicState() {
    // 這會由 Firebase 監聽器更新
    return window.musicState || null;
}

/**
 * 切換到指定音樂
 * @param {string} url - 音樂 URL
 * @param {string} name - 音樂名稱
 */
function switchMusic(url, name) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以切換音樂');
        return;
    }

    // 更新 Firebase
    syncMusicState({
        currentUrl: url,
        currentName: name,
        isPlaying: true,
        timestamp: Date.now()
    });
}

/**
 * 新增音樂到播放清單
 * @param {string} name - 音樂名稱
 * @param {string} url - 音樂 URL
 */
function addToPlaylist(name, url) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以編輯播放清單');
        return;
    }

    if (!name || !url) {
        showToast('請輸入音樂名稱和 URL');
        return;
    }

    // 驗證 URL 格式
    try {
        new URL(url);
    } catch (e) {
        showToast('無效的 URL 格式');
        return;
    }

    // 取得現有播放清單
    const currentState = getMusicState() || {};
    const playlist = currentState.playlist || [];

    // 檢查是否已存在
    if (playlist.some(item => item.url === url)) {
        showToast('此音樂已在播放清單中');
        return;
    }

    // 新增到播放清單
    playlist.push({ name, url });

    // 同步到 Firebase
    syncMusicPlaylist(playlist);
    showToast(`已新增: ${name}`);

    // 清空輸入框
    const nameInput = document.getElementById('bgm-input-name');
    const urlInput = document.getElementById('bgm-input-url');
    if (nameInput) nameInput.value = '';
    if (urlInput) urlInput.value = '';

    // 重新渲染播放清單
    renderPlaylist();
}

/**
 * 從播放清單移除音樂
 * @param {number} index - 索引
 */
function removeFromPlaylist(index) {
    if (myRole !== 'st') {
        showToast('只有 ST 可以編輯播放清單');
        return;
    }

    const currentState = getMusicState() || {};
    const playlist = currentState.playlist || [];

    if (index >= 0 && index < playlist.length) {
        const removed = playlist.splice(index, 1)[0];
        syncMusicPlaylist(playlist);
        showToast(`已移除: ${removed.name}`);
        renderPlaylist();
    }
}

/**
 * 渲染播放清單
 */
function renderPlaylist() {
    const container = document.getElementById('bgm-playlist');
    if (!container) return;

    const currentState = getMusicState() || {};
    const playlist = currentState.playlist || [];

    if (playlist.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;text-align:center;padding:10px;">播放清單為空</div>';
        return;
    }

    container.innerHTML = playlist.map((item, index) => {
        const isPlaying = currentState.currentUrl === item.url && currentState.isPlaying;
        return `
            <div class="bgm-playlist-item ${isPlaying ? 'playing' : ''}" onclick="switchMusic('${escapeHtml(item.url)}', '${escapeHtml(item.name)}')">
                <span class="bgm-item-name">${isPlaying ? '▶ ' : ''}${escapeHtml(item.name)}</span>
                ${myRole === 'st' ? `<button class="bgm-item-remove" onclick="event.stopPropagation(); removeFromPlaylist(${index})" title="移除">×</button>` : ''}
            </div>
        `;
    }).join('');
}

// ===== Firebase 同步 =====
/**
 * 同步音樂狀態到 Firebase（由 firebase-connection.js 調用）
 * @param {Object} musicState - 音樂狀態
 */
function syncMusicState(musicState) {
    if (!roomRef) return;

    roomRef.child('music').update({
        currentUrl: musicState.currentUrl || '',
        currentName: musicState.currentName || '',
        isPlaying: musicState.isPlaying || false,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });
}

/**
 * 同步播放清單到 Firebase
 * @param {Array} playlist - 播放清單
 */
function syncMusicPlaylist(playlist) {
    if (!roomRef) return;
    roomRef.child('music/playlist').set(playlist);
}

/**
 * 處理從 Firebase 接收到的音樂狀態更新
 * @param {Object} musicData - 音樂數據
 */
function handleMusicUpdate(musicData) {
    if (!musicData) {
        window.musicState = null;
        stopBGM();
        renderPlaylist();
        updateMusicPlayerUI();
        return;
    }

    // 更新本地狀態
    window.musicState = musicData;

    // 同步播放狀態
    if (musicData.currentUrl) {
        if (musicData.isPlaying) {
            playBGM(musicData.currentUrl);
        } else {
            stopBGM();
        }
    }

    // 更新 UI
    renderPlaylist();
    updateMusicPlayerUI();
}

// ===== 音樂播放器面板控制 =====
let musicPlayerExpanded = false;

/**
 * 切換音樂播放器面板展開/收合
 */
function toggleMusicPlayer() {
    musicPlayerExpanded = !musicPlayerExpanded;
    const panel = document.getElementById('music-player-panel');
    const toggleBtn = document.getElementById('music-player-toggle');

    if (panel) {
        panel.classList.toggle('expanded', musicPlayerExpanded);
    }
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', musicPlayerExpanded);
    }
}

/**
 * ST 控制：播放/暫停音樂
 */
function stTogglePlayback() {
    if (myRole !== 'st') {
        // 玩家只能控制本地播放
        toggleBGM();
        return;
    }

    const currentState = getMusicState() || {};

    // 如果沒有選擇音樂，提示用戶
    if (!currentState.currentUrl) {
        showToast('請先選擇要播放的音樂');
        return;
    }

    // 切換播放狀態並同步
    syncMusicState({
        ...currentState,
        isPlaying: !currentState.isPlaying
    });
}

/**
 * ST 控制：停止音樂
 */
function stStopMusic() {
    if (myRole !== 'st') {
        showToast('只有 ST 可以停止音樂');
        return;
    }

    syncMusicState({
        currentUrl: '',
        currentName: '',
        isPlaying: false,
        timestamp: Date.now()
    });
}

console.log('BGM: 音樂模組已載入');

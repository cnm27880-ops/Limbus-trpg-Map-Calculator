/**
 * Limbus Command - 音樂管理器 (升級版)
 * 完整的背景音樂管理系統
 * 功能：雲端直連轉換、歌單自動儲存、淡入淡出播放
 */

// ===== 核心音樂管理器類別 =====
class MusicManager {
    constructor() {
        // 播放清單 (LocalStorage 為主)
        this.playlist = [];

        // 當前音樂物件
        this.currentAudio = null;

        // 音樂狀態
        this.volume = 0.5;
        this.muted = false;
        this.isPlaying = false;
        this.currentTrack = null; // { name, url }

        // 初始化標記
        this.initialized = false;
        this.userInteracted = false;
        this.pendingPlayUrl = null;

        // 淡入淡出設定
        this.fadeEnabled = true;
        this.fadeDuration = 1000; // 1秒
        this.fadeInterval = null;

        // LocalStorage 鍵名
        this.STORAGE_KEY = 'limbus_bgm_playlist';
        this.VOLUME_KEY = 'limbus_bgm_volume';
    }

    /**
     * 初始化音樂管理器
     */
    init() {
        if (this.initialized) return;

        // 創建 Audio 元素
        this.currentAudio = new Audio();
        this.currentAudio.id = 'bgm-audio';
        this.currentAudio.loop = true;
        this.currentAudio.preload = 'auto';
        this.currentAudio.volume = this.volume;

        // 監聽音頻事件
        this.currentAudio.addEventListener('canplay', () => {
            console.log('BGM: 音頻已載入，準備播放');
        });

        this.currentAudio.addEventListener('error', (e) => {
            console.error('BGM: 音頻載入失敗', e);
            showToast('音樂載入失敗，請檢查 URL');
        });

        this.currentAudio.addEventListener('play', () => {
            this.isPlaying = true;
            this.updateUI();
        });

        this.currentAudio.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updateUI();
        });

        // 從 LocalStorage 載入設定
        this.loadVolume();
        this.loadPlaylist();

        // 設置用戶互動監聽
        this.setupAutoplayHandler();

        this.initialized = true;
        console.log('BGM: 音樂管理器已初始化');
    }

    /**
     * 處理音樂 URL（雲端連結轉換）
     * @param {string} url - 原始 URL
     * @returns {string} 處理後的直連 URL
     */
    processAudioUrl(url) {
        if (!url) return '';

        // 移除首尾空白
        url = url.trim();

        // Dropbox 處理
        // 新舊格式都支援：
        //   舊: https://www.dropbox.com/s/FILE_ID/filename.mp3?dl=0
        //   新: https://www.dropbox.com/scl/fi/HASH/filename.mp3?rlkey=KEY&st=ABC&dl=0
        // 使用 raw=1 參數取得直接檔案內容（保留 rlkey 等必要參數）
        if (url.includes('dropbox.com/') || url.includes('dropboxusercontent.com/')) {
            try {
                const urlObj = new URL(url);
                // 將舊的 dl.dropboxusercontent.com 轉回 www.dropbox.com
                if (urlObj.hostname === 'dl.dropboxusercontent.com') {
                    urlObj.hostname = 'www.dropbox.com';
                }
                // 移除 dl 參數，加上 raw=1
                urlObj.searchParams.delete('dl');
                urlObj.searchParams.set('raw', '1');
                return urlObj.toString();
            } catch (e) {
                // URL 解析失敗，嘗試簡單替換
                return url.replace(/[?&]dl=\d/, '?raw=1');
            }
        }

        // Google Drive 處理
        // drive.google.com/uc?export=download 已失效，改用 drive.usercontent.google.com
        if (url.includes('drive.google.com/')) {
            // 提取文件 ID
            let fileId = null;

            // 格式1: /file/d/{ID}/view
            const match1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (match1) {
                fileId = match1[1];
            }

            // 格式2: id={ID}
            const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
            if (match2) {
                fileId = match2[1];
            }

            if (fileId) {
                return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
            }
        }

        // 一般連結保持原樣
        return url;
    }

    /**
     * 播放音樂（支援淡入效果）
     * @param {string} url - 音樂 URL
     * @param {string} name - 音樂名稱（選填）
     * @param {boolean} force - 強制播放
     */
    async playMusic(url, name = null, force = false) {
        if (!this.initialized) this.init();
        if (!url) return;

        // 處理 URL（雲端轉換）
        const processedUrl = this.processAudioUrl(url);

        // 檢查用戶互動
        if (!this.userInteracted && !force) {
            this.pendingPlayUrl = processedUrl;
            this.pendingPlayName = name;
            this.showInteractionPrompt();
            return;
        }

        // 如果正在播放相同 URL，不重複載入
        if (this.currentAudio.src === processedUrl && !this.currentAudio.paused) {
            return;
        }

        // 停止當前播放（帶淡出）
        if (!this.currentAudio.paused && this.fadeEnabled) {
            await this.fadeOut();
        } else {
            this.currentAudio.pause();
        }

        // 設置新音源
        this.currentAudio.src = processedUrl;
        this.currentTrack = {
            name: name || this.extractNameFromUrl(processedUrl),
            url: processedUrl
        };

        // 開始播放
        try {
            // 如果啟用淡入，從 0 音量開始
            if (this.fadeEnabled) {
                this.currentAudio.volume = 0;
            }

            await this.currentAudio.play();
            console.log('BGM: 開始播放', this.currentTrack.name);

            // 淡入效果
            if (this.fadeEnabled) {
                await this.fadeIn();
            }

            this.updateUI();
        } catch (error) {
            console.warn('BGM: 正常播放被阻擋，嘗試靜音播放', error);

            // 瀏覽器 autoplay 政策阻擋了有聲播放
            // 靜音播放通常被允許（不需要使用者互動）
            // 這樣音訊實際在跑（可供歌詞同步使用 currentTime），使用者點擊後才取消靜音
            try {
                this.currentAudio.muted = true;
                this.currentAudio.volume = this.volume;
                await this.currentAudio.play();
                console.log('BGM: 靜音播放成功，等待用戶互動後取消靜音');
                // 標記為已互動+已解鎖，防止 setupAutoplayHandler 的 _unlockAudio
                // 破壞正在靜音播放的音訊（_unlockAudio 會更改 audio.src）
                this.userInteracted = true;
                this._audioUnlocked = true;
                this.updateUI();
                this._setupUnmuteOnInteraction();
            } catch (mutedError) {
                // 連靜音都無法播放（極罕見情境）
                console.warn('BGM: 靜音播放也失敗，等待用戶互動', mutedError);
                this.currentAudio.muted = false;
                this.pendingPlayUrl = processedUrl;
                this.pendingPlayName = name;
                this._setupRetryOnInteraction();
            }
        }
    }

    /**
     * 停止音樂播放（重置到開頭，清除曲目資訊）
     */
    stopMusic() {
        if (!this.currentAudio) return;

        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentTrack = null;
        this.isPlaying = false;
        this.updateUI();
    }

    /**
     * 暫停音樂（保留播放位置和曲目資訊）
     */
    pauseMusic() {
        if (!this.currentAudio || this.currentAudio.paused) return;

        this.currentAudio.pause();
        // 不重置 currentTime 和 currentTrack，只暫停
        this.updateUI();
    }

    /**
     * 繼續播放音樂
     */
    resumeMusic() {
        if (!this.currentAudio || !this.currentAudio.src) return;

        this.currentAudio.play().catch(error => {
            console.warn('BGM: 播放失敗', error);
            this.showInteractionPrompt();
        });
    }

    /**
     * 暫停/繼續播放
     */
    togglePlayback() {
        if (!this.currentAudio || !this.currentAudio.src) return;

        if (this.currentAudio.paused) {
            this.resumeMusic();
        } else {
            this.pauseMusic();
        }
    }

    /**
     * 設置音量
     * @param {number} value - 音量值 (0-1)
     */
    setVolume(value) {
        this.volume = Math.max(0, Math.min(1, value));
        if (this.currentAudio) {
            this.currentAudio.volume = this.volume;
        }
        // 儲存到 LocalStorage
        localStorage.setItem(this.VOLUME_KEY, this.volume.toString());
        this.updateUI();
    }

    /**
     * 切換靜音
     */
    toggleMute() {
        this.muted = !this.muted;
        if (this.currentAudio) {
            this.currentAudio.muted = this.muted;
        }
        this.updateUI();
    }

    /**
     * 淡入效果
     */
    fadeIn() {
        return new Promise((resolve) => {
            if (!this.fadeEnabled || !this.currentAudio) {
                resolve();
                return;
            }

            const startVolume = 0;
            const endVolume = this.volume;
            const steps = 20;
            const stepDuration = this.fadeDuration / steps;
            const volumeStep = (endVolume - startVolume) / steps;

            let currentStep = 0;
            this.currentAudio.volume = startVolume;

            this.fadeInterval = setInterval(() => {
                currentStep++;
                const newVolume = startVolume + (volumeStep * currentStep);
                this.currentAudio.volume = Math.min(newVolume, endVolume);

                if (currentStep >= steps) {
                    clearInterval(this.fadeInterval);
                    this.fadeInterval = null;
                    resolve();
                }
            }, stepDuration);
        });
    }

    /**
     * 淡出效果
     */
    fadeOut() {
        return new Promise((resolve) => {
            if (!this.fadeEnabled || !this.currentAudio) {
                resolve();
                return;
            }

            const startVolume = this.currentAudio.volume;
            const steps = 20;
            const stepDuration = this.fadeDuration / steps;
            const volumeStep = startVolume / steps;

            let currentStep = 0;

            this.fadeInterval = setInterval(() => {
                currentStep++;
                const newVolume = startVolume - (volumeStep * currentStep);
                this.currentAudio.volume = Math.max(newVolume, 0);

                if (currentStep >= steps) {
                    clearInterval(this.fadeInterval);
                    this.fadeInterval = null;
                    resolve();
                }
            }, stepDuration);
        });
    }

    /**
     * 新增音樂到播放清單
     * @param {string} name - 音樂名稱
     * @param {string} url - 音樂 URL
     */
    addToPlaylist(name, url) {
        // 防呆：URL 為空則不執行
        if (!url || url.trim() === '') {
            showToast('請輸入音樂 URL');
            return false;
        }

        // 處理 URL
        const processedUrl = this.processAudioUrl(url);

        // 防呆：Name 為空則使用 URL 後段
        if (!name || name.trim() === '') {
            name = this.extractNameFromUrl(processedUrl);
        }

        // 檢查是否已存在
        if (this.playlist.some(item => item.url === processedUrl)) {
            showToast('此音樂已在播放清單中');
            return false;
        }

        // 新增到播放清單
        this.playlist.push({ name, url: processedUrl });

        // 儲存到 LocalStorage
        this.savePlaylist();

        showToast(`已新增: ${name}`);
        this.renderPlaylist();

        return true;
    }

    /**
     * 從播放清單移除音樂
     * @param {number} index - 索引
     */
    removeFromPlaylist(index) {
        if (index >= 0 && index < this.playlist.length) {
            const removed = this.playlist.splice(index, 1)[0];

            // 儲存到 LocalStorage
            this.savePlaylist();

            showToast(`已移除: ${removed.name}`);
            this.renderPlaylist();
        }
    }

    /**
     * 儲存播放清單到 LocalStorage
     */
    savePlaylist() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.playlist));
            console.log('BGM: 播放清單已儲存', this.playlist.length, '首');
        } catch (e) {
            console.error('BGM: 儲存播放清單失敗', e);
        }
    }

    /**
     * 從 LocalStorage 載入播放清單
     */
    loadPlaylist() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                this.playlist = JSON.parse(stored);
                console.log('BGM: 已載入播放清單', this.playlist.length, '首');
                this.renderPlaylist();
            }
        } catch (e) {
            console.error('BGM: 載入播放清單失敗', e);
            this.playlist = [];
        }
    }

    /**
     * 載入音量設定
     */
    loadVolume() {
        try {
            const saved = localStorage.getItem(this.VOLUME_KEY);
            if (saved !== null) {
                this.volume = parseFloat(saved);
                if (this.currentAudio) {
                    this.currentAudio.volume = this.volume;
                }
            }
        } catch (e) {
            console.error('BGM: 載入音量失敗', e);
        }
    }

    /**
     * 從 URL 提取檔案名稱
     * @param {string} url - URL
     * @returns {string} 檔案名稱
     */
    extractNameFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const segments = pathname.split('/');
            const filename = segments[segments.length - 1];

            // 移除副檔名
            return filename.replace(/\.[^/.]+$/, '') || 'Unknown Track';
        } catch (e) {
            return 'Unknown Track';
        }
    }

    /**
     * 渲染播放清單到 UI
     */
    renderPlaylist() {
        const container = document.getElementById('bgm-playlist');
        if (!container) return;

        if (this.playlist.length === 0) {
            container.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;text-align:center;padding:10px;">播放清單為空</div>';
            return;
        }

        container.innerHTML = this.playlist.map((item, index) => {
            const isPlaying = this.currentTrack && this.currentTrack.url === item.url && this.isPlaying;
            return `
                <div class="bgm-playlist-item ${isPlaying ? 'playing' : ''}" onclick="switchMusic('${this.escapeHtml(item.url)}', '${this.escapeHtml(item.name)}')">
                    <span class="bgm-item-name">${isPlaying ? '▶ ' : ''}${this.escapeHtml(item.name)}</span>
                    ${myRole === 'st' ? `<button class="bgm-item-remove" onclick="event.stopPropagation(); musicManager.removeFromPlaylist(${index})" title="移除">×</button>` : ''}
                </div>
            `;
        }).join('');
    }

    /**
     * 更新 UI 元素
     */
    updateUI() {
        const playBtn = document.getElementById('bgm-play-btn');
        const volumeSlider = document.getElementById('bgm-volume');
        const muteBtn = document.getElementById('bgm-mute-btn');
        const nowPlaying = document.getElementById('bgm-now-playing');

        if (playBtn) {
            playBtn.textContent = this.isPlaying ? '⏸' : '▶';
            playBtn.title = this.isPlaying ? '暫停' : '播放';
        }

        if (volumeSlider) {
            volumeSlider.value = this.volume * 100;
        }

        if (muteBtn) {
            muteBtn.textContent = this.muted ? '🔇' : '🔊';
            muteBtn.title = this.muted ? '取消靜音' : '靜音';
        }

        if (nowPlaying) {
            if (this.currentTrack) {
                nowPlaying.textContent = this.currentTrack.name;
            } else if (this.currentAudio && this.currentAudio.src) {
                nowPlaying.textContent = '播放中...';
            } else {
                nowPlaying.textContent = '無音樂';
            }
        }

        // 更新播放清單樣式
        this.renderPlaylist();
    }

    /**
     * 設置自動播放政策處理
     * 在行動裝置上，必須在使用者手勢事件中「解鎖」音頻元素，
     * 否則後續由 Firebase 回調觸發的 audio.play() 會被瀏覽器阻擋。
     */
    setupAutoplayHandler() {
        const handleInteraction = () => {
            if (!this.userInteracted) {
                this.userInteracted = true;
                console.log('BGM: 用戶已互動，解鎖音頻播放');

                // 解鎖音頻元素：在使用者手勢中播放靜音音頻
                // 這讓後續程式化呼叫 play() 不再被瀏覽器阻擋
                this._unlockAudio();

                // 如果有等待播放的音樂
                if (this.pendingPlayUrl) {
                    this.playMusic(this.pendingPlayUrl, this.pendingPlayName, true);
                    this.pendingPlayUrl = null;
                    this.pendingPlayName = null;
                }
            }
        };

        // 監聽各種用戶互動事件（不使用 once，確保多次互動都能觸發解鎖）
        ['click', 'touchstart', 'keydown'].forEach(event => {
            document.addEventListener(event, handleInteraction, { passive: true });
        });
    }

    /**
     * 解鎖音頻元素（行動裝置必要）
     * 在使用者手勢上下文中播放一段極短的靜音音頻，
     * 讓瀏覽器將此 Audio 元素標記為「已被用戶啟動」。
     */
    _unlockAudio() {
        if (this._audioUnlocked) return;

        const audio = this.currentAudio;
        if (!audio) return;

        // 記住原始狀態
        const origSrc = audio.src;
        const origMuted = audio.muted;

        // 播放極短的靜音 WAV（44 bytes）來解鎖音頻元素
        const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        audio.muted = true;
        audio.src = silentWav;

        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                audio.pause();
                audio.muted = origMuted;
                audio.currentTime = 0;
                // 恢復原始來源（如果有的話）
                if (origSrc && origSrc !== silentWav) {
                    audio.src = origSrc;
                } else {
                    audio.removeAttribute('src');
                }
                this._audioUnlocked = true;
                console.log('BGM: 音頻元素已解鎖（行動裝置）');
            }).catch(() => {
                // 解鎖失敗，恢復原始狀態
                audio.muted = origMuted;
                if (origSrc) audio.src = origSrc;
                console.warn('BGM: 音頻解鎖失敗，將在下次互動重試');
            });
        }

        // 同時嘗試解鎖 AudioContext（部分瀏覽器需要）
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                const ctx = new AudioCtx();
                ctx.resume().then(() => ctx.close()).catch(() => {});
            }
        } catch (e) {
            // AudioContext 不可用，忽略
        }
    }

    /**
     * 顯示需要用戶互動的提示
     */
    showInteractionPrompt() {
        showToast('請點擊頁面任意處以啟用音樂播放');
    }

    /**
     * 行動裝置：在下次使用者互動時重試播放
     * 當 play() 因為不在使用者手勢上下文而失敗時使用
     */
    _setupRetryOnInteraction() {
        if (this._retryListenerActive) return;
        this._retryListenerActive = true;

        const retryPlay = () => {
            this._retryListenerActive = false;

            // 先嘗試解鎖
            this._unlockAudio();

            // 重試播放等待中的音樂
            if (this.pendingPlayUrl) {
                const url = this.pendingPlayUrl;
                const name = this.pendingPlayName;
                this.pendingPlayUrl = null;
                this.pendingPlayName = null;

                // 短暫延遲讓解鎖完成
                setTimeout(() => {
                    this.playMusic(url, name, true);
                }, 100);
            }

            // 移除監聽器
            ['click', 'touchstart'].forEach(event => {
                document.removeEventListener(event, retryPlay);
            });
        };

        ['click', 'touchstart'].forEach(event => {
            document.addEventListener(event, retryPlay, { once: true, passive: true });
        });

        this.showInteractionPrompt();
    }

    /**
     * 設置使用者互動後取消靜音
     * 當瀏覽器因 autoplay 政策阻擋有聲播放時，
     * 先以靜音模式播放，等使用者首次互動後自動取消靜音
     */
    _setupUnmuteOnInteraction() {
        if (this._unmuteListenerActive) return;
        this._unmuteListenerActive = true;

        const self = this;
        const unmute = (e) => {
            // 如果點擊的是靜音按鈕，讓 toggleMute 自己處理，不做自動取消靜音
            const muteBtn = document.getElementById('bgm-mute-btn');
            if (muteBtn && e && e.target && (e.target === muteBtn || muteBtn.contains(e.target))) {
                return; // 不消費事件，讓 toggleMute 正常處理
            }

            self._unmuteListenerActive = false;
            if (self.currentAudio && !self.currentAudio.paused) {
                self.currentAudio.muted = false;
                self.muted = false;
                self.currentAudio.volume = self.volume;
                console.log('BGM: 用戶互動，已取消靜音');
                self.updateUI();
            }
            ['click', 'touchstart', 'keydown'].forEach(ev =>
                document.removeEventListener(ev, unmute)
            );
        };

        ['click', 'touchstart', 'keydown'].forEach(e =>
            document.addEventListener(e, unmute, { passive: true })
        );

        if (typeof showToast === 'function') {
            showToast('點擊頁面任意處以開啟音樂聲音');
        }
    }

    /**
     * HTML 轉義（防 XSS）- 使用全域 escapeHtml 函數
     * @param {string} text - 原始文字
     * @returns {string} 轉義後的文字
     */
    escapeHtml(text) {
        return typeof window.escapeHtml === 'function' ? window.escapeHtml(text) : String(text || '');
    }

    /**
     * 取得當前狀態（用於 Firebase 同步）
     */
    getState() {
        return {
            currentUrl: this.currentTrack ? this.currentTrack.url : '',
            currentName: this.currentTrack ? this.currentTrack.name : '',
            isPlaying: this.isPlaying,
            playbackTime: this.currentAudio ? this.currentAudio.currentTime : 0,
            playlist: this.playlist
        };
    }

    /**
     * 從外部設置狀態（用於 Firebase 同步）
     */
    setState(state) {
        if (!state) return;

        // 更新播放清單
        if (state.playlist && Array.isArray(state.playlist)) {
            this.playlist = state.playlist;
            this.savePlaylist();
            this.renderPlaylist();
        }

        // 更新播放狀態
        if (state.currentUrl) {
            if (state.isPlaying) {
                // 計算補償時間：考慮網路延遲，讓玩家端同步到 ST 的實際播放進度
                let targetTime = 0;
                if (state.playbackTime !== undefined && state.timestamp) {
                    const offset = (Date.now() - state.timestamp) / 1000;
                    targetTime = state.playbackTime + offset;
                }

                // 使用 force=true，因為這是 ST 同步過來的明確指令
                const processedUrl = this.processAudioUrl(state.currentUrl);
                const isSameTrack = this.currentAudio && this.currentAudio.src === processedUrl;

                // 對循環音樂做 duration 取模，避免 targetTime 超出範圍
                const applyModulo = (audio, time) => {
                    if (time > 0 && audio && audio.duration && isFinite(audio.duration) && time > audio.duration) {
                        return time % audio.duration;
                    }
                    return time;
                };

                if (isSameTrack && !this.currentAudio.paused) {
                    // 同一首歌已在播放，僅校正進度
                    if (targetTime > 0) {
                        this.currentAudio.currentTime = applyModulo(this.currentAudio, targetTime);
                    }
                } else {
                    // 播放新歌曲或從暫停恢復
                    this.playMusic(state.currentUrl, state.currentName, true).then(() => {
                        if (targetTime > 0 && this.currentAudio) {
                            this.currentAudio.currentTime = applyModulo(this.currentAudio, targetTime);
                        }
                    });
                }
            } else {
                // 有 URL 但 isPlaying 為 false = 暫停（保留播放位置）
                // 同步暫停位置
                if (state.playbackTime !== undefined && this.currentAudio) {
                    this.currentAudio.currentTime = state.playbackTime;
                }
                this.pauseMusic();
            }
        } else {
            // 沒有 URL = 完全停止
            this.stopMusic();
        }
    }
}

// ===== 全域實例 =====
const musicManager = new MusicManager();

// ===== 向後兼容的全域函數 =====
/**
 * 初始化音樂播放器（向後兼容）
 */
function initAudio() {
    musicManager.init();
}

/**
 * 播放 BGM（向後兼容）
 * @param {string} url - 音樂 URL
 * @param {boolean} force - 強制播放
 */
function playBGM(url, force = false) {
    musicManager.playMusic(url, null, force);
}

/**
 * 停止 BGM（向後兼容）
 */
function stopBGM() {
    musicManager.stopMusic();
}

/**
 * 暫停/繼續 BGM（向後兼容）
 */
function toggleBGM() {
    musicManager.togglePlayback();
}

/**
 * 設置音量（向後兼容）
 * @param {number} val - 音量值 (0-1)
 */
function setVolume(val) {
    musicManager.setVolume(val);
}

/**
 * 切換靜音（向後兼容）
 */
function toggleMute() {
    musicManager.toggleMute();
}

/**
 * 更新音樂播放器 UI（向後兼容）
 */
function updateMusicPlayerUI() {
    musicManager.updateUI();
}

/**
 * 新增音樂到播放清單
 * @param {string} name - 音樂名稱
 * @param {string} url - 音樂 URL
 */
function addToPlaylist(name, url) {
    // 權限檢查（如果需要）
    if (typeof myRole !== 'undefined' && myRole !== 'st') {
        showToast('只有 ST 可以編輯播放清單');
        return;
    }

    // 呼叫管理器新增
    if (musicManager.addToPlaylist(name, url)) {
        // 清空輸入框
        const nameInput = document.getElementById('bgm-input-name');
        const urlInput = document.getElementById('bgm-input-url');
        if (nameInput) nameInput.value = '';
        if (urlInput) urlInput.value = '';
    }
}

/**
 * 從播放清單移除音樂
 * @param {number} index - 索引
 */
function removeFromPlaylist(index) {
    // 權限檢查（如果需要）
    if (typeof myRole !== 'undefined' && myRole !== 'st') {
        showToast('只有 ST 可以編輯播放清單');
        return;
    }

    musicManager.removeFromPlaylist(index);
}

/**
 * 渲染播放清單
 */
function renderPlaylist() {
    musicManager.renderPlaylist();
}

/**
 * 切換音樂（向後兼容）
 * @param {string} url - 音樂 URL
 * @param {string} name - 音樂名稱
 */
function switchMusic(url, name) {
    // 播放音樂（本地端立即播放）
    musicManager.playMusic(url, name);

    // ST 模式：同步到 Firebase（讓所有玩家也聽到）
    if (typeof myRole !== 'undefined' && myRole === 'st' && typeof syncMusicState === 'function') {
        syncMusicState({
            currentUrl: url,
            currentName: name,
            isPlaying: true,
            playbackTime: 0,
            timestamp: Date.now()
        });

    }
}

/**
 * ST 控制：播放/暫停音樂（向後兼容）
 */
function stTogglePlayback() {
    const state = musicManager.getState();

    if (!state.currentUrl) {
        showToast('請先選擇要播放的音樂');
        return;
    }

    // 先在本地切換暫停/播放
    musicManager.togglePlayback();

    // ST 模式：同步到 Firebase（含播放進度供玩家端同步）
    if (typeof myRole !== 'undefined' && myRole === 'st' && typeof syncMusicState === 'function') {
        syncMusicState({
            currentUrl: state.currentUrl,
            currentName: state.currentName,
            isPlaying: !state.isPlaying,
            playbackTime: musicManager.currentAudio ? musicManager.currentAudio.currentTime : 0,
            timestamp: Date.now()
        });
    }
}

/**
 * ST 控制：停止音樂（向後兼容）
 */
function stStopMusic() {
    // ST 模式：本地停止 + 同步到 Firebase
    if (typeof myRole !== 'undefined' && myRole === 'st' && typeof syncMusicState === 'function') {
        musicManager.stopMusic();
        syncMusicState({
            currentUrl: '',
            currentName: '',
            isPlaying: false,
            playbackTime: 0,
            timestamp: Date.now()
        });

    } else {
        showToast('只有 ST 可以停止音樂');
    }
}

/**
 * 停止音樂：ST 模式走同步，非 ST 模式本地停止
 */
function handleStopMusic() {
    if (typeof myRole !== 'undefined' && myRole === 'st' && typeof syncMusicState === 'function') {
        stStopMusic();
    } else {
        musicManager.stopMusic();
    }
}

/**
 * 切換音樂播放器面板
 */
function toggleMusicPlayer() {
    toggleMusicPanel();
}

/**
 * 切換音樂面板
 */
function toggleMusicPanel() {
    const panel = document.getElementById('music-player-panel');
    const musicBtn = document.getElementById('qab-music-btn');

    if (!panel) return;

    const isExpanded = panel.classList.contains('expanded');

    if (!isExpanded) {
        panel.classList.add('expanded');
        if (musicBtn) musicBtn.classList.add('active');

        // 關閉其他面板
        const hotkeyPanel = document.getElementById('hotkey-help');
        if (hotkeyPanel && !hotkeyPanel.classList.contains('hidden')) {
            hotkeyPanel.classList.add('hidden');
        }
    } else {
        panel.classList.remove('expanded');
        if (musicBtn) musicBtn.classList.remove('active');
    }
}

// ===== Firebase 同步功能（向後兼容）=====
/**
 * 取得當前音樂狀態
 * @returns {Object|null} 音樂狀態
 */
function getMusicState() {
    return musicManager.getState();
}

/**
 * 同步音樂狀態到 Firebase
 * @param {Object} musicState - 音樂狀態
 */
function syncMusicState(musicState) {
    if (typeof roomRef === 'undefined' || !roomRef) return;

    roomRef.child('music').update({
        currentUrl: musicState.currentUrl || '',
        currentName: musicState.currentName || '',
        isPlaying: musicState.isPlaying || false,
        playbackTime: musicState.playbackTime || 0,
        timestamp: musicState.timestamp || Date.now()
    });
}

/**
 * 同步播放清單到 Firebase
 * @param {Array} playlist - 播放清單
 */
function syncMusicPlaylist(playlist) {
    if (typeof roomRef === 'undefined' || !roomRef) return;
    roomRef.child('music/playlist').set(playlist);
}

/**
 * 處理從 Firebase 接收到的音樂狀態更新
 * @param {Object} musicData - 音樂數據
 */
function handleMusicUpdate(musicData) {
    if (!musicData) {
        // ST 自己不需要接收同步（已經在本地操作）
        if (typeof myRole !== 'undefined' && myRole === 'st') return;
        musicManager.stopMusic();
        return;
    }

    // ST 自己不需要接收同步（已經在本地播放/暫停/停止）
    if (typeof myRole !== 'undefined' && myRole === 'st') return;

    // 更新本地狀態
    window.musicState = musicData;

    // 應用狀態（玩家端）
    musicManager.setState(musicData);
}

// ===== 初始化 =====
// 頁面載入時自動初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        musicManager.init();
    });
} else {
    musicManager.init();
}

console.log('BGM: 音樂管理器已載入 (升級版)');

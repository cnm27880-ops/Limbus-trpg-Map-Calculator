/**
 * Limbus Command - 雙欄循環式動態歌詞系統
 * 在 battle-map 兩側的黑邊區域顯示歌詞，以打字機效果逐字浮現
 * 支援左右欄循環、FIFO 淡出佇列、動態空間偵測
 */

// ===== 歌詞系統常數 =====
const LYRICS_MAX_VISIBLE_LINES = 3;     // 最大同時顯示行數
const LYRICS_TOTAL_SLOTS = 10;          // 每側的 Slot 數量
const LYRICS_SLOT_START_PCT = 10;       // 起始高度百分比
const LYRICS_SLOT_END_PCT = 90;         // 結束高度百分比
const LYRICS_FADE_DURATION_MS = 2000;   // 淡出動畫時長 (ms)
const LYRICS_LINE_PAUSE_MS = 600;       // 每行結束後的停頓 (ms)
const LYRICS_DEFAULT_SPEED = 80;        // 預設打字速度 (ms/字)

// ===== 歌詞系統狀態 =====
let lyricsActive = false;               // 歌詞是否正在播放
let lyricsAbortController = null;       // 用於中斷播放的控制器
let lyricsActiveLines = [];             // 目前畫面上的歌詞行 (FIFO 佇列)
let lyricsCurrentSlot = 0;              // 目前要寫入的 Slot 索引 (0-19 循環)

// ===== Tap Tempo 狀態 =====
let tapTimes = [];                      // 紀錄點擊時間戳記
let detectedCharDelay = null;           // 計算出來的最佳延遲時間 (ms/字)

// ===== 速度預設組 =====
let speedPresets = { 1: 80, 2: 80 };   // 預設速度 (ms)
let activePreset = 1;                   // 目前啟用的預設組
let lyricsLiveSpeed = null;             // 播放中即時生效的速度 (ms/字)

// ===== 空間偵測 =====

/**
 * 計算 battle-map 在視窗中的位置與兩側黑邊中心點
 * @returns {{ leftCenterX: number, rightCenterX: number, mapRect: DOMRect } | null}
 */
function detectMargins() {
    const battleMap = document.getElementById('battle-map');
    const viewport = document.getElementById('map-viewport');
    if (!battleMap || !viewport) return null;

    const mapRect = battleMap.getBoundingClientRect();
    const viewRect = viewport.getBoundingClientRect();

    // 左側黑邊中心 X = viewport 左邊緣到 map 左邊緣的中點
    const leftEdge = viewRect.left;
    const mapLeftEdge = mapRect.left;
    const leftCenterX = (leftEdge + mapLeftEdge) / 2;

    // 右側黑邊中心 X = map 右邊緣到 viewport 右邊緣的中點
    const mapRightEdge = mapRect.right;
    const rightEdge = viewRect.right;
    const rightCenterX = (mapRightEdge + rightEdge) / 2;

    // 計算左右邊距寬度，用於判斷是否有足夠空間
    const leftMarginWidth = mapLeftEdge - leftEdge;
    const rightMarginWidth = rightEdge - mapRightEdge;

    return {
        leftCenterX,
        rightCenterX,
        leftMarginWidth,
        rightMarginWidth,
        viewRect
    };
}

// ===== Slot 系統 =====

/**
 * 計算指定 Slot 的 Y 座標 (百分比 -> px)
 * @param {number} slotIndex - 0-9 的 Slot 索引 (每側內部)
 * @returns {number} 相對於視窗的 Y 座標百分比
 */
function getSlotYPercent(slotIndex) {
    const range = LYRICS_SLOT_END_PCT - LYRICS_SLOT_START_PCT;
    const step = range / (LYRICS_TOTAL_SLOTS - 1);
    return LYRICS_SLOT_START_PCT + step * slotIndex;
}

/**
 * 根據全域 Slot 索引 (0-19) 決定是左欄還是右欄，以及區域內的行號
 * @param {number} globalSlot - 0-19 的全域 Slot 索引
 * @returns {{ side: 'left' | 'right', localSlot: number }}
 */
function resolveSlot(globalSlot) {
    const normalized = globalSlot % (LYRICS_TOTAL_SLOTS * 2);
    if (normalized < LYRICS_TOTAL_SLOTS) {
        return { side: 'left', localSlot: normalized };
    } else {
        return { side: 'right', localSlot: normalized - LYRICS_TOTAL_SLOTS };
    }
}

// ===== 淡出佇列管理 =====

/**
 * 將歌詞行加入畫面，若超過上限則淡出最早的行
 * @param {HTMLElement} lineEl - 歌詞行 DOM 元素
 */
function enqueueLyricsLine(lineEl) {
    lyricsActiveLines.push(lineEl);

    // 如果超過最大顯示行數，淡出最早的一行
    while (lyricsActiveLines.length > LYRICS_MAX_VISIBLE_LINES) {
        const oldest = lyricsActiveLines.shift();
        fadeOutLyricsLine(oldest);
    }
}

/**
 * 對指定歌詞行套用淡出效果，動畫結束後從 DOM 移除
 * @param {HTMLElement} lineEl - 要淡出的歌詞行元素
 */
function fadeOutLyricsLine(lineEl) {
    if (!lineEl) return;

    lineEl.classList.add('fading-out');

    // 動畫結束後從 DOM 移除
    setTimeout(() => {
        if (lineEl.parentNode) {
            lineEl.parentNode.removeChild(lineEl);
        }
    }, LYRICS_FADE_DURATION_MS);
}

// ===== 歌詞行建立 =====

/**
 * 建立一行歌詞的容器元素並定位
 * @param {string} side - 'left' 或 'right'
 * @param {number} localSlot - 區域內 Slot 索引 (0-9)
 * @returns {HTMLElement} 歌詞行容器
 */
function createLyricsLineElement(side, localSlot) {
    const margins = detectMargins();
    if (!margins) return null;

    const line = document.createElement('div');
    line.className = 'resonance-line';

    // 計算 Y 位置
    const yPercent = getSlotYPercent(localSlot);

    // 計算 X 位置
    let centerX;
    if (side === 'left') {
        centerX = margins.leftCenterX;
    } else {
        centerX = margins.rightCenterX;
    }

    // 定位 (使用 fixed positioning，在整個視窗上方)
    line.style.position = 'fixed';
    line.style.left = centerX + 'px';
    line.style.top = yPercent + 'vh';
    line.style.transform = 'translate(-50%, -50%)';
    line.style.zIndex = '500';

    document.body.appendChild(line);
    return line;
}

// ===== 打字機效果 =====

/**
 * 以打字機效果逐字顯示一行歌詞
 * @param {HTMLElement} lineEl - 歌詞行容器
 * @param {string} text - 歌詞文字
 * @param {number} charIntervalMs - 每個字的間隔 (ms)
 * @param {AbortSignal} signal - 用於中斷的信號
 * @returns {Promise<void>}
 */
function typewriterLine(lineEl, text, charIntervalMs, signal) {
    return new Promise((resolve, reject) => {
        let i = 0;
        const chars = Array.from(text); // 支援 Unicode 字符

        function typeNext() {
            if (signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }

            if (i >= chars.length) {
                resolve();
                return;
            }

            const charSpan = document.createElement('span');
            charSpan.className = 'resonance-char';
            charSpan.textContent = chars[i];
            lineEl.appendChild(charSpan);

            i++;
            // 即時讀取 lyricsLiveSpeed，支援播放中切換速度
            const currentDelay = (lyricsLiveSpeed !== null) ? lyricsLiveSpeed : charIntervalMs;
            setTimeout(typeNext, currentDelay);
        }

        typeNext();
    });
}

// ===== 主要播放函式 =====

/**
 * 播放歌詞
 * @param {string[]} lines - 歌詞陣列，每個元素為一行歌詞文字
 * @param {Object} [options] - 設定選項
 * @param {number} [options.speed=80] - 每個字的出現間隔 (ms)
 * @param {number} [options.linePause=600] - 每行結束後的停頓 (ms)
 * @param {boolean} [options.loop=false] - 是否循環播放
 */
async function playLyrics(lines, options = {}) {
    // 如果已在播放，先停止
    if (lyricsActive) {
        stopLyrics();
        // 等待清理完成
        await new Promise(r => setTimeout(r, 100));
    }

    if (!lines || lines.length === 0) return;

    const speed = options.speed || LYRICS_DEFAULT_SPEED;
    const linePause = options.linePause || LYRICS_LINE_PAUSE_MS;
    const loop = options.loop || false;

    // 初始化狀態
    lyricsActive = true;
    lyricsAbortController = new AbortController();
    lyricsActiveLines = [];
    lyricsCurrentSlot = 0;

    const signal = lyricsAbortController.signal;

    try {
        do {
            for (let i = 0; i < lines.length; i++) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

                const text = lines[i];
                if (!text || text.trim() === '') {
                    // 空行：僅推進 Slot，加短暫停頓
                    lyricsCurrentSlot++;
                    await delay(linePause, signal);
                    continue;
                }

                // 決定當前行的位置
                const { side, localSlot } = resolveSlot(lyricsCurrentSlot);

                // 建立歌詞行 DOM
                const lineEl = createLyricsLineElement(side, localSlot);
                if (!lineEl) {
                    lyricsCurrentSlot++;
                    continue;
                }

                // 加入佇列 (自動淡出超量行)
                enqueueLyricsLine(lineEl);

                // 打字機逐字顯示
                await typewriterLine(lineEl, text, speed, signal);

                // 行間停頓
                await delay(linePause, signal);

                // 推進 Slot
                lyricsCurrentSlot++;
            }
        } while (loop && !signal.aborted);
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('Lyrics: 播放錯誤', e);
        }
    } finally {
        if (!lyricsAbortController || signal === lyricsAbortController.signal) {
            lyricsActive = false;
        }
    }
}

/**
 * 停止歌詞播放並清理畫面
 */
function stopLyrics() {
    // 中斷播放
    if (lyricsAbortController) {
        lyricsAbortController.abort();
        lyricsAbortController = null;
    }

    lyricsActive = false;
    lyricsLiveSpeed = null;

    // 淡出所有現存歌詞行
    lyricsActiveLines.forEach(el => fadeOutLyricsLine(el));
    lyricsActiveLines = [];

    // 清理所有殘留的 resonance-line 元素
    setTimeout(() => {
        document.querySelectorAll('.resonance-line').forEach(el => {
            if (el.parentNode) el.parentNode.removeChild(el);
        });
    }, LYRICS_FADE_DURATION_MS + 200);

    lyricsCurrentSlot = 0;
}

// ===== 工具函式 =====

/**
 * 可中斷的延遲
 * @param {number} ms - 延遲毫秒數
 * @param {AbortSignal} signal - 中斷信號
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }

        const timer = setTimeout(resolve, ms);

        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

// ===== Tap Tempo 測速 =====

/**
 * 處理 Tap Tempo 點擊
 * 記錄時間戳、計算平均間隔、換算 BPM 和打字速度
 */
function handleTap() {
    const now = Date.now();
    const btn = document.getElementById('tap-btn');
    const bpmDisplay = document.getElementById('tap-bpm-display');

    // 超時重置：距離上次點擊超過 2 秒，重新計算
    if (tapTimes.length > 0 && (now - tapTimes[tapTimes.length - 1]) > 2000) {
        tapTimes = [];
    }

    // 紀錄時間，只保留最後 5 次
    tapTimes.push(now);
    if (tapTimes.length > 5) {
        tapTimes.shift();
    }

    // 按鈕閃爍回饋
    if (btn) {
        btn.classList.add('tap-flash');
        setTimeout(() => btn.classList.remove('tap-flash'), 100);
    }

    // 至少需要 2 次點擊才能計算
    if (tapTimes.length < 2) {
        if (bpmDisplay) {
            bpmDisplay.textContent = 'BPM: 再按一下...';
            bpmDisplay.classList.remove('active');
        }
        return;
    }

    // 計算每次點擊的間隔平均值
    let totalInterval = 0;
    for (let i = 1; i < tapTimes.length; i++) {
        totalInterval += tapTimes[i] - tapTimes[i - 1];
    }
    const avgInterval = totalInterval / (tapTimes.length - 1);

    // 換算 BPM
    const bpm = Math.round(60000 / avgInterval);

    // 換算打字速度：一個拍子出現 4 個字
    detectedCharDelay = Math.round(avgInterval / 4);

    // 播放中即時生效
    lyricsLiveSpeed = detectedCharDelay;

    // 更新 UI
    if (bpmDisplay) {
        bpmDisplay.textContent = `BPM: ${bpm} (${detectedCharDelay}ms/字)`;
        bpmDisplay.classList.add('active');
    }

    // 同步更新速度滑桿的顯示（不改變滑桿值，僅作為視覺提示）
    const speedVal = document.getElementById('lyrics-speed-val');
    if (speedVal) {
        speedVal.textContent = detectedCharDelay + 'ms*';
    }
}

// ===== UI 控制 =====

/**
 * 從面板的輸入框切換歌詞播放/停止
 */
function toggleLyricsPlayback() {
    if (lyricsActive) {
        stopLyrics();
        updateLyricsPlayBtn(false);
        return;
    }

    const textarea = document.getElementById('lyrics-input');
    if (!textarea) return;

    const text = textarea.value.trim();
    if (!text) {
        if (typeof showToast === 'function') showToast('請先輸入歌詞');
        return;
    }

    const lines = text.split('\n');
    const speedSlider = document.getElementById('lyrics-speed');
    const pauseSlider = document.getElementById('lyrics-pause');
    const loopCheckbox = document.getElementById('lyrics-loop');

    // 優先使用 Tap Tempo 偵測到的速度，否則使用預設組或滑桿值
    const speed = getCurrentSpeed();
    const linePause = pauseSlider ? parseInt(pauseSlider.value) : LYRICS_LINE_PAUSE_MS;
    const loop = loopCheckbox ? loopCheckbox.checked : false;

    // 設定即時速度（播放中可透過預設組切換改變）
    lyricsLiveSpeed = speed;

    updateLyricsPlayBtn(true);

    playLyrics(lines, { speed, linePause, loop }).then(() => {
        updateLyricsPlayBtn(false);
        lyricsLiveSpeed = null;
    });
}

/**
 * 更新播放按鈕外觀
 * @param {boolean} isPlaying
 */
function updateLyricsPlayBtn(isPlaying) {
    const btn = document.getElementById('lyrics-play-btn');
    if (!btn) return;
    if (isPlaying) {
        btn.textContent = '⏹ 停止';
        btn.classList.add('playing');
    } else {
        btn.textContent = '▶ 播放';
        btn.classList.remove('playing');
    }
}

// ===== 速度預設組 =====

/**
 * 取得目前生效的速度 (ms/字)
 * 優先順序：Tap Tempo > 目前啟用的預設組 > 滑桿值
 */
function getCurrentSpeed() {
    if (detectedCharDelay !== null) return detectedCharDelay;
    return speedPresets[activePreset] || LYRICS_DEFAULT_SPEED;
}

/**
 * 切換到指定的速度預設組，播放中即時生效
 * @param {number} presetId - 預設組編號 (1 或 2)
 */
function switchSpeedPreset(presetId) {
    activePreset = presetId;
    const speed = speedPresets[presetId];

    // 清除 Tap Tempo 偵測值，改用預設組
    detectedCharDelay = null;

    // 更新即時速度（播放中立刻生效）
    lyricsLiveSpeed = speed;

    // 同步滑桿
    const speedSlider = document.getElementById('lyrics-speed');
    const speedVal = document.getElementById('lyrics-speed-val');
    if (speedSlider) speedSlider.value = speed;
    if (speedVal) speedVal.textContent = speed + 'ms';

    // 更新按鈕 UI
    updatePresetBtnsUI();

    // 重置 BPM 顯示
    const bpmDisplay = document.getElementById('tap-bpm-display');
    if (bpmDisplay) {
        bpmDisplay.textContent = 'BPM: --';
        bpmDisplay.classList.remove('active');
    }
}

/**
 * 將目前的速度值儲存到目前啟用的預設組
 */
function saveCurrentSpeedToPreset() {
    const speedSlider = document.getElementById('lyrics-speed');
    const speed = speedSlider ? parseInt(speedSlider.value) : LYRICS_DEFAULT_SPEED;
    speedPresets[activePreset] = speed;

    // 同步即時速度
    lyricsLiveSpeed = speed;

    // 更新按鈕顯示
    updatePresetBtnsUI();

    // 儲存按鈕閃爍回饋
    const saveBtn = document.getElementById('speed-preset-save');
    if (saveBtn) {
        saveBtn.classList.add('saved');
        saveBtn.textContent = '已儲存';
        setTimeout(() => {
            saveBtn.classList.remove('saved');
            saveBtn.textContent = '儲存';
        }, 800);
    }
}

/**
 * 更新預設組按鈕的 UI 狀態
 */
function updatePresetBtnsUI() {
    [1, 2].forEach(id => {
        const btn = document.getElementById('speed-preset-' + id);
        if (btn) {
            btn.classList.toggle('active', id === activePreset);
            const label = id === 1 ? 'A' : 'B';
            btn.textContent = `${label}: ${speedPresets[id]}ms`;
        }
    });
}

/**
 * 初始化歌詞面板的滑桿即時數值顯示
 */
function initLyricsUI() {
    const speedSlider = document.getElementById('lyrics-speed');
    const speedVal = document.getElementById('lyrics-speed-val');
    if (speedSlider && speedVal) {
        speedSlider.addEventListener('input', () => {
            speedVal.textContent = speedSlider.value + 'ms';
            // 手動調整滑桿時清除 Tap Tempo，並即時更新播放速度
            detectedCharDelay = null;
            lyricsLiveSpeed = parseInt(speedSlider.value);
        });
    }

    const pauseSlider = document.getElementById('lyrics-pause');
    const pauseVal = document.getElementById('lyrics-pause-val');
    if (pauseSlider && pauseVal) {
        pauseSlider.addEventListener('input', () => {
            pauseVal.textContent = (parseInt(pauseSlider.value) / 1000).toFixed(1) + 's';
        });
    }

    // 速度預設組按鈕
    [1, 2].forEach(id => {
        const btn = document.getElementById('speed-preset-' + id);
        if (btn) {
            btn.addEventListener('click', () => switchSpeedPreset(id));
        }
    });

    const saveBtn = document.getElementById('speed-preset-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => saveCurrentSpeedToPreset());
    }

    updatePresetBtnsUI();
}

// 頁面載入後初始化歌詞 UI
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLyricsUI);
} else {
    initLyricsUI();
}

console.log('Lyrics: 雙欄循環式動態歌詞系統已載入');

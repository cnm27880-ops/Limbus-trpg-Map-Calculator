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

// ===== 逐行速度 / 時間軸 =====
let lyricsTimeline = null;              // AI 匯入的時間軸數據 [{time, text, speed}]
let lyricsPerLineSpeeds = {};           // 逐行自訂速度 { lineIndex: speed(ms) }
let lyricsPerLineTimestamps = {};       // 逐行時間戳 { lineIndex: seconds }

// ===== 錄製模式 =====
let recIsRecording = false;             // 是否正在錄製
let recStartTime = 0;                   // 錄製開始的基準時間
let recLineIndex = 0;                   // 下一個待錄製的行數
let recTimestamps = [];                 // 錄製的時間戳

// ===== localStorage 鍵名 =====
const LYRICS_STORAGE_KEY = 'limbus_lyrics_text';
const LYRICS_SPEEDS_KEY = 'limbus_lyrics_perline';
const LYRICS_TIMESTAMPS_KEY = 'limbus_lyrics_timestamps';
const LYRICS_TIMELINE_KEY = 'limbus_lyrics_timeline';
const LYRICS_PRESETS_KEY = 'limbus_lyrics_presets';

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

                // 取得此行的速度（逐行自訂 > 全域速度）
                const lineSpeed = lyricsPerLineSpeeds[i] || speed;

                // 打字機逐字顯示
                await typewriterLine(lineEl, text, lineSpeed, signal);

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
        // 同步停止給所有玩家
        if (typeof myRole !== 'undefined' && myRole === 'st') {
            syncLyricsStop();
        }
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

    // 同步播放給所有玩家
    if (typeof myRole !== 'undefined' && myRole === 'st') {
        syncLyricsPlay();
    }

    // 如果有時間戳數據，使用時間軸同步播放
    const hasTimestamps = Object.keys(lyricsPerLineTimestamps).length > 0;
    const playFn = hasTimestamps
        ? playLyricsWithTimestamps(lines, { speed, loop })
        : playLyrics(lines, { speed, linePause, loop });

    playFn.then(() => {
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

    // 更新按鈕顯示 + 持久化
    updatePresetBtnsUI();
    saveLyricsPresets();

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

// ===== AI JSON 匯入 =====

/**
 * 匯入 AI 分析數據 (JSON 時間軸)
 * 彈出 prompt 讓使用者貼上 JSON 字串
 */
function importJsonTimeline() {
    const jsonStr = prompt(
        '請貼上 auto_sync.py 產生的 JSON 數據：\n' +
        '格式：[{"time": 12.5, "text": "台詞", "speed": 80}, ...]'
    );

    if (!jsonStr || !jsonStr.trim()) return;

    let data;
    try {
        data = JSON.parse(jsonStr.trim());
    } catch (e) {
        if (typeof showToast === 'function') showToast('JSON 格式錯誤，請檢查');
        return;
    }

    // 驗證格式
    if (!Array.isArray(data) || data.length === 0) {
        if (typeof showToast === 'function') showToast('數據必須是非空陣列');
        return;
    }

    for (let i = 0; i < data.length; i++) {
        if (!data[i].text) {
            if (typeof showToast === 'function') showToast(`第 ${i + 1} 筆缺少 text 欄位`);
            return;
        }
    }

    // 儲存時間軸
    lyricsTimeline = data;
    saveLyricsTimeline();

    // 將歌詞文字填入 textarea
    const textarea = document.getElementById('lyrics-input');
    if (textarea) {
        const lyricsText = data.map(d => d.text).join('\n');
        textarea.value = lyricsText;
        saveLyricsText();
    }

    // 將每行速度和時間戳寫入
    lyricsPerLineSpeeds = {};
    lyricsPerLineTimestamps = {};
    data.forEach((d, i) => {
        if (d.speed) lyricsPerLineSpeeds[i] = d.speed;
        if (d.time !== undefined) lyricsPerLineTimestamps[i] = d.time;
    });
    saveLyricsPerLineSpeeds();
    saveLyricsTimestamps();

    // 更新逐行編輯器
    renderLineEditor();

    if (typeof showToast === 'function') showToast('AI 數據匯入成功！請檢查微調。');
}

// ===== 手動錄製模式 =====

/**
 * 切換錄製模式
 */
function toggleRecording() {
    if (recIsRecording) {
        stopRecording();
    } else {
        // 讀取起始行輸入
        const startLineInput = document.getElementById('rec-start-line');
        const startLine = startLineInput ? parseInt(startLineInput.value) - 1 : 0; // 轉為 0-based
        startRecording(startLine >= 0 ? startLine : 0);
    }
}

/**
 * 開始錄製：記錄基準時間，監聽空白鍵
 * @param {number} [startFromLine] - 從第幾行開始錄製 (0-based)，預設 0
 */
function startRecording(startFromLine) {
    const textarea = document.getElementById('lyrics-input');
    if (!textarea || !textarea.value.trim()) {
        if (typeof showToast === 'function') showToast('請先輸入歌詞');
        return;
    }

    const lines = textarea.value.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) return;

    // 決定起始行
    const startIdx = (typeof startFromLine === 'number' && startFromLine >= 0 && startFromLine < lines.length)
        ? startFromLine : 0;

    recIsRecording = true;
    recLineIndex = startIdx;

    // 保留之前已錄製的時間戳（只覆蓋 startIdx 之後的部分）
    if (startIdx === 0) {
        recTimestamps = [];
    } else {
        // 保留 startIdx 之前的已錄時間戳
        recTimestamps = [];
        for (let i = 0; i < startIdx; i++) {
            recTimestamps[i] = lyricsPerLineTimestamps[i] !== undefined
                ? lyricsPerLineTimestamps[i] : 0;
        }
    }

    // 使用音樂的當前播放時間作為基準（如果有音樂的話）
    const audio = (typeof musicManager !== 'undefined' && musicManager.currentAudio)
        ? musicManager.currentAudio : null;
    if (audio && !audio.paused) {
        // 以音樂當前播放時間為基準
        recStartTime = Date.now() - (audio.currentTime * 1000);
    } else {
        recStartTime = Date.now();
    }

    // 更新 UI
    const btn = document.getElementById('rec-start-btn');
    if (btn) {
        btn.textContent = '⏹ 停止錄製';
        btn.classList.add('recording');
    }
    updateRecStatus(`從第 ${startIdx + 1} 句開始，等待第 ${startIdx + 1}/${lines.length} 句... 按空白鍵定點`);

    // 綁定鍵盤監聽
    document.addEventListener('keydown', handleRecKeydown);
}

/**
 * 停止錄製，將結果寫入 timestamps
 */
function stopRecording() {
    recIsRecording = false;
    document.removeEventListener('keydown', handleRecKeydown);

    const btn = document.getElementById('rec-start-btn');
    if (btn) {
        btn.textContent = '⏺ 開始錄製';
        btn.classList.remove('recording');
    }

    // 將錄製的時間戳寫入 lyricsPerLineTimestamps
    recTimestamps.forEach((ts, i) => {
        lyricsPerLineTimestamps[i] = ts;
    });
    saveLyricsTimestamps();

    updateRecStatus(`錄製完成：${recTimestamps.length} 個定點`);
    renderLineEditor();
}

/**
 * 清除錄製結果
 */
function clearRecording() {
    recTimestamps = [];
    lyricsPerLineTimestamps = {};
    saveLyricsTimestamps();
    updateRecStatus('');
    renderLineEditor();
    if (typeof showToast === 'function') showToast('已清除錄製數據');
}

/**
 * 錄製模式的鍵盤處理
 */
function handleRecKeydown(e) {
    if (!recIsRecording) return;
    if (e.key !== ' ') return;

    // 防止空白鍵捲動頁面
    e.preventDefault();

    const textarea = document.getElementById('lyrics-input');
    if (!textarea) return;
    const lines = textarea.value.trim().split('\n').filter(l => l.trim());

    if (recLineIndex >= lines.length) {
        stopRecording();
        return;
    }

    const elapsed = (Date.now() - recStartTime) / 1000;
    recTimestamps.push(parseFloat(elapsed.toFixed(2)));
    recLineIndex++;

    if (recLineIndex >= lines.length) {
        stopRecording();
    } else {
        updateRecStatus(`已錄 ${recLineIndex}/${lines.length} 句 (${elapsed.toFixed(1)}s)  等待第 ${recLineIndex + 1} 句...`);
    }
}

function updateRecStatus(msg) {
    const el = document.getElementById('rec-status');
    if (el) {
        el.textContent = msg;
        el.classList.toggle('active', recIsRecording);
    }
}

// ===== 時間軸播放 (搭配音樂) =====

/**
 * 使用時間戳播放歌詞（與音樂同步）
 * 如果有 lyricsPerLineTimestamps，按照時間戳觸發每行
 */
async function playLyricsWithTimestamps(lines, options = {}) {
    if (lyricsActive) {
        stopLyrics();
        await new Promise(r => setTimeout(r, 100));
    }

    if (!lines || lines.length === 0) return;

    const speed = options.speed || LYRICS_DEFAULT_SPEED;
    const loop = options.loop || false;

    lyricsActive = true;
    lyricsAbortController = new AbortController();
    lyricsActiveLines = [];
    lyricsCurrentSlot = 0;

    const signal = lyricsAbortController.signal;
    // 取得音樂的當前播放時間作為同步基準
    const audio = (typeof musicManager !== 'undefined' && musicManager.currentAudio)
        ? musicManager.currentAudio : null;

    try {
        do {
            // 每輪循環開始時記錄基準時間，用於計算相對偏移
            // 如果有音樂，使用音樂的 currentTime 作為基準
            // 如果沒有音樂，使用 Date.now() 作為基準
            let loopBaseAudioTime = audio ? audio.currentTime : 0;
            let loopBaseWallTime = Date.now();

            const getElapsed = () => {
                if (audio) {
                    // 計算自本輪循環開始以來經過的音頻時間
                    let elapsed = audio.currentTime - loopBaseAudioTime;
                    // 如果音頻循環導致 currentTime 回到起點，修正計算
                    if (elapsed < -1) {
                        // 音頻已經循環，重新校正基準
                        loopBaseAudioTime = audio.currentTime;
                        loopBaseWallTime = Date.now();
                        elapsed = 0;
                    }
                    return elapsed;
                }
                return (Date.now() - loopBaseWallTime) / 1000;
            };

            for (let i = 0; i < lines.length; i++) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

                const text = lines[i];
                if (!text || text.trim() === '') {
                    lyricsCurrentSlot++;
                    continue;
                }

                // 等到這一行的時間戳
                const targetTime = lyricsPerLineTimestamps[i];
                if (targetTime !== undefined) {
                    while (getElapsed() < targetTime) {
                        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
                        await new Promise(r => setTimeout(r, 50));
                    }
                }

                const { side, localSlot } = resolveSlot(lyricsCurrentSlot);
                const lineEl = createLyricsLineElement(side, localSlot);
                if (!lineEl) { lyricsCurrentSlot++; continue; }

                enqueueLyricsLine(lineEl);

                const lineSpeed = lyricsPerLineSpeeds[i] || speed;
                await typewriterLine(lineEl, text, lineSpeed, signal);

                lyricsCurrentSlot++;
            }

            // 循環模式：等待音樂回到起點再開始下一輪
            if (loop && !signal.aborted && audio) {
                // 清除目前畫面上的歌詞
                lyricsActiveLines.forEach(el => fadeOutLyricsLine(el));
                lyricsActiveLines = [];

                // 等待音頻循環回到起點（currentTime 會跳回接近 0）
                const lastTime = audio.currentTime;
                while (audio.currentTime >= lastTime - 0.5 && !signal.aborted) {
                    await new Promise(r => setTimeout(r, 50));
                    // 如果音頻已暫停或停止，也跳出等待
                    if (audio.paused || audio.ended) {
                        await new Promise(r => setTimeout(r, 200));
                    }
                }
            }
        } while (loop && !signal.aborted);
    } catch (e) {
        if (e.name !== 'AbortError') console.error('Lyrics: 播放錯誤', e);
    } finally {
        if (!lyricsAbortController || signal === lyricsAbortController.signal) {
            lyricsActive = false;
        }
    }
}

// ===== 逐行微調編輯器 =====

/**
 * 根據 textarea 的內容渲染逐行微調編輯器（速度 + 時間戳）
 */
function renderLineEditor() {
    const editor = document.getElementById('lyrics-line-editor');
    const list = document.getElementById('lyrics-line-list');
    const textarea = document.getElementById('lyrics-input');
    if (!editor || !list || !textarea) return;

    const text = textarea.value.trim();
    if (!text) {
        editor.style.display = 'none';
        return;
    }

    const lines = text.split('\n');
    const hasTimestamps = Object.keys(lyricsPerLineTimestamps).length > 0;
    editor.style.display = '';

    list.innerHTML = '';
    lines.forEach((lineText, i) => {
        if (!lineText.trim()) return;

        const item = document.createElement('div');
        item.className = 'lyrics-line-item';

        // 行號
        const num = document.createElement('span');
        num.className = 'lyrics-line-num';
        num.textContent = (i + 1) + '.';

        // 時間戳欄位
        const timeInput = document.createElement('input');
        timeInput.type = 'number';
        timeInput.className = 'lyrics-line-time-input';
        timeInput.min = '0';
        timeInput.step = '0.1';
        timeInput.value = lyricsPerLineTimestamps[i] !== undefined
            ? lyricsPerLineTimestamps[i] : '';
        timeInput.placeholder = '--';
        timeInput.title = '時間 (秒)';
        timeInput.addEventListener('change', () => {
            const val = parseFloat(timeInput.value);
            if (!isNaN(val) && val >= 0) {
                lyricsPerLineTimestamps[i] = parseFloat(val.toFixed(2));
            } else {
                delete lyricsPerLineTimestamps[i];
                timeInput.value = '';
            }
            saveLyricsTimestamps();
        });

        const timeSuffix = document.createElement('span');
        timeSuffix.className = 'lyrics-line-unit';
        timeSuffix.textContent = 's';

        // 歌詞文字
        const textEl = document.createElement('span');
        textEl.className = 'lyrics-line-text';
        textEl.textContent = lineText;
        textEl.title = lineText;

        item.appendChild(num);
        item.appendChild(timeInput);
        item.appendChild(timeSuffix);
        item.appendChild(textEl);
        list.appendChild(item);
    });
}

// ===== localStorage 持久化 =====

function saveLyricsText() {
    const textarea = document.getElementById('lyrics-input');
    if (textarea) {
        try { localStorage.setItem(LYRICS_STORAGE_KEY, textarea.value); } catch (e) {}
    }
}

function loadLyricsText() {
    const textarea = document.getElementById('lyrics-input');
    if (!textarea) return;
    try {
        const saved = localStorage.getItem(LYRICS_STORAGE_KEY);
        if (saved !== null) textarea.value = saved;
    } catch (e) {}
}

function saveLyricsPerLineSpeeds() {
    try { localStorage.setItem(LYRICS_SPEEDS_KEY, JSON.stringify(lyricsPerLineSpeeds)); } catch (e) {}
}

function loadLyricsPerLineSpeeds() {
    try {
        const saved = localStorage.getItem(LYRICS_SPEEDS_KEY);
        if (saved) lyricsPerLineSpeeds = JSON.parse(saved);
    } catch (e) {}
}

function saveLyricsTimestamps() {
    try { localStorage.setItem(LYRICS_TIMESTAMPS_KEY, JSON.stringify(lyricsPerLineTimestamps)); } catch (e) {}
}

function loadLyricsTimestamps() {
    try {
        const saved = localStorage.getItem(LYRICS_TIMESTAMPS_KEY);
        if (saved) lyricsPerLineTimestamps = JSON.parse(saved);
    } catch (e) {}
}

function saveLyricsTimeline() {
    try { localStorage.setItem(LYRICS_TIMELINE_KEY, JSON.stringify(lyricsTimeline)); } catch (e) {}
}

function loadLyricsTimeline() {
    try {
        const saved = localStorage.getItem(LYRICS_TIMELINE_KEY);
        if (saved) lyricsTimeline = JSON.parse(saved);
    } catch (e) {}
}

function saveLyricsPresets() {
    try {
        localStorage.setItem(LYRICS_PRESETS_KEY, JSON.stringify({
            presets: speedPresets,
            active: activePreset
        }));
    } catch (e) {}
}

function loadLyricsPresets() {
    try {
        const saved = localStorage.getItem(LYRICS_PRESETS_KEY);
        if (saved) {
            const data = JSON.parse(saved);
            if (data.presets) speedPresets = data.presets;
            if (data.active) activePreset = data.active;
        }
    } catch (e) {}
}

/**
 * 初始化歌詞面板的滑桿即時數值顯示
 */
function initLyricsUI() {
    // 從 localStorage 恢復資料
    loadLyricsPresets();
    loadLyricsText();
    loadLyricsPerLineSpeeds();
    loadLyricsTimestamps();
    loadLyricsTimeline();

    const speedSlider = document.getElementById('lyrics-speed');
    const speedVal = document.getElementById('lyrics-speed-val');
    if (speedSlider && speedVal) {
        speedSlider.addEventListener('input', () => {
            speedVal.textContent = speedSlider.value + 'ms';
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

    // 歌詞 textarea 變更時自動儲存並更新編輯器
    const textarea = document.getElementById('lyrics-input');
    if (textarea) {
        textarea.addEventListener('input', () => {
            saveLyricsText();
            clearTimeout(textarea._editorTimer);
            textarea._editorTimer = setTimeout(() => renderLineEditor(), 500);
        });
    }

    updatePresetBtnsUI();
    renderLineEditor();
}

// ===== Firebase 歌詞同步 (讓玩家也能看到歌詞) =====

/**
 * 同步歌詞狀態到 Firebase（ST 專用）
 * @param {Object} lyricsState - 歌詞狀態
 */
function syncLyricsState(lyricsState) {
    if (typeof roomRef === 'undefined' || !roomRef) return;
    if (typeof myRole === 'undefined' || myRole !== 'st') return;

    roomRef.child('lyrics').update(lyricsState);
}

/**
 * ST 開始播放歌詞時，同步給所有玩家
 */
function syncLyricsPlay() {
    const textarea = document.getElementById('lyrics-input');
    if (!textarea) return;

    const text = textarea.value.trim();
    if (!text) return;

    const speed = getCurrentSpeed();
    const pauseSlider = document.getElementById('lyrics-pause');
    const loopCheckbox = document.getElementById('lyrics-loop');
    const linePause = pauseSlider ? parseInt(pauseSlider.value) : LYRICS_LINE_PAUSE_MS;
    const loop = loopCheckbox ? loopCheckbox.checked : false;
    const hasTimestamps = Object.keys(lyricsPerLineTimestamps).length > 0;

    syncLyricsState({
        action: 'play',
        text: text,
        speed: speed,
        linePause: linePause,
        loop: loop,
        timestamps: hasTimestamps ? lyricsPerLineTimestamps : null,
        perLineSpeeds: Object.keys(lyricsPerLineSpeeds).length > 0 ? lyricsPerLineSpeeds : null,
        timestamp: Date.now()
    });
}

/**
 * ST 停止歌詞時，同步給所有玩家
 */
function syncLyricsStop() {
    syncLyricsState({
        action: 'stop',
        timestamp: Date.now()
    });
}

/**
 * 處理從 Firebase 接收到的歌詞同步更新（玩家端）
 * @param {Object} data - 歌詞數據
 */
function handleLyricsUpdate(data) {
    if (!data) return;
    // ST 自己不需要接收同步（已經在本地播放）
    if (typeof myRole !== 'undefined' && myRole === 'st') return;

    if (data.action === 'play') {
        // 停止當前播放
        if (lyricsActive) stopLyrics();

        const lines = data.text.split('\n');
        const speed = data.speed || LYRICS_DEFAULT_SPEED;
        const linePause = data.linePause || LYRICS_LINE_PAUSE_MS;
        const loop = data.loop || false;

        // 設定同步過來的逐行數據
        if (data.timestamps) {
            lyricsPerLineTimestamps = data.timestamps;
        } else {
            lyricsPerLineTimestamps = {};
        }
        if (data.perLineSpeeds) {
            lyricsPerLineSpeeds = data.perLineSpeeds;
        } else {
            lyricsPerLineSpeeds = {};
        }

        lyricsLiveSpeed = speed;

        // 根據是否有時間戳選擇播放方式
        const hasTimestamps = Object.keys(lyricsPerLineTimestamps).length > 0;
        if (hasTimestamps) {
            playLyricsWithTimestamps(lines, { speed, loop });
        } else {
            playLyrics(lines, { speed, linePause, loop });
        }
    } else if (data.action === 'stop') {
        stopLyrics();
    }
}

// 頁面載入後初始化歌詞 UI
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLyricsUI);
} else {
    initLyricsUI();
}

console.log('Lyrics: 雙欄循環式動態歌詞系統已載入');

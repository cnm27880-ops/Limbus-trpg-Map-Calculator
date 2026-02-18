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

// ===== 座標快取（防止分頁切換導致位移）=====
let lyricsCachedMargins = null;         // 最後一次有效的 margin 數據

// ===== 延遲補償 =====
let lyricsSyncOffset = -0.5;            // 全域同步偏移 (秒)，負值 = 歌詞提早出現
const LYRICS_OFFSET_KEY = 'limbus_lyrics_sync_offset';

// ===== localStorage 鍵名 =====
const LYRICS_STORAGE_KEY = 'limbus_lyrics_text';
const LYRICS_SPEEDS_KEY = 'limbus_lyrics_perline';
const LYRICS_TIMESTAMPS_KEY = 'limbus_lyrics_timestamps';
const LYRICS_TIMELINE_KEY = 'limbus_lyrics_timeline';
const LYRICS_PRESETS_KEY = 'limbus_lyrics_presets';

// ===== 安全 JSON 解析 =====

/**
 * 安全解析 JSON 字串，失敗時回傳 null 而非拋出錯誤
 * @param {string} jsonString - 要解析的字串
 * @returns {*|null} 解析結果或 null
 */
function safeParse(jsonString) {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return null;
    }
}

// ===== 空間偵測 =====

/**
 * 計算 battle-map 在視窗中的位置與兩側黑邊中心點
 * @returns {{ leftCenterX: number, rightCenterX: number, mapRect: DOMRect } | null}
 */
function detectMargins() {
    const battleMap = document.getElementById('battle-map');
    const viewport = document.getElementById('map-viewport');
    if (!battleMap || !viewport) return lyricsCachedMargins;

    const mapRect = battleMap.getBoundingClientRect();
    const viewRect = viewport.getBoundingClientRect();

    // 如果地圖被隱藏（分頁切換），rect 全為 0，使用快取
    if (viewRect.width === 0 || viewRect.height === 0) {
        return lyricsCachedMargins;
    }

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

    const result = {
        leftCenterX,
        rightCenterX,
        leftMarginWidth,
        rightMarginWidth,
        viewRect
    };

    // 快取有效結果
    lyricsCachedMargins = result;
    return result;
}

/**
 * 重新校正畫面上所有歌詞行的位置（切回地圖頁時呼叫）
 */
function recalibrateLyricsPositions() {
    const margins = detectMargins();
    if (!margins) return;

    document.querySelectorAll('.resonance-line').forEach(el => {
        const side = el.dataset.side;
        if (!side) return;
        const centerX = side === 'left' ? margins.leftCenterX : margins.rightCenterX;
        el.style.left = centerX + 'px';
    });
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
    setTimeout(() => lineEl.remove(), LYRICS_FADE_DURATION_MS);
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

    // 記錄側邊資訊（供校正使用）
    line.dataset.side = side;

    // 計算 Y 位置
    const yPercent = getSlotYPercent(localSlot);

    // 計算 X 位置
    const centerX = side === 'left' ? margins.leftCenterX : margins.rightCenterX;

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
        const chars = Array.from(text); // 支援 Unicode 字符
        if (chars.length === 0) { resolve(); return; }

        let rendered = 0;
        const startTime = performance.now();
        // schedule[i] = 字元 i 的預計出現時間（ms, 相對於 startTime）
        // 僅預設第 0 個，後續由 tick 內動態計算（支援播放中即時切速）
        const schedule = [0];

        function tick() {
            if (signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }

            const elapsed = performance.now() - startTime;

            // 根據已過時間，一次補齊所有應顯示的字元
            while (rendered < chars.length && elapsed >= schedule[rendered]) {
                const charSpan = document.createElement('span');
                charSpan.className = 'resonance-char';
                charSpan.textContent = chars[rendered];
                lineEl.appendChild(charSpan);
                rendered++;

                // 動態更新後續字元的排程，支援播放中切速
                if (rendered < chars.length) {
                    const spd = (lyricsLiveSpeed !== null) ? lyricsLiveSpeed : charIntervalMs;
                    schedule[rendered] = schedule[rendered - 1] + spd;
                }
            }

            if (rendered >= chars.length) {
                resolve();
                return;
            }

            // 計算到下個字元的剩餘等待時間
            const nextCharTime = schedule[rendered];
            const remaining = Math.max(0, nextCharTime - (performance.now() - startTime));
            setTimeout(tick, remaining);
        }

        tick();
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
        document.querySelectorAll('.resonance-line').forEach(el => el.remove());
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

        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };

        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        signal.addEventListener('abort', onAbort, { once: true });
    });
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
    const pauseSlider = document.getElementById('lyrics-pause');

    // 優先使用滑桿值（可能被清單載入更新），否則使用預設組速度
    const entrySpeedSlider = document.getElementById('lyrics-speed');
    const speed = entrySpeedSlider ? parseInt(entrySpeedSlider.value) : getCurrentSpeed();
    const linePause = pauseSlider ? parseInt(pauseSlider.value) : LYRICS_LINE_PAUSE_MS;

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
        ? playLyricsWithTimestamps(lines, { speed, loop: true })
        : playLyrics(lines, { speed, linePause, loop: true });

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
 * 優先順序：目前啟用的預設組 > 滑桿值
 */
function getCurrentSpeed() {
    return speedPresets[activePreset] || LYRICS_DEFAULT_SPEED;
}

/**
 * 切換到指定的速度預設組，播放中即時生效
 * @param {number} presetId - 預設組編號 (1 或 2)
 */
function switchSpeedPreset(presetId) {
    activePreset = presetId;
    const speed = speedPresets[presetId];

    // 更新即時速度（播放中立刻生效）
    lyricsLiveSpeed = speed;

    // 同步滑桿
    const speedSlider = document.getElementById('lyrics-speed');
    const speedVal = document.getElementById('lyrics-speed-val');
    if (speedSlider) speedSlider.value = speed;
    if (speedVal) speedVal.textContent = speed + 'ms';

    // 更新按鈕 UI
    updatePresetBtnsUI();
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

    // 保留 startIdx 之前的已錄時間戳（只覆蓋 startIdx 之後的部分）
    recTimestamps = [];
    for (let i = 0; i < startIdx; i++) {
        recTimestamps[i] = lyricsPerLineTimestamps[i] !== undefined
            ? lyricsPerLineTimestamps[i] : 0;
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

// ===== 高精度等待（使用 requestAnimationFrame）=====

/**
 * 使用 requestAnimationFrame 高精度等待，直到條件成立
 * @param {function} conditionFn - 返回 true 表示條件已滿足
 * @param {AbortSignal} signal - 中斷信號
 * @returns {Promise<void>}
 */
function waitUntilRAF(conditionFn, signal) {
    return new Promise((resolve, reject) => {
        let rafId = 0;
        let timerId = 0;

        function check() {
            // 先取消另一個待執行的回調，避免回調數量倍增
            cancelAnimationFrame(rafId);
            clearTimeout(timerId);

            if (signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            if (conditionFn()) {
                resolve();
                return;
            }
            // rAF 提供前景高精度，setTimeout 作為背景後備
            rafId = requestAnimationFrame(check);
            timerId = setTimeout(check, 200);
        }

        rafId = requestAnimationFrame(check);
        timerId = setTimeout(check, 200);
    });
}

// ===== 時間軸播放 (搭配音樂) =====

/**
 * 使用時間戳播放歌詞（與音樂同步）
 * 使用 requestAnimationFrame 高精度同步（~16ms），並套用 syncOffset 補償延遲
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
            let loopBaseAudioTime = audio ? audio.currentTime : 0;
            let loopBaseWallTime = Date.now();

            const getElapsed = () => {
                if (audio) {
                    let elapsed = audio.currentTime - loopBaseAudioTime;
                    if (elapsed < -1) {
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

                // 等到這一行的時間戳（套用 syncOffset 補償）
                const targetTime = lyricsPerLineTimestamps[i];
                if (targetTime !== undefined) {
                    const adjustedTarget = targetTime + lyricsSyncOffset;
                    await waitUntilRAF(() => getElapsed() >= adjustedTarget, signal);
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
                lyricsActiveLines.forEach(el => fadeOutLyricsLine(el));
                lyricsActiveLines = [];

                const lastTime = audio.currentTime;
                await waitUntilRAF(() => {
                    if (signal.aborted) return true;
                    return audio.currentTime < lastTime - 0.5;
                }, signal);
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
    const saved = localStorage.getItem(LYRICS_SPEEDS_KEY);
    if (saved) {
        const parsed = safeParse(saved);
        if (parsed) lyricsPerLineSpeeds = parsed;
    }
}

function saveLyricsTimestamps() {
    try { localStorage.setItem(LYRICS_TIMESTAMPS_KEY, JSON.stringify(lyricsPerLineTimestamps)); } catch (e) {}
}

function loadLyricsTimestamps() {
    const saved = localStorage.getItem(LYRICS_TIMESTAMPS_KEY);
    if (saved) {
        const parsed = safeParse(saved);
        if (parsed) lyricsPerLineTimestamps = parsed;
    }
}

function saveLyricsTimeline() {
    try { localStorage.setItem(LYRICS_TIMELINE_KEY, JSON.stringify(lyricsTimeline)); } catch (e) {}
}

function loadLyricsTimeline() {
    const saved = localStorage.getItem(LYRICS_TIMELINE_KEY);
    if (saved) {
        const parsed = safeParse(saved);
        if (parsed) lyricsTimeline = parsed;
    }
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
    const saved = localStorage.getItem(LYRICS_PRESETS_KEY);
    if (saved) {
        const data = safeParse(saved);
        if (data) {
            if (data.presets) speedPresets = data.presets;
            if (data.active) activePreset = data.active;
        }
    }
}

/**
 * 初始化歌詞面板的滑桿即時數值顯示
 */
function initLyricsUI() {
    // ===== 舊資料自動遷移 =====
    migrateLegacyLyricsData();

    // 從 localStorage 恢復資料
    loadLyricsPresets();
    loadLyricsText();
    loadLyricsPerLineSpeeds();
    loadLyricsTimestamps();
    loadLyricsTimeline();
    loadSyncOffset();

    const speedSlider = document.getElementById('lyrics-speed');
    const speedVal = document.getElementById('lyrics-speed-val');
    if (speedSlider && speedVal) {
        speedSlider.addEventListener('input', () => {
            speedVal.textContent = speedSlider.value + 'ms';
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

    // 同步偏移輸入
    const offsetInput = document.getElementById('lyrics-sync-offset');
    const offsetVal = document.getElementById('lyrics-sync-offset-val');
    if (offsetInput) {
        offsetInput.value = lyricsSyncOffset;
        if (offsetVal) offsetVal.textContent = lyricsSyncOffset.toFixed(1) + 's';
        offsetInput.addEventListener('input', () => {
            lyricsSyncOffset = parseFloat(offsetInput.value) || 0;
            if (offsetVal) offsetVal.textContent = lyricsSyncOffset.toFixed(1) + 's';
            saveSyncOffset();
        });
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
    renderLyricsLibrary();
}

// ===== 歌詞清單 (Library) =====
const LYRICS_LIBRARY_KEY = 'limbus_lyrics_library';

/**
 * 從 localStorage 載入歌詞清單
 * @returns {Array} 歌詞清單 [{id, name, text, timestamps, perLineSpeeds, speed, linePause, loop, savedAt}]
 */
function loadLyricsLibrary() {
    const saved = localStorage.getItem(LYRICS_LIBRARY_KEY);
    if (saved) {
        const parsed = safeParse(saved);
        if (Array.isArray(parsed)) return parsed;
    }
    return [];
}

/**
 * 儲存歌詞清單到 localStorage
 * @param {Array} library
 */
function persistLyricsLibrary(library) {
    try {
        localStorage.setItem(LYRICS_LIBRARY_KEY, JSON.stringify(library));
    } catch (e) {
        console.error('Lyrics: 儲存歌詞清單失敗', e);
    }
}

/**
 * 將目前歌詞設定儲存到清單
 */
function saveLyricsToLibrary() {
    const nameInput = document.getElementById('lyrics-save-name');
    const textarea = document.getElementById('lyrics-input');
    if (!textarea || !textarea.value.trim()) {
        if (typeof showToast === 'function') showToast('請先輸入歌詞');
        return;
    }

    let name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
        // 使用歌詞第一行作為預設名稱
        const firstLine = textarea.value.trim().split('\n')[0].trim();
        name = firstLine.substring(0, 20) || '未命名歌詞';
    }

    const speedSlider = document.getElementById('lyrics-speed');
    const pauseSlider = document.getElementById('lyrics-pause');
    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        name: name,
        text: textarea.value,
        timestamps: Object.keys(lyricsPerLineTimestamps).length > 0
            ? { ...lyricsPerLineTimestamps } : null,
        perLineSpeeds: Object.keys(lyricsPerLineSpeeds).length > 0
            ? { ...lyricsPerLineSpeeds } : null,
        speed: speedSlider ? parseInt(speedSlider.value) : LYRICS_DEFAULT_SPEED,
        linePause: pauseSlider ? parseInt(pauseSlider.value) : LYRICS_LINE_PAUSE_MS,
        loop: true,
        savedAt: Date.now()
    };

    const library = loadLyricsLibrary();
    library.unshift(entry); // 新的放最前面
    persistLyricsLibrary(library);

    // 清空名稱輸入
    if (nameInput) nameInput.value = '';

    renderLyricsLibrary();
    if (typeof showToast === 'function') showToast(`已儲存「${name}」`);
}

/**
 * 從清單載入指定歌詞
 * @param {string} id - 歌詞項目 ID
 */
function loadLyricsFromLibrary(id) {
    const library = loadLyricsLibrary();
    const entry = library.find(e => e.id === id);
    if (!entry) return;

    // 填入歌詞文字
    const textarea = document.getElementById('lyrics-input');
    if (textarea) {
        textarea.value = entry.text;
        saveLyricsText();
    }

    // 恢復時間戳
    lyricsPerLineTimestamps = entry.timestamps ? { ...entry.timestamps } : {};
    saveLyricsTimestamps();

    // 恢復逐行速度
    lyricsPerLineSpeeds = entry.perLineSpeeds ? { ...entry.perLineSpeeds } : {};
    saveLyricsPerLineSpeeds();

    // 恢復速度滑桿
    const speedSlider = document.getElementById('lyrics-speed');
    const speedVal = document.getElementById('lyrics-speed-val');
    if (speedSlider && entry.speed !== undefined) {
        speedSlider.value = entry.speed;
        if (speedVal) speedVal.textContent = entry.speed + 'ms';
    }

    // 恢復行距滑桿
    const pauseSlider = document.getElementById('lyrics-pause');
    const pauseVal = document.getElementById('lyrics-pause-val');
    if (pauseSlider && entry.linePause !== undefined) {
        pauseSlider.value = entry.linePause;
        if (pauseVal) pauseVal.textContent = (entry.linePause / 1000).toFixed(1) + 's';
    }

    // 更新逐行編輯器
    renderLineEditor();

    if (typeof showToast === 'function') showToast(`已載入「${entry.name}」`);
}

/**
 * 從清單刪除指定歌詞
 * @param {string} id - 歌詞項目 ID
 */
function deleteLyricsFromLibrary(id) {
    const library = loadLyricsLibrary();
    const idx = library.findIndex(e => e.id === id);
    if (idx === -1) return;

    const name = library[idx].name;
    library.splice(idx, 1);
    persistLyricsLibrary(library);
    renderLyricsLibrary();

    if (typeof showToast === 'function') showToast(`已刪除「${name}」`);
}

// ===== 新版 lyrics_data_* 格式讀寫 =====

/**
 * 掃描 localStorage，取得所有 lyrics_data_* 前綴的歌名清單
 * @returns {string[]} 歌名陣列
 */
function getSavedLyricsList() {
    const list = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('lyrics_data_')) {
            const name = key.replace('lyrics_data_', '');
            list.push(name);
        }
    }
    return list;
}

/**
 * 從 lyrics_data_* 格式載入歌詞到編輯器
 * @param {string} name - 歌名
 */
function loadLyrics(name) {
    const raw = localStorage.getItem('lyrics_data_' + name);
    if (!raw) return;

    const data = safeParse(raw);
    if (!data) return;

    const textarea = document.getElementById('lyrics-input');

    // 處理兩種格式：結構化物件 或 原始時間軸陣列
    if (Array.isArray(data)) {
        // 原始時間軸陣列 [{time, text, speed}, ...]
        if (textarea) {
            textarea.value = data.map(d => d.text || '').join('\n');
            saveLyricsText();
        }
        lyricsPerLineTimestamps = {};
        lyricsPerLineSpeeds = {};
        data.forEach((d, i) => {
            if (d.time !== undefined) lyricsPerLineTimestamps[i] = d.time;
            if (d.speed) lyricsPerLineSpeeds[i] = d.speed;
        });
    } else if (data && typeof data === 'object') {
        // 結構化格式 {name, text, timestamps, ...}
        if (textarea) {
            textarea.value = data.text || '';
            saveLyricsText();
        }
        lyricsPerLineTimestamps = data.timestamps ? { ...data.timestamps } : {};
        lyricsPerLineSpeeds = data.perLineSpeeds ? { ...data.perLineSpeeds } : {};

        const speedSlider = document.getElementById('lyrics-speed');
        const speedVal = document.getElementById('lyrics-speed-val');
        if (speedSlider && data.speed) {
            speedSlider.value = data.speed;
            if (speedVal) speedVal.textContent = data.speed + 'ms';
        }
    } else {
        return; // 無法辨識的格式
    }

    saveLyricsTimestamps();
    saveLyricsPerLineSpeeds();
    renderLineEditor();
    if (typeof showToast === 'function') showToast('已載入「' + name + '」');
}

/**
 * 刪除 lyrics_data_* 格式的歌詞
 * @param {string} name - 歌名
 */
function deleteLyrics(name) {
    localStorage.removeItem('lyrics_data_' + name);
    renderLyricsLibrary();
    if (typeof showToast === 'function') showToast('已刪除「' + name + '」');
}

/**
 * 從所有來源合併歌詞清單（舊版陣列 + 新版 lyrics_data_* 個別金鑰）
 * @returns {Array} 統一格式的歌詞項目 [{id, name, text, ..., _source}]
 */
function getAllLyricsEntries() {
    // 來源 1：舊版 limbus_lyrics_library 陣列
    const libraryEntries = loadLyricsLibrary().map(e => ({ ...e, _source: 'library' }));
    const knownNames = new Set(libraryEntries.map(e => e.name));

    // 來源 2：lyrics_data_* 個別金鑰（排除已在陣列中的重複項）
    const dataNames = getSavedLyricsList();
    const dataEntries = [];

    dataNames.forEach(name => {
        if (knownNames.has(name)) return; // 跳過重複

        const raw = localStorage.getItem('lyrics_data_' + name);
        const data = safeParse(raw);
        if (!data) return;

        let entry;
        if (Array.isArray(data)) {
            // 原始時間軸陣列
            const timestamps = {};
            const speeds = {};
            data.forEach((d, i) => {
                if (d.time !== undefined) timestamps[i] = d.time;
                if (d.speed) speeds[i] = d.speed;
            });
            entry = {
                id: 'ld_' + name,
                name: name,
                text: data.map(d => d.text || '').join('\n'),
                timestamps: Object.keys(timestamps).length > 0 ? timestamps : null,
                perLineSpeeds: Object.keys(speeds).length > 0 ? speeds : null,
                speed: LYRICS_DEFAULT_SPEED,
                linePause: LYRICS_LINE_PAUSE_MS,
                savedAt: Date.now(),
                _source: 'lyrics_data'
            };
        } else if (data && typeof data === 'object' && data.name) {
            // 結構化格式
            entry = {
                id: 'ld_' + name,
                name: data.name,
                text: data.text || '',
                timestamps: data.timestamps || null,
                perLineSpeeds: data.perLineSpeeds || null,
                speed: data.speed || LYRICS_DEFAULT_SPEED,
                linePause: data.linePause || LYRICS_LINE_PAUSE_MS,
                savedAt: data.migratedAt || Date.now(),
                _source: 'lyrics_data'
            };
        }

        if (entry && entry.text) dataEntries.push(entry);
    });

    return [...libraryEntries, ...dataEntries];
}

/**
 * 渲染歌詞清單 UI
 */
function renderLyricsLibrary() {
    const container = document.getElementById('lyrics-library-list');
    if (!container) return;

    const allEntries = getAllLyricsEntries();
    if (allEntries.length === 0) {
        container.innerHTML = '<div class="lyrics-library-empty">尚無儲存的歌詞</div>';
        return;
    }

    container.innerHTML = allEntries.map(entry => {
        const lineCount = (entry.text || '').trim().split('\n').filter(l => l.trim()).length;
        const hasTimestamps = entry.timestamps && Object.keys(entry.timestamps).length > 0;
        const badge = hasTimestamps ? '<span class="lyrics-lib-badge">已錄</span>' : '';
        const musicBadge = entry.linkedMusic ? '<span class="lyrics-lib-badge music">🎤</span>' : '';
        const date = new Date(entry.savedAt || Date.now());
        const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

        // 根據來源決定 onclick 和刪除行為
        const isDataKey = entry._source === 'lyrics_data';
        const escapedName = escapeHtmlLyrics(entry.name).replace(/'/g, "\\'");
        const loadAction = isDataKey
            ? `loadLyrics('${escapedName}')`
            : `loadLyricsFromLibrary('${entry.id}')`;
        const deleteAction = isDataKey
            ? `deleteLyrics('${escapedName}')`
            : `deleteLyricsFromLibrary('${entry.id}')`;

        return `<div class="lyrics-library-item" onclick="${loadAction}">
            <div class="lyrics-lib-info">
                <span class="lyrics-lib-name">${musicBadge}${escapeHtmlLyrics(entry.name)}</span>
                <span class="lyrics-lib-meta">${lineCount}句 · ${entry.speed || 80}ms · ${dateStr} ${badge}${entry.linkedMusic ? ' · ' + escapeHtmlLyrics(entry.linkedMusic) : ''}</span>
            </div>
            <button class="lyrics-lib-delete" onclick="event.stopPropagation(); ${deleteAction}" title="刪除">×</button>
        </div>`;
    }).join('');
}

/**
 * HTML 轉義工具
 */
function escapeHtmlLyrics(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== 同步偏移持久化 =====

function saveSyncOffset() {
    try { localStorage.setItem(LYRICS_OFFSET_KEY, lyricsSyncOffset.toString()); } catch (e) {}
}

function loadSyncOffset() {
    try {
        const saved = localStorage.getItem(LYRICS_OFFSET_KEY);
        if (saved !== null) lyricsSyncOffset = parseFloat(saved);
    } catch (e) {}
}

// ===== 手動歌詞選擇器 =====

/**
 * 切換歌詞選擇器下拉選單
 */
function toggleLyricsPicker() {
    const existing = document.getElementById('lyrics-picker-dropdown');
    if (existing) {
        existing.remove();
        document.removeEventListener('click', closeLyricsPickerOutside);
        return;
    }

    const btn = document.getElementById('bgm-lyrics-pick-btn');
    if (!btn) return;

    const allEntries = getAllLyricsEntries();
    const dropdown = document.createElement('div');
    dropdown.id = 'lyrics-picker-dropdown';
    dropdown.className = 'lyrics-picker-dropdown';

    if (allEntries.length === 0) {
        dropdown.innerHTML = '<div class="lyrics-picker-empty">尚無儲存的歌詞<br><span style="font-size:0.7rem;">請先到歌詞工具儲存歌詞</span></div>';
    } else {
        // 如果正在播放，顯示停止按鈕
        let html = '';
        if (lyricsActive) {
            html += '<div class="lyrics-picker-item lyrics-picker-stop" onclick="pickerStopLyrics()">⏹ 停止歌詞</div>';
            html += '<div class="lyrics-picker-divider"></div>';
        }
        html += allEntries.map(entry => {
            const hasTs = entry.timestamps && Object.keys(entry.timestamps).length > 0;
            const badge = hasTs ? ' ⏱' : '';
            const isDataKey = entry._source === 'lyrics_data';
            const escapedName = escapeHtmlLyrics(entry.name).replace(/'/g, "\\'");
            const action = isDataKey
                ? `pickerSelectLyricsData('${escapedName}')`
                : `pickerSelectLyrics('${entry.id}')`;
            return `<div class="lyrics-picker-item" onclick="${action}">${escapeHtmlLyrics(entry.name)}${badge}</div>`;
        }).join('');
        dropdown.innerHTML = html;
    }

    // 定位在按鈕下方
    const rect = btn.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
    dropdown.style.zIndex = '10000';

    document.body.appendChild(dropdown);

    // 點選外部關閉
    setTimeout(() => {
        document.addEventListener('click', closeLyricsPickerOutside);
    }, 10);
}

function closeLyricsPickerOutside(e) {
    const dropdown = document.getElementById('lyrics-picker-dropdown');
    const btn = document.getElementById('bgm-lyrics-pick-btn');
    if (dropdown && !dropdown.contains(e.target) && e.target !== btn) {
        dropdown.remove();
        document.removeEventListener('click', closeLyricsPickerOutside);
    }
}

/**
 * 從選擇器載入歌詞並播放（舊版 library 格式）
 */
function pickerSelectLyrics(id) {
    const dropdown = document.getElementById('lyrics-picker-dropdown');
    if (dropdown) dropdown.remove();
    document.removeEventListener('click', closeLyricsPickerOutside);

    // 停止現有播放
    if (lyricsActive) {
        stopLyrics();
        updateLyricsPlayBtn(false);
    }

    // 載入歌詞
    loadLyricsFromLibrary(id);

    // 等一幀後播放
    requestAnimationFrame(() => {
        if (!lyricsActive) {
            toggleLyricsPlayback();
        }
    });
}

/**
 * 從選擇器載入 lyrics_data_* 格式歌詞並播放
 * @param {string} name - 歌名
 */
function pickerSelectLyricsData(name) {
    const dropdown = document.getElementById('lyrics-picker-dropdown');
    if (dropdown) dropdown.remove();
    document.removeEventListener('click', closeLyricsPickerOutside);

    // 停止現有播放
    if (lyricsActive) {
        stopLyrics();
        updateLyricsPlayBtn(false);
    }

    // 載入歌詞
    loadLyrics(name);

    // 等一幀後播放
    requestAnimationFrame(() => {
        if (!lyricsActive) {
            toggleLyricsPlayback();
        }
    });
}

/**
 * 從選擇器停止歌詞
 */
function pickerStopLyrics() {
    const dropdown = document.getElementById('lyrics-picker-dropdown');
    if (dropdown) dropdown.remove();
    document.removeEventListener('click', closeLyricsPickerOutside);

    stopLyrics();
    updateLyricsPlayBtn(false);
    if (typeof myRole !== 'undefined' && myRole === 'st') {
        syncLyricsStop();
    }
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
    const linePause = pauseSlider ? parseInt(pauseSlider.value) : LYRICS_LINE_PAUSE_MS;
    const hasTimestamps = Object.keys(lyricsPerLineTimestamps).length > 0;

    syncLyricsState({
        action: 'play',
        text: text,
        speed: speed,
        linePause: linePause,
        loop: true,
        timestamps: hasTimestamps ? lyricsPerLineTimestamps : null,
        perLineSpeeds: Object.keys(lyricsPerLineSpeeds).length > 0 ? lyricsPerLineSpeeds : null,
        syncOffset: lyricsSyncOffset,
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

        // 使用 ST 傳來的 syncOffset（玩家端統一使用 ST 的設定）
        if (data.syncOffset !== undefined) {
            lyricsSyncOffset = data.syncOffset;
        }

        // 設定同步過來的逐行數據（複製避免污染來源物件）
        lyricsPerLineTimestamps = data.timestamps ? { ...data.timestamps } : {};
        lyricsPerLineSpeeds = data.perLineSpeeds ? { ...data.perLineSpeeds } : {};

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

// ===== 舊資料自動遷移 =====

/**
 * 將舊版 limbus_lyrics_library 資料遷移到新版格式
 * 舊版金鑰：limbus_lyrics_library (陣列)
 * 新版金鑰：lyrics_data_${name} (每首歌獨立儲存)
 */
function migrateLegacyLyricsData() {
    try {
        const legacyData = localStorage.getItem('limbus_lyrics_library');
        if (!legacyData) return;

        const library = safeParse(legacyData);
        if (!Array.isArray(library) || library.length === 0) {
            // 無法解析或為空，備份後移除，避免反覆嘗試
            localStorage.setItem('limbus_lyrics_library_backup', legacyData);
            localStorage.removeItem('limbus_lyrics_library');
            console.warn('Lyrics: 舊資料格式無法解析，已備份至 limbus_lyrics_library_backup');
            return;
        }

        let migratedCount = 0;
        library.forEach(item => {
            // 逐筆防呆：跳過無效項目，不中斷迴圈
            if (!item || typeof item !== 'object' || !item.name) return;

            try {
                // 取得時間軸資料（相容不同欄位名稱）
                const timelineData = item.timeline || item.data || item.timestamps || null;

                // 組合新版金鑰並儲存
                const newKey = 'lyrics_data_' + item.name;

                // 組合要儲存的資料（保留原始項目的所有欄位）
                const migratedEntry = {
                    name: item.name,
                    text: item.text || '',
                    timeline: timelineData,
                    timestamps: item.timestamps || null,
                    perLineSpeeds: item.perLineSpeeds || null,
                    speed: item.speed || LYRICS_DEFAULT_SPEED,
                    linePause: item.linePause || LYRICS_LINE_PAUSE_MS,
                    migratedAt: Date.now()
                };

                localStorage.setItem(newKey, JSON.stringify(migratedEntry));
                console.log('成功遷移歌曲：' + item.name);
                migratedCount++;
            } catch (itemErr) {
                console.warn('Lyrics: 遷移單筆資料失敗，跳過', item, itemErr);
            }
        });

        // 備份舊金鑰，避免重複遷移
        localStorage.setItem('limbus_lyrics_library_backup', legacyData);
        localStorage.removeItem('limbus_lyrics_library');

        if (migratedCount > 0 && typeof showToast === 'function') {
            showToast('舊版歌詞資料已成功救回！（共 ' + migratedCount + ' 首）');
        }
        console.log('Lyrics: 舊資料遷移完成，共遷移 ' + migratedCount + ' 首歌曲');
    } catch (e) {
        console.error('Lyrics: 舊資料遷移失敗', e);
    }
}

// ===== 掛載關鍵函式到 window（確保 HTML onclick 可呼叫）=====
window.toggleLyricsPicker = toggleLyricsPicker;
window.toggleLyricPicker = toggleLyricsPicker; // 相容別名（無 s）
window.toggleLyricsPlayback = toggleLyricsPlayback;
window.saveLyricsToLibrary = saveLyricsToLibrary;
window.loadLyricsFromLibrary = loadLyricsFromLibrary;
window.deleteLyricsFromLibrary = deleteLyricsFromLibrary;
window.loadLyrics = loadLyrics;
window.deleteLyrics = deleteLyrics;
window.getSavedLyricsList = getSavedLyricsList;
window.pickerSelectLyrics = pickerSelectLyrics;
window.pickerSelectLyricsData = pickerSelectLyricsData;
window.pickerStopLyrics = pickerStopLyrics;
window.importJsonTimeline = importJsonTimeline;
window.toggleRecording = toggleRecording;
window.clearRecording = clearRecording;
window.handleLyricsUpdate = handleLyricsUpdate;

// 頁面載入後初始化歌詞 UI
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLyricsUI);
} else {
    initLyricsUI();
}

console.log('Lyrics: 雙欄循環式動態歌詞系統已載入');

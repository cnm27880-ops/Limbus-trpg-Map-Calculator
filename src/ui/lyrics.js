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
            setTimeout(typeNext, charIntervalMs);
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

console.log('Lyrics: 雙欄循環式動態歌詞系統已載入');

/**
 * Limbus Command - 動態歌詞系統
 * 含 Tap Tempo (點擊測速) 功能
 * 透過按鍵盤自動計算 BPM 並套用最佳打字機速度
 */

// ===== 全域變數 =====
let tapTimes = [];
let detectedCharDelay = null;
let lyricsInterval = null;
let lyricsPlaying = false;

/**
 * 處理 Tap Tempo 點擊
 * 計算 BPM 並換算打字速度
 */
function handleTap() {
    const now = Date.now();
    const tapBtn = document.getElementById('tap-btn');
    const bpmDisplay = document.getElementById('tap-bpm-display');

    // 超時重置：距離上次點擊超過 2 秒，清空重新計算
    if (tapTimes.length > 0 && (now - tapTimes[tapTimes.length - 1]) > 2000) {
        tapTimes = [];
    }

    // 紀錄時間，只保留最後 5 次
    tapTimes.push(now);
    if (tapTimes.length > 5) {
        tapTimes.shift();
    }

    // 按鈕閃爍回饋
    if (tapBtn) {
        tapBtn.classList.add('tap-flash');
        setTimeout(() => tapBtn.classList.remove('tap-flash'), 150);
    }

    // 至少需要 2 次點擊才能計算
    if (tapTimes.length < 2) {
        if (bpmDisplay) bpmDisplay.textContent = 'BPM: 再按一下...';
        return;
    }

    // 計算每次點擊的間隔平均值 (ms)
    let totalInterval = 0;
    for (let i = 1; i < tapTimes.length; i++) {
        totalInterval += tapTimes[i] - tapTimes[i - 1];
    }
    const avgInterval = totalInterval / (tapTimes.length - 1);

    // 換算 BPM
    const bpm = Math.round(60000 / avgInterval);

    // 換算打字速度：平均間隔 / 4（假設一個拍子出現 4 個字）
    detectedCharDelay = Math.round(avgInterval / 4);

    // 更新 UI
    if (bpmDisplay) {
        bpmDisplay.textContent = `BPM: ${bpm} (${detectedCharDelay}ms/字)`;
    }

    // 同步更新滑桿顯示（視覺回饋）
    const speedRange = document.getElementById('lyrics-speed-range');
    const speedValue = document.getElementById('lyrics-speed-value');
    if (speedRange) {
        const clampedDelay = Math.max(20, Math.min(300, detectedCharDelay));
        speedRange.value = clampedDelay;
    }
    if (speedValue) {
        speedValue.textContent = detectedCharDelay + 'ms';
    }
}

/**
 * 播放歌詞（打字機效果）
 * 優先使用 Tap Tempo 計算出的速度，否則使用滑桿數值
 */
function playLyrics() {
    const textArea = document.getElementById('lyrics-text');
    const display = document.getElementById('lyrics-display');
    const speedRange = document.getElementById('lyrics-speed-range');

    if (!textArea || !display) return;

    const text = textArea.value.trim();
    if (!text) {
        if (typeof showToast === 'function') showToast('請先輸入歌詞');
        return;
    }

    // 停止之前的播放
    stopLyrics();

    // 計算 charDelay：優先使用 detectedCharDelay，否則使用滑桿數值
    const charDelay = detectedCharDelay !== null
        ? detectedCharDelay
        : (speedRange ? parseInt(speedRange.value) : 80);

    // 開始打字機效果
    lyricsPlaying = true;
    display.textContent = '';
    display.style.display = 'block';

    let index = 0;
    lyricsInterval = setInterval(() => {
        if (index < text.length) {
            display.textContent += text[index];
            index++;
            // 自動捲動到底部
            display.scrollTop = display.scrollHeight;
        } else {
            // 播放結束
            clearInterval(lyricsInterval);
            lyricsInterval = null;
            lyricsPlaying = false;
        }
    }, charDelay);
}

/**
 * 停止歌詞播放
 */
function stopLyrics() {
    if (lyricsInterval) {
        clearInterval(lyricsInterval);
        lyricsInterval = null;
    }
    lyricsPlaying = false;

    const display = document.getElementById('lyrics-display');
    if (display) {
        display.textContent = '';
    }
}

/**
 * 切換歌詞面板顯示/隱藏
 */
function toggleLyricsPanel() {
    const panel = document.getElementById('lyrics-control-panel');
    if (!panel) return;

    const isExpanded = panel.classList.contains('expanded');

    if (!isExpanded) {
        panel.classList.add('expanded');

        // 關閉其他面板
        const musicPanel = document.getElementById('music-player-panel');
        if (musicPanel && musicPanel.classList.contains('expanded')) {
            musicPanel.classList.remove('expanded');
        }
        const hotkeyPanel = document.getElementById('hotkey-help');
        if (hotkeyPanel && !hotkeyPanel.classList.contains('hidden')) {
            hotkeyPanel.classList.add('hidden');
        }
    } else {
        panel.classList.remove('expanded');
    }
}

// ===== 鍵盤監聽 =====
document.addEventListener('keydown', function (e) {
    // 當按下 'T' 鍵且焦點不在輸入框/文字區域時，觸發 handleTap()
    if ((e.key === 't' || e.key === 'T') &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        handleTap();
    }
});

// ===== 滑桿即時更新顯示 =====
document.addEventListener('DOMContentLoaded', function () {
    const speedRange = document.getElementById('lyrics-speed-range');
    const speedValue = document.getElementById('lyrics-speed-value');

    if (speedRange && speedValue) {
        speedRange.addEventListener('input', function () {
            speedValue.textContent = this.value + 'ms';
            // 手動調整滑桿時，清除 Tap Tempo 偵測值
            detectedCharDelay = null;
            const bpmDisplay = document.getElementById('tap-bpm-display');
            if (bpmDisplay) bpmDisplay.textContent = 'BPM: --';
        });
    }
});

console.log('Lyrics: 動態歌詞系統已載入 (含 Tap Tempo)');

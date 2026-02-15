#!/usr/bin/env python3
"""
Limbus Command - AI 音樂節拍分析腳本
使用 librosa 自動偵測音樂節拍/重音，將台詞分配到最佳時間點。

用法：
    python auto_sync.py <音訊檔案> <台詞文字檔>

輸出：
    JSON 格式的時間軸資料，可直接貼入網頁端匯入。

依賴：
    pip install librosa numpy
"""

import sys
import json
import numpy as np

try:
    import librosa
except ImportError:
    print("錯誤：請先安裝 librosa：pip install librosa numpy", file=sys.stderr)
    sys.exit(1)


def load_lines(text_path):
    """讀取台詞文字檔，一行一句，過濾空行"""
    with open(text_path, 'r', encoding='utf-8') as f:
        lines = [line.strip() for line in f if line.strip()]
    return lines


def analyze_audio(audio_path):
    """
    載入音訊並偵測重音 (onsets) 及其能量強度。
    回傳 (onset_times, onset_strengths)。
    """
    # 載入音訊（自動轉為 mono、重採樣到 22050 Hz）
    y, sr = librosa.load(audio_path, sr=22050)
    duration = librosa.get_duration(y=y, sr=sr)
    print(f"音訊長度：{duration:.1f} 秒", file=sys.stderr)

    # 計算 onset strength envelope
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)

    # 偵測 onset 位置（frame indices）
    onset_frames = librosa.onset.onset_detect(
        y=y, sr=sr, onset_envelope=onset_env, backtrack=False
    )

    # 轉換 frame → 秒
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)

    # 取得每個 onset 的 strength
    onset_strengths = onset_env[onset_frames] if len(onset_frames) > 0 else np.array([])

    print(f"偵測到 {len(onset_times)} 個重音點", file=sys.stderr)
    return onset_times, onset_strengths, duration


def select_best_points(onset_times, onset_strengths, n_lines, duration):
    """
    從大量 onset 中選出 n_lines 個最佳時間點。

    策略：將音訊分成 n_lines 個等長區段，在每個區段中
    選出能量最強的 onset，確保台詞平均分布且落在重拍上。
    """
    if len(onset_times) == 0:
        # 無 onset 偵測結果，改用均勻分布
        print("警告：未偵測到 onset，使用均勻分布", file=sys.stderr)
        return np.linspace(0.5, duration - 1.0, n_lines)

    if len(onset_times) <= n_lines:
        # onset 數量不足，直接全用，不足的部分用均勻分布補上
        selected = list(onset_times)
        if len(selected) < n_lines:
            extra = np.linspace(0.5, duration - 1.0, n_lines - len(selected) + 2)[1:-1]
            selected.extend(extra.tolist())
        return np.sort(selected[:n_lines])

    # 將時間軸分成 n_lines 個等長區段
    segment_edges = np.linspace(0, duration, n_lines + 1)
    selected_times = []

    for i in range(n_lines):
        seg_start = segment_edges[i]
        seg_end = segment_edges[i + 1]

        # 找出落在此區段內的 onset
        mask = (onset_times >= seg_start) & (onset_times < seg_end)
        segment_indices = np.where(mask)[0]

        if len(segment_indices) > 0:
            # 選此區段中能量最強的 onset
            best_idx = segment_indices[np.argmax(onset_strengths[segment_indices])]
            selected_times.append(float(onset_times[best_idx]))
        else:
            # 此區段沒有 onset，用區段中點
            selected_times.append(float((seg_start + seg_end) / 2))

    return np.array(selected_times)


def main():
    if len(sys.argv) < 3:
        print("用法：python auto_sync.py <音訊檔案> <台詞文字檔>")
        print("範例：python auto_sync.py bgm.mp3 lyrics.txt")
        sys.exit(1)

    audio_path = sys.argv[1]
    text_path = sys.argv[2]

    # 讀取台詞
    lines = load_lines(text_path)
    if not lines:
        print("錯誤：台詞檔為空", file=sys.stderr)
        sys.exit(1)
    print(f"台詞行數：{len(lines)}", file=sys.stderr)

    # 分析音訊
    onset_times, onset_strengths, duration = analyze_audio(audio_path)

    # 選擇最佳時間點
    best_times = select_best_points(onset_times, onset_strengths, len(lines), duration)

    # 組合結果
    timeline = []
    for t, text in zip(best_times, lines):
        timeline.append({
            "time": round(float(t), 2),
            "text": text,
            "speed": 80  # 預設速度 (ms/字)，可在網頁端微調
        })

    # 輸出 JSON
    print(json.dumps(timeline, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

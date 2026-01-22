# Limbus Command - 專案結構說明

## 📁 目錄結構

本專案已重構為分層架構，以提高程式碼的可維護性和可擴展性。

```
Limbus-trpg-Map-Calculator/
├── index.html                 # 主頁面入口
│
├── src/                       # 原始碼目錄
│   ├── config/               # 配置層 - 系統配置與常數定義
│   │   ├── config.js        # 地圖預設、防禦類型等遊戲配置
│   │   ├── status-config.js # 狀態效果資料庫
│   │   └── firebase-config.js # Firebase 初始化配置
│   │
│   ├── core/                # 核心業務邏輯層
│   │   ├── state.js         # 全局狀態管理
│   │   ├── calculator.js    # DP 計算、BOSS 計算邏輯
│   │   ├── map-manager.js   # 地圖儲存、載入、匯入匯出
│   │   └── status-manager.js # 狀態效果管理邏輯
│   │
│   ├── data/                # 資料訪問層
│   │   ├── storage.js       # 本地存儲適配器 (localStorage)
│   │   ├── firebase-connection.js # Firebase 多人同步
│   │   └── connection.js    # 舊版 P2P 連線 (保留)
│   │
│   ├── ui/                  # UI 層 - 用戶界面與互動
│   │   ├── main.js          # 應用入口、快速操作球
│   │   ├── map.js           # 地圖渲染與互動
│   │   ├── units.js         # 單位列表渲染與操作
│   │   ├── modals.js        # 彈窗管理
│   │   ├── camera.js        # 地圖視角控制
│   │   ├── hotkeys.js       # 快捷鍵系統
│   │   └── combat-hud.js    # 戰鬥儀表板
│   │
│   └── utils/               # 工具函式層
│       ├── utils.js         # 通用工具函式
│       └── audio.js         # 音樂播放管理
│
├── styles/                  # 樣式檔案
│   ├── main.css            # 主要樣式
│   ├── components.css      # 組件樣式
│   ├── calculator.css      # 計算器樣式
│   └── combat-hud.css      # 戰鬥儀表板樣式
│
└── assets/                  # 靜態資源
    ├── images/             # 圖片資源
    │   └── boss_frame.png
    └── audio/              # 音樂資源
        ├── Cave #2  Ambience  Sound Effect - CNV Sound (youtube).mp3
        ├── Relaxing Deltarune Music - A Quiet Respite - Osirois Music (youtube).mp3
        └── Trevor and Sypha vs. Hell Demons  Castlevania Season 3 - Ultra Epic Remake - CJ Music (youtube).mp3
```

## 🏗️ 架構分層說明

### 1. 配置層 (src/config/)
**職責**: 定義系統配置、常數、預設值
- 不依賴其他層級
- 僅包含純數據定義
- 全局可訪問

**檔案**:
- `config.js`: 地圖預設、防禦類型、連線配置等
- `status-config.js`: 狀態效果資料庫 (100+ 種狀態)
- `firebase-config.js`: Firebase 初始化設定

### 2. 核心層 (src/core/)
**職責**: 業務邏輯處理、狀態管理
- 獨立於 UI 層，可單獨測試
- 處理遊戲規則、計算、驗證
- 依賴配置層

**檔案**:
- `state.js`: 全局狀態變數與狀態操作函式
- `calculator.js`: DP 計算、破甲、破魔等戰鬥計算
- `map-manager.js`: 地圖 CRUD 操作、JSON 匯入匯出
- `status-manager.js`: 狀態效果的添加、刪除、搜索

### 3. 資料層 (src/data/)
**職責**: 數據持久化與同步
- 封裝存儲細節
- 處理網絡通信與資料同步
- 依賴核心層

**檔案**:
- `storage.js`: localStorage 操作 (房間、用戶資料)
- `firebase-connection.js`: Firebase 即時同步、房間管理
- `connection.js`: 舊版 PeerJS P2P 連線 (已棄用)

### 4. UI 層 (src/ui/)
**職責**: 用戶界面渲染與互動
- 處理 DOM 操作與事件
- 調用核心層函式
- 依賴核心層與工具層

**檔案**:
- `main.js`: 應用初始化、快速操作球 (QAB)
- `map.js`: 地圖畫布渲染、拖曳、地形編輯
- `units.js`: 單位列表顯示、HP 修改、頭像上傳
- `modals.js`: 各種彈窗的初始化與管理
- `camera.js`: 地圖縮放、平移、觸控操作
- `hotkeys.js`: 鍵盤快捷鍵處理
- `combat-hud.js`: Google Sheets 整合的戰鬥面板

### 5. 工具層 (src/utils/)
**職責**: 通用輔助函式
- 可被任何層級使用
- 無狀態、可重用
- 不依賴其他業務邏輯

**檔案**:
- `utils.js`: HTML 轉義、Toast 通知、ID 複製等
- `audio.js`: 音樂播放器、雲端 URL 轉換

### 6. 樣式層 (styles/)
**職責**: UI 外觀定義
- CSS 變數定義 (顏色、尺寸)
- 響應式設計
- 動畫效果

### 7. 靜態資源 (assets/)
**職責**: 圖片、音樂等素材
- 圖片資源 (images/)
- 音樂資源 (audio/)

## 📊 依賴關係圖

```
┌─────────────────────────────────────────────────────┐
│                    index.html                       │
│                   (頁面入口)                        │
└──────────┬──────────────────────────────────────────┘
           │
    ┌──────▼──────┐
    │   配置層     │ ← 無依賴
    │  (config/)   │
    └──────┬───────┘
           │
    ┌──────▼──────┐
    │   核心層     │ ← 依賴配置層
    │   (core/)    │
    └──┬───────┬───┘
       │       │
   ┌───▼───┐ ┌▼────────┐
   │ 資料層 │ │ 工具層  │ ← 依賴核心層 / 無依賴
   │(data/) │ │(utils/) │
   └───┬────┘ └─────────┘
       │
   ┌───▼──────┐
   │  UI 層   │ ← 依賴核心、資料、工具層
   │  (ui/)   │
   └──────────┘
```

## 🔄 載入順序

`index.html` 中的腳本載入順序已優化為分層載入：

1. **配置層** - 提供全局配置
2. **核心層** - 初始化狀態管理
3. **工具層** - 提供輔助函式
4. **資料層** - 建立連線與存儲
5. **UI 層** - 渲染界面與綁定事件

⚠️ **重要**: 不可隨意調整載入順序，否則會導致依賴錯誤！

## 🎯 設計原則

### 1. 單一職責原則 (SRP)
每個檔案只負責一個功能領域

### 2. 依賴倒置原則 (DIP)
高層模組不直接依賴低層模組的實現細節

### 3. 開放封閉原則 (OCP)
對擴展開放，對修改封閉

### 4. 關注點分離 (SoC)
UI、業務邏輯、資料訪問分層管理

## 🔧 開發指南

### 添加新功能時的建議

1. **新增配置**: 在 `src/config/` 中添加常數定義
2. **業務邏輯**: 在 `src/core/` 中實作核心功能
3. **資料操作**: 在 `src/data/` 中處理存儲與同步
4. **UI 渲染**: 在 `src/ui/` 中實現界面與互動
5. **工具函式**: 通用函式放在 `src/utils/`

### 修改現有功能

- 先定位功能所屬的層級
- 在對應的檔案中修改
- 測試相關功能是否正常

### 檔案命名規範

- 使用小寫字母與連字號 (kebab-case)
- 檔案名應清楚描述其功能
- 範例: `status-manager.js`, `firebase-connection.js`

## 📝 維護注意事項

1. **保持分層清晰**: 不要在 UI 層直接操作 Firebase
2. **避免循環依賴**: 若 A 依賴 B，則 B 不可依賴 A
3. **集中配置管理**: 所有配置應在 config/ 中定義
4. **權限檢查統一**: 使用 `state.js` 中的 `canControlUnit()`

## 🚀 下一步優化建議

- [ ] 將重複的權限檢查邏輯提取到 `permission-service.js`
- [ ] 實作 Service 層 (`UnitService`, `MapService`)
- [ ] 添加單元測試框架
- [ ] 遷移到 TypeScript 以提高類型安全
- [ ] 考慮引入前端框架 (Vue/React) 進行 UI 重構

---

**重構完成日期**: 2026-01-16
**重構目標**: 提高程式碼可維護性，建立清晰的分層架構
**相容性**: 完全向後兼容，不影響現有功能

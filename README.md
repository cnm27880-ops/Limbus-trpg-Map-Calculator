# Limbus Command v7.5

TRPG 戰術指揮系統，支援即時多人連線、地圖編輯、單位管理與 DP 計算。

## 📁 專案結構

```
limbus-command/
├── index.html              # 主要 HTML 檔案
├── README.md               # 說明文件
├── css/
│   ├── main.css            # 主要樣式（版面、變數）
│   ├── components.css      # 元件樣式（Token、單位卡片、Modal）
│   └── calculator.css      # 計算器專用樣式
└── js/
    ├── config.js           # 配置（地圖預設、防禦類型）
    ├── state.js            # 狀態管理
    ├── utils.js            # 工具函數
    ├── connection.js       # PeerJS 連線管理
    ├── camera.js           # 相機控制（平移、縮放、Token拖曳）
    ├── map.js              # 地圖模組
    ├── units.js            # 單位模組
    ├── calculator.js       # DP 計算器
    ├── modals.js           # Modal 彈窗
    └── main.js             # 主程式進入點
```

## 🔧 模組說明

### CSS 模組

| 檔案 | 說明 |
|------|------|
| `main.css` | CSS 變數、基礎樣式、版面配置、RWD |
| `components.css` | Token、單位卡片、HP 條、Modal 樣式 |
| `calculator.css` | 計算器頁面、BOSS 模式、防禦標籤 |

### JS 模組

| 檔案 | 說明 | 主要函數 |
|------|------|----------|
| `config.js` | 常數定義 | `MAP_PRESETS`, `DEF_TYPES`, `CONNECTION_CONFIG` |
| `state.js` | 全域狀態 | `state`, `cam`, 各種 flag 變數 |
| `utils.js` | 工具函數 | `showToast()`, `escapeHtml()`, `createUnit()` |
| `connection.js` | 連線管理 | `initSystem()`, `broadcastState()`, `handleSTMessage()` |
| `camera.js` | 相機控制 | `initCameraEvents()`, `startTokenDrag()`, `resetCamera()` |
| `map.js` | 地圖功能 | `renderMap()`, `setTool()`, `handleMapInput()` |
| `units.js` | 單位功能 | `renderAll()`, `modifyHP()`, `nextTurn()` |
| `calculator.js` | 計算器 | `calculateDP()`, `updateBossSummary()` |
| `modals.js` | 彈窗 | `openAddUnitModal()`, `confirmAddUnit()` |
| `main.js` | 進入點 | DOMContentLoaded 初始化 |

## 🚀 使用方式

### 本地開發
直接用瀏覽器開啟 `index.html`，或使用本地伺服器：

```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```

### 部署到 GitHub Pages
1. 將所有檔案推送到 GitHub 倉庫
2. 進入 Settings > Pages
3. 選擇分支（通常是 `main`）並儲存
4. 等待部署完成

## 📝 修改指南

### 新增地圖主題
編輯 `js/config.js` 中的 `MAP_PRESETS` 陣列：

```javascript
{
    name: "新主題名稱",
    tiles: [
        { id: 90, color: '#ff0000', name: '地形名', effect: '效果說明' },
        // ...
    ]
}
```

### 新增防禦類型
編輯 `js/config.js` 中的 `DEF_TYPES` 陣列：

```javascript
{ id: 'newDef', name: '新防禦', type: 'physical' }
```

### 調整樣式
- 全域顏色變數在 `css/main.css` 的 `:root` 區塊
- Token 樣式在 `css/components.css`
- 計算器樣式在 `css/calculator.css`

### 修改連線邏輯
主要在 `js/connection.js`：
- `initSystem()` - 初始化連線
- `handleSTMessage()` - ST 處理玩家訊息
- `handlePlayerMessage()` - 玩家處理 ST 訊息

## ⚠️ 注意事項

1. **JS 載入順序很重要**，必須依照 `index.html` 中的順序載入
2. 使用 PeerJS 進行 P2P 連線，需要網路連線
3. 狀態透過 `localStorage` 保存 Session 資訊

## 📋 更新日誌

### v7.5
- 模組化重構
- 分離 CSS 與 JS
- 改善程式碼組織

### v7.4
- 多人連線支援
- BOSS 模式計算
- 8 種地圖主題

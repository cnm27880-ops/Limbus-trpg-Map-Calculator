# Limbus Command v7.5 - Firebase 版本使用說明

## 🎉 歡迎使用 Firebase 版本！

此版本已從 P2P (PeerJS) 架構升級為 **Firebase Realtime Database**，解決了以下問題：
- ✅ **房間持久化**：房主離線後房間依然存在
- ✅ **穩定性提升**：不再依賴 P2P 連線品質
- ✅ **防止黑屏**：完善的資料載入機制
- ✅ **4位數房號**：更簡潔的房間識別系統

---

## 📝 快速開始

### 步驟一：設定 Firebase

1. **閱讀設定教學**
   - 開啟 `FIREBASE_SETUP.md` 檔案
   - 按照步驟建立 Firebase 專案並獲取配置

2. **建立配置檔案**
   - 將 `firebase-config.js.template` 複製並重新命名為 `firebase-config.js`
   - 貼上您從 Firebase Console 複製的配置
   - 確保 `databaseURL` 欄位正確（很重要！）

3. **確認檔案結構**
   ```
   專案根目錄/
   ├── index.html
   ├── firebase-config.js  ← 您剛建立的配置檔
   ├── firebase-connection.js
   ├── FIREBASE_SETUP.md
   └── 其他檔案...
   ```

### 步驟二：啟動應用

1. 使用任何本地伺服器開啟 `index.html`（不能直接雙擊開啟）
   - VS Code：使用 Live Server 擴充功能
   - Python：`python -m http.server 8000`
   - Node.js：`npx http-server`

2. 開啟瀏覽器的開發者工具（F12），查看 Console
   - 應該看到：`✅ Firebase 已成功初始化`
   - 如果看到錯誤，請檢查 `firebase-config.js` 是否正確

---

## 🎮 使用方式

### 作為 ST（房主）

1. 點擊「我是 ST（建房）」
2. 輸入您的代號（顯示名稱）
3. **選填**：輸入 4 位數識別碼（例如：1234）
   - 留空會自動生成隨機號碼
   - 輸入已存在的號碼可恢復舊房間
4. 點擊「建立房間」
5. 記下顯示的房間號碼，分享給玩家

### 作為玩家

1. 點擊「我是玩家（加入）」
2. 輸入您的代號（顯示名稱）
3. 輸入 ST 提供的 4 位數房間號碼
4. **選填**：輸入您的 4 位數識別碼（用於跨裝置識別）
5. 點擊「連線」

---

## 🔧 新功能與變更

### 新功能
- **房間持久化**：即使所有人離線，房間資料仍保存在雲端
- **即時同步**：所有操作自動同步到所有連線的裝置
- **離線保護**：網頁關閉前會自動保存狀態
- **防呆機制**：資料未載入時顯示載入畫面，不會黑屏

### 主要變更
- 不再使用 PeerJS，移除了 P2P 連線相關功能
- 房間 ID 改為 4 位數字，更易記憶
- 連線邏輯完全重寫，但使用方式保持相同
- 地圖繪製時使用節流機制，減少資料庫寫入次數

---

## ⚠️ 注意事項

### 安全性
- **測試模式**：預設的 Firebase 規則允許任何人讀寫
- **正式上線前**：務必修改 Firebase 安全規則（見 FIREBASE_SETUP.md）
- **不要公開**：firebase-config.js 包含您的 API 金鑰，不要上傳到公開儲存庫

### 資料管理
- Firebase 免費方案有以下限制：
  - **儲存空間**：1 GB
  - **同時連線**：100 個
  - **下載流量**：10 GB/月
- 定期清理不使用的房間以節省空間
- 可在 Firebase Console 中手動刪除舊房間資料

### 效能優化
- 地圖繪製時，資料會延遲 500ms 才同步（減少寫入次數）
- 建議房間號碼不要過於簡單（例如：0000, 1234），避免被他人猜中

---

## 🐛 常見問題

### Q: 網頁載入後顯示「正在讀取房間資料...」
**A:** 可能的原因：
1. Firebase 配置錯誤 → 檢查 `firebase-config.js`
2. 網路連線問題 → 檢查您的網路
3. Firebase 規則過於嚴格 → 確認已啟用測試模式
4. 使用 `file://` 協議 → 必須使用 HTTP 伺服器開啟

### Q: 修改地圖後其他玩家看不到
**A:**
1. 確認其他玩家的網頁已連線（連線狀態顯示「已連線」）
2. 檢查 Firebase Console 中資料是否有更新
3. 嘗試重新整理其他玩家的頁面

### Q: 房間號碼相同但進入不同房間
**A:** 這是舊版 P2P 的問題，Firebase 版本已解決。確保您使用的是 Firebase 版本：
- 網頁標題應顯示「Limbus Command v7.5 (Firebase)」
- Console 中應有「✅ Firebase 已成功初始化」訊息

### Q: 如何刪除舊房間？
**A:**
1. 前往 Firebase Console
2. 選擇您的專案
3. 進入 Realtime Database
4. 找到 `rooms/房間號碼` 並刪除

---

## 📊 資料結構

Firebase 中的資料結構如下：

```
rooms/
  ├── 1234/  (房間號碼)
  │   ├── info/
  │   │   ├── stName: "主持人名稱"
  │   │   ├── createdAt: 時間戳
  │   │   └── lastActive: 時間戳
  │   ├── mapData/
  │   │   └── (地圖資料陣列)
  │   ├── units/
  │   │   └── (單位物件)
  │   ├── state/
  │   │   ├── mapW: 15
  │   │   ├── mapH: 15
  │   │   ├── themeId: 0
  │   │   └── turnIdx: 0
  │   └── players/
  │       └── (玩家列表)
  └── 5678/  (另一個房間)
      └── ...
```

---

## 🔄 從 P2P 版本遷移

如果您之前使用 P2P 版本：

1. **資料無法自動遷移**：P2P 版本的本地儲存與 Firebase 不相容
2. **重新建立房間**：需要在 Firebase 版本中重新建立房間
3. **檔案變更**：
   - ✅ 保留：`index.html`, `main.css`, `calculator.js` 等
   - ✅ 新增：`firebase-config.js`, `firebase-connection.js`
   - ⚠️ 不使用：`connection.js` (已被 `firebase-connection.js` 替代)

---

## 📞 支援與回報

如遇到問題：
1. 檢查瀏覽器 Console 的錯誤訊息
2. 確認 Firebase 配置正確
3. 查看 `FIREBASE_SETUP.md` 的常見問題章節
4. 在專案儲存庫開啟 Issue

---

## 📜 版本歷史

### v7.5 Firebase 版 (2024)
- 🎉 改用 Firebase Realtime Database
- ✅ 修復黑屏問題
- ✅ 修復變數重複宣告錯誤
- ✅ 加入防呆機制
- ✅ 優化地圖同步效能

### v7.5 P2P 版 (2024)
- 使用 PeerJS 進行點對點連線
- 本地儲存房間資料

---

**祝您遊戲愉快！🎲**

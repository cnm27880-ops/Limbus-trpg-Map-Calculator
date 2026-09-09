# Claude Development Guide: Limbus TRPG Map Calculator

## 1. Token 節省與核心操作準則 (Token-Saving Rules)
- **禁止全檔案重寫**：修改既有檔案時，僅提供變更程式碼區塊（Diff 格式或具體函式片段），絕不輸出完整檔案。
- **精準讀取限制**：
  - 嚴禁讀取、掃描或解析 `assets/audio/` 目錄下的二進位檔案。
  - 除非使用者明確要求，否則不讀取 `FIREBASE_SETUP.md`、`README_FIREBASE.md` 等非程式碼文件。
  - 優先請使用者提供特定模組/函式名稱，僅針對目標程式碼進行檢視與修改。
- **簡明回應風格**：省略開場客套話與多餘解說，直接提供修改方案、程式碼片段及必要的 1-2 句關鍵說明。

---

## 2. 專案架構概覽 (Project Overview)
- **專案名稱**：Limbus TRPG 地圖計算機 (Limbus-trpg-Map-Calculator)
- **類型**：純前端靜態 Web 應用程式 (HTML/CSS/JavaScript 或輕量 SPA)
- **部署方式**：GitHub Pages (經由 `.github/workflows/static.yml` 自動部署)
- **後端/雲端服務**：Firebase (認證/資料庫設定可參閱 `FIREBASE_SETUP.md`)
- **關鍵目錄與檔案**：
  - `.github/workflows/static.yml`：CI/CD 部署流程配置。
  - `assets/audio/`：多媒體音效資源目錄（**絕對忽略**）。
  - `PROJECT_STRUCTURE.md`：模組架構說明。

---

## 3. 開發與修改規範 (Coding Guidelines)
- **修改流程**：
  1. 變更前確認受影響的檔案路徑。
  2. 僅針對邏輯發生變動的函式輸出。
  3. 保留原有縮排與變數命名規則，避免無關的格式重排。
- **防禦性程式碼**：確保音效播放邏輯若找不到音訊檔不會引發致命例外（Fatal Error），保持靜態網頁獨立運作之彈性。

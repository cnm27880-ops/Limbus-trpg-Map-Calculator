# Firebase 整合教學

## 📋 目錄
1. [建立 Firebase 專案](#第一步建立-firebase-專案)
2. [獲取配置程式碼](#第二步獲取配置程式碼)
3. [整合到專案中](#第三步整合到專案中)
4. [理解資料結構](#第四步理解資料結構)

---

## 第一步：建立 Firebase 專案

### 1.1 前往 Firebase Console
1. 打開瀏覽器，前往 https://console.firebase.google.com/
2. 使用您的 Google 帳號登入（如果沒有帳號，請先註冊一個）

### 1.2 建立新專案
1. 點擊「新增專案」或「Create a project」按鈕
2. 輸入專案名稱，例如：`limbus-trpg-map`
3. 點擊「繼續」
4. **關閉** Google Analytics（新手不需要，可以節省設定步驟）
5. 點擊「建立專案」，等待約 30 秒

### 1.3 啟用 Realtime Database
1. 在 Firebase 控制台左側選單，找到「建構」→「Realtime Database」
2. 點擊「建立資料庫」
3. 選擇資料庫位置（建議選擇 **asia-southeast1 (新加坡)**，離台灣較近）
4. 選擇安全性規則：先選擇「**測試模式**」（稍後會改成更安全的規則）
5. 點擊「啟用」

---

## 第二步：獲取配置程式碼

### 2.1 註冊網頁應用程式
1. 回到 Firebase 專案總覽頁面
2. 點擊網頁圖示「</>」（在 iOS 和 Android 圖示旁邊）
3. 輸入應用程式名稱，例如：`Limbus Web App`
4. **不要勾選** Firebase Hosting（我們不需要）
5. 點擊「註冊應用程式」

### 2.2 複製配置程式碼
您會看到類似這樣的程式碼：

```javascript
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "limbus-trpg-map.firebaseapp.com",
  databaseURL: "https://limbus-trpg-map-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "limbus-trpg-map",
  storageBucket: "limbus-trpg-map.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
```

**🔴 重要：請複製整個 `firebaseConfig` 物件（包含大括號），稍後會用到！**

點擊「繼續前往控制台」

---

## 第三步：整合到專案中

### 3.1 修改 index.html

在 `index.html` 的 `<head>` 區域，**在 `<script src="https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js"></script>` 之後**，新增以下兩行：

```html
<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js"></script>
```

### 3.2 建立 firebase-config.js

在專案根目錄建立新檔案 `firebase-config.js`，貼上以下內容（記得替換成您自己的配置）：

```javascript
/**
 * Limbus Command - Firebase 配置
 * 請將以下的配置替換成您自己從 Firebase Console 複製的內容
 */

// Firebase 配置物件（從 Firebase Console 複製）
const firebaseConfig = {
  apiKey: "您的 API Key",
  authDomain: "您的專案.firebaseapp.com",
  databaseURL: "https://您的專案.firebasedatabase.app",
  projectId: "您的專案 ID",
  storageBucket: "您的專案.appspot.com",
  messagingSenderId: "您的訊息發送者 ID",
  appId: "您的應用程式 ID"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);

// 獲取 Realtime Database 參考
const database = firebase.database();

console.log('✅ Firebase 已成功初始化');
```

### 3.3 在 index.html 中載入

在 `index.html` 中，**在所有其他 JS 檔案之前**載入 Firebase 配置：

```html
<!-- Firebase 配置 - 必須在所有 JS 檔案之前載入 -->
<script src="firebase-config.js"></script>

<!-- JS 檔案 - 同一層級，順序很重要！ -->
<script src="config.js"></script>
<script src="state.js"></script>
<!-- 其他檔案... -->
```

---

## 第四步：理解資料結構

Firebase Realtime Database 使用 JSON 格式儲存資料，我們的資料結構如下：

```
limbus-trpg-map (您的專案)
└── rooms/
    ├── 1234/  (房間號碼)
    │   ├── info/
    │   │   ├── stName: "主持人名稱"
    │   │   ├── createdAt: 1234567890
    │   │   └── lastActive: 1234567890
    │   ├── mapData/  (地圖資料陣列)
    │   │   ├── 0: [0, 0, 1, 0, ...]
    │   │   ├── 1: [0, 0, 0, 0, ...]
    │   │   └── ...
    │   ├── units/  (單位列表)
    │   │   ├── unit_123/
    │   │   │   ├── name: "勇者"
    │   │   │   ├── hp: 10
    │   │   │   └── ...
    │   │   └── ...
    │   └── state/
    │       ├── mapW: 15
    │       ├── mapH: 15
    │       ├── themeId: 0
    │       └── turnIdx: 0
    └── 5678/  (另一個房間)
        └── ...
```

---

## 第五步：設定安全規則（重要！）

為了保護您的資料庫，請設定正確的安全規則：

1. 在 Firebase Console 中，進入「Realtime Database」
2. 點擊「規則」標籤
3. 將規則改為：

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

4. 點擊「發布」

**說明**：這個規則允許任何人讀寫房間資料。未來如果需要更嚴格的安全控制，可以加入驗證規則。

---

## ✅ 完成！

恭喜您完成 Firebase 設定！接下來我會幫您重寫連線邏輯，讓遊戲使用 Firebase 即時同步資料。

---

## 📝 常見問題

### Q: 我的 databaseURL 找不到怎麼辦？
A: 請確保您在步驟 1.3 已經建立了 Realtime Database。建立後，在 Database 頁面上方會顯示您的資料庫 URL。

### Q: 測試模式安全嗎？
A: 測試模式允許任何人讀寫資料，**僅適合開發階段**。正式上線前，務必修改安全規則。

### Q: 如何知道 Firebase 是否成功連線？
A: 打開瀏覽器的開發者工具（F12），在 Console 中應該會看到「✅ Firebase 已成功初始化」訊息。

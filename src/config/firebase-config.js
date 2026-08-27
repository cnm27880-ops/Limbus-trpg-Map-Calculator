/**
 * Limbus Command - Firebase 配置檔
 * 使用 Firebase Compat 版本（全域變數模式，不使用 ES6 modules）
 */

// Firebase 配置
const firebaseConfig = {
  apiKey: "AIzaSyAwACDkdakqOAT9I2bwbN0btMnGI9v_njU",
  authDomain: "limbus-map.firebaseapp.com",
  databaseURL: "https://limbus-map-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "limbus-map",
  storageBucket: "limbus-map.firebasestorage.app",
  messagingSenderId: "476759549750",
  appId: "1:476759549750:web:483948327756763ea17597",
  measurementId: "G-LB2J0DC2SB"
};

/**
 * 初始化 Firebase（Compat 版本）
 *
 * SDK 由 <head> 的 CDN <script> 提供，載入失敗時（離線、公司網路擋 gstatic.com、
 * 瀏覽器封鎖第三方腳本）這個檔案原本會直接丟出未捕捉的 ReferenceError 而整支中斷，
 * 主控台只留下一行看不出原因的錯誤。改為明確偵測並留下可讀訊息：
 * window.database 維持未定義，initSystem() 既有的 SDK 檢查會據此提示使用者。
 */
(function initFirebase() {
  if (typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function') {
    console.error('❌ Firebase SDK 未載入（CDN 被封鎖或網路不通），連線功能將無法使用；請檢查網路後重新整理頁面');
    return;
  }

  try {
    firebase.initializeApp(firebaseConfig);
    // 將 database 掛到 window，讓其他檔案可以存取
    window.database = firebase.database();
    console.log('✅ Firebase 已初始化（Compat 版本）');
  } catch (err) {
    console.error('❌ Firebase 初始化失敗：', err);
  }
})();

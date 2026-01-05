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

// 初始化 Firebase（使用 Compat 版本）
const app = firebase.initializeApp(firebaseConfig);

// 初始化 Realtime Database
const database = firebase.database();

// 將 database 掛載到 window，讓其他檔案可以存取
window.database = database;

console.log('✅ Firebase 已初始化（Compat 版本）');

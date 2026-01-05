// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-storage.js";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// IMPORTANT: Replace this with your own Firebase project's configuration
const firebaseConfig = {
  apiKey: "AIzaSyBZXzV7gFsyR0sJxWryPPcQSbw9bC9W-uY",
  authDomain: "personalevent-26da0.firebaseapp.com",
  projectId: "personalevent-26da0",
  storageBucket: "personalevent-26da0.firebasestorage.app",
  messagingSenderId: "525583057205",
  appId: "1:525583057205:web:0c291eeb45ee9effa40c7c"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAQ7sTtozmZtmuakxGUvsAFPLhEWdh3f5w",
    authDomain: "churchcalendar-20a07.firebaseapp.com",
    projectId: "churchcalendar-20a07",
    storageBucket: "churchcalendar-20a07.firebasestorage.app",
    messagingSenderId: "693277807486",
    appId: "1:693277807486:web:d3486bb05be6744ff9d92f",
    measurementId: "G-L40PJT4SKX"
};

let app, db, auth;
try {
    app = initializeApp(firebaseConfig);

    // 오프라인 데이터 유지(캐싱) 활성화 → 읽기 비용 절약
    // deprecated enableIndexedDbPersistence 대체 (멀티탭 지원 포함)
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        })
    });

    auth = getAuth(app);
} catch (e) {
    console.error("Firebase Init Error:", e);
}

export { db, auth, signInAnonymously };

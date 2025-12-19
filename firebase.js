// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"; // enableIndexedDbPersistence 추가
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    // ... 기존 설정 그대로 ...
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
    db = getFirestore(app);
    auth = getAuth(app);
    
    // [중요] 오프라인 데이터 유지 (캐싱) 활성화 -> 읽기 비용 절약
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log('여러 탭이 열려있어 지속성 모드를 켤 수 없습니다.');
        } else if (err.code == 'unimplemented') {
            console.log('브라우저가 지원하지 않습니다.');
        }
    });

} catch (e) {
    console.error("Firebase Init Error:", e);
}

export { db, auth, signInAnonymously };
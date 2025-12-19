import { db, auth, signInAnonymously } from './firebase.js';
import { collection, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './store.js';

// 공통 로그인 처리 함수
async function authenticateAndQuery(callback) {
    try {
        if (!auth.currentUser) {
            await signInAnonymously(auth);
        }
        await callback();
    } catch (error) {
        console.error("Authentication Failed:", error);
        alert("인증 오류: " + error.message);
    }
}

export async function handleAuthAction() {
    const name = document.getElementById('church-name').value.trim();
    const pw = document.getElementById('church-pw').value.trim();
    const errorMsg = document.getElementById('error-msg');
    
    // [수정] '저장' 체크박스 제거됨. '자동 로그인' 체크박스만 사용.
    const autoLoginCheck = document.getElementById('auto-login-check');

    if (!name || !pw) { errorMsg.innerText = "필수 정보를 입력해주세요."; return; }

    await authenticateAndQuery(async () => {
        const churchesRef = collection(db, "churches");
        const q = query(churchesRef, where("name", "==", name), where("password", "==", pw));

        try {
            const querySnapshot = await getDocs(q);

            if (state.isRegisterMode) {
                if (!querySnapshot.empty) {
                    errorMsg.innerHTML = "이미 등록된 아이디입니다.<br>다른 이름이나 비밀번호를 사용해주세요.";
                } else {
                    const newDocRef = await addDoc(churchesRef, {
                        name: name,
                        password: pw,
                        events: {}
                    });
                    alert("새로운 그룹이 생성되었습니다!");
                    window.enterService(newDocRef.id, name, true);
                }
            } else {
                if (!querySnapshot.empty) {
                    const docSnap = querySnapshot.docs[0];
                    
                    // [수정] 자동 로그인 체크 시 로컬스토리지 저장
                    if (autoLoginCheck && autoLoginCheck.checked) {
                        const authData = { name, pw, autoLogin: true };
                        localStorage.setItem('churchAuthData', JSON.stringify(authData));
                    } else {
                        localStorage.removeItem('churchAuthData');
                    }
                    
                    window.enterService(docSnap.id, name, true);
                } else {
                    errorMsg.innerText = "그룹 정보가 올바르지 않습니다. (이름 또는 비밀번호 확인)";
                }
            }
        } catch (e) {
            console.error("Error:", e);
            errorMsg.innerText = "서버 연결 오류.";
        }
    });
}

export async function handleGuestLogin() {
    const name = document.getElementById('church-name').value.trim();
    const errorMsg = document.getElementById('error-msg');

    if (!name) { errorMsg.innerText = "교회 이름을 입력해주세요."; return; }

    await authenticateAndQuery(async () => {
        const churchesRef = collection(db, "churches");
        const q = query(churchesRef, where("name", "==", name));

        try {
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const docSnap = querySnapshot.docs[0];
                window.enterService(docSnap.id, name, false);
            } else {
                errorMsg.innerText = "존재하지 않는 교회입니다.";
            }
        } catch (e) {
            alert("오류 발생: " + e.message);
        }
    });
}

export function logout() {
    const savedAuth = JSON.parse(localStorage.getItem('churchAuthData'));
    if (savedAuth) {
        // 로그아웃 시 자동 로그인 정보는 삭제하거나 false로 변경
        localStorage.removeItem('churchAuthData'); 
    }
    location.reload();
}

export function checkAutoLogin() {
    const savedAuth = JSON.parse(localStorage.getItem('churchAuthData'));
    if (savedAuth && savedAuth.autoLogin) {
        document.getElementById('church-name').value = savedAuth.name || "";
        document.getElementById('church-pw').value = savedAuth.pw || "";
        document.getElementById('auto-login-check').checked = true;
        handleAuthAction();
    }
}

export function toggleMode() {
    state.isRegisterMode = !state.isRegisterMode;
    const title = document.getElementById('form-title');
    const subtitle = document.getElementById('form-subtitle');
    const btn = document.getElementById('action-btn');
    const toggleBtn = document.getElementById('toggle-btn');
    const errorMsg = document.getElementById('error-msg');
    
    const guestBtn = document.querySelector('.btn-text');
    if (guestBtn) guestBtn.style.display = state.isRegisterMode ? 'none' : 'block';
    
    document.querySelector('.checkbox-group').style.display = state.isRegisterMode ? 'none' : 'flex';
    
    const inviteBtn = document.querySelector('.btn-row .btn-outline');
    if(inviteBtn) inviteBtn.style.display = state.isRegisterMode ? 'none' : 'block';

    errorMsg.innerText = "";

    if (state.isRegisterMode) {
        title.innerText = "새 그룹 만들기";
        subtitle.innerText = "교회 이름과 비밀번호를 등록하세요";
        btn.innerText = "그룹 생성하고 입장";
        toggleBtn.innerText = "이미 그룹이 있으신가요? 입장하기";
    } else {
        title.innerText = "⛪ 쳐치 캘린더";
        subtitle.innerText = "교회력 확인 및 우리교회 일정 함께 만들기";
        btn.innerText = "입장하기";
        toggleBtn.innerText = "새 그룹 만들기";
    }
}

export function inviteUser() {
    const shareData = {
        text: '우리교회 일정 함께 만들어요\nhttps://csy870617.github.io/faiths/'
    };

    if (navigator.share) {
        navigator.share(shareData).catch((err) => {
            if (err.name !== 'AbortError') {
               navigator.clipboard.writeText(shareData.text).then(() => {
                   alert("초대 링크가 복사되었습니다.");
               });
            }
        });
    } else {
        navigator.clipboard.writeText(shareData.text).then(() => {
            alert("초대 링크가 복사되었습니다.");
        });
    }
}
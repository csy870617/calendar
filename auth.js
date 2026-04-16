import { db, auth, signInAnonymously } from './firebase.js';
import { collection, query, where, getDocs, addDoc, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './store.js';

// SHA-256 해시 (브라우저 SubtleCrypto)
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 저장된 비밀번호가 이미 해싱된 형식인지 판별 (64 hex = SHA-256)
function isHashedPassword(pw) {
    return typeof pw === 'string' && /^[0-9a-f]{64}$/.test(pw);
}

// localStorage 안전 파싱
function getSavedAuth() {
    try {
        return JSON.parse(localStorage.getItem('churchAuthData'));
    } catch {
        localStorage.removeItem('churchAuthData');
        return null;
    }
}

// 공통 익명 인증 래퍼
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

// 로그인 수행 (해시된 비밀번호 우선, 실패 시 원문으로 레거시 매칭 후 해시로 자동 업그레이드)
async function performLogin(name, hashedPw, saveOptions, rawPw) {
    const errorMsg = document.getElementById('error-msg');

    await authenticateAndQuery(async () => {
        const churchesRef = collection(db, "churches");

        try {
            // 1차: 해시된 비밀번호로 조회
            let q = query(churchesRef, where("name", "==", name), where("password", "==", hashedPw));
            let snapshot = await getDocs(q);
            let matchedDoc = snapshot.empty ? null : snapshot.docs[0];
            let needsMigration = false;

            // 2차: 레거시 평문 비밀번호 폴백 (rawPw 제공 시)
            if (!matchedDoc && rawPw) {
                q = query(churchesRef, where("name", "==", name), where("password", "==", rawPw));
                snapshot = await getDocs(q);
                if (!snapshot.empty) {
                    matchedDoc = snapshot.docs[0];
                    needsMigration = true;
                }
            }

            if (!matchedDoc) {
                errorMsg.innerText = "그룹 정보가 올바르지 않습니다. (이름 또는 비밀번호 확인)";
                return;
            }

            // 레거시 평문 비밀번호를 해시로 업그레이드 (실패해도 로그인은 진행)
            if (needsMigration) {
                try {
                    await updateDoc(doc(db, "churches", matchedDoc.id), { password: hashedPw });
                } catch (migErr) {
                    console.warn("Password hash migration failed:", migErr);
                }
            }

            if (saveOptions) {
                const authData = {
                    name,
                    pw: hashedPw,
                    autoLogin: saveOptions.autoLogin,
                    remember: saveOptions.remember
                };
                localStorage.setItem('churchAuthData', JSON.stringify(authData));
            } else {
                localStorage.removeItem('churchAuthData');
            }

            window.enterService(matchedDoc.id, name, true);
        } catch (e) {
            console.error("Error:", e);
            errorMsg.innerText = "서버 연결 오류.";
        }
    });
}

// 그룹 등록 수행 (이름 중복 검사)
async function performRegister(name, hashedPw) {
    const errorMsg = document.getElementById('error-msg');

    await authenticateAndQuery(async () => {
        const churchesRef = collection(db, "churches");
        const nameQuery = query(churchesRef, where("name", "==", name));

        try {
            const querySnapshot = await getDocs(nameQuery);
            if (!querySnapshot.empty) {
                errorMsg.innerText = "이미 등록된 그룹 이름입니다. 다른 이름을 사용해주세요.";
            } else {
                const newDocRef = await addDoc(churchesRef, {
                    name: name,
                    password: hashedPw,
                    events: {}
                });
                alert("새로운 그룹이 생성되었습니다!");
                window.enterService(newDocRef.id, name, true);
            }
        } catch (e) {
            console.error("Error:", e);
            errorMsg.innerText = "서버 연결 오류.";
        }
    });
}

export async function handleAuthAction() {
    const name = document.getElementById('church-name').value.trim();
    const pw = document.getElementById('church-pw').value.trim();
    const errorMsg = document.getElementById('error-msg');

    const rememberCheck = document.getElementById('remember-check');
    const autoLoginCheck = document.getElementById('auto-login-check');

    if (!name || !pw) { errorMsg.innerText = "필수 정보를 입력해주세요."; return; }

    const hashedPw = await hashPassword(pw);

    if (state.isRegisterMode) {
        await performRegister(name, hashedPw);
    } else {
        const saveOptions = (rememberCheck.checked || autoLoginCheck.checked)
            ? { autoLogin: autoLoginCheck.checked, remember: rememberCheck.checked }
            : null;
        // 사용자 원문 입력을 같이 넘겨 레거시(평문 저장) 그룹도 로그인 후 자동 해시 업그레이드
        await performLogin(name, hashedPw, saveOptions, pw);
    }
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
            if (querySnapshot.size === 1) {
                const docSnap = querySnapshot.docs[0];
                window.enterService(docSnap.id, name, false);
            } else if (querySnapshot.size > 1) {
                errorMsg.innerText = "동일한 이름의 그룹이 여러 개 있습니다. 비밀번호로 로그인해주세요.";
            } else {
                errorMsg.innerText = "존재하지 않는 교회입니다.";
            }
        } catch (e) {
            alert("오류 발생: " + e.message);
        }
    });
}

export function logout() {
    const savedAuth = getSavedAuth();
    if (savedAuth) {
        // 로그아웃 시 자동 로그인만 해제 (저장은 유지될 수 있음)
        savedAuth.autoLogin = false;
        localStorage.setItem('churchAuthData', JSON.stringify(savedAuth));
    }
    location.reload();
}

export async function checkAutoLogin() {
    const savedAuth = getSavedAuth();
    if (!savedAuth) return;

    document.getElementById('church-name').value = savedAuth.name || "";

    if (savedAuth.remember) {
        document.getElementById('remember-check').checked = true;
    }

    if (savedAuth.autoLogin && savedAuth.pw) {
        document.getElementById('auto-login-check').checked = true;
        const saveOptions = { autoLogin: true, remember: !!savedAuth.remember };

        if (isHashedPassword(savedAuth.pw)) {
            // 이미 해시 형식: 그대로 사용
            performLogin(savedAuth.name, savedAuth.pw, saveOptions);
        } else {
            // 레거시 localStorage 평문: 해싱 후 로그인, 원문은 DB 폴백/업그레이드용으로 전달
            const hashedPw = await hashPassword(savedAuth.pw);
            performLogin(savedAuth.name, hashedPw, saveOptions, savedAuth.pw);
        }
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

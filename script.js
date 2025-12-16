// ==========================================
// [1] Firebase 설정 및 초기화
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, addDoc, collection, query, where, getDocs, onSnapshot, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAQ7sTtozmZtmuakxGUvsAFPLhEWdh3f5w",
    authDomain: "churchcalendar-20a07.firebaseapp.com",
    projectId: "churchcalendar-20a07",
    storageBucket: "churchcalendar-20a07.firebasestorage.app",
    messagingSenderId: "693277807486",
    appId: "1:693277807486:web:d3486bb05be6744ff9d92f",
    measurementId: "G-L40PJT4SKX"
};

// 앱 초기화
let app, db;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (e) {
    alert("Firebase 초기화 오류: " + e.message);
}

// ==========================================
// [2] 전역 변수
// ==========================================
let currentDate = new Date();
let currentMonth = currentDate.getMonth();
let currentYear = currentDate.getFullYear();

let churchInfo = { name: "", id: "" }; 
let eventsCache = {}; 
let isAdmin = false; 
let isRegisterMode = false;

let cachedHolidays = {};
let cachedYear = null;

let isAnimating = false;
let touchStartX = 0;
let touchEndX = 0;
let movingEventData = null; 
let longPressTimer = null;
let isMovingMode = false;

let currentEditingId = null;

window.onload = function() {
    checkAutoLogin();
    setupColorPalette();
    setupDateListeners(); 
    initGestures();
};

function checkAutoLogin() {
    const savedAuth = JSON.parse(localStorage.getItem('churchAuthData'));
    if (savedAuth) {
        document.getElementById('church-name').value = savedAuth.name || "";
        document.getElementById('church-pw').value = savedAuth.pw || "";
        document.getElementById('remember-check').checked = true;
        if (savedAuth.autoLogin) {
            document.getElementById('auto-login-check').checked = true;
            handleAuthAction();
        }
    }
}

// ----------------------------------------------------
// 유틸리티 함수
// ----------------------------------------------------
function createLocalDate(dateStr) {
    if (!dateStr) return new Date();
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function formatLocalDate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function toKeyFormat(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${y}-${m}-${d}`;
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- 공휴일 및 교회력 로직 ---
const solarHolidays = { "1-1":"신정", "3-1":"삼일절", "5-5":"어린이날", "6-6":"현충일", "8-15":"광복절", "10-3":"개천절", "10-9":"한글날", "12-25":"성탄절" };

function getEasterDate(year) {
    const f = Math.floor;
    const G = year % 19;
    const C = f(year/100);
    const H = (C - f(C/4) - f((8*C+13)/25) + 19*G + 15) % 30;
    const I = H - f(H/28) * (1 - f(29/(H+1)) * f((21-G)/11));
    const J = (year + f(year/4) + I + 2 - C + f(C/4)) % 7;
    const L = I - J;
    const month = 3 + f((L+40)/44);
    const day = L + 28 - 31 * f(month/4);
    return { month, day };
}

function getNextDayOfWeek(date, dayOfWeek) {
    const resultDate = new Date(date.getTime());
    resultDate.setDate(date.getDate() + (7 + dayOfWeek - date.getDay()) % 7);
    if (resultDate.getTime() === date.getTime()) {
        resultDate.setDate(date.getDate() + 7);
    }
    return resultDate;
}

function calculateYearlyData(year) {
    if (cachedYear === year) return;
    const holidays = {}; 
    const addDate = (m, d, name, type, color, isHoliday = false) => {
        const key = `${m}-${d}`;
        if (!holidays[key]) holidays[key] = [];
        holidays[key].push({ name, type, color, isHoliday });
    };

    // 색상 정의 [수정됨]
    const COL_PURPLE = "#7B1FA2"; // 보라
    const COL_GOLD   = "#D4AF37"; // [변경] 메탈릭 골드 (주황기 제거)
    const COL_RED    = "#D32F2F"; // 빨강
    const COL_GREEN  = "#2E7D32"; // 초록

    // 1. 양력 공휴일
    for (const [key, name] of Object.entries(solarHolidays)) {
        const [m, d] = key.split('-').map(Number);
        if (key === "12-25") {
            addDate(m, d, name, 'lit', COL_GOLD, true); 
        } else {
            addDate(m, d, name, 'holiday', null, true);
        }
    }

    // 2. 음력 공휴일
    const formatter = new Intl.DateTimeFormat('ko-KR', { calendar: 'chinese', day: 'numeric', month: 'numeric' });
    const checkLunar = (start, days, tm, td, name) => {
        const date = new Date(start); 
        for(let i=0; i<days; i++){
            const parts = formatter.formatToParts(date);
            const m = parseInt(parts.find(p=>p.type==='month').value);
            const d = parseInt(parts.find(p=>p.type==='day').value);
            if(m===tm && d===td) {
                addDate(date.getMonth()+1, date.getDate(), name, 'holiday', null, true);
                return date; 
            }
            date.setDate(date.getDate()+1);
        }
        return null;
    };

    const seollal = checkLunar(new Date(year, 0, 15), 60, 1, 1, "설날");
    if(seollal) {
        const p = new Date(seollal); p.setDate(seollal.getDate()-1);
        const n = new Date(seollal); n.setDate(seollal.getDate()+1);
        addDate(p.getMonth()+1, p.getDate(), "설날연휴", 'holiday', null, true);
        addDate(n.getMonth()+1, n.getDate(), "설날연휴", 'holiday', null, true);
    }
    checkLunar(new Date(year, 3, 1), 60, 4, 8, "석가탄신일");
    const chuseok = checkLunar(new Date(year, 7, 15), 70, 8, 15, "추석");
    if(chuseok) {
        const p = new Date(chuseok); p.setDate(chuseok.getDate()-1);
        const n = new Date(chuseok); n.setDate(chuseok.getDate()+1);
        addDate(p.getMonth()+1, p.getDate(), "추석연휴", 'holiday', null, true);
        addDate(n.getMonth()+1, n.getDate(), "추석연휴", 'holiday', null, true);
    }

    // 3. 교회력 절기
    addDate(1, 6, "주현절", 'lit', COL_GOLD, false);
    
    const epiphany = new Date(year, 0, 6);
    const baptism = getNextDayOfWeek(epiphany, 0); 
    addDate(baptism.getMonth()+1, baptism.getDate(), "주님 세례 주일", 'lit', COL_GOLD, false);

    const easter = getEasterDate(year);
    const easterDate = new Date(year, easter.month-1, easter.day);
    addDate(easter.month, easter.day, "부활절", 'lit', COL_GOLD, false);

    const ashWed = new Date(easterDate); 
    ashWed.setDate(ashWed.getDate() - 46);
    addDate(ashWed.getMonth()+1, ashWed.getDate(), "재의 수요일(사순절 시작)", 'lit', COL_PURPLE, false);

    const transfiguration = new Date(ashWed);
    transfiguration.setDate(transfiguration.getDate() - 3);
    addDate(transfiguration.getMonth()+1, transfiguration.getDate(), "산상변모 주일", 'lit', COL_GOLD, false);

    const palmSunday = new Date(easterDate);
    palmSunday.setDate(palmSunday.getDate() - 7);
    addDate(palmSunday.getMonth()+1, palmSunday.getDate(), "종려주일(고난주간)", 'lit', COL_RED, false);

    const goodFriday = new Date(easterDate);
    goodFriday.setDate(goodFriday.getDate() - 2);
    addDate(goodFriday.getMonth()+1, goodFriday.getDate(), "성금요일", 'lit', COL_RED, false);

    const ascension = new Date(easterDate);
    ascension.setDate(ascension.getDate() + 39);
    addDate(ascension.getMonth()+1, ascension.getDate(), "주님 승천일", 'lit', COL_GOLD, false);

    const pentecost = new Date(easterDate); 
    pentecost.setDate(pentecost.getDate() + 49);
    addDate(pentecost.getMonth()+1, pentecost.getDate(), "성령강림절", 'lit', COL_RED, false);

    const trinity = new Date(pentecost);
    trinity.setDate(trinity.getDate() + 7);
    addDate(trinity.getMonth()+1, trinity.getDate(), "삼위일체 주일", 'lit', COL_GOLD, false);

    const sept1 = new Date(year, 8, 1);
    const creationStart = new Date(sept1);
    if(sept1.getDay() !== 0) creationStart.setDate(sept1.getDate() + (7 - sept1.getDay()));
    addDate(creationStart.getMonth()+1, creationStart.getDate(), "창조절 시작", 'lit', COL_GREEN, false);

    const oct31 = new Date(year, 9, 31);
    const reformation = new Date(oct31);
    reformation.setDate(oct31.getDate() - oct31.getDay()); 
    addDate(reformation.getMonth()+1, reformation.getDate(), "종교개혁주일", 'lit', COL_RED, false);

    const nov1 = new Date(year, 10, 1);
    const thanksgiving = new Date(nov1);
    if(nov1.getDay() !== 0) thanksgiving.setDate(nov1.getDate() + (7 - nov1.getDay())); 
    thanksgiving.setDate(thanksgiving.getDate() + 14); 
    addDate(thanksgiving.getMonth()+1, thanksgiving.getDate(), "추수감사주일", 'lit', COL_GREEN, false);

    const nov27 = new Date(year, 10, 27);
    const dayOfNov27 = nov27.getDay(); 
    const offset = (7 - dayOfNov27) % 7;
    const advent1st = new Date(year, 10, 27 + offset);
    addDate(advent1st.getMonth()+1, advent1st.getDate(), "대림절 제1주", 'lit', COL_PURPLE, false);
    
    const advent2nd = new Date(advent1st); advent2nd.setDate(advent1st.getDate()+7);
    addDate(advent2nd.getMonth()+1, advent2nd.getDate(), "대림절 제2주", 'lit', COL_PURPLE, false);
    const advent3rd = new Date(advent1st); advent3rd.setDate(advent1st.getDate()+14);
    addDate(advent3rd.getMonth()+1, advent3rd.getDate(), "대림절 제3주", 'lit', COL_PURPLE, false);
    const advent4th = new Date(advent1st); advent4th.setDate(advent1st.getDate()+21);
    addDate(advent4th.getMonth()+1, advent4th.getDate(), "대림절 제4주", 'lit', COL_PURPLE, false);

    const christKing = new Date(advent1st);
    christKing.setDate(christKing.getDate() - 7);
    addDate(christKing.getMonth()+1, christKing.getDate(), "왕이신 그리스도 주일", 'lit', COL_GOLD, false);

    cachedHolidays = holidays;
    cachedYear = year;
}

// ==========================================
// [3] 인증 로직
// ==========================================
async function handleAuthAction() {
    const name = document.getElementById('church-name').value.trim();
    const pw = document.getElementById('church-pw').value.trim();
    const errorMsg = document.getElementById('error-msg');
    const rememberCheck = document.getElementById('remember-check');
    const autoLoginCheck = document.getElementById('auto-login-check');

    if (!name || !pw) { errorMsg.innerText = "필수 정보를 입력해주세요."; return; }

    const churchesRef = collection(db, "churches");
    const q = query(churchesRef, where("name", "==", name), where("password", "==", pw));

    try {
        const querySnapshot = await getDocs(q);

        if (isRegisterMode) {
            // [그룹 생성]
            if (!querySnapshot.empty) {
                errorMsg.innerText = "비밀번호 수정해도 입장 가능";
            } else {
                const newDocRef = await addDoc(churchesRef, {
                    name: name,
                    password: pw,
                    events: {}
                });
                alert("새로운 그룹이 생성되었습니다!");
                enterService(newDocRef.id, name, true);
            }
        } else {
            // [입장하기]
            if (!querySnapshot.empty) {
                const docSnap = querySnapshot.docs[0];
                if (rememberCheck && rememberCheck.checked) {
                    const authData = { name, pw, autoLogin: autoLoginCheck.checked };
                    localStorage.setItem('churchAuthData', JSON.stringify(authData));
                } else {
                    localStorage.removeItem('churchAuthData');
                }
                enterService(docSnap.id, name, true);
            } else {
                errorMsg.innerText = "그룹 정보가 올바르지 않습니다. (이름 또는 비밀번호 확인)";
            }
        }
    } catch (e) {
        console.error("Error:", e);
        if(e.code === 'permission-denied') {
            alert("권한 오류: Firestore 규칙을 확인해주세요.");
        } else {
            alert("오류 발생: " + e.message);
        }
        errorMsg.innerText = "서버 연결 오류.";
    }
}

async function handleGuestLogin() {
    const name = document.getElementById('church-name').value.trim();
    const errorMsg = document.getElementById('error-msg');

    if (!name) { errorMsg.innerText = "교회 이름을 입력해주세요."; return; }

    const churchesRef = collection(db, "churches");
    const q = query(churchesRef, where("name", "==", name));

    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            enterService(docSnap.id, name, false);
        } else {
            errorMsg.innerText = "존재하지 않는 교회입니다.";
        }
    } catch (e) {
        alert("오류 발생: " + e.message);
    }
}

function enterService(docId, name, isManager) {
    churchInfo = { id: docId, name: name };
    isAdmin = isManager; 
    
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('calendar-view').style.display = 'flex';
    document.getElementById('display-church-name').innerText = name;
    
    onSnapshot(doc(db, "churches", docId), (doc) => {
        if (doc.exists()) {
            const data = doc.data();
            eventsCache = data.events || {}; 
            calculateYearlyData(currentYear);
            renderCalendar();
        }
    });

    initGestures();
}

function toggleMode() {
    isRegisterMode = !isRegisterMode;
    const title = document.getElementById('form-title');
    const subtitle = document.getElementById('form-subtitle');
    const btn = document.getElementById('action-btn');
    const toggleBtn = document.getElementById('toggle-btn');
    const errorMsg = document.getElementById('error-msg');
    
    const guestBtn = document.querySelector('.btn-text');
    if (guestBtn) guestBtn.style.display = isRegisterMode ? 'none' : 'block';
    
    document.querySelector('.checkbox-group').style.display = isRegisterMode ? 'none' : 'flex';
    
    const inviteBtn = document.querySelector('.btn-row .btn-outline');
    if(inviteBtn) inviteBtn.style.display = isRegisterMode ? 'none' : 'block';

    errorMsg.innerText = "";

    if (isRegisterMode) {
        title.innerText = "새 그룹 만들기";
        subtitle.innerText = "교회 이름과 비밀번호를 등록하세요";
        btn.innerText = "그룹 생성하고 입장";
        toggleBtn.innerText = "이미 그룹이 있으신가요? 입장하기";
    } else {
        title.innerText = "⛪ 쳐치 캘린더";
        subtitle.innerText = "우리교회 일정 함께 만들기";
        btn.innerText = "입장하기";
        toggleBtn.innerText = "새 그룹 만들기";
    }
}

function logout() {
    const savedAuth = JSON.parse(localStorage.getItem('churchAuthData'));
    if (savedAuth) {
        savedAuth.autoLogin = false;
        localStorage.setItem('churchAuthData', JSON.stringify(savedAuth));
    }
    location.reload();
}

function inviteUser() {
    const shareData = {
        text: '우리교회 일정 함께 만들어요\nhttps://csy870617.github.io/faiths/'
    };

    if (navigator.share) {
        navigator.share(shareData).catch((err) => {
            if (err.name !== 'AbortError') copyToClipboard(shareData.text);
        });
    } else {
        copyToClipboard(shareData.text);
    }
}

function setupColorPalette() {
    const palette = document.getElementById('color-palette');
    const hiddenInput = document.getElementById('selected-color');
    const options = palette.querySelectorAll('.color-option');
    options.forEach(opt => {
        opt.addEventListener('click', () => {
            options.forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            hiddenInput.value = opt.getAttribute('data-color');
        });
    });
}

function setupDateListeners() {
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    startDateInput.addEventListener('change', function() {
        if (endDateInput.value < this.value) {
            endDateInput.value = this.value;
        }
    });
}

function toggleTimeInputs() {
    const isAllDay = document.getElementById('all-day-check').checked;
    document.getElementById('start-time').disabled = isAllDay;
    document.getElementById('end-time').disabled = isAllDay;
    if(isAllDay) {
        document.getElementById('start-time').style.opacity = "0.3";
        document.getElementById('end-time').style.opacity = "0.3";
    } else {
        document.getElementById('start-time').style.opacity = "1";
        document.getElementById('end-time').style.opacity = "1";
    }
}

function openModal(year, month, day) {
    if(isMovingMode) return;

    const dateKey = `${year}-${month}-${day}`;
    const rawData = eventsCache[dateKey];
    
    if (!isAdmin) {
        if (rawData) {
            let data = rawData.startsWith('{') ? JSON.parse(rawData) : { title: rawData, desc: '' };
            let timeStr = "";
            if(data.isAllDay) timeStr = "[종일]";
            else if(data.startTime) timeStr = `${data.startTime} ~ ${data.endTime || ''}`;
            
            alert(`[일정 상세]\n\n제목: ${data.title}\n일시: ${data.startDate} ~ ${data.endDate}\n시간: ${timeStr}\n내용: ${data.desc}`);
        }
        return;
    }

    const modal = document.getElementById('event-modal');
    modal.style.display = 'flex';
    
    currentEditingId = null;
    const yyyy = year;
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    
    document.getElementById('input-title').value = "";
    document.getElementById('start-date').value = dateStr;
    document.getElementById('end-date').value = dateStr;
    document.getElementById('start-time').value = "09:00";
    document.getElementById('end-time').value = "10:00";
    document.getElementById('all-day-check').checked = true;
    toggleTimeInputs();
    document.getElementById('input-desc').value = "";
    
    document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
    document.querySelector('.color-option[data-color="#4285F4"]').classList.add('selected');
    document.getElementById('selected-color').value = "#4285F4";

    if (rawData) {
        if (rawData.startsWith('{')) {
            const data = JSON.parse(rawData);
            currentEditingId = data.id || null;
            document.getElementById('input-title').value = data.title;
            document.getElementById('start-date').value = data.startDate;
            document.getElementById('end-date').value = data.endDate;
            document.getElementById('start-time').value = data.startTime || "";
            document.getElementById('end-time').value = data.endTime || "";
            document.getElementById('all-day-check').checked = data.isAllDay;
            toggleTimeInputs();
            document.getElementById('input-desc').value = data.desc;
            const color = data.color || "#4285F4";
            document.querySelectorAll('.color-option').forEach(o => {
                o.classList.remove('selected');
                if(o.getAttribute('data-color') === color) o.classList.add('selected');
            });
            document.getElementById('selected-color').value = color;
        } else {
            document.getElementById('input-title').value = rawData;
        }
    }
}

function closeModal() {
    document.getElementById('event-modal').style.display = 'none';
}

// ==========================================
// Firestore 저장/삭제/이동 로직
// ==========================================

async function saveSchedule() {
    const titleVal = document.getElementById('input-title').value;
    const startDateVal = document.getElementById('start-date').value;
    let endDateVal = document.getElementById('end-date').value;
    const startTimeVal = document.getElementById('start-time').value;
    const endTimeVal = document.getElementById('end-time').value;
    const isAllDay = document.getElementById('all-day-check').checked;
    const colorVal = document.getElementById('selected-color').value;
    const descVal = document.getElementById('input-desc').value;

    if (!titleVal) { alert("제목을 입력해주세요."); return; }
    if (!endDateVal) endDateVal = startDateVal;
    if (startDateVal > endDateVal) { alert("종료일이 시작일보다 빠를 수 없습니다."); return; }

    const newId = currentEditingId || generateUUID();
    const eventObj = {
        id: newId,
        title: titleVal,
        startDate: startDateVal,
        endDate: endDateVal,
        startTime: startTimeVal,
        endTime: endTimeVal,
        isAllDay: isAllDay,
        color: colorVal,
        desc: descVal
    };

    let newUpdates = {};

    if (currentEditingId) {
        Object.keys(eventsCache).forEach(key => {
            const data = eventsCache[key];
            if (data && typeof data === 'string' && data.includes(currentEditingId)) {
                newUpdates[`events.${key}`] = deleteField();
            }
        });
    }

    let loopDate = createLocalDate(startDateVal);
    const endDate = createLocalDate(endDateVal);
    
    while(loopDate <= endDate) {
        const key = `${loopDate.getFullYear()}-${loopDate.getMonth()+1}-${loopDate.getDate()}`;
        newUpdates[`events.${key}`] = JSON.stringify(eventObj);
        loopDate.setDate(loopDate.getDate() + 1);
    }

    try {
        await updateDoc(doc(db, "churches", churchInfo.id), newUpdates);
        closeModal();
    } catch(e) {
        alert("저장 실패: " + e.message);
    }
}

async function deleteSchedule() {
    if(!confirm("이 일정을 삭제하시겠습니까?")) return;
    
    let updates = {};
    if (currentEditingId) {
        Object.keys(eventsCache).forEach(key => {
            const data = eventsCache[key];
            if (data && typeof data === 'string' && data.includes(currentEditingId)) {
                updates[`events.${key}`] = deleteField();
            }
        });
    } else {
        const dateVal = document.getElementById('start-date').value;
        const key = toKeyFormat(dateVal);
        if(eventsCache[key]) {
            updates[`events.${key}`] = deleteField();
        }
    }

    if(Object.keys(updates).length > 0) {
        try {
            await updateDoc(doc(db, "churches", churchInfo.id), updates);
        } catch(e) {
            alert("삭제 실패: " + e.message);
        }
    }
    closeModal();
}

async function moveEvent(eventData, newStartDateStr) {
    const oldStart = createLocalDate(eventData.startDate);
    const oldEnd = createLocalDate(eventData.endDate);
    const durationMs = oldEnd.getTime() - oldStart.getTime(); 
    const newStart = createLocalDate(newStartDateStr);
    const newEndMs = newStart.getTime() + durationMs;
    const newEnd = new Date(newEndMs);

    const newStartStr = formatLocalDate(newStart);
    const newEndStr = formatLocalDate(newEnd);

    const eventId = eventData.id;
    if (!eventId) {
        alert("구 데이터 형식입니다. 일정을 열어서 다시 저장해주세요.");
        return;
    }

    let updates = {};

    Object.keys(eventsCache).forEach(key => {
        const data = eventsCache[key];
        if (data && typeof data === 'string' && data.includes(eventId)) {
            updates[`events.${key}`] = deleteField();
        }
    });

    eventData.startDate = newStartStr;
    eventData.endDate = newEndStr;
    
    let loopDate = createLocalDate(newStartStr);
    const finalDate = createLocalDate(newEndStr);
    
    while(loopDate <= finalDate) {
        const key = `${loopDate.getFullYear()}-${loopDate.getMonth()+1}-${loopDate.getDate()}`;
        updates[`events.${key}`] = JSON.stringify(eventData);
        loopDate.setDate(loopDate.getDate() + 1);
    }

    try {
        await updateDoc(doc(db, "churches", churchInfo.id), updates);
    } catch(e) {
        alert("이동 실패: " + e.message);
    }
}

// ... 렌더링 및 UI 관련 함수들 ...

function enterMoveMode(data) {
    isMovingMode = true;
    movingEventData = data;
    document.getElementById('move-guide').style.display = 'block';
    renderCalendar(); 
}

function exitMoveMode() {
    isMovingMode = false;
    movingEventData = null;
    document.getElementById('move-guide').style.display = 'none';
    renderCalendar();
}

function renderCalendar() {
    const existingOverlay = document.querySelector('.expanded-badge-card');
    if (existingOverlay) existingOverlay.remove();

    calculateYearlyData(currentYear);
    const grid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('current-month-year');
    const seasonDisplay = document.getElementById('liturgical-season');
    
    const events = eventsCache; 

    document.getElementById('move-guide').onclick = exitMoveMode;

    const oldDays = grid.querySelectorAll('.day');
    oldDays.forEach(d => d.remove());

    monthDisplay.innerText = `${currentYear}년 ${currentMonth + 1}월`;
    updateLiturgicalBadge(seasonDisplay);

    const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();
    const totalCells = 42; 

    for (let i = 0; i < firstDayOfWeek; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'day';
        emptyDay.style.backgroundColor = "#fcfcfc";
        grid.appendChild(emptyDay);
    }

    for (let i = 1; i <= lastDate; i++) {
        const dayEl = document.createElement('div');
        dayEl.className = 'day';
        
        const dateStrForDrop = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
        dayEl.setAttribute('data-date', dateStrForDrop);

        if (isAdmin) {
            dayEl.ondragover = (e) => { e.preventDefault(); dayEl.classList.add('drag-over'); };
            dayEl.ondragleave = () => { dayEl.classList.remove('drag-over'); };
            dayEl.ondrop = (e) => {
                e.preventDefault();
                dayEl.classList.remove('drag-over');
                const json = e.dataTransfer.getData('text/plain');
                if (json) {
                    const data = JSON.parse(json);
                    moveEvent(data, dateStrForDrop);
                }
            };
            dayEl.addEventListener('click', () => {
                if (isMovingMode && movingEventData) {
                    moveEvent(movingEventData, dateStrForDrop);
                    exitMoveMode();
                } else {
                    openModal(currentYear, currentMonth + 1, i);
                }
            });
        } else {
             dayEl.onclick = () => openModal(currentYear, currentMonth + 1, i);
        }
        
        const dateNum = document.createElement('span');
        dateNum.className = 'date-num';
        dateNum.innerText = i;
        dayEl.appendChild(dateNum);

        const currentDayOfWeek = new Date(currentYear, currentMonth, i).getDay();
        const dateKey = `${currentYear}-${currentMonth+1}-${i}`;
        const shortKey = `${currentMonth+1}-${i}`;

        let isRedDay = currentDayOfWeek === 0;
        const dayInfos = cachedHolidays[shortKey];

        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'badge-container';

        if (dayInfos) {
            dayInfos.forEach(info => {
                const badge = document.createElement('div');
                badge.className = 'badge';
                badge.innerText = info.name;
                
                let bg, txt;
                
                // [우선순위 수정] 색상이 명시된 경우(교회력)를 가장 먼저 처리
                if (info.color) {
                    bg = info.color;
                    txt = "#fff";
                    if (info.isHoliday) isRedDay = true; // 공휴일이면 날짜도 빨강
                } else if (info.isHoliday) {
                    badge.classList.add('holiday-badge');
                    bg = "var(--holiday-bg)"; txt = "var(--holiday)";
                    isRedDay = true;
                } else if (info.type === 'lit') {
                    badge.classList.add('lit-badge');
                    bg = "var(--lit-bg)"; txt = "var(--lit-text)";
                }
                
                if(bg) badge.style.backgroundColor = bg;
                if(txt) badge.style.color = txt;

                badge.onclick = (e) => {
                    e.stopPropagation();
                    const computedStyle = getComputedStyle(badge);
                    showExpandedBadge(badge, info.name, computedStyle.backgroundColor, computedStyle.color);
                };
                badgeContainer.appendChild(badge);
            });
        }

        if (isRedDay) dayEl.classList.add('sun');

        if (events[dateKey]) {
            const rawData = events[dateKey];
            const eventBadge = document.createElement('div');
            eventBadge.className = 'badge';
            
            let displayTitle = "";
            let bgColor = "#4285F4";
            let eventDataObj = null;

            if (rawData.startsWith('{')) {
                const data = JSON.parse(rawData);
                eventDataObj = data;
                displayTitle = data.title;
                if(!data.isAllDay && data.startTime) {
                    displayTitle = `${data.startTime} ${displayTitle}`;
                }
                bgColor = data.color || "#4285F4";
                eventBadge.style.backgroundColor = bgColor;
                eventBadge.style.color = "#fff";
                
                if (isMovingMode && movingEventData && movingEventData.id === data.id) {
                    eventBadge.classList.add('moving-selected');
                }

                if (isAdmin) {
                    eventBadge.setAttribute('draggable', 'true');
                    eventBadge.ondragstart = (e) => {
                        e.dataTransfer.setData('text/plain', JSON.stringify(data));
                        eventBadge.classList.add('dragging');
                    };
                    eventBadge.ondragend = () => { eventBadge.classList.remove('dragging'); };
                    eventBadge.addEventListener('touchstart', (e) => {
                        longPressTimer = setTimeout(() => { enterMoveMode(data); }, 600); 
                    }, {passive: true});
                    eventBadge.addEventListener('touchend', () => {
                        if (longPressTimer) clearTimeout(longPressTimer);
                    }, {passive: true});
                }
            } else {
                displayTitle = rawData;
                eventBadge.classList.add('event-badge');
            }
            
            eventBadge.innerText = displayTitle;
            eventBadge.onclick = (e) => {
                if (isMovingMode) return; 
                e.stopPropagation();
                openModal(currentYear, currentMonth + 1, i);
            };
            badgeContainer.appendChild(eventBadge);
        }

        dayEl.appendChild(badgeContainer);

        const today = new Date();
        if (i === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear()) {
            dayEl.classList.add('today');
        }
        grid.appendChild(dayEl);
    }

    const filledCells = firstDayOfWeek + lastDate;
    for (let i = filledCells; i < totalCells; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'day';
        emptyDay.style.backgroundColor = "#fcfcfc";
        grid.appendChild(emptyDay);
    }
}

function updateLiturgicalBadge(element) {
    const m = currentMonth + 1;
    let name = "창조절 (평년)";
    let color = "#e6f4ea";
    let text = "#137333";

    if (m === 12) { name = "대림절"; color = "#f3e8fd"; text = "#9333ea"; }
    else if (m === 1) { name = "주현절"; color = "#f1f3f4"; text = "#3c4043"; }
    else if (m === 3) { name = "사순절"; color = "#f3e8fd"; text = "#9333ea"; }
    else if (m === 4) { name = "부활절기"; color = "#fef7e0"; text = "#b06000"; }
    else if (m === 5) { name = "성령강림절기"; color = "#fce8e6"; text = "#c5221f"; }
    
    element.innerText = name;
    element.style.backgroundColor = color;
    element.style.color = text;
}

function changeMonth(step) {
    if(step === 0) { 
        const now = new Date();
        currentMonth = now.getMonth();
        currentYear = now.getFullYear();
    } else {
        currentMonth += step;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; } 
        else if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    }
    renderCalendar();
}

function showExpandedBadge(element, text, bgColor, textColor) {
    const existing = document.querySelector('.expanded-badge-card');
    if (existing) existing.remove();

    const rect = element.getBoundingClientRect();
    
    const card = document.createElement('div');
    card.className = 'expanded-badge-card';
    card.innerText = text;
    
    if(bgColor) card.style.backgroundColor = bgColor;
    if(textColor) card.style.color = textColor;
    
    card.style.top = `${rect.top}px`;
    card.style.left = `${rect.left}px`;
    
    card.onclick = (e) => {
        e.stopPropagation();
        card.remove();
    };

    document.body.appendChild(card);

    const closeHandler = (e) => {
        if(e.target !== card) {
            card.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => {
        document.addEventListener('click', closeHandler);
    }, 0);
}

// [MODIFIED] 공유하기 (제목 중복 방지: title 속성 제거)
async function shareMonth() {
    const events = eventsCache;
    const churchName = churchInfo.name || "우리교회";
    
    let monthEvents = [];

    Object.keys(events).forEach(key => {
        const [y, m, d] = key.split('-').map(Number);
        if (y === currentYear && m === (currentMonth + 1)) {
            let data = events[key];
            if (data.startsWith('{')) {
                data = JSON.parse(data);
                monthEvents.push({
                    day: d,
                    title: data.title,
                    time: data.isAllDay ? "종일" : (data.startTime || ""),
                    desc: data.desc || ""
                });
            } else {
                monthEvents.push({ day: d, title: data, time: "", desc: "" });
            }
        }
    });

    monthEvents.sort((a, b) => a.day - b.day);

    let shareText = `[${churchName} ${currentMonth + 1}월 일정]\n\n`;
    if (monthEvents.length === 0) {
        shareText += "등록된 일정이 없습니다.";
    } else {
        monthEvents.forEach(e => {
            let line = `${currentMonth+1}월 ${e.day}일`;
            if (e.time) line += ` (${e.time})`;
            line += `: ${e.title}`;
            shareText += `${line}\n`;
        });
    }
    
    shareText += "\n\nFAITHS 크리스천 성장 도구 플랫폼\nhttps://csy870617.github.io/faiths/";

    if (navigator.share) {
        try {
            await navigator.share({
                // title 제거: 본문에 이미 제목이 있으므로 중복 방지
                text: shareText
            });
        } catch (err) {
            // 사용자가 취소한 경우 외에는 복사
            if (err.name !== 'AbortError') copyToClipboard(shareText);
        }
    } else {
        copyToClipboard(shareText);
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert("이번 달 일정이 클립보드에 복사되었습니다.\n카카오톡이나 문자에 붙여넣기 하세요!");
    }).catch(err => {
        alert("일정 복사에 실패했습니다.");
    });
}

function initGestures() {
    const container = document.getElementById('calendar-grid');
    if(!container) return;
    
    container.addEventListener('wheel', (e) => {
        if (isAnimating) return;
        if (e.deltaY > 0) changeMonth(1); else changeMonth(-1);
        isAnimating = true; setTimeout(() => isAnimating = false, 500);
    });

    container.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, {passive:true});
    container.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        if (touchEndX < touchStartX - 50) changeMonth(1);
        if (touchEndX > touchStartX + 50) changeMonth(-1);
    }, {passive:true});
}

// [중요] HTML 연결
window.handleAuthAction = handleAuthAction;
window.handleGuestLogin = handleGuestLogin;
window.inviteUser = inviteUser;
window.toggleMode = toggleMode;
window.changeMonth = changeMonth;
window.logout = logout;
window.shareMonth = shareMonth;
window.saveSchedule = saveSchedule;
window.deleteSchedule = deleteSchedule;
window.closeModal = closeModal;
window.toggleTimeInputs = toggleTimeInputs;
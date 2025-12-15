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

function calculateYearlyData(year) {
    if (cachedYear === year) return;
    const holidays = {}; 
    const addDate = (m, d, name, type, color, isHoliday = false) => {
        const key = `${m}-${d}`;
        if (!holidays[key]) holidays[key] = [];
        holidays[key].push({ name, type, color, isHoliday });
    };

    for (const [key, name] of Object.entries(solarHolidays)) {
        const [m, d] = key.split('-').map(Number);
        addDate(m, d, name, 'holiday', null, true);
    }

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

    const easter = getEasterDate(year);
    const easterDate = new Date(year, easter.month-1, easter.day);
    addDate(easter.month, easter.day, "부활절", 'lit', "#333", false);
    
    const pentecost = new Date(easterDate); pentecost.setDate(pentecost.getDate()+49);
    addDate(pentecost.getMonth()+1, pentecost.getDate(), "성령강림절", 'lit', "var(--lit-text)", false);

    const ashWed = new Date(easterDate); ashWed.setDate(ashWed.getDate()-46);
    addDate(ashWed.getMonth()+1, ashWed.getDate(), "재의 수요일(사순절 시작)", 'lit', "var(--lit-text)", false);

    const nov27 = new Date(year, 10, 27);
    const dayOfNov27 = nov27.getDay(); 
    const offset = (7 - dayOfNov27) % 7;
    const advent1st = new Date(year, 10, 27 + offset);
    addDate(advent1st.getMonth()+1, advent1st.getDate(), "대림절 제1주(교회력 시작)", 'lit', "var(--lit-text)", false);

    addDate(1, 6, "주현절", 'lit', "#333", false);

    cachedHolidays = holidays;
    cachedYear = year;
}

// ==========================================
// [3] 인증 로직 (수정됨: 이름 중복 허용, PW로 구분)
// ==========================================
async function handleAuthAction() {
    const name = document.getElementById('church-name').value.trim();
    const pw = document.getElementById('church-pw').value.trim();
    const errorMsg = document.getElementById('error-msg');
    const rememberCheck = document.getElementById('remember-check');
    const autoLoginCheck = document.getElementById('auto-login-check');

    if (!name || !pw) { errorMsg.innerText = "필수 정보를 입력해주세요."; return; }

    const churchesRef = collection(db, "churches");
    // 이름과 비밀번호가 모두 일치하는지 확인하는 쿼리
    const q = query(churchesRef, where("name", "==", name), where("password", "==", pw));

    try {
        const querySnapshot = await getDocs(q);

        if (isRegisterMode) {
            // [그룹 생성]
            if (!querySnapshot.empty) {
                // 이름과 비번이 완벽히 똑같은 그룹이 이미 있으면 중복으로 간주
                // [요청 사항 반영] 문구 수정
                errorMsg.innerText = "비밀번호 수정해도 입장 가능";
            } else {
                // 이름은 같아도 비번이 다르면 새 문서 생성 (addDoc으로 자동 ID 부여)
                const newDocRef = await addDoc(churchesRef, {
                    name: name,
                    password: pw,
                    events: {}
                });
                alert("새로운 그룹이 생성되었습니다!");
                enterService(newDocRef.id, name);
            }
        } else {
            // [입장하기]
            if (!querySnapshot.empty) {
                // 일치하는 그룹 찾음 (첫 번째 문서로 입장)
                const docSnap = querySnapshot.docs[0];
                
                if (rememberCheck && rememberCheck.checked) {
                    const authData = { name, pw, autoLogin: autoLoginCheck.checked };
                    localStorage.setItem('churchAuthData', JSON.stringify(authData));
                } else {
                    localStorage.removeItem('churchAuthData');
                }
                // 문서 ID와 이름을 전달
                enterService(docSnap.id, name);
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

// 입장 처리: 이제 docId를 받아서 해당 문서를 구독함
function enterService(docId, name) {
    churchInfo = { id: docId, name: name };
    isAdmin = true; 
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('calendar-view').style.display = 'flex';
    document.getElementById('display-church-name').innerText = name;
    
    // 문서 ID로 구독 (이름 아님)
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
    
    document.querySelector('.checkbox-group').style.display = isRegisterMode ? 'none' : 'flex';
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
// [4] Firestore 저장/삭제/이동 로직 (ID 기반)
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
                if (info.isHoliday) {
                    badge.classList.add('holiday-badge');
                    bg = "var(--holiday-bg)"; txt = "var(--holiday)";
                    isRedDay = true;
                } else if (info.type === 'lit') {
                    badge.classList.add('lit-badge');
                    bg = "var(--lit-bg)"; txt = "var(--lit-text)";
                }
                
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

function shareMonth() {
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
        navigator.share({
            title: `${churchName} ${currentMonth + 1}월 일정`,
            text: shareText
        }).catch(err => {
            copyToClipboard(shareText);
        });
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

// [중요] HTML 연결 - 모듈 함수를 전역(Window)으로 노출
window.handleAuthAction = handleAuthAction;
window.toggleMode = toggleMode;
window.changeMonth = changeMonth;
window.logout = logout;
window.shareMonth = shareMonth;
window.saveSchedule = saveSchedule;
window.deleteSchedule = deleteSchedule;
window.closeModal = closeModal;
window.toggleTimeInputs = toggleTimeInputs;
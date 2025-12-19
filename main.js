import { db } from './firebase.js';
import { doc, getDoc, onSnapshot, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './store.js';
import { createLocalDate, formatLocalDate, toKeyFormat, generateUUID, calculateYearlyData } from './utils.js';
import { handleAuthAction, handleGuestLogin, logout, checkAutoLogin, toggleMode, inviteUser } from './auth.js';

// ==========================================
// [1] 기능 함수 정의
// ==========================================

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

    Object.keys(state.eventsCache).forEach(key => {
        const data = state.eventsCache[key];
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
        await updateDoc(doc(db, "churches", state.churchInfo.id), updates);
    } catch(e) {
        alert("이동 실패: " + e.message);
    }
}

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

    const newId = state.currentEditingId || generateUUID();
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

    if (state.currentEditingId) {
        Object.keys(state.eventsCache).forEach(key => {
            const data = state.eventsCache[key];
            if (data && typeof data === 'string' && data.includes(state.currentEditingId)) {
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
        await updateDoc(doc(db, "churches", state.churchInfo.id), newUpdates);
        history.back();
    } catch(e) {
        alert("저장 실패: " + e.message);
    }
}

async function deleteSchedule() {
    if(!confirm("이 일정을 삭제하시겠습니까?")) return;
    
    let updates = {};
    if (state.currentEditingId) {
        Object.keys(state.eventsCache).forEach(key => {
            const data = state.eventsCache[key];
            if (data && typeof data === 'string' && data.includes(state.currentEditingId)) {
                updates[`events.${key}`] = deleteField();
            }
        });
    } else {
        const dateVal = document.getElementById('start-date').value;
        const key = toKeyFormat(dateVal);
        if(state.eventsCache[key]) {
            updates[`events.${key}`] = deleteField();
        }
    }

    if(Object.keys(updates).length > 0) {
        try {
            await updateDoc(doc(db, "churches", state.churchInfo.id), updates);
            history.back();
        } catch(e) {
            alert("삭제 실패: " + e.message);
        }
    } else {
        history.back();
    }
}

// ==========================================
// [2] 화면 렌더링 및 UI
// ==========================================

function enterService(docId, name, isManager) {
    state.churchInfo = { id: docId, name: name };
    state.isAdmin = isManager; 
    
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('calendar-view').style.display = 'flex';
    document.getElementById('display-church-name').innerText = name;
    
    onSnapshot(doc(db, "churches", docId), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            state.eventsCache = data.events || {}; 
            calculateYearlyData(state.currentYear, state);
            renderCalendar();
        }
    });

    initGestures();
}

function renderCalendar() {
    const existingOverlay = document.querySelector('.expanded-badge-card');
    if (existingOverlay) existingOverlay.remove();

    calculateYearlyData(state.currentYear, state);
    const grid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('current-month-year');
    const seasonDisplay = document.getElementById('liturgical-season');
    
    const events = state.eventsCache; 

    document.getElementById('move-guide').onclick = exitMoveMode;

    const oldDays = grid.querySelectorAll('.day');
    oldDays.forEach(d => d.remove());

    monthDisplay.innerText = `${state.currentYear}년 ${state.currentMonth + 1}월`;
    updateLiturgicalBadge(seasonDisplay);

    const firstDayOfWeek = new Date(state.currentYear, state.currentMonth, 1).getDay();
    const lastDate = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
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
        
        const dateStrForDrop = `${state.currentYear}-${String(state.currentMonth+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
        dayEl.setAttribute('data-date', dateStrForDrop);

        if (state.isAdmin) {
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
                if (state.isMovingMode && state.movingEventData) {
                    moveEvent(state.movingEventData, dateStrForDrop);
                    exitMoveMode();
                } else {
                    openModal(state.currentYear, state.currentMonth + 1, i);
                }
            });
        } else {
             dayEl.onclick = () => openModal(state.currentYear, state.currentMonth + 1, i);
        }
        
        const dateNum = document.createElement('span');
        dateNum.className = 'date-num';
        dateNum.innerText = i;
        dayEl.appendChild(dateNum);

        const currentDayOfWeek = new Date(state.currentYear, state.currentMonth, i).getDay();
        const dateKey = `${state.currentYear}-${state.currentMonth+1}-${i}`;
        const shortKey = `${state.currentMonth+1}-${i}`;

        let isRedDay = currentDayOfWeek === 0;
        const dayInfos = state.cachedHolidays[shortKey];

        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'badge-container';

        if (dayInfos) {
            dayInfos.forEach(info => {
                const badge = document.createElement('div');
                badge.className = 'badge';
                badge.innerText = info.name;
                
                let bg, txt;
                if (info.color) {
                    bg = info.color; txt = "#fff";
                    if (info.isHoliday) isRedDay = true; 
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
            
            if (rawData.startsWith('{')) {
                const data = JSON.parse(rawData);
                displayTitle = data.title;
                // [수정] 시간이 있으면 제목 뒤에 시간 표시 (제목 우선)
                if(!data.isAllDay && data.startTime) {
                    displayTitle = `${displayTitle} ${data.startTime}`;
                }
                bgColor = data.color || "#4285F4";
                eventBadge.style.backgroundColor = bgColor;
                eventBadge.style.color = "#fff";
                
                if (state.isMovingMode && state.movingEventData && state.movingEventData.id === data.id) {
                    eventBadge.classList.add('moving-selected');
                }

                if (state.isAdmin) {
                    eventBadge.setAttribute('draggable', 'true');
                    eventBadge.ondragstart = (e) => {
                        e.dataTransfer.setData('text/plain', JSON.stringify(data));
                        eventBadge.classList.add('dragging');
                    };
                    eventBadge.ondragend = () => { eventBadge.classList.remove('dragging'); };
                    eventBadge.addEventListener('touchstart', (e) => {
                        state.longPressTimer = setTimeout(() => { enterMoveMode(data); }, 600); 
                    }, {passive: true});
                    eventBadge.addEventListener('touchend', () => {
                        if (state.longPressTimer) clearTimeout(state.longPressTimer);
                    }, {passive: true});
                }
            } else {
                displayTitle = rawData;
                eventBadge.classList.add('event-badge');
            }
            
            eventBadge.innerText = displayTitle;
            eventBadge.onclick = (e) => {
                if (state.isMovingMode) return; 
                e.stopPropagation();
                openModal(state.currentYear, state.currentMonth + 1, i);
            };
            badgeContainer.appendChild(eventBadge);
        }

        dayEl.appendChild(badgeContainer);

        const today = new Date();
        if (i === today.getDate() && state.currentMonth === today.getMonth() && state.currentYear === today.getFullYear()) {
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

// === Helpers ===

function openModal(year, month, day) {
    // [수정] 모달 열기 전 떠있는 플로팅 카드(절기 설명) 제거
    const existingOverlay = document.querySelector('.expanded-badge-card');
    if (existingOverlay) existingOverlay.remove();

    if(state.isMovingMode) return;

    history.pushState({ modal: 'open' }, null, '');

    const dateKey = `${year}-${month}-${day}`;
    const rawData = state.eventsCache[dateKey];
    
    if (!state.isAdmin) {
        if (rawData) {
            let data = rawData.startsWith('{') ? JSON.parse(rawData) : { title: rawData, desc: '' };
            let timeStr = "";
            if(data.isAllDay) timeStr = "[종일]";
            else if(data.startTime) timeStr = `${data.startTime} ~ ${data.endTime || ''}`;
            
            alert(`[일정 상세]\n\n제목: ${data.title}\n일시: ${data.startDate} ~ ${data.endDate}\n시간: ${timeStr}\n내용: ${data.desc}`);
        }
        history.back();
        return;
    }

    const modal = document.getElementById('event-modal');
    modal.style.display = 'flex';
    
    state.currentEditingId = null;
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
            state.currentEditingId = data.id || null;
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
    history.back();
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

function changeMonth(step) {
    if(step === 0) { 
        const now = new Date();
        state.currentMonth = now.getMonth();
        state.currentYear = now.getFullYear();
    } else {
        state.currentMonth += step;
        if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; } 
        else if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
    }
    renderCalendar();
}

async function shareMonth() {
    const events = state.eventsCache;
    const churchName = state.churchInfo.name || "우리교회";
    let monthEvents = [];

    Object.keys(events).forEach(key => {
        const [y, m, d] = key.split('-').map(Number);
        if (y === state.currentYear && m === (state.currentMonth + 1)) {
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

    let shareText = `[${churchName} ${state.currentMonth + 1}월 일정]\n\n`;
    if (monthEvents.length === 0) {
        shareText += "등록된 일정이 없습니다.";
    } else {
        monthEvents.forEach(e => {
            let line = `${state.currentMonth+1}월 ${e.day}일`;
            if (e.time) line += ` (${e.time})`;
            line += `: ${e.title}`;
            shareText += `${line}\n`;
        });
    }
    
    shareText += "\n\nFAITHS 크리스천 성장 도구 플랫폼\nhttps://csy870617.github.io/faiths/";

    if (navigator.share) {
        try {
            await navigator.share({ text: shareText });
        } catch (err) {
            if (err.name !== 'AbortError') copyToClipboard(shareText);
        }
    } else {
        copyToClipboard(shareText);
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert("일정이 클립보드에 복사되었습니다.");
    }).catch(err => alert("복사 실패"));
}

function updateLiturgicalBadge(element) {
    const m = state.currentMonth + 1;
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
    
    card.onclick = (e) => { e.stopPropagation(); card.remove(); };
    document.body.appendChild(card);

    setTimeout(() => {
        document.addEventListener('click', function close(e) {
            if(e.target !== card) {
                card.remove();
                document.removeEventListener('click', close);
            }
        });
    }, 0);
}

function enterMoveMode(data) {
    state.isMovingMode = true;
    state.movingEventData = data;
    document.getElementById('move-guide').style.display = 'block';
    renderCalendar(); 
}

function exitMoveMode() {
    state.isMovingMode = false;
    state.movingEventData = null;
    document.getElementById('move-guide').style.display = 'none';
    renderCalendar();
}

function initGestures() {
    const container = document.getElementById('calendar-grid');
    if(!container) return;
    
    container.addEventListener('wheel', (e) => {
        if (state.isAnimating) return;
        if (e.deltaY > 0) changeMonth(1); else changeMonth(-1);
        state.isAnimating = true; setTimeout(() => state.isAnimating = false, 500);
    });

    container.addEventListener('touchstart', (e) => { state.touchStartX = e.changedTouches[0].screenX; }, {passive:true});
    container.addEventListener('touchend', (e) => {
        state.touchEndX = e.changedTouches[0].screenX;
        if (state.touchEndX < state.touchStartX - 50) changeMonth(1);
        if (state.touchEndX > state.touchStartX + 50) changeMonth(-1);
    }, {passive:true});
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

// [중요] 모달/히스토리 이벤트 리스너 추가
window.addEventListener('popstate', () => {
    const modal = document.getElementById('event-modal');
    // 뒤로가기 시 팝업 닫기
    if (modal && modal.style.display === 'flex') {
        modal.style.display = 'none';
    }
});

// [Global Link]
window.enterService = enterService;
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
window.exitMoveMode = exitMoveMode;

// Init
checkAutoLogin();
setupColorPalette();
setupDateListeners();
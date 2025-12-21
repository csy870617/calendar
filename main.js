import { db } from './firebase.js';
import { doc, getDoc, onSnapshot, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './store.js';
// utils.js에서 날짜 관련 함수 제외 (충돌 방지)
import { generateUUID, calculateYearlyData } from './utils.js'; 
import { handleAuthAction, handleGuestLogin, logout, checkAutoLogin, toggleMode, inviteUser } from './auth.js';

// ==========================================
// [1] 핵심 유틸리티 (날짜 포맷 통일)
// ==========================================

function formatDateKey(year, month, day) {
    if (year instanceof Date) {
        const d = year;
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

function parseDateStr(dateStr) {
    if (!dateStr) return new Date();
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function getEventsArray(dateKey) {
    const rawData = state.eventsCache[dateKey];
    if (!rawData) return [];
    if (rawData.startsWith('[')) return JSON.parse(rawData);
    else if (rawData.startsWith('{')) return [JSON.parse(rawData)];
    else return [{ id: generateUUID(), title: rawData, isAllDay: true, color: "#4285F4" }];
}

// ==========================================
// [2] 일정 이동 및 저장 로직
// ==========================================

async function moveEvent(eventData, newStartDateStr) {
    const oldStart = parseDateStr(eventData.startDate);
    const oldEnd = parseDateStr(eventData.endDate);
    const newStart = parseDateStr(newStartDateStr);
    
    const diffTime = Math.abs(oldEnd - oldStart);
    const durationDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    const newEnd = new Date(newStart);
    newEnd.setDate(newEnd.getDate() + durationDays);

    const newStartStr = formatDateKey(newStart);
    const newEndStr = formatDateKey(newEnd);
    const eventId = eventData.id;

    if (!eventId) { alert("데이터 오류: ID가 없습니다."); return; }

    let tempUpdates = {};

    // 1. 기존 날짜 제거
    let tempDate = new Date(oldStart);
    const tempEndObj = new Date(oldEnd);
    
    while(tempDate <= tempEndObj) {
        const key = formatDateKey(tempDate);
        let arr = getEventsArray(key);
        const newArr = arr.filter(e => e.id !== eventId);
        
        if (newArr.length === 0) tempUpdates[key] = "DELETE";
        else tempUpdates[key] = JSON.stringify(newArr);
        
        tempDate.setDate(tempDate.getDate() + 1);
    }

    // 2. 데이터 업데이트
    eventData.startDate = newStartStr;
    eventData.endDate = newEndStr;

    // 3. 새 날짜 추가
    let loopDate = new Date(newStart);
    const finalEndObj = new Date(newEnd);
    
    while(loopDate <= finalEndObj) {
        const key = formatDateKey(loopDate);
        let currentArr = [];

        if (tempUpdates[key] !== undefined) {
            if (tempUpdates[key] === "DELETE") currentArr = [];
            else currentArr = JSON.parse(tempUpdates[key]);
        } else {
            currentArr = getEventsArray(key);
        }
        
        currentArr.push(eventData);
        tempUpdates[key] = JSON.stringify(currentArr);
        loopDate.setDate(loopDate.getDate() + 1);
    }

    // 4. DB 반영
    let finalUpdates = {};
    for (const [key, val] of Object.entries(tempUpdates)) {
        if (val === "DELETE") finalUpdates[`events.${key}`] = deleteField();
        else finalUpdates[`events.${key}`] = val;
    }

    try {
        await updateDoc(doc(db, "churches", state.churchInfo.id), finalUpdates);
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

    let tempUpdates = {};

    if (state.currentEditingId) {
        Object.keys(state.eventsCache).forEach(key => {
            let arr = getEventsArray(key);
            const exists = arr.find(e => e.id === state.currentEditingId);
            if (exists) {
                const newArr = arr.filter(e => e.id !== state.currentEditingId);
                if (newArr.length === 0) tempUpdates[key] = "DELETE";
                else tempUpdates[key] = JSON.stringify(newArr);
            }
        });
    }

    let loopDate = parseDateStr(startDateVal);
    const finalEndObj = parseDateStr(endDateVal);
    
    while(loopDate <= finalEndObj) {
        const key = formatDateKey(loopDate);
        let currentArr = [];

        if (tempUpdates[key] !== undefined) {
            if (tempUpdates[key] === "DELETE") currentArr = [];
            else currentArr = JSON.parse(tempUpdates[key]);
        } else {
            currentArr = getEventsArray(key);
        }

        currentArr.push(eventObj);
        tempUpdates[key] = JSON.stringify(currentArr);
        loopDate.setDate(loopDate.getDate() + 1);
    }

    let finalUpdates = {};
    for (const [key, val] of Object.entries(tempUpdates)) {
        if (val === "DELETE") finalUpdates[`events.${key}`] = deleteField();
        else finalUpdates[`events.${key}`] = val;
    }

    try {
        await updateDoc(doc(db, "churches", state.churchInfo.id), finalUpdates);
        closeModal();
    } catch(e) {
        alert("저장 실패: " + e.message);
    }
}

async function deleteSchedule() {
    if(!confirm("이 일정을 삭제하시겠습니까?")) return;
    if (!state.currentEditingId) return;

    let finalUpdates = {};
    Object.keys(state.eventsCache).forEach(key => {
        let arr = getEventsArray(key);
        if (arr.find(e => e.id === state.currentEditingId)) {
            const newArr = arr.filter(e => e.id !== state.currentEditingId);
            if (newArr.length === 0) finalUpdates[`events.${key}`] = deleteField();
            else finalUpdates[`events.${key}`] = JSON.stringify(newArr);
        }
    });

    if(Object.keys(finalUpdates).length > 0) {
        try {
            await updateDoc(doc(db, "churches", state.churchInfo.id), finalUpdates);
            closeModal();
        } catch(e) {
            alert("삭제 실패: " + e.message);
        }
    } else {
        closeModal();
    }
}

// ==========================================
// [3] 화면 렌더링
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
            
            if (document.getElementById('list-modal').style.display === 'flex') {
                const dateKey = document.getElementById('list-modal').getAttribute('data-key');
                if (dateKey) openListModal(dateKey); 
            }
        }
    });

    initGestures();
}

// [핵심 수정] 달력 렌더링 (헤더 자동 생성 포함)
function renderCalendar() {
    const existingOverlay = document.querySelector('.expanded-badge-card');
    if (existingOverlay) existingOverlay.remove();

    calculateYearlyData(state.currentYear, state);
    const grid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('current-month-year');
    const seasonDisplay = document.getElementById('liturgical-season');
    
    document.getElementById('move-guide').onclick = exitMoveMode;

    // [중요] 그리드 전체 초기화 (헤더가 없으면 다시 그리기 위해)
    grid.innerHTML = ''; 

    monthDisplay.innerText = `${state.currentYear}년 ${state.currentMonth + 1}월`;
    updateLiturgicalBadge(seasonDisplay);

    // [1] 요일 헤더 생성 (강제 삽입 - 첫째 주 밀림 방지)
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    dayNames.forEach((name, index) => {
        const header = document.createElement('div');
        header.className = 'day-name';
        if (index === 0) header.classList.add('sun');
        header.innerText = name;
        grid.appendChild(header);
    });

    // [2] 날짜 계산
    const firstDayOfMonth = new Date(state.currentYear, state.currentMonth, 1);
    const lastDayOfMonth = new Date(state.currentYear, state.currentMonth + 1, 0);
    
    const startDayOfWeek = firstDayOfMonth.getDay();
    const totalDays = lastDayOfMonth.getDate();
    const prevMonthLastDate = new Date(state.currentYear, state.currentMonth, 0).getDate();

    // [3] 이전 달 날짜
    for (let i = 0; i < startDayOfWeek; i++) {
        const dayNum = prevMonthLastDate - startDayOfWeek + i + 1;
        let pm = state.currentMonth - 1;
        let py = state.currentYear;
        if (pm < 0) { pm = 11; py--; }
        createDayCell(grid, py, pm, dayNum, true);
    }

    // [4] 이번 달 날짜
    for (let i = 1; i <= totalDays; i++) {
        createDayCell(grid, state.currentYear, state.currentMonth, i, false);
    }

    // [5] 다음 달 날짜
    const filledCells = startDayOfWeek + totalDays;
    const remainingCells = 42 - filledCells;
    
    for (let i = 1; i <= remainingCells; i++) {
        let nm = state.currentMonth + 1;
        let ny = state.currentYear;
        if (nm > 11) { nm = 0; ny++; }
        createDayCell(grid, ny, nm, i, true);
    }
}

function createDayCell(grid, year, month, day, isOtherMonth) {
    const dayEl = document.createElement('div');
    dayEl.className = 'day';
    if (isOtherMonth) dayEl.classList.add('other-month');

    const dateKey = formatDateKey(year, month, day);
    
    dayEl.setAttribute('data-date', dateKey);

    if (state.isAdmin) {
        dayEl.ondragover = (e) => { e.preventDefault(); dayEl.classList.add('drag-over'); };
        dayEl.ondragleave = () => { dayEl.classList.remove('drag-over'); };
        dayEl.ondrop = (e) => {
            e.preventDefault();
            dayEl.classList.remove('drag-over');
            const json = e.dataTransfer.getData('text/plain');
            if (json) {
                const data = JSON.parse(json);
                moveEvent(data, dateKey);
            }
        };
    }

    dayEl.onclick = (e) => {
        const existingOverlay = document.querySelector('.expanded-badge-card');
        if (existingOverlay) existingOverlay.remove();

        if (state.isMovingMode && state.movingEventData) {
            moveEvent(state.movingEventData, dateKey);
            exitMoveMode();
            return;
        }

        const dayEvents = getEventsArray(dateKey);
        if (dayEvents.length > 0) {
            openListModal(dateKey);
        } else {
            if (state.isAdmin) openModal(year, month + 1, day);
        }
    };
    
    const dateNum = document.createElement('span');
    dateNum.className = 'date-num';
    dateNum.innerText = day;
    dayEl.appendChild(dateNum);

    if (!isOtherMonth) {
        const currentDayOfWeek = new Date(year, month, day).getDay();
        const shortKey = `${month+1}-${day}`;
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
        dayEl.appendChild(badgeContainer);
    } else {
        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'badge-container';
        dayEl.appendChild(badgeContainer);
    }

    const events = state.eventsCache;
    if (events[dateKey]) { 
        const dayEvents = getEventsArray(dateKey);
        const container = dayEl.querySelector('.badge-container');
        
        dayEvents.forEach(data => {
            const eventBadge = document.createElement('div');
            eventBadge.className = 'badge';
            
            let displayTitle = data.title;
            if(!data.isAllDay && data.startTime) {
                displayTitle = `${displayTitle} ${data.startTime}`;
            }
            
            eventBadge.style.backgroundColor = data.color || "#4285F4";
            eventBadge.style.color = "#fff";
            eventBadge.innerText = displayTitle;
            
            if (state.isMovingMode && state.movingEventData && state.movingEventData.id === data.id) {
                eventBadge.classList.add('moving-selected');
            }

            if (state.isAdmin) {
                eventBadge.setAttribute('draggable', 'true');
                eventBadge.ondragstart = (e) => {
                    e.stopPropagation();
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

            eventBadge.onclick = (e) => {
                e.stopPropagation();
                if(state.isMovingMode) return;
                openListModal(dateKey);
            };

            container.appendChild(eventBadge);
        });
    }

    const today = new Date();
    if (year === today.getFullYear() && month === today.getMonth() && day === today.getDate()) {
        dayEl.classList.add('today');
    }
    
    grid.appendChild(dayEl);
}

// ==========================================
// [4] 모달 로직
// ==========================================

function openListModal(dateKey) {
    const modal = document.getElementById('list-modal');
    const container = document.getElementById('event-list-container');
    const title = document.getElementById('list-date-title');
    
    if (history.state?.modal !== 'list') {
        history.pushState({ modal: 'list' }, null, '');
    }

    const [y, m, d] = dateKey.split('-').map(Number);
    title.innerText = `${m}월 ${d}일 일정`;
    modal.setAttribute('data-key', dateKey); 
    
    container.innerHTML = ""; 
    
    const dayEvents = getEventsArray(dateKey);

    if (dayEvents.length === 0) {
        container.innerHTML = `<div class="empty-list-msg">일정이 없습니다.</div>`;
    } else {
        dayEvents.forEach(evt => {
            const item = document.createElement('div');
            item.className = 'event-list-item';
            
            let timeStr = "하루 종일";
            if (!evt.isAllDay && evt.startTime) {
                timeStr = `${evt.startTime} ~ ${evt.endTime || ''}`;
            }

            item.innerHTML = `
                <div class="event-color-dot" style="background-color: ${evt.color || '#4285F4'};"></div>
                <div class="event-info">
                    <span class="event-title">${evt.title}</span>
                    <span class="event-time">${timeStr}</span>
                </div>
            `;
            
            item.onclick = () => {
                history.pushState({ modal: 'edit' }, null, ''); 
                openEditModal(evt);
            };

            container.appendChild(item);
        });
    }

    modal.style.display = 'flex';
}

function closeListModal() {
    history.back();
}

window.openAddModalFromList = function() {
    const dateKey = document.getElementById('list-modal').getAttribute('data-key');
    if(!dateKey) return;
    const [y, m, d] = dateKey.split('-').map(Number);
    history.pushState({ modal: 'add' }, null, '');
    openModal(y, m, d);
}

function openModal(year, month, day) {
    if(state.isMovingMode) return;

    if (!history.state || history.state.modal !== 'add') {
         history.pushState({ modal: 'add' }, null, '');
    }

    const modal = document.getElementById('event-modal');
    modal.style.display = 'flex';
    document.getElementById('modal-title').innerText = "일정 추가";
    document.getElementById('btn-delete').style.display = 'none'; 

    state.currentEditingId = null;
    const dateStr = formatDateKey(year, month-1, day); 
    
    setModalValues(dateStr, dateStr, "", "", "", true, "#4285F4", "");
}

function openEditModal(evt) {
    const modal = document.getElementById('event-modal');
    modal.style.display = 'flex';
    document.getElementById('modal-title').innerText = "일정 수정";
    document.getElementById('btn-delete').style.display = 'block'; 

    state.currentEditingId = evt.id;
    
    setModalValues(
        evt.startDate, 
        evt.endDate, 
        evt.title, 
        evt.startTime, 
        evt.endTime, 
        evt.isAllDay, 
        evt.color, 
        evt.desc
    );
}

function setModalValues(sDate, eDate, title, sTime, eTime, allDay, color, desc) {
    document.getElementById('input-title').value = title;
    document.getElementById('start-date').value = sDate;
    document.getElementById('end-date').value = eDate;
    document.getElementById('start-time').value = sTime || "09:00";
    document.getElementById('end-time').value = eTime || "10:00";
    document.getElementById('all-day-check').checked = allDay;
    toggleTimeInputs();
    document.getElementById('input-desc').value = desc || "";
    
    const colorVal = color || "#4285F4";
    document.querySelectorAll('.color-option').forEach(o => {
        o.classList.remove('selected');
        if(o.getAttribute('data-color') === colorVal) o.classList.add('selected');
    });
    document.getElementById('selected-color').value = colorVal;
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
            const dayEvents = getEventsArray(key);
            dayEvents.forEach(data => {
                monthEvents.push({
                    day: d,
                    title: data.title,
                    time: data.isAllDay ? "종일" : (data.startTime || ""),
                    desc: data.desc || ""
                });
            });
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

window.addEventListener('popstate', () => {
    const eventModal = document.getElementById('event-modal');
    const listModal = document.getElementById('list-modal');
    if (eventModal && eventModal.style.display === 'flex') {
        eventModal.style.display = 'none';
        return;
    }
    if (listModal && listModal.style.display === 'flex') {
        listModal.style.display = 'none';
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
window.closeListModal = closeListModal;
window.toggleTimeInputs = toggleTimeInputs;
window.exitMoveMode = exitMoveMode;
window.openAddModalFromList = openAddModalFromList;

// Init
checkAutoLogin();
setupColorPalette();
setupDateListeners();
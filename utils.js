// utils.js
export function createLocalDate(dateStr) {
    if (!dateStr) return new Date();
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function formatLocalDate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function toKeyFormat(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${y}-${m}-${d}`;
}

export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// === 교회력 및 공휴일 계산 ===
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

export function calculateYearlyData(year, state) {
    if (state.cachedYear === year) return;
    const holidays = {}; 
    const addDate = (m, d, name, type, color, isHoliday = false) => {
        const key = `${m}-${d}`;
        if (!holidays[key]) holidays[key] = [];
        holidays[key].push({ name, type, color, isHoliday });
    };

    // 색상 정의
    const COL_PURPLE = "#7B1FA2"; 
    const COL_GOLD   = "#D4AF37"; 
    const COL_RED    = "#D32F2F"; 
    const COL_GREEN  = "#2E7D32"; 

    // 1. 양력 공휴일
    for (const [key, name] of Object.entries(solarHolidays)) {
        const [m, d] = key.split('-').map(Number);
        if (key === "12-25") addDate(m, d, name, 'lit', COL_GOLD, true); 
        else addDate(m, d, name, 'holiday', null, true);
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

    // 설날, 추석, 석가탄신일 계산
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

    const ashWed = new Date(easterDate); ashWed.setDate(ashWed.getDate() - 46);
    addDate(ashWed.getMonth()+1, ashWed.getDate(), "재의 수요일(사순절 시작)", 'lit', COL_PURPLE, false);

    const transfiguration = new Date(ashWed); transfiguration.setDate(transfiguration.getDate() - 3);
    addDate(transfiguration.getMonth()+1, transfiguration.getDate(), "산상변모 주일", 'lit', COL_GOLD, false);

    const palmSunday = new Date(easterDate); palmSunday.setDate(palmSunday.getDate() - 7);
    addDate(palmSunday.getMonth()+1, palmSunday.getDate(), "종려주일(고난주간)", 'lit', COL_RED, false);

    const goodFriday = new Date(easterDate); goodFriday.setDate(goodFriday.getDate() - 2);
    addDate(goodFriday.getMonth()+1, goodFriday.getDate(), "성금요일", 'lit', COL_RED, false);

    const ascension = new Date(easterDate); ascension.setDate(ascension.getDate() + 39);
    addDate(ascension.getMonth()+1, ascension.getDate(), "주님 승천일", 'lit', COL_GOLD, false);

    const pentecost = new Date(easterDate); pentecost.setDate(pentecost.getDate() + 49);
    addDate(pentecost.getMonth()+1, pentecost.getDate(), "성령강림절", 'lit', COL_RED, false);

    const trinity = new Date(pentecost); trinity.setDate(trinity.getDate() + 7);
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

    const christKing = new Date(advent1st); christKing.setDate(christKing.getDate() - 7);
    addDate(christKing.getMonth()+1, christKing.getDate(), "왕이신 그리스도 주일", 'lit', COL_GOLD, false);

    state.cachedHolidays = holidays;
    state.cachedYear = year;
}
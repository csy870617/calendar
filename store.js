// store.js
export const state = {
    currentDate: new Date(),
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    churchInfo: { name: "", id: "" },
    eventsCache: {},
    isAdmin: false,
    isRegisterMode: false,
    cachedHolidays: {},
    cachedYear: null,
    isAnimating: false,
    movingEventData: null,
    isMovingMode: false,
    currentEditingId: null,
    longPressTimer: null
};
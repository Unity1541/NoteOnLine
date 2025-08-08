

import { auth, db } from './firebase.js';
import { 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { 
    collection, 
    query, 
    onSnapshot, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    doc,
    orderBy,
    where
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import {
    renderHeader,
    renderCalendarGrid,
    renderSidebar
} from './planner-renderer.js';

// --- 管理者帳號設定 ---
const ADMIN_CONFIG = {
    email: 'admin@hotmail.com',    // 替換成你想要的管理者郵箱
    password: 'password'           // 替換成你想要的管理者密碼
};

const colorOptions = ['#A7F3D0', '#BBF7D0', '#FED7AA', '#FBCFE8', '#DDD6FE', '#BFDBFE', '#F9A8D4', '#C084FC'];

// --- STATE ---
let state = {
    isLoggedIn: false,
    currentUser: null,
    isAdmin: false,
    events: [],
    unsubscribeEvents: null,
    unsubscribeAdminEvents: null,
    currentWeekStart: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()),
    editingEventId: null,
    selectedColor: colorOptions[0],
    chartInstance: null
};

// --- DOM SELECTORS ---
const loginScreen = document.getElementById('login-screen');
const plannerApp = document.getElementById('planner-app');
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const userDisplayName = document.getElementById('user-display-name');
const weekDisplay = document.getElementById('week-display');
const currentTimeDisplay = document.getElementById('current-time-display');
const prevWeekBtn = document.getElementById('prev-week-btn');
const todayBtn = document.getElementById('today-btn');
const nextWeekBtn = document.getElementById('next-week-btn');
const logoutBtn = document.getElementById('logout-btn');
const addEventForm = document.getElementById('add-event-form');
const formTitle = document.getElementById('form-title');
const eventTitleInput = document.getElementById('event-title-input');
const eventChapterInput = document.getElementById('event-chapter-input');
const eventPagesInput = document.getElementById('event-pages-input');
const eventDateSelect = document.getElementById('event-date-select');
const eventStartHourInput = document.getElementById('event-start-hour-input');
const eventStartMinuteInput = document.getElementById('event-start-minute-input');
const eventEndHourInput = document.getElementById('event-end-hour-input');
const eventEndMinuteInput = document.getElementById('event-end-minute-input');
const eventNotesInput = document.getElementById('event-notes-input');
const eventColorPicker = document.getElementById('event-color-picker');
const saveEventBtn = document.getElementById('save-event-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const formStatus = document.getElementById('form-status');

// Admin Panel selectors
const adminPanel = document.getElementById('admin-panel');
const formContainer = document.getElementById('form-container');
const adminEventsList = document.getElementById('admin-events-list');
const userProgressChartCanvas = document.getElementById('user-progress-chart');
const chartNoData = document.getElementById('chart-no-data');

// The form elements are needed for the sidebar renderer
const sidebarDOMElements = { summaryContent: null, checklistContent: null, eventDateSelect, eventColorPicker };


// --- UTILITY FUNCTIONS ---
const setButtonLoading = (button, isLoading, text) => {
    const btnText = button.querySelector('.btn-text');
    const spinner = button.querySelector('.spinner');
    button.disabled = isLoading;
    if (isLoading) {
        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');
    } else {
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
        if (text) btnText.textContent = text;
    }
};

const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getWeekDays = (startDate) => {
    const week = [];
    const monday = new Date(startDate);
    const dayOfWeek = monday.getDay();
    const daysFromMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setDate(monday.getDate() + daysFromMonday);
    for (let i = 0; i < 7; i++) {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        week.push(day);
    }
    return week;
};


// --- RENDER FUNCTIONS ---
function renderAppUI() {
    if (state.isLoggedIn && state.isAdmin) {
        loginScreen.classList.add('hidden');
        plannerApp.classList.remove('hidden');
        renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay);
        // Admin doesn't have a calendar, but we need to render the form elements.
        renderSidebar(state, { ...sidebarDOMElements, summaryContent: document.createElement('div'), checklistContent: document.createElement('div')});
        hideForm(); // Init form state to be hidden
        loadAdminData();
    } else {
        loginScreen.classList.remove('hidden');
        plannerApp.classList.add('hidden');
    }
    lucide.createIcons();
}

// --- FIREBASE & AUTHENTICATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (user.email !== ADMIN_CONFIG.email) {
            loginError.textContent = "權限不足，僅管理員可登入。將自動登出。";
            setTimeout(() => handleLogout(), 2000);
            return;
        }

        state.isLoggedIn = true;
        state.currentUser = user;
        state.isAdmin = true;
        // Admin view doesn't show their own events on the calendar.
        state.events = [];
    } else {
        state.isLoggedIn = false;
        state.currentUser = null;
        state.isAdmin = false;
        state.events = [];
        if (state.unsubscribeEvents) state.unsubscribeEvents();
        if (state.unsubscribeAdminEvents) state.unsubscribeAdminEvents();
    }
    renderAppUI();
});

async function handleLogin(e) {
    e.preventDefault();
    loginError.textContent = '';
    setButtonLoading(loginBtn, true);
    const email = emailInput.value;
    const password = passwordInput.value;
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        console.error("Login failed:", error);
        loginError.textContent = "登入失敗，請檢查您的電子郵件或密碼。";
    } finally {
        setButtonLoading(loginBtn, false, '登入');
    }
}

function handleLogout() {
    signOut(auth);
    sessionStorage.removeItem('currentWeekStart');
}

// --- FIRESTORE DATA HANDLING ---

async function handleSaveEvent(e) {
    e.preventDefault();
    
    // Admins can't create events for themselves in this view.
    // This form is only for editing other users' events.
    if (!state.editingEventId) {
        formStatus.textContent = '請從下方列表選擇一個事件進行編輯。';
        formStatus.className = 'text-amber-600 text-sm text-center h-5';
        return;
    }

    const eventData = {
        title: eventTitleInput.value,
        chapter: eventChapterInput.value,
        pages: eventPagesInput.value,
        date: eventDateSelect.value,
        startTime: `${eventStartHourInput.value}:${eventStartMinuteInput.value}`,
        endTime: `${eventEndHourInput.value}:${eventEndMinuteInput.value}`,
        notes: eventNotesInput.value,
        color: state.selectedColor,
    };

    if (!eventData.title || !eventData.date || !eventStartHourInput.value || !eventStartMinuteInput.value || !eventEndHourInput.value || !eventEndMinuteInput.value) {
        formStatus.textContent = '請填寫所有必填欄位！';
        formStatus.className = 'text-red-500 text-sm text-center h-5';
        return;
    }

    setButtonLoading(saveEventBtn, true);
    formStatus.textContent = '';

    try {
        const eventRef = doc(db, "events", state.editingEventId);
        await updateDoc(eventRef, eventData);
        hideForm(); // Clear and hide form after successful edit
    } catch (error) {
        console.error("Error saving event: ", error);
        formStatus.textContent = "儲存失敗，請稍後再試。";
        formStatus.className = 'text-red-500 text-sm text-center h-5';
    } finally {
        setButtonLoading(saveEventBtn, false, '更新');
    }
}

function openEditForm(eventToEdit) {
    if (eventToEdit) {
        formContainer.classList.remove('hidden');
        state.editingEventId = eventToEdit.id;
        showForm(true); // isEditing = true
        eventTitleInput.value = eventToEdit.title;
        eventChapterInput.value = eventToEdit.chapter || '';
        eventPagesInput.value = eventToEdit.pages || '';
        eventDateSelect.value = eventToEdit.date;
        if (eventToEdit.startTime) {
            const [startHour, startMinute] = eventToEdit.startTime.split(':');
            eventStartHourInput.value = startHour;
            eventStartMinuteInput.value = startMinute;
        }
        if (eventToEdit.endTime) {
            const [endHour, endMinute] = eventToEdit.endTime.split(':');
            eventEndHourInput.value = endHour;
            eventEndMinuteInput.value = endMinute;
        }
        eventNotesInput.value = eventToEdit.notes || '';
        state.selectedColor = eventToEdit.color;
        // Re-render the form parts to update color picker
        renderSidebar(state, { ...sidebarDOMElements, summaryContent: document.createElement('div'), checklistContent: document.createElement('div')});
    }
}

// --- ADMIN FEATURES ---
function loadAdminData() {
    if (state.unsubscribeAdminEvents) state.unsubscribeAdminEvents();
    const q = query(collection(db, "events"), orderBy("date", "desc"));
    state.unsubscribeAdminEvents = onSnapshot(q, (snapshot) => {
        const allEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAdminEventsList(allEvents);
        renderUserProgressChart(allEvents);
    });
}

function renderUserProgressChart(allEvents) {
    const weekDays = getWeekDays(state.currentWeekStart);
    const firstDay = new Date(weekDays[0]);
    firstDay.setHours(0, 0, 0, 0); // BUG FIX: Set to start of Monday

    const lastDay = new Date(weekDays[6]);
    lastDay.setHours(23, 59, 59, 999);

    const weekEvents = allEvents.filter(e => {
        // By appending 'T00:00', we ensure the date is parsed in the local timezone, not UTC.
        const eventDate = new Date(e.date + 'T00:00');
        return eventDate >= firstDay && eventDate <= lastDay;
    });

    if (weekEvents.length === 0) {
        userProgressChartCanvas.classList.add('hidden');
        chartNoData.classList.remove('hidden');
        if(state.chartInstance) {
            state.chartInstance.destroy();
            state.chartInstance = null;
        }
        return;
    }
    
    userProgressChartCanvas.classList.remove('hidden');
    chartNoData.classList.add('hidden');

    const userProgress = {};
    weekEvents.forEach(event => {
        const email = event.email || '未知使用者';
        if (!userProgress[email]) {
            userProgress[email] = { total: 0, completed: 0 };
        }
        userProgress[email].total++;
        if (event.completed) {
            userProgress[email].completed++;
        }
    });

    const labels = Object.keys(userProgress);
    const data = labels.map(email => {
        const progress = userProgress[email];
        return (progress.completed / progress.total) * 100;
    });

    if (state.chartInstance) {
        state.chartInstance.destroy();
    }

    const ctx = userProgressChartCanvas.getContext('2d');
    state.chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '完成進度 (%)',
                data: data,
                backgroundColor: 'rgba(129, 140, 248, 0.6)',
                borderColor: 'rgba(129, 140, 248, 1)',
                borderWidth: 1,
                borderRadius: 8,
                barThickness: 30,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    beginAtZero: true,
                    max: 100,
                    grid: {
                        color: 'rgba(0,0,0,0.05)'
                    }
                },
                y: {
                     grid: {
                        display: false
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${context.raw.toFixed(1)}%`;
                        }
                    }
                }
            }
        }
    });
}


function renderAdminEventsList(allEvents) {
    adminEventsList.innerHTML = '';
    
    // Filter events to the current week
    const weekDays = getWeekDays(state.currentWeekStart);
    const firstDay = new Date(weekDays[0]);
    firstDay.setHours(0, 0, 0, 0);
    const lastDay = new Date(weekDays[6]);
    lastDay.setHours(23, 59, 59, 999);

    const weekEvents = allEvents.filter(e => {
        const eventDate = new Date(e.date + 'T00:00');
        return eventDate >= firstDay && eventDate <= lastDay;
    });

    if (weekEvents.length === 0) {
        adminEventsList.innerHTML = '<p class="text-slate-500 text-center p-4">本週沒有任何使用者的事件。</p>';
        return;
    }

    // Group events by user email
    const eventsByUser = weekEvents.reduce((acc, event) => {
        const email = event.email || '未知使用者';
        if (!acc[email]) {
            acc[email] = [];
        }
        acc[email].push(event);
        return acc;
    }, {});

    const sortedUsers = Object.keys(eventsByUser).sort();

    sortedUsers.forEach(email => {
        const userGroupEl = document.createElement('div');
        userGroupEl.className = 'user-group bg-white/50 backdrop-blur-sm p-4 rounded-2xl shadow-inner border border-slate-200/60 mb-6';
        
        let userEventsHTML = `
            <h3 class="text-lg font-semibold text-indigo-800 border-b border-indigo-200/80 pb-2 mb-4 flex items-center gap-2">
                <i data-lucide="user-circle-2" class="w-6 h-6"></i>
                ${email}
            </h3>
            <div class="space-y-3">
        `;

        const userEvents = eventsByUser[email].sort((a, b) => new Date(`${a.date}T${a.startTime}`) - new Date(`${b.date}T${b.startTime}`));

        userEvents.forEach(event => {
            userEventsHTML += `
                <div class="flex items-center gap-4 p-3 bg-white/80 rounded-2xl shadow-md border-l-8 transition-all duration-300 hover:shadow-lg hover:scale-[1.02]" style="border-left-color: ${event.color};">
                    <div class="flex-1 min-w-0">
                        <p class="font-bold text-slate-800 truncate">${event.title}</p>
                        <p class="text-sm text-slate-600 font-medium mt-1">${event.date} ${event.startTime}-${event.endTime}</p>
                        ${event.completed ? '<span class="text-xs text-green-600 font-bold bg-green-100/70 inline-block px-2 py-0.5 rounded-full mt-2">已完成</span>' : ''}
                    </div>
                    <div class="flex-shrink-0 flex items-center gap-1">
                        <button data-event='${JSON.stringify(event)}' class="admin-edit-btn text-slate-500 hover:text-indigo-600 hover:bg-indigo-100/50 p-3 rounded-full transition-colors duration-200">
                            <i data-lucide="edit-3" class="w-5 h-5"></i>
                        </button>
                        <button data-id="${event.id}" class="admin-delete-btn text-slate-500 hover:text-red-500 hover:bg-red-100/50 p-3 rounded-full transition-colors duration-200">
                            <i data-lucide="trash-2" class="w-5 h-5"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        userEventsHTML += '</div>';
        userGroupEl.innerHTML = userEventsHTML;
        adminEventsList.appendChild(userGroupEl);
    });

    lucide.createIcons();
}

async function handleAdminActions(e) {
    const deleteButton = e.target.closest('.admin-delete-btn');
    if (deleteButton) {
        const eventId = deleteButton.dataset.id;
        if (window.confirm(`(管理員) 確定要刪除這個事件嗎？此操作無法復原。`)) {
            await deleteDoc(doc(db, "events", eventId));
        }
        return;
    }

    const editButton = e.target.closest('.admin-edit-btn');
    if (editButton) {
        const eventData = JSON.parse(editButton.dataset.event);
        openEditForm(eventData);
        // Scroll to form for better UX
        formContainer.scrollIntoView({ behavior: 'smooth' });
    }
}

// --- EVENT HANDLERS ---
function handleNavigateWeek(direction) {
    const newDate = new Date(state.currentWeekStart);
    newDate.setDate(state.currentWeekStart.getDate() + (direction * 7));
    state.currentWeekStart = newDate;
    sessionStorage.setItem('currentWeekStart', state.currentWeekStart.toISOString());
    renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay);
    // Reload admin data for the new week for the chart
    loadAdminData();
}

function handleGoToToday() {
    const today = new Date();
    state.currentWeekStart = today;
    sessionStorage.setItem('currentWeekStart', state.currentWeekStart.toISOString());
    renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay);
    loadAdminData();
}

function showForm(isEditing = false) {
    addEventForm.classList.remove('hidden');
    formTitle.textContent = isEditing ? '編輯行程' : '請從下方選擇事件';
    setButtonLoading(saveEventBtn, false, isEditing ? '更新變更' : '更新變更');
    saveEventBtn.disabled = !isEditing;
    formStatus.textContent = '';
}

function hideForm() {
    formContainer.classList.add('hidden');
    state.editingEventId = null;
    addEventForm.querySelector('form').reset();
    eventTitleInput.value = '';
    eventNotesInput.value = '';
    eventChapterInput.value = '';
    eventPagesInput.value = '';
    state.selectedColor = colorOptions[0];
    showForm(false); // Reset form state for next time
}

function handleColorPick(e) {
    const button = e.target.closest('button');
    if (button && button.dataset.color) {
        state.selectedColor = button.dataset.color;
        renderSidebar(state, { ...sidebarDOMElements, summaryContent: document.createElement('div'), checklistContent: document.createElement('div')});
    }
}


// --- INITIALIZATION ---
function init() {
    const savedWeekStart = sessionStorage.getItem('currentWeekStart');
    if (savedWeekStart) {
        state.currentWeekStart = new Date(savedWeekStart);
    } else {
        const today = new Date();
        state.currentWeekStart = today;
    }

    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    prevWeekBtn.addEventListener('click', () => handleNavigateWeek(-1));
    nextWeekBtn.addEventListener('click', () => handleNavigateWeek(1));
    todayBtn.addEventListener('click', handleGoToToday);
    cancelEditBtn.addEventListener('click', hideForm);
    addEventForm.querySelector('form').addEventListener('submit', handleSaveEvent);
    eventColorPicker.addEventListener('click', handleColorPick);
    
    adminEventsList.addEventListener('click', handleAdminActions);
    
    setInterval(() => {
        if(state.isLoggedIn) {
            currentTimeDisplay.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        }
    }, 60000);

    renderAppUI();
}

init();
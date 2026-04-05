

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
    chartInstance: null,
    selectedEventIds: new Set(),
    allEvents: [], // Store all events for copying
    selectedWorkspace: '__ALL__'
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
const eventWorkspaceInput = document.getElementById('event-workspace-input');
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
const calendarGrid = document.getElementById('calendar-grid'); // Added calendar grid
const userProgressChartCanvas = document.getElementById('user-progress-chart');
const chartNoData = document.getElementById('chart-no-data');
const batchControls = document.getElementById('batch-controls');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const batchDeleteBtn = document.getElementById('batch-delete-btn');
const selectedCountSpan = document.getElementById('selected-count');
const copyLastWeekBtn = document.getElementById('copy-last-week-btn');
const copySourceWeekInput = document.getElementById('copy-source-week');
const workspaceFilterSelect = document.getElementById('workspace-filter-select');
const printWeeklyScheduleBtn = document.getElementById('print-weekly-schedule-btn');

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

const ALL_WORKSPACES = '__ALL__';
const UNASSIGNED_WORKSPACE = '__UNASSIGNED__';

const normalizeWorkspace = (workspace) => (workspace || '').trim();

const getWorkspaceKey = (workspace) => normalizeWorkspace(workspace) || UNASSIGNED_WORKSPACE;

const getWorkspaceLabel = (workspace) => normalizeWorkspace(workspace) || '未指定工作區';

const getSelectedWorkspaceLabel = () => {
    if (state.selectedWorkspace === ALL_WORKSPACES) return '全部工作區';
    return state.selectedWorkspace === UNASSIGNED_WORKSPACE ? '未指定工作區' : state.selectedWorkspace;
};

function escapeHtml(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getCurrentWeekBounds() {
    const weekDays = getWeekDays(state.currentWeekStart);
    const firstDay = new Date(weekDays[0]);
    firstDay.setHours(0, 0, 0, 0);

    const lastDay = new Date(weekDays[6]);
    lastDay.setHours(23, 59, 59, 999);

    return { weekDays, firstDay, lastDay };
}

function filterEventsForCurrentWeek(events) {
    const { firstDay, lastDay } = getCurrentWeekBounds();
    return events.filter((event) => {
        const eventDate = new Date(`${event.date}T00:00`);
        return eventDate >= firstDay && eventDate <= lastDay;
    });
}

function filterEventsBySelectedWorkspace(events) {
    if (state.selectedWorkspace === ALL_WORKSPACES) {
        return events;
    }

    return events.filter((event) => getWorkspaceKey(event.workspace) === state.selectedWorkspace);
}

function getVisibleAdminEvents(events = state.allEvents) {
    return filterEventsBySelectedWorkspace(events);
}


// --- RENDER FUNCTIONS ---
function renderAppUI() {
    if (state.isLoggedIn && state.isAdmin) {
        loginScreen.classList.add('hidden');
        plannerApp.classList.remove('hidden');
        renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay);
        // Admin now has a preview calendar
        renderCalendarGrid(state, calendarGrid);
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
        workspace: eventWorkspaceInput.value.trim(),
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
        eventWorkspaceInput.value = eventToEdit.workspace || '';
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
function populateWorkspaceFilterOptions(events) {
    if (!workspaceFilterSelect) return;

    const currentValue = state.selectedWorkspace;
    const workspaceKeys = Array.from(new Set(events.map((event) => getWorkspaceKey(event.workspace)))).sort((a, b) => {
        if (a === UNASSIGNED_WORKSPACE) return 1;
        if (b === UNASSIGNED_WORKSPACE) return -1;
        return a.localeCompare(b, 'zh-Hant');
    });

    workspaceFilterSelect.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = ALL_WORKSPACES;
    allOption.textContent = '全部工作區';
    workspaceFilterSelect.appendChild(allOption);

    workspaceKeys.forEach((key) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = getWorkspaceLabel(key === UNASSIGNED_WORKSPACE ? '' : key);
        workspaceFilterSelect.appendChild(option);
    });

    const hasCurrentValue = currentValue === ALL_WORKSPACES || workspaceKeys.includes(currentValue);
    state.selectedWorkspace = hasCurrentValue ? currentValue : ALL_WORKSPACES;
    workspaceFilterSelect.value = state.selectedWorkspace;
}

function renderAdminDashboard() {
    const visibleEvents = getVisibleAdminEvents(state.allEvents);
    state.events = visibleEvents;
    renderAdminEventsList(visibleEvents);
    renderUserProgressChart(visibleEvents);
    renderCalendarGrid(state, calendarGrid);
}

function loadAdminData() {
    if (state.unsubscribeAdminEvents) state.unsubscribeAdminEvents();
    const q = query(collection(db, "events"), orderBy("date", "desc"));
    state.unsubscribeAdminEvents = onSnapshot(q, (snapshot) => {
        const allEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        state.allEvents = allEvents;
        populateWorkspaceFilterOptions(allEvents);
        renderAdminDashboard();
    });
}

function renderUserProgressChart(allEvents) {
    const weekEvents = filterEventsForCurrentWeek(allEvents);

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
    
    const weekEvents = filterEventsForCurrentWeek(allEvents);
    const visibleIds = new Set(weekEvents.map((event) => event.id));
    state.selectedEventIds.forEach((eventId) => {
        if (!visibleIds.has(eventId)) {
            state.selectedEventIds.delete(eventId);
        }
    });

    if (weekEvents.length === 0) {
        const emptyMessage = state.selectedWorkspace === ALL_WORKSPACES
            ? '本週沒有任何使用者的事件。'
            : `本週「${getSelectedWorkspaceLabel()}」沒有任何事件。`;
        adminEventsList.innerHTML = `<p class="text-slate-500 text-center p-4">${emptyMessage}</p>`;
        batchControls.classList.add('hidden');
        updateBatchControlsUI();
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
            const isChecked = state.selectedEventIds.has(event.id) ? 'checked' : '';
            const workspaceBadge = event.workspace
                ? `<span class="inline-flex items-center gap-1 rounded-full bg-indigo-100/80 px-2 py-0.5 text-xs font-medium text-indigo-700"><i data-lucide="map-pinned" class="w-3 h-3"></i>${event.workspace}</span>`
                : '';
            userEventsHTML += `
                <div class="flex items-center gap-4 p-3 bg-white/80 rounded-2xl shadow-md border-l-8 transition-all duration-300 hover:shadow-lg hover:scale-[1.02] ${isChecked ? 'ring-2 ring-indigo-400' : ''}" style="border-left-color: ${event.color};">
                    <input type="checkbox" data-event-id="${event.id}" class="event-checkbox w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer flex-shrink-0" ${isChecked}>
                    <div class="flex-1 min-w-0">
                        <p class="font-bold text-slate-800 truncate">${event.title}</p>
                        <p class="text-sm text-slate-600 font-medium mt-1">${event.date} ${event.startTime}-${event.endTime}</p>
                        ${workspaceBadge}
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
    
    // Show batch controls if there are events
    if (weekEvents.length > 0) {
        batchControls.classList.remove('hidden');
    } else {
        batchControls.classList.add('hidden');
    }
    
    // Reset selection state after re-render but preserve if re-rendering same data
    updateBatchControlsUI();
}

function updateBatchControlsUI() {
    const allCheckboxes = adminEventsList.querySelectorAll('.event-checkbox');
    const checkedCount = state.selectedEventIds.size;
    
    selectedCountSpan.textContent = checkedCount;
    batchDeleteBtn.disabled = checkedCount === 0;
    
    // Update select all checkbox state
    if (allCheckboxes.length > 0 && checkedCount === allCheckboxes.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedCount > 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
}

function handleCheckboxChange(e) {
    const checkbox = e.target.closest('.event-checkbox');
    if (!checkbox) return;
    
    const eventId = checkbox.dataset.eventId;
    const eventCard = checkbox.closest('div.flex');
    
    if (checkbox.checked) {
        state.selectedEventIds.add(eventId);
        eventCard.classList.add('ring-2', 'ring-indigo-400');
    } else {
        state.selectedEventIds.delete(eventId);
        eventCard.classList.remove('ring-2', 'ring-indigo-400');
    }
    
    updateBatchControlsUI();
}

function handleSelectAll() {
    const allCheckboxes = adminEventsList.querySelectorAll('.event-checkbox');
    const shouldSelectAll = selectAllCheckbox.checked;
    
    allCheckboxes.forEach(checkbox => {
        const eventId = checkbox.dataset.eventId;
        const eventCard = checkbox.closest('div.flex');
        
        checkbox.checked = shouldSelectAll;
        
        if (shouldSelectAll) {
            state.selectedEventIds.add(eventId);
            eventCard.classList.add('ring-2', 'ring-indigo-400');
        } else {
            state.selectedEventIds.delete(eventId);
            eventCard.classList.remove('ring-2', 'ring-indigo-400');
        }
    });
    
    updateBatchControlsUI();
}

async function handleBatchDelete() {
    const count = state.selectedEventIds.size;
    if (count === 0) return;
    
    if (!window.confirm(`(管理員) 確定要刪除這 ${count} 個事件嗎？此操作無法復原。`)) {
        return;
    }
    
    batchDeleteBtn.disabled = true;
    batchDeleteBtn.innerHTML = `
        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        <span>刪除中...</span>
    `;
    
    try {
        const deletePromises = Array.from(state.selectedEventIds).map(eventId => 
            deleteDoc(doc(db, "events", eventId))
        );
        await Promise.all(deletePromises);
        
        // Clear selection after successful delete
        state.selectedEventIds.clear();
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } catch (error) {
        console.error("Error batch deleting events:", error);
        alert('刪除過程中發生錯誤，請稍後再試。');
    } finally {
        batchDeleteBtn.disabled = false;
        batchDeleteBtn.innerHTML = `
            <i data-lucide="trash-2" class="w-4 h-4"></i>
            <span>刪除選取 (<span id="selected-count">0</span>)</span>
        `;
        lucide.createIcons();
        updateBatchControlsUI();
    }
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

// --- ADMIN FEATURES ---
function getWeekStartFromString(weekString) {
    if (!weekString) return null;
    const [year, weekpart] = weekString.split('-W');
    const y = parseInt(year);
    const w = parseInt(weekpart);
    // Jan 1st of the year
    const simple = new Date(y, 0, 1 + (w - 1) * 7);
    // Find the Monday of that week
    const dow = simple.getDay();
    const ISOweekStart = simple;
    if (dow <= 4)
        ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    else
        ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    
    // reset time just in case
    ISOweekStart.setHours(0,0,0,0);
    return ISOweekStart;
}

async function handleCopyLastWeek() {
    const sourceWeekString = copySourceWeekInput.value;
    if (!sourceWeekString) {
        alert("請先選擇要複製的「來源週」！");
        return;
    }

    const sourceWeekStart = getWeekStartFromString(sourceWeekString);
    if (!sourceWeekStart) {
        alert("無法解析來源週，請重新選擇。");
        return;
    }

    const sourceWeekEnd = new Date(sourceWeekStart);
    sourceWeekEnd.setDate(sourceWeekStart.getDate() + 6);
    sourceWeekEnd.setHours(23, 59, 59, 999);
    
    // 1. Target week is always the CURRENT view of the admin dashboard
    const targetWeekStart = new Date(state.currentWeekStart);
    targetWeekStart.setHours(0, 0, 0, 0);

    const timeDiffMs = targetWeekStart.getTime() - sourceWeekStart.getTime();
    const daysDiff = Math.round(timeDiffMs / (1000 * 3600 * 24)); // Days offset between source and target

    if (daysDiff === 0) {
        alert("來源週與目前所在的目標週相同，無法複製！");
        return;
    }

    // 2. Filter events from selected source week
    const sourceWeekEvents = state.allEvents.filter(e => {
        const eventDate = new Date(e.date + 'T00:00');
        return eventDate >= sourceWeekStart && eventDate <= sourceWeekEnd;
    });

    if (sourceWeekEvents.length === 0) {
        alert("選擇的來源週沒有任何使用者的行程可以複製！");
        return;
    }

    const weekLabel = sourceWeekString; // e.g., 2026-W11

    // 3. Confirm with the admin
    if (!window.confirm(`(管理員) 確定要將「來源週 ${weekLabel}」的 ${sourceWeekEvents.length} 個行程複製到「目前的週次」嗎？\n\n注意：複製的行程都將預設為「未完成」。`)) {
        return;
    }

    setButtonLoading(copyLastWeekBtn, true);

    try {
        const copyPromises = sourceWeekEvents.map(event => {
            // Calculate new date (+daysDiff) to place it in the target week
            const oldDateObj = new Date(event.date + 'T00:00');
            const newDateObj = new Date(oldDateObj);
            newDateObj.setDate(oldDateObj.getDate() + daysDiff);
            const newDateStr = formatDate(newDateObj);

            // Create new event data based on old event
            const newEventData = {
                title: event.title || '未命名',
                workspace: event.workspace || '',
                date: newDateStr,
                startTime: event.startTime || '00:00',
                endTime: event.endTime || '01:00',
                color: event.color || colorOptions[0],
                completed: false, // Reset completed status
                uid: event.uid || '', // Keep the same user ID (Note: Use uid instead of userId)
                email: event.email || '',
                chapter: event.chapter || '',
                pages: event.pages || '',
                notes: event.notes || ''
            };

            return addDoc(collection(db, "events"), newEventData);
        });

        await Promise.all(copyPromises);
        alert(`成功將來源週 ${weekLabel} 的 ${sourceWeekEvents.length} 個行程複製到了目前所在的週次！`);
    } catch (error) {
         console.error("Error batch copying events:", error);
         alert('複製過程中發生錯誤，請稍後再試。');
    } finally {
        setButtonLoading(copyLastWeekBtn, false, '確認複製');
    }
}

function handleWorkspaceFilterChange(e) {
    state.selectedWorkspace = e.target.value;
    renderAdminDashboard();
}

function handlePrintWeeklySchedule() {
    if (state.selectedWorkspace === ALL_WORKSPACES) {
        alert('請先指定要列印的工作區。');
        return;
    }

    const weekEvents = filterEventsForCurrentWeek(getVisibleAdminEvents(state.allEvents))
        .sort((a, b) => new Date(`${a.date}T${a.startTime}`) - new Date(`${b.date}T${b.startTime}`));

    if (weekEvents.length === 0) {
        alert(`本週「${getSelectedWorkspaceLabel()}」沒有可列印的時間表。`);
        return;
    }

    const { weekDays } = getCurrentWeekBounds();
    const weekStart = weekDays[0];
    const weekEnd = weekDays[6];
    const dayFormatter = new Intl.DateTimeFormat('zh-TW', { weekday: 'short', month: 'numeric', day: 'numeric' });
    const rangeFormatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' });

    const printHtml = weekDays.map((day) => {
        const dateKey = formatDate(day);
        const dayEvents = weekEvents.filter((event) => event.date === dateKey);
        const itemsHtml = dayEvents.length > 0
            ? dayEvents.map((event) => {
                const detailText = [event.chapter, event.pages, event.notes].filter(Boolean).join(' / ') || '-';
                return `
                    <tr>
                        <td>${escapeHtml(event.startTime)} - ${escapeHtml(event.endTime)}</td>
                        <td>${escapeHtml(event.title)}</td>
                        <td>${escapeHtml(event.email || '-')}</td>
                        <td>${escapeHtml(detailText)}</td>
                    </tr>
                `;
            }).join('')
            : '<tr><td colspan="4" class="empty-row">本日無排程</td></tr>';

        return `
            <section class="print-day">
                <h2>${escapeHtml(dayFormatter.format(day))}</h2>
                <table>
                    <thead>
                        <tr>
                            <th>時間</th>
                            <th>工作項目</th>
                            <th>使用者</th>
                            <th>備註</th>
                        </tr>
                    </thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
            </section>
        `;
    }).join('');

    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=900');
    if (!printWindow) {
        alert('無法開啟列印視窗，請確認瀏覽器沒有封鎖彈出視窗。');
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="zh-Hant">
        <head>
            <meta charset="UTF-8">
            <title>${escapeHtml(getSelectedWorkspaceLabel())} 本週時間表</title>
            <style>
                body { font-family: "Microsoft JhengHei", sans-serif; margin: 32px; color: #0f172a; }
                h1 { margin: 0 0 8px; font-size: 28px; }
                .meta { margin-bottom: 24px; color: #475569; font-size: 14px; }
                .print-day { margin-bottom: 24px; page-break-inside: avoid; }
                h2 { margin: 0 0 10px; padding-bottom: 6px; border-bottom: 2px solid #cbd5e1; font-size: 18px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; vertical-align: top; }
                th { background: #e2e8f0; }
                .empty-row { text-align: center; color: #64748b; }
                @media print {
                    body { margin: 16px; }
                }
            </style>
        </head>
        <body>
            <h1>${escapeHtml(getSelectedWorkspaceLabel())} 本週時間表</h1>
            <div class="meta">週次：${escapeHtml(rangeFormatter.format(weekStart))} - ${escapeHtml(rangeFormatter.format(weekEnd))}</div>
            ${printHtml}
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => {
        printWindow.print();
    };
}

// --- EVENT HANDLERS ---
function handleNavigateWeek(direction) {
    const newDate = new Date(state.currentWeekStart);
    newDate.setDate(state.currentWeekStart.getDate() + (direction * 7));
    state.currentWeekStart = newDate;
    sessionStorage.setItem('currentWeekStart', state.currentWeekStart.toISOString());
    renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay);
    renderAdminDashboard();
}

function handleGoToToday() {
    const today = new Date();
    state.currentWeekStart = today;
    sessionStorage.setItem('currentWeekStart', state.currentWeekStart.toISOString());
    renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay);
    renderAdminDashboard();
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
    eventWorkspaceInput.value = '';
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


function setInitialSourceWeek() {
    const today = new Date();
    const prevWeek = new Date(today);
    prevWeek.setDate(today.getDate() - 7);
    
    // Get ISO week string format like "2024-W12"
    const prevWeekMonday = new Date(prevWeek);
    const day = prevWeekMonday.getDay();
    const diff = prevWeekMonday.getDate() - day + (day === 0 ? -6 : 1);
    prevWeekMonday.setDate(diff);

    // simple wrapper to get ISO week number (approximate enough for UI default)
    const startDate = new Date(prevWeekMonday.getFullYear(), 0, 1);
    const days = Math.floor((prevWeekMonday - startDate) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((prevWeekMonday.getDay() + 1 + days) / 7);

    const yearString = prevWeekMonday.getFullYear();
    const weekString = String(weekNumber).padStart(2, '0');
    
    if (copySourceWeekInput) {
        copySourceWeekInput.value = `${yearString}-W${weekString}`;
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

    setInitialSourceWeek();

    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    prevWeekBtn.addEventListener('click', () => handleNavigateWeek(-1));
    nextWeekBtn.addEventListener('click', () => handleNavigateWeek(1));
    todayBtn.addEventListener('click', handleGoToToday);
    cancelEditBtn.addEventListener('click', hideForm);
    addEventForm.querySelector('form').addEventListener('submit', handleSaveEvent);
    eventColorPicker.addEventListener('click', handleColorPick);
    
    adminEventsList.addEventListener('click', handleAdminActions);
    
    // Batch delete event listeners
    adminEventsList.addEventListener('change', handleCheckboxChange);
    selectAllCheckbox.addEventListener('change', handleSelectAll);
    batchDeleteBtn.addEventListener('click', handleBatchDelete);
    copyLastWeekBtn.addEventListener('click', handleCopyLastWeek);
    workspaceFilterSelect.addEventListener('change', handleWorkspaceFilterChange);
    printWeeklyScheduleBtn.addEventListener('click', handlePrintWeeklySchedule);
    
    setInterval(() => {
        if(state.isLoggedIn) {
            currentTimeDisplay.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        }
    }, 60000);

    renderAppUI();
}

init();

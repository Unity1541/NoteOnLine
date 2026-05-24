
import { auth, db } from './firebase.js';
import { 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    doc
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import {
    renderHeader,
    renderCalendarGrid,
    renderSidebar
} from './planner-renderer-fixed.js';

const colorOptions = ['#A7F3D0', '#BBF7D0', '#FED7AA', '#FBCFE8', '#DDD6FE', '#BFDBFE', '#F9A8D4', '#C084FC'];

// --- STATE ---
let state = {
    isLoggedIn: false,
    currentUser: null,
    events: [],
    allEvents: [],
    unsubscribeEvents: null,
    currentWeekStart: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()),
    editingEventId: null,
    selectedColor: colorOptions[0],
    selectedEventIds: new Set(),
    selectedWorkspace: '__ALL__',
    allowUnscheduled: true
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
const workspaceFilterSelect = document.getElementById('workspace-filter-select');
const exportWeeklyPdfBtn = document.getElementById('export-weekly-pdf-btn');
const copyLastWeekBtn = document.getElementById('copy-last-week-btn');
const logoutBtn = document.getElementById('logout-btn');
const calendarGrid = document.getElementById('calendar-grid');
const showAddFormBtn = document.getElementById('show-add-form-btn');
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
const eventDurationInput = document.getElementById('event-duration-input');
const eventDurationRow = document.getElementById('event-duration-row');
const eventTimeRow = document.getElementById('event-time-row');
const saveEventBtn = document.getElementById('save-event-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const formStatus = document.getElementById('form-status');
const summaryContent = document.getElementById('summary-content');
const checklistContent = document.getElementById('checklist-content');
const taskPoolContainer = document.getElementById('task-pool-container');
const taskPoolContent = document.getElementById('task-pool-content');
const taskPoolCount = document.getElementById('task-pool-count');
const userBatchControls = document.getElementById('user-batch-controls');
const userSelectAllCheckbox = document.getElementById('user-select-all-checkbox');
const userBatchDeleteBtn = document.getElementById('user-batch-delete-btn');
const userSelectedCountSpan = document.getElementById('user-selected-count');

// Sidebar DOM elements for the renderer
const sidebarDOMElements = { summaryContent, checklistContent, eventDateSelect, eventColorPicker, taskPoolContent, taskPoolCount };

// --- DRAG & DROP CONSTANTS ---
const CALENDAR_START_HOUR = 6;
const CALENDAR_START_MIN = CALENDAR_START_HOUR * 60; // 360
const CALENDAR_END_MIN = CALENDAR_START_MIN + 1020;  // 1380 (23:00)
const SNAP_MINUTES = 30;
let currentDrag = null; // { id, kind: 'pool'|'scheduled', duration, grabOffsetMin }

const minutesToTime = (mins) => {
    const m = Math.max(0, Math.min(24 * 60 - 1, mins));
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const timeToMinutes = (time) => {
    if (!time) return 0;
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
};

const snap = (min) => Math.round(min / SNAP_MINUTES) * SNAP_MINUTES;


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

const getWorkspaceLabelText = (workspace) => normalizeWorkspace(workspace) || '未指定工作區';

const getSelectedWorkspaceLabelText = () => {
    if (state.selectedWorkspace === ALL_WORKSPACES) return '全部工作區';
    return state.selectedWorkspace === UNASSIGNED_WORKSPACE ? '未指定工作區' : state.selectedWorkspace;
};

function normalizeWorkspaceFilterLabels() {
    if (!workspaceFilterSelect) return;

    Array.from(workspaceFilterSelect.options).forEach((option) => {
        if (option.value === ALL_WORKSPACES) {
            option.textContent = '全部工作區';
            return;
        }

        option.textContent = getWorkspaceLabelText(option.value === UNASSIGNED_WORKSPACE ? '' : option.value);
    });
}

function sanitizeFileName(value) {
    return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ').trim();
}

function getWeekDays(startDate) {
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
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

function getVisibleUserEvents(events = state.allEvents) {
    return filterEventsBySelectedWorkspace(events);
}

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

function renderUserDashboard() {
    state.events = getVisibleUserEvents(state.allEvents);
    normalizeWorkspaceFilterLabels();
    renderCalendarGrid(state, calendarGrid);
    renderSidebar(state, sidebarDOMElements);
    updateUserBatchControlsUI();
}

// --- MAIN RENDER LOGIC ---
function renderAppUI() {
    if (state.isLoggedIn) {
        loginScreen.classList.add('hidden');
        plannerApp.classList.remove('hidden');
        renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay);
        renderCalendarGrid(state, calendarGrid);
        renderSidebar(state, sidebarDOMElements);
    } else {
        loginScreen.classList.remove('hidden');
        plannerApp.classList.add('hidden');
    }
    lucide.createIcons();
}


// --- FIREBASE & AUTHENTICATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.isLoggedIn = true;
        state.currentUser = user;
        subscribeToEvents(user.uid);
    } else {
        state.isLoggedIn = false;
        state.currentUser = null;
        state.events = [];
        state.allEvents = [];
        state.selectedWorkspace = ALL_WORKSPACES;
        if (state.unsubscribeEvents) state.unsubscribeEvents();
        populateWorkspaceFilterOptions([]);
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
function subscribeToEvents(uid) {
    if (state.unsubscribeEvents) state.unsubscribeEvents();
    const q = query(collection(db, "events"), where("uid", "==", uid));
    state.unsubscribeEvents = onSnapshot(q, (querySnapshot) => {
        state.allEvents = [];
        querySnapshot.forEach((doc) => {
            state.allEvents.push({ id: doc.id, ...doc.data() });
        });
        populateWorkspaceFilterOptions(state.allEvents);
        renderUserDashboard();
    });
}

async function handleSaveEvent(e) {
    e.preventDefault();
    const isPool = eventDateSelect.value === '__POOL__';

    if (!eventTitleInput.value) {
        formStatus.textContent = '請填寫工作項目！';
        formStatus.className = 'text-red-500 text-sm text-center h-5';
        return;
    }
    if (!eventDateSelect.value) {
        formStatus.textContent = '請選擇日期！';
        formStatus.className = 'text-red-500 text-sm text-center h-5';
        return;
    }
    if (!isPool && (!eventStartHourInput.value || !eventStartMinuteInput.value || !eventEndHourInput.value || !eventEndMinuteInput.value)) {
        formStatus.textContent = '請填寫開始與結束時間！';
        formStatus.className = 'text-red-500 text-sm text-center h-5';
        return;
    }

    const eventData = {
        title: eventTitleInput.value,
        workspace: eventWorkspaceInput.value.trim(),
        chapter: eventChapterInput.value,
        pages: eventPagesInput.value,
        notes: eventNotesInput.value,
        color: state.selectedColor,
        uid: state.currentUser.uid,
        email: state.currentUser.email,
    };

    if (isPool) {
        eventData.unscheduled = true;
        eventData.date = '';
        eventData.startTime = '';
        eventData.endTime = '';
        eventData.duration = Number(eventDurationInput.value) || 60;
    } else {
        eventData.unscheduled = false;
        eventData.date = eventDateSelect.value;
        eventData.startTime = `${eventStartHourInput.value}:${eventStartMinuteInput.value}`;
        eventData.endTime = `${eventEndHourInput.value}:${eventEndMinuteInput.value}`;
        eventData.duration = Math.max(SNAP_MINUTES, timeToMinutes(eventData.endTime) - timeToMinutes(eventData.startTime));
    }

    setButtonLoading(saveEventBtn, true);
    formStatus.textContent = '';

    try {
        if (state.editingEventId) {
            const eventRef = doc(db, "events", state.editingEventId);
            await updateDoc(eventRef, eventData);
        } else {
            eventData.completed = false;
            eventData.createdAt = Date.now();
            await addDoc(collection(db, "events"), eventData);
        }
        hideForm();
    } catch (error) {
        console.error("Error saving event: ", error);
        formStatus.textContent = "儲存失敗，請稍後再試。";
        formStatus.className = 'text-red-500 text-sm text-center h-5';
    } finally {
        setButtonLoading(saveEventBtn, false, state.editingEventId ? '更新' : '新增');
    }
}

function updateFormModeForDate() {
    const isPool = eventDateSelect.value === '__POOL__';
    if (isPool) {
        eventTimeRow.classList.add('hidden');
        eventDurationRow.classList.remove('hidden');
        eventStartHourInput.required = false;
        eventStartMinuteInput.required = false;
        eventEndHourInput.required = false;
        eventEndMinuteInput.required = false;
    } else {
        eventTimeRow.classList.remove('hidden');
        eventDurationRow.classList.add('hidden');
        eventStartHourInput.required = true;
        eventStartMinuteInput.required = true;
        eventEndHourInput.required = true;
        eventEndMinuteInput.required = true;
    }
}

function openEditForm(eventId) {
    const eventToEdit = state.events.find(e => e.id === eventId) || state.allEvents.find(e => e.id === eventId);
    if (eventToEdit) {
        state.editingEventId = eventId;
        showForm(true);
        eventTitleInput.value = eventToEdit.title;
        eventWorkspaceInput.value = eventToEdit.workspace || '';
        eventChapterInput.value = eventToEdit.chapter || '';
        eventPagesInput.value = eventToEdit.pages || '';
        if (eventToEdit.unscheduled) {
            eventDateSelect.value = '__POOL__';
            eventDurationInput.value = String(eventToEdit.duration || 60);
        } else {
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
        }
        eventNotesInput.value = eventToEdit.notes || '';
        state.selectedColor = eventToEdit.color;
        // Re-render the sidebar to update form and color picker
        renderSidebar(state, sidebarDOMElements);
        updateFormModeForDate();
    }
}

async function handleDeleteEvent(eventId) {
    try {
        await deleteDoc(doc(db, "events", eventId));
    } catch (error) {
        console.error("Error deleting event: ", error);
    }
}

// --- EVENT HANDLERS ---
function handleNavigateWeek(direction) {
    const newDate = new Date(state.currentWeekStart);
    newDate.setDate(state.currentWeekStart.getDate() + (direction * 7));
    state.currentWeekStart = newDate;
    sessionStorage.setItem('currentWeekStart', state.currentWeekStart.toISOString());
    renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay);
    renderUserDashboard();
}

function handleGoToToday() {
    const today = new Date();
    state.currentWeekStart = today;
    sessionStorage.setItem('currentWeekStart', state.currentWeekStart.toISOString());
    renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay);
    renderUserDashboard();
}

function showForm(isEditing = false) {
    showAddFormBtn.classList.add('hidden');
    addEventForm.classList.remove('hidden');
    formTitle.textContent = isEditing ? '編輯行程' : '新增行程';
    setButtonLoading(saveEventBtn, false, isEditing ? '更新' : '新增');
    formStatus.textContent = '';
}

function hideForm() {
    showAddFormBtn.classList.remove('hidden');
    addEventForm.classList.add('hidden');
    state.editingEventId = null;
    addEventForm.querySelector('form').reset();
    eventTitleInput.value = '';
    eventWorkspaceInput.value = '';
    eventNotesInput.value = '';
    eventChapterInput.value = '';
    eventPagesInput.value = '';
    if (eventDurationInput) eventDurationInput.value = '60';
    state.selectedColor = colorOptions[0];
    // Re-render sidebar to reset form state visually
    renderSidebar(state, sidebarDOMElements);
    updateFormModeForDate();
}

function handleShowAddForm() {
    state.editingEventId = null;
    addEventForm.querySelector('form').reset();
    showForm(false);
}

function handleColorPick(e) {
    const button = e.target.closest('button');
    if (button && button.dataset.color) {
        state.selectedColor = button.dataset.color;
        renderSidebar(state, sidebarDOMElements); // Re-render to show selection
    }
}

function handleWorkspaceFilterChange(e) {
    state.selectedWorkspace = e.target.value;
    renderUserDashboard();
}

function buildPdfHost(contentHtml) {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '9999';
    host.style.overflow = 'auto';
    host.style.background = '#f8fafc';
    host.style.padding = '24px';

    const paper = document.createElement('div');
    paper.style.width = '794px';
    paper.style.margin = '0 auto';
    paper.style.background = '#ffffff';
    paper.style.color = '#0f172a';
    paper.style.padding = '32px';
    paper.style.boxSizing = 'border-box';
    paper.style.fontFamily = '"Microsoft JhengHei", "PingFang TC", sans-serif';
    paper.innerHTML = contentHtml;

    host.appendChild(paper);
    document.body.appendChild(host);
    return host;
}

function getEventDetailText(event) {
    return [event.chapter, event.pages, event.notes].filter(Boolean).join(' / ') || '-';
}

function buildWeeklyPdfHtml(weekDays, events, title) {
    const dayFormatter = new Intl.DateTimeFormat('zh-TW', { weekday: 'short', month: 'numeric', day: 'numeric' });
    const weekStart = weekDays[0];
    const weekEnd = weekDays[6];
    const headerFormatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' });

    const sectionsHtml = weekDays.map((day) => {
        const dateKey = formatDate(day);
        const dayEvents = events.filter((event) => event.date === dateKey);
        const rowsHtml = dayEvents.length > 0
            ? dayEvents.map((event) => `
                <tr>
                    <td style="border:1px solid #cbd5e1;padding:8px 10px;">${escapeHtml(event.startTime)} - ${escapeHtml(event.endTime)}</td>
                    <td style="border:1px solid #cbd5e1;padding:8px 10px;">${escapeHtml(event.title)}</td>
                    <td style="border:1px solid #cbd5e1;padding:8px 10px;">${escapeHtml(getEventDetailText(event))}</td>
                    <td style="border:1px solid #cbd5e1;padding:8px 10px;">${event.completed ? '已完成' : '未完成'}</td>
                </tr>
            `).join('')
            : `
                <tr>
                    <td colspan="4" style="border:1px solid #cbd5e1;padding:12px;text-align:center;color:#64748b;">本日無排程</td>
                </tr>
            `;

        return `
            <section style="margin-bottom:20px;page-break-inside:avoid;">
                <h2 style="font-size:18px;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid #cbd5e1;">${escapeHtml(dayFormatter.format(day))}</h2>
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="background:#e2e8f0;">
                            <th style="border:1px solid #cbd5e1;padding:8px 10px;text-align:left;">時間</th>
                            <th style="border:1px solid #cbd5e1;padding:8px 10px;text-align:left;">工作項目</th>
                            <th style="border:1px solid #cbd5e1;padding:8px 10px;text-align:left;">備註</th>
                            <th style="border:1px solid #cbd5e1;padding:8px 10px;text-align:left;">狀態</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </section>
        `;
    }).join('');

    return `
        <div style="margin-bottom:24px;">
            <h1 style="font-size:28px;margin:0 0 8px;">${escapeHtml(title)}</h1>
            <div style="font-size:14px;color:#475569;">週次：${escapeHtml(headerFormatter.format(weekStart))} - ${escapeHtml(headerFormatter.format(weekEnd))}</div>
            <div style="font-size:14px;color:#475569;margin-top:4px;">使用者：${escapeHtml(state.currentUser?.email || '')}</div>
        </div>
        ${sectionsHtml}
    `;
}

function buildSingleEventPdfHtml(event) {
    const dateFormatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long' });
    const eventDate = new Date(`${event.date}T00:00`);
    return `
        <div style="margin-bottom:28px;">
            <h1 style="font-size:28px;margin:0 0 8px;">${escapeHtml(event.title)} 時刻表</h1>
            <div style="font-size:14px;color:#475569;">使用者：${escapeHtml(state.currentUser?.email || '')}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tbody>
                <tr>
                    <th style="width:140px;border:1px solid #cbd5e1;background:#e2e8f0;padding:10px;text-align:left;">工作區</th>
                    <td style="border:1px solid #cbd5e1;padding:10px;">${escapeHtml(getWorkspaceLabelText(event.workspace))}</td>
                </tr>
                <tr>
                    <th style="border:1px solid #cbd5e1;background:#e2e8f0;padding:10px;text-align:left;">日期</th>
                    <td style="border:1px solid #cbd5e1;padding:10px;">${escapeHtml(dateFormatter.format(eventDate))}</td>
                </tr>
                <tr>
                    <th style="border:1px solid #cbd5e1;background:#e2e8f0;padding:10px;text-align:left;">時間</th>
                    <td style="border:1px solid #cbd5e1;padding:10px;">${escapeHtml(event.startTime)} - ${escapeHtml(event.endTime)}</td>
                </tr>
                <tr>
                    <th style="border:1px solid #cbd5e1;background:#e2e8f0;padding:10px;text-align:left;">章節 / 頁數</th>
                    <td style="border:1px solid #cbd5e1;padding:10px;">${escapeHtml([event.chapter, event.pages].filter(Boolean).join(' / ') || '-')}</td>
                </tr>
                <tr>
                    <th style="border:1px solid #cbd5e1;background:#e2e8f0;padding:10px;text-align:left;">備註</th>
                    <td style="border:1px solid #cbd5e1;padding:10px;">${escapeHtml(event.notes || '-')}</td>
                </tr>
                <tr>
                    <th style="border:1px solid #cbd5e1;background:#e2e8f0;padding:10px;text-align:left;">狀態</th>
                    <td style="border:1px solid #cbd5e1;padding:10px;">${event.completed ? '已完成' : '未完成'}</td>
                </tr>
            </tbody>
        </table>
    `;
}

async function exportPdfDocument({ html, filename, button, loadingText }) {
    if (!window.html2pdf) {
        alert('PDF 匯出工具尚未載入完成，請稍後再試。');
        return;
    }

    const exportHost = buildPdfHost(html);
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 80)));

    let originalButtonHtml = '';
    if (button) {
        button.disabled = true;
        originalButtonHtml = button.innerHTML;
        button.innerHTML = `
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>${loadingText}</span>
        `;
    }

    try {
        await window.html2pdf().set({
            margin: [10, 10, 10, 10],
            filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 900 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
        }).from(exportHost.firstElementChild).save();
    } catch (error) {
        console.error('Error exporting PDF:', error);
        alert('輸出 PDF 時發生錯誤，請稍後再試。');
    } finally {
        exportHost.remove();
        if (button) {
            button.disabled = false;
            button.innerHTML = originalButtonHtml;
            lucide.createIcons();
        }
    }
}

async function handleCopyLastWeek() {
    if (!state.currentUser) return;

    const { firstDay: currentWeekFirstDay, lastDay: currentWeekLastDay } = getCurrentWeekBounds();

    const lastWeekFirstDay = new Date(currentWeekFirstDay);
    lastWeekFirstDay.setDate(lastWeekFirstDay.getDate() - 7);
    const lastWeekLastDay = new Date(currentWeekLastDay);
    lastWeekLastDay.setDate(lastWeekLastDay.getDate() - 7);

    const lastWeekEvents = state.allEvents.filter((event) => {
        if (event.unscheduled || !event.date || !event.startTime || !event.endTime) return false;
        const eventDate = new Date(`${event.date}T00:00`);
        return eventDate >= lastWeekFirstDay && eventDate <= lastWeekLastDay;
    });

    if (lastWeekEvents.length === 0) {
        alert('上週沒有可複製的已排程事件。');
        return;
    }

    const currentWeekEvents = state.allEvents.filter((event) => {
        if (event.unscheduled || !event.date || !event.startTime || !event.endTime) return false;
        const eventDate = new Date(`${event.date}T00:00`);
        return eventDate >= currentWeekFirstDay && eventDate <= currentWeekLastDay;
    });

    if (!window.confirm(`找到上週 ${lastWeekEvents.length} 個已排程事件，將複製到本週對應星期幾與時段（已有事件的時段會略過）。要繼續嗎？`)) {
        return;
    }

    const eventsToCreate = [];
    let skipped = 0;

    lastWeekEvents.forEach((event) => {
        const oldDate = new Date(`${event.date}T00:00`);
        const newDate = new Date(oldDate);
        newDate.setDate(newDate.getDate() + 7);
        const newDateStr = formatDate(newDate);

        const newStart = timeToMinutes(event.startTime);
        const newEnd = timeToMinutes(event.endTime);
        const conflict = currentWeekEvents.some((existing) => {
            if (existing.date !== newDateStr) return false;
            const existStart = timeToMinutes(existing.startTime);
            const existEnd = timeToMinutes(existing.endTime);
            return newStart < existEnd && existStart < newEnd;
        });

        if (conflict) {
            skipped++;
            return;
        }

        eventsToCreate.push({
            title: event.title,
            workspace: event.workspace || '',
            chapter: event.chapter || '',
            pages: event.pages || '',
            notes: event.notes || '',
            color: event.color || colorOptions[0],
            date: newDateStr,
            startTime: event.startTime,
            endTime: event.endTime,
            duration: event.duration || Math.max(SNAP_MINUTES, newEnd - newStart),
            unscheduled: false,
            completed: false,
            uid: state.currentUser.uid,
            email: state.currentUser.email,
            createdAt: Date.now(),
        });
    });

    if (eventsToCreate.length === 0) {
        alert(`所有事件的對應時段在本週皆已被佔用，未新增任何事件（略過 ${skipped} 筆）。`);
        return;
    }

    copyLastWeekBtn.disabled = true;
    const originalHtml = copyLastWeekBtn.innerHTML;
    copyLastWeekBtn.innerHTML = `
        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        <span>複製中...</span>
    `;

    try {
        await Promise.all(eventsToCreate.map((data) => addDoc(collection(db, 'events'), data)));
        const skipNote = skipped > 0 ? `（略過 ${skipped} 筆衝突時段）` : '';
        alert(`已複製 ${eventsToCreate.length} 個事件到本週${skipNote}。`);
    } catch (err) {
        console.error('Error copying last week events:', err);
        alert('複製過程中發生錯誤，請稍後再試。');
    } finally {
        copyLastWeekBtn.disabled = false;
        copyLastWeekBtn.innerHTML = originalHtml;
        lucide.createIcons();
    }
}

async function handleExportWeeklyPdf() {
    if (state.selectedWorkspace === ALL_WORKSPACES) {
        alert('請先指定要輸出的工作區。');
        return;
    }

    const { weekDays } = getCurrentWeekBounds();
    const weekEvents = filterEventsForCurrentWeek(getVisibleUserEvents(state.allEvents))
        .sort((a, b) => new Date(`${a.date}T${a.startTime}`).getTime() - new Date(`${b.date}T${b.startTime}`).getTime());

    if (weekEvents.length === 0) {
        alert(`本週「${getSelectedWorkspaceLabelText()}」沒有可輸出的時間表。`);
        return;
    }

    const weekStart = weekDays[0];
    const weekEnd = weekDays[6];
    const title = `${getSelectedWorkspaceLabelText()} 本週時間表`;
    const filename = sanitizeFileName(`${getSelectedWorkspaceLabelText()}_${formatDate(weekStart)}_${formatDate(weekEnd)}_time-table.pdf`);

    await exportPdfDocument({
        html: buildWeeklyPdfHtml(weekDays, weekEvents, title),
        filename,
        button: exportWeeklyPdfBtn,
        loadingText: '輸出中...'
    });
}

async function handleExportSingleEventPdf(event, button) {
    const filename = sanitizeFileName(`${event.title}_${event.date}_${event.startTime.replace(':', '')}.pdf`);
    await exportPdfDocument({
        html: buildSingleEventPdfHtml(event),
        filename,
        button,
        loadingText: '匯出中...'
    });
}

function handleEventClick(e) {
    if (e.target.closest('.event-item.dragging-just-ended')) return;
    const eventElement = e.target.closest('.event-item');
    if (eventElement) {
        const eventId = eventElement.dataset.eventId;
        openEditForm(eventId);
    }
}

// --- DRAG & DROP HANDLERS ---
function handleDragStart(e) {
    if (e.target.closest('button')) {
        e.preventDefault();
        return;
    }
    const draggable = e.target.closest('[draggable="true"][data-event-id]');
    if (!draggable) return;

    const id = draggable.dataset.eventId;
    const kind = draggable.dataset.eventKind || 'scheduled';
    const evt = state.events.find((x) => x.id === id) || state.allEvents.find((x) => x.id === id);
    if (!evt) return;

    let duration = evt.duration;
    if (!duration) {
        if (evt.startTime && evt.endTime) {
            duration = Math.max(SNAP_MINUTES, timeToMinutes(evt.endTime) - timeToMinutes(evt.startTime));
        } else {
            duration = 60;
        }
    }

    let grabOffsetMin = 0;
    if (kind === 'scheduled') {
        const rect = draggable.getBoundingClientRect();
        grabOffsetMin = e.clientY - rect.top; // 1px = 1min
    }

    currentDrag = { id, kind, duration, grabOffsetMin };

    try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
    } catch (_) {}

    setTimeout(() => {
        draggable.classList.add('opacity-40', 'pointer-events-none');
    }, 0);
}

function handleDragEnd(e) {
    const draggable = e.target.closest('[draggable="true"][data-event-id]');
    if (draggable) {
        draggable.classList.remove('opacity-40', 'pointer-events-none');
        draggable.classList.add('dragging-just-ended');
        setTimeout(() => draggable.classList.remove('dragging-just-ended'), 50);
    }
    clearDropIndicators();
    currentDrag = null;
}

function clearDropIndicators() {
    document.querySelectorAll('.day-events-container').forEach((el) => {
        el.classList.remove('ring-2', 'ring-indigo-400', 'bg-indigo-50/40');
        const ind = el.querySelector('.drop-indicator');
        if (ind) ind.remove();
    });
    if (taskPoolContainer) {
        taskPoolContainer.classList.remove('ring-2', 'ring-amber-400', 'bg-amber-50/40');
    }
}

function computeDropMinutes(container, clientY) {
    if (!currentDrag) return CALENDAR_START_MIN;
    const rect = container.getBoundingClientRect();
    const offsetY = clientY - rect.top - currentDrag.grabOffsetMin;
    const rawStart = CALENDAR_START_MIN + offsetY;
    const snapped = snap(rawStart);
    const maxStart = CALENDAR_END_MIN - currentDrag.duration;
    return Math.max(CALENDAR_START_MIN, Math.min(maxStart, snapped));
}

function handleCalendarDragOver(e) {
    const container = e.target.closest('.day-events-container');
    if (!container || !currentDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    container.classList.add('ring-2', 'ring-indigo-400', 'bg-indigo-50/40');

    let indicator = container.querySelector('.drop-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'drop-indicator absolute left-1 right-1 rounded-lg border-2 border-dashed border-indigo-500 bg-indigo-200/40 pointer-events-none z-30';
        container.appendChild(indicator);
    }
    const startMin = computeDropMinutes(container, e.clientY);
    const top = startMin - CALENDAR_START_MIN;
    indicator.style.top = `${top}px`;
    indicator.style.height = `${currentDrag.duration}px`;
    indicator.textContent = `${minutesToTime(startMin)} - ${minutesToTime(startMin + currentDrag.duration)}`;
    indicator.style.cssText += ';display:flex;align-items:center;justify-content:center;font-size:11px;color:#4338ca;font-weight:600;';
}

function handleCalendarDragLeave(e) {
    const container = e.target.closest('.day-events-container');
    if (!container) return;
    if (container.contains(e.relatedTarget)) return;
    container.classList.remove('ring-2', 'ring-indigo-400', 'bg-indigo-50/40');
    const ind = container.querySelector('.drop-indicator');
    if (ind) ind.remove();
}

async function handleCalendarDrop(e) {
    const container = e.target.closest('.day-events-container');
    if (!container || !currentDrag) return;
    e.preventDefault();

    const newDate = container.dataset.date;
    const startMin = computeDropMinutes(container, e.clientY);
    const endMin = Math.min(CALENDAR_END_MIN, startMin + currentDrag.duration);

    const update = {
        unscheduled: false,
        date: newDate,
        startTime: minutesToTime(startMin),
        endTime: minutesToTime(endMin),
        duration: endMin - startMin,
    };

    clearDropIndicators();
    const idToUpdate = currentDrag.id;
    currentDrag = null;

    try {
        await updateDoc(doc(db, 'events', idToUpdate), update);
    } catch (err) {
        console.error('Error rescheduling event:', err);
        alert('排程失敗，請稍後再試。');
    }
}

function handlePoolDragOver(e) {
    if (!currentDrag || currentDrag.kind !== 'scheduled') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (taskPoolContainer) {
        taskPoolContainer.classList.add('ring-2', 'ring-amber-400', 'bg-amber-50/40');
    }
}

function handlePoolDragLeave(e) {
    if (!taskPoolContainer) return;
    if (taskPoolContainer.contains(e.relatedTarget)) return;
    taskPoolContainer.classList.remove('ring-2', 'ring-amber-400', 'bg-amber-50/40');
}

async function handlePoolDrop(e) {
    if (!currentDrag || currentDrag.kind !== 'scheduled') return;
    e.preventDefault();

    const update = {
        unscheduled: true,
        date: '',
        startTime: '',
        endTime: '',
        duration: currentDrag.duration,
    };

    clearDropIndicators();
    const idToUpdate = currentDrag.id;
    currentDrag = null;

    try {
        await updateDoc(doc(db, 'events', idToUpdate), update);
    } catch (err) {
        console.error('Error moving event to pool:', err);
        alert('移至任務池失敗，請稍後再試。');
    }
}

async function handlePoolClick(e) {
    const card = e.target.closest('.pool-task-item');
    if (!card) return;
    const eventId = card.dataset.eventId;
    const event = state.events.find((x) => x.id === eventId) || state.allEvents.find((x) => x.id === eventId);
    if (!event) return;

    if (e.target.closest('.pool-edit-btn')) {
        openEditForm(eventId);
    } else if (e.target.closest('.pool-delete-btn')) {
        if (window.confirm(`確定要刪除任務 "${event.title}" 嗎？`)) {
            await handleDeleteEvent(eventId);
        }
    }
}

async function handleChecklistClick(e) {
    const item = e.target.closest('.checklist-item');
    if (!item) return;

    const eventId = item.dataset.eventId;
    const event = state.events.find(ev => ev.id === eventId);
    if (!event) return;

    if (e.target.closest('.toggle-complete-btn')) {
        const eventRef = doc(db, "events", eventId);
        await updateDoc(eventRef, { completed: !event.completed });
    } else if (e.target.closest('.export-event-pdf-btn')) {
        await handleExportSingleEventPdf(event, e.target.closest('.export-event-pdf-btn'));
    } else if (e.target.closest('.edit-event-btn')) {
        openEditForm(eventId);
    } else if (e.target.closest('.delete-event-btn')) {
        if (window.confirm(`確定要刪除行程 "${event.title}" 嗎？`)) {
            await handleDeleteEvent(eventId);
        }
    }
}

// --- BATCH DELETE FUNCTIONS ---
function updateUserBatchControlsUI() {
    const allCheckboxes = checklistContent.querySelectorAll('.checklist-checkbox');
    const visibleIds = new Set(Array.from(allCheckboxes, (checkbox) => checkbox.dataset.eventId));
    state.selectedEventIds.forEach((eventId) => {
        if (!visibleIds.has(eventId)) {
            state.selectedEventIds.delete(eventId);
        }
    });

    const checkedCount = state.selectedEventIds.size;
    
    userSelectedCountSpan.textContent = checkedCount;
    userBatchDeleteBtn.disabled = checkedCount === 0;
    
    // Show/hide batch controls based on whether there are events
    if (allCheckboxes.length > 0) {
        userBatchControls.classList.remove('hidden');
    } else {
        userBatchControls.classList.add('hidden');
    }
    
    // Update select all checkbox state
    if (allCheckboxes.length > 0 && checkedCount === allCheckboxes.length) {
        userSelectAllCheckbox.checked = true;
        userSelectAllCheckbox.indeterminate = false;
    } else if (checkedCount > 0) {
        userSelectAllCheckbox.checked = false;
        userSelectAllCheckbox.indeterminate = true;
    } else {
        userSelectAllCheckbox.checked = false;
        userSelectAllCheckbox.indeterminate = false;
    }
}

function handleUserCheckboxChange(e) {
    const checkbox = e.target.closest('.checklist-checkbox');
    if (!checkbox) return;
    
    const eventId = checkbox.dataset.eventId;
    const checklistItem = checkbox.closest('.checklist-item');
    
    if (checkbox.checked) {
        state.selectedEventIds.add(eventId);
        checklistItem.classList.add('ring-2', 'ring-indigo-400');
    } else {
        state.selectedEventIds.delete(eventId);
        checklistItem.classList.remove('ring-2', 'ring-indigo-400');
    }
    
    updateUserBatchControlsUI();
}

function handleUserSelectAll() {
    const allCheckboxes = checklistContent.querySelectorAll('.checklist-checkbox');
    const shouldSelectAll = userSelectAllCheckbox.checked;
    
    allCheckboxes.forEach(checkbox => {
        const eventId = checkbox.dataset.eventId;
        const checklistItem = checkbox.closest('.checklist-item');
        
        checkbox.checked = shouldSelectAll;
        
        if (shouldSelectAll) {
            state.selectedEventIds.add(eventId);
            checklistItem.classList.add('ring-2', 'ring-indigo-400');
        } else {
            state.selectedEventIds.delete(eventId);
            checklistItem.classList.remove('ring-2', 'ring-indigo-400');
        }
    });
    
    updateUserBatchControlsUI();
}

async function handleUserBatchDelete() {
    const count = state.selectedEventIds.size;
    if (count === 0) return;
    
    if (!window.confirm(`確定要刪除這 ${count} 個行程嗎？此操作無法復原。`)) {
        return;
    }
    
    userBatchDeleteBtn.disabled = true;
    userBatchDeleteBtn.innerHTML = `
        <div class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        <span>刪除中...</span>
    `;
    
    try {
        const deletePromises = Array.from(state.selectedEventIds).map(eventId => 
            deleteDoc(doc(db, "events", eventId))
        );
        await Promise.all(deletePromises);
        
        // Clear selection after successful delete
        state.selectedEventIds.clear();
        userSelectAllCheckbox.checked = false;
        userSelectAllCheckbox.indeterminate = false;
    } catch (error) {
        console.error("Error batch deleting events:", error);
        alert('刪除過程中發生錯誤，請稍後再試。');
    } finally {
        userBatchDeleteBtn.disabled = false;
        userBatchDeleteBtn.innerHTML = `
            <i data-lucide="trash-2" class="w-3 h-3"></i>
            <span>刪除 (<span id="user-selected-count">0</span>)</span>
        `;
        lucide.createIcons();
        updateUserBatchControlsUI();
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
    workspaceFilterSelect.addEventListener('change', handleWorkspaceFilterChange);
    exportWeeklyPdfBtn.addEventListener('click', handleExportWeeklyPdf);
    if (copyLastWeekBtn) copyLastWeekBtn.addEventListener('click', handleCopyLastWeek);
    showAddFormBtn.addEventListener('click', handleShowAddForm);
    cancelEditBtn.addEventListener('click', hideForm);
    addEventForm.querySelector('form').addEventListener('submit', handleSaveEvent);
    eventColorPicker.addEventListener('click', handleColorPick);
    eventDateSelect.addEventListener('change', updateFormModeForDate);
    calendarGrid.addEventListener('click', handleEventClick);
    checklistContent.addEventListener('click', handleChecklistClick);
    checklistContent.addEventListener('change', handleUserCheckboxChange);
    userSelectAllCheckbox.addEventListener('change', handleUserSelectAll);
    userBatchDeleteBtn.addEventListener('click', handleUserBatchDelete);

    // Drag & drop wiring (delegated)
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragend', handleDragEnd);
    calendarGrid.addEventListener('dragover', handleCalendarDragOver);
    calendarGrid.addEventListener('dragleave', handleCalendarDragLeave);
    calendarGrid.addEventListener('drop', handleCalendarDrop);
    if (taskPoolContainer) {
        taskPoolContainer.addEventListener('dragover', handlePoolDragOver);
        taskPoolContainer.addEventListener('dragleave', handlePoolDragLeave);
        taskPoolContainer.addEventListener('drop', handlePoolDrop);
    }
    if (taskPoolContent) {
        taskPoolContent.addEventListener('click', handlePoolClick);
    }
    
    setInterval(() => {
        if(state.isLoggedIn) {
            currentTimeDisplay.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        }
    }, 60000);

    renderAppUI();
}

init();

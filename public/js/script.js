
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
} from './planner-renderer.js';

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
const workspaceFilterSelect = document.getElementById('workspace-filter-select');
const exportWeeklyPdfBtn = document.getElementById('export-weekly-pdf-btn');
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
const saveEventBtn = document.getElementById('save-event-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const formStatus = document.getElementById('form-status');
const summaryContent = document.getElementById('summary-content');
const checklistContent = document.getElementById('checklist-content');
const userBatchControls = document.getElementById('user-batch-controls');
const userSelectAllCheckbox = document.getElementById('user-select-all-checkbox');
const userBatchDeleteBtn = document.getElementById('user-batch-delete-btn');
const userSelectedCountSpan = document.getElementById('user-selected-count');

// Sidebar DOM elements for the renderer
const sidebarDOMElements = { summaryContent, checklistContent, eventDateSelect, eventColorPicker };


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
        uid: state.currentUser.uid,
        email: state.currentUser.email,
    };

    if (!eventData.title || !eventData.date || !eventStartHourInput.value || !eventStartMinuteInput.value || !eventEndHourInput.value || !eventEndMinuteInput.value) {
        formStatus.textContent = '請填寫所有必填欄位！';
        formStatus.className = 'text-red-500 text-sm text-center h-5';
        return;
    }

    setButtonLoading(saveEventBtn, true);
    formStatus.textContent = '';

    try {
        if (state.editingEventId) {
            const eventRef = doc(db, "events", state.editingEventId);
            await updateDoc(eventRef, eventData);
        } else {
            eventData.completed = false;
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

function openEditForm(eventId) {
    const eventToEdit = state.events.find(e => e.id === eventId);
    if (eventToEdit) {
        state.editingEventId = eventId;
        showForm(true);
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
        eventNotesInput.value = eventToEdit.notes;
        state.selectedColor = eventToEdit.color;
        // Re-render the sidebar to update form and color picker
        renderSidebar(state, sidebarDOMElements);
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
    state.selectedColor = colorOptions[0];
    // Re-render sidebar to reset form state visually
    renderSidebar(state, sidebarDOMElements);
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

async function handleExportWeeklyPdf() {
    if (state.selectedWorkspace === ALL_WORKSPACES) {
        alert('請先指定要輸出的工作區。');
        return;
    }

    if (!window.html2pdf) {
        alert('PDF 匯出工具尚未載入完成，請稍後再試。');
        return;
    }

    const weekEvents = filterEventsForCurrentWeek(getVisibleUserEvents(state.allEvents))
        .sort((a, b) => new Date(`${a.date}T${a.startTime}`).getTime() - new Date(`${b.date}T${b.startTime}`).getTime());

    if (weekEvents.length === 0) {
        alert(`本週「${getSelectedWorkspaceLabel()}」沒有可輸出的時間表。`);
        return;
    }

    const { weekDays } = getCurrentWeekBounds();
    const weekStart = weekDays[0];
    const weekEnd = weekDays[6];
    const headerFormatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' });
    const dayFormatter = new Intl.DateTimeFormat('zh-TW', { weekday: 'short', month: 'numeric', day: 'numeric' });
    const fileName = sanitizeFileName(`${getSelectedWorkspaceLabel()}_${formatDate(weekStart)}_${formatDate(weekEnd)}_time-table.pdf`);

    const exportContainer = document.createElement('div');
    exportContainer.style.position = 'fixed';
    exportContainer.style.left = '-99999px';
    exportContainer.style.top = '0';
    exportContainer.style.width = '794px';
    exportContainer.style.background = '#ffffff';
    exportContainer.style.padding = '32px';
    exportContainer.style.color = '#0f172a';
    exportContainer.style.fontFamily = '"Microsoft JhengHei", "PingFang TC", sans-serif';

    const sectionsHtml = weekDays.map((day) => {
        const dateKey = formatDate(day);
        const dayEvents = weekEvents.filter((event) => event.date === dateKey);
        const rowsHtml = dayEvents.length > 0
            ? dayEvents.map((event) => {
                const detailText = [event.chapter, event.pages, event.notes].filter(Boolean).join(' / ') || '-';
                return `
                    <tr>
                        <td style="border:1px solid #cbd5e1;padding:8px 10px;">${escapeHtml(event.startTime)} - ${escapeHtml(event.endTime)}</td>
                        <td style="border:1px solid #cbd5e1;padding:8px 10px;">${escapeHtml(event.title)}</td>
                        <td style="border:1px solid #cbd5e1;padding:8px 10px;">${escapeHtml(detailText)}</td>
                        <td style="border:1px solid #cbd5e1;padding:8px 10px;">${event.completed ? '已完成' : '未完成'}</td>
                    </tr>
                `;
            }).join('')
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

    exportContainer.innerHTML = `
        <div style="margin-bottom:24px;">
            <h1 style="font-size:28px;margin:0 0 8px;">${escapeHtml(getSelectedWorkspaceLabel())} 本週時間表</h1>
            <div style="font-size:14px;color:#475569;">週次：${escapeHtml(headerFormatter.format(weekStart))} - ${escapeHtml(headerFormatter.format(weekEnd))}</div>
            <div style="font-size:14px;color:#475569;margin-top:4px;">使用者：${escapeHtml(state.currentUser?.email || '')}</div>
        </div>
        ${sectionsHtml}
    `;

    document.body.appendChild(exportContainer);

    exportWeeklyPdfBtn.disabled = true;
    const originalButtonHtml = exportWeeklyPdfBtn.innerHTML;
    exportWeeklyPdfBtn.innerHTML = `
        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        <span>輸出中...</span>
    `;

    try {
        await window.html2pdf().set({
            margin: [10, 10, 10, 10],
            filename: fileName,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
        }).from(exportContainer).save();
    } catch (error) {
        console.error('Error exporting weekly PDF:', error);
        alert('輸出 PDF 時發生錯誤，請稍後再試。');
    } finally {
        exportWeeklyPdfBtn.disabled = false;
        exportWeeklyPdfBtn.innerHTML = originalButtonHtml;
        document.body.removeChild(exportContainer);
        lucide.createIcons();
    }
}

function handleEventClick(e) {
    const eventElement = e.target.closest('.event-item');
    if (eventElement) {
        const eventId = eventElement.dataset.eventId;
        openEditForm(eventId);
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
    showAddFormBtn.addEventListener('click', handleShowAddForm);
    cancelEditBtn.addEventListener('click', hideForm);
    addEventForm.querySelector('form').addEventListener('submit', handleSaveEvent);
    eventColorPicker.addEventListener('click', handleColorPick);
    calendarGrid.addEventListener('click', handleEventClick);
    checklistContent.addEventListener('click', handleChecklistClick);
    checklistContent.addEventListener('change', handleUserCheckboxChange);
    userSelectAllCheckbox.addEventListener('change', handleUserSelectAll);
    userBatchDeleteBtn.addEventListener('click', handleUserBatchDelete);
    
    setInterval(() => {
        if(state.isLoggedIn) {
            currentTimeDisplay.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        }
    }, 60000);

    renderAppUI();
}

init();

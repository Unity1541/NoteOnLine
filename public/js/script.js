
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
    unsubscribeEvents: null,
    currentWeekStart: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()),
    editingEventId: null,
    selectedColor: colorOptions[0],
    selectedEventIds: new Set()
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
const calendarGrid = document.getElementById('calendar-grid');
const showAddFormBtn = document.getElementById('show-add-form-btn');
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
        if (state.unsubscribeEvents) state.unsubscribeEvents();
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
        state.events = [];
        querySnapshot.forEach((doc) => {
            state.events.push({ id: doc.id, ...doc.data() });
        });
        // Re-render only the parts that depend on events
        renderCalendarGrid(state, calendarGrid);
        renderSidebar(state, sidebarDOMElements);
        updateUserBatchControlsUI();
    });
}

async function handleSaveEvent(e) {
    e.preventDefault();
    const eventData = {
        title: eventTitleInput.value,
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
    renderCalendarGrid(state, calendarGrid);
    renderSidebar(state, sidebarDOMElements);
}

function handleGoToToday() {
    const today = new Date();
    state.currentWeekStart = today;
    sessionStorage.setItem('currentWeekStart', state.currentWeekStart.toISOString());
    renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay);
    renderCalendarGrid(state, calendarGrid);
    renderSidebar(state, sidebarDOMElements);
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

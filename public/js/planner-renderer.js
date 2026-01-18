
// This module contains all shared UI rendering logic for the planner.
// It is used by both script.js (user view) and admin.js (admin view).

const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const colorOptions = ['#A7F3D0', '#BBF7D0', '#FED7AA', '#FBCFE8', '#DDD6FE', '#BFDBFE', '#F9A8D4', '#C084FC'];

// --- UTILITY FUNCTIONS ---
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

const timeToMinutes = (time) => {
    if (!time) return 0;
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
};

// --- EXPORTED RENDER FUNCTIONS ---
export function renderHeader(state, userDisplayName, weekDisplay, currentTimeDisplay) {
    if (state.currentUser) {
       userDisplayName.textContent = state.currentUser.displayName || state.currentUser.email;
    }
    const weekStartDate = getWeekDays(state.currentWeekStart)[0];
    weekDisplay.textContent = `${weekStartDate.getFullYear()}年${weekStartDate.getMonth() + 1}月 第${Math.ceil(weekStartDate.getDate() / 7)}週`;
    currentTimeDisplay.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

export function renderCalendarGrid(state, calendarGrid) {
    calendarGrid.innerHTML = '';
    const weekDays = getWeekDays(state.currentWeekStart);
    const timeLabelContainer = document.createElement('div');
    timeLabelContainer.className = 'border-r border-stone-200';
    
    // --- TIME LABELS with Hour marks ---
    let timeLabelsHTML = '<div class="h-16 border-b border-stone-200 flex items-center justify-center text-base font-medium text-slate-600">時間</div><div class="relative h-[1020px]">';
    for (let h = 6; h <= 22; h++) {
        // Main hour label
        const hourTop = (h - 6) * 60;
        timeLabelsHTML += `<div class="absolute text-sm text-slate-600 font-medium text-center w-full" style="top: ${hourTop - 10}px; height: 20px; z-index: 5;">${String(h).padStart(2, '0')}:00</div>`;
    }
    timeLabelsHTML += '</div>';
    timeLabelContainer.innerHTML = timeLabelsHTML;
    calendarGrid.appendChild(timeLabelContainer);

    // --- DAY COLUMNS ---
    weekDays.forEach((day, index) => {
        const dayColumn = document.createElement('div');
        dayColumn.className = 'border-r border-stone-200 last:border-r-0';
        
        const isToday = formatDate(day) === formatDate(new Date());
        const todayClass = isToday
            ? 'bg-gradient-to-r from-indigo-200/60 via-purple-200/60 to-pink-200/60 text-indigo-800 font-bold shadow-inner'
            : 'text-slate-700 font-medium hover:bg-white/30 transition-all duration-200';

        let dayHTML = `
            <div class="h-16 border-b border-white/20 flex flex-col items-center justify-center text-base backdrop-blur-sm ${todayClass}">
                <div class="font-medium">${dayNames[index]}</div>
                <div class="text-sm">${day.getDate()}</div>
            </div>
            <div class="relative h-[1020px] day-events-container" data-date="${formatDate(day)}">
        `;

        // --- GRID LINES at 5-minute intervals ---
        for (let min = 0; min < 1020; min += 5) {
            const isHour = min % 60 === 0;
            const lineClass = isHour ? 'border-stone-200' : 'border-stone-100'; // Bolder line for hours
            dayHTML += `<div class="absolute w-full border-t ${lineClass}" style="top: ${min}px"></div>`;
        }

        const dayEvents = state.events.filter(e => e.date === formatDate(day));
        dayEvents.forEach(event => {
            const startMinutes = timeToMinutes(event.startTime);
            const endMinutes = timeToMinutes(event.endTime);
            const top = (startMinutes - 360); // top position in pixels (relative to 6:00)
            const height = (endMinutes - startMinutes); // height in pixels
            const eventStyle = `top: ${Math.max(0, top)}px; height: ${Math.max(12, height)}px; background-color: ${event.color}; border-left-color: ${event.completed ? '#10b981' : '#6366f1'}`;
            
            const tooltipParts = [event.title];
            if (event.chapter) tooltipParts.push(`章節: ${event.chapter}`);
            if (event.pages) tooltipParts.push(`頁數: ${event.pages}`);
            if (event.notes) tooltipParts.push(`備註: ${event.notes}`);
            const tooltipText = tooltipParts.join('\n');

            dayHTML += `
                <div class="event-item absolute left-1 right-1 rounded-lg border-l-4 shadow-md group cursor-pointer transition-all duration-200 hover:shadow-lg hover:z-10 transform hover:scale-105 ${event.completed ? 'opacity-70' : ''}" style="${eventStyle}" data-event-id="${event.id}" title="${tooltipText}">
                    <div class="p-1.5 h-full flex flex-col justify-center relative overflow-hidden">
                      <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      <div class="font-semibold text-slate-800 text-sm leading-tight relative z-10 truncate ${event.completed ? 'line-through text-slate-600' : ''}">${event.title}</div>
                      ${event.chapter ? `<div class="text-xs text-slate-700 font-medium relative z-10 truncate">${event.chapter}</div>` : ''}
                      ${event.pages ? `<div class="text-xs text-slate-700 font-medium relative z-10">${event.pages}</div>` : ''}
                      <div class="text-xs text-slate-700 font-medium relative z-10 mt-0.5">${event.startTime}</div>
                      ${event.notes ? `<div class="text-xs text-slate-600 opacity-90 truncate mt-0.5 relative z-10">📝 ${event.notes}</div>` : ''}
                    </div>
                </div>
            `;
        });

        dayHTML += '</div>';
        dayColumn.innerHTML = dayHTML;
        calendarGrid.appendChild(dayColumn);
    });
}

export function renderSidebar(state, { summaryContent, checklistContent, eventDateSelect, eventColorPicker }) {
    if (summaryContent) renderSummary(state, summaryContent);
    if (checklistContent) renderChecklist(state, checklistContent);
    renderAddEventForm(state, eventDateSelect, eventColorPicker);
    lucide.createIcons();
}

function renderAddEventForm(state, eventDateSelect, eventColorPicker) {
    const weekDays = getWeekDays(state.currentWeekStart);
    const currentSelection = eventDateSelect.value;
    eventDateSelect.innerHTML = '<option value="">選擇日期</option>';
    weekDays.forEach((day, index) => {
        const option = document.createElement('option');
        option.value = formatDate(day);
        option.textContent = `${dayNames[index]} ${day.getMonth() + 1}/${day.getDate()}`;
        eventDateSelect.appendChild(option);
    });
    eventDateSelect.value = currentSelection;

    eventColorPicker.innerHTML = '';
    colorOptions.forEach(color => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `w-8 h-8 rounded-full border-2 transition-all duration-200 ${state.selectedColor === color ? 'border-slate-600 scale-110 shadow-md' : 'border-slate-300 hover:border-slate-400'}`;
        button.style.backgroundColor = color;
        button.dataset.color = color;
        eventColorPicker.appendChild(button);
    });
}

function renderSummary(state, summaryContent) {
    const weekDays = getWeekDays(state.currentWeekStart);
    const firstDay = new Date(weekDays[0]);
    firstDay.setHours(0, 0, 0, 0);

    const lastDay = new Date(weekDays[6]);
    lastDay.setHours(23, 59, 59, 999);

    const weekEvents = state.events.filter(e => {
        // By appending 'T00:00', we ensure the date is parsed in the local timezone, not UTC.
        const eventDate = new Date(e.date + 'T00:00');
        return eventDate >= firstDay && eventDate <= lastDay;
    });

    const completed = weekEvents.filter(e => e.completed).length;
    const total = weekEvents.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    let summaryHTML = `
        <div class="bg-white/20 backdrop-blur-sm rounded-2xl p-4 border border-white/30 shadow-inner">
            <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-bold text-slate-700">完成進度</span>
                <span class="text-xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">${percentage}%</span>
            </div>
            <div class="w-full bg-white/60 rounded-full h-3 mb-2 shadow-inner backdrop-blur-sm">
                <div class="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-3 rounded-full transition-all duration-500 shadow-lg relative overflow-hidden" style="width: ${percentage}%">
                    <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse"></div>
                </div>
            </div>
            <div class="flex justify-between text-xs text-slate-600 font-medium">
                <span>已完成: ${completed}</span>
                <span>總計: ${total}</span>
            </div>
        </div>
    `;

    weekDays.forEach((day, index) => {
        const dayEvents = state.events.filter(e => e.date === formatDate(day));
        if (dayEvents.length > 0) {
            summaryHTML += `
                <div class="flex justify-between text-sm bg-white/40 rounded-xl p-2 backdrop-blur-sm">
                    <span class="text-slate-700 font-medium">${dayNames[index]} ${day.getDate()}日</span>
                    <span class="font-bold text-indigo-600">${dayEvents.length} 件</span>
                </div>
            `;
        }
    });

    summaryContent.innerHTML = summaryHTML;
}

function renderChecklist(state, checklistContent) {
    const weekDays = getWeekDays(state.currentWeekStart);
    const firstDay = new Date(weekDays[0]);
    firstDay.setHours(0, 0, 0, 0); // BUG FIX: Set to start of Monday

    const lastDay = new Date(weekDays[6]);
    lastDay.setHours(23, 59, 59, 999);
    
    const weekEvents = state.events
        .filter(e => {
            // By appending 'T00:00', we ensure the date is parsed in the local timezone, not UTC.
            const eventDate = new Date(e.date + 'T00:00');
            return eventDate >= firstDay && eventDate <= lastDay;
        })
        .sort((a, b) => new Date(`${a.date}T${a.startTime}`).getTime() - new Date(`${b.date}T${b.startTime}`).getTime());

    checklistContent.innerHTML = '';
    if (weekEvents.length === 0) {
        checklistContent.innerHTML = `
            <div class="text-center py-8 text-slate-400">
                <i data-lucide="check-square" class="w-12 h-12 mx-auto mb-3 opacity-50"></i>
                <p class="text-sm font-medium">本週還沒有安排任何計劃</p>
            </div>
        `;
    } else {
        weekEvents.forEach(event => {
            const dayIndex = weekDays.findIndex(day => formatDate(day) === event.date);
            const itemClass = event.completed
                ? 'bg-gradient-to-r from-green-50/70 to-emerald-50/70 border-green-300/50 hover:from-green-100/70 hover:to-emerald-100/70'
                : 'bg-white/50 border-white/40 hover:border-indigo-200/60 hover:bg-indigo-50/60';

            const item = document.createElement('div');
            item.className = `checklist-item flex items-start gap-3 p-3 rounded-2xl transition-all duration-300 border backdrop-blur-sm shadow-md hover:shadow-lg ${itemClass}`;
            item.dataset.eventId = event.id;
            
            item.innerHTML = `
                <input type="checkbox" data-event-id="${event.id}" class="checklist-checkbox w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer flex-shrink-0 mt-1">
                <button class="toggle-complete-btn flex-shrink-0 hover:scale-110 transition-transform duration-200 pt-1" type="button">
                    <i data-lucide="${event.completed ? 'check-circle' : 'circle'}" class="w-6 h-6 ${event.completed ? 'text-green-600' : 'text-slate-400 hover:text-indigo-500'}"></i>
                </button>
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm leading-tight ${event.completed ? 'text-green-800 line-through' : 'text-slate-800'}">${event.title}</div>
                     ${event.chapter || event.pages ? `
                        <div class="text-xs text-slate-600 font-medium mt-1 bg-white/40 rounded-lg px-2 py-0.5 inline-flex items-center gap-2 flex-wrap">
                            ${event.chapter ? `<span><i data-lucide="book" class="inline w-3 h-3 mr-1"></i>${event.chapter}</span>` : ''}
                            ${event.chapter && event.pages ? `<span class="opacity-50">|</span>` : ''}
                            ${event.pages ? `<span><i data-lucide="file-text" class="inline w-3 h-3 mr-1"></i>${event.pages}</span>` : ''}
                        </div>
                    ` : ''}
                    <div class="text-xs text-slate-600 font-medium mt-1">${dayNames[dayIndex] ?? ''} ${event.startTime}-${event.endTime}</div>
                    ${event.notes ? `<div class="text-xs text-slate-500 truncate mt-1 bg-white/40 rounded-lg px-2 py-0.5"><i data-lucide="message-square" class="inline w-3 h-3 mr-1"></i>${event.notes}</div>` : ''}
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                    <div class="w-5 h-5 rounded-full border-2 border-white shadow-md" style="background-color: ${event.color}"></div>
                    <button class="edit-event-btn text-slate-400 hover:text-indigo-500 transition-colors duration-200 p-2 rounded-full hover:bg-white/50" title="編輯此行程" type="button">
                        <i data-lucide="edit-3" class="w-4 h-4"></i>
                    </button>
                    <button class="delete-event-btn text-slate-400 hover:text-red-500 transition-colors duration-200 p-2 rounded-full hover:bg-white/50" title="刪除此行程" type="button">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            `;
            checklistContent.appendChild(item);
        });
    }
}
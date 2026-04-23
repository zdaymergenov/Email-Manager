// sidebar.js - Управление боковой панелью веток (СТИЛЬ ЧАТА)

import { openThreadModal } from './modal.js';

let currentEmailId = null;
let currentThreadId = null;

export async function openThreadSidebar(emailId, threadId) {
    if (!threadId || threadId === 'null') {
        console.log('📧 Письмо не в ветке');
        return;
    }
    
    // Открываем модальное окно с веткой вместо боковой панели
    await openThreadModal(threadId, emailId);
}

// Остальные функции можно удалить или оставить для совместимости
export function showSidebar() {
    // Больше не используется
    console.log('sidebar: showSidebar вызван (устаревший метод)');
}

export function closeSidebar() {
    // Больше не используется
    console.log('sidebar: closeSidebar вызван (устаревший метод)');
}

// Глобальные функции для onclick
window.closeSidebar = function() {
    const sidebar = document.getElementById('threadSidebar');
    if (sidebar) {
        sidebar.classList.add('hidden');
    }
};

window.openThreadSidebar = openThreadSidebar;

console.log('✅ sidebar.js загружен (использует модальное окно)');
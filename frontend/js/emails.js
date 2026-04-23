// emails.js - Загрузка и отображение писем (ОБНОВЛЕНО ШАГ 5️⃣)

import * as api from './api.js';
import { truncateText, formatDate, getInitials, getAvatarColor } from './utils.js';
import { openEmail } from './modal.js';
import { openThreadSidebar } from './sidebar.js';

export async function loadLetters() {
    try {
        console.log('📬 Загружаю письма...');
        const data = await api.fetchEmails(1, 50);
        displayEmails(data.emails || [], 'lettersList');
        console.log(`✅ Загружено ${data.emails?.length || 0} писем`);
    } catch (error) {
        console.error('❌ Ошибка загрузки писем:', error);
    }
}

export function displayEmails(emails, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!emails || emails.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div>Нет писем</div>';
        return;
    }
    
    container.innerHTML = emails.map((email, idx) => {
        const initials = getInitials(email.sender_name || email.sender_email || '?');
        const avatarColor = getAvatarColor(idx);
        
        return `
            <div class="email-item" 
                 onclick="handleEmailClick(${email.id}, ${email.thread_id || 'null'})"
                 style="cursor: pointer; position: relative;">
                
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                    <div class="message-avatar" style="background: ${avatarColor}; width: 40px; height: 40px; flex-shrink: 0;">
                        ${initials}
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div class="email-from">
                            👤 ${email.sender_name || email.sender_email}
                        </div>
                        <div class="email-subject">
                            📌 ${email.subject}
                        </div>
                        <div class="email-preview">
                            ${truncateText(email.body || '', 100)}
                        </div>
                        <div class="email-meta">
                            <span>📁 ${email.folder || 'Входящие'}</span>
                            <span>📅 ${formatDate(email.date_received || email.date)}</span>
                            ${email.thread_id ? `<span class="email-badge">🧵 В ветке</span>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window.handleEmailClick = async function(emailId, threadId) {
    console.log(`📧 Клик на письмо #${emailId}, ветка: ${threadId}`);
    
    if (threadId && threadId !== 'null') {
        // Если письмо в ветке - открываем модальное окно с веткой
        const { openThreadModal } = await import('./modal.js');
        await openThreadModal(threadId, emailId);
    } else {
        // Если одиночное письмо - открываем в обычном модальном окне
        const { openEmail } = await import('./modal.js');
        openEmail(emailId, null);
    }
};

// Живой поиск по отправителю
export function setupEmailSearch() {
    const searchInput = document.getElementById('letterSearch');
    if (!searchInput) return;
    
    searchInput.addEventListener('input', async (e) => {
        const query = e.target.value;
        console.log(`🔍 Поиск: "${query}"`);
        
        if (query.length < 2) {
            loadLetters();
            return;
        }
        
        try {
            const data = await api.searchEmails(query);
            displayEmails(data.emails || [], 'lettersList');
            console.log(`✅ Найдено ${data.emails?.length || 0} писем`);
        } catch (error) {
            console.error('❌ Ошибка поиска:', error);
        }
    });
}

console.log('✅ emails.js загружен');

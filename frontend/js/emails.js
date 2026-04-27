// emails.js - Загрузка и отображение писем

import * as api from './api.js';
import { truncateText, formatDate, getInitials, getAvatarColor } from './utils.js';

/**
 * Первоначальная загрузка писем (вызывается при старте)
 * Использует applyAllFilters для единой логики
 */
export async function loadLetters() {
    try {
        console.log('📬 Загружаю письма...');
        // Импортируем applyAllFilters динамически чтобы избежать циклической зависимости
        const { applyAllFilters } = await import('./filters.js');
        await applyAllFilters();
    } catch (error) {
        console.error('❌ Ошибка загрузки писем:', error);
    }
}

/**
 * Отображает письма в указанном контейнере
 */
export function displayEmails(emails, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!emails || emails.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div>Нет писем по выбранным фильтрам</div>';
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
                            📌 ${email.subject || 'Без темы'}
                        </div>
                        <div class="email-preview">
                            ${truncateText(email.body || email.preview || '', 100)}
                        </div>
                        <div class="email-meta">
                            <span>📁 ${email.folder || 'Входящие'}</span>
                            <span>📅 ${formatDate(email.date || email.date_received)}</span>
                            ${email.attachments_count > 0 ? `<span>📎 ${email.attachments_count}</span>` : ''}
                            ${email.is_read === 0 || email.is_read === false ? `<span class="email-badge" style="background: #ef4444; color: white;">● Новое</span>` : ''}
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
        const { openThreadModal } = await import('./modal.js');
        await openThreadModal(threadId, emailId);
    } else {
        const { openEmail } = await import('./modal.js');
        openEmail(emailId, null);
    }
};

/**
 * Живой поиск по отправителю/теме
 * Работает по всем письмам через стандартный API search
 */
export function setupEmailSearch() {
    const searchInput = document.getElementById('letterSearch');
    if (!searchInput) return;
    
    let searchTimeout;
    
    searchInput.addEventListener('input', async (e) => {
        const query = e.target.value;
        
        // Дебаунс - ждём 300мс после последнего ввода
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            console.log(`🔍 Поиск: "${query}"`);
            
            if (query.length < 2) {
                // Если поиск пустой - возвращаемся к фильтрации
                const { applyAllFilters } = await import('./filters.js');
                await applyAllFilters();
                return;
            }
            
            try {
                const data = await api.searchEmails(query);
                displayEmails(data.emails || [], 'lettersList');
                
                // Обновляем счётчик
                const totalEl = document.getElementById('emailsCountTotal');
                const shownEl = document.getElementById('emailsCountShown');
                if (totalEl) totalEl.textContent = data.emails?.length || 0;
                if (shownEl) shownEl.textContent = '(результаты поиска)';
                
                // Скрываем пагинацию при поиске
                const pagination = document.getElementById('pagination');
                if (pagination) pagination.innerHTML = '';
                
                console.log(`✅ Найдено ${data.emails?.length || 0} писем`);
            } catch (error) {
                console.error('❌ Ошибка поиска:', error);
            }
        }, 300);
    });
}

console.log('✅ emails.js загружен');

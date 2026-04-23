// modal.js - Управление модальным окном с письмом (ИСПРАВЛЕНО)

import * as api from './api.js';
import { formatDate, truncateText } from './utils.js';

let currentModalEmailId = null;

// Вспомогательная функция (объявлена ОДИН раз)
function getNumeral(n, one, two, five) {
    n = Math.abs(n) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return five;
    if (n1 > 1 && n1 < 5) return two;
    if (n1 === 1) return one;
    return five;
}

export async function openEmail(emailId, threadId) {
    try {
        console.log(`📧 Открываю письмо #${emailId}...`);
        currentModalEmailId = emailId;
        
        const email = await api.fetchEmail(emailId);
        if (!email) {
            console.error('❌ Письмо не найдено');
            return;
        }
        
        const senderDisplay = getSenderDisplay(email);
        const formattedDate = formatEmailDate(email.date_received || email.date);
        const folder = email.folder || 'Входящие';
        const folderIcon = getFolderIcon(folder);
        
        let html = `
            <div class="detail-from">
                <span class="sender-avatar">${getInitials(senderDisplay)}</span>
                <span class="sender-name">${escapeHtml(senderDisplay)}</span>
                ${email.sender_email ? `<span class="sender-email">&lt;${escapeHtml(email.sender_email)}&gt;</span>` : ''}
            </div>
            <div class="detail-subject">${escapeHtml(email.subject || 'Без темы')}</div>
            <div class="detail-meta">
                <span class="meta-item">${folderIcon} ${escapeHtml(folder)}</span>
                <span class="meta-item">📅 ${formattedDate}</span>
                ${email.attachments_count ? `<span class="meta-item">📎 ${email.attachments_count} влож.</span>` : ''}
                ${email.importance === 'high' ? '<span class="meta-item importance-high">⚠️ Важное</span>' : ''}
            </div>
            <div class="detail-body">${formatEmailBody(email.body)}</div>
        `;
        
        if (email.signature) {
            html += `
                <div class="detail-signature">
                    <div class="signature-divider">—</div>
                    ${escapeHtml(email.signature).replace(/\n/g, '<br>')}
                </div>
            `;
        }
        
        if (threadId && threadId !== 'null') {
            console.log(`🧵 Загружаю переписку для ветки #${threadId}...`);
            const threadData = await api.fetchThread(threadId);
            
            if (threadData && threadData.emails && threadData.emails.length > 0) {
                html += `
                    <hr class="thread-divider">
                    <h3 class="thread-title">🧵 Вся переписка (${threadData.emails.length} ${getNumeral(threadData.emails.length, 'письмо', 'письма', 'писем')})</h3>
                    <div class="thread-emails-list">
                `;
                
                threadData.emails.forEach((e, idx) => {
                    const isCurrentEmail = e.id === emailId;
                    const senderDisplay = getSenderDisplay(e);
                    const emailDate = formatEmailDate(e.date_received || e.date);
                    
                    let statusLabel = '';
                    let statusClass = '';
                    
                    if (idx === 0) {
                        statusLabel = '📤 Первое';
                        statusClass = 'first';
                    } else if (isCurrentEmail) {
                        statusLabel = '⭐ Текущее';
                        statusClass = 'current';
                    } else {
                        statusLabel = '↩️ Ответ';
                        statusClass = 'reply';
                    }
                    
                    html += `
                        <div class="thread-email-item ${isCurrentEmail ? 'active' : ''}">
                            <div class="thread-email-header">
                                <span class="thread-sender">${escapeHtml(senderDisplay)}</span>
                                <span class="thread-date">${emailDate}</span>
                                <span class="thread-status ${statusClass}">${statusLabel}</span>
                            </div>
                            <div class="thread-email-body">
                                ${formatEmailBody(e.body, 300)}
                            </div>
                            ${e.attachments_count ? '<div class="thread-attachments">📎 Есть вложения</div>' : ''}
                        </div>
                    `;
                });
                
                html += '</div>';
            }
        }
        
        document.getElementById('emailDetail').innerHTML = html;
        document.getElementById('emailModal').classList.add('show');
        console.log('✅ Письмо открыто в модальном окне');
        
    } catch (error) {
        console.error('❌ Ошибка открытия письма:', error);
        showErrorInModal('Не удалось загрузить письмо');
    }
}

function getSenderDisplay(email) {
    if (email.sender_name && email.sender_name !== 'undefined') {
        return email.sender_name;
    }
    if (email.from && email.from !== 'undefined') {
        const match = email.from.match(/^([^<]+)/);
        if (match) {
            return match[1].trim();
        }
        return email.from;
    }
    if (email.sender_email) {
        return email.sender_email.split('@')[0];
    }
    return 'Неизвестный отправитель';
}

function formatEmailDate(dateValue) {
    if (!dateValue) return '—';
    
    try {
        let date;
        
        if (typeof dateValue === 'string') {
            if (dateValue.includes('-') && dateValue.includes(':')) {
                date = new Date(dateValue.replace(' ', 'T'));
            }
            else if (dateValue.includes('.')) {
                const parts = dateValue.split(/[.\s:]/);
                if (parts.length >= 5) {
                    date = new Date(parts[2], parts[1] - 1, parts[0], parts[3], parts[4]);
                }
            }
            else {
                date = new Date(dateValue);
            }
        } else {
            date = new Date(dateValue);
        }
        
        if (isNaN(date.getTime())) {
            return dateValue;
        }
        
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === date.toDateString();
        
        const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        
        if (isToday) {
            return `Сегодня, ${timeStr}`;
        } else if (isYesterday) {
            return `Вчера, ${timeStr}`;
        } else {
            return date.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    } catch (e) {
        return dateValue;
    }
}

function formatEmailBody(body, maxLength = null) {
    if (!body) return '<span class="empty-body">(нет содержимого)</span>';
    
    let text = escapeHtml(body);
    
    if (maxLength && text.length > maxLength) {
        text = text.substring(0, maxLength) + '...';
    }
    
    text = text.replace(/\n/g, '<br>');
    text = text.replace(/(https?:\/\/[^\s<>]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    text = text.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g, '<a href="mailto:$1">$1</a>');
    
    return text;
}

function getInitials(name) {
    if (!name || name === 'Неизвестный отправитель') return '?';
    
    const parts = name.split(' ').filter(p => p.length > 0 && !p.includes('@'));
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function getFolderIcon(folder) {
    const icons = {
        'Входящие': '📥',
        'Inbox': '📥',
        'Отправленные': '📤',
        'Sent': '📤',
        'Черновики': '📝',
        'Drafts': '📝',
        'Удаленные': '🗑️',
        'Deleted': '🗑️',
        'Спам': '🚫',
        'Junk': '🚫'
    };
    return icons[folder] || '📁';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showErrorInModal(message) {
    document.getElementById('emailDetail').innerHTML = `
        <div class="error-message show">
            ❌ ${message}
        </div>
    `;
    document.getElementById('emailModal').classList.add('show');
}

export function closeModal() {
    const modal = document.getElementById('emailModal');
    if (modal) {
        modal.classList.remove('show');
        console.log('✅ Модальное окно закрыто');
    }
}

export function setupModalClose() {
    const modal = document.getElementById('emailModal');
    if (!modal) return;
    
    modal.addEventListener('click', (e) => {
        if (e.target.id === 'emailModal') {
            closeModal();
        }
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('show')) {
            closeModal();
        }
    });
}

// ============ ФУНКЦИИ ДЛЯ МОДАЛЬНОГО ОКНА ВЕТКИ ============

export async function openThreadModal(threadId, activeEmailId = null) {
    if (!threadId) {
        console.error('❌ Не указан ID ветки');
        return;
    }
    
    try {
        console.log(`🧵 Открываю модальное окно ветки #${threadId}...`);
        
        document.getElementById('threadModalBody').innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div class="spinner" style="width: 40px; height: 40px; border: 4px solid #e2e8f0; border-top-color: var(--primary); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
                <p>Загрузка ветки...</p>
            </div>
        `;
        document.getElementById('threadModal').classList.add('show');
        
        const response = await fetch(`/api/thread/${threadId}`);
        const data = await response.json();
        
        if (!data.emails || data.emails.length === 0) {
            throw new Error('Ветка пуста');
        }
        
        const emails = data.emails;
        const firstEmail = emails[0];
        const lastEmail = emails[emails.length - 1];
        
        document.getElementById('threadModalSubject').textContent = firstEmail.subject || 'Без темы';
        
        const participants = new Set();
        emails.forEach(e => {
            if (e.sender_email) participants.add(e.sender_email);
        });
        
        let html = `
            <div class="thread-stats">
                <div class="thread-stat-item">
                    <span class="thread-stat-icon">📧</span>
                    <div>
                        <div class="thread-stat-value">${emails.length}</div>
                        <div class="thread-stat-label">${getNumeral(emails.length, 'письмо', 'письма', 'писем')}</div>
                    </div>
                </div>
                <div class="thread-stat-item">
                    <span class="thread-stat-icon">👥</span>
                    <div>
                        <div class="thread-stat-value">${participants.size}</div>
                        <div class="thread-stat-label">${getNumeral(participants.size, 'участник', 'участника', 'участников')}</div>
                    </div>
                </div>
                <div class="thread-stat-item">
                    <span class="thread-stat-icon">📅</span>
                    <div>
                        <div class="thread-stat-value">${formatShortDate(firstEmail.date_received)}</div>
                        <div class="thread-stat-label">Начало</div>
                    </div>
                </div>
                ${emails.length > 1 ? `
                <div class="thread-stat-item">
                    <span class="thread-stat-icon">📅</span>
                    <div>
                        <div class="thread-stat-value">${formatShortDate(lastEmail.date_received)}</div>
                        <div class="thread-stat-label">Конец</div>
                    </div>
                </div>
                ` : ''}
            </div>
            
            <div class="thread-emails-container">
        `;
        
        emails.forEach((email, idx) => {
            const isActive = activeEmailId && email.id === activeEmailId;
            const isFirst = idx === 0;
            const isLast = idx === emails.length - 1;
            
            const senderDisplay = getSenderDisplay(email);
            const initials = getInitials(senderDisplay);
            const avatarColor = getAvatarColor(senderDisplay);
            const formattedDate = formatEmailDate(email.date_received || email.date);
            const hasAttachments = email.attachments_count > 0;
            
            let badgeText = '';
            let badgeClass = '';
            if (isFirst && emails.length > 1) {
                badgeText = '📤 Первое';
                badgeClass = 'first';
            } else if (isLast) {
                badgeText = '📥 Последнее';
                badgeClass = 'reply';
            } else {
                badgeText = '↩️ Ответ';
                badgeClass = 'reply';
            }
            
            if (isActive) {
                badgeText = '⭐ Текущее';
                badgeClass = 'first';
            }
            
            html += `
                <div class="thread-email-card ${isActive ? 'active' : ''}" data-email-id="${email.id}" onclick="openEmailFromThread(${email.id})">
                    <div class="thread-card-header">
                        <div class="sender-info">
                            <div class="thread-card-avatar" style="background: ${avatarColor};">${initials}</div>
                            <div>
                                <div class="thread-card-sender">${escapeHtml(senderDisplay)}</div>
                                ${email.sender_email ? `<div class="thread-card-email">${escapeHtml(email.sender_email)}</div>` : ''}
                            </div>
                        </div>
                        <div class="thread-card-meta">
                            <span class="thread-card-date">${formattedDate}</span>
                            <span class="thread-card-badge ${badgeClass}">${badgeText}</span>
                        </div>
                    </div>
                    
                    <div class="thread-card-body ${email.body && email.body.length > 200 ? 'has-more' : ''}" id="email-body-${email.id}">
                        ${formatEmailBody(email.body, false)}
                    </div>
                    
                    <div class="thread-card-footer">
                        <div class="thread-card-attachments">
                            ${hasAttachments ? `📎 ${email.attachments_count} влож.` : '📎 Нет вложений'}
                        </div>
                        ${email.body && email.body.length > 200 ? `
                            <button class="thread-card-expand" onclick="event.stopPropagation(); toggleEmailBody(${email.id})">
                                Развернуть ▼
                            </button>
                        ` : ''}
                    </div>
                </div>
                
                ${!isLast ? `
                    <div class="thread-order-indicator">
                        <span class="thread-order-line"></span>
                        <span>↓</span>
                        <span class="thread-order-line"></span>
                    </div>
                ` : ''}
            `;
        });
        
        html += '</div>';
        
        document.getElementById('threadModalBody').innerHTML = html;
        console.log(`✅ Ветка загружена: ${emails.length} писем`);
        
    } catch (error) {
        console.error('❌ Ошибка загрузки ветки:', error);
        document.getElementById('threadModalBody').innerHTML = `
            <div class="error-message show">
                ❌ Не удалось загрузить ветку: ${error.message}
            </div>
        `;
    }
}

function formatShortDate(dateValue) {
    if (!dateValue) return '—';
    try {
        const date = new Date(dateValue);
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    } catch {
        return '—';
    }
}

function getAvatarColor(name) {
    const colors = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#ea580c', '#0891b2'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash = hash & hash;
    }
    return colors[Math.abs(hash) % colors.length];
}

export function closeThreadModal() {
    const modal = document.getElementById('threadModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// Глобальные функции для onclick
window.openEmailFromThread = async function(emailId) {
    closeThreadModal();
    await openEmail(emailId, null);
};

window.toggleEmailBody = function(emailId) {
    const body = document.getElementById(`email-body-${emailId}`);
    const btn = event.target;
    
    if (body.classList.contains('expanded')) {
        body.classList.remove('expanded');
        btn.textContent = 'Развернуть ▼';
    } else {
        body.classList.add('expanded');
        btn.textContent = 'Свернуть ▲';
    }
};

window.closeModal = closeModal;
window.closeThreadModal = closeThreadModal;

console.log('✅ modal.js загружен');
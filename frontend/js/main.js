// main.js - Главный файл инициализации (ИСПРАВЛЕНО)

import { initTabs } from './tabs.js';
import { setupEmailSearch, loadLetters } from './emails.js';
import { setupModalClose, openThreadModal } from './modal.js';
import { setupFilters, applyAdvancedFilters as applyAdvancedFiltersFunc, clearFilters as clearFiltersFunc } from './filters.js';
import { loadPositions, loadDepartments, loadContacts } from './contacts.js';
import { loadStats } from './stats.js';

console.log('🚀 ════════════════════════════════════════════════');
console.log('🚀 Email Manager Pro - инициализация');
console.log('🚀 ════════════════════════════════════════════════');

document.addEventListener('DOMContentLoaded', async () => {
    console.log('✅ DOM загружена, начинаю инициализацию...');
    
    try {
        console.log('🔧 [1/5] Инициализирую модули...');
        initTabs();
        setupModalClose();
        setupEmailSearch();
        setupFilters();
        
        console.log('📥 [2/5] Загружаю данные...');
        await Promise.all([
            loadLetters(),
            loadStats(),
            loadPositions(),
            loadDepartments(),
            loadContacts()
        ]);
        
        console.log('🎨 [3/5] Финализирую UI...');
        displayReadyStatus();
        
        console.log('✅ [4/5] ПОЛНАЯ ИНИЦИАЛИЗАЦИЯ ЗАВЕРШЕНА!');
        
    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА ИНИЦИАЛИЗАЦИИ:', error);
        alert('❌ Ошибка при загрузке приложения. Проверьте консоль браузера (F12).');
    }
});

function displayReadyStatus() {
    console.log('✅ Все модули инициализированы');
    
    const userInfo = document.getElementById('userInfo');
    if (userInfo) {
        userInfo.textContent = '👤 Готов к работе';
        setTimeout(() => {
            userInfo.textContent = '👤 Пользователь';
        }, 3000);
    }
}

window.syncEmails = async function() {
    console.log('🔄 СИНХРОНИЗАЦИЯ НАЧАТА...');
    
    try {
        const response = await fetch('/api/fetch-emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ period: '24h', scan_mode: 'inbox' })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ Синхронизация завершена:', data);
        
        alert(`✅ Синхронизация завершена!\nЗагружено писем: ${data.count || 0}`);
        
        const { loadLetters } = await import('./emails.js');
        await loadLetters();
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error);
        alert(`❌ Ошибка синхронизации:\n${error.message}`);
    }
};

window.clearDB = async function() {
    if (!confirm('⚠️ Это удалит ВСЕ письма! Продолжить?')) {
        return;
    }
    
    if (!confirm('⚠️ ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\nВы уверены? Это действие необратимо!')) {
        return;
    }
    
    console.log('🗑️ ОЧИСТКА БД НАЧАТА...');
    
    try {
        const response = await fetch('/api/clear-db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ БД очищена:', data);
        alert('✅ БД успешно очищена!\nСтраница перезагружается...');
        
        setTimeout(() => location.reload(), 1000);
        
    } catch (error) {
        console.error('❌ Ошибка очистки БД:', error);
        alert(`❌ Ошибка очистки БД:\n${error.message}`);
    }
};

window.performSearch = async function() {
    const query = document.getElementById('searchQuery').value;
    
    if (query.length < 2) {
        alert('🔍 Введите минимум 2 символа для поиска');
        return;
    }
    
    console.log(`🔍 ПОИСК: "${query}"`);
    
    try {
        const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        const { displayEmails } = await import('./emails.js');
        displayEmails(data.emails || [], 'searchResults');
        
        console.log(`✅ Найдено ${data.emails?.length || 0} писем`);
        
    } catch (error) {
        console.error('❌ Ошибка поиска:', error);
        alert(`❌ Ошибка поиска:\n${error.message}`);
    }
};

function setDefaultDates() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    const startInput = document.getElementById('customStartDate');
    const endInput = document.getElementById('customEndDate');
    
    if (startInput) {
        startInput.value = startDate.toISOString().split('T')[0];
    }
    if (endInput) {
        endInput.value = endDate.toISOString().split('T')[0];
    }
}

window.startSync = async function() {
    const period = document.getElementById('syncPeriod')?.value || '24h';
    const mode = document.getElementById('syncMode')?.value || 'inbox';
    
    await performSync('/api/fetch-emails', { period, scan_mode: mode });
};

window.startCustomSync = async function() {
    const startDate = document.getElementById('customStartDate')?.value;
    const endDate = document.getElementById('customEndDate')?.value;
    const mode = document.getElementById('customSyncMode')?.value || 'inbox';
    
    if (!startDate || !endDate) {
        alert('Выберите начальную и конечную дату');
        return;
    }
    
    await performSync('/api/fetch-emails-custom', {
        start_date: startDate,
        end_date: endDate,
        scan_mode: mode
    });
};

async function performSync(url, data) {
    const progressDiv = document.getElementById('syncProgress');
    const statusSpan = document.getElementById('syncStatus');
    const progressBar = document.getElementById('syncProgressBar');
    const resultDiv = document.getElementById('syncResult');
    
    if (progressDiv) {
        progressDiv.style.display = 'block';
        progressBar.style.width = '10%';
    }
    
    if (statusSpan) statusSpan.textContent = 'Подключение к Outlook...';
    
    try {
        if (statusSpan) statusSpan.textContent = 'Чтение писем из Outlook...';
        if (progressBar) progressBar.style.width = '30%';
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (progressBar) progressBar.style.width = '80%';
        
        const result = await response.json();
        
        if (response.ok) {
            if (statusSpan) statusSpan.textContent = '✅ Синхронизация завершена!';
            if (progressBar) progressBar.style.width = '100%';
            
            if (resultDiv) {
                resultDiv.innerHTML = `
                    <div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px;">
                        <strong>✅ Синхронизация успешно завершена!</strong><br>
                        📧 Добавлено писем: ${result.count || 0}<br>
                        ⏭️ Пропущено: ${result.skipped || 0}<br>
                        ⏱️ Время: ${result.duration || 0} сек
                    </div>
                `;
            }
            
            setTimeout(async () => {
                const { loadLetters } = await import('./emails.js');
                await loadLetters();
                const { loadStats } = await import('./stats.js');
                await loadStats();
                await loadSyncLogs();
            }, 1000);
            
        } else {
            throw new Error(result.error || result.message || 'Ошибка синхронизации');
        }
        
    } catch (error) {
        console.error('Sync error:', error);
        
        if (statusSpan) statusSpan.textContent = '❌ Ошибка синхронизации';
        if (progressBar) progressBar.style.width = '100%';
        if (progressBar) progressBar.style.background = '#dc2626';
        
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div style="background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; padding: 15px; border-radius: 8px;">
                    <strong>❌ Ошибка синхронизации</strong><br>
                    ${error.message}<br><br>
                    <small>Убедитесь, что Outlook запущен и вы вошли в систему.</small>
                </div>
            `;
        }
    } finally {
        setTimeout(() => {
            if (progressDiv) progressDiv.style.display = 'none';
            if (progressBar) {
                progressBar.style.width = '0%';
                progressBar.style.background = 'var(--primary)';
            }
        }, 3000);
    }
}

async function loadSyncLogs() {
    try {
        const response = await fetch('/api/sync-logs?limit=10');
        const data = await response.json();
        
        const container = document.getElementById('syncLogsList');
        if (container && data.logs) {
            if (data.logs.length === 0) {
                container.innerHTML = '<div class="stat-row">Нет записей о синхронизации</div>';
                return;
            }
            
            container.innerHTML = data.logs.map(log => {
                const statusIcon = log.status === 'success' ? '✅' : '❌';
                const date = new Date(log.sync_date).toLocaleString('ru-RU');
                
                return `
                    <div class="stat-row">
                        <div>${statusIcon} ${date}</div>
                        <div>
                            <strong>+${log.emails_added || 0}</strong> писем
                            ${log.duration_seconds ? `(${log.duration_seconds}с)` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (error) {
        console.error('Error loading sync logs:', error);
    }
}

window.applyAdvancedFilters = async function() {
    console.log('🔎 ПРИМЕНЕНИЕ ПРОДВИНУТЫХ ФИЛЬТРОВ...');
    try {
        await applyAdvancedFiltersFunc();
    } catch (error) {
        console.error('❌ Ошибка применения фильтров:', error);
        alert(`❌ Ошибка применения фильтров:\n${error.message}`);
    }
};

window.clearFilters = async function() {
    console.log('🔄 ОЧИСТКА ФИЛЬТРОВ...');
    try {
        await clearFiltersFunc();
    } catch (error) {
        console.error('❌ Ошибка очистки фильтров:', error);
        alert(`❌ Ошибка очистки фильтров:\n${error.message}`);
    }
};

setDefaultDates();
loadSyncLogs();

console.log('✅ main.js загружен и готов к работе');
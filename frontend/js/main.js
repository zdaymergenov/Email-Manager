// main.js - Главный файл инициализации (упрощенный)

import { initTabs } from './tabs.js';
import { setupEmailSearch, loadLetters } from './emails.js';
import { setupModalClose } from './modal.js';
import { setupFilters, clearAllFilters as clearAllFiltersFunc } from './filters.js';
import { loadPositions, loadDepartments, loadContacts } from './contacts.js';

console.log('🚀 ════════════════════════════════════════════════');
console.log('🚀 Email Manager Pro - инициализация');
console.log('🚀 ════════════════════════════════════════════════');

document.addEventListener('DOMContentLoaded', async () => {
    console.log('✅ DOM загружена, начинаю инициализацию...');
    
    try {
        console.log('🔧 [1/3] Инициализирую модули...');
        initTabs();
        setupModalClose();
        setupEmailSearch();
        setupFilters();
        
        console.log('📥 [2/3] Загружаю опции и данные...');
        // Сначала контакты (нужно для опций фильтров)
        await Promise.all([
            loadPositions(),
            loadDepartments(),
            loadContacts()
        ]);
        
        // Потом письма (через filters.applyAllFilters)
        await loadLetters();
        
        console.log('🎨 [3/3] Финализирую UI...');
        displayReadyStatus();
        setDefaultDates();
        loadSyncLogs();
        
        console.log('✅ ИНИЦИАЛИЗАЦИЯ ЗАВЕРШЕНА!');
        
    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА ИНИЦИАЛИЗАЦИИ:', error);
        alert('❌ Ошибка при загрузке приложения. Проверьте консоль браузера (F12).');
    }
});

function displayReadyStatus() {
    // Получаем данные пользователя и применяем роле-зависимую видимость
    fetch('/api/me').then(r => r.json()).then(user => {
        const userInfo = document.getElementById('userInfo');
        if (userInfo) userInfo.textContent = `👤 ${user.full_name || user.username}`;

        // Скрываем вкладки только для admin если роль employee
        if (user.role !== 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => {
                el.style.display = 'none';
            });
        }
    }).catch(() => {
        const userInfo = document.getElementById('userInfo');
        if (userInfo) userInfo.textContent = '👤 Пользователь';
    });
}

// ==================== СБРОС ВСЕХ ФИЛЬТРОВ ====================

window.clearAllFilters = async function() {
    console.log('🔄 СБРОС ВСЕХ ФИЛЬТРОВ...');
    try {
        await clearAllFiltersFunc();
    } catch (error) {
        console.error('❌ Ошибка сброса фильтров:', error);
    }
};

// ==================== СИНХРОНИЗАЦИЯ ====================

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

async function loadSyncLogs() {
    try {
        const response = await fetch('/api/sync-logs?limit=10');
        const data = await response.json();
        
        const container = document.getElementById('syncLogsList');
        if (container && data.logs) {
            if (data.logs.length === 0) {
                container.innerHTML = '<div style="padding: 10px; color: #666;">Нет записей о синхронизации</div>';
                return;
            }
            
            container.innerHTML = data.logs.map(log => {
                const statusIcon = log.status === 'success' ? '✅' : '❌';
                const date = new Date(log.sync_date).toLocaleString('ru-RU');
                
                return `
                    <div style="display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid var(--border);">
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

// ==================== УПРАВЛЕНИЕ КОНТАКТАМИ ====================

/**
 * Загружает статистику контактов
 */
async function loadContactsStats() {
    try {
        const response = await fetch('/api/contacts/stats');
        const stats = await response.json();
        
        document.getElementById('contactsTotal').textContent = stats.total || 0;
        document.getElementById('contactsPositions').textContent = stats.positions || 0;
        document.getElementById('contactsDepartments').textContent = stats.departments || 0;
    } catch (error) {
        console.error('❌ Ошибка загрузки статистики контактов:', error);
    }
}

/**
 * Загрузить контакты из XLSX файла
 */
window.uploadContacts = async function() {
    const fileInput = document.getElementById('contactsFile');
    const clearCheckbox = document.getElementById('clearExistingContacts');
    const resultDiv = document.getElementById('contactsUploadResult');
    
    if (!fileInput.files || fileInput.files.length === 0) {
        alert('Выберите файл XLSX');
        return;
    }
    
    const file = fileInput.files[0];
    const clearExisting = clearCheckbox.checked;
    
    // Подтверждение если нужно очистить
    if (clearExisting) {
        if (!confirm('⚠️ Все существующие контакты будут УДАЛЕНЫ перед загрузкой. Продолжить?')) {
            return;
        }
    }
    
    resultDiv.innerHTML = `
        <div style="background: #e0f2fe; padding: 12px; border-radius: 6px; margin-top: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div class="spinner" style="width: 16px; height: 16px; border: 2px solid #cbd5e1; border-top-color: #0ea5e9; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <span>📤 Загружаю файл...</span>
            </div>
        </div>
    `;
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('clear_existing', clearExisting ? 'true' : 'false');
        
        const response = await fetch('/api/contacts/upload', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            resultDiv.innerHTML = `
                <div style="background: #d1fae5; border: 1px solid #6ee7b7; padding: 15px; border-radius: 6px; margin-top: 10px;">
                    <strong style="color: #065f46;">✅ Контакты успешно загружены!</strong>
                    <div style="margin-top: 8px; color: #047857;">
                        📥 Добавлено: <strong>${result.added}</strong><br>
                        ⏭️ Пропущено (без email): <strong>${result.skipped}</strong><br>
                        ❌ Ошибок: <strong>${result.errors}</strong><br>
                        💼 Должностей в БД: <strong>${result.positions}</strong><br>
                        🏢 Отделов в БД: <strong>${result.departments}</strong>
                    </div>
                </div>
            `;
            
            // Обновляем статистику и фильтры
            await loadContactsStats();
            
            // Перезагружаем опции фильтров на главной
            const { setupFilters } = await import('./filters.js');
            // Пересоздаём список опций
            window.location.reload();
        } else {
            resultDiv.innerHTML = `
                <div style="background: #fee2e2; border: 1px solid #fca5a5; padding: 15px; border-radius: 6px; margin-top: 10px;">
                    <strong style="color: #991b1b;">❌ Ошибка загрузки</strong><br>
                    <span style="color: #b91c1c;">${result.error || 'Неизвестная ошибка'}</span>
                </div>
            `;
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки:', error);
        resultDiv.innerHTML = `
            <div style="background: #fee2e2; border: 1px solid #fca5a5; padding: 15px; border-radius: 6px; margin-top: 10px;">
                <strong style="color: #991b1b;">❌ Ошибка</strong><br>
                <span style="color: #b91c1c;">${error.message}</span>
            </div>
        `;
    }
};

/**
 * Удалить все контакты
 */
window.clearContacts = async function() {
    if (!confirm('⚠️ Это удалит ВСЕ контакты! Продолжить?')) return;
    if (!confirm('⚠️ ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ! Действие необратимо!')) return;
    
    try {
        const response = await fetch('/api/contacts/clear', {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            alert(`✅ Удалено ${result.deleted} контактов`);
            await loadContactsStats();
            window.location.reload();
        } else {
            alert('❌ Ошибка очистки');
        }
    } catch (error) {
        console.error('❌ Ошибка:', error);
        alert(`❌ Ошибка: ${error.message}`);
    }
};

console.log('✅ main.js загружен и готов к работе');

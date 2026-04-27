// filters.js - Фильтрация писем через REST API v2
// С поддержкой пагинации и выбора количества писем на странице

import { displayEmails } from './emails.js';

// Активные фильтры
let activeFilters = {
    position: null,
    department: null,
    folder: null,
    period: null,        // дни (число)
    status: null,        // 'unread' | 'read'
    attachments: null    // 'yes' | 'no'
};

// Состояние пагинации
let currentPage = 1;
let perPage = 50;
let totalEmails = 0;
let totalPages = 1;

/**
 * Инициализация всех фильтров
 */
export function setupFilters() {
    console.log('🔎 Инициализирую фильтры (v2)...');
    
    // Селекторы для всех фильтров
    const filters = {
        filterPosition: 'position',
        filterDepartment: 'department',
        filterFolder: 'folder',
        filterPeriod: 'period',
        filterStatus: 'status',
        filterAttachments: 'attachments'
    };
    
    // Привязываем events к каждому фильтру
    Object.entries(filters).forEach(([elementId, filterKey]) => {
        const element = document.getElementById(elementId);
        if (element) {
            element.addEventListener('change', (e) => {
                activeFilters[filterKey] = e.target.value || null;
                currentPage = 1; // Сбрасываем на первую страницу при изменении фильтра
                applyAllFilters();
            });
        }
    });
    
    // Селект количества писем на странице
    const perPageSelect = document.getElementById('perPageSelect');
    if (perPageSelect) {
        perPage = parseInt(perPageSelect.value) || 50;
        perPageSelect.addEventListener('change', (e) => {
            perPage = parseInt(e.target.value) || 50;
            currentPage = 1; // Сбрасываем на первую страницу
            applyAllFilters();
        });
    }
    
    // Загружаем должности и отделы
    loadFilterOptions();
    
    console.log('✅ Фильтры инициализированы');
}

/**
 * Загружает должности, отделы и папки в выпадашки из БД
 */
async function loadFilterOptions() {
    try {
        // Загружаем все опции параллельно
        const [positionsRes, departmentsRes, foldersRes] = await Promise.all([
            fetch('/api/positions'),
            fetch('/api/departments'),
            fetch('/api/folders')
        ]);
        
        const positionsData = await positionsRes.json();
        const departmentsData = await departmentsRes.json();
        const foldersData = await foldersRes.json();
        
        // Должности
        const positionSelect = document.getElementById('filterPosition');
        if (positionSelect && positionsData.positions) {
            // Очищаем все кроме первой опции
            while (positionSelect.options.length > 1) positionSelect.remove(1);
            
            positionsData.positions.forEach(pos => {
                const option = document.createElement('option');
                option.value = pos;
                option.textContent = pos;
                positionSelect.appendChild(option);
            });
            console.log(`✅ Загружено ${positionsData.positions.length} должностей`);
        }
        
        // Отделы
        const departmentSelect = document.getElementById('filterDepartment');
        if (departmentSelect && departmentsData.departments) {
            while (departmentSelect.options.length > 1) departmentSelect.remove(1);
            
            departmentsData.departments.forEach(dep => {
                const option = document.createElement('option');
                option.value = dep;
                option.textContent = dep;
                departmentSelect.appendChild(option);
            });
            console.log(`✅ Загружено ${departmentsData.departments.length} отделов`);
        }
        
        // Папки (с количеством писем)
        const folderSelect = document.getElementById('filterFolder');
        if (folderSelect && foldersData.folders) {
            while (folderSelect.options.length > 1) folderSelect.remove(1);
            
            // Иконки для известных папок
            const folderIcons = {
                'Входящие': '📥',
                'Inbox': '📥',
                'Отправленные': '📤',
                'Sent Items': '📤',
                'Sent': '📤',
                'Черновики': '📝',
                'Drafts': '📝',
                'Спам': '🚫',
                'Junk Email': '🚫',
                'Junk': '🚫',
                'Удаленные': '🗑️',
                'Deleted Items': '🗑️',
                'Архив': '📦',
                'Archive': '📦'
            };
            
            foldersData.folders.forEach(item => {
                const folder = item.folder;
                const count = item.count;
                const icon = folderIcons[folder] || '📁';
                
                const option = document.createElement('option');
                option.value = folder;
                option.textContent = `${icon} ${folder} (${count})`;
                folderSelect.appendChild(option);
            });
            console.log(`✅ Загружено ${foldersData.folders.length} папок`);
        }
        
        console.log('✅ Все опции фильтров загружены');
    } catch (error) {
        console.error('❌ Ошибка загрузки опций:', error);
    }
}

/**
 * Применяет все активные фильтры через API
 */
export async function applyAllFilters() {
    console.log(`🔎 Применяю фильтры (стр. ${currentPage}, по ${perPage}):`, activeFilters);
    
    try {
        // Проверяем, есть ли хоть один активный фильтр
        const hasActiveFilter = Object.values(activeFilters).some(v => v !== null && v !== '');
        
        let result;
        
        if (!hasActiveFilter) {
            // Нет фильтров - получаем все письма через стандартный API
            const response = await fetch(`/api/emails?page=${currentPage}&per_page=${perPage}`);
            const data = await response.json();
            
            result = {
                emails: data.emails || [],
                total: data.total || 0,
                page: currentPage,
                pages: data.pages || 1
            };
        } else {
            // Есть фильтры - используем фильтр API
            const filterConfig = buildFilterConfig();
            
            const response = await fetch('/api/filters/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filter_config: filterConfig,
                    page: currentPage,
                    per_page: perPage
                })
            });
            
            const data = await response.json();
            
            if (data.success && data.data) {
                result = data.data;
            } else {
                console.error('❌ Ошибка API:', data.error);
                return;
            }
        }
        
        // Обновляем состояние пагинации
        totalEmails = result.total;
        totalPages = result.pages;
        
        // Отображаем письма
        displayEmails(result.emails, 'lettersList');
        
        // Обновляем счётчик и пагинацию
        updateResultsCount(result.emails.length);
        updatePagination();
        updateActiveFiltersTags();
        
        console.log(`✅ Стр. ${currentPage}/${totalPages}: ${result.emails.length} из ${totalEmails}`);
        
    } catch (error) {
        console.error('❌ Ошибка применения фильтров:', error);
    }
}

/**
 * Преобразует локальный формат в API формат
 */
function buildFilterConfig() {
    const config = {};
    
    if (activeFilters.position) config.position = activeFilters.position;
    if (activeFilters.department) config.department = activeFilters.department;
    if (activeFilters.folder) config.folder = activeFilters.folder;
    
    // Период (дни назад) - включая 0 (сегодня)
    if (activeFilters.period !== null && activeFilters.period !== '') {
        config.date_range_days = parseInt(activeFilters.period);
    }
    
    // Статус прочтения
    if (activeFilters.status === 'unread') {
        config.unread_only = true;
    } else if (activeFilters.status === 'read') {
        config.read_only = true;
    }
    
    // Вложения
    if (activeFilters.attachments === 'yes') {
        config.has_attachments = true;
    } else if (activeFilters.attachments === 'no') {
        config.no_attachments = true;
    }
    
    return config;
}

/**
 * Обновляет отображение количества найденных писем
 */
function updateResultsCount(shownCount) {
    const totalEl = document.getElementById('emailsCountTotal');
    const shownEl = document.getElementById('emailsCountShown');
    
    if (totalEl) totalEl.textContent = totalEmails;
    
    if (shownEl) {
        if (totalEmails > shownCount) {
            shownEl.textContent = `(показано ${shownCount})`;
        } else {
            shownEl.textContent = '';
        }
    }
}

/**
 * Обновляет пагинацию
 */
function updatePagination() {
    const container = document.getElementById('pagination');
    if (!container) return;
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Кнопка "Первая"
    html += `<button onclick="goToPage(1)" ${currentPage === 1 ? 'disabled' : ''} title="Первая">«</button>`;
    
    // Кнопка "Назад"
    html += `<button onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} title="Назад">‹</button>`;
    
    // Номера страниц (показываем до 7 страниц рядом)
    const maxButtons = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    if (startPage > 1) {
        html += `<button onclick="goToPage(1)">1</button>`;
        if (startPage > 2) {
            html += `<span class="pagination-info">...</span>`;
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button onclick="goToPage(${i})" class="${i === currentPage ? 'active' : ''}">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<span class="pagination-info">...</span>`;
        }
        html += `<button onclick="goToPage(${totalPages})">${totalPages}</button>`;
    }
    
    // Кнопка "Вперёд"
    html += `<button onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} title="Вперёд">›</button>`;
    
    // Кнопка "Последняя"
    html += `<button onclick="goToPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''} title="Последняя">»</button>`;
    
    // Информация
    html += `<span class="pagination-info">Стр. ${currentPage} из ${totalPages}</span>`;
    
    container.innerHTML = html;
}

/**
 * Перейти на конкретную страницу
 */
window.goToPage = function(page) {
    if (page < 1 || page > totalPages || page === currentPage) return;
    currentPage = page;
    applyAllFilters();
    
    // Прокрутка вверх к списку писем
    document.getElementById('lettersList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/**
 * Обновляет теги активных фильтров
 */
function updateActiveFiltersTags() {
    const container = document.getElementById('activeFiltersTags');
    if (!container) return;
    
    const tags = [];
    
    // Маппинг человекочитаемых названий
    const labels = {
        position: '💼',
        department: '🏢',
        folder: '📁',
        period: '📅',
        status: '📌',
        attachments: '📎'
    };
    
    const periodLabels = {
        '0': 'Сегодня',
        '7': 'За неделю',
        '30': 'За месяц',
        '90': 'За 3 месяца',
        '365': 'За год'
    };
    
    const statusLabels = {
        'unread': 'Непрочитанные',
        'read': 'Прочитанные'
    };
    
    const attachmentsLabels = {
        'yes': 'С вложениями',
        'no': 'Без вложений'
    };
    
    // Создаем теги
    Object.entries(activeFilters).forEach(([key, value]) => {
        if (value === null || value === '') return;
        
        let displayValue = value;
        if (key === 'period') displayValue = periodLabels[value] || value;
        if (key === 'status') displayValue = statusLabels[value] || value;
        if (key === 'attachments') displayValue = attachmentsLabels[value] || value;
        
        tags.push({
            key: key,
            label: labels[key] || '',
            value: displayValue
        });
    });
    
    if (tags.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = tags.map(tag => `
        <span class="filter-tag">
            ${tag.label} ${tag.value}
            <span class="filter-tag-close" onclick="window.removeFilter('${tag.key}')">✕</span>
        </span>
    `).join('');
}

/**
 * Удаляет конкретный фильтр (вызывается из тегов)
 */
window.removeFilter = function(key) {
    activeFilters[key] = null;
    
    const elementMap = {
        position: 'filterPosition',
        department: 'filterDepartment',
        folder: 'filterFolder',
        period: 'filterPeriod',
        status: 'filterStatus',
        attachments: 'filterAttachments'
    };
    
    const select = document.getElementById(elementMap[key]);
    if (select) select.value = '';
    
    currentPage = 1;
    applyAllFilters();
};

/**
 * Сбрасывает ВСЕ фильтры
 */
export async function clearAllFilters() {
    console.log('🔄 Сброс всех фильтров...');
    
    // Сбрасываем локальное состояние
    activeFilters = {
        position: null,
        department: null,
        folder: null,
        period: null,
        status: null,
        attachments: null
    };
    
    // Сбрасываем пагинацию
    currentPage = 1;
    
    // Сбрасываем все select элементы
    const selectIds = [
        'filterPosition',
        'filterDepartment',
        'filterFolder',
        'filterPeriod',
        'filterStatus',
        'filterAttachments'
    ];
    
    selectIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = '';
    });
    
    // Очищаем поле поиска
    const searchInput = document.getElementById('letterSearch');
    if (searchInput) searchInput.value = '';
    
    // Очищаем теги
    const tagsContainer = document.getElementById('activeFiltersTags');
    if (tagsContainer) tagsContainer.innerHTML = '';
    
    // Загружаем все письма
    await applyAllFilters();
    
    console.log('✅ Все фильтры сброшены');
}

/**
 * Получить текущие активные фильтры
 */
export function getActiveFilters() {
    return { ...activeFilters };
}

/**
 * Получить состояние пагинации
 */
export function getPaginationState() {
    return { currentPage, perPage, totalEmails, totalPages };
}

console.log('✅ filters.js загружен (v2 - с пагинацией и счётчиком)');

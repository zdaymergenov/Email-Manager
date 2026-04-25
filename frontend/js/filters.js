// filters.js - Фильтрация писем (ИСПРАВЛЕНО)

import * as api from './api.js';
import { displayEmails } from './emails.js';

let activeFilters = {
    position: null,
    department: null,
    folder: null,
    unread: false,
    with_attachments: false
};

export function setupFilters() {
    console.log('🔎 Инициализирую фильтры...');
    
    const filterPosition = document.getElementById('filterPosition');
    const filterDepartment = document.getElementById('filterDepartment');
    const filterFolder = document.getElementById('filterFolder');
    
    if (filterPosition) {
        filterPosition.addEventListener('change', (e) => {
            activeFilters.position = e.target.value || null;
            applyFiltersToLetters();
        });
    }
    
    if (filterDepartment) {
        filterDepartment.addEventListener('change', (e) => {
            activeFilters.department = e.target.value || null;
            applyFiltersToLetters();
        });
    }
    
    if (filterFolder) {
        filterFolder.addEventListener('change', (e) => {
            activeFilters.folder = e.target.value || null;
            applyFiltersToLetters();
        });
    }
    
    console.log('✅ Фильтры инициализированы');
}

export async function applyFiltersToLetters() {
    console.log('🔎 Применяю фильтры к письмам:', activeFilters);
    
    try {
        const hasActiveFilter = activeFilters.position || activeFilters.department || activeFilters.folder;
        
        if (!hasActiveFilter) {
            const { loadLetters } = await import('./emails.js');
            loadLetters();
            return;
        }
        
        const response = await fetch('/api/emails?per_page=200');
        const data = await response.json();
        let filteredEmails = data.emails || [];
        
        filteredEmails = filterEmails(filteredEmails, activeFilters);
        
        displayEmails(filteredEmails, 'lettersList');
        console.log(`✅ Отфильтровано писем: ${filteredEmails.length}`);
        
    } catch (error) {
        console.error('❌ Ошибка при применении фильтров:', error);
    }
}

export async function applyAdvancedFilters() {
    console.log('🔎 Применяю продвинутые фильтры...');
    
    try {
        const position = document.querySelector('input[name="position"]:checked')?.value;
        const department = document.querySelector('input[name="department"]:checked')?.value;
        const folder = document.querySelector('input[name="folder"]:checked')?.value;
        
        const response = await fetch('/api/emails?per_page=200');
        const data = await response.json();
        let filteredEmails = data.emails || [];
        
        const filters = { position, department, folder };
        filteredEmails = filterEmails(filteredEmails, filters);
        
        displayEmails(filteredEmails, 'filteredResults');
        
        const activeCount = [position, department, folder].filter(Boolean).length;
        console.log(`✅ Применены ${activeCount} фильтров, найдено ${filteredEmails.length} писем`);
        
    } catch (error) {
        console.error('❌ Ошибка при применении фильтров:', error);
    }
}

export function filterEmails(emails, filters) {
    return emails.filter(email => {
        if (filters.position && !matchesPosition(email, filters.position)) {
            return false;
        }
        
        if (filters.department && !matchesDepartment(email, filters.department)) {
            return false;
        }
        
        if (filters.folder && email.folder !== filters.folder) {
            return false;
        }
        
        if (filters.unread && email.is_read) {
            return false;
        }
        
        if (filters.with_attachments && !email.attachments_count) {
            return false;
        }
        
        return true;
    });
}

function matchesPosition(email, position) {
    return true;
}

function matchesDepartment(email, department) {
    return true;
}

export function getActiveFilters() {
    return activeFilters;
}

export async function clearFilters() {
    console.log('🔄 Очищаю фильтры...');
    
    activeFilters = {
        position: null,
        department: null,
        folder: null,
        unread: false,
        with_attachments: false
    };
    
    const filterPosition = document.getElementById('filterPosition');
    const filterDepartment = document.getElementById('filterDepartment');
    const filterFolder = document.getElementById('filterFolder');
    
    if (filterPosition) filterPosition.value = '';
    if (filterDepartment) filterDepartment.value = '';
    if (filterFolder) filterFolder.value = '';
    
    document.querySelectorAll('input[name="position"]').forEach(el => el.checked = false);
    document.querySelectorAll('input[name="department"]').forEach(el => el.checked = false);
    document.querySelectorAll('input[name="folder"]').forEach(el => el.checked = false);
    
    const { loadLetters } = await import('./emails.js');
    loadLetters();
    
    console.log('✅ Фильтры очищены');
}

console.log('✅ filters.js загружен');
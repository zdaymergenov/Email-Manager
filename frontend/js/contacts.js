// contacts.js - Работа с контактами (ОБНОВЛЕНО ШАГ 6️⃣)

import * as api from './api.js';

let allContacts = [];
let allPositions = [];
let allDepartments = [];

export async function loadContacts() {
    try {
        console.log('📇 Загружаю контакты...');
        const data = await api.fetchContacts();
        allContacts = data.contacts || [];
        console.log(`✅ Загружено ${allContacts.length} контактов`);
        return allContacts;
    } catch (error) {
        console.error('❌ Ошибка загрузки контактов:', error);
        return [];
    }
}

export async function loadPositions() {
    try {
        console.log('💼 Загружаю должности...');
        const data = await api.fetchPositions();
        allPositions = data.positions || [];
        console.log(`✅ Загружено ${allPositions.length} должностей`);
        populatePositionFilter(allPositions);
        return allPositions;
    } catch (error) {
        console.error('❌ Ошибка загрузки должностей:', error);
        return [];
    }
}

export async function loadDepartments() {
    try {
        console.log('🏢 Загружаю отделы...');
        const data = await api.fetchDepartments();
        allDepartments = data.departments || [];
        console.log(`✅ Загружено ${allDepartments.length} отделов`);
        populateDepartmentFilter(allDepartments);
        return allDepartments;
    } catch (error) {
        console.error('❌ Ошибка загрузки отделов:', error);
        return [];
    }
}

export function populatePositionFilter(positions) {
    const select = document.getElementById('filterPosition');
    const filterList = document.getElementById('positionFilterList');
    
    if (!select && !filterList) return;
    
    if (select) {
        select.innerHTML = '<option value="">Все должности</option>';
        positions.forEach(position => {
            const option = document.createElement('option');
            option.value = position;
            option.textContent = position;
            select.appendChild(option);
        });
    }
    
    if (filterList) {
        filterList.innerHTML = '';
        positions.forEach(position => {
            const label = document.createElement('label');
            label.className = 'filter-checkbox';
            label.innerHTML = `
                <input type="radio" name="position" value="${position}">
                💼 ${position}
            `;
            filterList.appendChild(label);
        });
    }
}

export function populateDepartmentFilter(departments) {
    const select = document.getElementById('filterDepartment');
    const filterList = document.getElementById('departmentFilterList');
    
    if (!select && !filterList) return;
    
    if (select) {
        select.innerHTML = '<option value="">Все отделы</option>';
        departments.forEach(department => {
            const option = document.createElement('option');
            option.value = department;
            option.textContent = department;
            select.appendChild(option);
        });
    }
    
    if (filterList) {
        filterList.innerHTML = '';
        departments.forEach(department => {
            const label = document.createElement('label');
            label.className = 'filter-checkbox';
            label.innerHTML = `
                <input type="radio" name="department" value="${department}">
                🏢 ${department}
            `;
            filterList.appendChild(label);
        });
    }
}

export function getContactByEmail(email) {
    return allContacts.find(c => c.email === email.toLowerCase());
}

export function getAllContacts() {
    return allContacts;
}

export function getAllPositions() {
    return allPositions;
}

export function getAllDepartments() {
    return allDepartments;
}

console.log('✅ contacts.js загружен');

// api.js - Все API запросы

/**
 * Получить письма с пагинацией
 */
export async function fetchEmails(page = 1, perPage = 50) {
    try {
        const response = await fetch(`/api/emails?page=${page}&per_page=${perPage}`);
        if (!response.ok) throw new Error('Ошибка загрузки писем');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { emails: [], total: 0 };
    }
}

/**
 * Получить одно письмо
 */
export async function fetchEmail(emailId) {
    try {
        const response = await fetch(`/api/email/${emailId}`);
        if (!response.ok) throw new Error('Ошибка загрузки письма');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return null;
    }
}

/**
 * Поиск писем
 */
export async function searchEmails(query, page = 1) {
    try {
        const response = await fetch(`/api/search?query=${encodeURIComponent(query)}&page=${page}&per_page=50`);
        if (!response.ok) throw new Error('Ошибка поиска');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { emails: [] };
    }
}

/**
 * Получить ветку письма
 */
export async function fetchThread(threadId) {
    try {
        const response = await fetch(`/api/thread/${threadId}`);
        if (!response.ok) throw new Error('Ошибка загрузки ветки');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { emails: [] };
    }
}

/**
 * Получить статистику
 */
export async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        if (!response.ok) throw new Error('Ошибка загрузки статистики');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return {};
    }
}

/**
 * Получить контакты
 */
export async function fetchContacts() {
    try {
        const response = await fetch('/api/contacts');
        if (!response.ok) throw new Error('Ошибка загрузки контактов');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { contacts: [] };
    }
}

/**
 * Получить должности
 */
export async function fetchPositions() {
    try {
        const response = await fetch('/api/positions');
        if (!response.ok) throw new Error('Ошибка загрузки должностей');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { positions: [] };
    }
}

/**
 * Получить отделы (ДОБАВЛЕНО!)
 */
export async function fetchDepartments() {
    try {
        const response = await fetch('/api/departments');
        if (!response.ok) throw new Error('Ошибка загрузки отделов');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { departments: [] };
    }
}

/**
 * Синхронизировать письма
 */
export async function syncEmails(period = '24h', mode = 'inbox') {
    try {
        const response = await fetch('/api/fetch-emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ period, scan_mode: mode })
        });
        if (!response.ok) throw new Error('Ошибка синхронизации');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { error: error.message };
    }
}
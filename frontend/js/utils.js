// utils.js - Утилиты и вспомогательные функции

/**
 * Получить инициалы из имени
 */
export function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

/**
 * Получить цвет для аватары
 */
export function getAvatarColor(index) {
    const colors = [
        'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
        'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
        'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
        'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
        'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
        'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)',
    ];
    return colors[index % colors.length];
}

/**
 * Форматировать дату
 * Поддерживает форматы:
 *   - "26.04.2026 14:30" (русский формат из БД)
 *   - "2026-04-26T14:30:00" (ISO)
 *   - "2026-04-26 14:30:00" (SQL)
 */
export function formatDate(dateStr) {
    if (!dateStr) return '';
    
    // Если строка уже в русском формате - возвращаем как есть
    // Формат: "DD.MM.YYYY HH:MM" или "DD.MM.YYYY"
    const russianFormat = /^\d{2}\.\d{2}\.\d{4}(\s\d{2}:\d{2})?$/;
    if (russianFormat.test(dateStr)) {
        return dateStr;
    }
    
    // Пробуем парсить как ISO/SQL дату
    let date = new Date(dateStr);
    
    // Если "Invalid Date" - пробуем заменить пробел на T (для SQL формата)
    if (isNaN(date.getTime()) && typeof dateStr === 'string') {
        date = new Date(dateStr.replace(' ', 'T'));
    }
    
    // Если все еще невалидно - возвращаем исходную строку
    if (isNaN(date.getTime())) {
        return dateStr;
    }
    
    return date.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Обрезать текст
 */
export function truncateText(text, length = 100) {
    if (!text) return '';
    return text.length > length ? text.substring(0, length) + '...' : text;
}

/**
 * Показать ошибку
 */
export function showError(message) {
    console.error('❌ Ошибка:', message);
    alert(`❌ ${message}`);
}

/**
 * Показать успех
 */
export function showSuccess(message) {
    console.log('✅ Успех:', message);
    alert(`✅ ${message}`);
}

/**
 * Ждать (delay)
 */
export function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

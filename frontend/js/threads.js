// threads.js - Работа с темами и ветками

import * as api from './api.js';

export async function loadThreads() {
    try {
        const data = await api.fetchEmails(1, 50);
        const threaded = data.emails.filter(e => e.thread_id);
        console.log(`📊 Найдено ${threaded.length} писем в ветках`);
        return threaded;
    } catch (error) {
        console.error('Ошибка загрузки веток:', error);
        return [];
    }
}

export function groupByThread(emails) {
    const threads = {};
    
    emails.forEach(email => {
        if (email.thread_id) {
            if (!threads[email.thread_id]) {
                threads[email.thread_id] = [];
            }
            threads[email.thread_id].push(email);
        }
    });
    
    return threads;
}

export function getThreadStats(threads) {
    return {
        total: Object.keys(threads).length,
        emailCount: Object.values(threads).reduce((sum, t) => sum + t.length, 0)
    };
}

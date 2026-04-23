// stats.js - Загрузка и отображение статистики

import * as api from './api.js';

export async function loadStats() {
    try {
        const stats = await api.fetchStats();
        
        // Карточки статистики
        document.getElementById('statCards').innerHTML = `
            <div class="stat-card">
                <div class="stat-label">Всего писем</div>
                <div class="stat-value">${stats.total || 0}</div>
            </div>
            <div class="stat-card success">
                <div class="stat-label">Веток</div>
                <div class="stat-value">${stats.thread_count || 0}</div>
            </div>
            <div class="stat-card danger">
                <div class="stat-label">Папок</div>
                <div class="stat-value">${Object.keys(stats.folders || {}).length}</div>
            </div>
            <div class="stat-card info">
                <div class="stat-label">Размер БД</div>
                <div class="stat-value">${stats.total_size_mb || 0} МБ</div>
            </div>
        `;
        
        // По папкам
        const folderStats = Object.entries(stats.folders || {})
            .map(([folder, count]) => `
                <div class="stat-row">
                    <div>📁 ${folder}</div>
                    <strong>${count}</strong>
                </div>
            `)
            .join('');
        document.getElementById('folderStats').innerHTML = folderStats;
        
        // Топ отправителей
        const senderStats = (stats.top_senders || [])
            .map(sender => `
                <div class="stat-row">
                    <div>👤 ${sender.name}</div>
                    <strong>${sender.count}</strong>
                </div>
            `)
            .join('');
        document.getElementById('senderStats').innerHTML = senderStats;
        
        console.log('✅ Статистика загружена');
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

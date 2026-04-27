// filter-manager.js - Управление сохраненными фильтрами
/**
 * Filter Manager - управление, применение и удаление сохраненных фильтров
 */

class FilterManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.filters = [];
        this.currentFilter = null;
        this.init();
    }

    async init() {
        await this.loadFilters();
        this.render();
    }

    async loadFilters(favoritesOnly = false) {
        try {
            const url = favoritesOnly 
                ? '/api/filters/saved?favorites_only=true'
                : '/api/filters/saved';
            
            const response = await fetch(url);
            const data = await response.json();
            this.filters = data.filters || [];
        } catch (error) {
            console.error('Error loading filters:', error);
            this.filters = [];
        }
    }

    render() {
        const html = `
            <div class="filter-manager">
                <div class="filter-manager-header">
                    <h3>📋 Мои фильтры</h3>
                    <div class="filter-manager-controls">
                        <button onclick="filterManager.loadFilters()" class="btn btn-small">
                            ↻ Обновить
                        </button>
                        <button onclick="filterManager.showFavoritesOnly()" class="btn btn-small">
                            ⭐ Избранные
                        </button>
                    </div>
                </div>

                <div class="filter-list" id="filterList">
                    ${this.renderFilterList()}
                </div>

                <div class="filter-actions" id="filterActions" style="display: none;">
                    <div class="filter-details" id="filterDetails"></div>
                </div>
            </div>
        `;

        this.container.innerHTML = html;
        window.filterManager = this;
        this.attachEventListeners();
    }

    renderFilterList() {
        if (this.filters.length === 0) {
            return '<div class="empty-state">Нет сохраненных фильтров</div>';
        }

        return `
            <div class="filter-items">
                ${this.filters.map(filter => `
                    <div class="filter-item" data-filter-id="${filter.id}">
                        <div class="filter-item-header">
                            <div class="filter-item-title">
                                ${filter.is_favorite ? '⭐' : '○'} 
                                <strong>${filter.name}</strong>
                            </div>
                            <div class="filter-item-meta">
                                <span class="usage-count">
                                    Использован ${filter.usage_count} раз
                                </span>
                                ${filter.last_used ? `
                                    <span class="last-used">
                                        Последний раз: ${new Date(filter.last_used).toLocaleDateString()}
                                    </span>
                                ` : ''}
                            </div>
                        </div>
                        <div class="filter-item-description">
                            ${filter.description || 'Без описания'}
                        </div>
                        <div class="filter-item-config">
                            ${this.renderFilterConfig(filter.filter_config)}
                        </div>
                        <div class="filter-item-buttons">
                            <button onclick="filterManager.applyFilter(${filter.id})" 
                                    class="btn btn-small btn-primary">
                                ▶ Применить
                            </button>
                            <button onclick="filterManager.toggleFavorite(${filter.id})" 
                                    class="btn btn-small btn-default">
                                ${filter.is_favorite ? '★ Убрать из избранного' : '☆ В избранное'}
                            </button>
                            <button onclick="filterManager.editFilter(${filter.id})" 
                                    class="btn btn-small btn-default">
                                ✎ Редактировать
                            </button>
                            <button onclick="filterManager.deleteFilter(${filter.id})" 
                                    class="btn btn-small btn-danger">
                                ✕ Удалить
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderFilterConfig(config) {
        const items = Object.entries(config)
            .map(([key, value]) => {
                let displayValue = value;
                if (typeof value === 'boolean') {
                    displayValue = value ? '✓' : '✗';
                }
                return `<span class="config-item">${key}: <strong>${displayValue}</strong></span>`;
            })
            .join(', ');
        
        return `<div class="config-preview">${items}</div>`;
    }

    async applyFilter(filterId) {
        try {
            const response = await fetch(`/api/filters/saved/${filterId}/apply?page=1&per_page=20`);
            const data = await response.json();
            
            if (data.success) {
                // Отправляем событие с результатами
                const event = new CustomEvent('filterApplied', { detail: data.data });
                document.dispatchEvent(event);
                
                this.showMessage(`✓ Применен фильтр "${data.data.emails[0]?.from || 'фильтр'}"`);
            } else {
                alert('Ошибка применения фильтра: ' + data.error);
            }
        } catch (error) {
            console.error('Error applying filter:', error);
            alert('Ошибка применения фильтра');
        }
    }

    async toggleFavorite(filterId) {
        try {
            const response = await fetch(`/api/filters/saved/${filterId}/favorite`, {
                method: 'PUT'
            });
            const data = await response.json();
            
            if (data.success) {
                await this.loadFilters();
                this.render();
            } else {
                alert('Ошибка: ' + data.error);
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
        }
    }

    editFilter(filterId) {
        const filter = this.filters.find(f => f.id === filterId);
        if (!filter) return;

        const name = prompt('Новое название:', filter.name);
        if (!name) return;

        this.updateFilter(filterId, name, filter.filter_config);
    }

    async updateFilter(filterId, name, config) {
        try {
            const response = await fetch(`/api/filters/saved/${filterId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    filter_config: config
                })
            });

            const data = await response.json();
            
            if (data.success) {
                await this.loadFilters();
                this.render();
                this.showMessage('✓ Фильтр обновлен');
            } else {
                alert('Ошибка: ' + data.error);
            }
        } catch (error) {
            console.error('Error updating filter:', error);
        }
    }

    async deleteFilter(filterId) {
        const filter = this.filters.find(f => f.id === filterId);
        if (!filter) return;

        if (!confirm(`Удалить фильтр "${filter.name}"?`)) return;

        try {
            const response = await fetch(`/api/filters/saved/${filterId}`, {
                method: 'DELETE'
            });

            const data = await response.json();
            
            if (data.success) {
                await this.loadFilters();
                this.render();
                this.showMessage('✓ Фильтр удален');
            } else {
                alert('Ошибка: ' + data.error);
            }
        } catch (error) {
            console.error('Error deleting filter:', error);
        }
    }

    async showFavoritesOnly() {
        await this.loadFilters(true);
        this.render();
    }

    attachEventListeners() {
        document.addEventListener('filterSaved', async () => {
            await this.loadFilters();
            this.render();
        });
    }

    showMessage(message) {
        const msg = document.createElement('div');
        msg.className = 'filter-message';
        msg.textContent = message;
        this.container.appendChild(msg);
        
        setTimeout(() => msg.remove(), 3000);
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('filterManagerContainer')) {
        window.filterManager = new FilterManager('filterManagerContainer');
    }
});

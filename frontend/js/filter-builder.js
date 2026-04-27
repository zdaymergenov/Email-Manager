// filter-builder.js - Визуальный конструктор фильтров
/**
 * Filter Builder - интерактивный конструктор фильтров
 * Позволяет пользователям создавать сложные фильтры без кода
 */

class FilterBuilder {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.filterConfig = {};
        this.filterName = '';
        this.availableFields = {};
        this.init();
    }

    async init() {
        // Загружаем доступные поля
        await this.loadAvailableFields();
        this.render();
    }

    async loadAvailableFields() {
        try {
            const response = await fetch('/api/filters/available-fields');
            const data = await response.json();
            this.availableFields = data.fields || {};
        } catch (error) {
            console.error('Error loading fields:', error);
        }
    }

    render() {
        const html = `
            <div class="filter-builder">
                <div class="filter-builder-header">
                    <h3>🔨 Конструктор фильтров</h3>
                    <input type="text" id="filterName" placeholder="Название фильтра" 
                           class="filter-name-input">
                </div>

                <div class="filter-conditions" id="filterConditions">
                    <div class="condition">
                        <select class="field-select" onchange="filterBuilder.updateField(event)">
                            <option value="">Выберите поле</option>
                            ${this.getFieldOptions()}
                        </select>
                        <select class="operator-select">
                            <option value="equals">Равно</option>
                            <option value="contains">Содержит</option>
                            <option value="in_list">В списке</option>
                            <option value="date_range">Диапазон дат</option>
                        </select>
                        <input type="text" class="value-input" placeholder="Значение">
                        <button onclick="filterBuilder.removeCondition(event)" class="btn-remove">✕</button>
                    </div>
                </div>

                <div class="filter-builder-actions">
                    <button onclick="filterBuilder.addCondition()" class="btn btn-primary">
                        + Добавить условие
                    </button>
                </div>

                <div class="filter-builder-buttons">
                    <button onclick="filterBuilder.applyFilter()" class="btn btn-success">
                        ✓ Применить фильтр
                    </button>
                    <button onclick="filterBuilder.saveFilter()" class="btn btn-info">
                        💾 Сохранить фильтр
                    </button>
                    <button onclick="filterBuilder.reset()" class="btn btn-default">
                        ↻ Очистить
                    </button>
                </div>

                <div class="filter-preview" id="filterPreview"></div>
            </div>
        `;

        this.container.innerHTML = html;
        window.filterBuilder = this; // Для callback'ов
    }

    getFieldOptions() {
        let options = '';
        for (const [key, field] of Object.entries(this.availableFields)) {
            options += `<option value="${key}">${field.name}</option>`;
        }
        return options;
    }

    updateField(event) {
        const field = event.target.value;
        const fieldConfig = this.availableFields[field];
        
        // Обновляем тип ввода в зависимости от типа поля
        const condition = event.target.closest('.condition');
        const valueInput = condition.querySelector('.value-input');
        
        if (fieldConfig.type === 'select') {
            // Загружаем доступные значения
            this.loadFieldValues(field, valueInput);
        } else if (fieldConfig.type === 'date') {
            valueInput.type = 'date';
        } else if (fieldConfig.type === 'number') {
            valueInput.type = 'number';
        } else {
            valueInput.type = 'text';
        }
    }

    async loadFieldValues(field, inputElement) {
        const fieldConfig = this.availableFields[field];
        if (fieldConfig.endpoint) {
            try {
                const response = await fetch(fieldConfig.endpoint);
                const data = await response.json();
                
                // Преобразуем в select
                const values = data.positions || data.departments || data.folders || [];
                const selectHtml = `
                    <select class="value-select">
                        <option value="">Выберите значение</option>
                        ${values.map(v => `<option value="${v}">${v}</option>`).join('')}
                    </select>
                `;
                inputElement.replaceWith(selectHtml);
            } catch (error) {
                console.error('Error loading field values:', error);
            }
        }
    }

    addCondition() {
        const container = document.getElementById('filterConditions');
        const condition = document.createElement('div');
        condition.className = 'condition';
        condition.innerHTML = `
            <select class="field-select" onchange="filterBuilder.updateField(event)">
                <option value="">Выберите поле</option>
                ${this.getFieldOptions()}
            </select>
            <select class="operator-select">
                <option value="equals">Равно</option>
                <option value="contains">Содержит</option>
                <option value="in_list">В списке</option>
                <option value="date_range">Диапазон дат</option>
            </select>
            <input type="text" class="value-input" placeholder="Значение">
            <button onclick="filterBuilder.removeCondition(event)" class="btn-remove">✕</button>
        `;
        container.appendChild(condition);
    }

    removeCondition(event) {
        event.target.closest('.condition').remove();
    }

    buildFilterConfig() {
        const config = {};
        const conditions = document.querySelectorAll('.condition');
        
        conditions.forEach(condition => {
            const field = condition.querySelector('.field-select').value;
            const operator = condition.querySelector('.operator-select').value;
            const value = condition.querySelector('.value-input, .value-select')?.value;
            
            if (field && value) {
                // Определяем правильный ключ конфига
                config[field] = this.parseValue(field, value);
            }
        });
        
        return config;
    }

    parseValue(field, value) {
        // Специальная обработка для некоторых полей
        if (field === 'date_range_days') {
            return parseInt(value);
        }
        if (field.endsWith('_only') || field.startsWith('has_')) {
            return value === 'true' || value === true;
        }
        return value;
    }

    async applyFilter() {
        const config = this.buildFilterConfig();
        
        if (Object.keys(config).length === 0) {
            alert('Добавьте хотя бы одно условие');
            return;
        }

        try {
            const response = await fetch('/api/filters/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filter_config: config,
                    page: 1,
                    per_page: 20
                })
            });

            const data = await response.json();
            
            if (data.success) {
                // Отправляем событие с результатами
                const event = new CustomEvent('filterApplied', { detail: data.data });
                document.dispatchEvent(event);
                
                this.updatePreview(config, data.data.total);
            } else {
                alert('Ошибка применения фильтра: ' + data.error);
            }
        } catch (error) {
            console.error('Error applying filter:', error);
            alert('Ошибка применения фильтра');
        }
    }

    async saveFilter() {
        const name = document.getElementById('filterName').value;
        
        if (!name) {
            alert('Введите название фильтра');
            return;
        }

        const config = this.buildFilterConfig();
        
        if (Object.keys(config).length === 0) {
            alert('Добавьте хотя бы одно условие');
            return;
        }

        try {
            const response = await fetch('/api/filters/saved', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    filter_config: config,
                    description: `Фильтр создан в конструкторе`
                })
            });

            const data = await response.json();
            
            if (data.success) {
                alert(`✓ Фильтр "${name}" сохранен!`);
                this.reset();
                // Отправляем событие о сохранении
                document.dispatchEvent(new Event('filterSaved'));
            } else {
                alert('Ошибка сохранения: ' + data.error);
            }
        } catch (error) {
            console.error('Error saving filter:', error);
            alert('Ошибка сохранения фильтра');
        }
    }

    updatePreview(config, total) {
        const preview = document.getElementById('filterPreview');
        const conditions = Object.entries(config)
            .map(([key, value]) => `<span class="condition-tag">${key}: ${value}</span>`)
            .join('');
        
        preview.innerHTML = `
            <div class="preview">
                <strong>Текущий фильтр:</strong>
                <div class="conditions-preview">${conditions}</div>
                <div class="preview-result">
                    ✓ Найдено ${total} писем
                </div>
            </div>
        `;
    }

    reset() {
        document.getElementById('filterName').value = '';
        document.getElementById('filterConditions').innerHTML = `
            <div class="condition">
                <select class="field-select" onchange="filterBuilder.updateField(event)">
                    <option value="">Выберите поле</option>
                    ${this.getFieldOptions()}
                </select>
                <select class="operator-select">
                    <option value="equals">Равно</option>
                    <option value="contains">Содержит</option>
                </select>
                <input type="text" class="value-input" placeholder="Значение">
                <button onclick="filterBuilder.removeCondition(event)" class="btn-remove">✕</button>
            </div>
        `;
        document.getElementById('filterPreview').innerHTML = '';
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('filterBuilderContainer')) {
        window.filterBuilder = new FilterBuilder('filterBuilderContainer');
    }
});

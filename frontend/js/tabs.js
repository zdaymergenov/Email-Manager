// tabs.js - Управление системой вкладок

export function initTabs() {
    console.log('🔧 Инициализация вкладок...');
    
    const buttons = document.querySelectorAll('.tab-button');
    console.log(`📑 Найдено кнопок вкладок: ${buttons.length}`);
    
    if (buttons.length === 0) {
        console.error('❌ ОШИБКА: Не найдены кнопки вкладок!');
        return;
    }
    
    buttons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const tabName = e.target.dataset.tab;
            console.log(`🖱️ Клик по вкладке: ${tabName}`);
            switchTab(tabName);
        });
    });
    
    // Активируем первую вкладку по умолчанию
    const activeButton = document.querySelector('.tab-button.active');
    if (activeButton) {
        const defaultTab = activeButton.dataset.tab;
        console.log(`📄 Активная вкладка по умолчанию: ${defaultTab}`);
        switchTab(defaultTab);
    } else if (buttons.length > 0) {
        // Если нет активной, активируем первую
        buttons[0].classList.add('active');
        switchTab(buttons[0].dataset.tab);
    }
    
    console.log('✅ Tabs инициализирована');
}

export function switchTab(tabName) {
    console.log(`🔄 Переключение на вкладку: ${tabName}`);
    
    // Скрыть все вкладки
    const allPanes = document.querySelectorAll('.tab-pane');
    console.log(`📑 Найдено панелей: ${allPanes.length}`);
    
    allPanes.forEach(pane => {
        pane.classList.remove('active');
        pane.style.display = 'none';
    });
    
    // Убрать активный класс с кнопок
    const allButtons = document.querySelectorAll('.tab-button');
    allButtons.forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Показать выбранную вкладку
    const tabPane = document.getElementById(tabName);
    if (tabPane) {
        tabPane.classList.add('active');
        tabPane.style.display = 'block';
        console.log(`✅ Панель "${tabName}" показана`);
    } else {
        console.error(`❌ Панель с id="${tabName}" не найдена!`);
        // Пробуем найти по имени класса
        const fallbackPane = document.querySelector(`.tab-pane.${tabName}`);
        if (fallbackPane) {
            fallbackPane.classList.add('active');
            fallbackPane.style.display = 'block';
            console.log(`✅ Найдена панель по классу: ${tabName}`);
        }
    }
    
    // Активировать кнопку
    const button = document.querySelector(`[data-tab="${tabName}"]`);
    if (button) {
        button.classList.add('active');
        console.log(`✅ Кнопка "${tabName}" активирована`);
    } else {
        console.error(`❌ Кнопка с data-tab="${tabName}" не найдена!`);
    }
    
    // Триггер события для других модулей
    const event = new CustomEvent('tabChanged', { detail: tabName });
    document.dispatchEvent(event);
}

export function getCurrentTab() {
    const active = document.querySelector('.tab-button.active');
    return active ? active.dataset.tab : 'letters';
}

console.log('✅ tabs.js загружен');
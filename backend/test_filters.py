# test_filters.py - Unit тесты для системы фильтров
"""
Comprehensive unit tests for the filter system v2
"""

import unittest
import json
from datetime import datetime, timedelta
import sys
import os

# Добавляем path к backend
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from filters_system_v2 import (
    create_filter, update_filter, delete_filter, get_filter,
    get_user_filters, toggle_favorite_filter,
    apply_filter, apply_saved_filter, get_quick_filter,
    get_all_quick_filters, get_filter_statistics,
    validate_filter_config, build_filter_query,
    init_filter_tables
)
from filters_api import validate_filter_config as api_validate

class TestFilterCreation(unittest.TestCase):
    """Тесты создания фильтров"""

    def setUp(self):
        """Подготовка к тестам"""
        init_filter_tables()

    def test_create_filter_valid(self):
        """Тест создания валидного фильтра"""
        filter_id = create_filter(
            user_id=1,
            name='Test Filter',
            filter_config={'folder': 'Inbox'},
            description='Test filter'
        )
        self.assertIsNotNone(filter_id)
        self.assertIsInstance(filter_id, int)

    def test_create_filter_duplicate_name(self):
        """Тест создания фильтра с дублирующимся названием"""
        create_filter(1, 'Test', {'folder': 'Inbox'})
        result = create_filter(1, 'Test', {'folder': 'Inbox'})
        self.assertIsNone(result)

    def test_create_filter_missing_config(self):
        """Тест создания фильтра без конфига"""
        result = create_filter(1, 'Test', {})
        self.assertIsNotNone(result)  # Пустой конфиг допустим

    def test_get_filter(self):
        """Тест получения фильтра по ID"""
        filter_id = create_filter(1, 'My Filter', {'folder': 'Inbox'})
        filter_data = get_filter(filter_id)
        
        self.assertIsNotNone(filter_data)
        self.assertEqual(filter_data['name'], 'My Filter')
        self.assertEqual(filter_data['filter_config']['folder'], 'Inbox')


class TestFilterValidation(unittest.TestCase):
    """Тесты валидации конфигов фильтров"""

    def test_validate_valid_config(self):
        """Тест валидации корректного конфига"""
        config = {
            'position': 'Manager',
            'department': 'Sales',
            'unread_only': True
        }
        is_valid, msg = validate_filter_config(config)
        self.assertTrue(is_valid)

    def test_validate_invalid_key(self):
        """Тест валидации конфига с неправильным ключом"""
        config = {'invalid_key': 'value'}
        is_valid, msg = validate_filter_config(config)
        self.assertFalse(is_valid)

    def test_validate_not_dict(self):
        """Тест валидации не-dict конфига"""
        is_valid, msg = validate_filter_config("not a dict")
        self.assertFalse(is_valid)

    def test_validate_empty_config(self):
        """Тест валидации пустого конфига"""
        config = {}
        is_valid, msg = validate_filter_config(config)
        self.assertTrue(is_valid)


class TestFilterQueries(unittest.TestCase):
    """Тесты генерации SQL запросов"""

    def test_build_query_position(self):
        """Тест построения запроса для фильтра по должности"""
        config = {'position': 'Manager'}
        query, params = build_filter_query(config)
        
        self.assertIn('JOIN contacts', query)
        self.assertIn('position', query)
        self.assertEqual(params, ['Manager'])

    def test_build_query_multiple_conditions(self):
        """Тест построения запроса с несколькими условиями"""
        config = {
            'folder': 'Inbox',
            'unread_only': True,
            'date_range_days': 7
        }
        query, params = build_filter_query(config)
        
        self.assertIn('folder', query)
        self.assertIn('is_read', query)
        self.assertIn('date_received', query)
        self.assertGreater(len(params), 0)

    def test_build_query_no_conditions(self):
        """Тест построения запроса без условий"""
        config = {}
        query, params = build_filter_query(config)
        
        self.assertIn('WHERE 1=1', query)
        self.assertEqual(params, [])


class TestQuickFilters(unittest.TestCase):
    """Тесты быстрых фильтров"""

    def test_get_all_quick_filters(self):
        """Тест получения списка быстрых фильтров"""
        filters = get_all_quick_filters()
        
        self.assertIsInstance(filters, dict)
        self.assertGreater(len(filters), 0)
        self.assertIn('unread', filters)
        self.assertIn('week', filters)

    def test_quick_filter_unread(self):
        """Тест применения быстрого фильтра 'непрочитанные'"""
        result = get_quick_filter('unread', page=1, per_page=10)
        
        self.assertIn('emails', result)
        self.assertIn('total', result)
        self.assertIn('pages', result)

    def test_quick_filter_invalid(self):
        """Тест применения несуществующего быстрого фильтра"""
        result = get_quick_filter('nonexistent', page=1, per_page=10)
        
        self.assertIn('error', result)


class TestFilterManagement(unittest.TestCase):
    """Тесты управления фильтрами"""

    def setUp(self):
        """Подготовка к тестам"""
        init_filter_tables()
        self.filter_id = create_filter(1, 'Test', {'folder': 'Inbox'})

    def test_update_filter(self):
        """Тест обновления фильтра"""
        new_config = {'folder': 'Sent', 'unread_only': True}
        result = update_filter(self.filter_id, new_config, 'Updated')
        
        self.assertTrue(result)
        
        filter_data = get_filter(self.filter_id)
        self.assertEqual(filter_data['filter_config']['folder'], 'Sent')
        self.assertEqual(filter_data['name'], 'Updated')

    def test_delete_filter(self):
        """Тест удаления фильтра"""
        filter_id = create_filter(1, 'To Delete', {'folder': 'Inbox'})
        result = delete_filter(filter_id)
        
        self.assertTrue(result)
        
        deleted = get_filter(filter_id)
        self.assertIsNone(deleted)

    def test_get_user_filters(self):
        """Тест получения фильтров пользователя"""
        create_filter(1, 'Filter 1', {'folder': 'Inbox'})
        create_filter(1, 'Filter 2', {'folder': 'Sent'})
        
        filters = get_user_filters(user_id=1)
        
        self.assertGreaterEqual(len(filters), 2)
        names = [f['name'] for f in filters]
        self.assertIn('Filter 1', names)
        self.assertIn('Filter 2', names)

    def test_toggle_favorite(self):
        """Тест отмечивания/отмечивания фильтра как избранного"""
        filter_id = create_filter(1, 'Fav', {'folder': 'Inbox'}, is_favorite=False)
        
        result = toggle_favorite_filter(filter_id)
        self.assertTrue(result)
        
        filter_data = get_filter(filter_id)
        # После первого toggle должен быть избранным
        self.assertTrue(filter_data['is_favorite'])


class TestFilterStatistics(unittest.TestCase):
    """Тесты статистики использования фильтров"""

    def setUp(self):
        """Подготовка к тестам"""
        init_filter_tables()

    def test_get_statistics(self):
        """Тест получения статистики"""
        create_filter(1, 'Filter 1', {'folder': 'Inbox'})
        create_filter(1, 'Filter 2', {'folder': 'Sent'})
        
        stats = get_filter_statistics()
        
        self.assertIn('total_filters', stats)
        self.assertIn('most_used', stats)
        self.assertIn('recent', stats)

    def test_usage_count_increment(self):
        """Тест увеличения счетчика использования"""
        filter_id = create_filter(1, 'Test', {'folder': 'Inbox'})
        initial = get_filter(filter_id)['usage_count']
        
        # После применения должен увеличиться (если реализовано)
        apply_saved_filter(filter_id, page=1, per_page=10)
        
        updated = get_filter(filter_id)['usage_count']
        self.assertEqual(updated, initial + 1)


class TestFilterPerformance(unittest.TestCase):
    """Тесты производительности"""

    def setUp(self):
        """Подготовка к тестам"""
        init_filter_tables()

    def test_create_many_filters(self):
        """Тест создания множества фильтров"""
        import time
        
        start = time.time()
        for i in range(100):
            create_filter(1, f'Filter {i}', {'folder': f'Folder {i % 10}'})
        elapsed = time.time() - start
        
        # Должно быть быстро (< 5 секунд для 100 фильтров)
        self.assertLess(elapsed, 5.0)
        print(f"\nСоздано 100 фильтров за {elapsed:.2f} сек")

    def test_get_user_filters_performance(self):
        """Тест получения списка фильтров (производительность)"""
        import time
        
        # Создаем 50 фильтров
        for i in range(50):
            create_filter(1, f'Filter {i}', {'folder': 'Inbox'})
        
        start = time.time()
        filters = get_user_filters(user_id=1)
        elapsed = time.time() - start
        
        self.assertEqual(len(filters), 50)
        self.assertLess(elapsed, 0.5)  # Должно быть < 0.5 сек
        print(f"\nПолучено 50 фильтров за {elapsed:.3f} сек")


class TestErrorHandling(unittest.TestCase):
    """Тесты обработки ошибок"""

    def setUp(self):
        """Подготовка к тестам"""
        init_filter_tables()

    def test_get_nonexistent_filter(self):
        """Тест получения несуществующего фильтра"""
        result = get_filter(999999)
        self.assertIsNone(result)

    def test_delete_nonexistent_filter(self):
        """Тест удаления несуществующего фильтра"""
        result = delete_filter(999999)
        self.assertFalse(result)

    def test_update_nonexistent_filter(self):
        """Тест обновления несуществующего фильтра"""
        result = update_filter(999999, {'folder': 'Inbox'})
        self.assertFalse(result)


class TestFilterIntegration(unittest.TestCase):
    """Интеграционные тесты"""

    def setUp(self):
        """Подготовка к тестам"""
        init_filter_tables()

    def test_full_workflow(self):
        """Полный workflow: создание -> применение -> обновление -> удаление"""
        # 1. Создание
        filter_id = create_filter(
            user_id=1,
            name='Workflow Test',
            filter_config={'folder': 'Inbox', 'unread_only': True},
            description='Test workflow'
        )
        self.assertIsNotNone(filter_id)
        
        # 2. Получение
        filter_data = get_filter(filter_id)
        self.assertIsNotNone(filter_data)
        
        # 3. Применение
        result = apply_saved_filter(filter_id, page=1, per_page=20)
        self.assertIn('emails', result)
        
        # 4. Обновление
        update_result = update_filter(filter_id, {'folder': 'Sent'})
        self.assertTrue(update_result)
        
        # 5. Удаление
        delete_result = delete_filter(filter_id)
        self.assertTrue(delete_result)
        
        # 6. Проверка удаления
        self.assertIsNone(get_filter(filter_id))


def run_tests():
    """Запуск всех тестов"""
    unittest.main(
        verbosity=2,
        exit=True
    )


if __name__ == '__main__':
    run_tests()

# migrate_filters.py - Миграция существующих фильтров в новую систему
"""
Migration script to convert old filter format to new database schema
"""

import sqlite3
from datetime import datetime
import json

DATABASE = 'emails.db'

def migrate_filters():
    """
    Миграция фильтров из старой системы в новую
    """
    
    with sqlite3.connect(DATABASE) as conn:
        cursor = conn.cursor()
        
        print("🔄 Начинается миграция фильтров...")
        print()
        
        # 1. Проверяем наличие таблиц
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_filters'")
        if not cursor.fetchone():
            print("❌ Таблица saved_filters не найдена.")
            print("💡 Запустите init_filter_tables() сначала")
            return False
        
        # 2. Миграция фильтров по должностям
        print("📌 Миграция фильтров по должностям...")
        cursor.execute("SELECT DISTINCT position FROM contacts WHERE position IS NOT NULL")
        positions = cursor.fetchall()
        
        migrated_count = 0
        for (position,) in positions:
            try:
                cursor.execute('''
                    INSERT INTO saved_filters 
                    (user_id, name, filter_config, description, created_at)
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    1,  # Admin user
                    f'Должность: {position}',
                    json.dumps({'position': position}),
                    f'Автоматически перенесено из старой системы',
                    datetime.now()
                ))
                migrated_count += 1
                print(f"   ✓ {position}")
            except sqlite3.IntegrityError:
                print(f"   ⚠ {position} (уже существует)")
        
        print(f"  ✅ Перенесено {migrated_count} фильтров по должностям\n")
        
        # 3. Миграция фильтров по отделам
        print("📌 Миграция фильтров по отделам...")
        cursor.execute("SELECT DISTINCT department FROM contacts WHERE department IS NOT NULL")
        departments = cursor.fetchall()
        
        migrated_count = 0
        for (department,) in departments:
            try:
                cursor.execute('''
                    INSERT INTO saved_filters 
                    (user_id, name, filter_config, description, created_at)
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    1,
                    f'Отдел: {department}',
                    json.dumps({'department': department}),
                    f'Автоматически перенесено из старой системы',
                    datetime.now()
                ))
                migrated_count += 1
                print(f"   ✓ {department}")
            except sqlite3.IntegrityError:
                print(f"   ⚠ {department} (уже существует)")
        
        print(f"  ✅ Перенесено {migrated_count} фильтров по отделам\n")
        
        # 4. Миграция фильтров по папкам
        print("📌 Миграция фильтров по папкам...")
        cursor.execute("SELECT DISTINCT folder FROM emails WHERE folder IS NOT NULL")
        folders = cursor.fetchall()
        
        migrated_count = 0
        for (folder,) in folders:
            try:
                cursor.execute('''
                    INSERT INTO saved_filters 
                    (user_id, name, filter_config, description, created_at)
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    1,
                    f'Папка: {folder}',
                    json.dumps({'folder': folder}),
                    f'Автоматически перенесено из старой системы',
                    datetime.now()
                ))
                migrated_count += 1
                print(f"   ✓ {folder}")
            except sqlite3.IntegrityError:
                print(f"   ⚠ {folder} (уже существует)")
        
        print(f"  ✅ Перенесено {migrated_count} фильтров по папкам\n")
        
        # 5. Создаем популярные комбинированные фильтры
        print("📌 Создание популярных комбинированных фильтров...")
        
        popular_filters = [
            ('Непрочитанные в Inbox', {'folder': 'Inbox', 'unread_only': True}),
            ('Важные письма', {'important_only': True}),
            ('С вложениями', {'has_attachments': True}),
            ('За последнюю неделю', {'date_range_days': 7}),
            ('За последний месяц', {'date_range_days': 30}),
            ('Непрочитанные с вложениями', {'unread_only': True, 'has_attachments': True}),
        ]
        
        migrated_count = 0
        for name, config in popular_filters:
            try:
                cursor.execute('''
                    INSERT INTO saved_filters 
                    (user_id, name, filter_config, description, created_at)
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    1,
                    name,
                    json.dumps(config),
                    'Популярный фильтр (предустановка)',
                    datetime.now()
                ))
                migrated_count += 1
                print(f"   ✓ {name}")
            except sqlite3.IntegrityError:
                print(f"   ⚠ {name} (уже существует)")
        
        print(f"  ✅ Создано {migrated_count} предустановленных фильтров\n")
        
        # 6. Статистика
        print("📊 Статистика миграции:")
        cursor.execute("SELECT COUNT(*) FROM saved_filters WHERE user_id = 1")
        total = cursor.fetchone()[0]
        print(f"   Всего фильтров создано: {total}")
        
        cursor.execute("SELECT COUNT(DISTINCT position) FROM contacts WHERE position IS NOT NULL")
        pos_count = cursor.fetchone()[0]
        print(f"   Уникальных должностей: {pos_count}")
        
        cursor.execute("SELECT COUNT(DISTINCT department) FROM contacts WHERE department IS NOT NULL")
        dept_count = cursor.fetchone()[0]
        print(f"   Уникальных отделов: {dept_count}")
        
        cursor.execute("SELECT COUNT(DISTINCT folder) FROM emails WHERE folder IS NOT NULL")
        folder_count = cursor.fetchone()[0]
        print(f"   Уникальных папок: {folder_count}")
        
        conn.commit()
        
        print()
        print("✅ Миграция успешно завершена!")
        return True


def rollback_migration():
    """
    Откатить миграцию (удалить перенесенные фильтры)
    """
    
    with sqlite3.connect(DATABASE) as conn:
        cursor = conn.cursor()
        
        print("🔄 Откат миграции...")
        
        # Удаляем фильтры, которые были перенесены (user_id = 1 и автоматические)
        cursor.execute('''
            DELETE FROM saved_filters 
            WHERE user_id = 1 
            AND description LIKE '%Автоматически перенесено%'
            OR description = 'Популярный фильтр (предустановка)'
        ''')
        
        deleted = cursor.rowcount
        conn.commit()
        
        print(f"✅ Удалено {deleted} фильтров")
        return True


def create_backup():
    """
    Создать резервную копию фильтров
    """
    import os
    from shutil import copy2
    
    backup_name = f'emails_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.db'
    
    try:
        copy2(DATABASE, backup_name)
        print(f"✅ Резервная копия создана: {backup_name}")
        return True
    except Exception as e:
        print(f"❌ Ошибка создания резервной копии: {e}")
        return False


def validate_migration():
    """
    Проверить корректность миграции
    """
    
    with sqlite3.connect(DATABASE) as conn:
        cursor = conn.cursor()
        
        print("🔍 Проверка миграции...")
        
        # Проверяем структуру таблиц
        cursor.execute('''
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name IN ('saved_filters', 'filter_rules', 'filter_cache')
        ''')
        tables = [row[0] for row in cursor.fetchall()]
        
        print()
        print("📋 Таблицы:")
        if 'saved_filters' in tables:
            print("   ✓ saved_filters")
        else:
            print("   ✗ saved_filters")
        
        if 'filter_rules' in tables:
            print("   ✓ filter_rules")
        else:
            print("   ✗ filter_rules")
        
        if 'filter_cache' in tables:
            print("   ✓ filter_cache")
        else:
            print("   ✗ filter_cache")
        
        # Проверяем наличие данных
        cursor.execute("SELECT COUNT(*) FROM saved_filters")
        filter_count = cursor.fetchone()[0]
        print()
        print(f"📊 Данные:")
        print(f"   Фильтры: {filter_count}")
        
        # Проверяем валидность JSON конфигов
        cursor.execute("SELECT id, filter_config FROM saved_filters LIMIT 5")
        valid_configs = 0
        for fid, config_str in cursor.fetchall():
            try:
                json.loads(config_str)
                valid_configs += 1
            except:
                print(f"   ⚠ Фильтр {fid} имеет некорректный JSON")
        
        print(f"   Валидные JSON конфиги: {valid_configs}/5")
        
        print()
        print("✅ Проверка завершена")
        return True


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1:
        command = sys.argv[1].lower()
        
        if command == 'migrate':
            create_backup()
            print()
            migrate_filters()
        elif command == 'rollback':
            rollback_migration()
        elif command == 'validate':
            validate_migration()
        elif command == 'backup':
            create_backup()
        else:
            print("Использование: python migrate_filters.py [команда]")
            print()
            print("Команды:")
            print("  migrate   - Выполнить миграцию")
            print("  rollback  - Откатить миграцию")
            print("  validate  - Проверить миграцию")
            print("  backup    - Создать резервную копию БД")
    else:
        # По умолчанию показываем помощь
        print("🔧 Миграция фильтров Email-Manager")
        print()
        print("Использование: python migrate_filters.py [команда]")
        print()
        print("Команды:")
        print("  migrate   - Выполнить миграцию фильтров в новую систему")
        print("  rollback  - Откатить миграцию (удалить перенесенные фильтры)")
        print("  validate  - Проверить корректность миграции")
        print("  backup    - Создать резервную копию БД")
        print()
        print("Пример:")
        print("  python migrate_filters.py backup")
        print("  python migrate_filters.py migrate")
        print("  python migrate_filters.py validate")

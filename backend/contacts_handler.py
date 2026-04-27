# contacts_handler.py - Обработчик контактов и справочника

import sqlite3
from contextlib import contextmanager

DATABASE = 'emails.db'

@contextmanager
def get_db():
    """Контекстный менеджер для БД"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def create_contacts_table():
    """Создать таблицу контактов если не существует"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE,
                full_name TEXT,
                position TEXT,
                department TEXT,
                phone TEXT,
                office TEXT,
                city TEXT,
                country TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_email ON contacts(email)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_position ON contacts(position)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_department ON contacts(department)')
        
        # Добавляем недостающие колонки если их нет (миграция)
        for col_name in ['office', 'city', 'country']:
            try:
                cursor.execute(f'ALTER TABLE contacts ADD COLUMN {col_name} TEXT')
            except sqlite3.OperationalError:
                pass  # Колонка уже существует
        
        conn.commit()
        print("✅ Таблица contacts готова")

def add_contact(email, full_name='', position='', department='', phone='', office='', city='', country=''):
    """Добавить или обновить контакт"""
    if not email:
        return False
    
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO contacts 
                (email, full_name, position, department, phone, office, city, country)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (email.lower().strip(), full_name, position, department, phone, office, city, country))
            conn.commit()
            return True
        except Exception as e:
            print(f"❌ Ошибка добавления контакта: {e}")
            return False

def get_contact(email):
    """Получить контакт по email"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM contacts 
            WHERE email = ?
        """, (email.lower().strip(),))
        row = cursor.fetchone()
        
        if row:
            return dict(row)
        return None

def get_all_contacts():
    """Получить все контакты"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM contacts 
            ORDER BY full_name
        """)
        return [dict(row) for row in cursor.fetchall()]

def get_all_positions():
    """Получить все уникальные должности"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT position 
            FROM contacts 
            WHERE position IS NOT NULL AND position != ''
            ORDER BY position
        """)
        return [row['position'] for row in cursor.fetchall()]

def get_all_departments():
    """Получить все уникальные отделы"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT department 
            FROM contacts 
            WHERE department IS NOT NULL AND department != ''
            ORDER BY department
        """)
        return [row['department'] for row in cursor.fetchall()]

def get_all_folders_from_emails():
    """Получить все уникальные папки из таблицы emails"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT folder, COUNT(*) as count
            FROM emails 
            WHERE folder IS NOT NULL AND folder != ''
            GROUP BY folder
            ORDER BY count DESC
        """)
        return [{'folder': row['folder'], 'count': row['count']} for row in cursor.fetchall()]

def normalize_company(val):
    """Нормализует название компании"""
    import pandas as pd
    if val is None or pd.isna(val) or str(val).strip() in ('-', ''):
        return ''
    
    s = str(val).strip()
    s_lower = s.lower()
    
    # Объединяем варианты названий компаний
    if 'arena' in s_lower or 'арена' in s_lower:
        return 'Arena S'
    if 'интеркей' in s_lower:
        return 'ИнтерКейДжи'
    if 'сервис' in s_lower and 'центр' in s_lower:
        return 'Сервис центр'
    if 'sulpak' in s_lower:
        return 'SULPAK'
    if 'servicemag' in s_lower:
        return 'Servicemag'
    
    return s

def safe_str(val):
    """Безопасное преобразование значения в строку (обрабатывает NaN)"""
    import pandas as pd
    if val is None or (hasattr(pd, 'isna') and pd.isna(val)):
        return ''
    s = str(val).strip()
    if s in ('-', 'nan', 'NaN'):
        return ''
    return s

def load_from_xlsx(filepath, clear_existing=False):
    """
    Загрузить контакты из XLSX
    Поддерживает формат с колонками:
    Полное имя | Имя | Фамилия | Email | Email 2 | Рабочий тел. | Мобильный | 
    Компания | Отдел | Должность | notes | workCity | ... | office | ... | workCountry
    
    Args:
        filepath: путь к XLSX файлу
        clear_existing: если True - удалит все существующие контакты перед загрузкой
    """
    try:
        import pandas as pd
        
        print(f"📥 Загружаю файл: {filepath}")
        df = pd.read_excel(filepath)
        print(f"📊 Найдено строк: {len(df)}, колонок: {len(df.columns)}")
        
        # Очистка существующих контактов если запрошено
        if clear_existing:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM contacts")
                conn.commit()
                print("🗑️ Существующие контакты удалены")
        
        # Определяем имена колонок (на случай разных вариантов)
        column_mapping = {
            'Полное имя': 'full_name',
            'Email': 'email',
            'Должность': 'position',
            'Компания': 'company',
            'Отдел': 'department_raw',
            'Рабочий тел.': 'phone',
            'Мобильный': 'mobile',
            'office': 'office',
            'workCity': 'city',
            'workCountry': 'country',
        }
        
        # Проверяем какие колонки есть
        available_columns = {col: mapping for col, mapping in column_mapping.items() if col in df.columns}
        print(f"✅ Найденные колонки: {list(available_columns.keys())}")
        
        added = 0
        skipped = 0
        errors = 0
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            for idx, row in df.iterrows():
                try:
                    email = safe_str(row.get('Email', ''))
                    
                    # Пропускаем строки без email
                    if not email or '@' not in email:
                        skipped += 1
                        continue
                    
                    full_name = safe_str(row.get('Полное имя', ''))
                    position = safe_str(row.get('Должность', ''))
                    
                    # Отдел: используем 'Отдел', если пусто - используем 'Компания'
                    department = safe_str(row.get('Отдел', ''))
                    if not department:
                        department = normalize_company(row.get('Компания', ''))
                    
                    # Телефон: предпочитаем мобильный, затем рабочий
                    phone = safe_str(row.get('Мобильный', '')) or safe_str(row.get('Рабочий тел.', ''))
                    
                    office = safe_str(row.get('office', ''))
                    city = safe_str(row.get('workCity', ''))
                    country = safe_str(row.get('workCountry', ''))
                    
                    cursor.execute("""
                        INSERT OR REPLACE INTO contacts 
                        (email, full_name, position, department, phone, office, city, country)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        email.lower(),
                        full_name,
                        position,
                        department,
                        phone,
                        office,
                        city,
                        country
                    ))
                    added += 1
                    
                    # Прогресс каждые 1000 записей
                    if added % 1000 == 0:
                        print(f"  💾 Обработано: {added} контактов...")
                
                except Exception as e:
                    errors += 1
                    if errors <= 5:  # показываем только первые 5 ошибок
                        print(f"  ⚠️ Ошибка в строке {idx}: {e}")
            
            conn.commit()
        
        print(f"\n✅ ИТОГО:")
        print(f"  📥 Добавлено/обновлено: {added}")
        print(f"  ⏭️ Пропущено (без email): {skipped}")
        print(f"  ❌ Ошибок: {errors}")
        
        # Статистика после загрузки
        positions_count = len(get_all_positions())
        departments_count = len(get_all_departments())
        print(f"\n📊 Уникальных должностей: {positions_count}")
        print(f"📊 Уникальных отделов: {departments_count}")
        
        return {
            'success': True,
            'added': added,
            'skipped': skipped,
            'errors': errors,
            'positions': positions_count,
            'departments': departments_count
        }
    
    except Exception as e:
        print(f"❌ Ошибка загрузки XLSX: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }

def delete_contact(email):
    """Удалить контакт"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM contacts WHERE email = ?", (email.lower().strip(),))
        conn.commit()
        return cursor.rowcount > 0

def clear_all_contacts():
    """Удалить все контакты"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM contacts")
        conn.commit()
        return cursor.rowcount

def get_contacts_stats():
    """Статистика по контактам"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as total FROM contacts")
        total = cursor.fetchone()['total']
        
        cursor.execute("SELECT COUNT(DISTINCT position) as pos FROM contacts WHERE position IS NOT NULL AND position != ''")
        positions = cursor.fetchone()['pos']
        
        cursor.execute("SELECT COUNT(DISTINCT department) as dep FROM contacts WHERE department IS NOT NULL AND department != ''")
        departments = cursor.fetchone()['dep']
        
        return {
            'total': total,
            'positions': positions,
            'departments': departments
        }

# Инициализация при импорте
create_contacts_table()

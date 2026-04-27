# filters_system_v2.py - Новая система фильтров через БД (v2)
"""
Полностью переработанная система фильтров:
- SQL-запросы вместо Python-кода
- Таблицы для сохранения фильтров
- Кеширование результатов
- Поддержка сложных условий
"""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
import json
from typing import Dict, List, Optional, Tuple

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

# ==================== ИНИЦИАЛИЗАЦИЯ ТАБЛИЦ ====================

def init_filter_tables():
    """Инициализировать таблицы для системы фильтров"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Таблица сохраненных фильтров
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_filters'")
        if not cursor.fetchone():
            print("📝 Создаю таблицу saved_filters...")
            cursor.execute('''
                CREATE TABLE saved_filters (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    name TEXT NOT NULL,
                    description TEXT,
                    filter_config TEXT NOT NULL,  -- JSON с условиями фильтра
                    is_favorite BOOLEAN DEFAULT 0,
                    usage_count INTEGER DEFAULT 0,
                    last_used DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, name),
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
            ''')
            cursor.execute('CREATE INDEX idx_user_filters ON saved_filters(user_id)')
            cursor.execute('CREATE INDEX idx_favorite_filters ON saved_filters(is_favorite)')
            print("  ✅ Таблица saved_filters создана")
        
        # Таблица правил фильтрации
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='filter_rules'")
        if not cursor.fetchone():
            print("📝 Создаю таблицу filter_rules...")
            cursor.execute('''
                CREATE TABLE filter_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    name TEXT NOT NULL,
                    condition_type TEXT NOT NULL,  -- 'equals', 'contains', 'in_list', 'date_range', etc.
                    field_name TEXT NOT NULL,  -- 'sender_email', 'position', 'department', 'folder', 'date', etc.
                    field_value TEXT NOT NULL,
                    enabled BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
            ''')
            cursor.execute('CREATE INDEX idx_user_rules ON filter_rules(user_id, enabled)')
            print("  ✅ Таблица filter_rules создана")
        
        # Таблица кешированных результатов фильтров
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='filter_cache'")
        if not cursor.fetchone():
            print("📝 Создаю таблицу filter_cache...")
            cursor.execute('''
                CREATE TABLE filter_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filter_id INTEGER,
                    email_id INTEGER,
                    matches_filter BOOLEAN,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(filter_id) REFERENCES saved_filters(id) ON DELETE CASCADE,
                    FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
                )
            ''')
            cursor.execute('CREATE INDEX idx_filter_cache ON filter_cache(filter_id, email_id)')
            print("  ✅ Таблица filter_cache создана")
        
        conn.commit()
        print("✅ Таблицы фильтрации инициализированы\n")

# ==================== УПРАВЛЕНИЕ СОХРАНЕННЫМИ ФИЛЬТРАМИ ====================

def create_filter(user_id: int, name: str, filter_config: Dict, description: str = '') -> int:
    """
    Создать и сохранить фильтр
    
    filter_config пример:
    {
        'position': 'Manager',
        'department': 'Sales',
        'folder': 'Inbox',
        'date_range_days': 30,
        'unread_only': True,
        'has_attachments': True
    }
    """
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO saved_filters 
                (user_id, name, description, filter_config, updated_at)
                VALUES (?, ?, ?, ?, ?)
            ''', (user_id, name, description, json.dumps(filter_config), datetime.now()))
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            print(f"❌ Фильтр '{name}' уже существует для этого пользователя")
            return None
        except Exception as e:
            print(f"❌ Ошибка создания фильтра: {e}")
            return None

def update_filter(filter_id: int, filter_config: Dict, name: str = None) -> bool:
    """Обновить сохраненный фильтр"""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            if name:
                cursor.execute('''
                    UPDATE saved_filters 
                    SET filter_config = ?, name = ?, updated_at = ?
                    WHERE id = ?
                ''', (json.dumps(filter_config), name, datetime.now(), filter_id))
            else:
                cursor.execute('''
                    UPDATE saved_filters 
                    SET filter_config = ?, updated_at = ?
                    WHERE id = ?
                ''', (json.dumps(filter_config), datetime.now(), filter_id))
            conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            print(f"❌ Ошибка обновления фильтра: {e}")
            return False

def delete_filter(filter_id: int) -> bool:
    """Удалить сохраненный фильтр"""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            # Удаляется каскадно через ON DELETE CASCADE
            cursor.execute('DELETE FROM saved_filters WHERE id = ?', (filter_id,))
            conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            print(f"❌ Ошибка удаления фильтра: {e}")
            return False

def get_filter(filter_id: int) -> Optional[Dict]:
    """Получить сохраненный фильтр"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM saved_filters WHERE id = ?', (filter_id,))
        row = cursor.fetchone()
        
        if row:
            data = dict(row)
            data['filter_config'] = json.loads(data['filter_config'])
            return data
        return None

def get_user_filters(user_id: int, favorites_only: bool = False) -> List[Dict]:
    """Получить все фильтры пользователя"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        if favorites_only:
            cursor.execute('''
                SELECT * FROM saved_filters 
                WHERE user_id = ? AND is_favorite = 1
                ORDER BY name
            ''', (user_id,))
        else:
            cursor.execute('''
                SELECT * FROM saved_filters 
                WHERE user_id = ?
                ORDER BY updated_at DESC
            ''', (user_id,))
        
        filters = []
        for row in cursor.fetchall():
            data = dict(row)
            data['filter_config'] = json.loads(data['filter_config'])
            filters.append(data)
        
        return filters

def toggle_favorite_filter(filter_id: int) -> bool:
    """Отметить/отметить фильтр как избранный"""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('''
                UPDATE saved_filters 
                SET is_favorite = NOT is_favorite
                WHERE id = ?
            ''', (filter_id,))
            conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            print(f"❌ Ошибка изменения избранного: {e}")
            return False

# ==================== ЭФФЕКТИВНАЯ ФИЛЬТРАЦИЯ ПИСЕМ ====================

def build_filter_query(filter_config: Dict) -> Tuple[str, List]:
    """
    Построить SQL запрос на основе конфига фильтра
    Возвращает (query, params)
    """
    conditions = []
    params = []
    needs_contacts_join = False
    
    # Фильтр по должности (через JOIN с contacts, регистронезависимо)
    if filter_config.get('position'):
        needs_contacts_join = True
        conditions.append('LOWER(c.position) = LOWER(?)')
        params.append(filter_config['position'])
    
    # Фильтр по отделу (через JOIN с contacts, регистронезависимо)
    if filter_config.get('department'):
        needs_contacts_join = True
        conditions.append('LOWER(c.department) = LOWER(?)')
        params.append(filter_config['department'])
    
    # Фильтр по папке
    if filter_config.get('folder'):
        conditions.append('e.folder = ?')
        params.append(filter_config['folder'])
    
    # Фильтр по отправителю (регистронезависимо)
    if filter_config.get('sender_email'):
        conditions.append('LOWER(e.sender_email) = LOWER(?)')
        params.append(filter_config['sender_email'])
    
    # Фильтр по содержанию в теме
    if filter_config.get('subject_contains'):
        conditions.append('e.subject LIKE ?')
        params.append(f"%{filter_config['subject_contains']}%")
    
    # Фильтр по диапазону дат (включая 0 = сегодня)
    if 'date_range_days' in filter_config and filter_config['date_range_days'] is not None:
        days = int(filter_config['date_range_days'])
        if days == 0:
            # Сегодня - письма за текущий день (с 00:00:00 сегодня)
            today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            conditions.append('e.date_received >= ?')
            params.append(today_start)
        else:
            # За последние N дней
            cutoff_date = datetime.now() - timedelta(days=days)
            conditions.append('e.date_received >= ?')
            params.append(cutoff_date)
    
    # Фильтр по дате начала
    if filter_config.get('date_from'):
        conditions.append('e.date_received >= ?')
        params.append(filter_config['date_from'])
    
    # Фильтр по дате конца
    if filter_config.get('date_to'):
        conditions.append('e.date_received <= ?')
        params.append(filter_config['date_to'])
    
    # Только непрочитанные
    if filter_config.get('unread_only'):
        conditions.append('e.is_read = 0')
    
    # Только прочитанные
    if filter_config.get('read_only'):
        conditions.append('e.is_read = 1')
    
    # Только с вложениями
    if filter_config.get('has_attachments'):
        conditions.append('e.attachments_count > 0')
    
    # Только без вложений
    if filter_config.get('no_attachments'):
        conditions.append('(e.attachments_count = 0 OR e.attachments_count IS NULL)')
    
    # Важные письма
    if filter_config.get('important_only'):
        conditions.append('e.importance = ?')
        params.append('high')
    
    # Только отвеченные
    if filter_config.get('replied_only'):
        conditions.append('e.is_replied = 1')
    
    where_clause = ' AND '.join(conditions) if conditions else '1=1'
    
    # Если нужен JOIN с contacts (для position/department)
    if needs_contacts_join:
        query = f'''
            SELECT DISTINCT e.* FROM emails e
            INNER JOIN contacts c ON LOWER(e.sender_email) = LOWER(c.email)
            WHERE {where_clause}
            ORDER BY e.date_received DESC
        '''
    else:
        query = f'''
            SELECT e.* FROM emails e
            WHERE {where_clause}
            ORDER BY e.date_received DESC
        '''
    
    return query, params

def apply_filter(filter_config: Dict, page: int = 1, per_page: int = 20) -> Dict:
    """
    Применить фильтр и получить результаты с пагинацией
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        query, params = build_filter_query(filter_config)
        
        # Подсчитываем общее количество
        count_query = f'SELECT COUNT(*) as count FROM ({query})'
        cursor.execute(count_query, params)
        total = cursor.fetchone()['count']
        
        # Добавляем пагинацию
        offset = (page - 1) * per_page
        paginated_query = query + f' LIMIT ? OFFSET ?'
        paginated_params = params + [per_page, offset]
        
        cursor.execute(paginated_query, paginated_params)
        rows = cursor.fetchall()
        
        # Форматируем результаты
        emails = []
        for row in rows:
            body_text = row['body'] or ''
            preview = body_text[:200] + '...' if len(body_text) > 200 else body_text
            
            # Форматирование даты в формат "DD.MM.YYYY HH:MM"
            date_str = row['date_received_str']
            if not date_str and row['date_received']:
                try:
                    if isinstance(row['date_received'], str):
                        # Пробуем разные форматы
                        for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S.%f'):
                            try:
                                dt = datetime.strptime(row['date_received'], fmt)
                                break
                            except ValueError:
                                continue
                        else:
                            dt = None
                    else:
                        dt = row['date_received']
                    
                    if dt:
                        date_str = dt.strftime('%d.%m.%Y %H:%M')
                    else:
                        date_str = ''
                except Exception:
                    date_str = ''
            
            emails.append({
                'id': row['id'],
                'folder': row['folder'],
                'sender_name': row['sender_name'],
                'sender_email': row['sender_email'],
                'from': f"{row['sender_name']} <{row['sender_email']}>" if row['sender_email'] else row['sender_name'],
                'subject': row['subject'],
                'date': date_str or '',
                'body': body_text,
                'preview': preview,
                'is_read': row['is_read'],
                'attachments_count': row['attachments_count'],
                'importance': row['importance'],
                'thread_id': row['thread_id']
            })
        
        return {
            'emails': emails,
            'total': total,
            'page': page,
            'per_page': per_page,
            'pages': (total + per_page - 1) // per_page if total > 0 else 1
        }

def apply_saved_filter(filter_id: int, page: int = 1, per_page: int = 20) -> Dict:
    """Применить сохраненный фильтр"""
    filter_data = get_filter(filter_id)
    if not filter_data:
        return {'error': 'Filter not found', 'emails': [], 'total': 0}
    
    # Обновляем счетчик использования
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE saved_filters 
            SET usage_count = usage_count + 1, last_used = ?
            WHERE id = ?
        ''', (datetime.now(), filter_id))
        conn.commit()
    
    return apply_filter(filter_data['filter_config'], page, per_page)

# ==================== БЫСТРЫЕ ФИЛЬТРЫ (ПРЕДОПРЕДЕЛЕННЫЕ) ====================

QUICK_FILTERS = {
    'unread': {
        'name': 'Непрочитанные',
        'config': {'unread_only': True}
    },
    'attachments': {
        'name': 'С вложениями',
        'config': {'has_attachments': True}
    },
    'today': {
        'name': 'Сегодня',
        'config': {'date_range_days': 0}
    },
    'week': {
        'name': 'За неделю',
        'config': {'date_range_days': 7}
    },
    'month': {
        'name': 'За месяц',
        'config': {'date_range_days': 30}
    },
    'important': {
        'name': 'Важные',
        'config': {'important_only': True}
    },
    'replied': {
        'name': 'Отвеченные',
        'config': {'replied_only': True}
    }
}

def get_quick_filter(filter_key: str, page: int = 1, per_page: int = 20) -> Dict:
    """Применить быстрый фильтр"""
    if filter_key not in QUICK_FILTERS:
        return {'error': 'Quick filter not found', 'emails': [], 'total': 0}
    
    config = QUICK_FILTERS[filter_key]['config']
    return apply_filter(config, page, per_page)

def get_all_quick_filters() -> Dict:
    """Получить список всех быстрых фильтров"""
    return {
        key: {
            'name': data['name'],
            'key': key
        }
        for key, data in QUICK_FILTERS.items()
    }

# ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

def get_filter_statistics() -> Dict:
    """Получить статистику по фильтрам"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Общее количество сохраненных фильтров
        cursor.execute('SELECT COUNT(*) as count FROM saved_filters')
        total_filters = cursor.fetchone()['count']
        
        # Самые используемые фильтры
        cursor.execute('''
            SELECT id, name, usage_count FROM saved_filters
            WHERE usage_count > 0
            ORDER BY usage_count DESC
            LIMIT 5
        ''')
        most_used = [dict(row) for row in cursor.fetchall()]
        
        # Недавно использованные
        cursor.execute('''
            SELECT id, name, last_used FROM saved_filters
            WHERE last_used IS NOT NULL
            ORDER BY last_used DESC
            LIMIT 5
        ''')
        recent = [dict(row) for row in cursor.fetchall()]
        
        return {
            'total_filters': total_filters,
            'most_used': most_used,
            'recent': recent
        }

def clear_filter_cache(filter_id: int = None) -> bool:
    """Очистить кеш фильтра"""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            if filter_id:
                cursor.execute('DELETE FROM filter_cache WHERE filter_id = ?', (filter_id,))
            else:
                cursor.execute('DELETE FROM filter_cache')
            conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            print(f"❌ Ошибка очистки кеша: {e}")
            return False

def validate_filter_config(filter_config: Dict) -> Tuple[bool, str]:
    """Валидировать конфиг фильтра"""
    if not isinstance(filter_config, dict):
        return False, "Filter config must be a dictionary"
    
    allowed_keys = {
        'position', 'department', 'folder', 'sender_email', 'subject_contains',
        'date_range_days', 'date_from', 'date_to', 'unread_only', 'read_only',
        'has_attachments', 'no_attachments', 'important_only', 'replied_only'
    }
    
    for key in filter_config.keys():
        if key not in allowed_keys:
            return False, f"Unknown filter key: {key}"
    
    return True, "Valid"

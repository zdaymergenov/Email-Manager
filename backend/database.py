"""
SQLite база данных для писем из Outlook
Stage 3: Веки письма + Система ролей + История синхронизации
"""

import sqlite3
from datetime import datetime
import os

DB_PATH = 'emails.db'

def get_db():
    """Получить соединение с БД"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Инициализировать базу данных со всеми таблицами Stage 3"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Таблица USERS - Система ролей
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        if not cursor.fetchone():
            print("📝 Создаю таблицу users...")
            cursor.execute('''
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    full_name TEXT,
                    role TEXT DEFAULT 'employee',
                    email TEXT,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            cursor.execute('''
                INSERT INTO users (username, password, full_name, role, email)
                VALUES (?, ?, ?, ?, ?)
            ''', ('admin', 'admin123', 'Administrator', 'admin', 'admin@company.com'))
            
            print("  ✅ Таблица users создана")
        
        # Таблица THREADS
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'")
        if not cursor.fetchone():
            print("📝 Создаю таблицу threads...")
            cursor.execute('''
                CREATE TABLE threads (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT UNIQUE,
                    subject TEXT,
                    first_sender TEXT,
                    first_sender_email TEXT,
                    email_count INTEGER DEFAULT 1,
                    last_email_date DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('CREATE INDEX idx_conversation_id ON threads(conversation_id)')
            print("  ✅ Таблица threads создана")
        
        # Таблица EMAIL_THREADS
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='email_threads'")
        if not cursor.fetchone():
            print("📝 Создаю таблицу email_threads...")
            cursor.execute('''
                CREATE TABLE email_threads (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email_id INTEGER NOT NULL,
                    thread_id INTEGER NOT NULL,
                    conversation_id TEXT,
                    FOREIGN KEY(email_id) REFERENCES emails(id),
                    FOREIGN KEY(thread_id) REFERENCES threads(id)
                )
            ''')
            cursor.execute('CREATE INDEX idx_thread_id ON email_threads(thread_id)')
            cursor.execute('CREATE INDEX idx_email_id ON email_threads(email_id)')
            print("  ✅ Таблица email_threads создана")
        
        # Таблица SYNC_LOGS
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_logs'")
        if not cursor.fetchone():
            print("📝 Создаю таблицу sync_logs...")
            cursor.execute('''
                CREATE TABLE sync_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sync_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                    period_start DATE,
                    period_end DATE,
                    emails_added INTEGER,
                    emails_skipped INTEGER,
                    emails_failed INTEGER,
                    duration_seconds INTEGER,
                    status TEXT,
                    error_message TEXT
                )
            ''')
            print("  ✅ Таблица sync_logs создана")
        
        # Обновляем таблицу emails
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='emails'")
        if cursor.fetchone():
            print("📊 Обновляю таблицу emails...")
            try:
                cursor.execute("ALTER TABLE emails ADD COLUMN conversation_id TEXT")
            except sqlite3.OperationalError:
                pass
            try:
                cursor.execute("ALTER TABLE emails ADD COLUMN thread_id INTEGER")
            except sqlite3.OperationalError:
                pass
            try:
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_conversation_id ON emails(conversation_id)")
            except sqlite3.OperationalError:
                pass
        else:
            print("📝 Создаю таблицу emails...")
            cursor.execute('''
                CREATE TABLE emails (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    folder TEXT NOT NULL,
                    sender_name TEXT,
                    sender_email TEXT,
                    subject TEXT,
                    body TEXT,
                    signature TEXT,
                    date_received DATETIME,
                    date_received_str TEXT,
                    size INTEGER DEFAULT 0,
                    attachments_count INTEGER DEFAULT 0,
                    importance TEXT DEFAULT 'normal',
                    is_read BOOLEAN DEFAULT 0,
                    is_replied BOOLEAN DEFAULT 0,
                    conversation_id TEXT,
                    thread_id INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(date_received, sender_email, subject)
                )
            ''')
            cursor.execute('CREATE INDEX idx_date ON emails(date_received DESC)')
            cursor.execute('CREATE INDEX idx_sender ON emails(sender_email)')
            cursor.execute('CREATE INDEX idx_folder ON emails(folder)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_thread_id ON emails(thread_id)')
            print("  ✅ Таблица emails создана")
        
        conn.commit()
        print("✅ БД инициализирована\n")

def get_user(username):
    """Получить пользователя по имени"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE username = ?', (username,))
        return cursor.fetchone()

def create_user(username, password, full_name, role='employee', email=''):
    """Создать пользователя"""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO users (username, password, full_name, role, email)
                VALUES (?, ?, ?, ?, ?)
            ''', (username, password, full_name, role, email))
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

def verify_user(username, password):
    """Проверить учётные данные"""
    user = get_user(username)
    if user and user['password'] == password and user['is_active']:
        return dict(user)
    return None

def get_all_users():
    """Получить всех пользователей"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, username, full_name, role, is_active FROM users')
        return [dict(row) for row in cursor.fetchall()]

def create_or_update_thread(conversation_id, subject, first_sender, first_sender_email):
    """Создать или обновить ветку"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id FROM threads WHERE conversation_id = ?
        ''', (conversation_id,))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute('''
                UPDATE threads 
                SET email_count = (SELECT COUNT(*) FROM email_threads WHERE thread_id = ?),
                    last_email_date = (SELECT MAX(date_received) FROM emails WHERE thread_id = ?)
                WHERE id = ?
            ''', (existing['id'], existing['id'], existing['id']))
            conn.commit()
            return existing['id']
        else:
            cursor.execute('''
                INSERT INTO threads (conversation_id, subject, first_sender, first_sender_email)
                VALUES (?, ?, ?, ?)
            ''', (conversation_id, subject, first_sender, first_sender_email))
            conn.commit()
            return cursor.lastrowid

def get_threads(page=1, per_page=20):
    """Получить все ветки"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) as count FROM threads')
        total = cursor.fetchone()['count']
        
        offset = (page - 1) * per_page
        cursor.execute('''
            SELECT * FROM threads 
            ORDER BY last_email_date DESC 
            LIMIT ? OFFSET ?
        ''', (per_page, offset))
        
        threads = [dict(row) for row in cursor.fetchall()]
        
        return {
            'threads': threads,
            'total': total,
            'page': page,
            'per_page': per_page,
            'pages': (total + per_page - 1) // per_page if total > 0 else 1
        }

def get_thread_emails(thread_id):
    """Получить все письма в ветке"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT e.* FROM emails e
            JOIN email_threads et ON e.id = et.email_id
            WHERE et.thread_id = ?
            ORDER BY e.date_received ASC
        ''', (thread_id,))
        
        return [dict(row) for row in cursor.fetchall()]

def add_email(email_data):
    """Добавить письмо с поддержкой веток"""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO emails (
                    folder, sender_name, sender_email, subject, body, signature,
                    date_received, date_received_str,
                    size, attachments_count, importance, is_read, is_replied,
                    conversation_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                email_data.get('folder', 'Unknown'),
                email_data.get('from', ''),
                email_data.get('email', ''),
                email_data.get('subject', ''),
                email_data.get('body', ''),
                email_data.get('signature', ''),
                email_data.get('_date_obj'),
                email_data.get('date', ''),
                email_data.get('size', 0),
                email_data.get('attachments_count', 0),
                email_data.get('importance', 'normal'),
                email_data.get('is_read', 0),
                email_data.get('is_replied', 0),
                email_data.get('conversation_id', '')
            ))
            
            email_id = cursor.lastrowid
            
            # Создаем/обновляем цепочку БЕЗ открывания нового соединения
            if email_data.get('conversation_id'):
                conversation_id = email_data.get('conversation_id')
                
                # Проверяем существует ли цепочка
                cursor.execute('''
                    SELECT id FROM threads WHERE conversation_id = ?
                ''', (conversation_id,))
                existing = cursor.fetchone()
                
                if existing:
                    # Обновляем существующую цепочку
                    thread_id = existing['id']
                    cursor.execute('''
                        UPDATE threads 
                        SET email_count = (SELECT COUNT(*) FROM email_threads WHERE thread_id = ?),
                            last_email_date = (SELECT MAX(date_received) FROM emails WHERE thread_id = ?)
                        WHERE id = ?
                    ''', (thread_id, thread_id, thread_id))
                else:
                    # Создаем новую цепочку
                    cursor.execute('''
                        INSERT INTO threads (conversation_id, subject, first_sender, first_sender_email)
                        VALUES (?, ?, ?, ?)
                    ''', (
                        conversation_id,
                        email_data.get('subject', ''),
                        email_data.get('from', ''),
                        email_data.get('email', '')
                    ))
                    thread_id = cursor.lastrowid
                
                # Связываем письмо с цепочкой
                cursor.execute('''
                    UPDATE emails SET thread_id = ? WHERE id = ?
                ''', (thread_id, email_id))
                
                cursor.execute('''
                    INSERT OR IGNORE INTO email_threads (email_id, thread_id, conversation_id)
                    VALUES (?, ?, ?)
                ''', (email_id, thread_id, conversation_id))
            
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False
        except Exception as e:
            print(f"❌ Ошибка при добавлении письма: {e}")
            import traceback
            traceback.print_exc()
            return False

def add_emails(emails_list):
    """Добавить список писем"""
    added_count = 0
    skipped_count = 0
    
    for email in emails_list:
        if add_email(email):
            added_count += 1
        else:
            skipped_count += 1
    
    return added_count

def get_last_sync_date():
    """Получить дату последнего письма в БД (для отслеживания синхронизации)"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT MAX(date_received) as last_date FROM emails
        ''')
        result = cursor.fetchone()
        if result and result['last_date']:
            return result['last_date']
        return None

def get_emails(page=1, per_page=20, folder=None, sender=None, start_date=None, end_date=None):
    """Получить письма"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        query = 'SELECT * FROM emails WHERE 1=1'
        params = []
        
        if folder:
            query += ' AND folder = ?'
            params.append(folder)
        
        if sender:
            query += ' AND (sender_name LIKE ? OR sender_email LIKE ?)'
            params.append(f'%{sender}%')
            params.append(f'%{sender}%')
        
        if start_date:
            query += ' AND date_received >= ?'
            params.append(start_date)
        
        if end_date:
            query += ' AND date_received <= ?'
            params.append(end_date)
        
        query += ' ORDER BY date_received DESC'
        
        count_query = query.replace('SELECT *', 'SELECT COUNT(*) as count')
        cursor.execute(count_query, params)
        total = cursor.fetchone()['count']
        
        offset = (page - 1) * per_page
        query += ' LIMIT ? OFFSET ?'
        params.extend([per_page, offset])
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        emails = []
        for row in rows:
            date_str = row['date_received_str']
            if not date_str and row['date_received']:
                try:
                    if isinstance(row['date_received'], str):
                        dt = datetime.strptime(row['date_received'], '%Y-%m-%d %H:%M:%S')
                    else:
                        dt = row['date_received']
                    date_str = dt.strftime('%d.%m.%Y %H:%M')
                except:
                    date_str = str(row['date_received'])
            
            body_text = row['body'] or ''
            preview = body_text[:200] + '...' if len(body_text) > 200 else body_text
            
            emails.append({
                'id': row['id'],
                'folder': row['folder'],
                'from': f"{row['sender_name']} <{row['sender_email']}>" if row['sender_email'] else row['sender_name'],
                'sender_name': row['sender_name'],
                'sender_email': row['sender_email'],
                'subject': row['subject'],
                'date': date_str or '—',
                'date_received': row['date_received'],
                'preview': preview,
                'body': body_text,
                'thread_id': row['thread_id'],
                'is_read': row['is_read'],
                'attachments_count': row['attachments_count'],
            })
        
        return {
            'emails': emails,
            'total': total,
            'page': page,
            'per_page': per_page,
            'pages': (total + per_page - 1) // per_page if total > 0 else 1
        }

def get_email_by_id(email_id):
    """Получить письмо по ID"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM emails WHERE id = ?', (email_id,))
        row = cursor.fetchone()
        
        if not row:
            return None
        
        return {
            'id': row['id'],
            'from': f"{row['sender_name']} <{row['sender_email']}>" if row['sender_email'] else row['sender_name'],
            'subject': row['subject'],
            'folder': row['folder'],
            'date': row['date_received_str'],
            'body': row['body'] or '',
            'signature': row['signature'],
            'size': row['size'],
            'attachments': row['attachments_count'],
            'importance': row['importance'],
            'is_read': row['is_read'],
            'is_replied': row['is_replied'],
            'thread_id': row['thread_id']
        }

def get_stats():
    """Получить статистику"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) as count FROM emails')
        total = cursor.fetchone()['count']
        
        cursor.execute('SELECT folder, COUNT(*) as count FROM emails GROUP BY folder ORDER BY count DESC')
        folders = {row['folder']: row['count'] for row in cursor.fetchall()}
        
        cursor.execute('''
            SELECT sender_name, sender_email, COUNT(*) as count 
            FROM emails 
            GROUP BY sender_email 
            ORDER BY count DESC 
            LIMIT 10
        ''')
        top_senders = [
            {
                'name': row['sender_name'] or row['sender_email'],
                'email': row['sender_email'],
                'count': row['count']
            }
            for row in cursor.fetchall()
        ]
        
        cursor.execute('SELECT SUM(size) as total_size FROM emails')
        total_size = cursor.fetchone()['total_size'] or 0
        
        cursor.execute('SELECT COUNT(*) as count FROM threads')
        thread_count = cursor.fetchone()['count']
        
        return {
            'total': total,
            'folders': folders,
            'top_senders': top_senders,
            'total_size_mb': round(total_size / (1024 * 1024), 2),
            'thread_count': thread_count
        }

def clear_emails():
    """Очистить БД"""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('DELETE FROM email_threads')
            cursor.execute('DELETE FROM threads')
            cursor.execute('DELETE FROM emails')
            cursor.execute('DELETE FROM sync_logs')
            conn.commit()
            print("✅ База данных очищена")
        except Exception as e:
            print(f"❌ Ошибка при очистке: {e}")

def log_sync(period_start, period_end, added, skipped, failed, duration, status, error_msg=None):
    """Логировать синхронизацию"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO sync_logs 
            (period_start, period_end, emails_added, emails_skipped, emails_failed, duration_seconds, status, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (period_start, period_end, added, skipped, failed, duration, status, error_msg))
        conn.commit()

def get_sync_logs(limit=20):
    """Получить логи синхронизации"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM sync_logs ORDER BY sync_date DESC LIMIT ?', (limit,))
        return [dict(row) for row in cursor.fetchall()]

def search_emails(query, page=1, per_page=20):
    """Поиск писем"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        search_query = '%' + query + '%'
        sql_query = '''
            SELECT * FROM emails 
            WHERE subject LIKE ? OR sender_name LIKE ? OR sender_email LIKE ?
            ORDER BY date_received DESC
        '''
        
        count_query = 'SELECT COUNT(*) as count FROM emails WHERE subject LIKE ? OR sender_name LIKE ? OR sender_email LIKE ?'
        cursor.execute(count_query, (search_query, search_query, search_query))
        total = cursor.fetchone()['count']
        
        offset = (page - 1) * per_page
        sql_query += f' LIMIT ? OFFSET ?'
        
        cursor.execute(sql_query, (search_query, search_query, search_query, per_page, offset))
        rows = cursor.fetchall()
        
        emails = []
        for row in rows:
            body_text = row['body'] or ''
            preview = body_text[:200] + '...' if len(body_text) > 200 else body_text
            
            emails.append({
                'id': row['id'],
                'folder': row['folder'],
                'from': f"{row['sender_name']} <{row['sender_email']}>" if row['sender_email'] else row['sender_name'],
                'subject': row['subject'],
                'date': row['date_received_str'],
                'preview': preview,
                'thread_id': row['thread_id'],
            })
        
        return {
            'emails': emails,
            'total': total,
            'page': page,
            'per_page': per_page,
            'pages': (total + per_page - 1) // per_page if total > 0 else 1
        }
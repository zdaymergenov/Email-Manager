# thread_handler.py - Обработчик веток и тем письма

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

def create_thread_tables():
    """Создать таблицы для веток"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Таблица threads
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS threads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT UNIQUE,
                subject TEXT,
                first_sender TEXT,
                first_sender_email TEXT,
                email_count INTEGER DEFAULT 0,
                last_email_date DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица email_threads (связь)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_threads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email_id INTEGER,
                thread_id INTEGER,
                conversation_id TEXT,
                FOREIGN KEY(thread_id) REFERENCES threads(id)
            )
        """)
        
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_conversation_id ON threads(conversation_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_thread_id ON email_threads(thread_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_email_id ON email_threads(email_id)')
        
        conn.commit()
        print("✅ Таблицы threads готовы")

def get_thread(thread_id):
    """Получить ветку по ID"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM threads WHERE id = ?
        """, (thread_id,))
        return dict(cursor.fetchone() or {})

def get_thread_emails(thread_id):
    """Получить все письма в ветке"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT e.* FROM emails e
            INNER JOIN email_threads et ON e.id = et.email_id
            WHERE et.thread_id = ?
            ORDER BY e.date_received
        """, (thread_id,))
        return [dict(row) for row in cursor.fetchall()]

def get_all_threads():
    """Получить все веки"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM threads 
            ORDER BY last_email_date DESC
        """)
        return [dict(row) for row in cursor.fetchall()]

def create_thread(conversation_id, subject, first_sender, first_sender_email):
    """Создать новую ветку"""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT INTO threads (conversation_id, subject, first_sender, first_sender_email)
                VALUES (?, ?, ?, ?)
            """, (conversation_id, subject, first_sender, first_sender_email))
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            # Уже существует
            cursor.execute("SELECT id FROM threads WHERE conversation_id = ?", (conversation_id,))
            return cursor.fetchone()['id']

def add_email_to_thread(email_id, thread_id, conversation_id):
    """Добавить письмо в ветку"""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT INTO email_threads (email_id, thread_id, conversation_id)
                VALUES (?, ?, ?)
            """, (email_id, thread_id, conversation_id))
            conn.commit()
            return True
        except Exception as e:
            print(f"❌ Ошибка добавления письма в ветку: {e}")
            return False

def group_emails_by_thread(emails):
    """Сгруппировать письма по ветками"""
    threads = {}
    
    for email in emails:
        if email.get('conversation_id'):
            conv_id = email['conversation_id']
            if conv_id not in threads:
                threads[conv_id] = {
                    'conversation_id': conv_id,
                    'subject': email.get('subject'),
                    'first_sender': email.get('sender_name'),
                    'emails': []
                }
            threads[conv_id]['emails'].append(email)
    
    return threads

def get_thread_stats():
    """Получить статистику по веткам"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM threads")
        total_threads = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM email_threads")
        total_in_threads = cursor.fetchone()['count']
        
        return {
            'total_threads': total_threads,
            'emails_in_threads': total_in_threads,
            'avg_emails_per_thread': round(total_in_threads / max(total_threads, 1), 2)
        }

# Инициализация при импорте
create_thread_tables()

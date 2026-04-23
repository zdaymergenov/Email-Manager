# filters_handler.py - Обработчик фильтрации (ИСПРАВЛЕНО)

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta

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

def filter_by_position(position):
    """Получить письма от людей с определенной должностью"""
    from contacts_handler import get_all_contacts
    
    contacts = get_all_contacts()
    matching_emails = [c['email'] for c in contacts if c.get('position') == position]
    
    if not matching_emails:
        return []
    
    with get_db() as conn:
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(matching_emails))
        cursor.execute(f"""
            SELECT * FROM emails 
            WHERE sender_email IN ({placeholders})
            ORDER BY date_received DESC
        """, matching_emails)
        return [dict(row) for row in cursor.fetchall()]

def filter_by_department(department):
    """Получить письма от людей из определенного отдела"""
    from contacts_handler import get_all_contacts
    
    contacts = get_all_contacts()
    matching_emails = [c['email'] for c in contacts if c.get('department') == department]
    
    if not matching_emails:
        return []
    
    with get_db() as conn:
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(matching_emails))
        cursor.execute(f"""
            SELECT * FROM emails 
            WHERE sender_email IN ({placeholders})
            ORDER BY date_received DESC
        """, matching_emails)
        return [dict(row) for row in cursor.fetchall()]

def filter_by_date_range(days_back):
    """Получить письма за последние N дней"""
    cutoff_date = datetime.now() - timedelta(days=days_back)
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM emails 
            WHERE date_received > ?
            ORDER BY date_received DESC
        """, (cutoff_date,))
        return [dict(row) for row in cursor.fetchall()]

def filter_by_folder(folder):
    """Получить письма из определенной папки"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM emails 
            WHERE folder = ?
            ORDER BY date_received DESC
        """, (folder,))
        return [dict(row) for row in cursor.fetchall()]

def filter_by_unread():
    """Получить непрочитанные письма"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM emails 
            WHERE is_read = 0
            ORDER BY date_received DESC
        """)
        return [dict(row) for row in cursor.fetchall()]

def filter_with_attachments():
    """Получить письма с вложениями"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM emails 
            WHERE attachments_count > 0
            ORDER BY date_received DESC
        """)
        return [dict(row) for row in cursor.fetchall()]

def combine_filters(emails, filters):
    """Применить несколько фильтров сразу"""
    result = emails
    
    if filters.get('position'):
        result = [e for e in result if e.get('position') == filters['position']]
    
    if filters.get('department'):
        result = [e for e in result if e.get('department') == filters['department']]
    
    if filters.get('folder'):
        result = [e for e in result if e.get('folder') == filters['folder']]
    
    if filters.get('unread_only'):
        result = [e for e in result if not e.get('is_read')]
    
    if filters.get('with_attachments_only'):
        result = [e for e in result if e.get('attachments_count', 0) > 0]
    
    return result
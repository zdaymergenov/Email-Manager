# filter_analytics.py - Аналитика использования фильтров
"""
Filter Analytics - отслеживание, анализ и отчеты по использованию фильтров
"""

import sqlite3
from datetime import datetime, timedelta
from contextlib import contextmanager
from typing import Dict, List, Tuple
import json

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

# ==================== ОСНОВНАЯ АНАЛИТИКА ====================

def get_filter_usage_stats(days: int = 30) -> Dict:
    """
    Получить статистику использования фильтров за последние N дней
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cutoff_date = datetime.now() - timedelta(days=days)
        
        # Всего использований за период
        cursor.execute('''
            SELECT COUNT(*) as total_uses FROM saved_filters
            WHERE last_used > ?
        ''', (cutoff_date,))
        total_uses = cursor.fetchone()['total_uses']
        
        # Топ фильтры по количеству использований
        cursor.execute('''
            SELECT id, name, usage_count, last_used 
            FROM saved_filters
            WHERE usage_count > 0
            ORDER BY usage_count DESC
            LIMIT 10
        ''')
        top_filters = [dict(row) for row in cursor.fetchall()]
        
        # Недавно использованные фильтры
        cursor.execute('''
            SELECT id, name, last_used 
            FROM saved_filters
            WHERE last_used IS NOT NULL
            ORDER BY last_used DESC
            LIMIT 10
        ''')
        recent_filters = [dict(row) for row in cursor.fetchall()]
        
        # Активные фильтры
        cursor.execute('''
            SELECT COUNT(*) as active FROM saved_filters
            WHERE usage_count > 0
        ''')
        active_count = cursor.fetchone()['active']
        
        # Неиспользованные фильтры
        cursor.execute('''
            SELECT COUNT(*) as inactive FROM saved_filters
            WHERE usage_count = 0
        ''')
        inactive_count = cursor.fetchone()['inactive']
        
        return {
            'period_days': days,
            'total_uses': total_uses,
            'active_filters': active_count,
            'inactive_filters': inactive_count,
            'top_filters': top_filters,
            'recent_filters': recent_filters
        }

def get_filter_effectiveness(filter_id: int) -> Dict:
    """
    Получить эффективность конкретного фильтра
    (сколько писем он находит, насколько релевантен)
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Информация о фильтре
        cursor.execute('SELECT * FROM saved_filters WHERE id = ?', (filter_id,))
        filter_data = cursor.fetchone()
        
        if not filter_data:
            return {'error': 'Filter not found'}
        
        filter_data = dict(filter_data)
        config = json.loads(filter_data['filter_config'])
        
        # Подсчитываем письма соответствующие фильтру
        from filters_system_v2 import build_filter_query
        query, params = build_filter_query(config)
        
        count_query = f'SELECT COUNT(*) as count FROM ({query})'
        cursor.execute(count_query, params)
        matched_emails = cursor.fetchone()['count']
        
        # Общее количество писем
        cursor.execute('SELECT COUNT(*) as total FROM emails')
        total_emails = cursor.fetchone()['total']
        
        # Процент релевантности
        relevance = (matched_emails / total_emails * 100) if total_emails > 0 else 0
        
        return {
            'filter_id': filter_id,
            'filter_name': filter_data['name'],
            'usage_count': filter_data['usage_count'],
            'matched_emails': matched_emails,
            'total_emails': total_emails,
            'relevance_percent': round(relevance, 2),
            'config': config
        }

def get_user_filter_stats(user_id: int) -> Dict:
    """
    Получить статистику фильтров конкретного пользователя
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Количество фильтров пользователя
        cursor.execute('SELECT COUNT(*) as count FROM saved_filters WHERE user_id = ?', (user_id,))
        total_filters = cursor.fetchone()['count']
        
        # Активные фильтры
        cursor.execute('''
            SELECT COUNT(*) as count FROM saved_filters 
            WHERE user_id = ? AND usage_count > 0
        ''', (user_id,))
        active_filters = cursor.fetchone()['count']
        
        # Избранные фильтры
        cursor.execute('''
            SELECT COUNT(*) as count FROM saved_filters 
            WHERE user_id = ? AND is_favorite = 1
        ''', (user_id,))
        favorite_filters = cursor.fetchone()['count']
        
        # Общее количество использований
        cursor.execute('''
            SELECT SUM(usage_count) as total FROM saved_filters 
            WHERE user_id = ?
        ''', (user_id,))
        total_uses = cursor.fetchone()['total'] or 0
        
        # Последний раз использован фильтр
        cursor.execute('''
            SELECT MAX(last_used) as last_used FROM saved_filters 
            WHERE user_id = ?
        ''', (user_id,))
        last_used = cursor.fetchone()['last_used']
        
        return {
            'user_id': user_id,
            'total_filters': total_filters,
            'active_filters': active_filters,
            'favorite_filters': favorite_filters,
            'total_uses': total_uses,
            'last_used': last_used,
            'avg_uses_per_filter': round(total_uses / total_filters, 2) if total_filters > 0 else 0
        }

# ==================== ОТЧЕТЫ ====================

def generate_usage_report(days: int = 30) -> str:
    """
    Сгенерировать текстовый отчет по использованию фильтров
    """
    stats = get_filter_usage_stats(days)
    
    report = f"""
╔════════════════════════════════════════════════════════════╗
║         ОТЧЕТ ПО ИСПОЛЬЗОВАНИЮ ФИЛЬТРОВ                   ║
║              {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}                        ║
╚════════════════════════════════════════════════════════════╝

📊 ОБЩАЯ СТАТИСТИКА (за последние {days} дней):
  • Всего использований: {stats['total_uses']}
  • Активных фильтров: {stats['active_filters']}
  • Неиспользуемых фильтров: {stats['inactive_filters']}

⭐ ТОП-10 ФИЛЬТРОВ ПО ИСПОЛЬЗОВАНИЯМ:
"""
    
    for i, f in enumerate(stats['top_filters'], 1):
        report += f"  {i}. {f['name']} ({f['usage_count']} раз)\n"
    
    report += f"""
🕐 НЕДАВНО ИСПОЛЬЗОВАННЫЕ ФИЛЬТРЫ:
"""
    
    for f in stats['recent_filters']:
        last_used = datetime.fromisoformat(f['last_used']).strftime('%Y-%m-%d %H:%M')
        report += f"  • {f['name']} ({last_used})\n"
    
    report += "\n" + "="*60 + "\n"
    
    return report

def generate_effectiveness_report() -> str:
    """
    Сгенерировать отчет по эффективности фильтров
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id FROM saved_filters 
            WHERE usage_count > 0
            ORDER BY usage_count DESC
            LIMIT 20
        ''')
        
        filters = cursor.fetchall()
    
    report = f"""
╔════════════════════════════════════════════════════════════╗
║       ОТЧЕТ ПО ЭФФЕКТИВНОСТИ ФИЛЬТРОВ                    ║
║              {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}                        ║
╚════════════════════════════════════════════════════════════╝

📈 ЭФФЕКТИВНОСТЬ АКТИВНЫХ ФИЛЬТРОВ:
"""
    
    for f in filters:
        eff = get_filter_effectiveness(f['id'])
        report += f"""
  • {eff['filter_name']}
    - Использований: {eff['usage_count']}
    - Найденных писем: {eff['matched_emails']}
    - Релевантность: {eff['relevance_percent']}%
"""
    
    report += "\n" + "="*60 + "\n"
    
    return report

# ==================== РЕКОМЕНДАЦИИ ====================

def get_filter_recommendations() -> Dict:
    """
    Получить рекомендации по оптимизации использования фильтров
    """
    with get_db() as conn:
        cursor = conn.cursor()
    
    recommendations = {
        'unused_filters': [],
        'inefficient_filters': [],
        'suggestions': []
    }
    
    # Неиспользуемые фильтры
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, name, created_at FROM saved_filters
            WHERE usage_count = 0
            AND created_at < datetime('now', '-7 days')
            ORDER BY created_at ASC
        ''')
        
        for row in cursor.fetchall():
            recommendations['unused_filters'].append({
                'id': row['id'],
                'name': row['name'],
                'created_at': row['created_at'],
                'suggestion': 'Рассмотрите удаление этого фильтра'
            })
    
    # Неэффективные фильтры
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) as total FROM emails')
        total_emails = cursor.fetchone()['total']
        
        cursor.execute('''
            SELECT id, name FROM saved_filters
            WHERE usage_count > 0
        ''')
        
        for row in cursor.fetchall():
            eff = get_filter_effectiveness(row['id'])
            if eff['relevance_percent'] < 5:
                recommendations['inefficient_filters'].append({
                    'id': row['id'],
                    'name': row['name'],
                    'relevance': eff['relevance_percent'],
                    'suggestion': 'Этот фильтр находит мало писем. Рассмотрите его пересмотр'
                })
    
    # Предложения по улучшению
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Если много неиспользуемых писем
        cursor.execute('SELECT COUNT(*) as count FROM emails WHERE is_read = 0')
        unread_count = cursor.fetchone()['count']
        
        if unread_count > 100:
            recommendations['suggestions'].append({
                'type': 'unread_backlog',
                'message': f'У вас {unread_count} непрочитанных писем. Рекомендуется использовать фильтр "Непрочитанные"'
            })
        
        # Если много писем с вложениями
        cursor.execute('SELECT COUNT(*) as count FROM emails WHERE attachments_count > 0')
        attachments_count = cursor.fetchone()['count']
        
        if attachments_count > 50:
            recommendations['suggestions'].append({
                'type': 'attachments_backlog',
                'message': f'Найдено {attachments_count} писем с вложениями. Создайте фильтр для быстрого доступа'
            })
    
    return recommendations

# ==================== ЭКСПОРТ И ВИЗУАЛИЗАЦИЯ ====================

def export_filters_json() -> str:
    """
    Экспортировать все фильтры в JSON
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM saved_filters')
        
        filters = []
        for row in cursor.fetchall():
            f = dict(row)
            f['filter_config'] = json.loads(f['filter_config'])
            filters.append(f)
        
        return json.dumps(filters, indent=2, default=str)

def import_filters_json(json_data: str) -> bool:
    """
    Импортировать фильтры из JSON
    """
    try:
        filters = json.loads(json_data)
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            for f in filters:
                cursor.execute('''
                    INSERT INTO saved_filters
                    (user_id, name, description, filter_config, is_favorite, usage_count, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    f.get('user_id', 1),
                    f['name'],
                    f.get('description', ''),
                    json.dumps(f['filter_config']),
                    f.get('is_favorite', 0),
                    f.get('usage_count', 0),
                    f.get('created_at', datetime.now())
                ))
            
            conn.commit()
        
        return True
    except Exception as e:
        print(f"Error importing filters: {e}")
        return False

# ==================== CLI ИНТЕРФЕЙС ====================

def print_stats():
    """Вывести статистику в консоль"""
    stats = get_filter_usage_stats()
    
    print("\n📊 СТАТИСТИКА ИСПОЛЬЗОВАНИЯ ФИЛЬТРОВ:")
    print(f"  Активных фильтров: {stats['active_filters']}")
    print(f"  Неиспользуемых: {stats['inactive_filters']}")
    print(f"  Всего использований: {stats['total_uses']}")
    
    if stats['top_filters']:
        print("\n⭐ ТОП ФИЛЬТРЫ:")
        for f in stats['top_filters'][:5]:
            print(f"  • {f['name']} ({f['usage_count']} раз)")
    
    if stats['recent_filters']:
        print("\n🕐 НЕДАВНИЕ:")
        for f in stats['recent_filters'][:5]:
            print(f"  • {f['name']}")

def print_recommendations():
    """Вывести рекомендации"""
    recs = get_filter_recommendations()
    
    print("\n💡 РЕКОМЕНДАЦИИ:")
    
    if recs['unused_filters']:
        print(f"\n  Неиспользуемые фильтры ({len(recs['unused_filters'])}):")
        for f in recs['unused_filters'][:3]:
            print(f"    • {f['name']}")
    
    if recs['suggestions']:
        print(f"\n  Предложения:")
        for s in recs['suggestions']:
            print(f"    • {s['message']}")

if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        
        if cmd == 'stats':
            print_stats()
        elif cmd == 'recommendations':
            print_recommendations()
        elif cmd == 'report':
            print(generate_usage_report())
        elif cmd == 'effectiveness':
            print(generate_effectiveness_report())
        elif cmd == 'export':
            print(export_filters_json())
        else:
            print("Использование: python filter_analytics.py [команда]")
            print("Команды: stats, recommendations, report, effectiveness, export")
    else:
        print_stats()
        print_recommendations()

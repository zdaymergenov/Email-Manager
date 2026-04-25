# app.py - Flask приложение (ИСПРАВЛЕНО)

from flask import Flask, jsonify, request, render_template, session, redirect, url_for, send_from_directory
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash
import os
from datetime import datetime, timedelta

# Импортируем модуль базы данных
import database as db

# Импортируем обработчики
from contacts_handler import (
    get_contact, get_all_contacts, get_all_positions, 
    get_all_departments, load_from_xlsx, add_contact
)

# Импортируем модуль чтения Outlook
try:
    from outlook_reader import read_emails_by_date
    OUTLOOK_AVAILABLE = True
    print("✅ Outlook reader загружен")
except ImportError as e:
    print(f"⚠️ Outlook reader не доступен: {e}")
    OUTLOOK_AVAILABLE = False
    
    def read_emails_by_date(*args, **kwargs):
        return []

# Импортируем очередь для безопасной обработки писем
from email_queue import start_email_worker, stop_email_worker, queue_email_for_adding

# Определяем правильные пути
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(BASE_DIR, '..', 'frontend', 'templates')
STATIC_DIR = os.path.join(BASE_DIR, '..', 'frontend')

# Проверяем существование папок
if not os.path.exists(TEMPLATE_DIR):
    print(f"❌ ОШИБКА: Папка templates не найдена по пути: {TEMPLATE_DIR}")
    alt_path = os.path.join(BASE_DIR, 'frontend', 'templates')
    if os.path.exists(alt_path):
        TEMPLATE_DIR = alt_path
        print(f"✅ Найдена альтернативная папка: {TEMPLATE_DIR}")
else:
    print(f"✅ Папка templates найдена: {TEMPLATE_DIR}")

app = Flask(__name__, template_folder=TEMPLATE_DIR, static_folder=STATIC_DIR, static_url_path='/frontend')
app.secret_key = 'your-secret-key-change-this'

# Инициализация БД при запуске
db.init_db()

# Запускаем Email Worker для безопасной обработки писем
start_email_worker()

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        
        user = db.get_user(session['username'])
        
        if not user or user['role'] != 'admin':
            return {'error': 'Доступ запрещен'}, 403
        
        return f(*args, **kwargs)
    return decorated_function

# ==================== РАЗДАЧА СТАТИЧЕСКИХ ФАЙЛОВ ====================

# Статические файлы отдаются автоматически через Flask (static_url_path='/frontend')

# ==================== АУТЕНТИФИКАЦИЯ ====================

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Веб-страница логина"""
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        user = db.verify_user(username, password)
        
        if user:
            session['user_id'] = user['id']
            session['username'] = username
            session['role'] = user['role']
            
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify({'success': True, 'redirect': url_for('index')})
            
            return redirect(url_for('index'))
        
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({'error': 'Неверные учетные данные'}), 401
        
        return {'error': 'Неверные учетные данные'}, 401
    
    return render_template('login.html')

@app.route('/api/login', methods=['POST'])
def api_login():
    """API эндпоинт для логина"""
    data = request.get_json() or {}
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400
    
    user = db.verify_user(username, password)
    
    if user:
        session['user_id'] = user['id']
        session['username'] = username
        session['role'] = user['role']
        
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'username': username,
                'role': user['role'],
                'full_name': user.get('full_name', '')
            },
            'redirect': '/'
        })
    
    return jsonify({'error': 'Неверные учетные данные'}), 401

@app.route('/api/logout', methods=['POST'])
def api_logout():
    """API эндпоинт для выхода"""
    session.clear()
    return jsonify({'success': True})

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# ==================== ГЛАВНАЯ СТРАНИЦА ====================

@app.route('/')
@login_required
def index():
    return render_template('index.html')

# ==================== API: ПИСЬМА ====================

@app.route('/api/emails')
@login_required
def get_emails():
    """Получить письма с пагинацией"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    folder = request.args.get('folder')
    sender = request.args.get('sender')
    
    result = db.get_emails(page=page, per_page=per_page, folder=folder, sender=sender)
    
    for email in result['emails']:
        if 'preview' not in email:
            email['preview'] = email.get('body', '')[:100] + '...' if email.get('body') else ''
    
    return jsonify(result)

@app.route('/api/email/<int:email_id>')
@login_required
def get_email(email_id):
    """Получить одно письмо"""
    email = db.get_email_by_id(email_id)
    
    if not email:
        return {'error': 'Письмо не найдено'}, 404
    
    return jsonify(email)

# ==================== API: ПОИСК ====================

@app.route('/api/search')
@login_required
def search():
    """Полнотекстовый поиск"""
    query = request.args.get('query', '')
    page = request.args.get('page', 1, type=int)
    
    if len(query) < 2:
        return jsonify({'emails': [], 'total': 0})
    
    result = db.search_emails(query, page=page, per_page=50)
    return jsonify(result)

# ==================== API: ВЕТКИ ====================

@app.route('/api/thread/<int:thread_id>')
@login_required
def get_thread(thread_id):
    """Получить ветку письма"""
    emails = db.get_thread_emails(thread_id)
    return jsonify({'emails': emails})

@app.route('/api/threads')
@login_required
def get_threads():
    """Получить все ветки"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    
    result = db.get_threads(page=page, per_page=per_page)
    return jsonify(result)

# ==================== API: КОНТАКТЫ ====================

@app.route('/api/contacts')
@login_required
def get_contacts_api():
    """Получить все контакты"""
    contacts = get_all_contacts()
    return jsonify({'contacts': contacts})

@app.route('/api/positions')
@login_required
def get_positions_api():
    """Получить все должности"""
    positions = get_all_positions()
    return jsonify({'positions': positions})

@app.route('/api/departments')
@login_required
def get_departments_api():
    """Получить все отделы"""
    departments = get_all_departments()
    return jsonify({'departments': departments})

# ==================== API: СТАТИСТИКА ====================

@app.route('/api/stats')
@login_required
def get_stats():
    """Получить статистику"""
    stats = db.get_stats()
    
    if os.path.exists(db.DB_PATH):
        stats['total_size_mb'] = round(os.path.getsize(db.DB_PATH) / (1024 * 1024), 2)
    
    return jsonify(stats)

# ==================== API: СИНХРОНИЗАЦИЯ ====================

@app.route('/api/fetch-emails', methods=['POST'])
@admin_required
def fetch_emails():
    """Синхронизировать письма из Outlook"""
    if not OUTLOOK_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Outlook reader не доступен',
            'message': 'Установите pywin32: pip install pywin32'
        }), 503
    
    data = request.get_json() or {}
    period = data.get('period', '24h')
    scan_mode = data.get('scan_mode', 'inbox')
    
    # Конвертируем период в часы
    period_hours = 24
    if period == '1h':
        period_hours = 1
    elif period == '6h':
        period_hours = 6
    elif period == '12h':
        period_hours = 12
    elif period == '24h':
        period_hours = 24
    elif period == '7d':
        period_hours = 168
    elif period == '30d':
        period_hours = 720
    
    start_time = datetime.now()
    end_date = start_time
    start_date = start_time - timedelta(hours=period_hours)
    
    try:
        print(f"\n🔄 СИНХРОНИЗАЦИЯ: {start_date} -> {end_date}")
        print(f"   Режим: {scan_mode}")
        
        # Читаем письма из Outlook
        emails = read_emails_by_date(start_date, end_date, scan_mode)
        
        added_count = 0
        skipped_count = 0
        
        # Добавляем в очередь (не прямо в БД)
        for email in emails:
            try:
                queue_email_for_adding(email)
                added_count += 1
            except Exception as e:
                print(f"⚠️ Ошибка при добавлении в очередь: {e}")
                skipped_count += 1
        
        print(f"\n✅ {added_count} писем добавлены в очередь на обработку")
        print(f"   Worker обрабатывает их в фоне...")
        
        end_time = datetime.now()
        duration = int((end_time - start_time).total_seconds())
        
        # Логируем синхронизацию
        db.log_sync(
            period_start=start_date.date(),
            period_end=end_date.date(),
            added=added_count,
            skipped=skipped_count,
            failed=0,
            duration=duration,
            status='success'
        )
        
        print(f"✅ Синхронизация завершена: +{added_count} писем, пропущено: {skipped_count}")
        
        return jsonify({
            'success': True,
            'count': added_count,
            'skipped': skipped_count,
            'duration': duration,
            'message': f'Синхронизировано {added_count} писем за {duration} сек'
        })
        
    except Exception as e:
        end_time = datetime.now()
        duration = int((end_time - start_time).total_seconds())
        
        error_msg = str(e)
        print(f"❌ Ошибка синхронизации: {error_msg}")
        
        db.log_sync(
            period_start=start_date.date(),
            period_end=end_date.date(),
            added=0,
            skipped=0,
            failed=0,
            duration=duration,
            status='error',
            error_msg=error_msg
        )
        
        return jsonify({
            'success': False,
            'error': error_msg,
            'message': 'Ошибка синхронизации. Проверьте, запущен ли Outlook.'
        }), 500

@app.route('/api/clear-db', methods=['POST'])
@admin_required
def clear_db():
    """Очистить БД"""
    db.clear_emails()
    return jsonify({'success': True, 'message': 'БД очищена'})

@app.route('/api/sync-logs')
@admin_required
def get_sync_logs():
    """Получить логи синхронизации"""
    limit = request.args.get('limit', 20, type=int)
    logs = db.get_sync_logs(limit)
    return jsonify({'logs': logs})

@app.route('/api/fetch-emails-custom', methods=['POST'])
@admin_required
def fetch_emails_custom():
    """Ручная синхронизация за указанный период"""
    if not OUTLOOK_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Outlook reader не доступен',
            'message': 'Установите pywin32: pip install pywin32'
        }), 503
    
    data = request.get_json() or {}
    start_date_str = data.get('start_date')
    end_date_str = data.get('end_date')
    scan_mode = data.get('scan_mode', 'inbox')
    
    if not start_date_str or not end_date_str:
        return jsonify({'error': 'Укажите начальную и конечную дату'}), 400
    
    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        end_date = end_date.replace(hour=23, minute=59, second=59)
    except ValueError:
        return jsonify({'error': 'Неверный формат даты. Используйте YYYY-MM-DD'}), 400
    
    start_time = datetime.now()
    
    try:
        print(f"\n🔄 РУЧНАЯ СИНХРОНИЗАЦИЯ: {start_date} -> {end_date}")
        print(f"   Режим: {scan_mode}")
        
        # Читаем письма из Outlook
        emails = read_emails_by_date(start_date, end_date, scan_mode)
        
        added_count = 0
        skipped_count = 0
        
        for email in emails:
            if 'conversation_id' not in email:
                email['conversation_id'] = ''
            
            if db.add_email(email):
                added_count += 1
            else:
                skipped_count += 1
        
        end_time = datetime.now()
        duration = int((end_time - start_time).total_seconds())
        
        db.log_sync(
            period_start=start_date.date(),
            period_end=end_date.date(),
            added=added_count,
            skipped=skipped_count,
            failed=0,
            duration=duration,
            status='success'
        )
        
        print(f"✅ Синхронизация завершена: +{added_count} писем")
        
        return jsonify({
            'success': True,
            'count': added_count,
            'skipped': skipped_count,
            'duration': duration,
            'message': f'Синхронизировано {added_count} писем за {duration} сек'
        })
        
    except Exception as e:
        end_time = datetime.now()
        duration = int((end_time - start_time).total_seconds())
        
        error_msg = str(e)
        print(f"❌ Ошибка синхронизации: {error_msg}")
        
        db.log_sync(
            period_start=start_date.date(),
            period_end=end_date.date(),
            added=0,
            skipped=0,
            failed=0,
            duration=duration,
            status='error',
            error_msg=error_msg
        )
        
        return jsonify({
            'success': False,
            'error': error_msg,
            'message': 'Ошибка синхронизации. Проверьте, запущен ли Outlook.'
        }), 500

@app.route('/api/fetch-new-emails', methods=['POST'])
@admin_required
def fetch_new_emails():
    """Загрузить только НОВЫЕ письма (после последней синхронизации)"""
    if not OUTLOOK_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Outlook reader не доступен'
        }), 503
    
    data = request.get_json() or {}
    scan_mode = data.get('scan_mode', 'inbox')
    
    start_time = datetime.now()
    
    try:
        # Получаем дату последнего письма в БД
        last_sync_date = db.get_last_sync_date()
        
        if last_sync_date:
            # Загружаем письма ПОСЛЕ последней синхронизации
            if isinstance(last_sync_date, str):
                last_sync_date = datetime.fromisoformat(last_sync_date)
            start_date = last_sync_date
        else:
            # Если БД пуста, загружаем за последние 30 дней
            start_date = datetime.now() - timedelta(days=30)
        
        end_date = datetime.now()
        
        print(f"\n🔄 ЗАГРУЗКА НОВЫХ ПИСЕМ: {start_date} -> {end_date}")
        print(f"   Режим: {scan_mode}")
        
        # Читаем письма из Outlook
        emails = read_emails_by_date(start_date, end_date, scan_mode)
        
        added_count = 0
        
        # Добавляем в очередь
        for email in emails:
            try:
                queue_email_for_adding(email)
                added_count += 1
            except Exception as e:
                print(f"⚠️  Ошибка при добавлении в очередь: {e}")
        
        print(f"\n✅ {added_count} писем добавлены в очередь на обработку")
        print(f"   Worker обрабатывает их в фоне...")
        
        end_time = datetime.now()
        duration = int((end_time - start_time).total_seconds())
        
        db.log_sync(
            period_start=start_date.date(),
            period_end=end_date.date(),
            added=added_count,
            skipped=0,
            failed=0,
            duration=duration,
            status='success'
        )
        
        return jsonify({
            'success': True,
            'count': added_count,
            'duration': duration,
            'message': f'Загружено {added_count} новых писем. Worker обрабатывает в фоне.'
        })
        
    except Exception as e:
        end_time = datetime.now()
        duration = int((end_time - start_time).total_seconds())
        
        error_msg = str(e)
        print(f"❌ Ошибка: {error_msg}")
        
        return jsonify({
            'success': False,
            'error': error_msg
        }), 500

# ==================== ЗАПУСК ====================

if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 Email Manager Pro запускается...")
    print("="*60)
    print(f"📁 База данных: {db.DB_PATH}")
    print(f"📁 Шаблоны: {TEMPLATE_DIR}")
    print(f"📁 Статика: {STATIC_DIR}")
    print(f"📧 Outlook: {'✅ Доступен' if OUTLOOK_AVAILABLE else '❌ Недоступен'}")
    print(f"🌐 URL: http://127.0.0.1:5000")
    print(f"👤 Логин: admin / admin123")
    print("="*60 + "\n")
    
    app.run(debug=True, host='127.0.0.1', port=5000)
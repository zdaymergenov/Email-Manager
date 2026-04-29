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

# ==================== СИСТЕМА ФИЛЬТРОВ v2 ====================
from filters_api import register_filters_blueprint
from filters_system_v2 import init_filter_tables

# ==================== ДИСПЕТЧЕРИЗАЦИЯ ====================
from dispatch_api import register_dispatch_blueprint
from reminder_scheduler import start_reminder_scheduler

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

# ==================== ИНИЦИАЛИЗАЦИЯ СИСТЕМЫ ФИЛЬТРОВ v2 ====================
init_filter_tables()
register_filters_blueprint(app)
print("✅ Система фильтров v2 инициализирована")

# ==================== ИНИЦИАЛИЗАЦИЯ ДИСПЕТЧЕРИЗАЦИИ ====================
register_dispatch_blueprint(app)
start_reminder_scheduler()
print("✅ Модуль диспетчеризации инициализирован")

# ==================== АВТОЗАГРУЗКА КОНТАКТОВ ИЗ XLSX ====================
def auto_import_contacts():
    """Автоматически загружает контакты из data/employees.xlsx если БД пустая"""
    try:
        from contacts_handler import get_contacts_stats, load_from_xlsx
        
        stats = get_contacts_stats()
        if stats['total'] > 0:
            print(f"📊 Контакты уже в БД: {stats['total']} записей, {stats['positions']} должностей, {stats['departments']} отделов")
            return
        
        # Ищем файл с контактами
        possible_paths = [
            os.path.join(BASE_DIR, '..', 'data', 'employees.xlsx'),
            os.path.join(BASE_DIR, 'data', 'employees.xlsx'),
            os.path.join(BASE_DIR, '..', 'data', 'все_сотрудники.xlsx'),
        ]
        
        for xlsx_path in possible_paths:
            if os.path.exists(xlsx_path):
                print(f"📥 Найден файл контактов: {xlsx_path}")
                print(f"📥 Автозагрузка контактов в БД...")
                result = load_from_xlsx(xlsx_path)
                if result.get('success'):
                    print(f"✅ Загружено: {result['added']} контактов")
                    print(f"   📊 Должностей: {result['positions']}, Отделов: {result['departments']}")
                else:
                    print(f"⚠️ Ошибка автозагрузки: {result.get('error')}")
                return
        
        print("ℹ️ Файл контактов не найден (data/employees.xlsx). Загрузите через UI.")
    except Exception as e:
        print(f"⚠️ Ошибка автозагрузки контактов: {e}")

auto_import_contacts()

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

@app.route('/api/me')
@login_required
def api_me():
    """Данные текущего пользователя"""
    user = db.get_user_by_id(session['user_id'])
    if not user:
        return jsonify({'error': 'Не найден'}), 404
    return jsonify({
        'id':        user['id'],
        'username':  user['username'],
        'full_name': user.get('full_name', ''),
        'role':      user.get('role', 'employee'),
        'email':     user.get('email', ''),
        'is_active': user.get('is_active', 1),
    })

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

# ==================== API: ПАПКИ И КОНТАКТЫ ====================

@app.route('/api/folders')
@login_required
def get_folders_api():
    """Получить все папки из БД (с количеством писем)"""
    from contacts_handler import get_all_folders_from_emails
    folders = get_all_folders_from_emails()
    return jsonify({'folders': folders})

@app.route('/api/contacts/stats')
@login_required
def get_contacts_stats_api():
    """Статистика по контактам"""
    from contacts_handler import get_contacts_stats
    stats = get_contacts_stats()
    return jsonify(stats)

@app.route('/api/contacts/upload', methods=['POST'])
@login_required
def upload_contacts_xlsx():
    """Загрузить контакты из XLSX файла"""
    from contacts_handler import load_from_xlsx
    import tempfile
    
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'Файл не загружен'}), 400
    
    file = request.files['file']
    if not file.filename:
        return jsonify({'success': False, 'error': 'Имя файла пустое'}), 400
    
    if not file.filename.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'success': False, 'error': 'Только XLSX/XLS файлы'}), 400
    
    # Параметр - очищать ли существующие контакты
    clear_existing = request.form.get('clear_existing', 'false').lower() == 'true'
    
    # Сохраняем файл во временную директорию
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name
        
        # Загружаем контакты
        result = load_from_xlsx(tmp_path, clear_existing=clear_existing)
        
        # Удаляем временный файл
        try:
            os.remove(tmp_path)
        except:
            pass
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/contacts/clear', methods=['POST'])
@login_required
def clear_contacts_api():
    """Удалить все контакты"""
    from contacts_handler import clear_all_contacts
    deleted = clear_all_contacts()
    return jsonify({
        'success': True,
        'deleted': deleted
    })

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

# ==================== API: ОТЧЁТЫ ====================

@app.route('/api/reports')
@login_required
def get_reports():
    """Данные для вкладки Отчёты — реальные данные из БД"""
    days = request.args.get('days', 30, type=int)
    start_str = request.args.get('start')
    end_str   = request.args.get('end')

    try:
        if start_str and end_str:
            start_date = start_str + ' 00:00:00'
            end_date   = end_str   + ' 23:59:59'
        else:
            end_dt     = datetime.now()
            start_dt   = end_dt - timedelta(days=days)
            start_date = start_dt.strftime('%Y-%m-%d %H:%M:%S')
            end_date   = end_dt.strftime('%Y-%m-%d %H:%M:%S')
    except ValueError:
        return jsonify({'error': 'Неверный формат даты'}), 400

    with db.get_db() as conn:
        cursor = conn.cursor()

        # ── Активность по дням ──────────────────────────────────────────
        cursor.execute('''
            SELECT DATE(date_received) as day,
                   COUNT(*) as cnt,
                   SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread_cnt
            FROM emails
            WHERE date_received BETWEEN ? AND ?
            GROUP BY day ORDER BY day
        ''', (start_date, end_date))
        activity = [dict(r) for r in cursor.fetchall()]

        # ── По папкам ───────────────────────────────────────────────────
        cursor.execute('''
            SELECT folder, COUNT(*) as cnt
            FROM emails
            WHERE date_received BETWEEN ? AND ?
            GROUP BY folder ORDER BY cnt DESC LIMIT 10
        ''', (start_date, end_date))
        folders = [dict(r) for r in cursor.fetchall()]

        # ── Топ отправителей (внешние) ──────────────────────────────────
        cursor.execute('''
            SELECT sender_name, sender_email, COUNT(*) as cnt
            FROM emails
            WHERE date_received BETWEEN ? AND ?
            GROUP BY sender_email ORDER BY cnt DESC LIMIT 10
        ''', (start_date, end_date))
        senders = [dict(r) for r in cursor.fetchall()]

        # ── Итоги ───────────────────────────────────────────────────────
        cursor.execute('''
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN is_read   = 0 THEN 1 ELSE 0 END) as unread,
                   SUM(CASE WHEN is_replied = 1 THEN 1 ELSE 0 END) as replied
            FROM emails
            WHERE date_received BETWEEN ? AND ?
        ''', (start_date, end_date))
        totals = dict(cursor.fetchone())

        # ── Тепловая карта (день недели × час) ─────────────────────────
        # strftime('%w') = 0(Sun)..6(Sat), переводим в 0(Mon)..6(Sun)
        cursor.execute('''
            SELECT
                CAST(((CAST(strftime('%w', date_received) AS INTEGER) + 6) % 7) AS INTEGER) as dow,
                CAST(strftime('%H', date_received) AS INTEGER) / 3 as slot,
                COUNT(*) as cnt
            FROM emails
            WHERE date_received BETWEEN ? AND ?
            GROUP BY dow, slot
        ''', (start_date, end_date))
        heatmap_raw = cursor.fetchall()
        heatmap = [[0]*8 for _ in range(7)]
        for row in heatmap_raw:
            d, s, c = int(row['dow']), int(row['slot']), int(row['cnt'])
            if 0 <= d < 7 and 0 <= s < 8:
                heatmap[d][s] = c

        # ── Эффективность сотрудников ───────────────────────────────────
        # Берём всех активных сотрудников у которых заполнен email
        cursor.execute('''
            SELECT id, username, full_name, role, email
            FROM users
            WHERE is_active = 1 AND email IS NOT NULL AND email != ''
            ORDER BY full_name
        ''')
        users = [dict(r) for r in cursor.fetchall()]

        employees = []
        for u in users:
            emp_email = u['email'].lower().strip()

            # письма где сотрудник — отправитель (исходящие, папка Отправленные)
            cursor.execute('''
                SELECT COUNT(*) as sent
                FROM emails
                WHERE LOWER(sender_email) = ?
                  AND date_received BETWEEN ? AND ?
            ''', (emp_email, start_date, end_date))
            _row = cursor.fetchone()
            sent = dict(_row)['sent'] if _row else 0

            # входящие (письма НЕ от этого сотрудника, в его ящике)
            # Приближение: все письма не от него за период
            cursor.execute('''
                SELECT
                    COUNT(*) as received,
                    SUM(CASE WHEN is_read    = 1 THEN 1 ELSE 0 END) as read_cnt,
                    SUM(CASE WHEN is_replied = 1 THEN 1 ELSE 0 END) as replied_cnt,
                    SUM(CASE WHEN importance = 'high' THEN 1 ELSE 0 END) as important_cnt
                FROM emails
                WHERE LOWER(sender_email) != ?
                  AND date_received BETWEEN ? AND ?
            ''', (emp_email, start_date, end_date))
            _r = cursor.fetchone()
            row = dict(_r) if _r else {}

            received     = row.get('received', 0) or 0
            read_cnt     = row.get('read_cnt',  0) or 0
            replied_cnt  = row.get('replied_cnt',0) or 0
            important_cnt= row.get('important_cnt',0) or 0

            # Среднее время ответа: разница между входящим и следующим
            # исходящим письмом в той же цепочке (thread_id)
            cursor.execute('''
                SELECT AVG(diff_hours) as avg_reply_h FROM (
                    SELECT
                        (JULIANDAY(out_e.date_received) - JULIANDAY(in_e.date_received)) * 24.0 as diff_hours
                    FROM emails in_e
                    JOIN emails out_e
                        ON in_e.thread_id  = out_e.thread_id
                       AND LOWER(out_e.sender_email) = ?
                       AND out_e.date_received > in_e.date_received
                    WHERE LOWER(in_e.sender_email) != ?
                      AND in_e.date_received BETWEEN ? AND ?
                      AND diff_hours > 0
                      AND diff_hours < 168
                ) t
            ''', (emp_email, emp_email, start_date, end_date))
            avg_row = cursor.fetchone()
            _avg = dict(avg_row) if avg_row else {}
            avg_reply_h = round(float(_avg.get('avg_reply_h') or 0), 1) if _avg.get('avg_reply_h') else None

            # Активность по дням (для спарклайна)
            cursor.execute('''
                SELECT DATE(date_received) as day, COUNT(*) as cnt
                FROM emails
                WHERE LOWER(sender_email) = ?
                  AND date_received BETWEEN ? AND ?
                GROUP BY day ORDER BY day
            ''', (emp_email, start_date, end_date))
            trend = [r['cnt'] for r in cursor.fetchall()]

            read_rate  = round(read_cnt  / received * 100) if received > 0 else 0
            reply_rate = round(replied_cnt / received * 100) if received > 0 else 0

            # Score: 35% reply_rate + 35% speed + 30% read_rate
            if avg_reply_h is not None:
                speed_score = max(0, 100 - avg_reply_h * 6)
            else:
                speed_score = 50  # нет данных — нейтральный
            score = round(reply_rate * 0.35 + speed_score * 0.35 + read_rate * 0.30)

            employees.append({
                'id':           u['id'],
                'name':         u['full_name'] or u['username'],
                'email':        u['email'],
                'role':         u['role'],
                'dept':         'Сотрудники',   # расширить когда будет поле dept
                'received':     received,
                'sent':         sent,
                'replied':      replied_cnt,
                'read_rate':    read_rate,
                'reply_rate':   reply_rate,
                'avg_reply_h':  avg_reply_h,
                'important':    important_cnt,
                'score':        score,
                'trend':        trend[-7:] if trend else [],
            })

    return jsonify({
        'activity':     activity,
        'folders':      folders,
        'senders':      senders,
        'heatmap':      heatmap,
        'total':        totals.get('total',   0) or 0,
        'total_unread': totals.get('unread',  0) or 0,
        'total_replied':totals.get('replied', 0) or 0,
        'employees':    employees,
        'period': {
            'start': start_date[:10],
            'end':   end_date[:10],
        }
    })


# ==================== API: СОТРУДНИКИ ====================

@app.route('/api/employees')
@login_required
def get_employees():
    """Получить список всех сотрудников"""
    employees = db.get_all_users_extended()
    return jsonify({'employees': employees})


@app.route('/api/employees/<int:user_id>')
@login_required
def get_employee(user_id):
    """Получить одного сотрудника"""
    emp = db.get_user_by_id(user_id)
    if not emp:
        return jsonify({'error': 'Сотрудник не найден'}), 404
    return jsonify({'employee': emp})


@app.route('/api/employees', methods=['POST'])
@admin_required
def create_employee():
    """Создать нового сотрудника"""
    data = request.get_json() or {}
    username  = (data.get('username') or '').strip()
    password  = (data.get('password') or '').strip()
    full_name = (data.get('full_name') or '').strip()
    email     = (data.get('email') or '').strip()
    role      = data.get('role', 'employee')
    is_active = bool(data.get('is_active', True))
    permissions = data.get('permissions', {})

    if not username or not password or not full_name:
        return jsonify({'success': False, 'error': 'Заполните обязательные поля'}), 400
    if len(password) < 4:
        return jsonify({'success': False, 'error': 'Пароль должен быть не менее 4 символов'}), 400

    new_id = db.create_user_extended(
        username=username, password=password, full_name=full_name,
        role=role, email=email, is_active=is_active, permissions=permissions
    )
    if new_id is None:
        return jsonify({'success': False, 'error': 'Логин уже занят'}), 409

    return jsonify({'success': True, 'id': new_id})


@app.route('/api/employees/<int:user_id>', methods=['PUT'])
@admin_required
def update_employee(user_id):
    """Обновить данные сотрудника"""
    data = request.get_json() or {}
    password = (data.get('password') or '').strip() or None

    updated = db.update_user_extended(
        user_id=user_id,
        full_name=data.get('full_name'),
        password=password,
        role=data.get('role'),
        email=data.get('email'),
        is_active=data.get('is_active'),
        permissions=data.get('permissions'),
    )
    if not updated:
        return jsonify({'success': False, 'error': 'Сотрудник не найден'}), 404
    return jsonify({'success': True})


@app.route('/api/employees/<int:user_id>/toggle', methods=['POST'])
@admin_required
def toggle_employee(user_id):
    """Включить / выключить сотрудника"""
    new_status = db.toggle_user_active(user_id)
    if new_status is None:
        return jsonify({'success': False, 'error': 'Сотрудник не найден'}), 404
    return jsonify({'success': True, 'is_active': new_status})


@app.route('/api/employees/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_employee(user_id):
    """Удалить сотрудника"""
    # Защита: нельзя удалить себя
    if session.get('user_id') == user_id:
        return jsonify({'success': False, 'error': 'Нельзя удалить собственный аккаунт'}), 400
    deleted = db.delete_user_by_id(user_id)
    if not deleted:
        return jsonify({'success': False, 'error': 'Сотрудник не найден'}), 404
    return jsonify({'success': True})


@app.route('/api/employees/stats')
@login_required
def employees_stats():
    """Статистика сотрудников"""
    return jsonify(db.get_users_stats())


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
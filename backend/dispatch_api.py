"""
dispatch_api.py - Blueprint с API маршрутами для модуля диспетчеризации
"""

from flask import Blueprint, jsonify, request, session
from functools import wraps
import dispatch_db as ddb
import database as db

dispatch_bp = Blueprint('dispatch', __name__)


# ==================== ДЕКОРАТОРЫ ====================

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Не авторизован'}), 401
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Не авторизован'}), 401
        user = db.get_user(session['username'])
        if not user or user['role'] != 'admin':
            return jsonify({'error': 'Доступ запрещён'}), 403
        return f(*args, **kwargs)
    return decorated

def _current_user_id():
    return session.get('user_id')


# ==================== КАТЕГОРИИ ====================

@dispatch_bp.route('/api/dispatch/categories', methods=['GET'])
@login_required
def get_categories():
    return jsonify({'categories': ddb.get_categories()})

@dispatch_bp.route('/api/dispatch/categories', methods=['POST'])
@admin_required
def create_category():
    data = request.get_json() or {}
    name     = (data.get('name') or '').strip()
    keywords = data.get('keywords', [])
    desc     = data.get('description', '')
    color    = data.get('color', '#2563eb')
    if not name:
        return jsonify({'error': 'Укажите название категории'}), 400
    cat_id = ddb.create_category(name, keywords, desc, color)
    if cat_id is None:
        return jsonify({'error': 'Категория с таким именем уже существует'}), 409
    return jsonify({'success': True, 'id': cat_id})

@dispatch_bp.route('/api/dispatch/categories/<int:cat_id>', methods=['PUT'])
@admin_required
def update_category(cat_id):
    data = request.get_json() or {}
    ddb.update_category(
        cat_id,
        data.get('name', ''),
        data.get('keywords', []),
        data.get('description', ''),
        data.get('color', '#2563eb')
    )
    return jsonify({'success': True})

@dispatch_bp.route('/api/dispatch/categories/<int:cat_id>', methods=['DELETE'])
@admin_required
def delete_category(cat_id):
    ddb.delete_category(cat_id)
    return jsonify({'success': True})


# ==================== ОБЯЗАННОСТИ СОТРУДНИКОВ ====================

@dispatch_bp.route('/api/dispatch/duties/<int:user_id>', methods=['GET'])
@login_required
def get_duties(user_id):
    return jsonify({'duties': ddb.get_employee_duties(user_id)})

@dispatch_bp.route('/api/dispatch/duties/<int:user_id>', methods=['PUT'])
@admin_required
def set_duties(user_id):
    data = request.get_json() or {}
    category_ids = data.get('category_ids', [])
    ddb.set_employee_duties(user_id, category_ids)
    ddb.log_action(
        user_id=_current_user_id(), action='set_duties',
        entity_type='user', entity_id=user_id,
        details={'category_ids': category_ids}
    )
    return jsonify({'success': True})


# ==================== РАБОЧЕЕ МЕСТО ====================

@dispatch_bp.route('/api/dispatch/workbench', methods=['GET'])
@login_required
def get_workbench():
    """Все письма для диспетчера"""
    page      = request.args.get('page', 1, type=int)
    per_page  = request.args.get('per_page', 30, type=int)
    status    = request.args.get('status')
    category  = request.args.get('category_id', type=int)
    emp_id    = request.args.get('user_id', type=int)
    unassigned = request.args.get('unassigned', 'false').lower() == 'true'

    result = ddb.get_workbench_emails(
        page=page, per_page=per_page,
        status=status, category_id=category,
        user_id=emp_id, unassigned_only=unassigned
    )
    return jsonify(result)


@dispatch_bp.route('/api/dispatch/assign/auto', methods=['POST'])
@admin_required
def auto_assign():
    """Авто-назначить одно или несколько писем"""
    data      = request.get_json() or {}
    email_ids = data.get('email_ids', [])
    method    = data.get('method', 'round_robin')  # round_robin | min_load
    sla_hours = data.get('sla_hours', 24)
    admin_id  = _current_user_id()

    results = []
    for eid in email_ids:
        assignment = ddb.auto_assign_email(eid, method=method,
                                           assigned_by=admin_id, sla_hours=sla_hours)
        results.append(assignment)

    return jsonify({'success': True, 'assignments': results})


@dispatch_bp.route('/api/dispatch/assign/manual', methods=['POST'])
@admin_required
def manual_assign():
    """Ручное назначение"""
    data        = request.get_json() or {}
    email_id    = data.get('email_id')
    user_id     = data.get('user_id')
    category_id = data.get('category_id')
    sla_hours   = data.get('sla_hours', 24)
    notes       = data.get('notes', '')
    admin_id    = _current_user_id()

    if not email_id or not user_id:
        return jsonify({'error': 'Укажите email_id и user_id'}), 400

    assignment = ddb.manual_assign_email(
        email_id, user_id, admin_id,
        category_id=category_id, sla_hours=sla_hours, notes=notes
    )
    return jsonify({'success': True, 'assignment': assignment})


@dispatch_bp.route('/api/dispatch/assign/batch-auto', methods=['POST'])
@admin_required
def batch_auto_assign():
    """Авто-назначить все нераспределённые письма"""
    data      = request.get_json() or {}
    method    = data.get('method', 'round_robin')
    sla_hours = data.get('sla_hours', 24)
    admin_id  = _current_user_id()

    with db.get_db() as conn:
        unassigned = conn.execute("""
            SELECT e.id FROM emails e
            LEFT JOIN email_assignments ea ON ea.email_id = e.id
            WHERE ea.id IS NULL
            ORDER BY e.date_received DESC
            LIMIT 500
        """).fetchall()

    count = 0
    for row in unassigned:
        ddb.auto_assign_email(row['id'], method=method,
                              assigned_by=admin_id, sla_hours=sla_hours)
        count += 1

    ddb.log_action(user_id=admin_id, action='batch_auto_assign',
                   details={'count': count, 'method': method})
    return jsonify({'success': True, 'assigned': count})


# ==================== СТАТУСЫ ====================

@dispatch_bp.route('/api/dispatch/assignment/<int:assignment_id>/status', methods=['PUT'])
@login_required
def change_status(assignment_id):
    data       = request.get_json() or {}
    new_status = data.get('status')
    comment    = data.get('comment', '')
    user_id    = _current_user_id()

    if new_status not in ('new', 'in_progress', 'done'):
        return jsonify({'error': 'Недопустимый статус'}), 400

    ok, msg = ddb.change_status(assignment_id, new_status, user_id, comment)
    if not ok:
        return jsonify({'error': msg}), 400
    return jsonify({'success': True})


@dispatch_bp.route('/api/dispatch/assignment/<int:assignment_id>/history', methods=['GET'])
@login_required
def status_history(assignment_id):
    history = ddb.get_status_history(assignment_id)
    return jsonify({'history': history})


@dispatch_bp.route('/api/dispatch/assignment/<int:assignment_id>', methods=['GET'])
@login_required
def get_assignment(assignment_id):
    a = ddb.get_assignment_by_id(assignment_id)
    if not a:
        return jsonify({'error': 'Назначение не найдено'}), 404
    a['history'] = ddb.get_status_history(assignment_id)
    return jsonify({'assignment': a})


@dispatch_bp.route('/api/dispatch/email/<int:email_id>/assignment', methods=['GET'])
@login_required
def get_email_assignment(email_id):
    a = ddb.get_assignment_by_email(email_id)
    if a:
        a['history'] = ddb.get_status_history(a['id'])
    return jsonify({'assignment': a})


# ==================== ЛИЧНЫЙ КАБИНЕТ ====================

@dispatch_bp.route('/api/dispatch/my', methods=['GET'])
@login_required
def my_assignments():
    """Письма текущего сотрудника"""
    user_id  = _current_user_id()
    status   = request.args.get('status')
    date_from = request.args.get('date_from')
    date_to  = request.args.get('date_to')
    page     = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    result = ddb.get_my_assignments(
        user_id, status=status,
        date_from=date_from, date_to=date_to,
        page=page, per_page=per_page
    )
    return jsonify(result)


@dispatch_bp.route('/api/dispatch/my/take/<int:assignment_id>', methods=['POST'])
@login_required
def take_assignment(assignment_id):
    """Взять письмо в работу"""
    user_id = _current_user_id()
    ok, msg = ddb.change_status(assignment_id, 'in_progress', user_id, 'Взято в работу')
    if not ok:
        return jsonify({'error': msg}), 400
    return jsonify({'success': True})


@dispatch_bp.route('/api/dispatch/my/complete/<int:assignment_id>', methods=['POST'])
@login_required
def complete_assignment(assignment_id):
    """Завершить заявку"""
    data    = request.get_json() or {}
    comment = data.get('comment', 'Завершено')
    user_id = _current_user_id()
    ok, msg = ddb.change_status(assignment_id, 'done', user_id, comment)
    if not ok:
        return jsonify({'error': msg}), 400
    return jsonify({'success': True})


@dispatch_bp.route('/api/dispatch/my/reopen/<int:assignment_id>', methods=['POST'])
@login_required
def reopen_assignment(assignment_id):
    """Вернуть в процесс"""
    data    = request.get_json() or {}
    comment = data.get('comment', 'Возвращено в работу')
    user_id = _current_user_id()
    ok, msg = ddb.change_status(assignment_id, 'in_progress', user_id, comment)
    if not ok:
        return jsonify({'error': msg}), 400
    return jsonify({'success': True})


# ==================== УВЕДОМЛЕНИЯ ====================

@dispatch_bp.route('/api/dispatch/notifications', methods=['GET'])
@login_required
def get_notifications():
    user_id     = _current_user_id()
    unread_only = request.args.get('unread', 'false').lower() == 'true'
    limit       = request.args.get('limit', 50, type=int)
    notifs      = ddb.get_notifications(user_id, unread_only=unread_only, limit=limit)
    unread_count = ddb.get_unread_count(user_id)
    return jsonify({'notifications': notifs, 'unread_count': unread_count})


@dispatch_bp.route('/api/dispatch/notifications/read', methods=['POST'])
@login_required
def mark_read():
    user_id = _current_user_id()
    data    = request.get_json() or {}
    ids     = data.get('ids')  # None = пометить все
    ddb.mark_notifications_read(user_id, ids)
    return jsonify({'success': True})


@dispatch_bp.route('/api/dispatch/notifications/count', methods=['GET'])
@login_required
def notif_count():
    user_id = _current_user_id()
    return jsonify({'count': ddb.get_unread_count(user_id)})


# ==================== ДАШБОРД ====================

@dispatch_bp.route('/api/dispatch/dashboard', methods=['GET'])
@login_required
def dashboard():
    data = ddb.get_dispatch_dashboard()
    return jsonify(data)


# ==================== ЛОГИ ДЕЙСТВИЙ ====================

@dispatch_bp.route('/api/dispatch/logs', methods=['GET'])
@admin_required
def action_logs():
    user_id = request.args.get('user_id', type=int)
    action  = request.args.get('action')
    limit   = request.args.get('limit', 100, type=int)
    logs    = ddb.get_action_logs(user_id=user_id, action=action, limit=limit)
    return jsonify({'logs': logs})


# ==================== НАПОМИНАНИЯ (ручной триггер) ====================

@dispatch_bp.route('/api/dispatch/reminders/process', methods=['POST'])
@admin_required
def process_reminders():
    count = ddb.process_due_reminders()
    return jsonify({'success': True, 'processed': count})


# ==================== РЕГИСТРАЦИЯ ====================

def register_dispatch_blueprint(app):
    ddb.init_dispatch_tables()
    app.register_blueprint(dispatch_bp)
    print("✅ Dispatch blueprint зарегистрирован")

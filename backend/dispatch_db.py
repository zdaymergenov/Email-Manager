"""
dispatch_db.py - База данных для модуля диспетчеризации:
- Назначение писем сотрудникам
- Статусы заявок
- История изменений статусов
- Напоминания
- Обязанности сотрудников
- Логи действий
- SLA
"""

import sqlite3
import json
from datetime import datetime, timedelta
import database as db

# ==================== ИНИЦИАЛИЗАЦИЯ ТАБЛИЦ ====================

def init_dispatch_tables():
    """Инициализировать таблицы для модуля диспетчеризации"""
    with db.get_db() as conn:
        cursor = conn.cursor()

        # ── Категории писем ──────────────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                keywords TEXT,           -- JSON-список ключевых слов
                description TEXT,
                color TEXT DEFAULT '#2563eb',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # ── Обязанности сотрудников ──────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS employee_duties (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                category_id INTEGER NOT NULL,
                priority INTEGER DEFAULT 1,  -- чем ниже, тем выше приоритет
                FOREIGN KEY(user_id)     REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(category_id) REFERENCES email_categories(id) ON DELETE CASCADE,
                UNIQUE(user_id, category_id)
            )
        """)

        # ── Назначения писем ─────────────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email_id   INTEGER NOT NULL,
                user_id    INTEGER,          -- NULL = не назначено
                category_id INTEGER,
                status     TEXT DEFAULT 'new',   -- new | in_progress | done
                assigned_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                taken_at     DATETIME,           -- взято в работу
                completed_at DATETIME,           -- завершено
                sla_deadline DATETIME,           -- дедлайн SLA
                assigned_by  INTEGER,            -- кто назначил (admin)
                notes        TEXT,
                FOREIGN KEY(email_id)    REFERENCES emails(id)   ON DELETE CASCADE,
                FOREIGN KEY(user_id)     REFERENCES users(id)    ON DELETE SET NULL,
                FOREIGN KEY(category_id) REFERENCES email_categories(id),
                FOREIGN KEY(assigned_by) REFERENCES users(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_assign_email ON email_assignments(email_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_assign_user  ON email_assignments(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_assign_status ON email_assignments(status)")

        # ── История статусов ─────────────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS status_history (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id INTEGER NOT NULL,
                old_status    TEXT,
                new_status    TEXT NOT NULL,
                changed_by    INTEGER,
                changed_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                comment       TEXT,
                FOREIGN KEY(assignment_id) REFERENCES email_assignments(id) ON DELETE CASCADE,
                FOREIGN KEY(changed_by)    REFERENCES users(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sh_assignment ON status_history(assignment_id)")

        # ── Напоминания ──────────────────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reminders (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id INTEGER NOT NULL,
                user_id       INTEGER NOT NULL,
                remind_at     DATETIME NOT NULL,
                sent          BOOLEAN DEFAULT 0,
                sent_at       DATETIME,
                message       TEXT,
                FOREIGN KEY(assignment_id) REFERENCES email_assignments(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id)       REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_rem_user ON reminders(user_id, sent)")

        # ── Уведомления (внутренние) ──────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                type        TEXT NOT NULL,  -- reminder | assigned | status_change | sla_warning
                title       TEXT NOT NULL,
                body        TEXT,
                is_read     BOOLEAN DEFAULT 0,
                link_url    TEXT,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read)")

        # ── Лог действий сотрудников ─────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS action_logs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER,
                action      TEXT NOT NULL,   -- assign | take | complete | reopen | reassign | login | etc.
                entity_type TEXT,            -- email | assignment | user
                entity_id   INTEGER,
                details     TEXT,            -- JSON
                ip_address  TEXT,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_log_user   ON action_logs(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_log_action ON action_logs(action)")

        # ── Round-robin счётчик ──────────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS rr_counters (
                category_id INTEGER PRIMARY KEY,
                last_index  INTEGER DEFAULT 0,
                FOREIGN KEY(category_id) REFERENCES email_categories(id) ON DELETE CASCADE
            )
        """)

        # ── Добавляем колонку permissions в users если нет ──────────────
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '{}'")
        except Exception:
            pass

        # ── Добавляем колонку categories_raw в email_assignments если нет
        try:
            cursor.execute("ALTER TABLE email_assignments ADD COLUMN auto_detected INTEGER DEFAULT 0")
        except Exception:
            pass

        conn.commit()

        # Заполняем базовые категории если пусто
        cursor.execute("SELECT COUNT(*) as c FROM email_categories")
        if cursor.fetchone()['c'] == 0:
            _seed_default_categories(conn)

        print("✅ Таблицы диспетчеризации инициализированы")


def _seed_default_categories(conn):
    """Заполнить базовые категории писем"""
    categories = [
        ('Доставка',  '["доставка","трек","отслеживание","курьер","привезти","отгрузка","накладная","СДЭК","транспорт"]', '#2563eb'),
        ('Возврат',   '["возврат","вернуть","брак","отказ","отмена","компенсация","refund"]',                              '#dc2626'),
        ('Склад',     '["склад","остаток","запас","инвентарь","хранение","поступление","приёмка"]',                        '#16a34a'),
        ('Оплата',    '["оплата","счёт","invoice","платёж","задолженность","переплата","реквизиты"]',                      '#f59e0b'),
        ('Поддержка', '["помощь","проблема","ошибка","не работает","поддержка","вопрос","консультация"]',                  '#8b5cf6'),
        ('Прочее',    '[]',                                                                                                '#64748b'),
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO email_categories(name, keywords, color) VALUES (?,?,?)",
        categories
    )
    conn.commit()


# ==================== КАТЕГОРИИ ====================

def get_categories():
    with db.get_db() as conn:
        rows = conn.execute("SELECT * FROM email_categories ORDER BY name").fetchall()
        return [dict(r) for r in rows]

def create_category(name, keywords, description='', color='#2563eb'):
    with db.get_db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO email_categories(name,keywords,description,color) VALUES(?,?,?,?)",
                (name, json.dumps(keywords, ensure_ascii=False), description, color)
            )
            conn.commit()
            return cur.lastrowid
        except sqlite3.IntegrityError:
            return None

def update_category(cat_id, name, keywords, description='', color='#2563eb'):
    with db.get_db() as conn:
        conn.execute(
            "UPDATE email_categories SET name=?,keywords=?,description=?,color=? WHERE id=?",
            (name, json.dumps(keywords, ensure_ascii=False), description, color, cat_id)
        )
        conn.commit()

def delete_category(cat_id):
    with db.get_db() as conn:
        conn.execute("DELETE FROM email_categories WHERE id=?", (cat_id,))
        conn.commit()


# ==================== ОБЯЗАННОСТИ СОТРУДНИКОВ ====================

def get_employee_duties(user_id):
    with db.get_db() as conn:
        rows = conn.execute("""
            SELECT ed.*, ec.name as category_name, ec.color
            FROM employee_duties ed
            JOIN email_categories ec ON ec.id = ed.category_id
            WHERE ed.user_id = ?
        """, (user_id,)).fetchall()
        return [dict(r) for r in rows]

def set_employee_duties(user_id, category_ids):
    """Полностью заменить список обязанностей сотрудника"""
    with db.get_db() as conn:
        conn.execute("DELETE FROM employee_duties WHERE user_id=?", (user_id,))
        for idx, cat_id in enumerate(category_ids):
            conn.execute(
                "INSERT OR IGNORE INTO employee_duties(user_id,category_id,priority) VALUES(?,?,?)",
                (user_id, cat_id, idx)
            )
        conn.commit()

def get_duties_by_category(category_id):
    """Список сотрудников, ответственных за категорию (активные)"""
    with db.get_db() as conn:
        rows = conn.execute("""
            SELECT u.id, u.full_name, u.username, u.email, ed.priority
            FROM employee_duties ed
            JOIN users u ON u.id = ed.user_id
            WHERE ed.category_id = ? AND u.is_active = 1
            ORDER BY ed.priority
        """, (category_id,)).fetchall()
        return [dict(r) for r in rows]


# ==================== КЛАССИФИКАЦИЯ ПИСЬМА ====================

def classify_email(email_data):
    """
    Определить категорию письма по ключевым словам.
    Возвращает category_id или None.
    """
    text = ' '.join([
        (email_data.get('subject') or ''),
        (email_data.get('body') or '')[:500],
        (email_data.get('sender_name') or ''),
    ]).lower()

    categories = get_categories()
    best_id    = None
    best_score = 0

    for cat in categories:
        if cat['name'] == 'Прочее':
            continue
        try:
            keywords = json.loads(cat['keywords'] or '[]')
        except Exception:
            keywords = []
        score = sum(1 for kw in keywords if kw.lower() in text)
        if score > best_score:
            best_score = score
            best_id    = cat['id']

    if best_id is None:
        # Категория «Прочее»
        with db.get_db() as conn:
            row = conn.execute(
                "SELECT id FROM email_categories WHERE name='Прочее'"
            ).fetchone()
            if row:
                best_id = row['id']

    return best_id


# ==================== НАЗНАЧЕНИЕ ПИСЕМ ====================

def _get_employee_load(user_id):
    """Количество активных заявок у сотрудника"""
    with db.get_db() as conn:
        row = conn.execute("""
            SELECT COUNT(*) as c FROM email_assignments
            WHERE user_id=? AND status IN ('new','in_progress')
        """, (user_id,)).fetchone()
        return row['c'] if row else 0

def _round_robin_pick(category_id, candidates):
    """Выбрать следующего сотрудника по round-robin для категории"""
    if not candidates:
        return None
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT last_index FROM rr_counters WHERE category_id=?", (category_id,)
        ).fetchone()
        idx = (row['last_index'] if row else 0) % len(candidates)
        chosen = candidates[idx]
        new_idx = (idx + 1) % len(candidates)
        conn.execute("""
            INSERT INTO rr_counters(category_id, last_index) VALUES(?,?)
            ON CONFLICT(category_id) DO UPDATE SET last_index=excluded.last_index
        """, (category_id, new_idx))
        conn.commit()
    return chosen

def _min_load_pick(candidates):
    """Выбрать сотрудника с минимальной загрузкой"""
    if not candidates:
        return None
    loads = [(u, _get_employee_load(u['id'])) for u in candidates]
    loads.sort(key=lambda x: x[1])
    return loads[0][0]

def auto_assign_email(email_id, method='round_robin', assigned_by=None, sla_hours=24):
    """
    Автоматически назначить письмо.
    method: 'round_robin' | 'min_load'
    Возвращает dict назначения или None.
    """
    with db.get_db() as conn:
        # Уже назначено?
        existing = conn.execute(
            "SELECT id FROM email_assignments WHERE email_id=?", (email_id,)
        ).fetchone()
        if existing:
            return dict(conn.execute(
                "SELECT * FROM email_assignments WHERE email_id=?", (email_id,)
            ).fetchone())

        email = conn.execute("SELECT * FROM emails WHERE id=?", (email_id,)).fetchone()
        if not email:
            return None

    cat_id    = classify_email(dict(email))
    candidates = get_duties_by_category(cat_id) if cat_id else []

    if method == 'round_robin':
        chosen = _round_robin_pick(cat_id, candidates)
    else:
        chosen = _min_load_pick(candidates)

    user_id  = chosen['id'] if chosen else None
    sla_dl   = datetime.now() + timedelta(hours=sla_hours)

    with db.get_db() as conn:
        cur = conn.execute("""
            INSERT INTO email_assignments
                (email_id, user_id, category_id, status, sla_deadline, assigned_by, auto_detected)
            VALUES (?,?,?,?,?,?,1)
        """, (email_id, user_id, cat_id, 'new', sla_dl.isoformat(), assigned_by))
        assignment_id = cur.lastrowid
        _log_status_change(conn, assignment_id, None, 'new', assigned_by, 'Авто-назначение')
        conn.commit()

    # Уведомление сотруднику
    if user_id:
        _create_notification(user_id, 'assigned',
            'Новое письмо назначено вам',
            f'Письмо #{email_id} назначено вам. Категория: {cat_id}')

    log_action(user_id=assigned_by, action='assign', entity_type='email',
               entity_id=email_id, details={'assignment_id': assignment_id,
                                             'category_id': cat_id, 'method': method})
    return get_assignment_by_id(assignment_id)


def manual_assign_email(email_id, user_id, admin_id, category_id=None, sla_hours=24, notes=''):
    """Ручное назначение администратором"""
    with db.get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM email_assignments WHERE email_id=?", (email_id,)
        ).fetchone()
        sla_dl = (datetime.now() + timedelta(hours=sla_hours)).isoformat()

        if existing:
            conn.execute("""
                UPDATE email_assignments
                SET user_id=?, category_id=COALESCE(?,category_id),
                    assigned_by=?, sla_deadline=?, notes=?, auto_detected=0
                WHERE email_id=?
            """, (user_id, category_id, admin_id, sla_dl, notes, email_id))
            assignment_id = existing['id']
        else:
            cat_id = category_id or classify_email(
                dict(conn.execute("SELECT * FROM emails WHERE id=?", (email_id,)).fetchone() or {})
            )
            cur = conn.execute("""
                INSERT INTO email_assignments
                    (email_id, user_id, category_id, status, sla_deadline, assigned_by, notes)
                VALUES (?,?,?,?,?,?,?)
            """, (email_id, user_id, cat_id, 'new', sla_dl, admin_id, notes))
            assignment_id = cur.lastrowid

        _log_status_change(conn, assignment_id, None, 'new', admin_id, 'Ручное назначение')
        conn.commit()

    if user_id:
        _create_notification(user_id, 'assigned',
            'Вам назначено письмо',
            f'Администратор назначил вам письмо #{email_id}')

    log_action(user_id=admin_id, action='manual_assign', entity_type='email',
               entity_id=email_id, details={'assigned_to': user_id, 'assignment_id': assignment_id})
    return get_assignment_by_id(assignment_id)


def get_assignment_by_id(assignment_id):
    with db.get_db() as conn:
        row = conn.execute("""
            SELECT ea.*,
                   u.full_name as employee_name, u.username, u.email as employee_email,
                   ec.name as category_name, ec.color as category_color
            FROM email_assignments ea
            LEFT JOIN users u ON u.id = ea.user_id
            LEFT JOIN email_categories ec ON ec.id = ea.category_id
            WHERE ea.id=?
        """, (assignment_id,)).fetchone()
        return dict(row) if row else None

def get_assignment_by_email(email_id):
    with db.get_db() as conn:
        row = conn.execute("""
            SELECT ea.*,
                   u.full_name as employee_name, u.username, u.email as employee_email,
                   ec.name as category_name, ec.color as category_color
            FROM email_assignments ea
            LEFT JOIN users u ON u.id = ea.user_id
            LEFT JOIN email_categories ec ON ec.id = ea.category_id
            WHERE ea.email_id=?
        """, (email_id,)).fetchone()
        return dict(row) if row else None


# ==================== УПРАВЛЕНИЕ СТАТУСАМИ ====================

def change_status(assignment_id, new_status, user_id, comment=''):
    """
    Изменить статус заявки.
    Разрешённые переходы:
      new        → in_progress  (при взятии в работу)
      in_progress→ done         (завершить)
      done       → in_progress  (вернуть в работу)
    """
    allowed = {
        'new':         ['in_progress'],
        'in_progress': ['done'],
        'done':        ['in_progress'],
    }
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT * FROM email_assignments WHERE id=?", (assignment_id,)
        ).fetchone()
        if not row:
            return False, 'Назначение не найдено'

        old_status = row['status']
        if new_status not in allowed.get(old_status, []):
            return False, f'Переход {old_status}→{new_status} не разрешён'

        now = datetime.now().isoformat()
        updates = {'status': new_status}
        if new_status == 'in_progress' and not row['taken_at']:
            updates['taken_at'] = now
        if new_status == 'done':
            updates['completed_at'] = now

        set_clause = ', '.join(f"{k}=?" for k in updates)
        conn.execute(
            f"UPDATE email_assignments SET {set_clause} WHERE id=?",
            (*updates.values(), assignment_id)
        )
        _log_status_change(conn, assignment_id, old_status, new_status, user_id, comment)
        conn.commit()

    # Уведомление
    uid = row['user_id']
    status_labels = {'in_progress': 'В процессе', 'done': 'Завершено', 'new': 'Новое'}
    if uid and uid != user_id:
        _create_notification(uid, 'status_change',
            f'Статус изменён: {status_labels.get(new_status, new_status)}',
            f'Заявка #{assignment_id} переведена в статус «{status_labels.get(new_status)}»')

    log_action(user_id=user_id, action=f'status_{new_status}', entity_type='assignment',
               entity_id=assignment_id, details={'old': old_status, 'new': new_status})

    # Управление напоминаниями
    if new_status == 'in_progress':
        schedule_reminder(assignment_id, uid, hours=3)
    elif new_status == 'done':
        cancel_reminders(assignment_id)

    return True, 'OK'


def _log_status_change(conn, assignment_id, old_status, new_status, changed_by, comment=''):
    conn.execute("""
        INSERT INTO status_history(assignment_id, old_status, new_status, changed_by, comment)
        VALUES (?,?,?,?,?)
    """, (assignment_id, old_status, new_status, changed_by, comment))


def get_status_history(assignment_id):
    with db.get_db() as conn:
        rows = conn.execute("""
            SELECT sh.*, u.full_name as changed_by_name
            FROM status_history sh
            LEFT JOIN users u ON u.id = sh.changed_by
            WHERE sh.assignment_id=?
            ORDER BY sh.changed_at
        """, (assignment_id,)).fetchall()
        return [dict(r) for r in rows]


# ==================== РАБОЧЕЕ МЕСТО ====================

def get_workbench_emails(page=1, per_page=30, status=None, category_id=None,
                          user_id=None, unassigned_only=False):
    """Письма для вкладки Рабочее место"""
    offset = (page - 1) * per_page
    conditions = []
    params     = []

    if status:
        conditions.append("COALESCE(ea.status,'new') = ?")
        params.append(status)
    if category_id:
        conditions.append("ea.category_id = ?")
        params.append(category_id)
    if user_id:
        conditions.append("ea.user_id = ?")
        params.append(user_id)
    if unassigned_only:
        conditions.append("ea.user_id IS NULL")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.get_db() as conn:
        total = conn.execute(f"""
            SELECT COUNT(*) as c FROM emails e
            LEFT JOIN email_assignments ea ON ea.email_id = e.id
            {where}
        """, params).fetchone()['c']

        rows = conn.execute(f"""
            SELECT e.id, e.subject, e.sender_name, e.sender_email,
                   e.date_received, e.is_read, e.importance,
                   e.attachments_count,
                   ea.id       as assignment_id,
                   ea.status,
                   ea.user_id,
                   u.full_name as employee_name,
                   ea.category_id,
                   ec.name     as category_name,
                   ec.color    as category_color,
                   ea.sla_deadline,
                   ea.assigned_at,
                   ea.taken_at,
                   ea.completed_at
            FROM emails e
            LEFT JOIN email_assignments ea ON ea.email_id = e.id
            LEFT JOIN users u             ON u.id = ea.user_id
            LEFT JOIN email_categories ec ON ec.id = ea.category_id
            {where}
            ORDER BY e.date_received DESC
            LIMIT ? OFFSET ?
        """, params + [per_page, offset]).fetchall()

        return {
            'emails': [dict(r) for r in rows],
            'total': total,
            'page': page,
            'per_page': per_page,
            'pages': (total + per_page - 1) // per_page
        }


def get_my_assignments(user_id, status=None, date_from=None, date_to=None,
                        page=1, per_page=20):
    """Письма личного кабинета сотрудника"""
    offset = (page - 1) * per_page
    conditions = ["ea.user_id = ?"]
    params     = [user_id]

    if status:
        conditions.append("ea.status = ?")
        params.append(status)
    if date_from:
        conditions.append("e.date_received >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("e.date_received <= ?")
        params.append(date_to)

    where = "WHERE " + " AND ".join(conditions)

    with db.get_db() as conn:
        total = conn.execute(f"""
            SELECT COUNT(*) as c
            FROM email_assignments ea
            JOIN emails e ON e.id = ea.email_id
            {where}
        """, params).fetchone()['c']

        rows = conn.execute(f"""
            SELECT e.id, e.subject, e.sender_name, e.sender_email,
                   e.date_received, e.body, e.is_read, e.importance,
                   e.attachments_count,
                   ea.id          as assignment_id,
                   ea.status,
                   ea.category_id,
                   ec.name        as category_name,
                   ec.color       as category_color,
                   ea.sla_deadline,
                   ea.taken_at,
                   ea.completed_at,
                   ea.notes
            FROM email_assignments ea
            JOIN emails e           ON e.id  = ea.email_id
            LEFT JOIN email_categories ec ON ec.id = ea.category_id
            {where}
            ORDER BY e.date_received DESC
            LIMIT ? OFFSET ?
        """, params + [per_page, offset]).fetchall()

        return {
            'assignments': [dict(r) for r in rows],
            'total': total,
            'page': page,
            'per_page': per_page,
            'pages': (total + per_page - 1) // per_page
        }


# ==================== НАПОМИНАНИЯ ====================

def schedule_reminder(assignment_id, user_id, hours=3):
    """Запланировать напоминание через N часов"""
    if not user_id:
        return
    remind_at = (datetime.now() + timedelta(hours=hours)).isoformat()
    with db.get_db() as conn:
        # Отменяем предыдущие неотправленные
        conn.execute("""
            UPDATE reminders SET sent=1 WHERE assignment_id=? AND user_id=? AND sent=0
        """, (assignment_id, user_id))
        conn.execute("""
            INSERT INTO reminders(assignment_id, user_id, remind_at, message)
            VALUES(?,?,?,?)
        """, (assignment_id, user_id, remind_at,
              f'Напоминание: письмо в работе уже {hours}ч без активности'))
        conn.commit()

def cancel_reminders(assignment_id):
    with db.get_db() as conn:
        conn.execute("UPDATE reminders SET sent=1 WHERE assignment_id=? AND sent=0",
                     (assignment_id,))
        conn.commit()

def process_due_reminders():
    """
    Вызывается периодически (APScheduler или простым потоком).
    Обрабатывает просроченные напоминания: создаёт уведомления.
    """
    now = datetime.now().isoformat()
    with db.get_db() as conn:
        due = conn.execute("""
            SELECT r.*, ea.email_id
            FROM reminders r
            JOIN email_assignments ea ON ea.id = r.assignment_id
            WHERE r.sent=0 AND r.remind_at <= ?
              AND ea.status = 'in_progress'
        """, (now,)).fetchall()

        for rem in due:
            _create_notification(
                rem['user_id'], 'reminder',
                '⏰ Напоминание о письме',
                f'Письмо #{rem["email_id"]} всё ещё в работе. Нет активности.'
            )
            # Ставим следующее напоминание через 3 часа
            next_remind = (datetime.now() + timedelta(hours=3)).isoformat()
            conn.execute("""
                UPDATE reminders SET sent=1, sent_at=CURRENT_TIMESTAMP WHERE id=?
            """, (rem['id'],))
            conn.execute("""
                INSERT INTO reminders(assignment_id, user_id, remind_at, message)
                VALUES(?,?,?,?)
            """, (rem['assignment_id'], rem['user_id'], next_remind,
                  'Повторное напоминание: письмо без активности'))
        conn.commit()
    return len(due)


# ==================== УВЕДОМЛЕНИЯ ====================

def _create_notification(user_id, ntype, title, body='', link_url=''):
    with db.get_db() as conn:
        conn.execute("""
            INSERT INTO notifications(user_id, type, title, body, link_url)
            VALUES(?,?,?,?,?)
        """, (user_id, ntype, title, body, link_url))
        conn.commit()

def get_notifications(user_id, unread_only=False, limit=50):
    with db.get_db() as conn:
        cond = "WHERE n.user_id=?" + (" AND n.is_read=0" if unread_only else "")
        rows = conn.execute(f"""
            SELECT * FROM notifications {cond}
            ORDER BY created_at DESC LIMIT ?
        """, (user_id, limit)).fetchall()
        return [dict(r) for r in rows]

def mark_notifications_read(user_id, notification_ids=None):
    with db.get_db() as conn:
        if notification_ids:
            placeholders = ','.join('?' * len(notification_ids))
            conn.execute(f"""
                UPDATE notifications SET is_read=1
                WHERE user_id=? AND id IN ({placeholders})
            """, [user_id] + notification_ids)
        else:
            conn.execute(
                "UPDATE notifications SET is_read=1 WHERE user_id=?", (user_id,)
            )
        conn.commit()

def get_unread_count(user_id):
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0", (user_id,)
        ).fetchone()
        return row['c'] if row else 0


# ==================== ЛОГИ ДЕЙСТВИЙ ====================

def log_action(user_id, action, entity_type=None, entity_id=None, details=None, ip=None):
    with db.get_db() as conn:
        conn.execute("""
            INSERT INTO action_logs(user_id, action, entity_type, entity_id, details, ip_address)
            VALUES(?,?,?,?,?,?)
        """, (user_id, action, entity_type, entity_id,
              json.dumps(details, ensure_ascii=False) if details else None, ip))
        conn.commit()

def get_action_logs(user_id=None, action=None, limit=100):
    conditions = []
    params     = []
    if user_id:
        conditions.append("al.user_id=?")
        params.append(user_id)
    if action:
        conditions.append("al.action=?")
        params.append(action)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.get_db() as conn:
        rows = conn.execute(f"""
            SELECT al.*, u.full_name, u.username
            FROM action_logs al
            LEFT JOIN users u ON u.id = al.user_id
            {where}
            ORDER BY al.created_at DESC LIMIT ?
        """, params + [limit]).fetchall()
        return [dict(r) for r in rows]


# ==================== ДАШБОРД ====================

def get_dispatch_dashboard():
    """Данные дашборда: загрузка сотрудников, SLA, статистика"""
    with db.get_db() as conn:
        # Загрузка по сотрудникам
        employees = conn.execute("""
            SELECT u.id, u.full_name, u.username,
                   COUNT(ea.id)                                              as total,
                   SUM(ea.status='new')                                      as new_count,
                   SUM(ea.status='in_progress')                              as in_progress_count,
                   SUM(ea.status='done')                                     as done_count,
                   SUM(ea.status IN ('new','in_progress') AND
                       ea.sla_deadline < CURRENT_TIMESTAMP)                  as overdue_count,
                   AVG(CASE WHEN ea.taken_at IS NOT NULL
                       THEN (JULIANDAY(ea.taken_at) - JULIANDAY(ea.assigned_at))*24
                       ELSE NULL END)                                        as avg_take_h,
                   AVG(CASE WHEN ea.completed_at IS NOT NULL
                       THEN (JULIANDAY(ea.completed_at) - JULIANDAY(ea.assigned_at))*24
                       ELSE NULL END)                                        as avg_close_h
            FROM users u
            LEFT JOIN email_assignments ea ON ea.user_id = u.id
            WHERE u.is_active=1
            GROUP BY u.id
            ORDER BY in_progress_count DESC
        """).fetchall()

        # По категориям
        categories = conn.execute("""
            SELECT ec.name, ec.color,
                   COUNT(ea.id) as total,
                   SUM(ea.status='new') as new_count,
                   SUM(ea.status='in_progress') as in_progress_count,
                   SUM(ea.status='done') as done_count
            FROM email_categories ec
            LEFT JOIN email_assignments ea ON ea.category_id = ec.id
            GROUP BY ec.id ORDER BY total DESC
        """).fetchall()

        # Общая статистика
        stats = conn.execute("""
            SELECT COUNT(*) as total,
                   SUM(status='new') as new_count,
                   SUM(status='in_progress') as in_progress_count,
                   SUM(status='done') as done_count,
                   SUM(status IN ('new','in_progress') AND
                       sla_deadline < CURRENT_TIMESTAMP) as overdue_count,
                   SUM(user_id IS NULL) as unassigned_count
            FROM email_assignments
        """).fetchone()

        return {
            'employees': [dict(r) for r in employees],
            'categories': [dict(r) for r in categories],
            'stats':      dict(stats) if stats else {}
        }

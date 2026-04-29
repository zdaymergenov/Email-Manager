// workbench.js  —  Вкладка «Рабочее место» + диспетчеризация

// ── State ────────────────────────────────────────────────────────
let wb = {
  page: 1, perPage: 30,
  status: '', categoryId: '', userId: '', unassigned: false,
  search: '',
  emails: [], total: 0,
  categories: [], employees: [],
  dashStats: {}
};

// ── Init ─────────────────────────────────────────────────────────
export async function initWorkbench() {
  await Promise.all([loadCategories(), loadEmployees()]);
  await loadDashboard();
  await loadWorkbench();
  bindWbEvents();
}

// ── API calls ─────────────────────────────────────────────────────
async function loadCategories() {
  const r = await fetch('/api/dispatch/categories');
  const d = await r.json();
  wb.categories = d.categories || [];
}

async function loadEmployees() {
  const r = await fetch('/api/employees');
  const d = await r.json();
  wb.employees = d.employees || [];
}

async function loadDashboard() {
  const r = await fetch('/api/dispatch/dashboard');
  wb.dashStats = await r.json();
  renderDashStats();
}

async function loadWorkbench() {
  const params = new URLSearchParams({
    page: wb.page, per_page: wb.perPage
  });
  if (wb.status)     params.set('status', wb.status);
  if (wb.categoryId) params.set('category_id', wb.categoryId);
  if (wb.userId)     params.set('user_id', wb.userId);
  if (wb.unassigned) params.set('unassigned', 'true');

  const r = await fetch('/api/dispatch/workbench?' + params);
  const d = await r.json();
  wb.emails = d.emails || [];
  wb.total  = d.total  || 0;
  renderWbTable();
  renderPagination();
}

// ── Render Dashboard ─────────────────────────────────────────────
function renderDashStats() {
  const s = wb.dashStats.stats || {};
  const el = id => document.getElementById(id);

  const set = (elId, val) => { const e = el(elId); if (e) e.textContent = val ?? '—'; };
  set('wbStatTotal',       s.total || 0);
  set('wbStatNew',         s.new_count || 0);
  set('wbStatInProgress',  s.in_progress_count || 0);
  set('wbStatDone',        s.done_count || 0);
  set('wbStatOverdue',     s.overdue_count || 0);
  set('wbStatUnassigned',  s.unassigned_count || 0);

  // Таблица сотрудников
  const tbody = document.getElementById('wbEmpTableBody');
  if (!tbody) return;
  const emps = wb.dashStats.employees || [];
  const maxLoad = Math.max(1, ...emps.map(e => (e.in_progress_count || 0) + (e.new_count || 0)));

  tbody.innerHTML = emps.map(e => {
    const active  = (e.in_progress_count || 0) + (e.new_count || 0);
    const pct     = Math.round(active / maxLoad * 100);
    const barCls  = pct < 40 ? 'low' : pct < 75 ? 'medium' : 'high';
    const initials = (e.full_name || e.username || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `
      <tr>
        <td>
          <div class="assignee-cell">
            <div class="assignee-avatar">${initials}</div>
            <span class="assignee-name">${e.full_name || e.username}</span>
          </div>
        </td>
        <td><span class="status-badge new">${e.new_count || 0}</span></td>
        <td><span class="status-badge in_progress">${e.in_progress_count || 0}</span></td>
        <td><span class="status-badge done">${e.done_count || 0}</span></td>
        <td><span class="${e.overdue_count ? 'sla-overdue' : 'sla-ok'}">${e.overdue_count || 0}</span></td>
        <td>
          <div class="load-bar-wrap">
            <div class="load-bar"><div class="load-bar-fill ${barCls}" style="width:${pct}%"></div></div>
            <span style="font-size:11px;color:#64748b;min-width:28px">${active}</span>
          </div>
        </td>
        <td style="font-size:12px;color:#64748b">${e.avg_close_h ? e.avg_close_h.toFixed(1) + 'ч' : '—'}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8">Нет данных</td></tr>';
}

// ── Render Table ─────────────────────────────────────────────────
function renderWbTable() {
  const container = document.getElementById('wbTableBody');
  if (!container) return;

  if (!wb.emails.length) {
    container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:#94a3b8">📭 Нет писем по выбранным фильтрам</td></tr>';
    return;
  }

  const search = wb.search.toLowerCase();
  const rows = wb.emails.filter(e =>
    !search ||
    (e.subject || '').toLowerCase().includes(search) ||
    (e.sender_name || '').toLowerCase().includes(search)
  );

  container.innerHTML = rows.map(e => {
    const status     = e.status || 'new';
    const statusLabel = { new: 'Новое', in_progress: 'В процессе', done: 'Завершено' }[status] || status;
    const statusIcon  = { new: '🆕', in_progress: '⏳', done: '✅' }[status] || '';
    const sla         = renderSla(e.sla_deadline);
    const catColor    = e.category_color || '#64748b';
    const catName     = e.category_name  || 'Без категории';
    const initials    = e.employee_name
      ? e.employee_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
      : '';
    const date = e.date_received
      ? new Date(e.date_received).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';

    return `
      <tr data-email-id="${e.id}" data-assignment-id="${e.assignment_id || ''}">
        <td>
          <div style="font-size:13px;font-weight:${e.is_read ? '400' : '600'};color:var(--text-primary);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${esc(e.subject || '(без темы)')}
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${esc(e.sender_name || e.sender_email || '')}</div>
        </td>
        <td>
          <span class="status-badge ${status}">${statusIcon} ${statusLabel}</span>
        </td>
        <td>
          <span class="cat-tag" style="background:${catColor}">${esc(catName)}</span>
        </td>
        <td>
          ${e.employee_name
            ? `<div class="assignee-cell">
                 <div class="assignee-avatar">${initials}</div>
                 <span class="assignee-name">${esc(e.employee_name)}</span>
               </div>`
            : '<span class="unassigned-label">Не назначено</span>'}
        </td>
        <td>${sla}</td>
        <td style="font-size:12px;color:#64748b">${date}</td>
        <td>
          <div class="wb-row-actions">
            <button class="wb-btn-icon" title="Назначить" onclick="openAssignModal(${e.id}, ${e.assignment_id || 'null'})">👤</button>
            <button class="wb-btn-icon" title="Открыть письмо" onclick="openEmailFromWb(${e.id})">📧</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('wbTotalCount').textContent = wb.total;
}

function renderSla(slaDeadline) {
  if (!slaDeadline) return '<span class="sla-ok">—</span>';
  const dl  = new Date(slaDeadline);
  const now = new Date();
  const diffH = (dl - now) / 3600000;
  if (diffH < 0)   return `<span class="sla-overdue">⚠️ Просрочено</span>`;
  if (diffH < 4)   return `<span class="sla-warning">⏰ ${diffH.toFixed(1)}ч</span>`;
  return `<span class="sla-ok">✓ ${diffH.toFixed(1)}ч</span>`;
}

function renderPagination() {
  const container = document.getElementById('wbPagination');
  if (!container) return;
  const pages = Math.ceil(wb.total / wb.perPage);
  if (pages <= 1) { container.innerHTML = ''; return; }

  let html = `<button onclick="wbGoPage(${wb.page - 1})" ${wb.page === 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = 1; i <= Math.min(pages, 7); i++) {
    html += `<button class="${i === wb.page ? 'active' : ''}" onclick="wbGoPage(${i})">${i}</button>`;
  }
  html += `<button onclick="wbGoPage(${wb.page + 1})" ${wb.page === pages ? 'disabled' : ''}>›</button>`;
  container.innerHTML = html;
}

window.wbGoPage = function(p) {
  wb.page = p;
  loadWorkbench();
};

// ── Bind events ─────────────────────────────────────────────────
function bindWbEvents() {
  // Поиск
  const searchEl = document.getElementById('wbSearch');
  if (searchEl) searchEl.addEventListener('input', e => { wb.search = e.target.value; renderWbTable(); });

  // Статус pills
  document.querySelectorAll('.wb-status-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.wb-status-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      wb.status = pill.dataset.status || '';
      wb.page = 1;
      loadWorkbench();
    });
  });

  // Фильтр категории
  const catSel = document.getElementById('wbCategoryFilter');
  if (catSel) catSel.addEventListener('change', e => { wb.categoryId = e.target.value; wb.page = 1; loadWorkbench(); });

  // Фильтр сотрудника
  const empSel = document.getElementById('wbEmployeeFilter');
  if (empSel) empSel.addEventListener('change', e => { wb.userId = e.target.value; wb.page = 1; loadWorkbench(); });

  // Только нераспределённые
  const unassCb = document.getElementById('wbUnassignedOnly');
  if (unassCb) unassCb.addEventListener('change', e => { wb.unassigned = e.target.checked; wb.page = 1; loadWorkbench(); });

  // Populate фильтры
  const catFilter = document.getElementById('wbCategoryFilter');
  if (catFilter) {
    catFilter.innerHTML = '<option value="">Все категории</option>' +
      wb.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }

  const empFilter = document.getElementById('wbEmployeeFilter');
  if (empFilter) {
    empFilter.innerHTML = '<option value="">Все сотрудники</option>' +
      wb.employees.map(e => `<option value="${e.id}">${esc(e.full_name || e.username)}</option>`).join('');
  }
}

// ── Assign Modal ─────────────────────────────────────────────────
window.openAssignModal = async function(emailId, assignmentId) {
  const modal = document.getElementById('assignModal');
  if (!modal) return;

  document.getElementById('assignEmailId').value = emailId;
  document.getElementById('assignAssignmentId').value = assignmentId || '';

  // Populate selects
  const empSel = document.getElementById('assignEmployee');
  empSel.innerHTML = '<option value="">— Выбрать сотрудника —</option>' +
    wb.employees.map(e => `<option value="${e.id}">${esc(e.full_name || e.username)}</option>`).join('');

  const catSel = document.getElementById('assignCategory');
  catSel.innerHTML = '<option value="">— Авто-определить —</option>' +
    wb.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  // Если уже назначено — заполняем
  if (assignmentId) {
    const r = await fetch(`/api/dispatch/assignment/${assignmentId}`);
    const d = await r.json();
    const a = d.assignment || {};
    if (a.user_id) empSel.value = a.user_id;
    if (a.category_id) catSel.value = a.category_id;
    const notes = document.getElementById('assignNotes');
    if (notes) notes.value = a.notes || '';
  }

  modal.classList.add('show');
};

window.closeAssignModal = function() {
  const modal = document.getElementById('assignModal');
  if (modal) modal.classList.remove('show');
};

window.saveAssignment = async function() {
  const emailId    = document.getElementById('assignEmailId').value;
  const userId     = document.getElementById('assignEmployee').value;
  const categoryId = document.getElementById('assignCategory').value;
  const slaHours   = document.getElementById('assignSla').value || 24;
  const notes      = document.getElementById('assignNotes').value;

  if (!userId) { alert('Выберите сотрудника'); return; }

  const r = await fetch('/api/dispatch/assign/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_id: +emailId, user_id: +userId,
      category_id: categoryId ? +categoryId : null,
      sla_hours: +slaHours, notes
    })
  });

  if (r.ok) {
    closeAssignModal();
    await loadWorkbench();
    await loadDashboard();
  } else {
    const d = await r.json();
    alert(d.error || 'Ошибка назначения');
  }
};

// Авто-назначить всех
window.batchAutoAssign = async function() {
  const method = document.getElementById('wbAssignMethod')?.value || 'round_robin';
  if (!confirm(`Авто-назначить все нераспределённые письма (метод: ${method})?`)) return;

  const r = await fetch('/api/dispatch/assign/batch-auto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method })
  });
  const d = await r.json();
  if (r.ok) {
    alert(`✅ Назначено ${d.assigned} писем`);
    await loadWorkbench();
    await loadDashboard();
  } else {
    alert(d.error || 'Ошибка');
  }
};

// Открыть email из вкладки workbench — вызывает основной modal
window.openEmailFromWb = function(emailId) {
  if (window.openEmail) window.openEmail(emailId);
};

// ── Helpers ──────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

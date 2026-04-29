// cabinet.js  —  Личный кабинет сотрудника

// ── State ────────────────────────────────────────────────────────
let cab = {
  assignments: [], total: 0,
  page: 1, perPage: 20,
  status: '', dateFrom: '', dateTo: '',
  selected: null,        // текущая открытая заявка
  currentUserId: null,
  currentUserRole: null,
};

// ── Init ─────────────────────────────────────────────────────────
export async function initCabinet() {
  // Получаем данные текущего пользователя
  try {
    const r = await fetch('/api/me');
    if (r.ok) {
      const d = await r.json();
      cab.currentUserId   = d.id;
      cab.currentUserRole = d.role;
      renderCabinetProfile(d);
    }
  } catch (e) { /* ignore */ }

  await loadMyAssignments();
  bindCabinetEvents();
}

// ── API ──────────────────────────────────────────────────────────
async function loadMyAssignments() {
  const params = new URLSearchParams({ page: cab.page, per_page: cab.perPage });
  if (cab.status)   params.set('status', cab.status);
  if (cab.dateFrom) params.set('date_from', cab.dateFrom);
  if (cab.dateTo)   params.set('date_to', cab.dateTo);

  const r = await fetch('/api/dispatch/my?' + params);
  const d = await r.json();
  cab.assignments = d.assignments || [];
  cab.total       = d.total || 0;
  renderCabinetCards();
  renderCabinetPagination();
  updateCabinetStats();
}

// ── Render Profile ───────────────────────────────────────────────
function renderCabinetProfile(user) {
  const nameEl = document.getElementById('cabinetUserName');
  const roleEl = document.getElementById('cabinetUserRole');
  const avaEl  = document.getElementById('cabinetAvatar');

  if (nameEl) nameEl.textContent = user.full_name || user.username;
  if (roleEl) roleEl.textContent = user.role === 'admin' ? '🛡️ Администратор' : '👤 Сотрудник';
  if (avaEl) {
    avaEl.textContent = (user.full_name || user.username || '?')
      .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }
}

// ── Render Cards ─────────────────────────────────────────────────
function renderCabinetCards() {
  const container = document.getElementById('cabinetCardsList');
  if (!container) return;

  if (!cab.assignments.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>Нет назначенных писем</p>
        <p style="font-size:13px;color:#94a3b8;margin-top:6px">Письма будут появляться здесь после назначения</p>
      </div>`;
    return;
  }

  container.innerHTML = cab.assignments.map(a => {
    const status      = a.status || 'new';
    const statusLabel = { new: 'Новое', in_progress: 'В процессе', done: 'Завершено' }[status];
    const statusIcon  = { new: '🆕', in_progress: '⏳', done: '✅' }[status];
    const catColor    = a.category_color || '#64748b';
    const catName     = a.category_name  || 'Без категории';
    const date        = a.date_received
      ? new Date(a.date_received).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—';
    const sla = renderSlaLabel(a.sla_deadline);
    const selected = cab.selected?.assignment_id === a.assignment_id ? 'style="border-color:var(--primary);box-shadow:0 0 0 3px rgba(37,99,235,.15)"' : '';

    const actions = buildCardActions(a);

    return `
      <div class="assignment-card" ${selected} onclick="selectAssignment(${a.assignment_id})">
        <div class="assignment-card-header">
          <div class="assignment-card-subject">${esc(a.subject || '(без темы)')}</div>
          <span class="status-badge ${status}">${statusIcon} ${statusLabel}</span>
        </div>
        <div class="assignment-card-meta">
          <span>✉️ ${esc(a.sender_name || a.sender_email || '')}</span>
          <span>📅 ${date}</span>
          <span class="cat-tag" style="background:${catColor}">${esc(catName)}</span>
          ${sla}
        </div>
        <div class="assignment-card-preview">${esc((a.body || '').replace(/<[^>]*>/g, '').slice(0, 150))}</div>
        ${actions ? `<div class="assignment-card-actions">${actions}</div>` : ''}
      </div>`;
  }).join('');
}

function buildCardActions(a) {
  const status = a.status || 'new';
  let html = '';
  if (status === 'new') {
    html += `<button class="btn btn-take btn-small" onclick="event.stopPropagation();takeAssignment(${a.assignment_id})">▶ Взять в работу</button>`;
  }
  if (status === 'in_progress') {
    html += `<button class="btn btn-complete btn-small" onclick="event.stopPropagation();completeAssignment(${a.assignment_id})">✅ Завершить</button>`;
  }
  if (status === 'done') {
    html += `<button class="btn btn-reopen btn-small" onclick="event.stopPropagation();reopenAssignment(${a.assignment_id})">↩ Вернуть в процесс</button>`;
  }
  return html;
}

function renderSlaLabel(slaDeadline) {
  if (!slaDeadline) return '';
  const dl  = new Date(slaDeadline);
  const now = new Date();
  const diffH = (dl - now) / 3600000;
  if (diffH < 0) return `<span class="sla-overdue">⚠️ SLA просрочен</span>`;
  if (diffH < 4) return `<span class="sla-warning">⏰ SLA: ${diffH.toFixed(1)}ч</span>`;
  return `<span class="sla-ok">⏱ SLA: ${diffH.toFixed(0)}ч</span>`;
}

// ── Select assignment → detail panel ─────────────────────────────
window.selectAssignment = async function(assignmentId) {
  const r = await fetch(`/api/dispatch/assignment/${assignmentId}`);
  if (!r.ok) return;
  const d = await r.json();
  cab.selected = d.assignment;
  renderDetailPanel(d.assignment);
  // Перерендер карточек чтобы подсветить выбранную
  renderCabinetCards();
};

function renderDetailPanel(a) {
  const panel = document.getElementById('cabinetDetailPanel');
  if (!panel) return;

  const status      = a.status || 'new';
  const statusLabel = { new: 'Новое', in_progress: 'В процессе', done: 'Завершено' }[status];
  const statusIcon  = { new: '🆕', in_progress: '⏳', done: '✅' }[status];
  const catName     = a.category_name || 'Без категории';
  const catColor    = a.category_color || '#64748b';
  const date        = a.date_received
    ? new Date(a.date_received).toLocaleString('ru-RU')
    : '—';

  const bodyText = (a.body || '(нет текста)').replace(/<[^>]*>/g, '').trim();

  const history = (a.history || []).map(h => {
    const oldLabel = { new: 'Новое', in_progress: 'В процессе', done: 'Завершено' }[h.old_status] || h.old_status || '—';
    const newLabel = { new: 'Новое', in_progress: 'В процессе', done: 'Завершено' }[h.new_status] || h.new_status;
    const changedAt = h.changed_at ? new Date(h.changed_at).toLocaleString('ru-RU') : '';
    return `
      <div class="history-item">
        <div class="history-item-status">${oldLabel} → <strong>${newLabel}</strong></div>
        <div class="history-item-meta">${changedAt} · ${esc(h.changed_by_name || 'Система')}</div>
        ${h.comment ? `<div class="history-item-comment">${esc(h.comment)}</div>` : ''}
      </div>`;
  }).join('') || '<p style="font-size:12px;color:#94a3b8">История пуста</p>';

  const actions = buildDetailActions(a);

  panel.innerHTML = `
    <div class="cdp-header">
      <div class="cdp-title">📄 Детали заявки</div>
      <span class="status-badge ${status}">${statusIcon} ${statusLabel}</span>
    </div>
    <div class="cdp-body">
      <div class="cdp-section-title">О письме</div>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:13px">
        <div><strong>Тема:</strong> ${esc(a.subject || '(без темы)')}</div>
        <div><strong>От:</strong> ${esc(a.employee_name || a.sender_name || '')} &lt;${esc(a.employee_email || a.sender_email || '')}&gt;</div>
        <div><strong>Дата:</strong> ${date}</div>
        <div><strong>Категория:</strong> <span class="cat-tag" style="background:${catColor}">${esc(catName)}</span></div>
        ${a.sla_deadline ? `<div>${renderSlaLabel(a.sla_deadline)}</div>` : ''}
      </div>

      <div class="cdp-section-title">Текст письма</div>
      <div class="cdp-email-body">${esc(bodyText)}</div>

      <div class="cdp-section-title">История статусов</div>
      <div class="history-timeline">${history}</div>
    </div>
    ${actions ? `<div class="cdp-actions">${actions}</div>` : ''}`;
}

function buildDetailActions(a) {
  const status = a.status || 'new';
  let html = '';
  if (status === 'new') {
    html += `<button class="btn btn-take" onclick="takeAssignment(${a.id})">▶ Взять в работу</button>`;
  }
  if (status === 'in_progress') {
    html += `<button class="btn btn-complete" onclick="completeAssignment(${a.id})">✅ Завершить</button>`;
  }
  if (status === 'done') {
    html += `<button class="btn btn-reopen" onclick="reopenAssignment(${a.id})">↩ Вернуть в процесс</button>`;
  }
  html += `<button class="btn" style="background:#e2e8f0;color:#374151" onclick="openEmailFromCabinet(${a.email_id})">📧 Открыть письмо</button>`;
  return html;
}

// ── Status actions ───────────────────────────────────────────────
window.takeAssignment = async function(assignmentId) {
  const r = await fetch(`/api/dispatch/my/take/${assignmentId}`, { method: 'POST' });
  if (r.ok) {
    await loadMyAssignments();
    if (cab.selected?.id === assignmentId || cab.selected?.assignment_id === assignmentId) {
      await selectAssignment(assignmentId);
    }
  } else {
    const d = await r.json();
    alert(d.error || 'Ошибка');
  }
};

window.completeAssignment = async function(assignmentId) {
  const comment = prompt('Комментарий (необязательно):') ?? 'Завершено';
  const r = await fetch(`/api/dispatch/my/complete/${assignmentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment })
  });
  if (r.ok) {
    await loadMyAssignments();
    if (cab.selected?.id === assignmentId || cab.selected?.assignment_id === assignmentId) {
      await selectAssignment(assignmentId);
    }
  } else {
    const d = await r.json();
    alert(d.error || 'Ошибка');
  }
};

window.reopenAssignment = async function(assignmentId) {
  const comment = prompt('Причина возврата:') || 'Возвращено в работу';
  const r = await fetch(`/api/dispatch/my/reopen/${assignmentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment })
  });
  if (r.ok) {
    await loadMyAssignments();
    if (cab.selected?.id === assignmentId || cab.selected?.assignment_id === assignmentId) {
      await selectAssignment(assignmentId);
    }
  } else {
    const d = await r.json();
    alert(d.error || 'Ошибка');
  }
};

window.openEmailFromCabinet = function(emailId) {
  if (window.openEmail) window.openEmail(emailId);
};

// ── Stats ─────────────────────────────────────────────────────────
function updateCabinetStats() {
  const all     = cab.assignments;
  const newC    = all.filter(a => a.status === 'new').length;
  const inProg  = all.filter(a => a.status === 'in_progress').length;
  const done    = all.filter(a => a.status === 'done').length;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('cabinetStatTotal',      cab.total);
  set('cabinetStatNew',        newC);
  set('cabinetStatInProgress', inProg);
  set('cabinetStatDone',       done);
}

function renderCabinetPagination() {
  const container = document.getElementById('cabinetPagination');
  if (!container) return;
  const pages = Math.ceil(cab.total / cab.perPage);
  if (pages <= 1) { container.innerHTML = ''; return; }

  let html = `<button onclick="cabGoPage(${cab.page - 1})" ${cab.page === 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = 1; i <= Math.min(pages, 7); i++) {
    html += `<button class="${i === cab.page ? 'active' : ''}" onclick="cabGoPage(${i})">${i}</button>`;
  }
  html += `<button onclick="cabGoPage(${cab.page + 1})" ${cab.page === pages ? 'disabled' : ''}>›</button>`;
  container.innerHTML = html;
}

window.cabGoPage = function(p) { cab.page = p; loadMyAssignments(); };

// ── Events ───────────────────────────────────────────────────────
function bindCabinetEvents() {
  const statusSel = document.getElementById('cabinetStatusFilter');
  if (statusSel) statusSel.addEventListener('change', e => {
    cab.status = e.target.value; cab.page = 1; loadMyAssignments();
  });

  const dfrom = document.getElementById('cabinetDateFrom');
  const dto   = document.getElementById('cabinetDateTo');
  if (dfrom) dfrom.addEventListener('change', e => { cab.dateFrom = e.target.value; cab.page = 1; loadMyAssignments(); });
  if (dto)   dto.addEventListener('change',   e => { cab.dateTo   = e.target.value; cab.page = 1; loadMyAssignments(); });
}

// ── Helpers ──────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// notifications.js  —  Система уведомлений (колокольчик + dropdown)

let _notifState = { count: 0, items: [], open: false };
let _notifInterval = null;

export function initNotifications() {
  renderNotifBell();
  fetchNotifCount();
  // Polling каждые 30 секунд
  _notifInterval = setInterval(fetchNotifCount, 30000);
}

export function stopNotifications() {
  if (_notifInterval) clearInterval(_notifInterval);
}

async function fetchNotifCount() {
  try {
    const r = await fetch('/api/dispatch/notifications/count');
    if (!r.ok) return;
    const d = await r.json();
    _notifState.count = d.count || 0;
    updateBadge();
  } catch (e) { /* offline */ }
}

async function fetchNotifications() {
  const r = await fetch('/api/dispatch/notifications?limit=30');
  const d = await r.json();
  _notifState.items = d.notifications || [];
  _notifState.count = d.unread_count  || 0;
  updateBadge();
}

// ── Render bell ──────────────────────────────────────────────────
function renderNotifBell() {
  const container = document.getElementById('notifBellContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="notif-bell-wrap" id="notifBellWrap">
      <button class="notif-bell" id="notifBellBtn" title="Уведомления" onclick="toggleNotifDropdown()">🔔</button>
      <span class="notif-badge" id="notifBadge" style="display:none">0</span>
      <div class="notif-dropdown" id="notifDropdown">
        <div class="notif-dropdown-header">
          <span class="notif-dropdown-title">🔔 Уведомления</span>
          <button class="notif-mark-all" onclick="markAllRead()">Прочитать все</button>
        </div>
        <div class="notif-list" id="notifList">
          <div class="notif-empty">Нет уведомлений</div>
        </div>
      </div>
    </div>`;

  // Закрывать при клике вне
  document.addEventListener('click', e => {
    const wrap = document.getElementById('notifBellWrap');
    if (wrap && !wrap.contains(e.target)) closeNotifDropdown();
  });
}

function updateBadge() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (_notifState.count > 0) {
    badge.style.display = 'flex';
    badge.textContent   = _notifState.count > 99 ? '99+' : _notifState.count;
  } else {
    badge.style.display = 'none';
  }
}

window.toggleNotifDropdown = async function() {
  const dropdown = document.getElementById('notifDropdown');
  if (!dropdown) return;
  _notifState.open = !_notifState.open;
  if (_notifState.open) {
    dropdown.classList.add('open');
    await fetchNotifications();
    renderNotifList();
  } else {
    dropdown.classList.remove('open');
  }
};

function closeNotifDropdown() {
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown) dropdown.classList.remove('open');
  _notifState.open = false;
}

function renderNotifList() {
  const list = document.getElementById('notifList');
  if (!list) return;

  if (!_notifState.items.length) {
    list.innerHTML = '<div class="notif-empty">✅ Нет уведомлений</div>';
    return;
  }

  const typeIcon = {
    reminder:      '⏰',
    assigned:      '📌',
    status_change: '🔄',
    sla_warning:   '⚠️',
  };

  list.innerHTML = _notifState.items.map(n => {
    const icon = typeIcon[n.type] || '🔔';
    const time = n.created_at
      ? new Date(n.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';
    return `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="handleNotifClick(${n.id})">
        <div class="notif-item-icon">${icon}</div>
        <div class="notif-item-body">
          <div class="notif-item-title">${esc(n.title)}</div>
          <div class="notif-item-text">${esc(n.body || '')}</div>
          <div class="notif-item-time">${time}</div>
        </div>
      </div>`;
  }).join('');
}

window.handleNotifClick = async function(notifId) {
  await fetch('/api/dispatch/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [notifId] })
  });
  await fetchNotifications();
  renderNotifList();
};

window.markAllRead = async function() {
  await fetch('/api/dispatch/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  await fetchNotifications();
  renderNotifList();
};

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// employees.js — Управление сотрудниками и правами доступа

let allEmployees = [];
let deleteTargetId = null;

// ─── Загрузка при переключении на вкладку ───────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Следим за переключением вкладок
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'employees') {
                loadEmployees();
            }
        });
    });

    // Поиск и фильтрация
    document.getElementById('empSearch')?.addEventListener('input', renderTable);
    document.getElementById('empRoleFilter')?.addEventListener('change', renderTable);
    document.getElementById('empStatusFilter')?.addEventListener('change', renderTable);
});

// ─── API-запросы ─────────────────────────────────────────────────────────────

async function apiRequest(url, method = 'GET', body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    return res.json();
}

// ─── Загрузка и рендер ────────────────────────────────────────────────────────

async function loadEmployees() {
    const tbody = document.getElementById('empTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="emp-loading">⏳ Загрузка...</td></tr>';

    try {
        const data = await apiRequest('/api/employees');
        allEmployees = data.employees || [];
        updateStats();
        renderTable();
    } catch (e) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="emp-loading">❌ Ошибка загрузки</td></tr>';
    }
}

function updateStats() {
    const total = allEmployees.length;
    const admins = allEmployees.filter(e => e.role === 'admin').length;
    const employees = allEmployees.filter(e => e.role !== 'admin').length;
    const active = allEmployees.filter(e => e.is_active).length;

    setText('empTotalCount', total);
    setText('empAdminCount', admins);
    setText('empEmployeeCount', employees);
    setText('empActiveCount', active);
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function renderTable() {
    const search = (document.getElementById('empSearch')?.value || '').toLowerCase();
    const roleF = document.getElementById('empRoleFilter')?.value || '';
    const statusF = document.getElementById('empStatusFilter')?.value;

    let filtered = allEmployees.filter(e => {
        const matchSearch =
            !search ||
            (e.full_name || '').toLowerCase().includes(search) ||
            (e.username || '').toLowerCase().includes(search) ||
            (e.email || '').toLowerCase().includes(search);

        const matchRole = !roleF || e.role === roleF;
        const matchStatus = statusF === '' || statusF === undefined
            ? true
            : String(e.is_active ? '1' : '0') === String(statusF);

        return matchSearch && matchRole && matchStatus;
    });

    const tbody = document.getElementById('empTableBody');
    if (!tbody) return;

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="emp-loading">😔 Сотрудники не найдены</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(emp => {
        const initials = getInitials(emp.full_name || emp.username || '?');
        const avatarClass = emp.role === 'admin' ? 'emp-avatar admin' : 'emp-avatar';
        const roleBadge = emp.role === 'admin'
            ? '<span class="emp-badge emp-badge-admin">🛡️ Админ</span>'
            : '<span class="emp-badge emp-badge-employee">👤 Пользователь</span>';
        const statusBadge = emp.is_active
            ? '<span class="emp-badge emp-badge-active">✅ Активен</span>'
            : '<span class="emp-badge emp-badge-inactive">🚫 Отключён</span>';
        const toggleLabel = emp.is_active ? '🚫 Отключить' : '✅ Включить';

        return `
            <tr>
                <td>
                    <div class="emp-cell-name">
                        <div class="${avatarClass}">${initials}</div>
                        <span class="emp-name-text">${escHtml(emp.full_name || '—')}</span>
                    </div>
                </td>
                <td>${escHtml(emp.username)}</td>
                <td>${escHtml(emp.email || '—')}</td>
                <td>${roleBadge}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="emp-actions">
                        <button class="emp-btn emp-btn-edit" onclick="openEditEmployeeModal(${emp.id})">✏️ Изменить</button>
                        <button class="emp-btn emp-btn-toggle" onclick="toggleEmployee(${emp.id})">${toggleLabel}</button>
                        <button class="emp-btn emp-btn-delete" onclick="openDeleteModal(${emp.id}, '${escHtml(emp.full_name || emp.username)}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ─── Вспомогательные ─────────────────────────────────────────────────────────

function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ─── Модальное окно добавления/редактирования ─────────────────────────────────

window.openAddEmployeeModal = function () {
    resetForm();
    document.getElementById('employeeModalTitle').textContent = '➕ Новый сотрудник';
    document.getElementById('empPasswordHint').style.display = 'none';
    document.getElementById('empEditId').value = '';
    // По умолчанию базовые права включены
    setPermissions({ view_emails: true });
    openModal('employeeModal');
};

window.openEditEmployeeModal = async function (id) {
    resetForm();
    document.getElementById('employeeModalTitle').textContent = '✏️ Редактировать сотрудника';
    document.getElementById('empPasswordHint').style.display = '';
    document.getElementById('empEditId').value = id;

    try {
        const data = await apiRequest(`/api/employees/${id}`);
        const emp = data.employee;
        document.getElementById('empFullName').value = emp.full_name || '';
        document.getElementById('empUsername').value = emp.username || '';
        document.getElementById('empEmail').value = emp.email || '';
        document.getElementById('empRole').value = emp.role || 'employee';
        document.getElementById('empIsActive').value = emp.is_active ? '1' : '0';
        setPermissions(emp.permissions || {});
    } catch (e) {
        showFormError('Ошибка загрузки данных сотрудника');
    }

    openModal('employeeModal');
};

window.closeEmployeeModal = function () {
    closeModal('employeeModal');
};

window.saveEmployee = async function () {
    hideFormError();
    const id = document.getElementById('empEditId').value;
    const fullName = document.getElementById('empFullName').value.trim();
    const username = document.getElementById('empUsername').value.trim();
    const email = document.getElementById('empEmail').value.trim();
    const password = document.getElementById('empPassword').value;
    const role = document.getElementById('empRole').value;
    const isActive = document.getElementById('empIsActive').value === '1';

    if (!fullName) return showFormError('Введите полное имя');
    if (!username) return showFormError('Введите логин');
    if (!id && !password) return showFormError('Введите пароль для нового сотрудника');
    if (!id && password.length < 4) return showFormError('Пароль должен быть не менее 4 символов');

    const permissions = getPermissions();

    const payload = { full_name: fullName, username, email, role, is_active: isActive, permissions };
    if (password) payload.password = password;

    try {
        const url = id ? `/api/employees/${id}` : '/api/employees';
        const method = id ? 'PUT' : 'POST';
        const res = await apiRequest(url, method, payload);

        if (res.success) {
            closeModal('employeeModal');
            loadEmployees();
        } else {
            showFormError(res.error || 'Ошибка сохранения');
        }
    } catch (e) {
        showFormError('Ошибка сервера');
    }
};

// ─── Включить / выключить ─────────────────────────────────────────────────────

window.toggleEmployee = async function (id) {
    try {
        const res = await apiRequest(`/api/employees/${id}/toggle`, 'POST');
        if (res.success) {
            loadEmployees();
        }
    } catch (e) {
        alert('Ошибка изменения статуса');
    }
};

// ─── Удаление ─────────────────────────────────────────────────────────────────

window.openDeleteModal = function (id, name) {
    deleteTargetId = id;
    document.getElementById('deleteEmployeeName').textContent = name;
    openModal('deleteEmployeeModal');
};

window.closeDeleteModal = function () {
    closeModal('deleteEmployeeModal');
};

window.confirmDeleteEmployee = async function () {
    if (!deleteTargetId) return;
    try {
        const res = await apiRequest(`/api/employees/${deleteTargetId}`, 'DELETE');
        if (res.success) {
            closeModal('deleteEmployeeModal');
            loadEmployees();
        } else {
            alert(res.error || 'Ошибка удаления');
        }
    } catch (e) {
        alert('Ошибка сервера');
    }
};

// ─── Права доступа ───────────────────────────────────────────────────────────

const PERM_IDS = [
    ['permViewEmails',      'view_emails'],
    ['permSyncEmails',      'sync_emails'],
    ['permManageContacts',  'manage_contacts'],
    ['permViewReports',     'view_reports'],
    ['permManageFilters',   'manage_filters'],
    ['permManageUsers',     'manage_users'],
];

function getPermissions() {
    const p = {};
    PERM_IDS.forEach(([elId, key]) => {
        const el = document.getElementById(elId);
        if (el) p[key] = el.checked;
    });
    return p;
}

function setPermissions(perms) {
    PERM_IDS.forEach(([elId, key]) => {
        const el = document.getElementById(elId);
        if (el) el.checked = !!perms[key];
    });
}

// ─── Утилиты модальных окон ──────────────────────────────────────────────────

function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('show');
}

function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('show');
}

function resetForm() {
    ['empFullName', 'empUsername', 'empEmail', 'empPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const role = document.getElementById('empRole');
    if (role) role.value = 'employee';
    const active = document.getElementById('empIsActive');
    if (active) active.value = '1';
    setPermissions({});
    hideFormError();
}

function showFormError(msg) {
    const el = document.getElementById('empFormError');
    if (el) { el.textContent = '⚠️ ' + msg; el.style.display = ''; }
}

function hideFormError() {
    const el = document.getElementById('empFormError');
    if (el) el.style.display = 'none';
}

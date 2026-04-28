// reports.js — Вкладка «Отчёты» с блоком эффективности сотрудников

let repCharts = {};
let repCurrentPeriod = '30';
let repCustomStart = null;
let repCustomEnd = null;
let repSortCol = 'score';
let repSortDir = -1; // -1 = desc

// ─── Инициализация ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'reports') setTimeout(() => initReports(), 50);
        });
    });
});

window.initReports = function () {
    if (!window.Chart) {
        loadChartJs(() => renderReports());
    } else {
        renderReports();
    }
};

function loadChartJs(cb) {
    if (document.getElementById('chartjs-script')) { cb(); return; }
    const s = document.createElement('script');
    s.id = 'chartjs-script';
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
    s.onload = cb;
    document.head.appendChild(s);
}

// ─── Генератор моковых данных ─────────────────────────────────────────────────

// ─── Загрузка данных с API ───────────────────────────────────────────────────

async function fetchReportData(period, start, end) {
    const params = new URLSearchParams();
    if (period === 'custom' && start && end) {
        params.set('start', start);
        params.set('end',   end);
    } else {
        params.set('days', period || 30);
    }
    const res = await fetch('/api/reports?' + params.toString());
    if (!res.ok) throw new Error('API error ' + res.status);
    return res.json();
}

// Преобразует ответ API в формат для графиков
function normalizeApiData(api) {
    const labels = [], counts = [], unread = [];
    (api.activity || []).forEach(r => {
        const d = new Date(r.day);
        labels.push(d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
        counts.push(r.cnt || 0);
        unread.push(r.unread_cnt || 0);
    });

    const total       = api.total        || 0;
    const totalUnread = api.total_unread || 0;
    const folders     = (api.folders || []).map(f => ({ name: f.folder || f.name, count: f.cnt || f.count || 0 }));
    const senders     = (api.senders || []).map(s => ({
        name:  s.sender_name || s.name || s.sender_email || '—',
        email: s.sender_email || s.email || '',
        count: s.cnt || s.count || 0,
    }));
    const heatmap = api.heatmap || Array.from({length:7}, ()=>Array(8).fill(0));

    const employees = (api.employees || []).map(e => ({
        id:        e.id,
        name:      e.name  || '—',
        dept:      e.dept  || 'Сотрудники',
        role:      e.role === 'admin' ? 'Администратор' : 'Пользователь',
        received:  e.received  || 0,
        replied:   e.replied   || 0,
        avgReplyH: e.avg_reply_h != null ? e.avg_reply_h : null,
        readRate:  e.read_rate  || 0,
        replyRate: e.reply_rate || 0,
        important: e.important  || 0,
        score:     e.score      || 0,
        trend:     e.trend      || [],
    }));

    const deptMap = {};
    employees.forEach(e => { deptMap[e.dept] = (deptMap[e.dept]||0) + e.received; });
    const departments = Object.entries(deptMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a,b) => b.count - a.count);

    return { labels, counts, unread, departments, senders, folders,
             total, totalUnread, heatmap, employees };
}

// ─── Главный рендер ──────────────────────────────────────────────────────────

async function renderReports() {
    const container = document.getElementById('reports');
    if (!container) return;
    destroyAllCharts();
    container.innerHTML = '<div class="rep-loading">⏳ Загружаем данные...</div>';

    let data;
    try {
        const period = repCurrentPeriod === 'custom' ? 'custom' : repCurrentPeriod;
        const api = await fetchReportData(period, repCustomStart, repCustomEnd);
        data = normalizeApiData(api);
    } catch(e) {
        container.innerHTML = '<div class="rep-loading">❌ Ошибка загрузки данных. Проверьте подключение к серверу.</div>';
        return;
    }

    repLastData = data;
    container.innerHTML = buildReportsHTML(data);
    bindPeriodControls();
    renderAllCharts(data);
    bindEmpTableSort(data);
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildReportsHTML(data) {
    const totalRead  = data.total - data.totalUnread;
    const readPct    = data.total > 0 ? Math.round(totalRead / data.total * 100) : 0;
    const avgPerDay  = data.counts.length > 0 ? Math.round(data.total / data.counts.length) : 0;
    const avgReply   = +(data.employees.reduce((s, e) => s + e.avgReplyH, 0) / data.employees.length).toFixed(1);
    const avgScore   = Math.round(data.employees.reduce((s, e) => s + e.score, 0) / data.employees.length);
    const topEmp     = [...data.employees].sort((a, b) => b.score - a.score).slice(0, 3);
    const fastEmp    = [...data.employees].sort((a, b) => a.avgReplyH - b.avgReplyH).slice(0, 3);

    return `
<h2 class="section-title">📊 Отчёты</h2>

<div class="rep-toolbar">
    <div class="rep-period-tabs" id="repPeriodTabs">
        <button class="rep-period-btn ${repCurrentPeriod==='7'   ?'active':''}" data-period="7">7 дней</button>
        <button class="rep-period-btn ${repCurrentPeriod==='30'  ?'active':''}" data-period="30">30 дней</button>
        <button class="rep-period-btn ${repCurrentPeriod==='90'  ?'active':''}" data-period="90">3 месяца</button>
        <button class="rep-period-btn ${repCurrentPeriod==='365' ?'active':''}" data-period="365">Год</button>
        <button class="rep-period-btn ${repCurrentPeriod==='custom'?'active':''}" data-period="custom">Период</button>
    </div>
    <div class="rep-custom-range" id="repCustomRange" style="${repCurrentPeriod==='custom'?'':'display:none'}">
        <input type="date" class="rep-date-input" id="repDateStart" value="${repCustomStart||''}">
        <span style="color:var(--text-secondary);font-size:13px">—</span>
        <input type="date" class="rep-date-input" id="repDateEnd" value="${repCustomEnd||''}">
        <button class="rep-apply-btn" onclick="applyCustomPeriod()">Применить</button>
    </div>
</div>

<!-- ═══════════════ РАЗДЕЛ: СОТРУДНИКИ ═══════════════ -->
<div class="rep-section-title">👥 Эффективность сотрудников</div>

<!-- KPI сотрудников -->
<div class="rep-kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(155px,1fr))">
    <div class="rep-kpi-card">
        <div class="rep-kpi-label">Средний score</div>
        <div class="rep-kpi-value" style="color:${scoreColor(avgScore)}">${avgScore}</div>
        <div class="rep-kpi-sub">из 100 баллов</div>
    </div>
    <div class="rep-kpi-card">
        <div class="rep-kpi-label">Среднее время ответа</div>
        <div class="rep-kpi-value">${avgReply}ч</div>
        <div class="rep-kpi-sub">${avgReply<=2?'🟢 Отлично':avgReply<=6?'🟡 Норма':'🔴 Медленно'}</div>
    </div>
    <div class="rep-kpi-card">
        <div class="rep-kpi-label">Всего сотрудников</div>
        <div class="rep-kpi-value">${data.employees.length}</div>
        <div class="rep-kpi-sub">в системе</div>
    </div>
    <div class="rep-kpi-card">
        <div class="rep-kpi-label">Лучший сотрудник</div>
        <div class="rep-kpi-value" style="font-size:16px;line-height:1.3">${topEmp[0]?.name.split(' ')[0]||'—'}</div>
        <div class="rep-kpi-sub rep-kpi-trend-up">★ Score ${topEmp[0]?.score||0}</div>
    </div>
    <div class="rep-kpi-card">
        <div class="rep-kpi-label">Быстрее всех</div>
        <div class="rep-kpi-value" style="font-size:16px;line-height:1.3">${fastEmp[0]?.name.split(' ')[0]||'—'}</div>
        <div class="rep-kpi-sub rep-kpi-trend-up">⚡ ${fastEmp[0]?.avgReplyH||0}ч ответ</div>
    </div>
    <div class="rep-kpi-card">
        <div class="rep-kpi-label">Обработано писем</div>
        <div class="rep-kpi-value">${data.employees.reduce((s,e)=>s+e.received,0)}</div>
        <div class="rep-kpi-sub">за период</div>
    </div>
</div>

<!-- Подиум: топ-3 по score + топ-3 по скорости -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px">
    <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:12px">🏆 Топ по эффективности</div>
        <div class="rep-podium-grid" style="grid-template-columns:1fr">${buildPodium(topEmp,'score','баллов')}</div>
    </div>
    <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:12px">⚡ Быстрее всех отвечают</div>
        <div class="rep-podium-grid" style="grid-template-columns:1fr">${buildPodium(fastEmp,'avgReplyH','ч ответ',true)}</div>
    </div>
</div>

<!-- Графики сотрудников -->
<div class="rep-charts-grid" style="margin-bottom:28px">
    <div class="rep-chart-card">
        <div class="rep-chart-title">Score по сотрудникам</div>
        <div class="rep-chart-subtitle">Интегральная оценка эффективности</div>
        <div style="position:relative;height:240px">
            <canvas id="repEmpScoreChart"></canvas>
        </div>
    </div>
    <div class="rep-chart-card">
        <div class="rep-chart-title">Время ответа</div>
        <div class="rep-chart-subtitle">Среднее время ответа в часах</div>
        <div style="position:relative;height:240px">
            <canvas id="repReplyTimeChart"></canvas>
        </div>
    </div>
    <div class="rep-chart-card">
        <div class="rep-chart-title">Активность по отделам</div>
        <div class="rep-chart-subtitle">Письма, обработанные каждым отделом</div>
        <div style="position:relative;height:220px">
            <canvas id="repDeptEmpChart"></canvas>
        </div>
    </div>
    <div class="rep-chart-card">
        <div class="rep-chart-title">Процент ответов</div>
        <div class="rep-chart-subtitle">Доля отвеченных входящих писем</div>
        <div style="position:relative;height:220px">
            <canvas id="repReplyRateChart"></canvas>
        </div>
    </div>
</div>

<!-- Детальная таблица сотрудников -->
<div class="rep-section-title" style="margin-top:4px">📋 Детальная сводка</div>
<div class="rep-emp-filter-bar">
    <select class="rep-emp-filter-select" id="repEmpDeptFilter" onchange="filterEmpTable()">
        <option value="">Все отделы</option>
        ${[...new Set(data.employees.map(e=>e.dept))].map(d=>`<option value="${d}">${d}</option>`).join('')}
    </select>
    <select class="rep-emp-filter-select" id="repEmpPerfFilter" onchange="filterEmpTable()">
        <option value="">Все уровни</option>
        <option value="high">Высокий score ≥70</option>
        <option value="mid">Средний 40–69</option>
        <option value="low">Низкий &lt;40</option>
    </select>
</div>
<div class="rep-emp-table-wrap">
    <table class="rep-emp-table" id="repEmpTable">
        <thead>
            <tr>
                <th onclick="sortEmpTable('name')">Сотрудник ${sortIcon('name')}</th>
                <th onclick="sortEmpTable('received')">Писем получено ${sortIcon('received')}</th>
                <th onclick="sortEmpTable('replyRate')">% ответов ${sortIcon('replyRate')}</th>
                <th onclick="sortEmpTable('avgReplyH')">Время ответа ${sortIcon('avgReplyH')}</th>
                <th onclick="sortEmpTable('readRate')">% прочитано ${sortIcon('readRate')}</th>
                <th onclick="sortEmpTable('important')">Важных ${sortIcon('important')}</th>
                <th onclick="sortEmpTable('score')">Score ${sortIcon('score')}</th>
            </tr>
        </thead>
        <tbody id="repEmpTbody">
            ${buildEmpRows(data.employees)}
        </tbody>
    </table>
</div>

<div class="rep-divider"></div>

<!-- ═══════════════ РАЗДЕЛ: ПОЧТА ═══════════════ -->
<div class="rep-section-title">📬 Общая статистика по почте</div>

<div class="rep-kpi-grid">
    <div class="rep-kpi-card">
        <div class="rep-kpi-label">Всего писем</div>
        <div class="rep-kpi-value">${data.total.toLocaleString('ru-RU')}</div>
        <div class="rep-kpi-sub rep-kpi-trend-up">▲ ${avgPerDay}/день</div>
    </div>
    <div class="rep-kpi-card">
        <div class="rep-kpi-label">Непрочитанных</div>
        <div class="rep-kpi-value">${data.totalUnread.toLocaleString('ru-RU')}</div>
        <div class="rep-kpi-sub">${100-readPct}% от общего</div>
    </div>
    <div class="rep-kpi-card">
        <div class="rep-kpi-label">Прочитано</div>
        <div class="rep-kpi-value">${readPct}%</div>
        <div class="rep-kpi-sub rep-kpi-trend-up">▲ ${totalRead.toLocaleString('ru-RU')} писем</div>
    </div>
    <div class="rep-kpi-card">
        <div class="rep-kpi-label">Отправителей</div>
        <div class="rep-kpi-value">${data.senders.length}</div>
        <div class="rep-kpi-sub">уникальных</div>
    </div>
</div>

<div class="rep-charts-grid">
    <div class="rep-chart-card full-width">
        <div class="rep-chart-title">Активность по письмам</div>
        <div class="rep-chart-subtitle">Входящие по дням за выбранный период</div>
        <div class="rep-chart-legend">
            <span class="rep-legend-item"><span class="rep-legend-dot" style="background:#2563eb"></span>Всего</span>
            <span class="rep-legend-item"><span class="rep-legend-dot" style="background:#f59e0b"></span>Непрочитанные</span>
        </div>
        <div style="position:relative;height:200px"><canvas id="repActivityChart"></canvas></div>
    </div>
    <div class="rep-chart-card">
        <div class="rep-chart-title">По папкам</div>
        <div class="rep-chart-subtitle">Распределение писем</div>
        <div class="rep-chart-legend" id="repFolderLegend"></div>
        <div style="position:relative;height:190px"><canvas id="repFolderChart"></canvas></div>
    </div>
    <div class="rep-chart-card">
        <div class="rep-chart-title">Прочитанные / непрочитанные</div>
        <div class="rep-chart-subtitle">Динамика статусов</div>
        <div class="rep-chart-legend">
            <span class="rep-legend-item"><span class="rep-legend-dot" style="background:#16a34a"></span>Прочитанные</span>
            <span class="rep-legend-item"><span class="rep-legend-dot" style="background:#dc2626"></span>Непрочитанные</span>
        </div>
        <div style="position:relative;height:190px"><canvas id="repReadChart"></canvas></div>
    </div>
    <div class="rep-chart-card">
        <div class="rep-chart-title">Топ отправителей</div>
        <div class="rep-chart-subtitle">По количеству писем</div>
        <div class="rep-senders-list" id="repSendersList"></div>
    </div>
    <div class="rep-chart-card">
        <div class="rep-chart-title">Тепловая карта активности</div>
        <div class="rep-chart-subtitle">По дням недели и времени суток</div>
        <div class="rep-heatmap" id="repHeatmap"></div>
    </div>
</div>`;
}

// ─── Вспомогательные HTML-генераторы ─────────────────────────────────────────

const MEDALS = ['🥇','🥈','🥉'];
const EMP_AVATAR_COLORS = ['#2563eb','#0891b2','#7c3aed','#0d9488','#d97706','#dc2626','#16a34a','#9333ea','#0284c7','#b45309'];

function buildPodium(list, field, unit, lowerBetter = false) {
    return list.map((e, i) => `
        <div class="rep-podium-card">
            <div class="rep-podium-rank">${MEDALS[i]}</div>
            <div class="rep-podium-info">
                <div class="rep-podium-name">${escH(e.name)}</div>
                <div class="rep-podium-dept">${escH(e.dept)} · ${escH(e.role)}</div>
                <div class="rep-podium-stat">
                    ${lowerBetter ? '⏱' : '★'}
                    <strong>${e[field]}</strong> ${unit}
                </div>
            </div>
        </div>
    `).join('');
}

function buildEmpRows(employees) {
    const sorted = [...employees].sort((a, b) => {
        const av = a[repSortCol], bv = b[repSortCol];
        if (typeof av === 'string') return av.localeCompare(bv) * repSortDir;
        return (av - bv) * repSortDir;
    });
    return sorted.map((e, i) => {
        const initials = e.name.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase();
        const color = EMP_AVATAR_COLORS[e.id % EMP_AVATAR_COLORS.length];
        const replyBadge = e.avgReplyH <= 2 ? 'rep-badge-fast' : e.avgReplyH <= 6 ? 'rep-badge-medium' : 'rep-badge-slow';
        const replyLabel = e.avgReplyH <= 2 ? '⚡ Быстро' : e.avgReplyH <= 6 ? '⏱ Норма' : '🐢 Медленно';
        const sc = e.score;
        const scColor = scoreColor(sc);
        return `
        <tr data-dept="${escH(e.dept)}" data-score="${sc}">
            <td>
                <div class="rep-emp-cell">
                    <div class="rep-emp-avatar" style="background:${color}">${initials}</div>
                    <div>
                        <div class="rep-emp-name">${escH(e.name)}</div>
                        <div class="rep-emp-dept">${escH(e.dept)} · ${escH(e.role)}</div>
                    </div>
                </div>
            </td>
            <td><strong>${e.received}</strong></td>
            <td>
                <div class="rep-score-wrap">
                    <div class="rep-score-bar-bg"><div class="rep-score-bar" style="width:${e.replyRate}%;background:#2563eb"></div></div>
                    <span class="rep-score-val" style="color:#2563eb">${e.replyRate}%</span>
                </div>
            </td>
            <td>
                <span class="rep-badge ${replyBadge}">${replyLabel}</span>
                <span style="font-size:12px;color:var(--text-secondary);margin-left:6px">${e.avgReplyH}ч</span>
            </td>
            <td>
                <div class="rep-score-wrap">
                    <div class="rep-score-bar-bg"><div class="rep-score-bar" style="width:${e.readRate}%;background:#0891b2"></div></div>
                    <span class="rep-score-val" style="color:#0891b2">${e.readRate}%</span>
                </div>
            </td>
            <td>${e.important > 10 ? `<span style="color:#dc2626;font-weight:600">${e.important}</span>` : e.important}</td>
            <td>
                <div class="rep-score-wrap">
                    <div class="rep-score-bar-bg"><div class="rep-score-bar" style="width:${sc}%;background:${scColor}"></div></div>
                    <span class="rep-score-val" style="color:${scColor}">${sc}</span>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function scoreColor(s) {
    if (s >= 70) return '#16a34a';
    if (s >= 40) return '#d97706';
    return '#dc2626';
}

function sortIcon(col) {
    if (repSortCol !== col) return '<span style="opacity:.3;font-size:10px">⇅</span>';
    return repSortDir === -1 ? '<span style="font-size:10px">▼</span>' : '<span style="font-size:10px">▲</span>';
}

// ─── Кэш последних загруженных данных ────────────────────────────────────────

let repLastData = null;

// ─── Сортировка и фильтрация таблицы ─────────────────────────────────────────

window.sortEmpTable = function(col) {
    if (repSortCol === col) repSortDir *= -1;
    else { repSortCol = col; repSortDir = -1; }
    const tbody = document.getElementById('repEmpTbody');
    if (tbody && repLastData) tbody.innerHTML = buildEmpRows(applyEmpFilters(repLastData.employees));
    document.querySelectorAll('.rep-emp-table th').forEach(th => {
        const col2 = th.getAttribute('onclick')?.match(/'(\w+)'/)?.[1];
        if (col2) th.innerHTML = th.textContent.trim() + ' ' + sortIcon(col2);
    });
};

window.filterEmpTable = function() {
    const tbody = document.getElementById('repEmpTbody');
    if (tbody && repLastData) tbody.innerHTML = buildEmpRows(applyEmpFilters(repLastData.employees));
};

function applyEmpFilters(employees) {
    const dept = document.getElementById('repEmpDeptFilter')?.value || '';
    const perf = document.getElementById('repEmpPerfFilter')?.value || '';
    return employees.filter(e => {
        if (dept && e.dept !== dept) return false;
        if (perf === 'high' && e.score < 70)  return false;
        if (perf === 'mid'  && (e.score < 40 || e.score >= 70)) return false;
        if (perf === 'low'  && e.score >= 40) return false;
        return true;
    });
}

function bindEmpTableSort(data) {
    // уже через onclick в HTML
}

// ─── Все Chart.js графики ─────────────────────────────────────────────────────

function renderAllCharts(data) {
    renderEmpScoreChart(data);
    renderReplyTimeChart(data);
    renderDeptEmpChart(data);
    renderReplyRateChart(data);
    renderActivityChart(data);
    renderFolderChart(data);
    renderReadChart(data);
    renderSendersList(data);
    renderHeatmap(data);
}

function destroyAllCharts() {
    Object.values(repCharts).forEach(c => { try { c.destroy(); } catch {} });
    repCharts = {};
}

function renderEmpScoreChart(data) {
    const ctx = document.getElementById('repEmpScoreChart');
    if (!ctx) return;
    const sorted = [...data.employees].sort((a,b) => b.score - a.score);
    const colors = sorted.map(e => scoreColor(e.score));
    repCharts.empScore = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(e => e.name.split(' ')[0]),
            datasets: [{ label: 'Score', data: sorted.map(e => e.score), backgroundColor: colors, borderRadius: 5 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { min: 0, max: 100, ticks: { font: { size: 11 }, color: '#64748b' }, grid: { color: '#f1f5f9' } },
                y: { ticks: { font: { size: 12 }, color: '#374151' }, grid: { display: false } }
            }
        }
    });
}

function renderReplyTimeChart(data) {
    const ctx = document.getElementById('repReplyTimeChart');
    if (!ctx) return;
    const sorted = [...data.employees].sort((a,b) => a.avgReplyH - b.avgReplyH);
    const colors = sorted.map(e => e.avgReplyH <= 2 ? '#16a34a' : e.avgReplyH <= 6 ? '#d97706' : '#dc2626');
    repCharts.replyTime = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(e => e.name.split(' ')[0]),
            datasets: [{ label: 'Часов', data: sorted.map(e => e.avgReplyH), backgroundColor: colors, borderRadius: 5 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                annotation: {}
            },
            scales: {
                x: { beginAtZero: true, ticks: { font: { size: 11 }, color: '#64748b' }, grid: { color: '#f1f5f9' } },
                y: { ticks: { font: { size: 12 }, color: '#374151' }, grid: { display: false } }
            }
        }
    });
}

function renderDeptEmpChart(data) {
    const ctx = document.getElementById('repDeptEmpChart');
    if (!ctx) return;
    const deptMap = {};
    data.employees.forEach(e => { deptMap[e.dept] = (deptMap[e.dept] || 0) + e.received; });
    const entries = Object.entries(deptMap).sort((a,b) => b[1]-a[1]);
    const colors = ['#2563eb','#0891b2','#7c3aed','#0d9488','#d97706','#dc2626'];
    repCharts.deptEmp = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: entries.map(([d]) => d),
            datasets: [{ label: 'Писем', data: entries.map(([,c]) => c), backgroundColor: colors, borderRadius: 5 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { font: { size: 11 }, color: '#64748b' }, grid: { display: false } },
                y: { ticks: { font: { size: 11 }, color: '#64748b' }, grid: { color: '#f1f5f9' }, beginAtZero: true }
            }
        }
    });
}

function renderReplyRateChart(data) {
    const ctx = document.getElementById('repReplyRateChart');
    if (!ctx) return;
    const sorted = [...data.employees].sort((a,b) => b.replyRate - a.replyRate);
    repCharts.replyRate = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(e => e.name.split(' ')[0]),
            datasets: [{ label: '%', data: sorted.map(e => e.replyRate), backgroundColor: '#0891b2', borderRadius: 5, barThickness: 14 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { font: { size: 11 }, color: '#64748b', maxRotation: 40, autoSkip: false }, grid: { display: false } },
                y: { min: 0, max: 100, ticks: { font: { size: 11 }, color: '#64748b', callback: v => v+'%' }, grid: { color: '#f1f5f9' } }
            }
        }
    });
}

function renderActivityChart(data) {
    const ctx = document.getElementById('repActivityChart');
    if (!ctx) return;
    const step = Math.max(1, Math.floor(data.labels.length / 60));
    const lbls = data.labels.filter((_,i) => i%step===0);
    const cnts = data.counts.filter((_,i) => i%step===0);
    const unrd = data.unread.filter((_,i) => i%step===0);
    repCharts.activity = new Chart(ctx, {
        type: 'line',
        data: {
            labels: lbls,
            datasets: [
                { label: 'Всего', data: cnts, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.08)', borderWidth: 2, pointRadius: lbls.length>30?0:3, fill: true, tension: .35 },
                { label: 'Непрочитанные', data: unrd, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.07)', borderWidth: 2, pointRadius: lbls.length>30?0:3, fill: true, tension: .35, borderDash: [4,3] }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { font:{size:11}, maxRotation:40, autoSkip:true, color:'#64748b' }, grid: { display:false } },
                y: { ticks: { font:{size:11}, color:'#64748b' }, grid: { color:'#f1f5f9' }, beginAtZero:true }
            }
        }
    });
}

function renderFolderChart(data) {
    const ctx = document.getElementById('repFolderChart');
    if (!ctx) return;
    const folderColors = ['#2563eb','#0891b2','#7c3aed','#0d9488','#d97706'];
    const total = data.folders.reduce((a,f)=>a+f.count,0);
    const legend = document.getElementById('repFolderLegend');
    if (legend) {
        legend.innerHTML = data.folders.map((f,i) => {
            const pct = total > 0 ? Math.round(f.count/total*100) : 0;
            return `<span class="rep-legend-item"><span class="rep-legend-dot" style="background:${folderColors[i%folderColors.length]}"></span>${f.name} ${pct}%</span>`;
        }).join('');
    }
    repCharts.folder = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: data.folders.map(f=>f.name), datasets: [{ data: data.folders.map(f=>f.count), backgroundColor: folderColors, borderWidth: 2, borderColor:'#fff', hoverOffset:6 }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, cutout:'62%' }
    });
}

function renderReadChart(data) {
    const ctx = document.getElementById('repReadChart');
    if (!ctx) return;
    const step = Math.max(1, Math.floor(data.labels.length/30));
    const lbls = data.labels.filter((_,i)=>i%step===0);
    const readArr = data.counts.filter((_,i)=>i%step===0).map((c,i)=>c-(data.unread.filter((_,j)=>j%step===0)[i]||0));
    const unrdArr = data.unread.filter((_,i)=>i%step===0);
    repCharts.read = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: lbls,
            datasets: [
                { label: 'Прочитанные',   data: readArr, backgroundColor:'#16a34a', borderRadius:3, stack:'s' },
                { label: 'Непрочитанные', data: unrdArr, backgroundColor:'#dc2626', borderRadius:3, stack:'s' }
            ]
        },
        options: {
            responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{display:false} },
            scales: {
                x: { stacked:true, ticks:{font:{size:10},maxRotation:40,autoSkip:true,color:'#64748b'}, grid:{display:false} },
                y: { stacked:true, ticks:{font:{size:11},color:'#64748b'}, grid:{color:'#f1f5f9'}, beginAtZero:true }
            }
        }
    });
}

function renderSendersList(data) {
    const el = document.getElementById('repSendersList');
    if (!el) return;
    const maxCount = data.senders[0]?.count || 1;
    const avatarColors = ['#2563eb','#0891b2','#7c3aed','#0d9488','#d97706','#dc2626','#16a34a'];
    el.innerHTML = data.senders.slice(0,7).map((s,i) => {
        const initials = s.name.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase();
        const barW = Math.round(s.count/maxCount*100);
        return `<div class="rep-sender-row">
            <span class="rep-sender-rank">${i+1}</span>
            <div class="rep-sender-avatar" style="background:${avatarColors[i%avatarColors.length]}">${initials}</div>
            <div class="rep-sender-info">
                <div class="rep-sender-name">${escH(s.name)}</div>
                <div class="rep-sender-email">${escH(s.email)}</div>
            </div>
            <div class="rep-sender-bar-wrap"><div class="rep-sender-bar" style="width:${barW}%"></div></div>
            <span class="rep-sender-count">${s.count}</span>
        </div>`;
    }).join('');
}

function renderHeatmap(data) {
    const el = document.getElementById('repHeatmap');
    if (!el) return;
    const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const slots = ['0–3','3–6','6–9','9–12','12–15','15–18','18–21','21–24'];
    const maxVal = Math.max(...data.heatmap.flat(), 1);
    const col = (v) => {
        if (v===0) return '#f1f5f9';
        const t = v/maxVal;
        return `rgb(${Math.round(37+163*(1-t))},${Math.round(99+121*(1-t))},${Math.round(235+5*(1-t))})`;
    };
    let html = '<table><thead><tr><th></th>'+slots.map(s=>`<th>${s}</th>`).join('')+'</tr></thead><tbody>';
    data.heatmap.forEach((row,di) => {
        html += `<tr><th style="text-align:left;padding:4px 6px;color:var(--text-secondary)">${days[di]}</th>`;
        row.forEach(v => {
            const tc = v/maxVal > .45 ? '#fff' : '#64748b';
            html += `<td style="background:${col(v)};color:${tc}">${v>0?v:''}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
}

// ─── Управление периодом ──────────────────────────────────────────────────────

function bindPeriodControls() {
    document.getElementById('repPeriodTabs')?.querySelectorAll('.rep-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            repCurrentPeriod = btn.dataset.period;
            document.querySelectorAll('.rep-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const cr = document.getElementById('repCustomRange');
            if (cr) cr.style.display = repCurrentPeriod === 'custom' ? '' : 'none';
            if (repCurrentPeriod !== 'custom') {
                destroyAllCharts();
                renderReports();
            }
        });
    });
}

window.applyCustomPeriod = function() {
    const s = document.getElementById('repDateStart')?.value;
    const e = document.getElementById('repDateEnd')?.value;
    if (!s || !e) return;
    repCustomStart = s; repCustomEnd = e;
    destroyAllCharts();
    renderReports();
};

function escH(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

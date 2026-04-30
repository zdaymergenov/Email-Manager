// reports.js — v3: Обзор + Аналитика для руководителя + Конструктор

let repCharts = {};
let repCurrentPeriod = '30';
let repCustomStart = null;
let repCustomEnd = null;
let repSortCol = 'score';
let repSortDir = -1;
let repLastData = null;
let repActiveTab = 'overview';

// ─── Builder state ────────────────────────────────────────────────────────────
let bldr = {
    blocks: [],
    period: '30',
    start: '',
    end: '',
    savedReports: [],
    editingId: null,
    charts: {},
    nextId: 1,
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'reports') setTimeout(() => initReports(), 50);
        });
    });
});

window.initReports = function () {
    if (!window.Chart) { loadChartJs(() => renderReports()); }
    else { renderReports(); }
};

function loadChartJs(cb) {
    if (document.getElementById('chartjs-script')) { cb(); return; }
    const s = document.createElement('script');
    s.id = 'chartjs-script';
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
    s.onload = cb;
    document.head.appendChild(s);
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function fetchReportData(period, start, end) {
    const p = new URLSearchParams();
    if (period === 'custom' && start && end) { p.set('start', start); p.set('end', end); }
    else { p.set('days', period || 30); }
    const res = await fetch('/api/reports?' + p);
    if (!res.ok) throw new Error(res.status);
    return res.json();
}

// ─── Normalize ────────────────────────────────────────────────────────────────
function normalizeApiData(api) {
    const labels = [], counts = [], unread = [];
    (api.activity || []).forEach(r => {
        const d = new Date(r.day);
        labels.push(d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
        counts.push(r.cnt || 0); unread.push(r.unread_cnt || 0);
    });
    const employees = (api.employees || []).map(e => ({
        id: e.id, name: e.name || '—', dept: e.dept || 'Сотрудники',
        role: e.role === 'admin' ? 'Администратор' : 'Сотрудник',
        received: e.received || 0, replied: e.replied || 0, sent: e.sent || 0,
        avgReplyH: e.avg_reply_h != null ? e.avg_reply_h : null,
        readRate: e.read_rate || 0, replyRate: e.reply_rate || 0,
        important: e.important || 0, score: e.score || 0, trend: e.trend || [],
    }));
    return {
        labels, counts, unread,
        total: api.total || 0, totalUnread: api.total_unread || 0,
        folders: (api.folders || []).map(f => ({ name: f.folder || f.name, count: f.cnt || f.count || 0 })),
        senders: (api.senders || []).map(s => ({ name: s.sender_name || s.sender_email || '—', email: s.sender_email || '', count: s.cnt || 0 })),
        heatmap: api.heatmap || Array.from({ length: 7 }, () => Array(8).fill(0)),
        employees, period: api.period,
    };
}

// ─── Main render ──────────────────────────────────────────────────────────────
async function renderReports() {
    const container = document.getElementById('reports');
    if (!container) return;
    destroyAllCharts();
    container.innerHTML = '<div class="rep-loading">⏳ Загружаем данные...</div>';
    let data;
    try {
        const api = await fetchReportData(repCurrentPeriod, repCustomStart, repCustomEnd);
        data = normalizeApiData(api);
    } catch (e) {
        container.innerHTML = '<div class="rep-loading">❌ Ошибка загрузки. Проверьте сервер.</div>'; return;
    }
    repLastData = data;
    container.innerHTML = buildShell();
    document.querySelectorAll('.rep-inner-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            repActiveTab = btn.dataset.reptab;
            document.querySelectorAll('.rep-inner-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            destroyAllCharts();
            switchTab();
        });
    });
    document.querySelectorAll('.rep-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            repCurrentPeriod = btn.dataset.period;
            document.querySelectorAll('.rep-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const cr = document.getElementById('repCustomRange');
            if (cr) cr.style.display = repCurrentPeriod === 'custom' ? '' : 'none';
            if (repCurrentPeriod !== 'custom') { destroyAllCharts(); renderReports(); }
        });
    });
    switchTab();
}

function buildShell() {
    return `
<h2 class="section-title">📊 Отчёты</h2>
<div class="rep-toolbar">
    <div class="rep-period-tabs">
        ${['7','30','90','365'].map(d => `<button class="rep-period-btn ${repCurrentPeriod===d?'active':''}" data-period="${d}">${d==='7'?'7 дней':d==='30'?'30 дней':d==='90'?'3 месяца':'Год'}</button>`).join('')}
        <button class="rep-period-btn ${repCurrentPeriod==='custom'?'active':''}" data-period="custom">Период</button>
    </div>
    <div class="rep-custom-range" id="repCustomRange" style="${repCurrentPeriod==='custom'?'':'display:none'}">
        <input type="date" class="rep-date-input" id="repDateStart" value="${repCustomStart||''}">
        <span style="color:var(--text-secondary);font-size:13px">—</span>
        <input type="date" class="rep-date-input" id="repDateEnd" value="${repCustomEnd||''}">
        <button class="rep-apply-btn" onclick="applyCustomPeriod()">Применить</button>
    </div>
</div>
<div class="rep-inner-tabs">
    <button class="rep-inner-tab ${repActiveTab==='overview'?'active':''}" data-reptab="overview">📊 Обзор</button>
    <button class="rep-inner-tab ${repActiveTab==='insights'?'active':''}" data-reptab="insights">📋 Аналитика</button>
    <button class="rep-inner-tab ${repActiveTab==='builder'?'active':''}" data-reptab="builder">🛠 Конструктор</button>
</div>
<div id="repTabContent"></div>`;
}

function switchTab() {
    if (repActiveTab === 'overview') renderOverviewTab(repLastData);
    else if (repActiveTab === 'insights') renderInsightsTab(repLastData);
    else if (repActiveTab === 'builder') renderBuilderTab();
}

window.applyCustomPeriod = () => {
    repCustomStart = document.getElementById('repDateStart')?.value;
    repCustomEnd = document.getElementById('repDateEnd')?.value;
    if (repCustomStart && repCustomEnd) { destroyAllCharts(); renderReports(); }
};

// ═══════════════════════════════════════════════════════════════
// ВК. 1 — ОБЗОР
// ═══════════════════════════════════════════════════════════════
function renderOverviewTab(data) {
    const c = document.getElementById('repTabContent'); if (!c) return;
    const validEmp = data.employees.filter(e => e.avgReplyH !== null);
    const avgReply = validEmp.length ? +(validEmp.reduce((s, e) => s + e.avgReplyH, 0) / validEmp.length).toFixed(1) : 0;
    const avgScore = data.employees.length ? Math.round(data.employees.reduce((s, e) => s + e.score, 0) / data.employees.length) : 0;
    const topEmp = [...data.employees].sort((a, b) => b.score - a.score).slice(0, 3);
    const fastEmp = [...data.employees].filter(e => e.avgReplyH !== null).sort((a, b) => a.avgReplyH - b.avgReplyH).slice(0, 3);
    const avgPerDay = data.counts.length ? Math.round(data.total / data.counts.length) : 0;

    c.innerHTML = `
<div class="rep-section-title">👥 Команда</div>
<div class="rep-kpi-grid">
    <div class="rep-kpi-card"><div class="rep-kpi-label">Средний Score</div><div class="rep-kpi-value" style="color:${scoreColor(avgScore)}">${avgScore}</div><div class="rep-kpi-sub">из 100 баллов</div></div>
    <div class="rep-kpi-card"><div class="rep-kpi-label">Среднее время ответа</div><div class="rep-kpi-value">${avgReply}ч</div><div class="rep-kpi-sub">${avgReply<=2?'🟢 Отлично':avgReply<=6?'🟡 Норма':'🔴 Медленно'}</div></div>
    <div class="rep-kpi-card"><div class="rep-kpi-label">Сотрудников</div><div class="rep-kpi-value">${data.employees.length}</div><div class="rep-kpi-sub">активных</div></div>
    <div class="rep-kpi-card"><div class="rep-kpi-label">Лидер</div><div class="rep-kpi-value" style="font-size:15px">${topEmp[0]?.name.split(' ')[0]||'—'}</div><div class="rep-kpi-sub rep-kpi-trend-up">★ ${topEmp[0]?.score||0} баллов</div></div>
    <div class="rep-kpi-card"><div class="rep-kpi-label">Быстрее всех</div><div class="rep-kpi-value" style="font-size:15px">${fastEmp[0]?.name.split(' ')[0]||'—'}</div><div class="rep-kpi-sub rep-kpi-trend-up">⚡ ${fastEmp[0]?.avgReplyH||0}ч</div></div>
    <div class="rep-kpi-card"><div class="rep-kpi-label">Обработали писем</div><div class="rep-kpi-value">${data.employees.reduce((s,e)=>s+e.received,0).toLocaleString('ru-RU')}</div><div class="rep-kpi-sub">за период</div></div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px">
    <div><div class="rep-section-title" style="font-size:13px">🏆 Топ по эффективности</div><div class="rep-podium-grid" style="grid-template-columns:1fr">${buildPodium(topEmp,'score','баллов')}</div></div>
    <div><div class="rep-section-title" style="font-size:13px">⚡ Быстрее всех отвечают</div><div class="rep-podium-grid" style="grid-template-columns:1fr">${buildPodium(fastEmp,'avgReplyH','ч ответ',true)}</div></div>
</div>

<div class="rep-charts-grid">
    <div class="rep-chart-card"><div class="rep-chart-title">Score сотрудников</div><div style="height:240px"><canvas id="chartEmpScore"></canvas></div></div>
    <div class="rep-chart-card"><div class="rep-chart-title">Время первого ответа</div><div style="height:240px"><canvas id="chartReplyTime"></canvas></div></div>
    <div class="rep-chart-card"><div class="rep-chart-title">Процент ответов</div><div style="height:220px"><canvas id="chartReplyRate"></canvas></div></div>
    <div class="rep-chart-card"><div class="rep-chart-title">Активность по отделам</div><div style="height:220px"><canvas id="chartDept"></canvas></div></div>
</div>

<div class="rep-section-title" style="margin-top:8px">📋 Таблица сотрудников</div>
<div class="rep-emp-filter-bar">
    <select class="rep-emp-filter-select" id="repEmpDeptFilter" onchange="filterEmpTable()">
        <option value="">Все отделы</option>
        ${[...new Set(data.employees.map(e=>e.dept))].map(d=>`<option value="${d}">${d}</option>`).join('')}
    </select>
    <select class="rep-emp-filter-select" id="repEmpPerfFilter" onchange="filterEmpTable()">
        <option value="">Все уровни</option>
        <option value="high">Высокий ≥70</option>
        <option value="mid">Средний 40–69</option>
        <option value="low">Низкий &lt;40</option>
    </select>
</div>
<div class="rep-emp-table-wrap">
    <table class="rep-emp-table">
        <thead><tr>
            <th onclick="sortEmpTable('name')">Сотрудник ${sortIcon('name')}</th>
            <th onclick="sortEmpTable('received')">Получено ${sortIcon('received')}</th>
            <th onclick="sortEmpTable('sent')">Отправлено ${sortIcon('sent')}</th>
            <th onclick="sortEmpTable('replyRate')">% ответов ${sortIcon('replyRate')}</th>
            <th onclick="sortEmpTable('avgReplyH')">Время ответа ${sortIcon('avgReplyH')}</th>
            <th onclick="sortEmpTable('readRate')">% прочитано ${sortIcon('readRate')}</th>
            <th onclick="sortEmpTable('score')">Score ${sortIcon('score')}</th>
        </tr></thead>
        <tbody id="repEmpTbody">${buildEmpRows(data.employees)}</tbody>
    </table>
</div>

<div class="rep-divider"></div>
<div class="rep-section-title">📬 Почта за период</div>
<div class="rep-kpi-grid">
    <div class="rep-kpi-card"><div class="rep-kpi-label">Всего писем</div><div class="rep-kpi-value">${data.total.toLocaleString('ru-RU')}</div><div class="rep-kpi-sub">≈ ${avgPerDay}/день</div></div>
    <div class="rep-kpi-card"><div class="rep-kpi-label">Непрочитанных</div><div class="rep-kpi-value">${data.totalUnread.toLocaleString('ru-RU')}</div><div class="rep-kpi-sub">${data.total>0?Math.round(data.totalUnread/data.total*100):0}% от всех</div></div>
    <div class="rep-kpi-card"><div class="rep-kpi-label">Уникальных отправителей</div><div class="rep-kpi-value">${data.senders.length}</div><div class="rep-kpi-sub">контактов</div></div>
</div>
<div class="rep-charts-grid">
    <div class="rep-chart-card full-width"><div class="rep-chart-title">Поток писем по дням</div><div class="rep-chart-legend"><span class="rep-legend-item"><span class="rep-legend-dot" style="background:#2563eb"></span>Всего</span><span class="rep-legend-item"><span class="rep-legend-dot" style="background:#f59e0b"></span>Непрочитанные</span></div><div style="height:200px"><canvas id="chartActivity"></canvas></div></div>
    <div class="rep-chart-card"><div class="rep-chart-title">По папкам</div><div class="rep-chart-legend" id="repFolderLegend"></div><div style="height:190px"><canvas id="chartFolders"></canvas></div></div>
    <div class="rep-chart-card"><div class="rep-chart-title">Топ отправителей</div><div class="rep-senders-list" id="repSendersList"></div></div>
    <div class="rep-chart-card full-width"><div class="rep-chart-title">Тепловая карта активности</div><div class="rep-heatmap" id="repHeatmap"></div></div>
</div>`;

    renderChart_EmpScore(data);
    renderChart_ReplyTime(data);
    renderChart_ReplyRate(data);
    renderChart_Dept(data);
    renderChart_Activity(data);
    renderChart_Folders(data);
    renderSendersList(data);
    renderHeatmap(data);
}

// ═══════════════════════════════════════════════════════════════
// ВК. 2 — АНАЛИТИКА ДЛЯ РУКОВОДИТЕЛЯ
// ═══════════════════════════════════════════════════════════════
function renderInsightsTab(data) {
    const c = document.getElementById('repTabContent'); if (!c) return;

    const period = data.period ? `${data.period.start} — ${data.period.end}` : '';
    const days = data.counts.length || 1;
    const avgPerDay = Math.round(data.total / days);

    // Считаем данные для выводов
    const validEmp = data.employees.filter(e => e.avgReplyH !== null);
    const avgReply = validEmp.length ? +(validEmp.reduce((s,e) => s+e.avgReplyH, 0) / validEmp.length).toFixed(1) : null;
    const avgScore = data.employees.length ? Math.round(data.employees.reduce((s,e) => s+e.score, 0) / data.employees.length) : 0;
    const highPerf  = data.employees.filter(e => e.score >= 70);
    const midPerf   = data.employees.filter(e => e.score >= 40 && e.score < 70);
    const lowPerf   = data.employees.filter(e => e.score < 40);
    const sortedScore = [...data.employees].sort((a,b) => b.score - a.score);
    const sortedReply = [...validEmp].sort((a,b) => a.avgReplyH - b.avgReplyH);
    const sortedLoad  = [...data.employees].sort((a,b) => b.received - a.received);
    const maxLoad = sortedLoad[0]?.received || 1;

    // Автоматические выводы
    const conclusions = [];
    if (lowPerf.length > 0) conclusions.push({ type:'warn', text:`${lowPerf.length} сотр. с низким score (<40): ${lowPerf.map(e=>e.name.split(' ')[0]).join(', ')} — стоит разобраться в причинах.` });
    if (avgReply !== null && avgReply > 6) conclusions.push({ type:'warn', text:`Среднее время ответа ${avgReply}ч — выше нормы (6ч). Клиенты ждут слишком долго.` });
    if (avgReply !== null && avgReply <= 2) conclusions.push({ type:'good', text:`Среднее время ответа ${avgReply}ч — отличный показатель. Команда реагирует быстро.` });
    if (highPerf.length >= Math.ceil(data.employees.length * 0.7)) conclusions.push({ type:'good', text:`${highPerf.length} из ${data.employees.length} сотрудников с высоким score — команда работает эффективно.` });
    const loadDiff = maxLoad > 0 && sortedLoad.length > 1 ? Math.round((maxLoad - (sortedLoad[sortedLoad.length-1]?.received||0)) / maxLoad * 100) : 0;
    if (loadDiff > 60) conclusions.push({ type:'warn', text:`Нагрузка распределена неравномерно: разница между самым загруженным и наименее загруженным — ${loadDiff}%.` });
    if (data.totalUnread / (data.total || 1) > 0.3) conclusions.push({ type:'warn', text:`${Math.round(data.totalUnread/data.total*100)}% писем не прочитаны — возможно, команда не справляется с потоком.` });
    if (conclusions.length === 0) conclusions.push({ type:'good', text:'Все ключевые показатели в норме. Команда работает стабильно.' });

    c.innerHTML = `
<div class="ins-header">
    <div class="ins-header-title">📋 Аналитика для руководителя</div>
    <div class="ins-header-sub">Период: ${period} · ${data.employees.length} сотрудников · ${data.total.toLocaleString('ru-RU')} писем</div>
</div>

<!-- Автовыводы -->
<div class="ins-conclusions">
    <div class="ins-block-title">💡 Автоматические выводы</div>
    ${conclusions.map(c => `<div class="ins-conclusion ins-conclusion-${c.type}"><span class="ins-conclusion-icon">${c.type==='good'?'✅':'⚠️'}</span><span>${c.text}</span></div>`).join('')}
</div>

<!-- Общий поток -->
<div class="ins-section">
    <div class="ins-block-title">📬 Общий поток писем</div>
    <div class="ins-cards-row">
        <div class="ins-card"><div class="ins-card-num">${data.total.toLocaleString('ru-RU')}</div><div class="ins-card-label">Писем получено</div><div class="ins-card-sub">≈ ${avgPerDay} в день</div></div>
        <div class="ins-card"><div class="ins-card-num" style="color:${data.totalUnread/data.total>.3?'#dc2626':'#16a34a'}">${data.totalUnread.toLocaleString('ru-RU')}</div><div class="ins-card-label">Не обработано</div><div class="ins-card-sub">${data.total>0?Math.round(data.totalUnread/data.total*100):0}% от потока</div></div>
        <div class="ins-card"><div class="ins-card-num">${data.senders.length}</div><div class="ins-card-label">Уникальных контактов</div><div class="ins-card-sub">писали в этот период</div></div>
        <div class="ins-card"><div class="ins-card-num">${data.folders.length}</div><div class="ins-card-label">Папок / ящиков</div><div class="ins-card-sub">${data.folders[0]?.name||'—'} — самая активная</div></div>
    </div>
    <div class="ins-chart-wrap">
        <div class="ins-chart-title">Поток входящих писем по дням — можно увидеть пики нагрузки</div>
        <div style="height:180px"><canvas id="insChartFlow"></canvas></div>
    </div>
</div>

<!-- Нагрузка на команду -->
<div class="ins-section">
    <div class="ins-block-title">⚖️ Нагрузка на сотрудников</div>
    <div class="ins-explain">Сколько писем приходится на каждого сотрудника. Помогает понять: кто перегружен, а кто недогружен — основание для перераспределения задач или изменения штата.</div>
    <div class="ins-emp-bars">
        ${sortedLoad.map(e => {
            const pct = Math.round(e.received / maxLoad * 100);
            const level = pct > 70 ? 'high' : pct > 30 ? 'mid' : 'low';
            const colors = { high: '#dc2626', mid: '#d97706', low: '#16a34a' };
            return `<div class="ins-emp-bar-row">
                <div class="ins-emp-bar-name" title="${escH(e.name)}">${escH(e.name.split(' ')[0])} ${e.name.split(' ')[1]?e.name.split(' ')[1][0]+'.':''}</div>
                <div class="ins-bar-wrap"><div class="ins-bar" style="width:${pct}%;background:${colors[level]}"></div></div>
                <div class="ins-emp-bar-val">${e.received} <span class="ins-bar-label">писем</span></div>
                <div class="ins-emp-bar-sent">${e.sent} <span class="ins-bar-label">отпр.</span></div>
            </div>`;
        }).join('')}
    </div>
    <div class="ins-insight-box">
        <strong>Вывод:</strong>
        ${sortedLoad.length > 1 ? `Наибольшая нагрузка у <strong>${sortedLoad[0]?.name||'—'}</strong> (${sortedLoad[0]?.received||0} писем). Наименьшая у <strong>${sortedLoad[sortedLoad.length-1]?.name||'—'}</strong> (${sortedLoad[sortedLoad.length-1]?.received||0} писем).
        ${loadDiff > 50 ? ' <span style="color:#dc2626">Разница значительная — рекомендуется выровнять нагрузку.</span>' : ' Нагрузка распределена равномерно.'}` : 'Недостаточно данных.'}
    </div>
</div>

<!-- Скорость реакции -->
<div class="ins-section">
    <div class="ins-block-title">⏱ Скорость реакции на входящие</div>
    <div class="ins-explain">Сколько времени проходит от момента, когда клиент написал первое письмо, до ответа сотрудника. Чем меньше — тем лучше. Норма: до 6 часов.</div>
    ${validEmp.length === 0 ? '<div class="ins-no-data">Недостаточно данных о переписке с ответами</div>' : `
    <div class="ins-reply-grid">
        ${sortedReply.map(e => {
            const level = e.avgReplyH <= 2 ? 'fast' : e.avgReplyH <= 6 ? 'ok' : 'slow';
            const labels = { fast: '⚡ Отлично', ok: '✅ Норма', slow: '🐢 Медленно' };
            const colors = { fast: '#16a34a', ok: '#d97706', slow: '#dc2626' };
            return `<div class="ins-reply-card">
                <div class="ins-reply-name">${escH(e.name)}</div>
                <div class="ins-reply-time" style="color:${colors[level]}">${e.avgReplyH}ч</div>
                <div class="ins-reply-badge ins-reply-${level}">${labels[level]}</div>
                <div class="ins-reply-sub">ответил на ${e.replied} из ${e.received} писем</div>
            </div>`;
        }).join('')}
    </div>
    <div class="ins-insight-box">
        <strong>Вывод:</strong> Самый быстрый — <strong>${sortedReply[0]?.name||'—'}</strong> (${sortedReply[0]?.avgReplyH||0}ч).
        ${sortedReply[sortedReply.length-1]?.avgReplyH > 6 ? ` Самый медленный — <strong>${sortedReply[sortedReply.length-1]?.name||'—'}</strong> (${sortedReply[sortedReply.length-1]?.avgReplyH||0}ч) — <span style="color:#dc2626">требует внимания</span>.` : ' Все укладываются в норму.'}
    </div>`}
</div>

<!-- Общая эффективность -->
<div class="ins-section">
    <div class="ins-block-title">🏆 Общая эффективность сотрудников</div>
    <div class="ins-explain">Score — интегральный показатель: учитывает процент ответов (35%), скорость реакции (35%) и процент прочитанных писем (30%). Диапазон: 0–100.</div>
    <div class="ins-score-legend"><span class="ins-score-dot" style="background:#16a34a"></span> Высокий (≥70) <span class="ins-score-dot" style="background:#d97706;margin-left:12px"></span> Средний (40–69) <span class="ins-score-dot" style="background:#dc2626;margin-left:12px"></span> Низкий (&lt;40)</div>
    <div class="ins-score-grid">
        ${sortedScore.map((e,i) => {
            const sc = e.score, c = scoreColor(sc);
            return `<div class="ins-score-card">
                <div class="ins-score-rank">${i+1}</div>
                <div class="ins-score-info">
                    <div class="ins-score-name">${escH(e.name)}</div>
                    <div class="ins-score-details">
                        <span title="% ответов">✉️ ${e.replyRate}%</span>
                        <span title="Время ответа">⏱ ${e.avgReplyH!==null?e.avgReplyH+'ч':'—'}</span>
                        <span title="% прочитано">👁 ${e.readRate}%</span>
                    </div>
                    <div class="ins-score-bar-bg"><div class="ins-score-bar" style="width:${sc}%;background:${c}"></div></div>
                </div>
                <div class="ins-score-val" style="color:${c}">${sc}</div>
            </div>`;
        }).join('')}
    </div>

    <div class="ins-perf-summary">
        <div class="ins-perf-col ins-perf-high">
            <div class="ins-perf-label">✅ Высокий score</div>
            ${highPerf.length ? highPerf.map(e=>`<div class="ins-perf-name">${escH(e.name)}</div>`).join('') : '<div class="ins-perf-none">нет</div>'}
        </div>
        <div class="ins-perf-col ins-perf-mid">
            <div class="ins-perf-label">🟡 Средний score</div>
            ${midPerf.length ? midPerf.map(e=>`<div class="ins-perf-name">${escH(e.name)}</div>`).join('') : '<div class="ins-perf-none">нет</div>'}
        </div>
        <div class="ins-perf-col ins-perf-low">
            <div class="ins-perf-label">🔴 Низкий score</div>
            ${lowPerf.length ? lowPerf.map(e=>`<div class="ins-perf-name">${escH(e.name)}</div>`).join('') : '<div class="ins-perf-none">нет</div>'}
        </div>
    </div>
</div>

<!-- Активность по времени -->
<div class="ins-section">
    <div class="ins-block-title">🕐 Когда приходит больше всего писем</div>
    <div class="ins-explain">Тепловая карта показывает пики нагрузки по дням недели и времени суток. Помогает понять: нужны ли сотрудники в выходные или в ночное время.</div>
    <div class="rep-heatmap" id="insHeatmap"></div>
</div>

<!-- Рекомендации -->
<div class="ins-section ins-recommendations">
    <div class="ins-block-title">💼 Рекомендации для руководителя</div>
    <div class="ins-rec-grid">
        ${lowPerf.length > 0 ? `<div class="ins-rec-card ins-rec-action"><div class="ins-rec-icon">👤</div><div><div class="ins-rec-title">Обратить внимание</div><div class="ins-rec-text">${lowPerf.map(e=>e.name).join(', ')} — низкий score. Провести индивидуальную беседу, выявить причины.</div></div></div>` : ''}
        ${loadDiff > 50 ? `<div class="ins-rec-card ins-rec-action"><div class="ins-rec-icon">⚖️</div><div><div class="ins-rec-title">Перераспределить нагрузку</div><div class="ins-rec-text">${sortedLoad[0]?.name} перегружен. Часть задач можно передать ${sortedLoad[sortedLoad.length-1]?.name}.</div></div></div>` : ''}
        ${avgReply !== null && avgReply > 8 ? `<div class="ins-rec-card ins-rec-action"><div class="ins-rec-icon">🚨</div><div><div class="ins-rec-title">Улучшить время ответа</div><div class="ins-rec-text">Среднее время ответа ${avgReply}ч — клиенты ждут слишком долго. Установить KPI: ответ до 4 часов.</div></div></div>` : ''}
        ${highPerf.length >= 2 ? `<div class="ins-rec-card ins-rec-ok"><div class="ins-rec-icon">🏆</div><div><div class="ins-rec-title">Поощрить лучших</div><div class="ins-rec-text">${highPerf.slice(0,2).map(e=>e.name).join(' и ')} показывают высокие результаты — достойны признания.</div></div></div>` : ''}
        ${data.totalUnread / (data.total||1) > 0.3 ? `<div class="ins-rec-card ins-rec-action"><div class="ins-rec-icon">📭</div><div><div class="ins-rec-title">Разобрать непрочитанные</div><div class="ins-rec-text">${data.totalUnread.toLocaleString('ru-RU')} писем не обработаны (${Math.round(data.totalUnread/data.total*100)}%). Возможно, нужен дополнительный ресурс.</div></div></div>` : ''}
        <div class="ins-rec-card ins-rec-info"><div class="ins-rec-icon">📊</div><div><div class="ins-rec-title">Мониторинг</div><div class="ins-rec-text">Сравнивайте показатели каждый месяц. Тренд важнее одного значения.</div></div></div>
    </div>
</div>`;

    renderChart_Activity(data, 'insChartFlow');
    renderHeatmap(data, 'insHeatmap');
}

// ═══════════════════════════════════════════════════════════════
// ВК. 3 — КОНСТРУКТОР (исправленный)
// ═══════════════════════════════════════════════════════════════
const BLOCK_CATALOG = [
    { type:'total_emails',      label:'📬 Всего писем',          cat:'Метрики', icon:'📬', desc:'Общее количество писем за период' },
    { type:'unread_emails',     label:'📭 Непрочитанных',        cat:'Метрики', icon:'📭', desc:'Количество непрочитанных писем' },
    { type:'replied_emails',    label:'✅ Отвеченных',           cat:'Метрики', icon:'✅', desc:'Количество отвеченных писем' },
    { type:'avg_reply_time',    label:'⏱ Время ответа',          cat:'Метрики', icon:'⏱', desc:'Среднее время первого ответа в часах' },
    { type:'activity_chart',    label:'📈 График по дням',       cat:'Графики', icon:'📈', desc:'Поток писем по дням' },
    { type:'heatmap',           label:'🌡️ Тепловая карта',      cat:'Графики', icon:'🌡️', desc:'Активность по дням и часам суток' },
    { type:'top_senders',       label:'👤 Топ отправителей',     cat:'Таблицы', icon:'👤', desc:'Кто пишет чаще всего' },
    { type:'folders_breakdown', label:'📁 По папкам',            cat:'Таблицы', icon:'📁', desc:'Распределение по почтовым папкам' },
    { type:'employees_table',   label:'👥 Сотрудники',           cat:'Таблицы', icon:'👥', desc:'Сводка по сотрудникам' },
    { type:'load_chart',        label:'⚖️ Нагрузка',            cat:'Графики', icon:'⚖️', desc:'Распределение нагрузки по сотрудникам' },
];

async function renderBuilderTab() {
    bldr.savedReports = await fetchSavedReports();
    const c = document.getElementById('repTabContent'); if (!c) return;
    c.innerHTML = buildBuilderHTML();
    attachBuilderListeners();
}

async function fetchSavedReports() {
    try { const r = await fetch('/api/reports/custom'); if (!r.ok) return []; return r.json(); }
    catch { return []; }
}

function buildBuilderHTML() {
    const editName = bldr.editingId ? (bldr.savedReports.find(r=>r.id===bldr.editingId)?.name||'') : '';
    return `
<div class="bldr-layout">
    <!-- Каталог блоков (левая панель) -->
    <div class="bldr-sidebar" id="bldrSidebar">
        <div class="bldr-sidebar-section">
            <div class="bldr-sidebar-title">📦 Блоки отчёта</div>
            <div class="bldr-sidebar-hint">Нажмите или перетащите блок на холст</div>
            ${['Метрики','Графики','Таблицы'].map(cat => `
                <div class="bldr-cat-label">${cat}</div>
                <div class="bldr-chips-group">
                ${BLOCK_CATALOG.filter(b=>b.cat===cat).map(b=>`
                    <div class="bldr-chip" data-btype="${b.type}" title="${b.desc}">${b.icon} ${b.label.replace(/^\S+\s/,'')}</div>
                `).join('')}
                </div>
            `).join('')}
        </div>

        <div class="bldr-sidebar-section">
            <div class="bldr-sidebar-title">⚙️ Период данных</div>
            <select class="bldr-select" id="bldrPeriod">
                <option value="7"   ${bldr.period==='7'?'selected':''}>7 дней</option>
                <option value="30"  ${bldr.period==='30'?'selected':''}>30 дней</option>
                <option value="90"  ${bldr.period==='90'?'selected':''}>3 месяца</option>
                <option value="365" ${bldr.period==='365'?'selected':''}>Год</option>
                <option value="custom" ${bldr.period==='custom'?'selected':''}>Свой диапазон</option>
            </select>
            <div id="bldrDatesWrap" style="${bldr.period==='custom'?'':'display:none'};margin-top:8px">
                <input type="date" class="bldr-date-input" id="bldrStart" value="${bldr.start}" placeholder="Начало">
                <input type="date" class="bldr-date-input" id="bldrEnd" value="${bldr.end}" placeholder="Конец">
            </div>
        </div>

        <div class="bldr-sidebar-section">
            <div class="bldr-sidebar-title">💾 Сохранённые отчёты</div>
            <div id="bldrSavedList">
                ${bldr.savedReports.length === 0
                    ? '<div class="bldr-saved-empty">Пока нет сохранённых отчётов</div>'
                    : bldr.savedReports.map(r=>`
                        <div class="bldr-saved-item ${bldr.editingId===r.id?'active':''}">
                            <span class="bldr-saved-name">${escH(r.name)}</span>
                            <div class="bldr-saved-btns">
                                <button class="bldr-icon-btn" data-action="load" data-rid="${r.id}" title="Открыть">📂</button>
                                <button class="bldr-icon-btn" data-action="del"  data-rid="${r.id}" title="Удалить">🗑</button>
                            </div>
                        </div>`).join('')}
            </div>
        </div>
    </div>

    <!-- Холст (правая панель) -->
    <div class="bldr-canvas-wrap">
        <div class="bldr-toolbar">
            <input type="text" class="bldr-name-input" id="bldrReportName" placeholder="Название отчёта..." value="${escH(editName)}">
            <div style="display:flex;gap:8px;flex-shrink:0">
                <button class="bldr-btn bldr-btn-ghost" id="bldrBtnClear">🗑 Очистить</button>
                <button class="bldr-btn bldr-btn-secondary" id="bldrBtnPreview">▶ Предпросмотр</button>
                <button class="bldr-btn bldr-btn-primary" id="bldrBtnSave">💾 Сохранить</button>
            </div>
        </div>

        <div class="bldr-canvas" id="bldrCanvas">
            ${renderCanvasContent()}
        </div>

        <div id="bldrPreview" class="bldr-preview-area" style="display:none"></div>
    </div>
</div>`;
}

function renderCanvasContent() {
    if (bldr.blocks.length === 0) return `
        <div class="bldr-empty">
            <div class="bldr-empty-icon">📊</div>
            <div class="bldr-empty-title">Холст пуст</div>
            <div class="bldr-empty-sub">Нажмите на блок слева или перетащите его сюда</div>
        </div>`;
    return bldr.blocks.map(b => buildBlockCard(b)).join('');
}

function buildBlockCard(b) {
    const meta = BLOCK_CATALOG.find(x => x.type === b.type) || { icon:'📊', label:b.type, desc:'' };
    return `<div class="bldr-card" data-bid="${b.id}">
        <div class="bldr-card-head">
            <span class="bldr-card-icon">${meta.icon}</span>
            <span class="bldr-card-label">${meta.label}</span>
            <button class="bldr-card-del" data-bid="${b.id}" title="Удалить">✕</button>
        </div>
        ${b.type==='top_senders'?`<div class="bldr-card-opt"><label>Строк в таблице: <input type="number" min="3" max="50" value="${b.limit||10}" class="bldr-opt-num" data-bid="${b.id}" data-key="limit"></label></div>`:''}
        <div class="bldr-card-desc">${escH(meta.desc)}</div>
    </div>`;
}

// Вешаем все события ОДИН раз через event delegation
function attachBuilderListeners() {
    // Клик по чипу → добавить блок
    document.getElementById('bldrSidebar')?.addEventListener('click', e => {
        const chip = e.target.closest('.bldr-chip');
        if (chip) addBlock(chip.dataset.btype);
        const btn = e.target.closest('[data-action]');
        if (btn) {
            const rid = +btn.dataset.rid;
            if (btn.dataset.action === 'load') loadSaved(rid);
            if (btn.dataset.action === 'del')  deleteSaved(rid);
        }
    });

    // Drag from catalog
    document.getElementById('bldrSidebar')?.addEventListener('dragstart', e => {
        const chip = e.target.closest('.bldr-chip');
        if (chip) e.dataTransfer.setData('btype', chip.dataset.btype);
    });
    document.querySelectorAll('.bldr-chip').forEach(c => c.setAttribute('draggable','true'));

    // Canvas: drop + delegation для удаления и опций
    const canvas = document.getElementById('bldrCanvas');
    if (canvas) {
        canvas.addEventListener('dragover', e => { e.preventDefault(); canvas.classList.add('drag-over'); });
        canvas.addEventListener('dragleave', () => canvas.classList.remove('drag-over'));
        canvas.addEventListener('drop', e => {
            e.preventDefault(); canvas.classList.remove('drag-over');
            const btype = e.dataTransfer.getData('btype');
            if (btype) addBlock(btype);
        });
        canvas.addEventListener('click', e => {
            const delBtn = e.target.closest('.bldr-card-del');
            if (delBtn) { bldr.blocks = bldr.blocks.filter(b => b.id !== delBtn.dataset.bid); refreshCanvas(); }
        });
        canvas.addEventListener('input', e => {
            const inp = e.target.closest('.bldr-opt-num');
            if (inp) {
                const b = bldr.blocks.find(x => x.id === inp.dataset.bid);
                if (b) b[inp.dataset.key] = +inp.value;
            }
        });
    }

    // Period select
    document.getElementById('bldrPeriod')?.addEventListener('change', e => {
        bldr.period = e.target.value;
        const dw = document.getElementById('bldrDatesWrap');
        if (dw) dw.style.display = bldr.period === 'custom' ? '' : 'none';
    });
    document.getElementById('bldrStart')?.addEventListener('change', e => bldr.start = e.target.value);
    document.getElementById('bldrEnd')?.addEventListener('change', e => bldr.end = e.target.value);

    // Toolbar buttons
    document.getElementById('bldrBtnClear')?.addEventListener('click', () => {
        bldr.blocks = []; bldr.editingId = null;
        const n = document.getElementById('bldrReportName'); if(n) n.value='';
        refreshCanvas();
    });
    document.getElementById('bldrBtnPreview')?.addEventListener('click', runPreview);
    document.getElementById('bldrBtnSave')?.addEventListener('click', saveReport);
}

function addBlock(btype) {
    bldr.blocks.push({ id: 'b' + (bldr.nextId++), type: btype, limit: 10 });
    refreshCanvas();
}

function refreshCanvas() {
    const canvas = document.getElementById('bldrCanvas');
    if (canvas) canvas.innerHTML = renderCanvasContent();
    const pr = document.getElementById('bldrPreview');
    if (pr) pr.style.display = 'none';
    // Re-attach canvas delegation (уже висит, новый контент просто рендерится)
}

async function runPreview() {
    if (!bldr.blocks.length) { showToast('Добавьте хотя бы один блок'); return; }
    const pr = document.getElementById('bldrPreview');
    if (!pr) return;
    pr.style.display = '';
    pr.innerHTML = '<div class="rep-loading">⏳ Выполняем отчёт...</div>';
    const config = getBuilderConfig();
    try {
        const res = await fetch('/api/reports/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(config) });
        const data = await res.json();
        pr.innerHTML = buildPreviewHTML(config, data);
        Object.values(bldr.charts).forEach(c=>{try{c.destroy();}catch{}}); bldr.charts = {};
        renderPreviewCharts(config, data);
    } catch { pr.innerHTML = '<div class="rep-loading">❌ Ошибка выполнения</div>'; }
}

function getBuilderConfig() {
    return {
        days:   bldr.period==='custom' ? 30 : +bldr.period,
        start:  bldr.period==='custom' ? bldr.start : null,
        end:    bldr.period==='custom' ? bldr.end   : null,
        blocks: bldr.blocks.map(b => ({ id:b.id, type:b.type, limit:b.limit||10 })),
    };
}

function buildPreviewHTML(config, data) {
    const period = data.period ? `${data.period.start} — ${data.period.end}` : '';
    let html = `<div class="bldr-preview-title">📊 Результат · ${period}</div><div class="bldr-preview-grid">`;
    for (const b of config.blocks) {
        const bd = (data.blocks||{})[b.id];
        const meta = BLOCK_CATALOG.find(x=>x.type===b.type);
        const isWide = ['activity_chart','heatmap','top_senders','folders_breakdown','employees_table','load_chart'].includes(b.type);
        html += `<div class="bldr-prev-block ${isWide?'bldr-prev-wide':''}"><div class="bldr-prev-title">${meta?.label||b.type}</div>`;
        if (!bd) { html += '<div class="bldr-prev-empty">Нет данных</div>'; }
        else if (['total_emails','unread_emails','replied_emails','avg_reply_time'].includes(b.type)) {
            const v = bd.value;
            html += `<div class="bldr-prev-metric">${v===null?'—':(b.type==='avg_reply_time'?v+'ч':v.toLocaleString('ru-RU'))}</div>`;
        } else if (b.type === 'activity_chart' || b.type === 'load_chart') {
            html += `<div style="height:160px"><canvas id="pc_${b.id}"></canvas></div>`;
        } else if (b.type === 'heatmap') {
            html += buildHeatmapHTML(bd.matrix||[]);
        } else if (bd.rows) {
            html += buildPreviewTable(b.type, bd.rows);
        }
        html += '</div>';
    }
    return html + '</div>';
}

function buildPreviewTable(type, rows) {
    if (!rows?.length) return '<div class="bldr-prev-empty">Нет данных</div>';
    const cfg = {
        top_senders:       { heads:['Отправитель','Email','Писем'],         row: r=>[escH(r.sender_name||'—'),`<small>${escH(r.sender_email||'')}</small>`,r.cnt] },
        folders_breakdown: { heads:['Папка','Писем'],                        row: r=>[escH(r.folder||'—'),r.cnt] },
        employees_table:   { heads:['Сотрудник','Получено','Ответов','%'],   row: r=>[escH(r.name||'—'),r.received,r.replied,r.reply_rate+'%'] },
    }[type];
    if (!cfg) return '';
    return `<div style="overflow-x:auto"><table class="bldr-prev-table"><thead><tr>${cfg.heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cfg.row(r).map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function buildHeatmapHTML(matrix) {
    if (!matrix?.length) return '';
    const days=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'], slots=['0–3','3–6','6–9','9–12','12–15','15–18','18–21','21–24'];
    const max = Math.max(...matrix.flat(), 1);
    const col = v => { if(!v) return '#f1f5f9'; const t=v/max; return `rgb(${Math.round(37+163*(1-t))},${Math.round(99+121*(1-t))},235)`; };
    let h='<div class="rep-heatmap"><table><thead><tr><th></th>'+slots.map(s=>`<th>${s}</th>`).join('')+'</tr></thead><tbody>';
    matrix.forEach((row,di)=>{h+=`<tr><th style="text-align:left;padding:4px 6px;color:var(--text-secondary);white-space:nowrap">${days[di]}</th>`;row.forEach(v=>{h+=`<td style="background:${col(v)};color:${v/max>.45?'#fff':'#64748b'}">${v||''}</td>`;});h+='</tr>';});
    return h+'</tbody></table></div>';
}

function renderPreviewCharts(config, data) {
    for (const b of config.blocks) {
        const bd = (data.blocks||{})[b.id];
        const ctx = document.getElementById('pc_'+b.id);
        if (!ctx || !bd) continue;
        if (b.type === 'activity_chart' && bd.labels) {
            bldr.charts[b.id] = new Chart(ctx, {
                type:'line',
                data:{ labels: bd.labels.map(l=>new Date(l).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})), datasets:[{label:'Писем',data:bd.values,borderColor:'#2563eb',backgroundColor:'rgba(37,99,235,.1)',borderWidth:2,fill:true,tension:.3,pointRadius:bd.labels.length>30?0:3}] },
                options:{ responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10},maxRotation:40,autoSkip:true,color:'#64748b'},grid:{display:false}},y:{ticks:{font:{size:10},color:'#64748b'},beginAtZero:true}} }
            });
        } else if (b.type === 'load_chart' && bd.rows) {
            bldr.charts[b.id] = new Chart(ctx, {
                type:'bar',
                data:{ labels: bd.rows.map(r=>r.name), datasets:[{label:'Получено',data:bd.rows.map(r=>r.received),backgroundColor:'#2563eb',borderRadius:4},{label:'Отправлено',data:bd.rows.map(r=>r.replied),backgroundColor:'#0891b2',borderRadius:4}] },
                options:{ responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:11}}}},scales:{x:{ticks:{font:{size:10},color:'#64748b'},grid:{display:false}},y:{ticks:{font:{size:10},color:'#64748b'},beginAtZero:true}} }
            });
        }
    }
}

async function saveReport() {
    const name = (document.getElementById('bldrReportName')?.value||'').trim();
    if (!name) { showToast('Введите название отчёта'); return; }
    if (!bldr.blocks.length) { showToast('Добавьте хотя бы один блок'); return; }
    const body = { name, config: getBuilderConfig() };
    try {
        let res;
        if (bldr.editingId) {
            res = await fetch(`/api/reports/custom/${bldr.editingId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
        } else {
            res = await fetch('/api/reports/custom', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
            if (res.ok) { const d=await res.json(); bldr.editingId=d.id; }
        }
        if (res.ok) { bldr.savedReports=await fetchSavedReports(); refreshSavedList(); showToast('✅ Отчёт сохранён'); }
    } catch { showToast('❌ Ошибка сохранения'); }
}

async function loadSaved(rid) {
    const r = bldr.savedReports.find(x=>x.id===rid); if (!r) return;
    bldr.editingId = rid;
    bldr.blocks = (r.config.blocks||[]).map(b=>({...b}));
    bldr.period = String(r.config.days||30);
    bldr.start  = r.config.start||'';
    bldr.end    = r.config.end||'';
    const c = document.getElementById('repTabContent'); if(!c) return;
    c.innerHTML = buildBuilderHTML();
    attachBuilderListeners();
    const n = document.getElementById('bldrReportName'); if(n) n.value=r.name;
}

async function deleteSaved(rid) {
    if (!confirm('Удалить этот отчёт?')) return;
    await fetch(`/api/reports/custom/${rid}`, {method:'DELETE'});
    bldr.savedReports = bldr.savedReports.filter(x=>x.id!==rid);
    if (bldr.editingId===rid) bldr.editingId=null;
    refreshSavedList();
}

function refreshSavedList() {
    const el = document.getElementById('bldrSavedList'); if (!el) return;
    if (!bldr.savedReports.length) { el.innerHTML='<div class="bldr-saved-empty">Пока нет сохранённых отчётов</div>'; return; }
    el.innerHTML = bldr.savedReports.map(r=>`
        <div class="bldr-saved-item ${bldr.editingId===r.id?'active':''}">
            <span class="bldr-saved-name">${escH(r.name)}</span>
            <div class="bldr-saved-btns">
                <button class="bldr-icon-btn" data-action="load" data-rid="${r.id}">📂</button>
                <button class="bldr-icon-btn" data-action="del"  data-rid="${r.id}">🗑</button>
            </div>
        </div>`).join('');
    // Re-attach saved list buttons via existing sidebar delegation
}

// ═══════════════════════════════════════════════════════════════
// Общие компоненты
// ═══════════════════════════════════════════════════════════════
const MEDALS = ['🥇','🥈','🥉'];
const AVA_COLORS = ['#2563eb','#0891b2','#7c3aed','#0d9488','#d97706','#dc2626','#16a34a','#9333ea'];

function buildPodium(list, field, unit, lowerBetter=false) {
    return list.map((e,i)=>`
        <div class="rep-podium-card">
            <div class="rep-podium-rank">${MEDALS[i]||i+1}</div>
            <div class="rep-podium-info">
                <div class="rep-podium-name">${escH(e.name)}</div>
                <div class="rep-podium-dept">${escH(e.dept)}</div>
                <div class="rep-podium-stat">${lowerBetter?'⏱':'★'} <strong>${e[field]}</strong> ${unit}</div>
            </div>
        </div>`).join('');
}

function buildEmpRows(employees) {
    const sorted = [...employees].sort((a,b)=>{ const av=a[repSortCol],bv=b[repSortCol]; return typeof av==='string'?av.localeCompare(bv)*repSortDir:(av-bv)*repSortDir; });
    return sorted.map(e=>{
        const init=e.name.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase();
        const cl=AVA_COLORS[e.id%AVA_COLORS.length];
        const rb=e.avgReplyH===null?'rep-badge-neutral':e.avgReplyH<=2?'rep-badge-fast':e.avgReplyH<=6?'rep-badge-medium':'rep-badge-slow';
        const rl=e.avgReplyH===null?'—':e.avgReplyH<=2?'⚡ Быстро':e.avgReplyH<=6?'⏱ Норма':'🐢 Медленно';
        const sc=e.score, cc=scoreColor(sc);
        return `<tr>
            <td><div class="rep-emp-cell"><div class="rep-emp-avatar" style="background:${cl}">${init}</div><div><div class="rep-emp-name">${escH(e.name)}</div><div class="rep-emp-dept">${escH(e.role)}</div></div></div></td>
            <td><strong>${e.received}</strong></td>
            <td>${e.sent}</td>
            <td><div class="rep-score-wrap"><div class="rep-score-bar-bg"><div class="rep-score-bar" style="width:${e.replyRate}%;background:#2563eb"></div></div><span class="rep-score-val" style="color:#2563eb">${e.replyRate}%</span></div></td>
            <td><span class="rep-badge ${rb}">${rl}</span>${e.avgReplyH!==null?`<span style="font-size:11px;color:var(--text-secondary);margin-left:5px">${e.avgReplyH}ч</span>`:''}</td>
            <td><div class="rep-score-wrap"><div class="rep-score-bar-bg"><div class="rep-score-bar" style="width:${e.readRate}%;background:#0891b2"></div></div><span class="rep-score-val" style="color:#0891b2">${e.readRate}%</span></div></td>
            <td><div class="rep-score-wrap"><div class="rep-score-bar-bg"><div class="rep-score-bar" style="width:${sc}%;background:${cc}"></div></div><span class="rep-score-val" style="color:${cc}">${sc}</span></div></td>
        </tr>`;
    }).join('');
}

function scoreColor(s) { return s>=70?'#16a34a':s>=40?'#d97706':'#dc2626'; }
function sortIcon(col) { return repSortCol!==col?'<span style="opacity:.3;font-size:10px">⇅</span>':repSortDir===-1?'<span style="font-size:10px">▼</span>':'<span style="font-size:10px">▲</span>'; }

window.sortEmpTable = col => {
    if(repSortCol===col) repSortDir*=-1; else{repSortCol=col;repSortDir=-1;}
    const tb=document.getElementById('repEmpTbody');
    if(tb&&repLastData) tb.innerHTML=buildEmpRows(applyEmpFilters(repLastData.employees));
    document.querySelectorAll('.rep-emp-table th').forEach(th=>{ const m=th.getAttribute('onclick')?.match(/'(\w+)'/); if(m) th.innerHTML=th.textContent.trim()+' '+sortIcon(m[1]); });
};
window.filterEmpTable = () => { const tb=document.getElementById('repEmpTbody'); if(tb&&repLastData) tb.innerHTML=buildEmpRows(applyEmpFilters(repLastData.employees)); };
function applyEmpFilters(emps) {
    const dept=document.getElementById('repEmpDeptFilter')?.value||'';
    const perf=document.getElementById('repEmpPerfFilter')?.value||'';
    return emps.filter(e=>{ if(dept&&e.dept!==dept)return false; if(perf==='high'&&e.score<70)return false; if(perf==='mid'&&(e.score<40||e.score>=70))return false; if(perf==='low'&&e.score>=40)return false; return true; });
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function destroyAllCharts() {
    Object.values(repCharts).forEach(c=>{try{c.destroy();}catch{}});  repCharts={};
    Object.values(bldr.charts).forEach(c=>{try{c.destroy();}catch{}}); bldr.charts={};
}

function renderChart_EmpScore(data) {
    const ctx=document.getElementById('chartEmpScore'); if(!ctx) return;
    const s=[...data.employees].sort((a,b)=>b.score-a.score);
    repCharts.empScore=new Chart(ctx,{type:'bar',data:{labels:s.map(e=>e.name.split(' ')[0]),datasets:[{data:s.map(e=>e.score),backgroundColor:s.map(e=>scoreColor(e.score)),borderRadius:5}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{min:0,max:100,ticks:{font:{size:10},color:'#64748b'},grid:{color:'#f1f5f9'}},y:{ticks:{font:{size:11},color:'#374151'},grid:{display:false}}}}});
}
function renderChart_ReplyTime(data) {
    const ctx=document.getElementById('chartReplyTime'); if(!ctx) return;
    const s=[...data.employees].filter(e=>e.avgReplyH!==null).sort((a,b)=>a.avgReplyH-b.avgReplyH);
    repCharts.replyTime=new Chart(ctx,{type:'bar',data:{labels:s.map(e=>e.name.split(' ')[0]),datasets:[{data:s.map(e=>e.avgReplyH),backgroundColor:s.map(e=>e.avgReplyH<=2?'#16a34a':e.avgReplyH<=6?'#d97706':'#dc2626'),borderRadius:5}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{font:{size:10},color:'#64748b'},grid:{color:'#f1f5f9'}},y:{ticks:{font:{size:11},color:'#374151'},grid:{display:false}}}}});
}
function renderChart_ReplyRate(data) {
    const ctx=document.getElementById('chartReplyRate'); if(!ctx) return;
    const s=[...data.employees].sort((a,b)=>b.replyRate-a.replyRate);
    repCharts.replyRate=new Chart(ctx,{type:'bar',data:{labels:s.map(e=>e.name.split(' ')[0]),datasets:[{data:s.map(e=>e.replyRate),backgroundColor:'#0891b2',borderRadius:5,barThickness:16}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10},color:'#64748b',maxRotation:40},grid:{display:false}},y:{min:0,max:100,ticks:{font:{size:10},color:'#64748b',callback:v=>v+'%'},grid:{color:'#f1f5f9'}}}}});
}
function renderChart_Dept(data) {
    const ctx=document.getElementById('chartDept'); if(!ctx) return;
    const dm={}; data.employees.forEach(e=>{dm[e.dept]=(dm[e.dept]||0)+e.received;});
    const en=Object.entries(dm).sort((a,b)=>b[1]-a[1]);
    repCharts.dept=new Chart(ctx,{type:'bar',data:{labels:en.map(([d])=>d),datasets:[{data:en.map(([,c])=>c),backgroundColor:['#2563eb','#0891b2','#7c3aed','#0d9488','#d97706'],borderRadius:5}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10},color:'#64748b'},grid:{display:false}},y:{ticks:{font:{size:10},color:'#64748b'},beginAtZero:true,grid:{color:'#f1f5f9'}}}}});
}
function renderChart_Activity(data, canvasId='chartActivity') {
    const ctx=document.getElementById(canvasId); if(!ctx) return;
    const step=Math.max(1,Math.floor(data.labels.length/60)); const f=(_,i)=>i%step===0;
    const ch=new Chart(ctx,{type:'line',data:{labels:data.labels.filter(f),datasets:[{label:'Всего',data:data.counts.filter(f),borderColor:'#2563eb',backgroundColor:'rgba(37,99,235,.08)',borderWidth:2,pointRadius:0,fill:true,tension:.35},{label:'Непрочитанные',data:data.unread.filter(f),borderColor:'#f59e0b',backgroundColor:'rgba(245,158,11,.07)',borderWidth:2,pointRadius:0,fill:true,tension:.35,borderDash:[4,3]}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10},maxRotation:40,autoSkip:true,color:'#64748b'},grid:{display:false}},y:{ticks:{font:{size:10},color:'#64748b'},beginAtZero:true,grid:{color:'#f1f5f9'}}}}});
    if(canvasId==='chartActivity') repCharts.activity=ch; else repCharts[canvasId]=ch;
}
function renderChart_Folders(data) {
    const ctx=document.getElementById('chartFolders'); if(!ctx) return;
    const fc=['#2563eb','#0891b2','#7c3aed','#0d9488','#d97706'];
    const total=data.folders.reduce((a,f)=>a+f.count,0);
    const leg=document.getElementById('repFolderLegend');
    if(leg) leg.innerHTML=data.folders.slice(0,5).map((f,i)=>`<span class="rep-legend-item"><span class="rep-legend-dot" style="background:${fc[i%fc.length]}"></span>${f.name} ${total>0?Math.round(f.count/total*100):0}%</span>`).join('');
    repCharts.folder=new Chart(ctx,{type:'doughnut',data:{labels:data.folders.map(f=>f.name),datasets:[{data:data.folders.map(f=>f.count),backgroundColor:fc,borderWidth:2,borderColor:'#fff',hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},cutout:'62%'}});
}
function renderSendersList(data) {
    const el=document.getElementById('repSendersList'); if(!el) return;
    const max=data.senders[0]?.count||1;
    const ac=AVA_COLORS;
    el.innerHTML=data.senders.slice(0,7).map((s,i)=>{
        const init=s.name.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase();
        return `<div class="rep-sender-row"><span class="rep-sender-rank">${i+1}</span><div class="rep-sender-avatar" style="background:${ac[i%ac.length]}">${init}</div><div class="rep-sender-info"><div class="rep-sender-name">${escH(s.name)}</div><div class="rep-sender-email">${escH(s.email)}</div></div><div class="rep-sender-bar-wrap"><div class="rep-sender-bar" style="width:${Math.round(s.count/max*100)}%"></div></div><span class="rep-sender-count">${s.count}</span></div>`;
    }).join('');
}
function renderHeatmap(data, elId='repHeatmap') {
    const el=document.getElementById(elId); if(!el) return;
    const days=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'], slots=['0–3','3–6','6–9','9–12','12–15','15–18','18–21','21–24'];
    const max=Math.max(...data.heatmap.flat(),1);
    const col=v=>{if(!v)return'#f1f5f9';const t=v/max;return`rgb(${Math.round(37+163*(1-t))},${Math.round(99+121*(1-t))},235)`;};
    let h='<table><thead><tr><th></th>'+slots.map(s=>`<th>${s}</th>`).join('')+'</tr></thead><tbody>';
    data.heatmap.forEach((row,di)=>{h+=`<tr><th style="text-align:left;padding:4px 6px;color:var(--text-secondary);white-space:nowrap">${days[di]}</th>`;row.forEach(v=>{h+=`<td style="background:${col(v)};color:${v/max>.45?'#fff':'#64748b'}">${v||''}</td>`;});h+='</tr>';});
    el.innerHTML=h+'</tbody></table>';
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function showToast(msg) {
    const t=document.createElement('div'); t.className='rep-toast'; t.textContent=msg;
    document.body.appendChild(t); setTimeout(()=>t.classList.add('show'),10);
    setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},2500);
}
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* global Chart */
import { opColor, OP_ORDER, esc, isDark, registerPwa } from './common.js';

const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const fmt = (v, unit = '') => (v == null ? '—' : `${nf.format(v)}${unit}`);
const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']; // rampa secuencial (azul)
const STATUS = { 'En hora (<5′)': '--ok', '5–15′': '--warn', '15–30′': '--bad', '30–60′': '--crit', '>60′': '--crit' };
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const PTYPE = { gps: 'GPS', operator: 'Operador', schedule: 'Horario', simulated: 'Simulada' };

// ---------- Filtros (sincronizados con la URL, para poder compartir el informe) ----------
const params = new URLSearchParams(location.search);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const minus = (days) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
$('to').value = params.get('to') ?? today;
$('from').value = params.get('from') ?? minus(29);
$('sim').checked = params.get('includeSimulated') !== '0';

function query() {
  const q = new URLSearchParams({ from: $('from').value, to: $('to').value });
  if ($('operator').value) q.set('operator', $('operator').value);
  if ($('service').value) q.set('service', $('service').value);
  if (!$('sim').checked) q.set('includeSimulated', '0');
  return q;
}
document.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('to').value = today; $('from').value = minus(+b.dataset.days - 1); load();
}));
for (const id of ['from', 'to']) $(id).onchange = () => { document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', 'false')); load(); };
for (const id of ['operator', 'service', 'sim']) $(id).onchange = load;

// ---------- Chart.js: estilo común (marcas finas, rejilla discreta, un solo eje) ----------
const charts = {};
function chart(id, config) {
  charts[id]?.destroy();
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = isDark() ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)';
  charts[id] = new Chart($(id), {
    ...config,
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { padding: 10, displayColors: true } },
      ...config.options,
    },
  });
}
const lineDs = (data, color) => ({ data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.25, spanGaps: true });
const barDs = (data, colors) => ({ data, backgroundColor: colors, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22, borderWidth: 0 });
const yAxis = (title, extra = {}) => ({ beginAtZero: true, title: { display: true, text: title }, grid: { drawTicks: false }, ...extra });

// ---------- Render ----------
async function load() {
  const q = query();
  history.replaceState(null, '', `?${q}`);
  const res = await fetch(`/api/reports?${q}`);
  const r = await res.json();
  if (!res.ok) { $('banner').hidden = false; $('banner').textContent = r.error ?? 'No se han podido cargar los informes.'; return; }

  // Opciones de los desplegables (sin perder la selección)
  for (const [id, list] of [['operator', r.options.operators], ['service', r.options.services]]) {
    const cur = $(id).value;
    const sorted = id === 'operator' ? [...list].sort((a, b) => OP_ORDER.indexOf(a) - OP_ORDER.indexOf(b)) : list;
    $(id).innerHTML = '<option value="">Todos</option>' + sorted.map((v) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  }
  $('exports').innerHTML = [['lineas', 'Ranking de líneas'], ['operadores', 'Compañías'], ['servicios', 'Tipos de tren'], ['diario', 'Serie diaria'], ['horas', 'Por hora del día'], ['viajes', 'Viajes con más retraso']]
    .map(([k, l]) => `<a href="/api/reports/export/${k}?${q}" download>${l}</a>`).join('');

  const simTrips = r.dataQuality.find((d) => d.k === 'simulated')?.trips ?? 0;
  $('banner').hidden = !(r.filters.includeSimulated && simTrips);
  $('banner').innerHTML = `<b>Datos de demostración:</b> el periodo incluye ${nf.format(simTrips)} viajes generados por el simulador. Desmarca «Incluir datos simulados» para ver solo datos reales.`;

  renderTiles(r);
  const days = r.daily.map((d) => new Date(`${d.k}T12:00:00Z`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }));
  chart('c-daily-punct', { type: 'line', data: { labels: days, datasets: [{ label: 'Puntualidad', ...lineDs(r.daily.map((d) => d.punctuality), css('--accent')) }] },
    options: { scales: { y: yAxis('%', { max: 100 }) }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` Puntualidad: ${fmt(c.parsed.y, '%')}` } } } } });
  chart('c-daily-delay', { type: 'line', data: { labels: days, datasets: [{ label: 'Retraso medio', ...lineDs(r.daily.map((d) => d.avgDelay), css('--accent')) }] },
    options: { scales: { y: yAxis('minutos') }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` Retraso medio: ${fmt(c.parsed.y, ' min')}` } } } } });

  const ops = [...r.byOperator].sort((a, b) => b.punctuality - a.punctuality);
  chart('c-op-punct', { type: 'bar', data: { labels: ops.map((o) => o.k), datasets: [{ label: 'Puntualidad', ...barDs(ops.map((o) => o.punctuality), ops.map((o) => opColor(o.k))) }] },
    options: { indexAxis: 'y', scales: { x: yAxis('% en hora', { max: 100 }), y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.x, '%')} en hora · ${nf.format(ops[c.dataIndex].trips)} viajes` } } } } });

  const sv = r.byService.slice(0, 14);
  chart('c-service', { type: 'bar', data: { labels: sv.map((s) => s.k), datasets: [{ label: 'Retraso medio', ...barDs(sv.map((s) => s.avgDelay), css('--accent')) }] },
    options: { indexAxis: 'y', scales: { x: yAxis('minutos'), y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.x, ' min')} · ${fmt(sv[c.dataIndex].punctuality, '%')} en hora` } } } } });

  chart('c-hour', { type: 'bar', data: { labels: r.byHour.map((h) => `${String(h.hour).padStart(2, '0')}h`), datasets: [{ label: 'Retraso medio', ...barDs(r.byHour.map((h) => h.avgDelay), css('--accent')), borderRadius: 4 }] },
    options: { scales: { y: yAxis('minutos'), x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.y, ' min')} · ${fmt(r.byHour[c.dataIndex].punctuality, '%')} en hora` } } } } });

  chart('c-dist', { type: 'bar', data: { labels: r.distribution.map((d) => d.k), datasets: [{ label: 'Viajes', ...barDs(r.distribution.map((d) => d.trips), r.distribution.map((d) => css(STATUS[d.k]))), borderRadius: 4 }] },
    options: { scales: { y: yAxis('viajes'), x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${nf.format(c.parsed.y)} viajes (${fmt((c.parsed.y / (r.kpis.trips || 1)) * 100, '%')})` } } } } });

  renderLines(r);
  renderHeat(r.heatmap);
  renderTables(r);
}

function delta(cur, prev, { unit = '', higherIsBetter = null, pp = false } = {}) {
  if (cur == null || prev == null || !prev && !pp) return '<span>Sin periodo anterior comparable</span>';
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return '<span>= igual que el periodo anterior</span>';
  const better = higherIsBetter == null ? null : (d > 0) === higherIsBetter;
  const cls = better == null ? '' : better ? 'good' : 'badd';
  return `<b class="${cls}">${d > 0 ? '▲' : '▼'} ${nf.format(Math.abs(d))}${pp ? ' pp' : unit}</b> vs periodo anterior${better == null ? '' : better ? ' · mejor' : ' · peor'}`;
}
function renderTiles(r) {
  const k = r.kpis, p = r.previous;
  const tiles = [
    ['Viajes analizados', nf.format(k.trips), delta(k.trips, p.trips)],
    ['Puntualidad (<5 min)', fmt(k.punctuality, '%'), delta(k.punctuality, p.punctuality, { higherIsBetter: true, pp: true })],
    ['Retraso medio', fmt(k.avgDelay, ' min'), delta(k.avgDelay, p.avgDelay, { unit: ' min', higherIsBetter: false })],
    ['Retrasos graves (≥15 min)', fmt(k.severePct, '%'), delta(k.severePct, p.severePct, { higherIsBetter: false, pp: true })],
    ['Minutos de retraso acumulados', nf.format(k.delayMinutes), delta(k.delayMinutes, p.delayMinutes, { higherIsBetter: false })],
    ['Retraso máximo', fmt(k.maxDelay, ' min'), `<span>${nf.format(k.alerts)} alertas en el periodo</span>`],
  ];
  $('tiles').innerHTML = tiles.map(([l, v, d]) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
}

function renderLines(r) {
  const max = Math.max(1, ...r.worstLines.map((l) => l.avgDelay));
  $('t-lines').innerHTML = `<thead><tr><th>#</th><th>Línea / corredor</th><th>Compañía</th><th>Tipo</th><th>Retraso medio</th><th class="n">Puntualidad</th><th class="n">Graves</th><th class="n">Máx.</th><th class="n">Viajes</th></tr></thead><tbody>` +
    r.worstLines.map((l, i) => `<tr class="click" data-op="${esc(l.operator)}">
      <td>${i + 1}</td><td><b>${esc(l.k)}</b></td><td><i class="opdot" style="background:${opColor(l.operator)}"></i>${esc(l.operator)}</td><td>${esc(l.service)}</td>
      <td><div class="inbar"><i style="width:${(l.avgDelay / max) * 100}px"></i>${fmt(l.avgDelay, ' min')}</div></td>
      <td class="n">${fmt(l.punctuality, '%')}</td><td class="n">${fmt(l.severePct, '%')}</td><td class="n">${l.max_delay}′</td><td class="n">${nf.format(l.trips)}</td></tr>`).join('') + '</tbody>';
  $('t-lines').onclick = (e) => { const tr = e.target.closest('tr[data-op]'); if (tr) { $('operator').value = tr.dataset.op; load(); } };
}

function renderHeat(m) {
  const vals = m.flat().filter((v) => v != null);
  const max = Math.max(1, ...vals);
  const color = (v) => (v == null ? 'transparent' : SEQ[Math.min(SEQ.length - 1, Math.floor((v / max) * SEQ.length))]);
  let html = '<div class="heat"><span></span>' + Array.from({ length: 24 }, (_, h) => `<span class="h">${h % 3 === 0 ? h : ''}</span>`).join('');
  m.forEach((row, d) => {
    html += `<span class="d">${WEEKDAYS[d]}</span>` + row.map((v, h) => `<span class="c" style="background:${color(v)}" title="${WEEKDAYS[d]} ${h}:00 — ${v == null ? 'sin datos' : `${nf.format(v)} min de retraso medio`}"></span>`).join('');
  });
  html += '</div><div class="heat-legend">0 min ' + SEQ.map((c) => `<span style="background:${c}"></span>`).join('') + ` ${nf.format(max)} min</div>`;
  $('heat').innerHTML = html;
}

function table(id, head, rows) {
  $(id).innerHTML = `<thead><tr>${head.map((h) => `<th class="${h.endsWith(' ') ? 'n' : ''}">${h.trim()}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="note">Sin datos en el periodo</td></tr>`}</tbody>`;
}
function renderTables(r) {
  const opCell = (o) => `<td><i class="opdot" style="background:${opColor(o)}"></i>${esc(o)}</td>`;
  table('t-ops', ['Compañía', 'Viajes ', 'Puntualidad ', 'Retraso medio ', 'Graves '],
    r.byOperator.map((o) => `<tr>${opCell(o.k)}<td class="n">${nf.format(o.trips)}</td><td class="n">${fmt(o.punctuality, '%')}</td><td class="n">${fmt(o.avgDelay, ' min')}</td><td class="n">${fmt(o.severePct, '%')}</td></tr>`));
  table('t-services', ['Tipo de tren', 'Viajes ', 'Puntualidad ', 'Retraso medio ', 'Máx. '],
    r.byService.map((s) => `<tr><td>${esc(s.k)}</td><td class="n">${nf.format(s.trips)}</td><td class="n">${fmt(s.punctuality, '%')}</td><td class="n">${fmt(s.avgDelay, ' min')}</td><td class="n">${s.max_delay}′</td></tr>`));
  table('t-trips', ['Fecha', 'Tren', 'Trayecto', 'Máx. '],
    r.worstTrips.map((t) => `<tr><td>${t.day.slice(5).split('-').reverse().join('/')}</td><td><i class="opdot" style="background:${opColor(t.operator)}"></i>${esc(t.service)} ${esc(t.number)}</td><td>${esc(t.origin)} → ${esc(t.destination)}</td><td class="n">${t.max_delay}′</td></tr>`));
  table('t-best', ['Línea / corredor', 'Compañía', 'Puntualidad ', 'Retraso medio '],
    r.bestLines.map((l) => `<tr><td>${esc(l.k)}</td>${opCell(l.operator)}<td class="n">${fmt(l.punctuality, '%')}</td><td class="n">${fmt(l.avgDelay, ' min')}</td></tr>`));
  const sev = { critical: 'Crítica', high: 'Alta', medium: 'Media', info: 'Info' };
  const typ = { delay: 'Retraso', stopped: 'Tren detenido', source: 'Fuente de datos' };
  table('t-alerts', ['Tipo', 'Gravedad', 'Nº '],
    [...r.alertsByType].sort((a, b) => b.n - a.n).map((a) => `<tr><td>${typ[a.type] ?? a.type}</td><td><span class="sev sev-${a.severity}" style="display:inline-block;margin-right:6px"></span>${sev[a.severity] ?? a.severity}</td><td class="n">${nf.format(a.n)}</td></tr>`));
  table('t-quality', ['Origen de la posición', 'Viajes '],
    r.dataQuality.map((q) => `<tr><td>${PTYPE[q.k] ?? q.k}</td><td class="n">${nf.format(q.trips)}</td></tr>`));
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', load);
registerPwa();
load();

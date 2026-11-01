import { dayOf } from './history.js';

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', weekday: 'short', hourCycle: 'h23' });
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Construye el filtro SQL común. */
function where({ from, to, operator, service, route, includeSimulated }, dayCol) {
  const c = [`${dayCol} BETWEEN :from AND :to`];
  const p = { from, to };
  if (operator) { c.push('operator = :operator'); p.operator = operator; }
  if (service) { c.push('service = :service'); p.service = service; }
  if (route) { c.push('route = :route'); p.route = route; }
  if (!includeSimulated) c.push("ptype <> 'simulated'");
  return { sql: c.join(' AND '), p };
}

function kpis(db, f) {
  const w = where(f, 'day');
  const k = db.prepare(`SELECT COUNT(*) trips, SUM(last_delay < 5) on_time, AVG(last_delay) avg_delay,
      SUM(max_delay >= 15) severe, SUM(last_delay) delay_minutes, MAX(max_delay) max_delay FROM trips WHERE ${w.sql}`).get(w.p);
  return { trips: k.trips, punctuality: pct(k.on_time, k.trips), avgDelay: r1(k.avg_delay), severePct: pct(k.severe, k.trips), delayMinutes: k.delay_minutes ?? 0, maxDelay: k.max_delay };
}

const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Informe completo para el cuadro de mandos. */
export function buildReport(history, opts = {}) {
  const db = history.db;
  const to = opts.to || dayOf(Date.now());
  const from = opts.from || addDays(to, -29);
  const f = { ...opts, from, to, includeSimulated: opts.includeSimulated !== false && opts.includeSimulated !== '0' };
  const w = where(f, 'day');
  const group = (col, extra = '') => db.prepare(`SELECT ${col} k, COUNT(*) trips, SUM(last_delay < 5) on_time, AVG(last_delay) avg_delay,
      SUM(max_delay >= 15) severe, MAX(max_delay) max_delay ${extra} FROM trips WHERE ${w.sql} GROUP BY ${col}`).all(w.p)
    .map((r) => ({ ...r, punctuality: pct(r.on_time, r.trips), avgDelay: r1(r.avg_delay), severePct: pct(r.severe, r.trips) }));

  // Periodo anterior de la misma longitud, para las variaciones de los KPI
  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const prev = kpis(db, { ...f, from: addDays(from, -spanDays), to: addDays(from, -1) });

  // Agregados horarios → hora del día y mapa de calor día×hora (en hora de Madrid)
  const fromTs = Date.parse(`${from}T00:00:00Z`) - 2 * 3.6e6, toTs = Date.parse(`${to}T23:59:59Z`);
  const hw = where({ ...f, from: fromTs, to: toTs }, 'hour_ts');
  const hours = Array.from({ length: 24 }, () => ({ n: 0, on: 0, sum: 0 }));
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, sum: 0 })));
  for (const r of db.prepare(`SELECT hour_ts, SUM(n) n, SUM(on_time) on_time, SUM(sum_delay) s FROM hourly WHERE ${hw.sql} GROUP BY hour_ts`).all(hw.p)) {
    if (dayOf(r.hour_ts) < from || dayOf(r.hour_ts) > to) continue;
    const parts = Object.fromEntries(hourFmt.formatToParts(r.hour_ts).map((x) => [x.type, x.value]));
    const h = +parts.hour, wd = WD[parts.weekday];
    Object.assign(hours[h], { n: hours[h].n + r.n, on: hours[h].on + r.on_time, sum: hours[h].sum + r.s });
    heat[wd][h].n += r.n; heat[wd][h].sum += r.s;
  }

  const minHour = Math.max(...hours.map((h) => h.n)) * 0.02;
  const minCell = Math.max(...heat.flat().map((c) => c.n)) * 0.02;

  const lines = group('route', ', operator, service').filter((r) => r.trips >= 3);
  const distribution = db.prepare(`SELECT
      SUM(last_delay < 5) "En hora (<5′)", SUM(last_delay >= 5 AND last_delay < 15) "5–15′",
      SUM(last_delay >= 15 AND last_delay < 30) "15–30′", SUM(last_delay >= 30 AND last_delay < 60) "30–60′", SUM(last_delay >= 60) ">60′"
      FROM trips WHERE ${w.sql}`).get(w.p);

  const aw = where({ ...f, from: Date.parse(`${from}T00:00:00Z`) - 7.2e6, to: toTs }, 'ts');
  const alertsByType = db.prepare(`SELECT type, severity, COUNT(*) n FROM alert_log WHERE ${aw.sql.replace("ptype <> 'simulated'", '1=1')} GROUP BY type, severity`).all(aw.p);
  const dataQuality = db.prepare(`SELECT ptype k, COUNT(*) trips FROM trips WHERE day BETWEEN :from AND :to GROUP BY ptype`).all({ from, to });

  return {
    period: { from, to, days: spanDays },
    filters: { operator: f.operator ?? null, service: f.service ?? null, includeSimulated: f.includeSimulated },
    kpis: { ...kpis(db, f), alerts: alertsByType.reduce((s, a) => s + a.n, 0) },
    previous: prev,
    daily: group('day').sort((a, b) => a.k.localeCompare(b.k)),
    byOperator: group('operator').sort((a, b) => b.trips - a.trips),
    byService: group('service').sort((a, b) => b.avgDelay - a.avgDelay),
    worstLines: [...lines].sort((a, b) => b.avgDelay - a.avgDelay).slice(0, 15),
    bestLines: [...lines].sort((a, b) => b.punctuality - a.punctuality || a.avgDelay - b.avgDelay).slice(0, 10),
    // Las franjas con muy pocas muestras (<2 % de la más activa) se dejan vacías para no distorsionar
    byHour: hours.map((h, i) => (h.n >= minHour ? { hour: i, punctuality: pct(h.on, h.n), avgDelay: r1(h.sum / h.n) } : { hour: i, punctuality: null, avgDelay: null })),
    heatmap: heat.map((row) => row.map((c) => (c.n && c.n >= minCell ? r1(c.sum / c.n) : null))),
    distribution: Object.entries(distribution).map(([k, v]) => ({ k, trips: v ?? 0 })),
    worstTrips: db.prepare(`SELECT day, operator, service, route, number, origin, destination, max_delay, last_delay FROM trips WHERE ${w.sql} ORDER BY max_delay DESC LIMIT 20`).all(w.p),
    alertsByType,
    dataQuality,
    options: {
      operators: db.prepare('SELECT DISTINCT operator k FROM trips ORDER BY 1').all().map((r) => r.k),
      services: db.prepare('SELECT DISTINCT service k FROM trips ORDER BY 1').all().map((r) => r.k),
    },
  };
}

/** Exportación CSV de una tabla del informe. */
export function toCsv(rows) {
  if (!rows?.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => (v == null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
}

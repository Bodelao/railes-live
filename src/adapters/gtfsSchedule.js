import AdmZip from 'adm-zip';
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { fetchWithTimeout } from './http.js';
import { measure, pointAt, projectDistance, haversineKm } from '../core/geo.js';

const TZ = 'Europe/Madrid';
const toSec = (hms) => { const [h, m, s] = hms.split(':').map(Number); return h * 3600 + m * 60 + (s || 0); };

/** Fecha (YYYYMMDD), día de la semana y segundos desde medianoche en hora de Madrid. */
export function madridClock(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}${p.month}${p.day}`, weekday: p.weekday.toLowerCase(), sec: +p.hour * 3600 + +p.minute * 60 + +p.second };
}

/** Carga un GTFS (zip como Buffer, o objeto {nombre: csv}) en estructuras compactas. */
export function loadGtfs(input) {
  const files = {};
  if (Buffer.isBuffer(input)) {
    for (const e of new AdmZip(input).getEntries()) files[e.entryName.split('/').pop()] = e.getData();
  } else Object.assign(files, input);
  const read = (n) => (files[n] ? parse(files[n], { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) : []);

  const stops = new Map(read('stops.txt').map((s) => [s.stop_id, { name: s.stop_name, lat: +s.stop_lat, lon: +s.stop_lon }]));
  const routes = new Map(read('routes.txt').map((r) => [r.route_id, r]));
  const calendar = new Map(read('calendar.txt').map((c) => [c.service_id, c]));
  const exceptions = new Map();
  for (const d of read('calendar_dates.txt')) exceptions.set(`${d.service_id}|${d.date}`, d.exception_type === '1');
  const shapes = new Map();
  for (const s of read('shapes.txt')) {
    if (!shapes.has(s.shape_id)) shapes.set(s.shape_id, []);
    shapes.get(s.shape_id).push([+s.shape_pt_sequence, +s.shape_pt_lat, +s.shape_pt_lon]);
  }
  for (const [k, pts] of shapes) shapes.set(k, measure(pts.sort((a, b) => a[0] - b[0]).map((p) => [p[1], p[2]])));

  const trips = new Map(read('trips.txt').map((t) => [t.trip_id, { ...t, st: [] }]));
  for (const st of read('stop_times.txt')) {
    const t = trips.get(st.trip_id);
    if (!t) continue;
    const arr = st.arrival_time || st.departure_time, dep = st.departure_time || st.arrival_time;
    if (!arr) continue;
    t.st.push({ seq: +st.stop_sequence, stop: st.stop_id, arr: toSec(arr), dep: toSec(dep) });
  }
  for (const t of trips.values()) {
    t.st.sort((a, b) => a.seq - b.seq);
    t.start = t.st[0]?.dep; t.end = t.st.at(-1)?.arr;
  }
  return { stops, routes, calendar, exceptions, shapes, trips: [...trips.values()].filter((t) => t.st.length > 1) };
}

function runsOn(g, serviceId, ymd, weekday) {
  const ex = g.exceptions.get(`${serviceId}|${ymd}`);
  if (ex != null) return ex;
  const c = g.calendar.get(serviceId);
  return !!c && c[weekday] === '1' && c.start_date <= ymd && ymd <= c.end_date;
}

const prevDay = (date) => madridClock(new Date(date.getTime() - 86_400_000));

/** Calcula la posición estimada de todos los viajes activos en `date`. */
export function estimatePositions(g, feed, date = new Date(), delays = new Map()) {
  const today = madridClock(date);
  const yday = prevDay(date);
  const out = [];
  for (const t of g.trips) {
    // Viajes del día de servicio actual, y del anterior que pasan de las 24:00
    for (const day of [today, { ...yday, sec: today.sec + 86400 }]) {
      const delay = delays.get(t.trip_id) ?? 0;
      const now = day.sec - delay * 60;
      if (now < t.start || now > t.end || !runsOn(g, t.service_id, day.ymd, day.weekday)) continue;
      out.push(positionOf(g, feed, t, now, delays.has(t.trip_id) ? delay : undefined, date));
    }
  }
  return out.filter(Boolean);
}

function positionOf(g, feed, t, now, delayMin, date) {
  const st = t.st;
  let i = st.findIndex((s) => s.arr > now);
  if (i <= 0) i = st.length - 1;
  const a = st[i - 1], b = st[i];
  const sa = g.stops.get(a.stop), sb = g.stops.get(b.stop);
  if (!sa || !sb) return null;
  const route = g.routes.get(t.route_id) ?? {};
  let lat, lon, bearing, status = 'running';
  if (now <= a.dep) { ({ lat, lon } = sa); status = 'at_station'; }
  else {
    const f = (now - a.dep) / Math.max(1, b.arr - a.dep);
    const shape = t.shape_id && g.shapes.get(t.shape_id);
    if (shape) {
      // Proyectamos las paradas sobre el shape e interpolamos a lo largo de él
      t._proj ??= new Map();
      const pa = t._proj.get(a.stop) ?? projectDistance(shape, [sa.lat, sa.lon]).along;
      const pb = t._proj.get(b.stop) ?? projectDistance(shape, [sb.lat, sb.lon]).along;
      t._proj.set(a.stop, pa); t._proj.set(b.stop, pb);
      ({ lat, lon, bearing } = pointAt(shape, pa + (pb - pa) * f));
      if (pb < pa) bearing = (bearing + 180) % 360;
    } else {
      ({ lat, lon, bearing } = pointAt(measure([[sa.lat, sa.lon], [sb.lat, sb.lon]]), haversineKm([sa.lat, sa.lon], [sb.lat, sb.lon]) * f));
    }
  }
  const segKm = haversineKm([sa.lat, sa.lon], [sb.lat, sb.lon]);
  const first = g.stops.get(st[0].stop), last = g.stops.get(st.at(-1).stop);
  return {
    id: `${feed.id}:${t.trip_id}`,
    operator: feed.operator, service: feed.service ?? route.route_short_name ?? feed.operator,
    line: route.route_short_name || undefined,
    number: t.trip_short_name || undefined,
    origin: first?.name, destination: t.trip_headsign || last?.name,
    prevStop: sa.name, nextStop: sb.name,
    nextStopEta: new Date(date.getTime() + (b.arr - now) * 1000 + (delayMin ?? 0) * 60_000).toISOString(),
    lat, lon, bearing,
    speedKmh: status === 'running' ? Math.round(segKm / ((b.arr - a.dep) / 3600)) : 0,
    delayMin, status,
    positionType: 'schedule',
    updatedAt: date.toISOString(),
  };
}

/** Adaptador: uno o varios GTFS estáticos (URL o ruta local) → posiciones estimadas. */
export function createSchedule({ feeds, intervalMs }) {
  const loaded = new Map();
  return {
    id: 'schedule', intervalMs,
    async fetch() {
      const out = [];
      const errors = [];
      for (const feed of feeds) {
        try {
          let g = loaded.get(feed.id);
          if (!g || Date.now() - g.at > 24 * 3.6e6) {
            const buf = feed.path ? readFileSync(feed.path) : await fetchWithTimeout(feed.url, { as: 'buffer', timeoutMs: 120_000 });
            g = { data: loadGtfs(buf), at: Date.now() };
            loaded.set(feed.id, g);
          }
          out.push(...estimatePositions(g.data, feed));
        } catch (e) { errors.push(`${feed.id}: ${e.message}`); }
      }
      if (errors.length && !out.length) throw new Error(errors.join('; '));
      return out;
    },
  };
}

import { STATIONS, CORRIDORS } from './network.js';
import { routeOf, dayOf } from '../core/history.js';
import { haversineKm } from '../core/geo.js';

// Generador determinista (para que la demo sea reproducible)
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const OP_BASE = { Renfe: 3.2, Iryo: 4.0, Ouigo: 5.0, FGC: 1.6, Euskotren: 2.0, FGV: 2.2, SFM: 2.5 };

/**
 * Rellena el histórico con N días de datos de DEMOSTRACIÓN (marcados como 'simulated').
 * Sirve para que el cuadro de mandos tenga contenido antes de acumular datos reales.
 */
export function seedDemoHistory(history, days = 45, now = Date.now()) {
  const rand = rng(42);
  const db = history.db;
  const insTrip = db.prepare('INSERT OR IGNORE INTO trips VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const upHour = history.upHour;
  db.exec('BEGIN');
  let serial = 0;
  const routes = CORRIDORS.map(([operator, service, line, stops, speed, count, numberBase]) => {
    let km = 0;
    for (let i = 1; i < stops.length; i++) km += haversineKm(STATIONS[stops[i - 1]].slice(1), STATIONS[stops[i]].slice(1));
    const origin = STATIONS[stops[0]][0], destination = STATIONS[stops.at(-1)][0];
    const factor = 0.6 + rand() * 1.1; // algunas líneas son estructuralmente peores
    return { operator, service, line, origin, destination, durH: km / speed + stops.length * 0.02, count, numberBase, factor, route: routeOf({ line, origin, destination, service }) };
  });
  for (let d = days; d >= 1; d--) {
    const dayStart = now - d * 86_400_000;
    const day = dayOf(dayStart);
    const weekday = new Date(dayStart).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const midnight = Date.parse(`${day}T00:00:00+01:00`);
    for (const r of routes) {
      const incidentDay = rand() < 0.04 ? 3 + rand() * 4 : 1; // día con incidencia en la línea
      const perDay = Math.round(r.count * (r.numberBase ? 3 : 10) * (weekend ? 0.75 : 1));
      for (let k = 0; k < perDay; k++) {
        const depH = 6 + rand() * 15.5; // salidas entre 6:00 y 21:30
        const peak = (depH >= 7 && depH < 9.5) || (depH >= 17 && depH < 20) ? 1.7 : 1;
        const mean = (OP_BASE[r.operator] ?? 3) * r.factor * peak * incidentDay * (weekend ? 0.8 : 1);
        let delay = Math.round(-Math.log(1 - rand()) * mean * (r.numberBase ? 1 : 0.6));
        if (rand() < 0.025 * incidentDay) delay += 15 + Math.round(rand() * 50);
        const maxDelay = delay + (rand() < 0.3 ? Math.round(rand() * 6) : 0);
        const start = midnight + depH * 3.6e6;
        const end = start + r.durH * 3.6e6 + delay * 60_000;
        const number = r.numberBase ? String(r.numberBase + (serial++ % 400) * 2).padStart(5, '0') : `${r.line}`;
        const samples = Math.max(1, Math.round((end - start) / 60_000));
        insTrip.run(`demo:${serial++}|${day}`, day, r.operator, r.service, r.route, number, r.origin, r.destination, 'simulated',
          start, end, samples, (delay / 2) * samples, maxDelay, delay);
        // Reparte las muestras por horas (el retraso crece linealmente durante el viaje)
        for (let t = start; t < end; t += 3.6e6) {
          const mins = Math.min(60, (end - t) / 60_000);
          const dl = Math.round((delay * (t - start)) / (end - start || 1));
          upHour.run({ hour: Math.floor(t / 3.6e6) * 3.6e6, operator: r.operator, service: r.service, route: r.route, ptype: 'simulated',
            n: Math.round(mins), onTime: dl < 5 ? Math.round(mins) : 0, sum: dl * mins, max: dl });
        }
        if (maxDelay >= 15) {
          history.insAlert.run(end - 60_000, maxDelay >= 30 ? 'critical' : 'high', 'delay', r.operator, r.service, r.route,
            `${r.operator} ${r.service} ${number} acumula ${maxDelay} min de retraso`);
        }
      }
    }
  }
  db.exec('COMMIT');
}

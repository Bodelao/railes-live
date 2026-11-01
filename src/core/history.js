import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const HOUR = 3_600_000;

/** Clave de "línea" para agregar: línea comercial si existe; si no, corredor o par origen–destino (sin sentido). */
export function routeOf(t) {
  if (t.line) return `${t.line}`;
  if (t.corridor) return t.corridor;
  if (t.origin && t.destination) return [t.origin, t.destination].sort().join(' – ');
  return t.service ?? 'Sin línea';
}

export const dayOf = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(ts);

/** Almacén histórico en SQLite: viajes, agregados horarios y registro de alertas. */
export class History {
  constructor(file = 'data/history.db') {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS trips (
        key TEXT PRIMARY KEY, day TEXT, operator TEXT, service TEXT, route TEXT, number TEXT,
        origin TEXT, destination TEXT, ptype TEXT, first_ts INTEGER, last_ts INTEGER,
        samples INTEGER, sum_delay REAL, max_delay INTEGER, last_delay INTEGER);
      CREATE INDEX IF NOT EXISTS trips_day ON trips(day);
      CREATE TABLE IF NOT EXISTS hourly (
        hour_ts INTEGER, operator TEXT, service TEXT, route TEXT, ptype TEXT,
        n INTEGER, on_time INTEGER, sum_delay REAL, max_delay INTEGER,
        PRIMARY KEY (hour_ts, operator, service, route, ptype));
      CREATE TABLE IF NOT EXISTS alert_log (
        ts INTEGER, severity TEXT, type TEXT, operator TEXT, service TEXT, route TEXT, text TEXT);
      CREATE INDEX IF NOT EXISTS alert_ts ON alert_log(ts);`);
    this.upTrip = this.db.prepare(`
      INSERT INTO trips VALUES (:key, :day, :operator, :service, :route, :number, :origin, :destination, :ptype, :ts, :ts, 1, :delay, :delay, :delay)
      ON CONFLICT(key) DO UPDATE SET last_ts = :ts, samples = samples + 1, sum_delay = sum_delay + :delay,
        max_delay = MAX(max_delay, :delay), last_delay = :delay`);
    this.upHour = this.db.prepare(`
      INSERT INTO hourly VALUES (:hour, :operator, :service, :route, :ptype, :n, :onTime, :sum, :max)
      ON CONFLICT DO UPDATE SET n = n + :n, on_time = on_time + :onTime, sum_delay = sum_delay + :sum, max_delay = MAX(max_delay, :max)`);
    this.insAlert = this.db.prepare('INSERT INTO alert_log VALUES (?, ?, ?, ?, ?, ?, ?)');
  }

  /** Muestra el estado actual de los trenes (llamar ~1 vez por minuto). */
  sample(trains, ts = Date.now()) {
    const hour = Math.floor(ts / HOUR) * HOUR;
    const day = dayOf(ts);
    this.db.exec('BEGIN');
    try {
      for (const t of trains) {
        if (t.delayMin == null) continue;
        const delay = Math.max(0, Math.round(t.delayMin));
        const base = { operator: t.operator, service: t.service ?? '', route: routeOf(t), ptype: t.positionType };
        this.upTrip.run({ ...base, key: `${t.id}|${day}`, day, number: t.number ?? t.line ?? '', origin: t.origin ?? '', destination: t.destination ?? '', ts, delay });
        this.upHour.run({ ...base, hour, n: 1, onTime: delay < 5 ? 1 : 0, sum: delay, max: delay });
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  logAlert(a, t, ts = Date.now()) {
    this.insAlert.run(ts, a.severity, a.type, t?.operator ?? null, t?.service ?? null, t ? routeOf(t) : null, a.text);
  }

  isEmpty() { return this.db.prepare('SELECT COUNT(*) c FROM trips').get().c === 0; }
}

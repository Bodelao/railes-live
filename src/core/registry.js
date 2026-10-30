import { EventEmitter } from 'node:events';
import { haversineKm, bearing } from './geo.js';

const QUALITY = { gps: 4, operator: 3, schedule: 2, simulated: 1 };

/** Almacén en memoria de trenes normalizados, con estela, deduplicación y expiración. */
export class Registry extends EventEmitter {
  constructor({ staleAfterMs, trailLength }) {
    super();
    this.trains = new Map();
    this.staleAfterMs = staleAfterMs;
    this.trailLength = trailLength;
  }

  /** Sustituye el conjunto de trenes aportado por una fuente. */
  ingest(source, trains) {
    const now = Date.now();
    const seen = new Set();
    for (const t of trains) {
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
      t.source = source;
      t.updatedAt ||= new Date(now).toISOString();
      seen.add(t.id);
      const prev = this.trains.get(t.id);
      if (prev) {
        const dtH = (Date.parse(t.updatedAt) - Date.parse(prev.updatedAt)) / 3.6e6;
        const km = haversineKm([prev.lat, prev.lon], [t.lat, t.lon]);
        if (t.bearing == null && km > 0.02) t.bearing = bearing([prev.lat, prev.lon], [t.lat, t.lon]);
        t.bearing ??= prev.bearing;
        if (t.speedKmh == null && dtH > 0) t.speedKmh = Math.round(km / dtH);
        t.trail = [...prev.trail, [t.lat, t.lon]].slice(-this.trailLength);
        t.firstSeen = prev.firstSeen;
        t.stoppedSince = (t.speedKmh ?? 0) < 3 ? (prev.stoppedSince ?? now) : null;
      } else {
        t.trail = [[t.lat, t.lon]];
        t.firstSeen = now;
        t.stoppedSince = null;
        this.emit('new', t);
      }
      this.trains.set(t.id, t);
      this.emit('update', t, prev);
    }
    // Trenes de esta fuente que han desaparecido del feed
    for (const [id, t] of this.trains) if (t.source === source && !seen.has(id)) this.remove(id);
  }

  remove(id) {
    const t = this.trains.get(id);
    if (!t) return;
    this.trains.delete(id);
    this.emit('gone', t);
  }

  expire() {
    const limit = Date.now() - this.staleAfterMs;
    for (const [id, t] of this.trains) if (Date.parse(t.updatedAt) < limit) this.remove(id);
  }

  /** Lista deduplicada: si el mismo tren (operador+número) llega de varias fuentes, gana la de mayor calidad. */
  list(filter = {}) {
    const best = new Map();
    for (const t of this.trains.values()) {
      const key = t.number ? `${t.operator}:${t.number}` : t.id;
      const cur = best.get(key);
      if (!cur || QUALITY[t.positionType] > QUALITY[cur.positionType] ||
          (QUALITY[t.positionType] === QUALITY[cur.positionType] && t.updatedAt > cur.updatedAt)) best.set(key, t);
    }
    let out = [...best.values()];
    const { operator, service, minDelay, bbox, q } = filter;
    if (operator) out = out.filter((t) => operator.split(',').includes(t.operator));
    if (service) out = out.filter((t) => service.split(',').includes(t.service));
    if (minDelay != null) out = out.filter((t) => (t.delayMin ?? -1) >= Number(minDelay));
    if (bbox) {
      const [w, s, e, n] = bbox.split(',').map(Number);
      out = out.filter((t) => t.lon >= w && t.lon <= e && t.lat >= s && t.lat <= n);
    }
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter((t) => [t.number, t.line, t.origin, t.destination, t.nextStop].some((v) => v && String(v).toLowerCase().includes(needle)));
    }
    return out;
  }

  get(id) { return this.trains.get(id); }

  stats() {
    const trains = this.list();
    const known = trains.filter((t) => t.delayMin != null);
    const onTime = known.filter((t) => t.delayMin < 5).length;
    const by = (k) => trains.reduce((acc, t) => ((acc[t[k]] = (acc[t[k]] || 0) + 1), acc), {});
    return {
      active: trains.length,
      punctuality: known.length ? Math.round((onTime / known.length) * 1000) / 10 : null,
      avgDelay: known.length ? Math.round((known.reduce((s, t) => s + Math.max(0, t.delayMin), 0) / known.length) * 10) / 10 : null,
      byOperator: by('operator'),
      byService: by('service'),
      byPositionType: by('positionType'),
    };
  }
}

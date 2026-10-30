import { fetchWithTimeout, num } from './http.js';
import { stationName } from '../data/stationNames.js';

const STATUS = { STOPPED_AT: 'at_station', INCOMING_AT: 'running', IN_TRANSIT_TO: 'running' };

/**
 * Renfe Cercanías/Rodalies — GTFS-RT en JSON (vehicle_positions + trip_updates).
 * La etiqueta del vehículo suele tener la forma "C1-23537-PLATF.(5)": línea-tren-andén.
 */
export function parseRenfeCercanias(vp, tu) {
  const delays = new Map();
  for (const e of tu?.entity ?? []) {
    const u = e.tripUpdate ?? e.trip_update;
    if (!u) continue;
    const sec = u.delay ?? u.stopTimeUpdate?.[0]?.arrival?.delay ?? u.stopTimeUpdate?.[0]?.departure?.delay;
    if (sec != null) delays.set(u.trip?.tripId ?? u.trip?.trip_id, Math.round(sec / 60));
  }
  const out = [];
  for (const e of vp?.entity ?? []) {
    const v = e.vehicle;
    if (!v?.position) continue;
    const tripId = v.trip?.tripId ?? v.trip?.trip_id;
    const label = v.vehicle?.label ?? '';
    const [line, number] = label.split('-');
    const nucleo = tripId?.slice(0, 2);
    out.push({
      id: `renfe-cer:${v.vehicle?.id ?? e.id}`,
      operator: 'Renfe',
      service: line?.startsWith('R') ? 'Rodalies' : 'Cercanías',
      line: line || undefined,
      number: number || undefined,
      nucleo,
      nextStop: stationName(v.stopId ?? v.stop_id),
      lat: num(v.position.latitude), lon: num(v.position.longitude),
      bearing: num(v.position.bearing),
      speedKmh: v.position.speed != null ? Math.round(v.position.speed * 3.6) : undefined,
      delayMin: delays.get(tripId),
      status: STATUS[v.currentStatus ?? v.current_status] ?? 'unknown',
      positionType: 'gps',
      updatedAt: v.timestamp ? new Date(Number(v.timestamp) * 1000).toISOString() : undefined,
    });
  }
  return out;
}

export function createRenfeCercanias({ url, tripUpdatesUrl, intervalMs }) {
  return {
    id: 'renfe-cercanias', intervalMs,
    async fetch() {
      const [vp, tu] = await Promise.all([fetchWithTimeout(url), fetchWithTimeout(tripUpdatesUrl).catch(() => null)]);
      return parseRenfeCercanias(vp, tu);
    },
  };
}

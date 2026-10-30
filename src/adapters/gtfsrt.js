import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { fetchWithTimeout } from './http.js';
import { stationName } from '../data/stationNames.js';

const { transit_realtime: rt } = GtfsRealtimeBindings;
const STATUS = { 0: 'running', 1: 'at_station', 2: 'running' };

/** Adaptador genérico GTFS-RT (protobuf) para posiciones de vehículos. */
export function parseGtfsRt(buffer, { id, operator, service = operator }) {
  const feed = rt.FeedMessage.decode(buffer);
  const out = [];
  for (const e of feed.entity) {
    const v = e.vehicle;
    if (!v?.position) continue;
    out.push({
      id: `${id}:${v.vehicle?.id || e.id}`,
      operator, service,
      line: v.trip?.routeId || undefined,
      number: v.vehicle?.label || undefined,
      nextStop: stationName(v.stopId),
      lat: v.position.latitude, lon: v.position.longitude,
      bearing: v.position.bearing ?? undefined,
      speedKmh: v.position.speed ? Math.round(v.position.speed * 3.6) : undefined,
      status: STATUS[v.currentStatus] ?? 'unknown',
      positionType: 'gps',
      updatedAt: v.timestamp ? new Date(Number(v.timestamp) * 1000).toISOString() : undefined,
    });
  }
  return out;
}

export function createGtfsRt(id, cfg) {
  return { id, intervalMs: cfg.intervalMs, fetch: async () => parseGtfsRt(await fetchWithTimeout(cfg.url, { as: 'buffer' }), { id, ...cfg }) };
}

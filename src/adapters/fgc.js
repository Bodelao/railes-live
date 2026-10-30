import { fetchWithTimeout, num } from './http.js';

/** FGC — dataset Opendatasoft "posicionament dels trens". */
export function parseFGC(json) {
  const rows = json?.results ?? json?.records?.map((r) => r.fields ?? r.record?.fields) ?? [];
  return rows.map((r) => {
    const gp = r.geo_point_2d ?? {};
    const lat = num(gp.lat ?? (Array.isArray(gp) ? gp[0] : undefined));
    const lon = num(gp.lon ?? (Array.isArray(gp) ? gp[1] : undefined));
    const enHora = String(r.en_hora ?? '').toLowerCase();
    let next = r.properes_parades;
    if (typeof next === 'string') next = next.split(';')[0]?.replace(/[{}"]/g, '').replace(/^\s*parada\s*:/, '').trim();
    return {
      id: `fgc:${r.id ?? r.ut}`,
      operator: 'FGC', service: 'FGC', line: r.lin,
      number: r.ut ? String(r.ut) : undefined,
      origin: r.origen, destination: r.desti,
      nextStop: next || undefined,
      lat, lon,
      // El feed solo dice si va en hora; un tren "fuera de hora" se marca con 5 min (valor mínimo de retraso)
      delayMin: enHora === 'true' ? 0 : enHora === 'false' ? 5 : undefined,
      status: r.estacionat_a ? 'at_station' : 'running',
      positionType: 'gps',
    };
  });
}

export function createFGC({ url, intervalMs }) {
  return { id: 'fgc', intervalMs, fetch: async () => parseFGC(await fetchWithTimeout(url)) };
}

import { STATIONS, CORRIDORS } from '../data/network.js';
import { measure, pointAt, haversineKm } from '../core/geo.js';

const DWELL_S = 45;

/** Genera trenes verosímiles moviéndose sobre corredores reales. */
export function createSimulator({ intervalMs }) {
  const routes = CORRIDORS.map(([operator, service, line, stops, speed, count, numberBase], ri) => {
    const pts = stops.map((s) => [STATIONS[s][1], STATIONS[s][2]]);
    const m = measure(pts);
    const stopAt = [0];
    for (let i = 1; i < pts.length; i++) stopAt.push(stopAt[i - 1] + haversineKm(pts[i - 1], pts[i]));
    return { ri, operator, service, line, stops, speed, count, numberBase, m, stopAt };
  });

  const trains = [];
  let serial = 0;
  for (const r of routes) {
    for (let k = 0; k < r.count; k++) trains.push(spawn(r, Math.random() * r.m.length, k % 2 === 0 ? 1 : -1));
  }

  function spawn(r, along, dir) {
    serial++;
    const number = r.numberBase ? String(r.numberBase + serial * 2 + (dir < 0 ? 1 : 0)).padStart(5, '0') : `${r.line}-${serial}`;
    return {
      r, along, dir, number, dwell: 0,
      delay: Math.random() < 0.7 ? Math.floor(Math.random() * 4) : Math.floor(Math.random() * 25),
      speedFactor: 0.85 + Math.random() * 0.25,
    };
  }

  let last = Date.now();
  return {
    id: 'simulator',
    intervalMs,
    async fetch() {
      const now = Date.now();
      const dt = (now - last) / 1000; // s
      last = now;
      const out = [];
      for (let i = 0; i < trains.length; i++) {
        let s = trains[i];
        const { r } = s;
        // Incidencias aleatorias: a veces se acumula retraso o se recupera
        if (Math.random() < 0.004) s.delay += 1 + Math.floor(Math.random() * 12);
        if (Math.random() < 0.01 && s.delay > 0) s.delay -= 1;
        // Una incidencia rara: tren parado en plena vía
        if (!s.halted && Math.random() < 0.0004) s.halted = 60 + Math.random() * 400;
        if (s.halted > 0) { s.halted -= dt; if (s.halted <= 0) { s.halted = 0; s.delay += 5; } }
        let atStation = false;
        if (s.dwell > 0) { s.dwell -= dt; atStation = true; }
        else if (!s.halted) {
          const before = s.along;
          s.along += s.dir * (r.speed * s.speedFactor / 3600) * dt;
          // ¿hemos cruzado una estación intermedia?
          for (const d of r.stopAt.slice(1, -1)) {
            if ((before - d) * (s.along - d) < 0) { s.along = d; s.dwell = DWELL_S; atStation = true; break; }
          }
          if (s.along >= r.m.length || s.along <= 0) {
            // Final de trayecto: aparece un tren nuevo en sentido contrario
            s = trains[i] = spawn(r, s.along >= r.m.length ? r.m.length : 0, -s.dir);
            s.dwell = 120; atStation = true;
          }
        }
        const p = pointAt(r.m, s.along);
        const order = s.dir > 0 ? r.stops : [...r.stops].reverse();
        const dirAlong = s.dir > 0 ? s.along : r.m.length - s.along;
        const stopDist = s.dir > 0 ? r.stopAt : r.stopAt.map((d) => r.m.length - d).reverse();
        let ni = stopDist.findIndex((d) => d > dirAlong + 0.05);
        if (ni < 0) ni = order.length - 1;
        const remainingKm = stopDist[ni] - dirAlong;
        const eta = new Date(now + (remainingKm / (r.speed * s.speedFactor)) * 3.6e6 + s.delay * 60_000);
        out.push({
          id: `sim:${r.ri}:${s.number}`,
          operator: r.operator, service: r.service, line: r.line ?? undefined,
          number: r.numberBase ? s.number : undefined,
          origin: STATIONS[order[0]][0], destination: STATIONS[order.at(-1)][0],
          prevStop: STATIONS[order[Math.max(0, ni - 1)]][0], nextStop: STATIONS[order[ni]][0],
          nextStopEta: eta.toISOString(),
          lat: p.lat, lon: p.lon, bearing: s.dir > 0 ? p.bearing : (p.bearing + 180) % 360,
          speedKmh: atStation || s.halted ? 0 : Math.round(r.speed * s.speedFactor),
          delayMin: s.delay,
          status: atStation ? 'at_station' : s.halted ? 'stopped' : 'running',
          positionType: 'simulated',
          updatedAt: new Date(now).toISOString(),
          accessible: true,
        });
      }
      return out;
    },
  };
}

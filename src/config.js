import { readFileSync, existsSync } from 'node:fs';

const env = process.env;
const fileCfg = existsSync('config.json') ? JSON.parse(readFileSync('config.json', 'utf8')) : {};

// mode: 'simulation' (solo simulador), 'live' (solo fuentes reales), 'hybrid' (ambas)
export const config = {
  port: Number(env.PORT || fileCfg.port || 3000),
  mode: env.MODE || fileCfg.mode || 'hybrid',
  staleAfterMs: 5 * 60_000,
  trailLength: 30,
  alerts: { delayThresholds: [5, 15, 30], stoppedMinutes: 5 },
  sources: {
    simulator: { enabled: true, intervalMs: 3_000 },
    'renfe-cercanias': {
      enabled: true, intervalMs: 20_000,
      url: 'https://gtfsrt.renfe.com/vehicle_positions.json',
      tripUpdatesUrl: 'https://gtfsrt.renfe.com/trip_updates.json',
    },
    'renfe-ld': {
      enabled: true, intervalMs: 20_000,
      url: 'https://tiempo-real.largorecorrido.renfe.com/renfe-visor/flotaLD.json',
    },
    fgc: {
      enabled: true, intervalMs: 20_000,
      url: 'https://dadesobertes.fgc.cat/api/explore/v2.1/catalog/datasets/posicionament-dels-trens/records?limit=100',
    },
    // GTFS-RT protobuf genérico (p. ej. Euskotren). Configura la URL vigente del NAP / Open Data Euskadi.
    euskotren: { enabled: !!env.EUSKOTREN_RT_URL, intervalMs: 30_000, url: env.EUSKOTREN_RT_URL, operator: 'Euskotren' },
    // Estimación por horario a partir de GTFS estático (Iryo, Ouigo, FGV, SFM…). URLs del NAP en config.json.
    schedule: { enabled: true, intervalMs: 15_000, feeds: [] },
    ...(fileCfg.sources || {}),
  },
};

if (config.mode === 'simulation') {
  for (const [k, s] of Object.entries(config.sources)) if (k !== 'simulator') s.enabled = false;
} else if (config.mode === 'live') {
  config.sources.simulator.enabled = false;
}

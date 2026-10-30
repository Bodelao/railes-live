import { createSimulator } from './adapters/simulator.js';
import { createRenfeCercanias } from './adapters/renfeCercanias.js';
import { createRenfeLD } from './adapters/renfeLD.js';
import { createFGC } from './adapters/fgc.js';
import { createGtfsRt } from './adapters/gtfsrt.js';
import { createSchedule } from './adapters/gtfsSchedule.js';

const FACTORIES = {
  simulator: createSimulator,
  'renfe-cercanias': createRenfeCercanias,
  'renfe-ld': createRenfeLD,
  fgc: createFGC,
  euskotren: (cfg) => createGtfsRt('euskotren', cfg),
  schedule: (cfg) => (cfg.feeds?.length ? createSchedule(cfg) : null),
};

/** Lanza cada adaptador con su intervalo, backoff exponencial ante errores y estado observable. */
export function startSources(config, registry, alerts, log) {
  const status = {};
  for (const [id, cfg] of Object.entries(config.sources)) {
    if (!cfg.enabled) continue;
    const factory = FACTORIES[id] ?? (cfg.type === 'gtfs-rt' ? (c) => createGtfsRt(id, c) : null);
    const adapter = factory?.(cfg);
    if (!adapter) continue;
    const st = (status[id] = { id, state: 'starting', lastOk: null, lastError: null, trains: 0, failures: 0, latencyMs: null });
    const run = async () => {
      const t0 = Date.now();
      try {
        const trains = await adapter.fetch();
        registry.ingest(id, trains);
        if (st.state === 'down') alerts.push({ severity: 'info', type: 'source', text: `Fuente ${id} recuperada` });
        Object.assign(st, { state: 'ok', lastOk: new Date().toISOString(), trains: trains.length, failures: 0, latencyMs: Date.now() - t0 });
      } catch (e) {
        st.failures++;
        st.lastError = e.cause?.message ?? e.message;
        const wasDown = st.state === 'down';
        st.state = st.failures >= 3 ? 'down' : 'degraded';
        if (st.state === 'down' && !wasDown) alerts.push({ severity: 'medium', type: 'source', text: `Fuente ${id} caída: ${st.lastError}` });
        log.warn({ source: id, err: st.lastError }, 'fallo de fuente');
      }
      const backoff = st.failures ? Math.min(adapter.intervalMs * 2 ** st.failures, 10 * 60_000) : adapter.intervalMs;
      setTimeout(run, backoff).unref();
    };
    run();
  }
  return status;
}

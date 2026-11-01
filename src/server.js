import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { Registry } from './core/registry.js';
import { Alerts } from './core/alerts.js';
import { startSources } from './sources.js';
import { STATIONS } from './data/network.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });
const registry = new Registry(config);
const alerts = new Alerts(registry, config.alerts);
const sources = startSources(config, registry, alerts, app.log);
setInterval(() => registry.expire(), 30_000).unref();

// Histórico (SQLite integrado en Node ≥ 22.13). Si no está disponible, el mapa funciona igual y solo se desactivan los informes.
let history = null, buildReport, toCsv;
try {
  const { History } = await import('./core/history.js');
  ({ buildReport, toCsv } = await import('./core/reports.js'));
  const { seedDemoHistory } = await import('./data/seedHistory.js');
  history = new History(config.historyFile);
  if (config.sources.simulator.enabled && history.isEmpty()) {
    app.log.info('Histórico vacío: generando 45 días de datos de demostración (marcados como simulados)');
    seedDemoHistory(history);
  }
  setInterval(() => history.sample(registry.list()), 60_000).unref();
  alerts.onAlert((a) => history.logAlert(a, a.trainId && registry.get(a.trainId)));
} catch (e) {
  app.log.warn(`Informes desactivados: tu Node.js (${process.version}) no incluye SQLite. Actualiza a Node 22.13 o superior. Detalle: ${e.message}`);
}
const NO_HISTORY = { error: `Los informes necesitan Node.js 22.13 o superior (el servidor usa ${process.version}). Actualiza Node y reinicia la aplicación.` };

app.register(fastifyStatic, { root: `${root}public` });
app.register(fastifyStatic, { root: `${root}node_modules/leaflet/dist`, prefix: '/vendor/leaflet/', decorateReply: false });
app.register(fastifyStatic, { root: `${root}node_modules/chart.js/dist`, prefix: '/vendor/chartjs/', decorateReply: false });

// Versión compacta para el mapa (sin estela)
const compact = ({ trail, firstSeen, stoppedSince, _stoppedAlerted, ...t }) => t;

app.get('/api/health', async () => ({ ok: true, mode: config.mode, node: process.version, reports: !!history, uptime: process.uptime() }));
app.get('/api/trains', async (req) => registry.list(req.query).map(compact));
app.get('/api/trains/:id', async (req, reply) => registry.get(req.params.id) ?? reply.code(404).send({ error: 'Tren no encontrado' }));
app.get('/api/sources', async () => Object.values(sources));
app.get('/api/stats', async () => registry.stats());
app.get('/api/alerts', async () => alerts.items);
app.post('/api/alerts/:id/ack', async (req, reply) => alerts.ack(req.params.id) ?? reply.code(404).send({ error: 'Alerta no encontrada' }));
app.get('/api/reports', async (req, reply) => (history ? buildReport(history, req.query) : reply.code(503).send(NO_HISTORY)));
const EXPORTS = { lineas: 'worstLines', operadores: 'byOperator', servicios: 'byService', diario: 'daily', horas: 'byHour', viajes: 'worstTrips' };
app.get('/api/reports/export/:table', async (req, reply) => {
  if (!history) return reply.code(503).send(NO_HISTORY);
  const key = EXPORTS[req.params.table];
  if (!key) return reply.code(404).send({ error: `Tabla desconocida. Opciones: ${Object.keys(EXPORTS).join(', ')}` });
  const rows = buildReport(history, req.query)[key];
  reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="railes-${req.params.table}.csv"`);
  return toCsv(rows);
});
app.get('/api/stations', async () => Object.entries(STATIONS).map(([code, [name, lat, lon]]) => ({ code, name, lat, lon })));

// Server-Sent Events: snapshot periódico + alertas al instante
const clients = new Set();
app.get('/api/stream', (req, reply) => {
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (event, data) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const client = { send };
  clients.add(client);
  send('snapshot', snapshot());
  send('alerts', alerts.items.slice(0, 100));
  req.raw.on('close', () => clients.delete(client));
});
const snapshot = () => ({ at: new Date().toISOString(), trains: registry.list().map(compact), stats: registry.stats(), sources: Object.values(sources) });
setInterval(() => { if (clients.size) { const s = snapshot(); for (const c of clients) c.send('snapshot', s); } }, 3_000).unref();
alerts.onAlert((a) => { for (const c of clients) c.send('alert', a); });

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (e) {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`\n✖ El puerto ${config.port} ya está en uso: probablemente RailES Live ya está abierto en otra ventana de Terminal.\n` +
    `  Ciérralo allí con Ctrl + C, o libera el puerto con:  lsof -ti tcp:${config.port} | xargs kill\n` +
    `  También puedes usar otro puerto:  PORT=3001 npm start\n`);
  process.exit(1);
}
app.log.info(`RailES Live en http://localhost:${config.port} (modo ${config.mode})`);

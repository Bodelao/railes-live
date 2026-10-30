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

app.register(fastifyStatic, { root: `${root}public` });
app.register(fastifyStatic, { root: `${root}node_modules/leaflet/dist`, prefix: '/vendor/leaflet/', decorateReply: false });

// Versión compacta para el mapa (sin estela)
const compact = ({ trail, firstSeen, stoppedSince, _stoppedAlerted, ...t }) => t;

app.get('/api/health', async () => ({ ok: true, mode: config.mode, uptime: process.uptime() }));
app.get('/api/trains', async (req) => registry.list(req.query).map(compact));
app.get('/api/trains/:id', async (req, reply) => registry.get(req.params.id) ?? reply.code(404).send({ error: 'Tren no encontrado' }));
app.get('/api/sources', async () => Object.values(sources));
app.get('/api/stats', async () => registry.stats());
app.get('/api/alerts', async () => alerts.items);
app.post('/api/alerts/:id/ack', async (req, reply) => alerts.ack(req.params.id) ?? reply.code(404).send({ error: 'Alerta no encontrada' }));
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

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`RailES Live en http://localhost:${config.port} (modo ${config.mode})`);

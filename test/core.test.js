import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from '../src/core/registry.js';
import { Alerts } from '../src/core/alerts.js';
import { loadGtfs, estimatePositions } from '../src/adapters/gtfsSchedule.js';
import { measure, pointAt } from '../src/core/geo.js';
import { createSimulator } from '../src/adapters/simulator.js';

test('pointAt interpola a lo largo de la polilínea', () => {
  const m = measure([[40, -3], [41, -3]]);
  const p = pointAt(m, m.length / 2);
  assert.ok(Math.abs(p.lat - 40.5) < 1e-6);
  assert.ok(Math.abs(p.bearing - 0) < 1e-6);
});

test('Registro: deduplica por operador+número priorizando calidad', () => {
  const r = new Registry({ staleAfterMs: 60_000, trailLength: 5 });
  r.ingest('schedule', [{ id: 's:1', operator: 'Iryo', number: '6123', lat: 40, lon: -3, positionType: 'schedule' }]);
  r.ingest('gps', [{ id: 'g:1', operator: 'Iryo', number: '6123', lat: 40.1, lon: -3, positionType: 'gps' }]);
  const list = r.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'g:1');
});

test('Registro: elimina trenes que desaparecen del feed y calcula rumbo/velocidad', () => {
  const r = new Registry({ staleAfterMs: 60_000, trailLength: 5 });
  r.ingest('a', [{ id: 'a:1', operator: 'X', lat: 40, lon: -3, updatedAt: '2026-01-01T10:00:00Z' }]);
  r.ingest('a', [{ id: 'a:1', operator: 'X', lat: 40.1, lon: -3, updatedAt: '2026-01-01T10:06:00Z' }]);
  const t = r.get('a:1');
  assert.equal(Math.round(t.bearing), 0);
  assert.ok(t.speedKmh > 100 && t.speedKmh < 120);
  r.ingest('a', []);
  assert.equal(r.list().length, 0);
});

test('Alertas: cruce de umbral de retraso', () => {
  const r = new Registry({ staleAfterMs: 60_000, trailLength: 5 });
  const a = new Alerts(r, { delayThresholds: [5, 15], stoppedMinutes: 5 });
  r.ingest('a', [{ id: 'a:1', operator: 'Renfe', service: 'AVE', number: '3063', lat: 40, lon: -3, delayMin: 2 }]);
  r.ingest('a', [{ id: 'a:1', operator: 'Renfe', service: 'AVE', number: '3063', lat: 40, lon: -3, delayMin: 16 }]);
  assert.equal(a.items.length, 2);
  assert.equal(a.items[0].severity, 'high');
});

test('GTFS estático: interpola posición de un viaje activo', () => {
  const g = loadGtfs({
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Madrid,40.0,-3.7\nB,Sevilla,37.4,-6.0\n',
    'routes.txt': 'route_id,route_short_name\nR,Iryo\n',
    'trips.txt': 'route_id,service_id,trip_id,trip_short_name\nR,S,T1,6123\n',
    'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,10:00:00,10:00:00,A,1\nT1,12:00:00,12:00:00,B,2\n',
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS,1,1,1,1,1,1,1,20200101,20991231\n',
  });
  // 11:00 en Madrid (horario de invierno = UTC+1) → a mitad del recorrido
  const out = estimatePositions(g, { id: 'iryo', operator: 'Iryo' }, new Date('2026-12-01T10:00:00Z'));
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].lat - 38.7) < 0.05);
  assert.equal(out[0].number, '6123');
  assert.equal(out[0].positionType, 'schedule');
  assert.equal(estimatePositions(g, { id: 'iryo', operator: 'Iryo' }, new Date('2026-12-01T14:00:00Z')).length, 0);
});

test('Simulador genera trenes válidos', async () => {
  const sim = createSimulator({ intervalMs: 1000 });
  const out = await sim.fetch();
  assert.ok(out.length > 100);
  for (const t of out) assert.ok(Number.isFinite(t.lat) && Number.isFinite(t.lon) && t.operator && t.destination);
});

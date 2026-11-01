import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, routeOf } from '../src/core/history.js';
import { buildReport, toCsv } from '../src/core/reports.js';
import { seedDemoHistory } from '../src/data/seedHistory.js';

test('routeOf agrupa ambos sentidos del mismo corredor', () => {
  assert.equal(routeOf({ origin: 'Sevilla', destination: 'Madrid' }), routeOf({ origin: 'Madrid', destination: 'Sevilla' }));
  assert.equal(routeOf({ line: 'C-4', origin: 'Parla' }), 'C-4');
});

test('Histórico: muestreo y KPIs de viajes', () => {
  const h = new History(':memory:');
  const t0 = Date.parse('2026-10-20T10:00:00Z');
  const trains = [
    { id: 'a', operator: 'Renfe', service: 'AVE', origin: 'Madrid', destination: 'Sevilla', number: '2001', positionType: 'gps', delayMin: 2 },
    { id: 'b', operator: 'Iryo', service: 'Iryo', origin: 'Madrid', destination: 'Sevilla', number: '6101', positionType: 'gps', delayMin: 20 },
  ];
  h.sample(trains, t0);
  h.sample(trains.map((t) => ({ ...t, delayMin: t.delayMin + 5 })), t0 + 60_000);
  const r = buildReport(h, { from: '2026-10-20', to: '2026-10-20' });
  assert.equal(r.kpis.trips, 2);
  assert.equal(r.kpis.punctuality, 0); // retrasos finales 7 y 25
  assert.equal(r.byOperator.find((o) => o.k === 'Iryo').max_delay, 25);
  assert.equal(r.byHour[12].avgDelay, 13.5); // 10:00Z = 12:00 en Madrid (horario de verano)
  assert.ok(toCsv(r.byOperator).includes('Iryo'));
});

test('Datos de demostración: el informe excluye simulados si se pide', () => {
  const h = new History(':memory:');
  seedDemoHistory(h, 5, Date.parse('2026-10-30T12:00:00Z'));
  const all = buildReport(h, { from: '2026-10-20', to: '2026-10-30' });
  assert.ok(all.kpis.trips > 1000);
  assert.ok(all.worstLines.length >= 10);
  assert.ok(all.heatmap.flat().some((v) => v != null));
  const real = buildReport(h, { from: '2026-10-20', to: '2026-10-30', includeSimulated: '0' });
  assert.equal(real.kpis.trips, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { parseRenfeCercanias } from '../src/adapters/renfeCercanias.js';
import { parseRenfeLD } from '../src/adapters/renfeLD.js';
import { parseFGC } from '../src/adapters/fgc.js';
import { parseGtfsRt } from '../src/adapters/gtfsrt.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));

test('Renfe Cercanías: posiciones + retraso de trip_updates', () => {
  const out = parseRenfeCercanias(fx('renfe_vp.json'), fx('renfe_tu.json'));
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].line, out[0].number, out[0].delayMin, out[0].status, out[0].service], ['C1', '23537', 7, 'at_station', 'Cercanías']);
  assert.equal(out[1].service, 'Rodalies');
  assert.equal(out[1].delayMin, undefined);
  assert.equal(out[0].positionType, 'gps');
});

test('Renfe LD: visor flotaLD tolerante a formatos', () => {
  const [a, b] = parseRenfeLD(fx('renfe_ld.json'));
  assert.equal(a.service, 'AVE');
  assert.equal(a.delayMin, 12);
  assert.equal(a.id, 'renfe-ld:03063');
  assert.ok(a.nextStopEta);
  assert.equal(b.service, 'Larga Distancia');
  assert.equal(b.lat, 40.1);
  assert.equal(b.delayMin, undefined);
});

test('FGC: opendatasoft', () => {
  const [a, b] = parseFGC(fx('fgc.json'));
  assert.equal(a.line, 'S1');
  assert.equal(a.nextStop, 'SC');
  assert.equal(a.delayMin, 0);
  assert.equal(b.status, 'at_station');
  assert.equal(b.delayMin, 5);
});

test('GTFS-RT protobuf genérico', () => {
  const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
  const buf = FeedMessage.encode(FeedMessage.fromObject({
    header: { gtfsRealtimeVersion: '2.0' },
    entity: [{ id: '1', vehicle: { vehicle: { id: 'U1', label: '901' }, trip: { routeId: 'E1' }, position: { latitude: 43.2, longitude: -2.6, speed: 10 }, currentStatus: 2 } }],
  })).finish();
  const [t] = parseGtfsRt(Buffer.from(buf), { id: 'euskotren', operator: 'Euskotren' });
  assert.equal(t.line, 'E1');
  assert.equal(t.speedKmh, 36);
  assert.equal(t.operator, 'Euskotren');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnalystIncidentSelection, analystIncidentSelectionLocation } from '../src/analystIncidentShared.ts';
import { eventTimestamp, caseTimeline } from '../src/caseTimeline.ts';
import { resolveEventTimestamp, formatTime } from '../src/displayTime.ts';
import { prototypeLocation } from '../src/prototypeLocation.ts';

const data = { incidentOrigin: '2020-01-01T00:00:00Z', entities: [], events: [], scenarios: [], dependencies: [] };
const rows = [
  { id: 'INC-ALPHA', title: 'Alpha', status: 'open', severity: 'critical', linkedEventIds: ['alpha-1', 'alpha-2'] },
  { id: 'INC-BETA', title: 'Beta', status: 'monitoring', severity: 'high', linkedEventIds: ['beta-1'] },
  { id: 'INC-CLOSED', status: 'closed', severity: 'critical' },
];
const records = { statewideIncidents: rows, featuredIncidentId: 'INC-BETA', sampleDataAnchor: '2031-06-17T12:00:00Z' };
const cases = [
  { id: 'older', eventId: 'alpha-1', status: 'open', createdAt: '2031-06-17T10:00:00Z', updatedAt: '2031-06-17T14:00:00Z' },
  { id: 'newer', eventId: 'alpha-2', status: 'open', createdAt: '2031-06-17T11:00:00Z' },
  { id: 'closed', eventId: 'alpha-1', status: 'closed', createdAt: '2031-06-17T12:00:00Z' },
];
const resolve = (url = '/', saved = cases, source = records) => resolveAnalystIncidentSelection(source, saved, data, url);

test('fresh Analyst menu selects featured customer incident without inventing a case', () => {
  const state = resolve('/?mode=analyst&view=command', []);
  assert.equal(state.selectedIncidentId, 'INC-BETA');
  assert.equal(state.selectedIncident, rows[1]);
  assert.equal(state.activeCase, null);
  assert.deepEqual(state.matchingOpenCases, []);
  assert.deepEqual(state.openIncidents.map(row => row.id), ['INC-ALPHA', 'INC-BETA']);
});
test('valid incident aliases beat unrelated case; invalid or foreign selection falls back to featured', () => {
  for (const alias of ['incident', 'incidentId']) {
    assert.equal(resolve(`/?${alias}=INC-ALPHA&case=unrelated`).activeCase?.id, 'newer');
    assert.equal(resolve(`/?${alias}=FOREIGN-CUSTOMER&case=older`).selectedIncidentId, 'INC-ALPHA');
    assert.equal(resolve(`/?${alias}=FOREIGN-CUSTOMER`).selectedIncidentId, 'INC-BETA');
    assert.equal(resolve(`/?${alias}=INC-CLOSED`).selectedIncidentId, 'INC-BETA');
  }
});
test('latest OPEN case is based on creation, explicit matching case (including closed history) is preserved', () => {
  const state = resolve('/?incidentId=INC-ALPHA');
  assert.equal(state.activeCase?.id, 'newer');
  assert.deepEqual(state.matchingOpenCases.map(item => item.id), ['newer', 'older']);
  assert.equal(resolve('/?incidentId=INC-ALPHA&case=older').activeCase?.id, 'older');
  assert.equal(resolve('/?incidentId=INC-ALPHA&case=closed').activeCase?.id, 'closed');
  assert.equal(resolve('/?case=older').selectedIncidentId, 'INC-ALPHA');
  assert.equal(resolve('/?incidentId=INC-ALPHA', [...cases].reverse()).activeCase?.id, 'newer');
});
test('no matching cases stays incident-scoped and unavailable featured defaults deterministically', () => {
  assert.equal(resolve('/?incident=INC-BETA&case=older').activeCase, null);
  const empty = resolve('/', [], { ...records, statewideIncidents: [] });
  assert.equal(empty.selectedIncidentId, null);
  assert.equal(empty.activeCase, null);
  assert.equal(resolve('/', cases, { ...records, featuredIncidentId: 'missing' }).selectedIncidentId, 'INC-ALPHA');
  const third = { id: 'CUSTOMER-THIRD', status: 'open', severity: 'low' };
  assert.deepEqual(resolve('/', [], { statewideIncidents: [third], featuredIncidentId: third.id }).openIncidents, [third]);
  assert.ok(!resolve().openIncidents.some(item => item.id === third.id));
});
test('selection URL atomically resets stale case/filters, preserves route/hash and survives modes and history replay', () => {
  const start = '/?mode=analyst&view=cop&incidentId=INC-ALPHA&case=older&sector=care&entity=old#map';
  const next = analystIncidentSelectionLocation(start, 'INC-BETA', records, cases, data);
  const url = new URL(next, 'https://local.invalid');
  assert.equal(url.searchParams.get('incident'), 'INC-BETA');
  assert.equal(url.searchParams.get('incidentId'), 'INC-BETA');
  for (const key of ['case', 'entity', 'sector']) assert.equal(url.searchParams.get(key), null);
  assert.equal(url.hash, '#map');
  assert.equal(url.searchParams.get('view'), 'cop');
  assert.equal(resolve(prototypeLocation(next, 'consequence', null, null, 'command')).selectedIncidentId, 'INC-BETA');
  assert.equal(resolve(prototypeLocation(next, 'cop', null, null, 'analyst')).selectedIncidentId, 'INC-BETA');
  assert.equal(resolve(start).activeCase?.id, 'older'); // Back
  assert.equal(resolve(next).activeCase, null); // Forward
  assert.equal(analystIncidentSelectionLocation(start, 'FOREIGN-CUSTOMER', records, cases, data), start);
});
test('shared event clock resolves relative samples against persisted anchor, ahead of stale timestamps', () => {
  const event = { id: 'sample', relativeTimeHours: -2 / 3, timestamp: '2020-01-01T00:00:00Z' };
  assert.equal(resolveEventTimestamp(event, records), '2031-06-17T11:20:00.000Z');
  assert.equal(eventTimestamp(event, data, records), '2031-06-17T11:20:00.000Z');
  assert.equal(resolveEventTimestamp({ ...event, relativeTimeHours: 0 }, records), '2031-06-17T12:00:00.000Z');
  assert.equal(resolveEventTimestamp(event, { ...records, now: '2099-01-01T00:00:00Z' }), '2031-06-17T11:20:00.000Z');
  assert.equal(resolveEventTimestamp(event, {}), undefined);
  assert.equal(resolveEventTimestamp(event, { sampleDataAnchor: '2031-06-17T12:00:00' }), undefined);
});
test('live timestamp/eventTime remain valid; invalid or timezone-free values never invent a time', () => {
  assert.equal(resolveEventTimestamp({ id: 'live', timestamp: '2031-06-17T15:23:00+02:00' }, records), '2031-06-17T15:23:00+02:00');
  assert.equal(resolveEventTimestamp({ id: 'live', eventTime: '2031-06-17T13:23:00Z' }, records), '2031-06-17T13:23:00Z');
  for (const timestamp of ['bad', '2031-06-17T13:23:00']) assert.equal(resolveEventTimestamp({ id: 'bad', timestamp }, records), undefined);
  assert.equal(resolveEventTimestamp({ id: 'bad', relativeTimeHours: NaN }, records), undefined);
  const time = resolveEventTimestamp({ id: 'sample', relativeTimeHours: 0 }, records);
  assert.equal(formatTime(time, 'America/Chicago'), '07:00 CDT');
});
test('case timeline sorting and displayed clocks share resolved absolute timestamps, including live evidence', () => {
  const events = [{ id: 'sample', relativeTimeHours: 0 }, { id: 'live', timestamp: '2031-06-17T11:00:00Z' }];
  const timeline = caseTimeline(null, { ...data, events }, null, records);
  assert.deepEqual(timeline.map(row => row.event.id), ['live', 'sample']);
  assert.ok(timeline.every(row => row.time !== 'Time unavailable'));
});

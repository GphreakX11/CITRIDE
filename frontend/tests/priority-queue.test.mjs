import "./configured-time-fixture.mjs";
import test from "node:test";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { priorityQueue } from '../src/priorityQueue.ts';

const row = (id, extra = {}) => ({ record: { id, title: `Incident ${id}`, severity: 'high', status: 'open', ...extra }, incident: null, footprint: null, cascading: false, elapsed: null, sectors: [], latestUpdate: null });
const model = (rows, extra = {}) => ({ rows, decisions: [], facilities: [], ...extra });
const records = (decisions = []) => ({ decisions, teams: [] });

test('top three are deterministic, disclose remaining, exclude closed/resolved without mutating input', () => {
  const m = model([row('d'), row('b'), row('c'), row('a'), row('closed', { status: 'closed' }), row('resolved', { status: 'resolved' })]);
  const before = structuredClone(m);
  const result = priorityQueue(m, records());
  assert.deepEqual(result.items.map(i => i.row.record.id), ['a', 'b', 'c']);
  assert.equal(result.remaining, 1);
  assert.deepEqual(m, before);
});
test('unknown owner, timing and unmodeled impact are explicit, not zero', () => {
  const [item] = priorityQueue(model([row('x')]), records()).items;
  assert.equal(item.owner, 'Owner not recorded');
  assert.equal(item.timing, 'Timing not recorded');
  assert.match(item.reason, /High severity.*Not yet modeled/);
  assert.equal(item.evidence, 'Saved incident record');
  assert.doesNotMatch(item.reason, /0 people|no impact/i);
});
test('saved pending request outranks modeled risk and uses its recorded owner/deadline', () => {
  const a = row('a'), b = row('b');
  const decision = { id: 'request', incidentId: 'b', title: 'Authorize support', decision: 'pending', ownerRole: 'Duty officer', dueAt: '2026-01-01T04:00:00Z' };
  const m = model([a, b], { decisions: [{ row: b, record: decision }], facilities: [{ row: a, items: [{ id: 'hospital', label: 'Hospital', windowHours: [2, 4] }] }] });
  const [item] = priorityQueue(m, records([decision])).items;
  assert.equal(item.row, b);
  assert.equal(item.evidence, 'Saved decision request');
  assert.equal(item.owner, 'Duty officer');
  assert.match(item.timing, /Recorded due: .*CST/);
  assert.doesNotMatch(item.timing, /T04:00:00Z/);
  assert.match(item.reason, /Authorize support/);
  assert.equal(item.view, 'leadership');
});
test('reference-triggered options are provisional, not saved pending decisions or deadlines', () => {
  const a = row('a');
  const m = model([a], { decisions: [{ row: a, record: { id: 'option', title: 'Consider response', ownerRole: 'Reference role' }, windowLabel: 'Immediately' }] });
  const [item] = priorityQueue(m, records()).items;
  assert.equal(item.evidence, 'Provisional option');
  assert.match(item.reason, /Suggested option.*Consider response/);
  assert.equal(item.owner, 'Owner not recorded');
  assert.equal(item.timing, 'Timing not recorded');
});
test('modeled windows are planning windows, not live deadlines; invalid windows are ignored', () => {
  const a = row('a');
  const m = model([a], { facilities: [{ row: a, items: [{ id: 'bad', label: 'Invalid', windowHours: [-1, 0] }, { id: 'hospital', label: 'Hospital', windowHours: [0, 2] }] }] });
  const [item] = priorityQueue(m, records()).items;
  assert.equal(item.evidence, 'Modeled · saved run');
  assert.equal(item.entityId, 'hospital');
  assert.equal(item.timing, 'Modeled window: 0–2 h (run-relative, not a deadline)');
  assert.match(item.reason, /Hospital/);
  assert.equal(item.view, 'consequence');
});
test('latest decision state wins; recorded ownership is not inferred from author or team', () => {
  const a = row('a', { recordedBy: 'Analyst', teamId: 'team-other' });
  const m = model([a], { decisions: [{ row: a, record: { id: 'option', title: 'Option' } }] });
  const history = [{ id: 'old', incidentId: 'a', optionId: 'option', decision: 'pending', at: '2026-01-01T00:00:00Z' }, { id: 'new', incidentId: 'a', optionId: 'option', decision: 'approved', at: '2026-01-01T01:00:00Z' }];
  const [item] = priorityQueue(m, records(history)).items;
  assert.equal(item.evidence, 'Saved incident record');
  assert.equal(item.owner, 'Owner not recorded');
});
test('empty queue and invalid dates do not manufacture urgency', () => {
  assert.deepEqual(priorityQueue(model([]), records()), { items: [], remaining: 0, total: 0 });
  const [item] = priorityQueue(model([row('x', { dueAt: 'invalid' })]), records()).items;
  assert.equal(item.timing, 'Timing not recorded');
});
test('queue precedes map and preserves existing registers; actions use existing navigation', () => {
  const source = readFileSync(new URL('../src/C1Overview.tsx', import.meta.url), 'utf8');
  assert.ok(source.indexOf('What needs attention?') < source.indexOf('<C1Map'));
  assert.match(source, /command\(item\.view, item\.row, item\.entityId\)/);
  assert.match(source, /queue\.remaining/);
  assert.match(source, /c1-decisions-heading/);
  assert.match(source, /c1-facilities-heading/);
  assert.match(source, /priority-queue\.css/);
});

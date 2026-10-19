import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { transformWithOxc } from 'vite';
import * as caseIncidentSelection from '../src/caseIncidentSelection.ts';
import { readIncidentFocus } from '../src/incidentFocus.ts';
import { defaultIncidentId } from '../src/incidentSelection.ts';
import { caseSelectionAfterRead, caseFocusEntity } from '../src/investigationContext.ts';
import { readPrototypeLocation, prototypeLocation } from '../src/prototypeLocation.ts';

// Execute App's real receiveCases callback, not a copied selection algorithm or
// source-pattern assertion. Only its surrounding React state setters are hosted.
const appUrl = new URL('../src/App.tsx', import.meta.url);
const source = readFileSync(appUrl, 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
const app = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration' && node.declaration.id?.name === 'App').declaration;
const callback = app.body.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'receiveCases');
const { code } = await transformWithOxc(source.slice(callback.start, callback.end), 'receiveCases.ts');

// Synthetic IDs model the confirmed three-case/shared-incident reproduction.
// Neither identifiers nor event records are copied from a live store.
const probe = 'synthetic-probe-case';
const waterCases = ['synthetic-sensor-case', 'synthetic-connection-case'];
const cases = [
  { id: probe, eventId: 'probe-event', status: 'open' },
  { id: waterCases[0], eventId: 'sensor-event', status: 'open' },
  { id: waterCases[1], eventId: 'connection-event', status: 'open' },
  { id: 'other-case', eventId: 'other-event', status: 'open' },
];
const incidents = [
  { id: 'TX-26-0412', linkedEventIds: ['probe-event', 'sensor-event', 'connection-event'] },
  { id: 'other-incident', caseId: 'other-case', linkedEventIds: ['other-event'] },
];
function receive(url, records = cases, rows = incidents) {
  const location = readPrototypeLocation(url);
  let selectedCase = location.caseId, selectedEntity = location.entityId;
  const scope = {
    ...caseIncidentSelection, readIncidentFocus, defaultIncidentId,
    caseSelectionAfterRead, caseFocusEntity,
    casesRead: { current: false }, caseRecordsRef: { current: [] },
    selectionInitialized: { current: true }, mode: location.mode, view: location.view,
    selectedEntity, selectedCaseId: selectedCase, data: null,
    setCaseRecords() {}, setSelectedCaseId(id) { selectedCase = id; },
    setSelectedEntity(id) { selectedEntity = id; },
  };
  const previous = globalThis.window;
  globalThis.window = { location: { href: url } };
  try {
    const run = new Function(...Object.keys(scope), `${code}; return receiveCases;`)(...Object.values(scope));
    run(records, { statewideIncidents: rows });
    return { caseId: selectedCase, entityId: selectedEntity,
      url: new URL(prototypeLocation(url, location.view, selectedEntity, selectedCase, location.mode), url) };
  } finally { globalThis.window = previous; }
}
const profile = (caseId, incidentId = 'TX-26-0412') => `http://127.0.0.1:8975/?mode=analyst&view=entity-profile&case=${caseId}&incident=${incidentId}&incidentId=${incidentId}&entity=cyber-sensor-a&profileReturn=%2F%3Fmode%3Danalyst%26view%3Dcase-file%26case%3D${caseId}`;
for (const id of waterCases) {
  test(`saved case ${id} survives Case File to profile reload with shared incident`, () => {
    const initial = receive(`http://127.0.0.1:8975/?mode=analyst&view=case-file&case=${id}`);
    assert.equal(initial.caseId, id);
    const result = receive(profile(id));
    assert.equal(result.caseId, id);
    assert.equal(result.entityId, 'cyber-sensor-a');
    assert.equal(result.url.searchParams.get('case'), id);
    assert.equal(result.url.searchParams.get('incidentId'), 'TX-26-0412');
    assert.equal(result.url.searchParams.get('profileReturn'), `/?mode=analyst&view=case-file&case=${id}`);
    assert.equal(receive(result.url.href).caseId, id, 'a subsequent refresh must be stable');
  });
}
test('a deliberate switch to a different incident replaces the old saved case', () => {
  assert.equal(receive(profile(waterCases[0], 'other-incident')).caseId, 'other-case');
});
test('an invalid or deleted saved case falls back to the incident first linked case', () => {
  assert.equal(receive(profile('deleted-case')).caseId, probe);
});
test('missing case falls back to an explicit incident direct mapping', () => {
  const url = new URL(profile('ignored', 'other-incident')); url.searchParams.delete('case');
  assert.equal(receive(url.href).caseId, 'other-case');
});
test('an incident with no matching saved case clears an unrelated selection', () => {
  assert.equal(receive(profile(waterCases[0], 'no-saved-case')).caseId, null);
});
test('without incident focus a valid explicit case is retained, and a deleted one clears', () => {
  assert.equal(receive(`http://127.0.0.1/?mode=analyst&view=case-file&case=${waterCases[1]}`).caseId, waterCases[1]);
  assert.equal(receive('http://127.0.0.1/?mode=analyst&view=case-file&case=deleted').caseId, null);
});
test('direct case mapping retains its selected saved case', () => {
  assert.equal(receive(profile('other-case', 'other-incident')).caseId, 'other-case');
});

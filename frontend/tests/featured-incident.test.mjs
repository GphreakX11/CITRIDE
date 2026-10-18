import test from 'node:test';
import assert from 'node:assert/strict';
import * as selection from '../src/incidentSelection.ts';
import { incidentFocusLocation, readIncidentFocus } from '../src/incidentFocus.ts';
const rows = [
  { id: 'CITY-ALPHA', caseId: 'saved-alpha', status: 'open', severity: 'critical', startedAt: '2026-10-18T08:00:00Z' },
  { id: 'REGION-BETA', status: 'monitoring', severity: 'high' },
  { id: 'OTHER-CUSTOMER-THIRD', caseId: 'saved-third', status: 'open', severity: 'low', sectors: ['Energy'], location: { label: 'Other district' }, nearEntityIds: ['third-grid'] },
];
const records = { statewideIncidents: rows, featuredIncidentId: rows[2].id };
test('configured third or alternate OPEN incident beats severity and unrelated selected case', () => {
  assert.equal(selection.defaultIncidentId(records, { url: '/?view=cop' }), rows[2].id);
  assert.equal(selection.defaultIncidentId(records, { url: '/?view=consequence', featuredIncidentId: rows[1].id }), rows[1].id);
});
test('explicit incident URL takes precedence, including aliases and saved-case URL mapping', () => {
  for (const key of ['incident', 'incidentId']) assert.equal(selection.defaultIncidentId(records, { url: `/?${key}=REGION-BETA&case=saved-third` }), 'REGION-BETA');
  assert.equal(selection.defaultIncidentId(records, { url: '/?case=saved-alpha' }), 'CITY-ALPHA');
  assert.equal(selection.defaultIncidentId(records, { url: '/?case=unlinked-case' }), 'unlinked-case');
});
test('closed/missing featured falls back deterministically to highest-severity OPEN; empty returns null', () => {
  for (const featuredIncidentId of ['missing', 'closed']) {
    const r = { statewideIncidents: [...rows, { id: 'closed', status: 'closed', severity: 'critical' }], featuredIncidentId };
    assert.equal(selection.defaultIncidentId(r, { url: '/' }), 'CITY-ALPHA');
    assert.equal(selection.defaultIncidentId({ ...r, statewideIncidents: [...r.statewideIncidents].reverse() }, { url: '/' }), 'CITY-ALPHA');
  }
  assert.equal(selection.defaultIncidentId({ statewideIncidents: [{ id: 'closed', status: 'closed' }], featuredIncidentId: 'closed' }, { url: '/' }), null);
  assert.equal(selection.defaultIncidentId({ statewideIncidents: [] }, { url: '/' }), null);
});
test('fallback ties match backend ID ordering, not dropdown recency, and exclude reference-only records', () => {
 const statewideIncidents = [
  { id: 'Z-RECENT', status: 'open', severity: 'high', startedAt: '2026-10-18T09:00:00Z' },
  { id: 'A-OLDER', status: 'open', severity: 'high', startedAt: '2026-10-18T08:00:00Z' },
  { id: 'REFERENCE', status: 'open', severity: 'critical', referenceOnly: true },
  { id: 'UNKNOWN-STATUS', status: 'invalid', severity: 'critical' },
 ];
 assert.equal(selection.defaultIncidentId({ statewideIncidents }, { url: '/' }), 'A-OLDER');
 assert.equal(selection.defaultIncidentId({ statewideIncidents: [...statewideIncidents].reverse() }, { url: '/' }), 'A-OLDER');
});
test('canonical incident focus updates both aliases without losing saved-case/entity context', () => {
  const url = incidentFocusLocation('/?mode=analyst&view=consequence&incidentId=stale&case=saved-third&entity=third-grid#details', 'REGION-BETA');
  assert.equal(readIncidentFocus(url), 'REGION-BETA');
  const params = new URL(url, 'https://local.invalid').searchParams;
  assert.equal(params.get('incidentId'), 'REGION-BETA');
  assert.equal(params.get('case'), 'saved-third');
  assert.equal(params.get('entity'), 'third-grid');
  assert.equal(readIncidentFocus(incidentFocusLocation(url, null)), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readIncidentFocus, incidentFocusLocation } from '../src/incidentFocus.ts';
test('incident focus is independent of saved case and preserves other URL state', () => {
  const input = '/?mode=command&view=command&case=saved&entity=asset&tab=raw&custom=value#notes';
  const out = incidentFocusLocation(input, 'TX-26-0042');
  const url = new URL(out, 'https://example.test');
  assert.equal(readIncidentFocus(out), 'TX-26-0042');
  assert.equal(url.searchParams.get('case'), 'saved');
  assert.equal(url.searchParams.get('entity'), 'asset');
  assert.equal(url.searchParams.get('tab'), 'raw');
  assert.equal(url.searchParams.get('custom'), 'value');
  assert.equal(url.hash, '#notes');
});
test('clearing focus removes only the incident parameter', () => {
  const out = incidentFocusLocation('/?incident=TX-26-0042&case=saved&view=cop', null);
  const url = new URL(out, 'https://example.test');
  assert.equal(readIncidentFocus(out), null);
  assert.equal(url.searchParams.get('case'), 'saved');
  assert.equal(url.searchParams.get('view'), 'cop');
});
test('invalid record identifiers cannot inject URL state', () => {
  for (const value of ['', 'evil&case=foreign', '<script>', 'id with spaces']) {
    assert.equal(readIncidentFocus(incidentFocusLocation('/?case=kept', value)), null);
  }
  assert.equal(readIncidentFocus('/?incident=%3Cscript%3E'), null);
});

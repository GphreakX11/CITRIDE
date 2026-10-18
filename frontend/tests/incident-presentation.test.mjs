import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import * as h from '../src/incidentPresentation.ts';
import { defaultIncidentId } from '../src/incidentSelection.ts';
import { statusTone } from '../src/statusTone.ts';
import { StatusChip } from '../src/visualPrimitives.ts';

const preliminary = { id: 'pre', kind: 'preliminary', createdAt: '2026-10-10T00:00:00Z', seed: { provider: 'origin' }, impacts: [{ entityId: 'remote', state: 'at_risk', lossOfFunction: 1, windowHours: [2, 5], paths: [['supply']] }] };
test('new status vocabulary and critical chip are semantic, not pulsing', () => {
  for (const word of ['offline', 'halted', 'affected']) assert.equal(statusTone(word), 'red');
  for (const word of ['disrupted', 'delayed', 'diverted', 'reviewing', 'on_watch', 'On watch']) assert.equal(statusTone(word), 'amber');
  const markup = renderToStaticMarkup(createElement(StatusChip, { status: ' Critical ', title: 'Recorded' }, 'Critical'));
  assert.match(markup, /status-chip--critical/);
  assert.doesNotMatch(markup, /pulse/);
  const css = readFileSync(new URL('../src/shared-components.css', import.meta.url), 'utf8');
  assert.match(css, /status-chip\.status-chip--critical\s*\{[^}]*background:\s*var\(--critical-solid\)[^}]*color:\s*var\(--text-strong\)/is);
  const theme = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  assert.match(theme, /--critical-solid:\s*#e5484d/i);
  assert.match(theme, /--text-strong:\s*#ffffff/i);
});
test('default selection reuses the existing configured selector', () => {
  assert.equal(h.defaultIncidentId, defaultIncidentId);
  const records = { featuredIncidentId: 'city:featured', statewideIncidents: [{ id: 'city:urgent', severity: 'critical', status: 'active' }, { id: 'city:featured', severity: 'high', status: 'monitoring' }] };
  assert.equal(h.defaultIncidentId(records, { url: '/' }), 'city:featured');
  assert.equal(h.defaultIncidentId(records, { url: '/?incident=city%3Aurgent' }), 'city:urgent');
});
test('reviewed analysis wins over newer preliminary without any case', () => {
  const reviewed = { ...preliminary, id: 'review', kind: 'reviewed', createdAt: '2026-10-01T00:00:00Z', impacts: [] };
  assert.equal(h.bestAnalysisFor({ analyses: [preliminary, reviewed] }), reviewed);
  assert.equal(h.hasCascadingImpact({ status: 'active', preliminaryAnalysis: preliminary }), true);
  assert.equal(h.hasCascadingImpact({ analyses: [preliminary, reviewed] }), false);
  assert.equal(h.hasCascadingImpact({ severity: 'critical' }), false);
  assert.equal(h.hasCascadingImpact({ status: 'closed', preliminaryAnalysis: preliminary }), false);
  assert.equal(h.hasCascadingImpact({ preliminaryAnalysis: { ...preliminary, impacts: [{ ...preliminary.impacts[0], entityId: 'origin' }] } }), false);
});
test('sector and icons prefer record metadata then supplied reference, not names', () => {
  assert.equal(h.sectorOf({ sector: 'Orbital services', idt: { status: 'coded', path: '8.1' } }), 'Orbital services');
  assert.equal(h.sectorOf({ idt: { status: 'coded', path: '8.1' } }), 'Communications');
  assert.equal(h.sectorOf({ idt: { status: 'unassigned' } }), null);
  assert.equal(h.iconFor({ type: 'Relay', icon: 'Anchor' }, { Relay: 'RadioTower' }), 'Anchor');
  assert.equal(h.iconFor({ type: 'Relay', label: 'Renamed object' }, { Relay: 'RadioTower' }), 'RadioTower');
  assert.equal(h.iconFor({ type: 'WaterUtility' }), 'water');
  assert.equal(h.iconFor({ type: 'toString' }, {}), 'facility');
});
test('paths use captured dependency IDs and include every branch, never unrelated branches', () => {
  const analysis = { source: { id: 's' }, nodes: [{ id: 't', paths: [['a', 'b'], ['c', 'd']] }], edges: [{ id: 'a', from: 's', to: 'm' }, { id: 'b', from: 'm', to: 't' }, { id: 'c', from: 's', to: 'n' }, { id: 'd', from: 'n', to: 't' }, { id: 'e', from: 's', to: 'other' }] };
  assert.deepEqual(new Set(h.pathToSource('t', analysis)), new Set(['s', 'm', 'n', 't']));
  assert.deepEqual(h.pathToSource('missing', analysis), []);
  assert.deepEqual(h.pathToSource('s', analysis), ['s']);
});
test('raw run dependencies and API consequence envelopes use their real shapes', () => {
  const run = { ...preliminary, baselineSnapshot: { dependencies: [{ id: 'supply', provider: 'origin', dependent: 'remote' }] } };
  assert.deepEqual(h.pathToSource('remote', run), ['origin', 'remote']);
  const projection = { incident: { id: 'regional-1', status: 'active' }, analysis: { kind: 'preliminary' }, source: { id: 'origin' }, nodes: [{ id: 'remote', windowHours: [2, 5], impactCount: 1 }] };
  assert.equal(h.hasCascadingImpact(projection), true);
  assert.equal(h.hasCascadingImpact({ ...projection, incident: { status: 'closed' } }), false);
  const connected = { source: { id: 's' }, nodes: [{ id: 't', paths: [] }], edges: [{ id: 'a', from: 's', to: 'm' }, { id: 'b', from: 'm', to: 't' }, { id: 'c', from: 't', to: 'm' }, { id: 'd', from: 'unrelated', to: 't' }] };
  assert.deepEqual(new Set(h.pathToSource('t', connected)), new Set(['s', 'm', 't']));
});

test('central watch records are scoped and remain unchanged', () => {
  const records = { watchAssets: [{ id: 'w1', incidentId: 'new:1', entityId: 'a' }, { id: 'w2', incidentId: 'other', entityId: 'b' }] };
  assert.deepEqual(h.watchAssetsFor({ id: 'new:1' }, records), [records.watchAssets[0]]);
  assert.deepEqual(h.watchAssetsFor({ id: 'missing' }, records), []);
});
test('third customer renamed fixture and 50 incidents / 300 assets remain data driven', () => {
  const incidents = Array.from({ length: 50 }, (_, i) => ({ id: `regional-${i}`, status: 'active', severity: i === 49 ? 'critical' : 'medium', title: `Renamed incident ${i}`, analyses: [{ ...preliminary, id: `run-${i}` }] }));
  const assets = Array.from({ length: 300 }, (_, i) => ({ id: `orbital-${i}`, incidentId: incidents[i % 50].id, type: 'Relay', sector: 'Orbital services', schematic: { x: i % 30, y: Math.floor(i / 30) } }));
  const records = { statewideIncidents: incidents, watchAssets: assets, featuredIncidentId: incidents[12].id };
  assert.equal(h.defaultIncidentId(records, { url: '/' }), incidents[12].id);
  for (const incident of incidents) { assert.equal(h.hasCascadingImpact(incident), true); assert.equal(h.watchAssetsFor(incident, records).length, 6); }
  for (const asset of assets) { assert.equal(h.sectorOf(asset), 'Orbital services'); assert.equal(h.iconFor(asset, { Relay: 'RadioTower' }), 'RadioTower'); }
});

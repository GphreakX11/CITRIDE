import './configured-time-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from './json-module-transform.mjs';
import { caseTimeline } from '../src/caseTimeline.ts';
import { analysisIntent } from '../src/analystAnalysis.ts';
import { infrastructureIds, graphEdges } from '../src/texasGraph.ts';

// Component/SSR fixtures, not server or browser acceptance. The owner-loading unit test
// below stubs fetch explicitly; it does not establish real endpoint/browser acceptance.
const water = JSON.parse(readFileSync(new URL('../../data/scenario.json', import.meta.url)));
const provider = { id: 'relay-hub', type: 'RelayFacility', label: 'Regional relay hub', sourceRefs: [] };
const peer = { id: 'remote-relay', type: 'RelayFacility', label: 'Remote relay', sourceRefs: [] };
const events = Array.from({ length: 6 }, (_, i) => ({
  id: `relay-event-${i}`, label: `Relay observation ${i}`, type: 'CyberEvent',
  seenOn: i === 5 ? peer.id : 'relay-console', relativeTimeHours: i / 10,
  evidenceCategory: 'simulated', sourceRefs: [],
  ...(i < 3 ? { attackTechniques: [{ id: 'T1078', name: 'Valid Accounts' }] } : {}),
}));
const scenario = { id: 'relay-down', label: 'Relay service unavailable', description: 'SIMULATED fixture', horizonHours: 48,
  seed: { provider: provider.id, service: 'relay_service', lossType: 'relay_loss', windowHours: [0, 1], persistsThroughHour: 48, eventRefs: events.map(e => e.id), sourceRefs: [] } };
const data = { ...water, baselineRevision: 2,
  entities: [...water.entities, provider, peer, { id: 'relay-console', type: 'CyberAsset', label: 'Relay console', hostedBy: provider.id, sourceRefs: [] }],
  events: [...water.events, ...events], scenarios: [...water.scenarios, scenario],
  dependencies: [...water.dependencies, { ...water.dependencies[0], id: 'relay-link', provider: provider.id, dependent: peer.id }],
};
const incident = { id: 'case-relay', version: 1, title: 'Relay case', status: 'open', priority: 'high', baselineRevision: 2,
  eventId: events[0].id, eventSnapshot: events[0], runId: null, runSnapshot: null,
  contextSnapshot: { event: events[0], provider, cyberAsset: data.entities.at(-1), physicalAsset: null, facility: provider, serviceArea: null,
    scenarios: [scenario], downstreamDependencies: [], sourceRefs: [], warnings: [] }, tasks: [], decisions: [], notes: [], activity: [],
};
const source = { id: 'INC-RELAY', title: 'Relay incident', linkedEventIds: events.map(e => e.id), sourceProvider: provider.id };
const records = { statewideIncidents: [source], now: '2026-10-18T12:00:00Z', timing: {}, teams: [], contacts: [], assessments: [], assetStatuses: [], hunts: [], decisions: [], partnerProducts: [], taskGroups: [], contactStatusLabels: {}, huntStatusLabels: {}, decisionLabels: {},

  responseTasks: [{ id: 'relay-task', incidentId: source.id, label: 'Verify relay access', teamId: 'relay-team', status: 'waiting' }, { id: 'other-task', incidentId: 'other', label: 'Unrelated task' }],
};
const reference = JSON.parse(readFileSync(new URL('../../data/reference.json', import.meta.url)));
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (await transformWithOxc(readFileSync(url, 'utf8'), url.pathname, { jsx: { runtime: 'automatic' } })).code;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, '');
  const imports = new Map();
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const s = m[1];
    if (imports.has(s)) continue;
    let target = s;
    if (s.startsWith('.')) {
      let u = new URL(s, url);
      if (!existsSync(u)) u = ['.ts', '.tsx'].map(ext => new URL(s + ext, url)).find(existsSync);
      target = await compile(u);
    } else target = import.meta.resolve(s);
    imports.set(s, target);
  }
  code = code.replace(/from\s+["']([^"']+)["']/g, (_, s) => `from ${JSON.stringify(imports.get(s))}`);
  const out = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  cache.set(url.href, out);
  return out;
}
async function render(name, props) {
  const Component = (await import(await compile(new URL('../src/' + name, import.meta.url)))).default;
  return renderToStaticMarkup(createElement(Component, props));
}
const noop = () => {};

async function ownerHarness() {
  const { transformWithOxc: nativeTransform } = await import('vite');
  const url = new URL('../src/ScriptedAnalystViews.tsx', import.meta.url);
  let code = (await nativeTransform(readFileSync(url, 'utf8'), url.pathname, { jsx: { runtime: 'automatic' } })).code;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, '').replace(/from\s+["']([^"']+)["']/g, (_, spec) =>
    `from ${JSON.stringify(spec === 'react'
      ? 'data:text/javascript,' + encodeURIComponent('export const useState=(...a)=>globalThis.__ownerHooks.useState(...a);export const useRef=(...a)=>globalThis.__ownerHooks.useRef(...a);export const useEffect=(...a)=>globalThis.__ownerHooks.useEffect(...a);')
      : spec.startsWith('.') ? new URL(spec, url).href : import.meta.resolve(spec))}`);
  const Component = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  const slots = [];
  let index = 0, effects = [];
  globalThis.__ownerHooks = {
    useState(initial) { const n = index++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { slots[n] = value; }]; },
    useRef(initial) { const n = index++; return slots[n] ??= { current: initial }; },
    useEffect(effect) { effects.push(effect); },
  };
  return {
    render(extra = {}) {
      index = 0; effects = [];
      return renderToStaticMarkup(Component({ data, incidents: [incident], selected: incident, records, reference,
        view: 'coordination', onMutate: noop, onRefresh: noop, ...extra }));
    },
    effects() { return effects.map(effect => effect()).filter(Boolean); },
  };
}

test('A5 unit fetch uses existing incident projection contract, rejects wrong scope and hides stale owners', async () => {
  const previous = globalThis.fetch;
  const requests = [];
  let result = { incident: { id: source.id }, responseOwners: [{ role: 'Asset owner', who: 'Relay operations desk', does: 'Restore relay service' }] };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  try {
    const h = await ownerHarness();
    h.render(); h.effects(); await tick();
    assert.match(h.render(), /Relay operations desk/);
    assert.match(h.render(), /Restore relay service/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/command/consequences?incidentId=INC-RELAY');
    assert.ok(!requests[0].options?.method || requests[0].options.method === 'GET');
    const next = { ...incident, id: 'case-other', eventId: 'other-event' };
    const nextRecords = { ...records, statewideIncidents: [{ id: 'INC-OTHER', caseId: next.id }] };
    assert.ok(!h.render({ selected: next, records: nextRecords }).includes('Relay operations desk'));
    h.effects(); await tick();
    assert.match(h.render({ selected: next, records: nextRecords }), /did not match the selected case/);
    result = { incident: { id: 'INC-OTHER' }, responseOwners: [] };
    h.effects(); await tick();
    assert.match(h.render({ selected: next, records: nextRecords }), /No response owners recorded/);
  } finally { globalThis.fetch = previous; delete globalThis.__ownerHooks; }
});

test('A1 retains all 13 alerts and prioritizes the six selected-incident alerts', async () => {
  const props = { data, incidents: [], records, workflowLocked: false, onCreate: noop, onOpenCase: noop };
  const all = await render('AnalystAlerts.tsx', props);
  assert.match(all, /13 source alerts.*13 without an open case/);
  assert.equal((all.match(/data-alert-id=/g) ?? []).length, 13);
  globalThis.window = { location: new URL('https://example.test/?mode=analyst&view=command&incidentId=INC-RELAY') };
  try {
    const focused = await render('AnalystAlerts.tsx', props);
    assert.equal((focused.match(/data-alert-id=/g) ?? []).length, 13);
    const orderedIds=[...focused.matchAll(/data-alert-id="([^"]+)/g)].map(m=>m[1]);
    assert.deepEqual(new Set(orderedIds.slice(0,6)),new Set(events.map(e=>e.id)));
    for (const event of events) assert.ok(focused.includes(event.label));
    assert.ok(focused.includes(water.events[0].label));
  } finally { delete globalThis.window; }
});

test('A2 includes generic provider and connected dependency assets', () => {
  assert.ok(infrastructureIds(data).includes(provider.id));
  assert.ok(infrastructureIds(data).includes(peer.id));
  assert.ok(graphEdges(data).some(e => e.source === provider.id && e.target === peer.id));
});

test('A3 uses explicit incident membership, preserves tactic-less techniques and shows three None recorded labels', async () => {
  const rows = caseTimeline(incident, data, null, records);
  assert.deepEqual(rows.map(r => r.event.id), events.map(e => e.id));
  assert.equal(rows[0].techniques[0]?.id, 'T1078');
  assert.equal(rows[0].utility?.id, provider.id);
  const html = await render('NetworkEvidence.tsx', { data, incident, records, telemetry: null, initialTab: 'timeline' });
  for (const event of events) assert.ok(html.includes(event.label));
  assert.equal((html.match(/None recorded/g) ?? []).length, 3);
  assert.ok(!html.includes(water.events[0].label));
  assert.ok(!html.includes('B/C campaign probes'));
});

test('A4 offers the captured generic scenario and authored horizon, without unrelated scenario buttons', async () => {
  const props = { data, incident, reference, idtIndex: null, onAnalyze: noop, onMutate: noop, onOpenMap: noop, onOpenEntity: noop, onPropose: noop, onOpenLab: noop };
  const html = await render('AnalystConsequences.tsx', props);
  assert.match(html, /Relay service unavailable/);
  assert.match(html, /value="48" selected=""/);
  for (const unrelated of water.scenarios) assert.ok(!html.includes(`value="${unrelated.id}"`));
  const intent = analysisIntent(incident, scenario.id, 48);
  assert.equal(intent.kind, 'capture');
  assert.equal(intent.caseId, incident.id);
  assert.equal(intent.action.scenarioId, scenario.id);
  assert.equal(intent.action.horizonHours, 48);
  const historical = await render('AnalystConsequences.tsx', { ...props, data: { ...data, scenarios: [] } });
  assert.match(historical, /Relay service unavailable/);
});

test('A5 loads incident owners and A6 tasks use selected incident scope, never unrelated water ranking', async () => {
  const props = { data, incidents: [incident], selected: incident, records, reference, onMutate: noop, onRefresh: noop, busy: false, uncertain: false };
  const owners = await render('ScriptedAnalystViews.tsx', { ...props, view: 'coordination' });
  assert.match(owners, /Loading response owners/);
  assert.ok(!owners.includes('Unrelated owner'));
  assert.ok(!owners.includes('Estimate potential impact for B and C'));
  const tasks = await render('ScriptedAnalystViews.tsx', { ...props, view: 'uctf' });
  assert.match(tasks, /Verify relay access/);
  assert.ok(!tasks.includes('Unrelated task'));
  assert.ok(!tasks.includes('Select a case'));
});

test('Entity Profile resolves generic incident assets and case linkage', async () => {
  const html = await render('AnalystEntityProfile.tsx', { data, incidents: [incident], entityId: provider.id, locked: false, onSelectEntity: noop, onOpenCase: noop, onOpenTool: noop, onEditDependency: noop, onBack: noop });
  assert.match(html, /Regional relay hub/);
  assert.ok(!html.includes('Select a case'));
});

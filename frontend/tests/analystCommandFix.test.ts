import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sectorCascadeModel } from '../src/SectorCascadeView/viewModel.ts';
import type { ConsequenceNode, ConsequenceProjection, Hours } from '../src/consequencesModel.ts';

// Compile the actual React views in memory; do not create build artifacts or mock hooks.
const cache = new Map<string, string>();
async function compile(url: URL): Promise<string> {
  if (cache.has(url.href)) return cache.get(url.href)!;
  let code = (await transformWithOxc(readFileSync(url, 'utf8'), url.pathname, {
    jsx: { runtime: 'automatic' },
  })).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, '');
  const imports = new Map<string, string>();
  for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    imports.set(specifier, specifier.startsWith('.')
      ? await compile(new URL(specifier, url)) : import.meta.resolve(specifier));
  }
  code = code.replace(/from\s+["']([^"']+)["']/g,
    (_, specifier) => `from ${JSON.stringify(imports.get(specifier))}`);
  const result = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  cache.set(url.href, result);
  return result;
}
const { default: SectorCascadeView } = await import(await compile(new URL('../src/SectorCascadeView/SectorCascadeView.tsx', import.meta.url)));
const { default: AssetConsequenceView } = await import(await compile(new URL('../src/AssetConsequenceView/AssetConsequenceView.tsx', import.meta.url)));
const { ConsequencesContent } = await import(await compile(new URL('../src/ConsequencesView.tsx', import.meta.url)));
const { configureDisplayTime } = await import(await compile(new URL('../src/displayTime.ts', import.meta.url)));
const renderC2 = (value: ConsequenceProjection) => renderToStaticMarkup(createElement(SectorCascadeView, { value }));
const renderC4 = (value: ConsequenceProjection) => renderToStaticMarkup(createElement(ConsequencesContent, { value, now: Date.parse(value.now), onAnalyst() {}, onPartners() {} }));
const renderAssets = (value: ConsequenceProjection) => renderToStaticMarkup(createElement(AssetConsequenceView, { value, onAnalyst() {} }));
function node(id: string, sector: string, windowHours: Hours, extra: Partial<ConsequenceNode> = {}): ConsequenceNode {
  return { id, name: id, sector, windowHours, type: 'Facility', impactCount: windowHours ? 1 : 0, paths: [], reserves: [], reserveLabel: 'Reserve', sourceRefs: [], ...extra };
}
function fixture(sector: string, windows: Hours[], authored = false): ConsequenceProjection {
  const members = windows.map((window, i) => node(`member-${i}`, sector, window));
  const known = windows.filter((window): window is [number, number] => !!window);
  const envelope: Hours = known.length ? [Math.min(...known.map(w => w[0])), Math.max(...known.map(w => w[1]))] : null;
  return {
    now: '2026-10-19T20:35:00Z', operationsTimeZone: 'America/Chicago',
    incident: { id: 'synthetic-command-incident', title: 'Synthetic regression fixture' }, incidents: [],
    analysis: { kind: 'preliminary', createdAt: '2026-10-19T19:52:00Z', modelVersion: 'fixture', seed: { lossType: 'outage' } },
    source: { id: 'source', name: 'Source', type: 'Facility' },
    nodes: [node('source', sector, null, { source: true }), node('upstream', sector, null, { upstream: true }), ...members], edges: [],
    sectors: [{ label: sector, source: false, atRisk: known.length, nodes: ['source', 'upstream', ...members.map(n => n.id)], windowHours: envelope, order: 1 }],
    sectorViews: authored ? [{ sectors: [{ sector, items: members.map(n => ({ entityId: n.id, label: n.name })) }] }] : [],
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
for (const [label, sector, windows, expected] of [
  ['water Healthcare', 'Healthcare', [[2, 4], null, [4, 8], [1, 4]], [1, 4]],
  ['port-shaped fallback', 'Transportation', [[12, 18], [6, 12], [6, 12]], [6, 12]],
  ['third incident', 'Fictional communications', [[9, 13], [3, 9], [3, 5], null], [3, 5]],
] as const) {
  test(`${label}: fallback circle shows the earliest complete asset interval independent of input order`, () => {
    const value = fixture(sector, structuredClone(windows) as Hours[]);
    for (const nodes of [value.nodes, [...value.nodes].reverse()]) {
      const input = freeze({ ...value, nodes });
      const before = JSON.stringify(input);
      const group = sectorCascadeModel(input).positions.find(g => g.kind === 'sector' && g.name === sector)!;
      assert.deepEqual(group.node.windowHours, expected);
      assert.equal(group.state.label, `${expected[0]}–${expected[1]} h`);
      assert.match(renderC2(input), new RegExp(`<strong>${sector}</strong><small>${expected[0]}–${expected[1]} h</small>`));
      assert.equal(JSON.stringify(input), before, 'display must not rewrite projection envelopes or assets');
    }
  });
}
test('unknown fallback sector stays unknown rather than inventing a zero-hour interval', () => {
  const value = freeze(fixture('Unknown sector', [null, null]));
  const group = sectorCascadeModel(value).positions.find(g => g.kind === 'sector')!;
  assert.equal(group.node.windowHours, null);
  assert.equal(group.state.label, 'No status recorded');
});
for (const sector of ['Transportation', 'Fictional communications']) {
  test(`${sector}: authored sector circles keep the stored aggregate envelope shown by C4`, () => {
    const value = freeze(fixture(sector, [[12, 18], [6, 12]], true));
    assert.deepEqual(sectorCascadeModel(value).sectors[0].window, [6, 18]);
    assert.match(renderC2(value), /6–18 h/);
    const table = renderC4(value).split('<h2>By sector</h2>')[1].split('</table>')[0];
    assert.match(table, /6–18 h/);
  });
}
test('water fallback earliest asset does not overwrite C4’s stored 1–8 h sector envelope', () => {
  const value = freeze(fixture('Healthcare', [[2, 4], [4, 8], [1, 4]]));
  assert.deepEqual(value.sectors[0].windowHours, [1, 8]);
  const table = renderC4(value).split('<h2>By sector</h2>')[1].split('</table>')[0];
  assert.match(table, /1–8 h/);
});
for (const [zone, timestamp, expected] of [
  ['America/Chicago', '2026-10-19T19:52:00Z', '14:52 CDT'],
  ['America/Chicago', '2026-11-17T20:52:00Z', '14:52 CST'],
  ['America/New_York', '2026-10-19T19:52:00Z', '15:52 EDT'],
  ['UTC', '2026-10-19T19:52:00Z', '19:52 UTC'],
]) {
  test(`C4 Infrastructure modeled time matches banner format in ${zone} at ${timestamp}`, () => {
    const value = fixture('Synthetic sector', [[1, 4]]);
    value.operationsTimeZone = zone;
    value.analysis!.createdAt = timestamp;
    assert.ok(renderAssets(value).includes(`Modeled ${expected}`));
    assert.ok(renderC4(value).includes(expected));
    assert.doesNotMatch(renderAssets(value), /\b(?:AM|PM)\b/);
  });
}
test('C4 Infrastructure uses the same computed-at precedence as the banner', () => {
  const value = fixture('Synthetic sector', [[1, 4]]);
  value.analysis!.computedAt = '2026-10-19T20:35:00Z';
  assert.ok(renderAssets(value).includes('Modeled 15:35 CDT'));
  assert.ok(renderC4(value).includes('15:35 CDT'));
});
test('C4 modeled time respects configured operations zone when projection has no explicit zone', () => {
  configureDisplayTime('America/New_York');
  try {
    const value = fixture('Synthetic sector', [[1, 4]]);
    delete value.operationsTimeZone;
    assert.match(renderAssets(value), /Modeled 15:52 EDT/);
  } finally { configureDisplayTime(undefined); }
});
for (const timestamp of [undefined, '', 'invalid', '2026-10-19T14:52:00']) {
  test(`C4 modeled time preserves missing/ambiguous timestamp: ${String(timestamp)}`, () => {
    const value = fixture('Synthetic sector', [[1, 4]]);
    value.analysis!.createdAt = timestamp as string;
    assert.match(renderAssets(value), /Modeled time not recorded/);
    assert.doesNotMatch(renderAssets(value), /Invalid Date/);
  });
}

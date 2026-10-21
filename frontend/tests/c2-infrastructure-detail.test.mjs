import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (await transformWithOxc(readFileSync(url, 'utf8'), url.pathname, { jsx: { runtime: 'automatic' } })).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, '');
  const imports = new Map();
  for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = match[1];
    imports.set(spec, spec.startsWith('.') && /\.tsx$/.test(spec) ? await compile(new URL(spec, url)) : spec.startsWith('.') ? new URL(/\.[cm]?[jt]s$/.test(spec) ? spec : `${spec}.ts`, url).href : import.meta.resolve(spec));
  }
  code = code.replace(/from\s+["']([^"']+)["']/g, (_, spec) => `from ${JSON.stringify(imports.get(spec))}`);
  const result = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  cache.set(url.href, result);
  return result;
}
const { default: Detail } = await import(await compile(new URL('../src/IncidentInfrastructureDetail.tsx', import.meta.url)));
const node = (id, extra = {}) => ({ id, name: `Recorded ${id}`, type: 'service', sector: 'Water', windowHours: null, impactCount: 0, paths: [], reserves: [], reserveLabel: 'Not recorded', sourceRefs: [], ...extra });
const value = () => ({ now: '2026-10-13T08:30:00Z', incident: { id: 'recorded-incident' }, incidents: [], analysis: { kind: 'fixture', createdAt: '2026-10-13T08:00:00Z', seed: { lossType: 'water' } }, source: { id: 'source', name: 'Recorded source' }, nodes: [node('source', { source: true }), node('downstream', { windowHours: [2, 4], paths: [['service']] }), node('watched')], edges: [{ id: 'service', from: 'source', to: 'downstream', label: 'Potable water' }, { id: 'not-causal', from: 'source', to: 'watched', label: 'Same campaign' }], sectors: [{ label: 'Water', nodes: ['source', 'downstream', 'watched'] }] });
const render = (projection, extra = {}) => renderToStaticMarkup(createElement(Detail, { value: projection, onInspect() {}, ...extra }));
test('restored detail keeps watch-only relationships dashed and noncausal', () => {
  const html = render(value(), { watchAssets: [{ entityId: 'watched', reason: 'Recorded same campaign' }] });
  assert.equal((html.match(/class="idm-edge"/g) ?? []).length, 1);
  assert.equal((html.match(/class="idm-watch-edge"/g) ?? []).length, 1);
  assert.match(html, /Recorded same campaign · watch relationship, not a service dependency/);
  assert.match(html, /On watch · no modeled service loss/);
  assert.match(html, /data-infrastructure-id="downstream"/);
  assert.match(html, /aria-label="Infrastructure sectors"/);
  assert.match(html, /Reset view/);
});
test('restored detail does not fabricate infrastructure when resolved analysis has no assets', () => {
  const projection = { ...value(), nodes: [], edges: [], sectors: [], source: undefined };
  const html = render(projection);
  assert.match(html, /No infrastructure assets recorded in this analysis/);
  assert.doesNotMatch(html, /data-map-node=|class="idm-edge"/);
});
test('restored detail preserves projection names and record provenance', () => {
  const projection = value();
  projection.nodes[1].name = 'Captured renal facility';
  projection.nodes[1].sourceRefs = ['recorded-source-ref'];
  const html = render(projection);
  assert.match(html, /Captured renal facility/);
  assert.match(html, /not observed outages/);
  assert.match(html, /recorded-source-ref/);
  assert.match(html, /Recorded path: Potable water/);
});

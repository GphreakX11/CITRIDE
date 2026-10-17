import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
const src = new URL('../src/', import.meta.url);
const cache = new Map();
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (await transformWithOxc(readFileSync(url, 'utf8'), url.pathname, { jsx: { runtime: 'automatic' } })).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, '');
  const imports = new Map();
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    let target;
    if (m[1].startsWith('.')) {
      let next = new URL(m[1], url);
      if (!existsSync(next)) next = new URL(`${m[1]}.ts`, url);
      target = await compile(next);
    } else target = import.meta.resolve(m[1]);
    imports.set(m[1], target);
  }
  code = code.replace(/from\s+["']([^"']+)["']/g, (_, s) => `from ${JSON.stringify(imports.get(s))}`);
  const result = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  cache.set(url.href, result);
  return result;
}
const { default: Command } = await import(await compile(new URL('CommandCenterViews.tsx', src)));
const data = JSON.parse(readFileSync(new URL('../../data/scenario.json', import.meta.url)));
const reference = JSON.parse(readFileSync(new URL('../../data/reference.json', import.meta.url)));
function fixture() {
  const run = { seed: data.scenarios.find(s => s.id === 'unsafe-water').seed, id: 'presentation-run', createdAt: '2026-10-13T08:00:00Z', scenarioId: 'unsafe-water', baselineRevision: data.baselineRevision, modelVersion: data.modelVersion, baselineSnapshot: structuredClone(data), request: { scenarioId: 'unsafe-water', evaluationHour: 1, horizonHours: 12, overrides: [] }, impacts: [{ id: 'presentation-impact', entityId: 'dialysis-x', functionId: 'dialysis-treatment', state: 'at_risk', windowHours: [2,4], lossOfFunction: 1, paths: [['dep-a-x']], sourceRefs: [], assumptions: [] }], excluded: [], warnings: [] };
  const selected = { id: 'case-planning', title: 'Planning presentation', status: 'open', priority: 'high', version: 1, createdAt: run.createdAt, updatedAt: run.createdAt, eventId: data.events[0].id, eventSnapshot: data.events[0], contextSnapshot: { provider: data.entities.find(e=>e.id==='utility-a'), serviceArea: data.entities.find(e=>e.id==='area-a'), warnings: [], sourceRefs: [], scenarios: [] }, runId: run.id, runSnapshot: run, decisions: [], tasks: [], notes: [], activity: [] };
  const lastPlanningRun = structuredClone(run);
  lastPlanningRun.id = 'presentation-what-if';
  lastPlanningRun.request.overrides = [{ dependencyId: 'dep-a-x', backupMinHours: 6, backupMaxHours: 6, note: `What-if from case ${selected.title}` }];
  lastPlanningRun.impacts[0].windowHours = [6,8];
  return { data, reference, incidents: [selected], selected, lastPlanningRun, view: 'consequence', onSelect(){}, onOpenAnalyst(){}, onNavigate(){} };
}
const render = p => renderToStaticMarkup(createElement(Command,p));
test('C4 renders matching what-if as a green modeled-consequence tile without changing inputs',()=>{
 const p=fixture(), before=JSON.stringify(p);
 freeze(p);
 const out=render(p);
 assert.match(out,/cc-metric-green/);
 assert.match(out,/Modeled consequence avoided/);
 assert.match(out,/4–4 service-hours/);
 assert.match(out,/not observed savings/);
 assert.equal(JSON.stringify(p),before);
});
test('C4 never displays consequence avoided for a different baseline, case or scenario',()=>{
 for(const edit of [p=>p.lastPlanningRun.baselineRevision++, p=>p.lastPlanningRun.request.overrides[0].note='What-if from case unrelated', p=>p.lastPlanningRun.scenarioId='power-loss']) {
  const p=fixture(); edit(p);
  assert.doesNotMatch(render(p),/Modeled consequence avoided/);
 }
});
test('Command workspace supplies case-scoped planning state to its command display',()=>{
 const text=readFileSync(new URL('CommandWorkspace.tsx',src),'utf8');
 const command=text.match(/<CommandCenterViews[\s\S]*?\/>/)?.[0];
 assert.match(command,/lastPlanningRun=\{\s*lastPlanningCaseId === selectedId \? lastPlanningRun : null\s*\}/);
});

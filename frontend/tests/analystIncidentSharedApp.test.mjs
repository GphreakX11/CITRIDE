import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { AnalystIncidentProvider, useAnalystIncident } from '../src/analystIncidentContext.ts';
import { resolveAnalystIncidentSelection } from '../src/analystIncidentShared.ts';

const moduleData = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const hooksUrl = moduleData(`
let values=[],cursor=0; export let effects=[];
export function clear(){values=[];cursor=0;effects=[]}
export function reset(){cursor=0;effects=[]}
export function setValue(i,v){values[i]=v}
export function useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],v=>values[i]=typeof v==='function'?v(values[i]):v]}
export function useRef(initial){const i=cursor++;return values[i]??(values[i]={current:initial})}
export function useEffect(fn){effects.push(fn)}
`);
const hooks = await import(hooksUrl);
const appFile = new URL('../src/App.tsx', import.meta.url);
let code = (await transformWithOxc(readFileSync(appFile, 'utf8'), appFile.pathname, { jsx: { runtime: 'automatic' } })).code;
code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, '');
code = code.replace(/from\s+["']([^"']+)["']/g, (_match, spec) => {
  let target;
  if (spec === 'react') target = hooksUrl;
  else if (spec.startsWith('.') && /[A-Z]/.test(spec[2])) {
    const name = spec.slice(2).replace(/\.tsx$/, '');
    target = moduleData(`function ${name}(){return null};export default ${name};export {${name} as CaseCreateForm,${name} as ConfirmDialog,${name} as LateTasks};`);
  } else if (spec.startsWith('.')) target = new URL(spec.endsWith('.ts') ? spec : spec + '.ts', appFile).href;
  else target = import.meta.resolve(spec);
  return `from ${JSON.stringify(target)}`;
});
const App = (await import(moduleData(code))).default;
const data = JSON.parse(readFileSync(new URL('../../data/scenario.json', import.meta.url), 'utf8'));
const records = {
  statewideIncidents: [
    { id: 'alpha', status: 'open', severity: 'critical', linkedEventIds: ['alpha-event'] },
    { id: 'beta', status: 'open', severity: 'high', linkedEventIds: ['beta-event'] },
  ],
  featuredIncidentId: 'beta', sampleDataAnchor: '2031-06-17T12:00:00Z', operationsTimeZone: 'America/Chicago',
};
const cases = [
  { id: 'older', status: 'open', eventId: 'alpha-event', createdAt: '2031-06-17T10:00:00Z', decisions: [] },
  { id: 'newer', status: 'open', eventId: 'alpha-event', createdAt: '2031-06-17T11:00:00Z', decisions: [] },
];
function nodes(x) {
  if (Array.isArray(x)) return x.flatMap(nodes);
  return isValidElement(x) ? [x, ...nodes(x.props.children)] : [];
}
const component = (tree, name) => nodes(tree).find(n => n.type?.name === name);
function setup(query, initialCases = []) {
  hooks.clear();
  const listeners = new Map();
  const location = { href: `http://local.invalid/${query}` };
  let history = [location.href], index = 0;
  globalThis.window = {
    location, scrollTo() {},
    addEventListener(type, fn) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) ?? []) fn(event); return true; },
    history: {
      replaceState(_s, _t, url) { location.href = new URL(url, location.href).href; history[index] = location.href; },
      pushState(_s, _t, url) { location.href = new URL(url, location.href).href; history = history.slice(0, ++index); history.push(location.href); },
      back() { if (index > 0) { location.href = history[--index]; window.dispatchEvent(new Event('popstate')); } },
      forward() { if (index < history.length - 1) { location.href = history[++index]; window.dispatchEvent(new Event('popstate')); } },
    },
  };
  globalThis.localStorage = { getItem() { return null; } };
  let dispose;
  const render = () => {
    hooks.reset();
    const tree = App();
    // Execute real routing effects; isolate unrelated startup I/O in this App host.
    dispose?.();
    hooks.effects[0]();
    dispose = hooks.effects[1]();
    return tree;
  };
  render(); hooks.setValue(0, data);
  let tree = render();
  component(tree, 'CommandWorkspace').props.onCasesLoaded(initialCases, records);
  return { render, hydrate(saved) { component(render(), 'CommandWorkspace').props.onCasesLoaded(saved, records); return render(); } };
}
function selection(tree) { return component(tree, 'AnalystIncidentProvider').props.selection; }
function switchMode(tree, label) {
  const nav = nodes(tree).find(n => n.props['aria-label'] === 'Workspace mode');
  nodes(nav).find(n => n.type === 'button' && n.props.children === label).props.onClick();
}

test('actual App reaches no-case Analyst workspace and provider on every Analyst route', () => {
  for (const view of ['command', 'cop', 'cyber', 'consequence', 'coordination', 'uctf', 'case-file', 'entity-profile']) {
    const host = setup(`?mode=analyst&view=${view}`), tree = host.render();
    assert.equal(selection(tree).selectedIncidentId, 'beta', view);
    assert.equal(selection(tree).activeCase, null, view);
    assert.equal(component(tree, 'CommandWorkspace').props.selectedId, null, view);
    assert.equal(component(tree, 'CommandWorkspace').props.mode, 'analyst', view);
    assert.equal(new URL(window.location.href).searchParams.get('incidentId'), 'beta', view);
  }
});
test('actual App chooses latest open case, preserves explicit matching case, and changes incident atomically', () => {
  const host = setup('?mode=analyst&view=cop&incident=alpha&case=older', cases);
  let tree = host.render();
  assert.equal(selection(tree).activeCase.id, 'older');
  assert.equal(component(tree, 'CommandWorkspace').props.selectedId, 'older');
  component(tree, 'AnalystIncidentProvider').props.selectIncident('beta');
  tree = host.render();
  assert.equal(selection(tree).selectedIncidentId, 'beta');
  assert.equal(selection(tree).activeCase, null);
  assert.equal(component(tree, 'CommandWorkspace').props.selectedId, null);
  component(tree, 'AnalystIncidentProvider').props.selectIncident('alpha');
  tree = host.render();
  assert.equal(selection(tree).activeCase.id, 'newer');
  assert.deepEqual(selection(tree).matchingOpenCases.map(c => c.id), ['newer', 'older']);
});
test('actual App keeps selection across modes and restores incident/case via Back and Forward', () => {
  const host = setup('?mode=analyst&view=consequence');
  let tree = host.hydrate(cases);
  component(tree, 'AnalystIncidentProvider').props.selectIncident('alpha'); tree = host.render();
  switchMode(tree, 'Command Center'); tree = host.render();
  assert.equal(component(tree, 'CommandWorkspace').props.mode, 'command');
  assert.equal(new URL(window.location.href).searchParams.get('incidentId'), 'alpha');
  switchMode(tree, 'Analyst'); tree = host.render();
  assert.equal(selection(tree).selectedIncidentId, 'alpha');
  assert.equal(selection(tree).activeCase.id, 'newer');
  window.history.back(); host.render();
  window.history.back(); host.render();
  window.history.back(); tree = host.render();
  assert.equal(selection(tree).selectedIncidentId, 'beta');
  assert.equal(selection(tree).activeCase, null);
  window.history.forward(); tree = host.render();
  assert.equal(selection(tree).selectedIncidentId, 'alpha');
  assert.equal(selection(tree).activeCase.id, 'newer');
});
test('actual App menu entry without URL selection applies featured fallback immediately', () => {
  const host = setup('?mode=command&view=command');
  let tree = host.render();
  switchMode(tree, 'Analyst'); tree = host.render();
  assert.equal(selection(tree).selectedIncidentId, 'beta');
  assert.equal(new URL(window.location.href).searchParams.get('incidentId'), 'beta');
  assert.equal(component(tree, 'CommandWorkspace').props.selectedId, null);
});
test('public React provider exposes actual records/main store, no synthetic case, and shared clock', () => {
  let value;
  function Consumer() { value = useAnalystIncident(); return createElement('span', null, value.selectedIncidentId); }
  const markup = renderToStaticMarkup(createElement(AnalystIncidentProvider, {
    selection: resolveAnalystIncidentSelection(records, [], data, '/'), records, mainStore: data,
    reference: null, telemetry: null, cases: [], selectIncident() {}, selectCase() {}, locked: false, enabled: false,
  }, createElement(Consumer)));
  assert.equal(markup, '<span>beta</span>');
  assert.equal(value.records, records); assert.equal(value.mainStore, data);
  assert.equal(value.activeCase, null); assert.equal(value.projection, null);
  assert.equal(value.eventTimestamp({ relativeTimeHours: -2 / 3 }), '2031-06-17T11:20:00.000Z');
  function Standalone() { assert.equal(useAnalystIncident(), null); return null; }
  renderToStaticMarkup(createElement(Standalone));
});

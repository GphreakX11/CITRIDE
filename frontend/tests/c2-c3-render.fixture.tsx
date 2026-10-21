// Deterministic synthetic rendering fixture; never contacts an application backend.
import { createRoot } from 'react-dom/client';
import ScriptedCommandViews from '../src/ScriptedCommandViews.tsx';
import Graph from '../src/Graph.tsx';
import { writeConsequenceSelection } from '../src/consequenceSelection.ts';
import data from '../../data/scenario.json';
import supplied from '../../data/scripted/watershed_beta.json';
import reference from '../../data/reference.json';
import '../src/styles.css';
import '../src/command-center-views.css';
import '../src/shared-components.css';
import '../src/visual-shell.css';
import '../src/theme.css';

const now = '2026-10-13T08:30:00Z';
const records = { ...supplied, now, statewideIncidents: supplied.incidents.map(row => ({ ...row, status: 'open', startedAt: now })) };
const pending: { id: string; resolve: (value: Response) => void }[] = [];
window.fetch = ((path: string) => new Promise<Response>(resolve => {
  if (!path.startsWith('/v1/command/consequences?')) throw new Error(`Unexpected fixture request: ${path}`);
  pending.push({ id: new URL(path, location.href).searchParams.get('incidentId')!, resolve });
})) as typeof fetch;
const root = createRoot(document.getElementById('root')!);
let view = 'cop';
let graphSelected: string | null = null;
const navigation: unknown[] = [];
function render(next = view) {
  view = next;
  if (view === 'graph') {
    root.render(<Graph data={data as any} selectedId={graphSelected} onSelect={id => { graphSelected = id; render('graph'); }} />);
    return;
  }
  root.render(<ScriptedCommandViews {...{ data, records, reference, incidents: [], selected: null, view,
    onSelect: (id: string) => navigation.push({ caseId: id }), onOpenAnalyst: () => {},
    onNavigate: (next: string) => { navigation.push({ view: next }); if (next === 'cop' || next === 'cyber') render(next); }
  } as any} />);
}
function projection(id: string) {
  return { now, incident: { id, title: id }, incidents: records.statewideIncidents, analysis: { kind: 'fixture', createdAt: now, modelVersion: 'fixture', seed: { lossType: 'unsafe_water' } },
    source: { id: 'utility-a', name: `Fixture source ${id}`, type: 'WaterUtility' },
    nodes: [{ id: 'utility-a', name: `Fixture source ${id}`, type: 'WaterUtility', sector: 'Water', source: true, windowHours: null, paths: [], reserves: [], sourceRefs: [] },
      { id: 'dialysis-x', name: 'Fixture renal care', type: 'Hospital', sector: 'Healthcare', windowHours: [2,4], paths: [['fixture-edge']], reserves: [], sourceRefs: [] }],
    edges: [{ id: 'fixture-edge', from: 'utility-a', to: 'dialysis-x', label: 'Potable water' }],
    sectors: [{ label: 'Healthcare', nodes: ['dialysis-x'], windowHours: [2,4], source: false, atRisk: 1, order: 1 }],
    sectorViews: [{ sectors: [{ sector: 'Healthcare', items: [{ entityId: 'dialysis-x', label: 'Fixture renal care' }] }] }],
    sectorLinks: [{ id: 'fixture-sector-link', from: 'utility-a', fromKind: 'source', to: 'Healthcare', service: 'Potable water', step: 1, windowHours: [2,4], dependencyIds: ['fixture-edge'] }] };
}
(window as any).fixture = {
  render,
  choose(id: string) { writeConsequenceSelection({ incidentId: id, sector: 'all', entityId: null }); },
  requests: () => pending.map(item => item.id),
  settle(id: string, kind = 'valid', responseId = id) {
    const index = pending.findIndex(item => item.id === id);
    if (index < 0) throw new Error(`No pending request for ${id}`);
    const [request] = pending.splice(index, 1);
    const value = projection(responseId);
    request.resolve(new Response(JSON.stringify(kind === 'error' ? { detail: 'Fixture analysis unavailable' } : { ...value, analysis: kind === 'empty' ? null : value.analysis }), { status: kind === 'error' ? 503 : 200, headers: { 'Content-Type': 'application/json' } }));
  },
  navigation
};
render();

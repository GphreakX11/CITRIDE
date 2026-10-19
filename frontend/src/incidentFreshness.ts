// Keep the read-only projection aligned with backend/citride/incident_freshness.py.
type Row = Record<string, unknown> & { id: string };
type Model = Record<string, unknown>;
const collections = ['entities', 'events', 'scenarios', 'dependencies', 'serviceFunctions', 'sources', 'assumptions'];
const links = ['seenOn', 'hostedBy', 'partOf', 'serves', 'locatedIn', 'provider', 'dependent', 'dependentFunction', 'sourceRefs', 'assumptionRefs', 'eventRefs'];
function record(value: unknown): value is Model {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function incidentInputs(input: unknown, eventId: string): Model {
  const model = record(input) ? input : {};
  const rows = Object.fromEntries(collections.map(key => [key, (Array.isArray(model[key]) ? model[key] : []) as Row[]]));
  const selected = new Set<unknown>([eventId]);
  for (const row of rows.scenarios) {
    const seed = record(row.seed) ? row.seed : {};
    if (Array.isArray(seed.eventRefs) && seed.eventRefs.includes(eventId)) selected.add(row.id);
  }
  function refs(row: Model) {
    for (const key of links) {
      const value = row[key];
      for (const ref of Array.isArray(value) ? value : value === undefined ? [] : [value]) selected.add(ref);
    }
    if (record(row.parameterAssertionRefs)) for (const ref of Object.values(row.parameterAssertionRefs)) selected.add(ref);
    if (record(row.seed)) refs(row.seed);
  }
  let previous = -1;
  while (previous !== selected.size) {
    previous = selected.size;
    for (const [key, records] of Object.entries(rows)) for (const row of records) {
      if (key === 'dependencies' && selected.has(row.provider)) selected.add(row.id);
      if (selected.has(row.id)) refs(row);
    }
  }
  const result: Model = Object.fromEntries(Object.entries(rows).map(([key, records]) => [key, records.filter(r => selected.has(r.id)).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)]));
  for (const key of ['defaultEvaluationHour', 'defaultHorizonHours']) if (key in model) result[key] = model[key];
  return result;
}
export function capturedIncidentIsStale(run: unknown, current: unknown, eventId: string): boolean {
  if (!record(run) || !record(current)) return true;
  if (!record(run.baselineSnapshot)) return run.baselineRevision !== current.baselineRevision;
  return canonical(incidentInputs(run.baselineSnapshot,eventId)) !== canonical(incidentInputs(current,eventId));
}
export function contextIsStale(context: unknown, current: unknown, eventId: string): boolean {
  if (!record(context) || !record(current)) return false;
  if (!record(context.freshnessInputs)) return context.baselineRevision !== current.baselineRevision;
  return canonical(context.freshnessInputs) !== canonical(incidentInputs(current,eventId));
}
export function snapshotFreshnessLabel(run: unknown, current: unknown, eventId: string): string {
  return capturedIncidentIsStale(run,current,eventId)
    ? ' · Historical snapshot; incident inputs have changed'
    : ' · Captured baseline snapshot';
}

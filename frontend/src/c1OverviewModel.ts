import type { CommandIncident } from './commandTypes.ts';
import type { Entity, Run } from './types.ts';
import type { RecordItem, ScriptedViewProps } from './scriptedTypes.ts';
import { list, object, text } from './scriptedTypes.ts';
import { elapsedMinutes, recordTime } from './scriptedCommandModel.ts';
import { boilWaterLabel, statewideFootprint, type StatewideFootprintModel } from './statewideFootprint.ts';

export type CaseFootprint = StatewideFootprintModel['layers'][number];
export type ModeledFacility = CaseFootprint['facilities'][number];
export interface C1Incident {
  record: RecordItem;
  incident: CommandIncident | null;
  footprint: CaseFootprint | null;
  cascading: boolean;
  elapsed: number | null;
  sectors: string[];
  latestUpdate: RecordItem | null;
}
export interface C1Decision {
  record: RecordItem;
  row: C1Incident;
  window: [number, number] | null;
  windowLabel: string;
}
export interface C1Update {
  record: RecordItem;
  incidentId: string | null;
  time: string;
  text: string;
}
export interface C1OverviewModel {
  rows: C1Incident[];
  totals: {
    active: number;
    investigating: number;
    people: number | null;
    probedPeople: number | null;
    earliest: { window: [number, number]; facilityLabel: string; row: C1Incident } | null;
    decisions: number;
  };
  decisions: C1Decision[];
  facilities: { row: C1Incident; items: ModeledFacility[]; boilWater: string }[];
  updates: C1Update[];
  mostPeople: C1Incident | null;
  recordsAsOf: string;
  footprintModel: StatewideFootprintModel;
}
export interface C1CascadeContext { status?: string }
const refs = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && !!x);
const windowPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0) && v[0] <= v[1];
const entitiesOf = (run: Run | null): Entity[] => list(object(run?.baselineSnapshot).entities) as unknown as Entity[];

/** Source hosting/containment is not a propagated effect, even when it has a window. */
function sourceAssets(incident: CommandIncident): Set<string> {
  const run = incident.runSnapshot;
  const entities = entitiesOf(run);
  const context = incident.contextSnapshot;
  const source = new Set<string>([run?.seed?.provider, text(incident.eventSnapshot?.seenOn), text(incident.eventSnapshot?.entityId), context?.cyberAsset?.id, context?.physicalAsset?.id, context?.facility?.id, context?.provider?.id].filter((id): id is string => !!id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const entity of entities) {
      // Membership only: never follow dependencies, service areas or a shared operator.
      const parents = [...refs(entity.partOf), ...refs(entity.hostedBy)];
      const children = refs(entity.hostsCyberAsset);
      if (source.has(entity.id)) {
        for (const id of [...parents, ...children]) if (!source.has(id)) { source.add(id); changed = true; }
      } else if (parents.some(id => source.has(id)) || children.some(id => source.has(id))) {
        source.add(entity.id); changed = true;
      }
    }
  }
  return source;
}
function atRiskFacilities(incident: CommandIncident): ModeledFacility[] {
  const run = incident.runSnapshot;
  if (!run) return [];
  const entities = entitiesOf(run), source = sourceAssets(incident);
  return (run.impacts ?? []).flatMap(impact => {
    const entity = entities.find(e => e.id === impact.entityId);
    if (!entity || source.has(entity.id) || !windowPair(impact.windowHours) || !['at_risk', 'degraded', 'failed'].includes(impact.state) || !(impact.lossOfFunction > 0)) return [];
    return [{ id: entity.id, label: entity.label, functionId: impact.functionId, state: impact.state, windowHours: [...impact.windowHours] as [number, number], coordinates: null }];
  }).sort((a, b) => a.windowHours[0] - b.windowHours[0] || a.windowHours[1] - b.windowHours[1] || a.id.localeCompare(b.id));
}
/** Only the latest captured run can assert spreading harm; severity is independent. */
export function hasCascadingImpact(incident: CommandIncident | null, context?: C1CascadeContext): boolean {
  return !!incident && !['closed', 'recovering'].includes(context?.status ?? incident.status) && atRiskFacilities(incident).length > 0;
}
const pending = (record: RecordItem) => ['pending', 'not_decided', 'undecided', 'waiting', 'waiting_on_chief'].includes(text(record.decision, text(record.status, 'pending')));
const linked = (record: RecordItem, row: C1Incident) => record.incidentId === row.record.id || (!!row.incident && (record.incidentId === row.incident.id || record.caseId === row.incident.id));
const timestamp = (value: string | undefined) => { const n = Date.parse(value ?? ''); return Number.isFinite(n) ? n : -Infinity; };

/** Captured population evidence keyed by service area, not by incident or provider. */
function population(run: Run, providerId: string): Map<string, number | null> {
  const entities = entitiesOf(run), provider = entities.find(e => e.id === providerId);
  const result = new Map<string, number | null>();
  for (const id of new Set(refs(provider?.serves))) {
    const area = entities.find(e => e.id === id), direct = object(area).peopleServed;
    const groups = entities.filter(e => e.type === 'PopulationGroup' && refs(e.locatedIn).includes(id));
    const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    const count = valid(direct) ? direct : groups.length && groups.every(e => refs(e.locatedIn).length === 1 && valid(object(e).count)) ? groups.reduce((sum, e) => sum + (object(e).count as number), 0) : null;
    result.set(id, count);
  }
  if (!result.size) result.set(`provider:${providerId}`, null);
  return result;
}
function mergePopulation(target: Map<string, number | null>, source: Map<string, number | null>) {
  for (const [id, count] of source) target.set(id, target.has(id) && target.get(id) !== count ? null : count);
}
const sumPopulation = (counts: Map<string, number | null>): number | null => [...counts.values()].some(n => n === null) ? null : [...counts.values()].reduce<number>((sum, n) => sum + n!, 0);

export function c1OverviewModel(props: ScriptedViewProps): C1OverviewModel {
  // Reference hydration may be partial; absent options never imply a decision.
  props = { ...props, records: { ...props.records, decisions: props.records.decisions ?? [] }, reference: { ...props.reference, responseOptions: props.reference.responseOptions ?? [], optionTimingLabels: props.reference.optionTimingLabels ?? {}, boilWaterRules: props.reference.boilWaterRules ?? [] } };
  // Deliberately ignore selection, including for ambiguous event associations.
  const footprintModel = statewideFootprint({ ...props, selected: null, onOpenAnalyst() {} });
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const start = (r: RecordItem) => r.startedAt ?? recordTime({ relativeTimeHours: r.startedRelativeHours }, props.data, null);
  const rows: C1Incident[] = footprintModel.rows.filter(r => r.status !== 'closed').sort((a, b) => (rank[a.severity ?? ''] ?? 4) - (rank[b.severity ?? ''] ?? 4) || (timestamp(start(b)) - timestamp(start(a)) || 0) || a.id.localeCompare(b.id)).map(record => {
    const incident = props.incidents.find(i => i.id === record.caseId) ?? null;
    const footprint = footprintModel.layers.find(l => l.caseId === incident?.id) ?? null;
    const sectorCodes = entitiesOf(incident?.runSnapshot ?? null).filter(e => e.id === incident?.runSnapshot?.seed.provider || atRiskFacilities(incident!).some(f => f.id === e.id)).flatMap(e => { const idt = object(object(e).idt); const path = text(idt.status === 'below_idt_level' ? idt.parentPath : idt.path); return /^\d+(?:\.\d+)*$/.test(path) ? [path.split('.')[0]!] : []; });
    return { record, incident, footprint, cascading: hasCascadingImpact(incident, { status: record.status }), elapsed: elapsedMinutes(start(record), props.records.storyNow), sectors: [...new Set([...(record.sectors ?? []), ...sectorCodes])], latestUpdate: null };
  });
  const allUpdates: C1Update[] = [];
  for (const row of rows) {
    for (const [index, update] of (row.record.updates ?? []).entries()) {
      const at = recordTime(update, props.data, row.incident);
      const record: RecordItem = { ...update, id: `${row.record.id}:update:${index}`, incidentId: row.record.id, at };
      allUpdates.push({ record, incidentId: row.record.id, time: at ?? '', text: update.text });
    }
    for (const activity of row.incident?.activity ?? []) allUpdates.push({ record: { ...activity, at: activity.createdAt, text: activity.message, incidentId: row.record.id }, incidentId: row.record.id, time: activity.createdAt, text: activity.message });
  }
  allUpdates.sort((a, b) => (timestamp(b.time) - timestamp(a.time) || 0) || a.record.id.localeCompare(b.record.id));
  for (const row of rows) row.latestUpdate = allUpdates.find(u => u.incidentId === row.record.id)?.record ?? null;
  const decisions: C1Decision[] = [];
  for (const row of rows) {
    const run = row.incident?.runSnapshot ?? null;
    const eventIds = new Set([...(row.record.linkedEventIds ?? []), ...(row.incident ? [row.incident.eventId] : [])]);
    const observations = new Set([...props.data.events.filter(e => eventIds.has(e.id)), ...(row.incident ? [row.incident.eventSnapshot] : [])].map(e => text(e?.observation)));
    const records = props.records.decisions.filter(d => linked(d, row));
    const candidates = new Map<string, RecordItem>();
    for (const option of props.reference.responseOptions) if (option.triggers?.eventObservations.some(o => observations.has(o)) || option.triggers?.impactFunctions.some(f => run?.impacts.some(i => i.functionId === f && i.lossOfFunction > 0))) candidates.set(option.id, option);
    // Explicit source-linked requests also work for record-only incidents.
    for (const record of records) candidates.set(record.optionId ?? record.id, props.reference.responseOptions.find(o => o.id === record.optionId) ?? record);
    for (const [id, record] of candidates) {
      const history = records.filter(d => (d.optionId ?? d.id) === id).sort((a, b) => (timestamp(a.at) - timestamp(b.at) || 0));
      if (history.length && !pending(history.at(-1)!)) continue;
      const window = (row.incident ? atRiskFacilities(row.incident) : []).filter(f => record.triggers?.impactFunctions.includes(f.functionId) || record.functionId === f.functionId).map(f => f.windowHours).find(windowPair) ?? (windowPair(record.windowHours) ? record.windowHours : null);
      decisions.push({ record, row, window, windowLabel: window ? `Beat ${window[0]}–${window[1]} h` : text(record.windowLabel, props.reference.optionTimingLabels[record.id] ?? 'Timing unknown') });
    }
  }
  const facilities = rows.flatMap(row => {
    const items = row.incident ? atRiskFacilities(row.incident) : [];
    return items.length ? [{ row, items, boilWater: boilWaterLabel(row.incident!.runSnapshot, entitiesOf(row.incident!.runSnapshot), props.reference) ?? '' }] : [];
  });
  const earliest = facilities.flatMap(group => group.items.flatMap(item => item.windowHours ? [{ window: item.windowHours, facilityLabel: item.label, row: group.row }] : [])).sort((a, b) => a.window[0] - b.window[0] || a.window[1] - b.window[1])[0] ?? null;
  const affected = new Map<string, number | null>(), probed = new Map<string, number | null>();
  let modeled = false, mostPeople: C1Incident | null = null, maximum = -1;
  for (const row of rows) {
    const run = row.incident?.runSnapshot;
    if (!run) continue;
    modeled = true;
    if (run.seed?.lossType === 'unsafe_water') {
      const counts = population(run, run.seed.provider);
      mergePopulation(affected, counts);
      const people = sumPopulation(counts);
      if (people !== null && people > maximum) { maximum = people; mostPeople = row; }
    }
    for (const utility of row.footprint?.probed ?? []) mergePopulation(probed, population(run, utility.id));
  }
  // A service area already affected is not counted again as "more on probed".
  for (const id of affected.keys()) probed.delete(id);
  return { rows, totals: { active: rows.length, investigating: rows.filter(r => ['open', 'under_investigation'].includes(r.record.status ?? '')).length, people: modeled ? sumPopulation(affected) : null, probedPeople: modeled ? sumPopulation(probed) : null, earliest, decisions: decisions.length }, decisions, facilities, updates: allUpdates.slice(0, 3), mostPeople, recordsAsOf: props.records.storyNow, footprintModel };
}

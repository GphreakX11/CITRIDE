import type { C1Incident, C1OverviewModel } from './c1OverviewModel.ts';
import type { CommandView } from './commandTypes.ts';
import type { RecordItem, RecordsState } from './scriptedTypes.ts';
import { displayTimeZone } from './displayTime.ts';

export interface PriorityItem {
  row: C1Incident;
  reason: string;
  evidence: string;
  owner: string;
  timing: string;
  view: CommandView;
  entityId?: string;
}
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const closed = (status: unknown) => ['closed', 'resolved'].includes(clean(status).toLowerCase());
const stamp = (value: unknown) => Date.parse(clean(value));
const pending = (record: RecordItem) => ['pending', 'not_decided', 'undecided', 'waiting', 'waiting_on_chief'].includes(clean(record.decision ?? record.status));
const validWindow = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) && value[1] >= value[0];
const severity: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const label = (record: RecordItem) => clean(record.title) || clean(record.label) || record.id;
const owner = (record: RecordItem | undefined, records: RecordsState) => {
  if (!record) return '';
  const teamId = clean(record.ownerTeamId);
  const team = records.teams?.find(t => t.id === teamId);
  return clean(record.ownerRole) || clean(record.lead) || (teamId ? clean(team?.name) || clean(team?.label) || teamId : '');
};
const timingLabel = (value: unknown) => new Intl.DateTimeFormat('en-US', { timeZone: displayTimeZone(), month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(clean(value)));
const recordedTiming = (record: RecordItem | undefined) => {
  if (!record) return '';
  if (Number.isFinite(stamp(record.dueAt))) return `Recorded due: ${timingLabel(record.dueAt)}`;
  if (validWindow(record.windowHours)) return `Recorded planning window: ${record.windowHours[0]}–${record.windowHours[1]} h (not a deadline)`;
  if (Number.isFinite(stamp(record.startedAt))) return `Recorded start: ${timingLabel(record.startedAt)}`;
  return '';
};

/** Read-only triage of existing evidence, not a dispatch order or a new risk score.
 * Reference options are suggestions, not saved requests. Never borrow their owner
 * or timing defaults. One entry per incident; unknown measurements stay unknown.
 */
export function priorityQueue(model: C1OverviewModel, records: RecordsState): { items: PriorityItem[]; remaining: number; total: number } {
  const ranked = model.rows.filter(row => !closed(row.record.status) && !closed(row.incident?.status)).map(row => {
    const linked = (record: RecordItem) => record.incidentId === row.record.id || (!!row.incident && (record.incidentId === row.incident.id || record.caseId === row.incident.id));
    const history = new Map<string, RecordItem>();
    for (const record of (records.decisions ?? []).filter(linked)) {
      const key = record.optionId ?? record.id, previous = history.get(key);
      if (!previous || (Number.isFinite(stamp(record.at)) ? stamp(record.at) : -Infinity) >= (Number.isFinite(stamp(previous.at)) ? stamp(previous.at) : -Infinity)) history.set(key, record);
    }
    for (const proposal of (records.pendingDecisions ?? []).filter(linked)) {
      const key=proposal.optionId ?? proposal.id;
      if (!history.has(key)) {
        const resolved=model.decisions.find(d => d.row.record.id === row.record.id && (d.record.optionId ?? d.record.id) === key);
        if (resolved) history.set(key,{...resolved.record,...proposal,title:resolved.record.title ?? resolved.record.label,dueAt: typeof resolved.remainingMinutes === 'number' ? new Date(Date.parse(records.now) + resolved.remainingMinutes*60000).toISOString() : proposal.dueAt});
      }
    }
    const requests = [...history.values()].filter(pending).sort((a, b) => (Number.isFinite(stamp(a.dueAt)) ? stamp(a.dueAt) : Infinity) - (Number.isFinite(stamp(b.dueAt)) ? stamp(b.dueAt) : Infinity) || a.id.localeCompare(b.id));
    const request = requests[0];
    const facility = model.facilities.filter(group => group.row.record.id === row.record.id).flatMap(group => group.items).flatMap(item => validWindow(item.windowHours) ? [{ ...item, windowHours: item.windowHours }] : []).sort((a, b) => a.windowHours[0] - b.windowHours[0] || a.windowHours[1] - b.windowHours[1] || a.id.localeCompare(b.id))[0];
    const suggestion = model.decisions.find(d => d.row.record.id === row.record.id && !history.has(d.record.optionId ?? d.record.id));
    const level = clean(row.record.severity).toLowerCase();
    const item: PriorityItem = {
      row,
      evidence: 'Saved incident record',
      reason: `${level ? level[0].toUpperCase() + level.slice(1) : 'Unknown'} severity · ${row.incident?.runSnapshot ? 'No downstream facility window captured' : 'Not yet modeled'}`,
      owner: owner(request, records) || owner(row.record, records) || 'Owner not recorded',
      timing: recordedTiming(request) || recordedTiming(row.record) || 'Timing not recorded',
      view: 'cop',
    };
    let rank = 3;
    if (request) {
      rank = 0;
      item.evidence = 'Saved decision request';
      item.reason = `Pending request: ${label(request)}`;
      item.view = 'leadership';
    } else if (facility) {
      rank = 1;
      item.evidence = 'Modeled · saved run';
      item.reason = `${facility.label}: downstream facility at risk in captured model`;
      item.timing = `Modeled window: ${facility.windowHours[0]}–${facility.windowHours[1]} h (run-relative, not a deadline)`;
      item.view = 'consequence';
      item.entityId = facility.id;
    } else if (suggestion) {
      rank = 2;
      item.evidence = 'Provisional option';
      item.reason = `Suggested option: ${label(suggestion.record)} · not a saved request`;
      item.view = 'leadership';
    }
    // Scripted records remain explicitly identified as sample evidence.
    if (row.record.origin === 'scripted' || row.record.handling?.includes('SIMULATED')) item.evidence += ' · sample';
    return { item, rank, window: facility?.windowHours[0] ?? Infinity, due: request && Number.isFinite(stamp(request.dueAt)) ? stamp(request.dueAt) : Infinity, severity: severity[level] ?? 4 };
  });
  ranked.sort((a, b) => a.rank - b.rank || (a.rank === 0 ? a.due - b.due : a.rank === 1 ? a.window - b.window : 0) || a.severity - b.severity || a.item.row.record.id.localeCompare(b.item.row.record.id));
  return { items: ranked.slice(0, 3).map(entry => entry.item), remaining: Math.max(0, ranked.length - 3), total: ranked.length };
}

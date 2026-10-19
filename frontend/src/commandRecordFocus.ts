import type { CommandIncident } from './commandTypes.ts';
import type { RecordItem, RecordsState, ReferenceData } from './scriptedTypes.ts';
import { statewideRows, responseClock } from './scriptedCommandModel.ts';

/** URL record focus wins over unrelated saved-case state; missing IDs never fall back. */
export function commandRecordFocus(records: RecordsState, incidents: CommandIncident[], selected: CommandIncident | null, id: string | null) {
 const rows = statewideRows(records, incidents);
 const row = id ? rows.find(row => row.id === id || row.caseId === id) : selected ? rows.find(row => row.caseId === selected.id) : undefined;
 const saved = row?.caseId ? incidents.find(item => item.id === row.caseId) ?? null : !id ? selected : null;
 const ids = new Set([row?.id, row?.caseId, saved?.id].filter((id): id is string => !!id));
 const scope = (items: readonly RecordItem[]) => items.filter(item => (!!item.incidentId && ids.has(item.incidentId)) || (!!item.caseId && ids.has(item.caseId)));
 return { rows, row, selected: saved, scope };
}

export function focusedResponseClock(records: RecordsState, reference: ReferenceData, selected: CommandIncident | null, row?: RecordItem) {
 // Keep case-owned clocks intact, but never use global timing for record-only views.
 const timing = row && typeof row.timing === 'object' && row.timing !== null ? row.timing as Record<string, unknown> : {};
 return responseClock({...records, statewideIncidents: row ? [row] : [], timing: selected ? records.timing : timing}, reference, selected);
}

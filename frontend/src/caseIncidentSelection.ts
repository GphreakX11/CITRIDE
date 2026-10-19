import { consequenceSelectionLocation } from './consequenceSelection.ts';

type SavedCase = { id: string; eventId: string };
type Incident = { id: string; caseId?: string; linkedEventIds?: string[] };

/** Preserve an explicit saved case within its incident, not the first sibling. */
export function caseSelectionForIncident(
  incidentId: string,
  cases: readonly SavedCase[],
  incidents: readonly Incident[],
  selectedCaseId: string | null,
): string | null {
  const incident = incidents.find(row => row.id === incidentId);
  const selected = cases.find(item => item.id === selectedCaseId);
  if (selected && (incident?.caseId === selected.id || incidentId === selected.id ||
      incident?.linkedEventIds?.includes(selected.eventId))) return selected.id;
  // A deliberate incident change or invalid case still uses the incident default.
  const fallback = incident?.caseId ??
    (incident && cases.find(item => incident.linkedEventIds?.includes(item.eventId))?.id) ?? incidentId;
  return cases.find(item => item.id === fallback)?.id ?? null;
}

/** Case selection owns its incident aliases; unrelated URL filters cannot win. */
export function caseSelectionLocation(input:string,record:{id:string;eventId:string}|null,records:readonly {id:string;caseId?:string;linkedEventIds?:string[]}[],entityId:string|null):string {
 const incident=record ? records.find(r=>r.caseId===record.id) ?? records.find(r=>r.linkedEventIds?.includes(record.eventId)) : null;
 const next=consequenceSelectionLocation(input,record ? {incidentId:incident?.id ?? null,sector:'all',entityId} : {entityId});
 const url=new URL(next,'https://prototype.invalid');
 if(record)url.searchParams.set('case',record.id);else url.searchParams.delete('case');
 return `${url.pathname}${url.search}${url.hash}`;
}

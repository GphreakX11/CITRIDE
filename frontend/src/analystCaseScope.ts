import type { CommandIncident } from "./commandTypes.ts";
import type { RecordItem, RecordsState } from "./scriptedTypes.ts";

/** Explicit case linkage wins; event membership also supports additional cases for one incident. */
export function sourceIncidentForCase(
  incident: CommandIncident | null | undefined,
  records: Pick<RecordsState, "statewideIncidents"> | null | undefined,
): RecordItem | null {
  if (!incident) return null;
  return records?.statewideIncidents.find((item) => item.caseId === incident.id)
    ?? records?.statewideIncidents.find((item) => item.linkedEventIds?.includes(incident.eventId))
    ?? null;
}

export function caseRecordScope(
  items: RecordItem[],
  incident: CommandIncident | null | undefined,
  records: Pick<RecordsState, "statewideIncidents"> | null | undefined,
): RecordItem[] {
  if (!incident) return [];
  const source = sourceIncidentForCase(incident, records);
  return items.filter((item) => item.caseId
    ? item.caseId === incident.id
    : item.incidentId === incident.id || (!!source && item.incidentId === source.id));
}

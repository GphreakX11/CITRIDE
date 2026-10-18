import type { Bootstrap } from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";
import type { RecordItem } from "./scriptedTypes.ts";
import { readIncidentFocus, incidentFocusLocation } from "./incidentFocus.ts";
import { idtSectorName } from "./idt.ts";

const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const started = (row: RecordItem, data: Bootstrap): number => {
  const absolute = Date.parse(row.startedAt ?? "");
  if (Number.isFinite(absolute)) return absolute;
  const origin = Date.parse(data.incidentOrigin ?? "");
  return Number.isFinite(origin) && Number.isFinite(row.startedRelativeHours)
    ? origin + row.startedRelativeHours! * 3600000 : -Infinity;
};
export function openIncidentChoices(rows: readonly RecordItem[], data: Bootstrap): RecordItem[] {
  return rows.filter(row => row.status === "open" || row.status === "monitoring").sort((a, b) =>
    (rank[a.severity ?? ""] ?? 4) - (rank[b.severity ?? ""] ?? 4) ||
    (started(b, data) > started(a, data) ? 1 : started(b, data) < started(a, data) ? -1 : 0) || a.id.localeCompare(b.id));
}
const linked = (row: RecordItem, item: CommandIncident) =>
  row.caseId === item.id || row.id === item.id || !!row.linkedEventIds?.includes(item.eventId);
export function initialIncidentChoice(rows: readonly RecordItem[], cases: readonly CommandIncident[], selectedCase: string | null, requested: string | null, data: Bootstrap): string | null {
  const active = openIncidentChoices(rows, data);
  const explicit = active.find(row => row.id === requested);
  if (explicit) return explicit.id;
  const selected = cases.find(item => item.id === selectedCase && item.status !== "closed");
  const selectedRow = selected && active.find(row => linked(row, selected));
  if (selectedRow) return selectedRow.id;
  // The default scenario's event references identify the real saved case, even
  // when its title changes. Never treat an unlinked row as that case.
  const events = data.scenarios.find(item => item.id === data.defaultScenarioId)?.seed.eventRefs ?? [];
  const defaultCases = cases.filter(item => item.status !== "closed" && events.includes(item.eventId));
  return active.find(row => defaultCases.some(item => linked(row, item)))?.id ?? active[0]?.id ?? null;
}
export function readIncidentChoice(url: string): string | null {
  return readIncidentFocus(url);
}
export function incidentChoiceLocation(url: string, id: string): string {
  return incidentFocusLocation(url, id);
}
export function searchIncidentChoices(rows: readonly RecordItem[], query: string, data?: Bootstrap): RecordItem[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(row => {
    const ids = [row.nearEntityId, row.entityId, ...(Array.isArray(row.nearEntityIds) ? row.nearEntityIds : [])];
    const entities = data?.entities.filter(entity => ids.includes(entity.id)) ?? [];
    return [row.id, row.title, row.location?.label, row.location?.region, row.locationLabel, row.summary,
      ...entities.map(entity => entity.label), ...(row.sectors ?? []).flatMap(code => [code, idtSectorName(code.split(".")[0])])]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
  });
}

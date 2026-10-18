import type { Bootstrap } from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";
import type { RecordItem } from "./scriptedTypes.ts";
import { readIncidentFocus, incidentFocusLocation } from "./incidentFocus.ts";
import { idtSectorName } from "./idt.ts";

const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export interface IncidentSelectionRecords {
  statewideIncidents: readonly RecordItem[];
  featuredIncidentId?: string | null;
}
export interface IncidentSelectionConfig {
  url?: string;
  featuredIncidentId?: string | null;
  cases?: readonly CommandIncident[];
  data?: Bootstrap;
}
/** URL focus is intentional (including saved/closed cases); defaults must be open. */
export function defaultIncidentId(records: IncidentSelectionRecords, config: IncidentSelectionConfig = {}): string | null {
  const url = config.url ?? (typeof window === "undefined" ? "/" : window.location.href);
  const explicit = readIncidentFocus(url);
  if (explicit) return explicit;
  const savedId = new URL(url, "https://local.invalid").searchParams.get("case");
  if (savedId) {
    const saved = config.cases?.find(item => item.id === savedId);
    return records.statewideIncidents.find(row => row.caseId === savedId || row.id === savedId)?.id
      ?? (saved && records.statewideIncidents.find(row => !row.caseId && row.linkedEventIds?.includes(saved.eventId))?.id)
      ?? savedId;
  }
  // API and UI defaults share severity then ID ordering. The chooser itself
  // retains its newest-first ordering within a severity for browsing.
  const active = openIncidentChoices(records.statewideIncidents, config.data)
    .filter(row => !row.referenceOnly)
    .sort((a, b) => (rank[a.severity ?? ""] ?? 4) - (rank[b.severity ?? ""] ?? 4) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const featured = config.featuredIncidentId === undefined ? records.featuredIncidentId : config.featuredIncidentId;
  return active.find(row => row.id === featured)?.id ?? active[0]?.id ?? null;
}
const started = (row: RecordItem, data?: Bootstrap): number => {
  const absolute = Date.parse(row.startedAt ?? "");
  if (Number.isFinite(absolute)) return absolute;
  const origin = Date.parse(data?.incidentOrigin ?? "");
  return Number.isFinite(origin) && Number.isFinite(row.startedRelativeHours)
    ? origin + row.startedRelativeHours! * 3600000 : -Infinity;
};
export function openIncidentChoices(rows: readonly RecordItem[], data?: Bootstrap): RecordItem[] {
  return rows.filter(row => ["open", "monitoring", "active", "under_investigation", "containment", "recovering"].includes(row.status ?? "")).sort((a, b) =>
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
  return defaultIncidentId({ statewideIncidents: active }, { data, url: "/" });
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

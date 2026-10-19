import type { Bootstrap, Entity, Event } from "./types.ts";
import type { CommandIncident, IncidentPriority } from "./commandTypes.ts";
import type { RecordsState } from "./scriptedTypes.ts";
import { formatTime, resolveEventTimestamp, type SampleDataTiming } from "./displayTime.ts";

export function openCaseForEvent(
  eventId: string,
  incidents: readonly CommandIncident[],
): CommandIncident | null {
  return (
    incidents.find((c) => c.eventId === eventId && c.status !== "closed") ??
    null
  );
}
export function alertsWithoutCases(
  events: readonly Event[],
  incidents: readonly CommandIncident[],
): Event[] {
  return events
    .filter((e) => !openCaseForEvent(e.id, incidents))
    .sort((a, b) => {
      const at = Date.parse(String(a.timestamp ?? "")),
        bt = Date.parse(String(b.timestamp ?? ""));
      if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
      if (Number.isFinite(at) !== Number.isFinite(bt))
        return Number.isFinite(at) ? -1 : 1;
      return (
        (typeof b.relativeTimeHours === "number"
          ? b.relativeTimeHours
          : -Infinity) -
        (typeof a.relativeTimeHours === "number"
          ? a.relativeTimeHours
          : -Infinity)
      );
    });
}
export function defaultAlertPriority(event: Event): IncidentPriority {
  const explicit = event.anomalous ?? event.isAnomalous;
  if (typeof explicit === "boolean") return explicit ? "high" : "medium";
  return /anomal|unusual|off.?hours|offsite|parameter_change|controller_authentication|quality_drift|probing_only/i.test(
    String(event.observation ?? ""),
  )
    ? "high"
    : "medium";
}
export function campaignCaseLink(
  event: Event,
  incidents: readonly CommandIncident[],
  records?: RecordsState | null,
): string | null {
  // Shared log-source IDs alone are not evidence of a shared attacker or campaign.
  const group = records?.statewideIncidents.find(
    (r) =>
      r.linkedEventIds?.includes(event.id) &&
      incidents.some(
        (c) => c.status !== "closed" && r.linkedEventIds?.includes(c.eventId),
      ),
  );
  return group?.id ?? null;
}
export function alertTime(event: Event, timing?: SampleDataTiming | null): string {
  return formatTime(resolveEventTimestamp(event, timing ?? {}), undefined, "Time unavailable");
}
export function alertTechniques(event: Event): string[] {
  const raw =
    event.attackTechniques ?? event.techniques ?? event.mitreTechniques;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) =>
      typeof t === "string"
        ? t
        : t && typeof t === "object"
          ? [t.id, t.name].filter((v) => typeof v === "string" && v).join(" · ")
          : "",
    )
    .filter(Boolean);
}

/** A single queue: case linkage never changes incident/time priority. */
export function orderedAlerts(
  events: readonly Event[],
  selectedEventIds: ReadonlySet<string> = new Set(),
  eventTimestamp: (event: Event) => string | undefined = event => resolveEventTimestamp(event, {}),
): Event[] {
  const time = (event: Event) => {
    const value = Date.parse(eventTimestamp(event) ?? "");
    return Number.isFinite(value) ? value : -Infinity;
  };
  return [...events].sort((a, b) =>
    Number(selectedEventIds.has(b.id)) - Number(selectedEventIds.has(a.id)) ||
    (time(b) - time(a) || 0),
  );
}

const parentIds = (value: unknown): string[] => typeof value === "string" ? [value]
  : Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

/** Match inventory type families, never customer names or IDs. */
const isSite = (entity: Entity) => /facility|site|plant|terminal|provider|refinery|station|building|campus/i.test(entity.type);
export function alertLocation(event: Event, data: Pick<Bootstrap, "entities">): string {
  const index = new Map(data.entities.map(entity => [entity.id, entity]));
  const queue = parentIds(event.seenOn);
  const seen = new Set<string>();
  let assetLabel: string | undefined;
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const entity = index.get(id);
    if (!entity) continue;
    const label = entity.label?.trim();
    if (!assetLabel && label) assetLabel = label;
    if (label && isSite(entity)) {
      // Add one useful ancestor site/provider to the nearest facility label.
      const parents = [...parentIds(entity.hostedBy), ...parentIds(entity.partOf)];
      const ancestors = new Set([entity.id]);
      while (parents.length) {
        const parentId = parents.shift()!;
        if (ancestors.has(parentId)) continue;
        ancestors.add(parentId);
        const parent = index.get(parentId);
        if (!parent) continue;
        const parentLabel = parent.label?.trim();
        if (parentLabel && isSite(parent) && parentLabel !== label)
          return `${parentLabel} · ${label}`;
        parents.push(...parentIds(parent.hostedBy), ...parentIds(parent.partOf));
      }
      return label;
    }
    queue.push(...parentIds(entity.hostedBy), ...parentIds(entity.partOf));
  }
  return assetLabel ?? "Location not recorded";
}

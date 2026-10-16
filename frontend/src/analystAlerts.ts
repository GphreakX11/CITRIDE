import type { Event } from "./types.ts";
import type { CommandIncident, IncidentPriority } from "./commandTypes.ts";
import type { RecordsState } from "./scriptedTypes.ts";

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
export function alertTimeCT(event: Event): string {
  const date = new Date(String(event.timestamp ?? ""));
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString("en-US", {
        timeZone: "America/Chicago",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }) + " CT"
    : "Time unavailable";
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

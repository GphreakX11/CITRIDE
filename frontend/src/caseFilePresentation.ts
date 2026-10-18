import type { CommandIncident } from "./commandTypes.ts";
import type { RecordsState, RecordItem } from "./scriptedTypes.ts";
import { displayText } from "./presentation.ts";
import { formatTime } from "./displayTime.ts";
type CaseIdentity = Pick<
  CommandIncident,
  "id" | "eventId" | "eventSnapshot" | "createdAt" | "version"
>;
type DisplayRecords =
  Pick<RecordsState, "statewideIncidents"> | null | undefined;
/** Presentation aliases for known system-generated activity; stored evidence is untouched. */
export function activityDisplayText(message: string): string {
  return message
    .replace(
      /^Modeled consequence reviewed locally; authority not configured and formal gate not evaluated\. /,
      "Impact review recorded. ",
    )
    .replace(
      /^Case tracking closed only; no recovery or dispatch is asserted\. /,
      "Case closed. ",
    )
    .replace(
      /^Local case tracking set to (open|monitoring)\. /,
      "Case status set to $1. ",
    )
    .replace(/^Local review task (completed|reopened): /, "Task $1: ")
    .replace(
      /^Immutable conditional consequence analysis captured; no observed impact or formal gate pass is asserted\.$/,
      "Analysis recorded.",
    )
    .replace(/^Local coordination note recorded; not sent\.$/, "Note recorded.")
    .replace(
      /^(.+) recorded locally; no dispatch, notification or recovery is asserted\.$/,
      "$1 recorded.",
    );
}
export function caseDisplayId(
  incident: Pick<CommandIncident, "id" | "eventId">,
  records: DisplayRecords,
): string | null {
  const rows = records?.statewideIncidents ?? [];
  const direct = rows.find((r) => r.caseId === incident.id);
  const linked = rows.filter(
    (r) => !r.caseId && r.linkedEventIds?.includes(incident.eventId),
  );
  const row: RecordItem | undefined =
    direct ?? (linked.length === 1 ? linked[0] : undefined);
  const id = row?.id;
  return typeof id === "string" &&
    id.trim() &&
    id !== incident.id &&
    !id.includes(incident.id)
    ? id
    : null;
}
export function recordClock(value: string | undefined | null): string {
  return formatTime(value, undefined, "Time unknown");
}
export function analysisLabel(
  run: { createdAt?: string } | null | undefined,
): string {
  const time = recordClock(run?.createdAt);
  return time === "Time unknown"
    ? "Analysis time not recorded"
    : `analysis at ${time}`;
}
export function caseFileHeader(
  incident: CaseIdentity,
  records: DisplayRecords,
): string {
  const event = incident.eventSnapshot;
  const label = displayText(event.label ?? event.title ?? "source alert");
  const origin =
    /vpn/i.test(String(event.observation ?? label)) && /vendor/i.test(label)
      ? "the vendor VPN alert"
      : label;
  return `CASE FILE · ${caseDisplayId(incident, records) ?? "Display ID not assigned"} · version ${incident.version} · opened ${recordClock(incident.createdAt)} from ${origin}`;
}
export function caseFileTabs(
  incident: Pick<CommandIncident, "decisions" | "tasks">,
) {
  const reviewed = incident.decisions.filter((d) => d.reviewed).length,
    done = incident.tasks.filter((t) => t.completed).length;
  return [
    { id: "context", label: "Context" },
    { id: "cyber", label: "Cyber Evidence" },
    { id: "consequence", label: "Consequences" },
    {
      id: "decisions",
      label: `Reviews ${reviewed}/${incident.decisions.length}`,
    },
    { id: "tasks", label: `Tasks ${done}/${incident.tasks.length}` },
    { id: "notes", label: "Notes" },
    { id: "activity", label: "Activity" },
    { id: "status", label: "Case status" },
    { id: "advanced", label: "Advanced" },
  ];
}
export function recordNoun(
  record: { type?: string; label?: string } | null | undefined,
): string {
  const type = record?.type ?? "";
  if (/WaterServiceProvider|Utility/.test(type)) return "utility";
  if (/TreatmentPlant|Plant/.test(type)) return "plant";
  if (
    /Controller/.test(type) ||
    (/PhysicalOTAsset/.test(type) &&
      /controller|\bPLC\b/i.test(record?.label ?? ""))
  )
    return "controller";
  if (/Hospital|NursingHome|DialysisCenter|FireService|Facility/.test(type))
    return "facility";
  if (/ServiceArea/.test(type)) return "service area";
  if (/Organization/.test(type)) return "organization";
  if (/CyberAsset/.test(type)) return "cyber asset";
  return "asset";
}

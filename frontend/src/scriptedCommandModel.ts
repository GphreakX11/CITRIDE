import type { Bootstrap, Event } from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";
import {
  number,
  object,
  text,
  type RecordItem,
  type RecordsState,
  type ReferenceData,
} from "./scriptedTypes.ts";

/** Records are already visibility-filtered by the service. Never reseed a hidden incident. */
export function statewideRows(
  records: RecordsState,
  incidents: readonly CommandIncident[],
): RecordItem[] {
  const linked = new Set<string>();
  const rows = records.statewideIncidents.map((record) => {
    const incident = incidents.find(
      (item) =>
        item.id === record.caseId ||
        item.id === record.id ||
        record.linkedEventIds?.includes(item.eventId),
    );
    if (!incident) return { ...record };
    linked.add(incident.id);
    return {
      ...record,
      caseId: incident.id,
      status: incident.status,
      reviews: incident.decisions,
      progress: incident.tasks,
    };
  });
  for (const incident of incidents)
    if (!linked.has(incident.id))
      rows.push({
        id: incident.id,
        caseId: incident.id,
        title: incident.title,
        status: incident.status,
        severity: incident.priority,
        startedAt: incident.createdAt,
        closedAt: incident.closedAt ?? undefined,
        location: { label: incident.contextSnapshot.provider?.label },
        summary: incident.eventSnapshot.description,
      });
  return rows;
}
export function scopedRecords(
  items: readonly RecordItem[],
  records: RecordsState,
  selected: CommandIncident | null,
): RecordItem[] {
  if (!selected) return [];
  const row = statewideRows(records, [selected]).find(
    (item) => item.caseId === selected.id,
  );
  return items.filter(
    (item) =>
      item.incidentId === row?.id ||
      item.incidentId === selected.id ||
      item.caseId === selected.id,
  );
}
export function recordTime(
  record: { at?: string; relativeTimeHours?: number; offsetMinutes?: number },
  data: Bootstrap,
  selected: CommandIncident | null,
): string | undefined {
  if (record.at) return record.at;
  if (typeof record.relativeTimeHours === "number" && data.incidentOrigin)
    return new Date(
      Date.parse(data.incidentOrigin) + record.relativeTimeHours * 3600000,
    ).toISOString();
  if (typeof record.offsetMinutes === "number" && selected)
    return new Date(
      Date.parse(selected.createdAt) + record.offsetMinutes * 60000,
    ).toISOString();
  return undefined;
}
export function elapsedMinutes(
  start: string | undefined,
  end: string,
): number | null {
  if (
    !start ||
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end))
  )
    return null;
  return Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 60000));
}
export function responseClock(
  records: RecordsState,
  reference: ReferenceData,
  selected: CommandIncident | null,
) {
  const start =
    reference.responseClock.startsAt === "case_opened"
      ? text(
          records.statewideIncidents.find((row) => row.caseId === selected?.id)
            ?.openedStoryAt,
        ) || selected?.createdAt
      : text(object(records.timing)[reference.responseClock.startsAt]) ||
        undefined;
  const elapsed = selected?.closedAt
    ? elapsedMinutes(selected.createdAt, selected.closedAt)
    : elapsedMinutes(start, records.storyNow);
  return {
    elapsedMinutes: elapsed,
    targetMinutes: reference.responseClock.targetMinutes,
    tone:
      elapsed === null
        ? "unknown"
        : elapsed >= reference.responseClock.redMinutes
          ? "red"
          : elapsed >= reference.responseClock.amberMinutes
            ? "amber"
            : "normal",
  };
}
export function optionCards(
  reference: ReferenceData,
  selected: CommandIncident | null,
) {
  return reference.responseOptions
    .map((option, order) => {
      const matching = (selected?.runSnapshot?.impacts ?? []).filter(
        (impact) =>
          option.triggers?.impactFunctions.includes(impact.functionId) &&
          impact.windowHours,
      );
      const window =
        matching
          .map((impact) => impact.windowHours)
          .filter((value): value is [number, number] => !!value)
          .sort((a, b) => a[0] - b[0] || a[1] - b[1])[0] ?? null;
      return {
        option,
        window,
        timing: window
          ? `${window[0]}–${window[1]} scenario hours`
          : (reference.optionTimingLabels[option.id] ?? "Timing unknown"),
        order,
      };
    })
    .sort(
      (a, b) =>
        (a.window?.[0] ?? Infinity) - (b.window?.[0] ?? Infinity) ||
        a.order - b.order,
    );
}
export function eventHour(event: Event, data: Bootstrap): number | null {
  if (typeof event.relativeTimeHours === "number")
    return event.relativeTimeHours;
  const at = event.timestamp ?? event.eventTime;
  return at && data.incidentOrigin && Number.isFinite(Date.parse(at))
    ? (Date.parse(at) - Date.parse(data.incidentOrigin)) / 3600000
    : typeof event.hour === "number"
      ? event.hour
      : null;
}
export function attackDurations(events: readonly Event[], data: Bootstrap) {
  const ordered = events
    .map((event) => ({ event, hour: eventHour(event, data) }))
    .filter(
      (item): item is { event: Event; hour: number } => item.hour !== null,
    )
    .sort((a, b) => a.hour - b.hour);
  const entry = ordered.find((item) =>
    /vpn.*login|offsite_vpn_login/.test(text(item.event.observation)),
  );
  const plant = ordered.find((item) =>
    /unusual_inbound_connection|controller.*(login|auth)|unauthorized.*login/.test(
      text(item.event.observation),
    ),
  );
  const change = ordered.find(
    (item) => text(item.event.observation) === "dosing_parameter_change",
  );
  const duration = (a: typeof entry, b: typeof entry) =>
    a && b && b.hour >= a.hour ? Math.round((b.hour - a.hour) * 60) : null;
  return {
    beforePlant: duration(entry, plant),
    plantToChange: duration(plant, change),
  };
}
export function vendorExposure(
  data: Bootstrap,
  selected: CommandIncident | null,
) {
  const currentProvider =
    selected?.contextSnapshot.provider?.id ??
    selected?.contextSnapshot.scenarios?.find((scenario) =>
      scenario.seed?.eventRefs.includes(selected.eventId),
    )?.seed.provider;
  const currentOrg = data.entities.find(
    (entity) => entity.id === currentProvider,
  )?.operatedBy;
  return data.entities.flatMap((vendor) => {
    const accounts = object(vendor).supportAccountAt;
    if (!Array.isArray(accounts)) return [];
    const utilities = data.entities.filter(
      (entity) =>
        entity.id !== currentProvider &&
        entity.operatedBy !== currentOrg &&
        accounts.includes(entity.operatedBy ?? entity.id) &&
        /WaterServiceProvider/.test(entity.type),
    );
    return [{ vendor, utilities }];
  });
}
export function attackPath(events: readonly Event[], data: Bootstrap) {
  const nodes: string[] = [],
    probes: string[] = [];
  for (const event of [...events].sort(
    (a, b) =>
      (eventHour(a, data) ?? Infinity) - (eventHour(b, data) ?? Infinity),
  )) {
    const identity = data.entities.find((entity) => entity.id === event.seenOn);
    const host = data.entities.find(
      (entity) => entity.id === identity?.hostedBy,
    );
    const label = host?.label ?? identity?.label;
    if (!label) continue;
    if (event.observation === "probing_only") {
      if (!probes.includes(label)) probes.push(label);
    } else if (nodes.at(-1) !== label) nodes.push(label);
  }
  return { nodes, probes };
}
export function staffing(records: RecordsState) {
  return records.teams.reduce(
    (sum, team) => ({
      onSite: sum.onSite + number(team.people?.onSite),
      remote: sum.remote + number(team.people?.remote),
      traveling: sum.traveling + number(team.people?.traveling),
      standby: sum.standby + number(team.people?.standby),
    }),
    { onSite: 0, remote: 0, traveling: 0, standby: 0 },
  );
}

import type { Bootstrap, Entity, Event, Telemetry } from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";
import { ctTime, evidenceRefs } from "./networkEvidence.ts";

export type TimelineData = Pick<Bootstrap, "events"> &
  Partial<Pick<Bootstrap, "entities" | "incidentOrigin">>;
export interface TimelineTechnique {
  id: string;
  name: string;
  tactic: string;
}
export interface CaseTimelineRow {
  event: Event;
  time: string;
  utility: Entity | null;
  asset: Entity | null;
  techniques: TimelineTechnique[];
  evidenceCategory: string;
  isCaseEvent: boolean;
  observedEffect: boolean;
}

/** Resolve a cyber identity through its host/organization, never through service dependencies. */
export function eventUtility(event: Event, data: TimelineData): Entity | null {
  const entities = data.entities ?? [];
  const providers = entities.filter(
    (e) => e.type === "WaterServiceProvider" || e.id.startsWith("utility-"),
  );
  const pending = [event.seenOn, event.utilityId].filter(
    (id): id is string => typeof id === "string",
  );
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const provider = providers.find((e) => e.id === id || e.operatedBy === id);
    if (provider) return provider;
    const entity = entities.find((e) => e.id === id);
    if (!entity) continue;
    for (const next of [entity.hostedBy, entity.partOf, entity.operatedBy])
      if (next) pending.push(next);
    // Support inventories that only describe the hosting relationship in the other direction.
    for (const host of entities)
      if ([host.hostsCyberAsset].flat().includes(id)) pending.push(host.id);
  }
  return null;
}

export function eventTimestamp(
  event: Event,
  data: TimelineData,
): string | undefined {
  const direct = event.timestamp ?? event.eventTime;
  if (direct) return direct;
  if (data.incidentOrigin && typeof event.relativeTimeHours === "number") {
    const time =
      Date.parse(data.incidentOrigin) + event.relativeTimeHours * 3600000;
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return undefined;
}

/** Case-local activity plus evidence-backed campaign links. Probes are links, not consequences. */
export function caseTimeline(
  incident: CommandIncident | null | undefined,
  data: TimelineData,
  telemetry: Telemetry | null | undefined,
): CaseTimelineRow[] {
  const events = new Map(data.events.map((e) => [e.id, e]));
  if (incident) events.set(incident.eventId, incident.eventSnapshot);
  const utility = incident
    ? (eventUtility(incident.eventSnapshot, data) ??
      incident.contextSnapshot.provider)
    : null;
  const all = (telemetry?.streams ?? []).flatMap((stream) =>
    stream.records.map((record) => ({ stream, record })),
  );
  const identities = (event: Event) => {
    const refs = evidenceRefs(event);
    return all
      .filter(({ stream, record }) =>
        refs.some(
          (ref) => ref.streamId === stream.id && ref.recordId === record.id,
        ),
      )
      .map(({ record }) => record.sharedSourceIdentity)
      .filter((id): id is string => typeof id === "string" && !!id);
  };
  const local = [...events.values()].filter(
    (e) =>
      e.id === incident?.eventId ||
      (!!utility && eventUtility(e, data)?.id === utility.id),
  );
  const campaign = new Set(local.flatMap(identities));
  // A physical-effect case can have no campaign annotation itself; its utility's supplied network evidence provides the link.
  if (utility)
    for (const { record } of all)
      if (
        record.utilityId === utility.id &&
        typeof record.sharedSourceIdentity === "string" &&
        record.sharedSourceIdentity
      )
        campaign.add(record.sharedSourceIdentity);
  return [...events.values()]
    .filter(
      (e) =>
        !incident ||
        local.includes(e) ||
        identities(e).some((id) => campaign.has(id)),
    )
    .sort((a, b) => {
      const hour = (e: Event) =>
        typeof e.relativeTimeHours === "number"
          ? e.relativeTimeHours
          : (Date.parse(eventTimestamp(e, data) ?? "") -
              Date.parse(data.incidentOrigin ?? "")) /
            3600000;
      const time = (e: Event) =>
        Number.isFinite(hour(e))
          ? hour(e)
          : Date.parse(eventTimestamp(e, data) ?? "") / 3600000;
      const av = time(a),
        bv = time(b);
      return (
        (Number.isFinite(av) ? av : Infinity) -
          (Number.isFinite(bv) ? bv : Infinity) || a.id.localeCompare(b.id)
      );
    })
    .map((event) => ({
      event,
      time: ctTime(eventTimestamp(event, data)),
      utility: eventUtility(event, data),
      asset: (data.entities ?? []).find((e) => e.id === event.seenOn) ?? null,
      techniques: Array.isArray(event.attackTechniques)
        ? event.attackTechniques.filter(
            (t): t is TimelineTechnique =>
              !!t &&
              typeof t === "object" &&
              typeof t.id === "string" &&
              typeof t.name === "string" &&
              typeof t.tactic === "string",
          )
        : [],
      evidenceCategory:
        typeof event.evidenceCategory === "string"
          ? event.evidenceCategory
          : typeof event.origin === "string"
            ? event.origin
            : "provenance unknown",
      isCaseEvent: event.id === incident?.eventId,
      observedEffect: event.observation === "water_quality_drift",
    }));
}

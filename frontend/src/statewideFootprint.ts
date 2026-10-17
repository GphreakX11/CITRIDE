import type { Bootstrap, Entity, Run } from "./types.ts";
import type { CommandIncident, CommandView } from "./commandTypes.ts";
import type { IdtIndex } from "./idt.ts";
import type {
  RecordItem,
  RecordsState,
  ReferenceData,
} from "./scriptedTypes.ts";
import { list, object, text } from "./scriptedTypes.ts";
import { elapsedMinutes, recordTime } from "./scriptedCommandModel.ts";
import {
  peopleServed,
  utilityForEvent,
  utilityMapStatus,
} from "./whoActsFirst.ts";

export interface StatewideFootprintProps {
  data: Bootstrap;
  incidents: CommandIncident[];
  selected: CommandIncident | null;
  records: RecordsState | null;
  reference: ReferenceData | null;
  idtIndex?: IdtIndex | null;
  onOpenAnalyst: (
    view: CommandView,
    caseId?: string,
    entityId?: string,
  ) => void;
  onSelect?: (id: string) => void;
}
export type Coordinate = [number, number];
const refs = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).filter(
    (x): x is string => typeof x === "string",
  );
const pair = (v: unknown): v is Coordinate =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((x) => typeof x === "number" && Number.isFinite(x));
export function recordedPoint(entity: unknown): Coordinate | null {
  const geometry = object(object(entity).geometry);
  return geometry.type === "Point" && pair(geometry.coordinates)
    ? [...geometry.coordinates]
    : null;
}
export function recordedRings(entity: unknown): Coordinate[][] {
  const geometry = object(object(entity).geometry);
  if (geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates))
    return [];
  return geometry.coordinates
    .filter(
      (ring): ring is Coordinate[] =>
        Array.isArray(ring) && ring.length >= 3 && ring.every(pair),
    )
    .map((ring) => ring.map((p) => [...p] as Coordinate));
}
const validWindow = (v: unknown): v is Coordinate =>
  pair(v) && v[0] >= 0 && v[1] >= v[0];

/** An explicit persisted association is authoritative, even when events are shared. */
function incidentRows(props: StatewideFootprintProps): RecordItem[] {
  const { records, incidents, selected } = props;
  const linked = new Set<string>();
  const rows = (records?.statewideIncidents ?? []).map((record) => {
    const associated = record.caseId
      ? incidents.find((c) => c.id === record.caseId)
      : (incidents.find((c) => c.id === record.id) ??
        (selected && record.linkedEventIds?.includes(selected.eventId)
          ? selected
          : null) ??
        incidents.find((c) => record.linkedEventIds?.includes(c.eventId)));
    if (!associated) return { ...record };
    linked.add(associated.id);
    return { ...record, caseId: associated.id, status: associated.status };
  });
  for (const incident of incidents)
    if (!linked.has(incident.id)) {
      rows.push({
        id: incident.id,
        caseId: incident.id,
        title: incident.title,
        severity: incident.priority,
        status: incident.status,
        startedAt: incident.createdAt,
        closedAt: incident.closedAt ?? undefined,
        location: { label: incident.contextSnapshot?.provider?.label },
        summary: incident.eventSnapshot?.description,
      });
    }
  return rows;
}
function layerFor(incident: CommandIncident, props: StatewideFootprintProps) {
  // No live-run lookup, scenario evaluation, or repair of an incomplete captured baseline.
  const run = incident.runSnapshot ?? null;
  const entities = run
    ? (list(object(run.baselineSnapshot).entities) as unknown as Entity[])
    : props.data.entities;
  const inventory = { ...props.data, entities };
  const providerId =
    run?.seed?.provider ??
    incident.contextSnapshot?.provider?.id ??
    utilityForEvent(incident.eventSnapshot, props.data);
  const provider = entities.find((e) => e.id === providerId);
  const serviceAreas = entities
    .filter((e) => refs(provider?.serves).includes(e.id))
    .map((e) => ({
      id: e.id,
      label: e.label,
      geometry: object(e).geometry,
      rings: recordedRings(e),
      note: text(object(e).coordinateNote),
    }));
  const providerPoint =
    recordedPoint(provider) ??
    entities
      .filter((e) => e.partOf === providerId)
      .map(recordedPoint)
      .find(Boolean) ??
    null;
  const utility = provider
    ? {
        ...utilityMapStatus(provider.id, props.data, props.incidents),
        id: provider.id,
        label: provider.label,
        coordinates: providerPoint,
        people: peopleServed(provider.id, inventory),
      }
    : null;
  const row = props.records?.statewideIncidents.find(
    (r) => r.caseId === incident.id || r.id === incident.id,
  );
  const eventIds = new Set(row?.linkedEventIds ?? [incident.eventId]);
  const relatedUtilities = new Set(
    props.data.events
      .filter((e) => eventIds.has(e.id))
      .map((e) => utilityForEvent(e, props.data)),
  );
  const probed = entities
    .filter(
      (e) =>
        e.type === "WaterServiceProvider" &&
        e.id !== providerId &&
        relatedUtilities.has(e.id),
    )
    .map((e) => ({
      ...utilityMapStatus(e.id, props.data, props.incidents),
      id: e.id,
      label: e.label,
      people: peopleServed(e.id, inventory),
      coordinates:
        recordedPoint(e) ??
        entities
          .filter((child) => child.partOf === e.id)
          .map(recordedPoint)
          .find(Boolean) ??
        null,
    }))
    .filter((e) => e.status === "probed");
  const facilities = (run?.impacts ?? [])
    .flatMap((impact) => {
      const entity = entities.find((e) => e.id === impact.entityId);
      if (!entity || entity.id === providerId) return [];
      return [
        {
          id: entity.id,
          label: entity.label,
          functionId: impact.functionId,
          state: impact.state,
          windowHours: validWindow(impact.windowHours)
            ? ([...impact.windowHours] as Coordinate)
            : null,
          coordinates: recordedPoint(entity),
        },
      ];
    })
    .sort(
      (a, b) =>
        (a.windowHours?.[0] ?? Infinity) - (b.windowHours?.[0] ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
  const dependencies = list(object(run?.baselineSnapshot).dependencies);
  const excluded = (run?.excluded ?? [])
    .flatMap((value) => {
      const exclusion = object(value);
      const dependency = dependencies.find(
        (d) => d.id === exclusion.dependencyId,
      );
      const entityId = text(
        exclusion.entityId,
        text(exclusion.dependent, text(dependency?.dependent)),
      );
      const entity = entities.find((e) => e.id === entityId);
      return entity
        ? [
            {
              id: entity.id,
              label: entity.label,
              reason: text(exclusion.reason, text(exclusion.message)),
              coordinates: recordedPoint(entity),
            },
          ]
        : [];
    })
    .filter(
      (entry, index, all) => all.findIndex((e) => e.id === entry.id) === index,
    );
  return {
    caseId: incident.id,
    run,
    utility,
    probed,
    facilities,
    excluded,
    serviceAreas,
  };
}
export function matchingNotice(
  run: Run | null,
  providerType: string | undefined,
  reference: ReferenceData | null,
) {
  if (!run?.seed) return null;
  return (
    reference?.boilWaterRules.find((rule) => {
      const when = object(rule.when);
      return (
        Object.keys(when).length === 3 &&
        Object.keys(when).every((k) =>
          ["seedLossType", "providerType", "minPersistHours"].includes(k),
        ) &&
        typeof when.minPersistHours === "number" &&
        Number.isFinite(when.minPersistHours) &&
        when.minPersistHours >= 0 &&
        run.seed.lossType === when.seedLossType &&
        providerType === when.providerType &&
        validWindow(run.seed.windowHours) &&
        run.seed.persistsThroughHour - run.seed.windowHours[0] >=
          when.minPersistHours
      );
    }) ?? null
  );
}
/** Boil-water label for a captured run, from the reference rule (C4 and A4 graphs). */
export function boilWaterLabel(
  run: Run | null,
  entities: { id: string; type: string }[],
  reference: ReferenceData | null,
): string | null {
  const type = entities.find((e) => e.id === run?.seed?.provider)?.type;
  const rule = matchingNotice(run, type, reference);
  return rule && typeof rule.label === "string" ? rule.label : null;
}
/** Pure projection of visible records + captured case truth. Selection never filters the map. */
export function statewideFootprint(
  props: StatewideFootprintProps,
  pickedId?: string | null,
) {
  const rows = incidentRows(props);
  const active =
    rows.find((r) => r.id === pickedId) ??
    rows.find((r) => props.selected && r.caseId === props.selected.id) ??
    rows.find((r) => r.status !== "closed") ??
    rows[0] ??
    null;
  const caseRecord =
    props.incidents.find((c) => c.id === active?.caseId) ?? null;
  const layers = props.incidents.map((c) => layerFor(c, props));
  const layer = layers.find((l) => l.caseId === caseRecord?.id);
  const run = layer?.run ?? null;
  const utility = layer?.utility ?? null;
  const probed = layer?.probed ?? [];
  const elapsed = active
    ? elapsedMinutes(
        active.startedAt ??
          recordTime(
            { relativeTimeHours: active.startedRelativeHours },
            props.data,
            null,
          ),
        active.closedAt ??
          recordTime(
            {
              relativeTimeHours:
                typeof active.closedRelativeHours === "number"
                  ? active.closedRelativeHours
                  : undefined,
            },
            props.data,
            null,
          ) ??
          props.records?.storyNow ??
          "",
      )
    : null;
  const events = new Set(
    active?.linkedEventIds ?? (caseRecord ? [caseRecord.eventId] : []),
  );
  const observations = new Set(
    props.data.events
      .filter((e) => events.has(e.id))
      .map((e) => text(e.observation)),
  );
  const options = caseRecord
    ? (props.reference?.responseOptions ?? []).filter(
        (option) =>
          option.triggers?.eventObservations.some((o) => observations.has(o)) ||
          option.triggers?.impactFunctions.some((f) =>
            run?.impacts.some((i) => i.functionId === f),
          ),
      )
    : [];
  const decisionsWaiting = options.filter((option) => {
    const decision = (props.records?.decisions ?? [])
      .filter(
        (d) =>
          d.optionId === option.id &&
          (d.caseId === caseRecord?.id ||
            d.incidentId === active?.id ||
            d.incidentId === caseRecord?.id),
      )
      .at(-1);
    return (
      !decision ||
      ["pending", "not_decided", "undecided"].includes(text(decision.decision))
    );
  }).length;
  const capturedEntities = list(object(run?.baselineSnapshot).entities);
  const providerType = run
    ? text(capturedEntities.find((e) => e.id === run.seed?.provider)?.type)
    : undefined;
  return {
    rows,
    active,
    caseRecord,
    layers,
    run,
    utility,
    probed,
    facilities: layer?.facilities ?? [],
    excluded: layer?.excluded ?? [],
    serviceAreas: layer?.serviceAreas ?? [],
    people: utility?.people ?? null,
    probedPeople:
      probed.length && probed.every((p) => p.people !== null)
        ? probed.reduce((sum, p) => sum + p.people!, 0)
        : null,
    elapsed,
    decisionsWaiting,
    boilWaterRule: matchingNotice(run, providerType, props.reference),
    idtIndex: props.idtIndex ?? null,
  };
}
export type StatewideFootprintModel = ReturnType<typeof statewideFootprint>;

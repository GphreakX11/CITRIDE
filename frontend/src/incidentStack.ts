import type {
  Bootstrap,
  Dependency,
  Entity,
  Event,
  Impact,
  Run,
  Source,
} from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";
import type { RecordItem } from "./scriptedTypes.ts";
import { object, text } from "./scriptedTypes.ts";
import { statusTone, windowTone } from "./statusTone.ts";
import {
  capturedClassification,
  originLabel,
  sourceLabels,
  timeLabel,
  words,
} from "./commandCenterModel.ts";
import { recordedPoint, statewideFootprint } from "./statewideFootprint.ts";
import type {
  StatewideFootprintModel,
  StatewideFootprintProps,
} from "./statewideFootprint.ts";

export type IncidentTone = "red" | "amber" | "green" | "grey";
export type IncidentLine = "solid" | "dashed" | "dotted";
export interface IncidentNodeState {
  tone: IncidentTone;
  line: IncidentLine;
  label: string;
  doubleRing?: boolean;
  reason?: string;
}
/** All evidence must belong to the selected incident/layer before entering this helper. */
export interface IncidentNodeContext {
  sourceId: string | null;
  lossType?: string | null;
  entities: readonly Entity[];
  dependencies: readonly Dependency[];
  run: Pick<Run, "impacts" | "excluded"> | null;
  assetStatuses: readonly RecordItem[];
  events: readonly Event[];
  serviceAreaIds: readonly string[];
  incident?: CommandIncident | null;
  incidentRecord?: RecordItem | null;
}
export type IncidentStackRole =
  "source" | "plant" | "upstream" | "dependent" | "in-area";
export type IncidentFacilityGroup =
  "at-risk" | "supply-chain" | "not-affected" | "unmodeled";
export interface IncidentStackDependencyLink {
  dependency: Dependency;
  entityId: string;
  entityLabel: string | null;
  functionLabel: string | null;
  captured: boolean;
  reference: boolean;
  modeled: boolean;
}
export interface IncidentStackNode {
  entity: Entity;
  state: IncidentNodeState;
  role: IncidentStackRole;
  group: IncidentFacilityGroup;
  impacts: Impact[];
  windows: [number, number][];
  earliestWindow: [number, number] | null;
  classification: ReturnType<typeof capturedClassification>;
  idtCode: string | null;
  dependsOn: IncidentStackDependencyLink[];
  supplies: IncidentStackDependencyLink[];
  affectedAssets: Entity[];
  assetStatuses: RecordItem[];
  events: Event[];
  exclusions: Record<string, unknown>[];
  sourceRefs: string[];
  sources: ReturnType<typeof sourceLabels>;
  assumptions: string[];
  caseIds: string[];
  captured: boolean;
  recordBasis: "captured" | "reference";
  modelVersion: string | null;
  capturedAt: string | null;
  baselineRevision: number;
  origin: string;
  coordinates: [number, number] | null;
}
export interface IncidentStackEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  tone: IncidentTone;
  line: IncidentLine;
  kind: "dependency" | "structural";
  dependency: Dependency | null;
  captured: boolean;
  reference: boolean;
  modeled: boolean;
  sourceRefs: string[];
}
export interface IncidentSectorGroup {
  id: string;
  label: string;
  classification: IncidentStackNode["classification"];
  nodes: IncidentStackNode[];
  count: number;
  atRisk: number;
  state: IncidentNodeState;
}
export interface IncidentStackProps extends StatewideFootprintProps {
  /** Statewide register ID, NOT the shared saved-case ID. */
  incidentId?: string | null;
}
export interface IncidentStackModel {
  context: IncidentNodeContext;
  incident: CommandIncident | null;
  incidentRecord: RecordItem | null;
  layer: Bootstrap;
  nodes: IncidentStackNode[];
  edges: IncidentStackEdge[];
  groups: {
    atRisk: IncidentStackNode[];
    supplyChain: IncidentStackNode[];
    notAffected: IncidentStackNode[];
    /** Unknown is not the same as not affected, especially before an analysis. */
    unmodeled: IncidentStackNode[];
  };
  facilityGroups: IncidentSectorGroup[];
  aggregateFacilities: boolean;
  sourceId: string | null;
  sourceLabel: string | null;
  provider: Entity | null;
  serviceAreaLabel: string | null;
  serviceAreas: Entity[];
  people: number | null;
  areaCounts: { id: string; count: number | null }[];
  captured: boolean;
  run: Run | null;
  infrastructureAvailable: boolean;
  missingRecords: number;
  footPrintModel: StatewideFootprintModel;
}

const refs = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === "string" && !!item.trim(),
  );
const key = (value: unknown): string =>
  text(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
const array = <T>(value: unknown): T[] =>
  Array.isArray(value)
    ? (value.filter((item) => item && typeof item === "object") as T[])
    : [];
function validWindow(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => typeof v === "number" && Number.isFinite(v)) &&
    value[0] >= 0 &&
    value[1] >= value[0]
  );
}
function earliestWindow(impacts: readonly Impact[]): [number, number] | null {
  const windows = impacts.map((i) => i.windowHours).filter(validWindow);
  const earliest = windows.reduce<[number, number] | null>(
    (best, w) =>
      !best || w[0] < best[0] || (w[0] === best[0] && w[1] < best[1])
        ? w
        : best,
    null,
  );
  return earliest ? [...earliest] : null;
}
function idtCode(entity: Entity | undefined): string | null {
  const idt = object(object(entity).idt);
  const value =
    idt.status === "coded"
      ? idt.path
      : idt.status === "below_idt_level"
        ? idt.parentPath
        : null;
  return typeof value === "string" && /^[1-9]\d*(?:\.[1-9]\d*)*$/.test(value)
    ? value
    : null;
}
function classifiedLabel(entity: Entity | undefined, label: string): string {
  const code = idtCode(entity);
  return code ? `IDT ${code} · ${label}` : label;
}
const neutral = (run: IncidentNodeContext["run"]): IncidentNodeState => ({
  tone: statusTone("unknown") as IncidentTone,
  line: "solid",
  label: run ? "No status recorded" : "Not yet modeled",
});

/** Descendants only: hosted/partOf links are context, never operational propagation. */
function hostedIds(entityId: string, entities: readonly Entity[]): Set<string> {
  const ids = new Set([entityId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entity of entities) {
      if (ids.has(entity.id)) {
        for (const id of refs(entity.hostsCyberAsset))
          if (!ids.has(id)) {
            ids.add(id);
            changed = true;
          }
      } else if (
        refs(entity.partOf).some((id) => ids.has(id)) ||
        refs(entity.hostedBy).some((id) => ids.has(id))
      ) {
        ids.add(entity.id);
        changed = true;
      }
    }
  }
  return ids;
}
/** Latest status per entity; input order breaks ties/missing dates, matching append-only records. */
function statusesFor(
  ids: ReadonlySet<string>,
  context: IncidentNodeContext,
): RecordItem[] {
  const latest = new Map<string, RecordItem>();
  // Inventory may itself carry a status. Explicit status records supersede it.
  for (const entity of context.entities) {
    const record = object(entity);
    if (ids.has(entity.id) && typeof record.status === "string")
      latest.set(entity.id, { ...record, id: entity.id, entityId: entity.id });
  }
  for (const item of context.assetStatuses) {
    if (!item.entityId || !ids.has(item.entityId)) continue;
    const prior = latest.get(item.entityId);
    const previousTime = Date.parse(text(prior?.at, text(prior?.updatedAt)));
    const nextTime = Date.parse(text(item.at, text(item.updatedAt)));
    if (
      !prior ||
      !Number.isFinite(previousTime) ||
      !Number.isFinite(nextTime) ||
      nextTime >= previousTime
    )
      latest.set(item.entityId, item);
  }
  return [...latest.values()];
}
const eventIds = (event: Event): string[] => [
  ...refs(event.seenOn),
  ...refs(event.entityId),
  ...refs(event.targetEntityId),
  ...refs(event.assetId),
];
const attackStatuses = new Set(["compromised", "manipulated", "confirmed"]);
const probeStatuses = new Set([
  "suspected",
  "probed",
  "probing",
  "probing_only",
]);
function probeEvent(event: Event): boolean {
  return (
    probeStatuses.has(key(event.status)) ||
    probeStatuses.has(key(event.observation))
  );
}
function confirmedAttack(event: Event): boolean {
  if (probeEvent(event)) return false;
  const status = key(event.status);
  const cyber =
    /cyber|attack/i.test(text(event.type)) ||
    event.attack === true ||
    event.confirmedAttack === true;
  return (
    event.confirmedAttack === true ||
    status === "compromised" ||
    status === "manipulated" ||
    ((status === "confirmed" ||
      key(event.confirmation) === "confirmed" ||
      event.confirmed === true) &&
      cyber)
  );
}
function recordClock(record: Record<string, unknown> | undefined): string {
  const at = text(record?.timestamp, text(record?.eventTime, text(record?.at)));
  // Do not display raw IDs, invalid times or invented timezone/time-of-day values.
  return at && Number.isFinite(Date.parse(at)) ? timeLabel(at) : "";
}
function exclusionRecords(
  entityId: string,
  context: IncidentNodeContext,
): Record<string, unknown>[] {
  return (context.run?.excluded ?? []).map(object).filter((item) => {
    const dep = context.dependencies.find((d) => d.id === item.dependencyId);
    return (
      text(item.entityId, text(item.dependent, dep?.dependent ?? "")) ===
      entityId
    );
  });
}
function reach(
  start: ReadonlySet<string>,
  dependencies: readonly Dependency[],
  direction: "up" | "down",
): Set<string> {
  const ids = new Set(start);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of dependencies) {
      const from = direction === "up" ? d.dependent : d.provider;
      const to = direction === "up" ? d.provider : d.dependent;
      if (ids.has(from) && !ids.has(to)) {
        ids.add(to);
        changed = true;
      }
    }
  }
  return ids;
}
function dependsOnAffected(
  entityId: string,
  context: IncidentNodeContext,
): boolean {
  const upstream = reach(new Set([entityId]), context.dependencies, "up");
  upstream.delete(entityId);
  if (context.sourceId && upstream.has(context.sourceId)) return true;
  if (
    (context.run?.impacts ?? []).some(
      (i) => upstream.has(i.entityId) && validWindow(i.windowHours),
    )
  )
    return true;
  // Inspect only actual ancestors, not every inventory node for every facility.
  return context.entities.some((entity) => {
    if (!upstream.has(entity.id)) return false;
    const family = hostedIds(entity.id, context.entities);
    return (
      statusesFor(family, context).some((s) =>
        attackStatuses.has(key(s.status)),
      ) ||
      context.events.some(
        (e) => eventIds(e).some((id) => family.has(id)) && confirmedAttack(e),
      )
    );
  });
}

/** Eight ordered rules. Never guess safety, compromise, impact windows or dependencies. */
export function incidentNodeState(
  entityId: string,
  context: IncidentNodeContext,
): IncidentNodeState {
  const entity = context.entities.find((e) => e.id === entityId);
  // 1. The explicitly selected source, even before an analysis exists.
  if (entityId && entityId === context.sourceId)
    return {
      tone: statusTone("source") as IncidentTone,
      line: "solid",
      label: classifiedLabel(
        entity,
        context.lossType ? words(context.lossType) : "Source",
      ),
      doubleRing: true,
    };
  if (!entity) return neutral(context.run);
  const family = hostedIds(entityId, context.entities);
  const statuses = statusesFor(family, context);
  const events = context.events.filter((e) =>
    eventIds(e).some((id) => family.has(id)),
  );
  const attackedRows = statuses.filter((s) =>
    attackStatuses.has(key(s.status)),
  );
  const selectedEvent = events.find((e) => e.id === context.incident?.eventId);
  const matchesStatus = (event: Event, status: RecordItem) =>
    eventIds(event).some((id) =>
      hostedIds(status.entityId!, context.entities).has(id),
    );
  const attacked =
    (selectedEvent &&
      attackedRows.find((s) => matchesStatus(selectedEvent, s))) ||
    attackedRows[0];
  const attack =
    (selectedEvent && confirmedAttack(selectedEvent)
      ? selectedEvent
      : undefined) ?? events.find(confirmedAttack);
  // 2. Explicit confirmed status/event, including hosted controllers.
  if (attacked || attack) {
    const change = attack
      ? text(attack.label, text(attack.title, "Confirmed attack"))
      : text(
          attacked?.detail,
          text(attacked?.label, words(text(attacked?.status))),
        );
    const linkedEvent =
      attacked && selectedEvent && matchesStatus(selectedEvent, attacked)
        ? selectedEvent
        : undefined;
    const clock =
      recordClock(attack) || recordClock(attacked) || recordClock(linkedEvent);
    return {
      tone: statusTone("attacked") as IncidentTone,
      line: "solid",
      label: classifiedLabel(entity, [change, clock].filter(Boolean).join(" ")),
    };
  }
  // 3. Actual bounded results, earliest function first. Invalid data never enters windowTone.
  const window = context.run
    ? earliestWindow(context.run.impacts.filter((i) => i.entityId === entityId))
    : null;
  if (window)
    return {
      tone: windowTone(window),
      line: "solid",
      label: `${window[0]}–${window[1]} h`,
    };
  // 4. A probe is not compromise (even when its narrative says "no compromise").
  const probe = events.find(probeEvent);
  const suspected = statuses.find((s) => probeStatuses.has(key(s.status)));
  if (probe || suspected) {
    const clock = recordClock(probe) || recordClock(suspected);
    const isProbe = !!probe || key(suspected?.status) !== "suspected";
    return {
      tone: statusTone("probed") as IncidentTone,
      line: "solid",
      label: isProbe
        ? ["Probed", clock].filter(Boolean).join(" ")
        : "Suspected",
    };
  }
  // No-run guard: rules 5–7 cannot color or characterize facilities before modeling.
  if (!context.run) return neutral(null);
  const dependent = dependsOnAffected(entityId, context);
  // 5. A recorded exclusion with an actual affected dependency.
  const exclusions = exclusionRecords(entityId, context);
  if (dependent && exclusions.length) {
    const reasons = [
      ...new Set(
        exclusions.map((e) => text(e.reason, text(e.message))).filter(Boolean),
      ),
    ];
    return {
      tone: statusTone("not_affected") as IncidentTone,
      line: "dashed",
      label: "not affected",
      ...(reasons.length ? { reason: reasons.join("; ") } : {}),
    };
  }
  // 6. Geography is membership only, never an operational link.
  if (
    !dependent &&
    refs(entity.locatedIn).some((id) => context.serviceAreaIds.includes(id))
  )
    return {
      tone: statusTone("no_dependency") as IncidentTone,
      line: "dotted",
      label: "in area · no dependency",
    };
  // 7. Explicit upstream link, with no unknown/adverse status or unexplained event.
  const upstream = context.sourceId
    ? reach(new Set([context.sourceId]), context.dependencies, "up")
    : new Set<string>();
  const cleanStatuses = statuses.every((s) => key(s.status) === "normal");
  const cleanEvents = events.every((e) => key(e.status) === "normal");
  if (upstream.has(entityId) && cleanStatuses && cleanEvents)
    return {
      tone: statusTone("normal") as IncidentTone,
      line: "solid",
      label: classifiedLabel(entity, "normal"),
    };
  // 8. Missing/unknown evidence is neutral, not green and not red.
  return neutral(context.run);
}

/** Worst to best: red, amber, grey-dashed, grey-dotted, green, grey-unknown. */
function rank(state: IncidentNodeState): number {
  return state.tone === "red"
    ? 0
    : state.tone === "amber"
      ? 1
      : state.tone === "grey" && state.line === "dashed"
        ? 2
        : state.tone === "grey" && state.line === "dotted"
          ? 3
          : state.tone === "green"
            ? 4
            : 5;
}
export function groupIncidentNodeState(
  states: readonly IncidentNodeState[],
): IncidentNodeState {
  const worst = states.reduce<IncidentNodeState | null>(
    (best, state) => (!best || rank(state) < rank(best) ? state : best),
    null,
  );
  if (!worst) return neutral({ impacts: [], excluded: [] });
  // Groups do not masquerade as the source's double ring.
  const { doubleRing: _doubleRing, ...state } = worst;
  return { ...state };
}
/** Group only right-hand facilities. Supply-chain nodes always remain individual. */
export function groupIncidentFacilities(
  nodes: readonly IncidentStackNode[],
): IncidentSectorGroup[] {
  const groups = new Map<string, IncidentStackNode[]>();
  for (const node of nodes) {
    if (node.role !== "dependent" && node.role !== "in-area") continue;
    const key = node.classification.key;
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, nodes]) => {
      const classification = nodes[0]!.classification;
      const atRisk = nodes.filter(
        (n) => n.state.tone === "red" || n.state.tone === "amber",
      ).length;
      const label = `${classification.label} · ${nodes.length} facilities · ${atRisk} at risk`;
      return {
        id: `sector:${key}`,
        label,
        classification,
        nodes: [...nodes],
        count: nodes.length,
        atRisk,
        state: groupIncidentNodeState(nodes.map((n) => n.state)),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function infrastructure(entity: Entity): boolean {
  return (
    !/Cyber|Area|Organization|PopulationGroup/i.test(entity.type) &&
    !["PhysicalOTAsset", "PhysicalITAsset"].includes(entity.type)
  );
}
function makeLayer(data: Bootstrap, run: Run | null): Bootstrap {
  if (!run) return structuredClone(data);
  const saved = object(run.baselineSnapshot);
  // An incomplete captured baseline stays incomplete. Never resolve against live inventory.
  return {
    ...saved,
    baselineRevision: run.baselineRevision,
    modelVersion: run.modelVersion,
    entities: array<Entity>(saved.entities),
    dependencies: array<Dependency>(saved.dependencies),
    serviceFunctions: array<Bootstrap["serviceFunctions"][number]>(
      saved.serviceFunctions,
    ),
    sources: array<Source>(saved.sources),
    assumptions: array<Record<string, unknown>>(saved.assumptions),
    events: array<Event>(saved.events),
    assessments: array<Record<string, unknown>>(saved.assessments),
    scenarios: array<Bootstrap["scenarios"][number]>(saved.scenarios),
    defaultScenarioId: text(saved.defaultScenarioId),
  };
}
function peopleByArea(
  areas: readonly Entity[],
  entities: readonly Entity[],
): { id: string; count: number | null }[] {
  return areas.map((area) => {
    const direct = object(area).peopleServed;
    const groups = entities.filter(
      (e) =>
        e.type === "PopulationGroup" && refs(e.locatedIn).includes(area.id),
    );
    const count =
      typeof direct === "number" && Number.isFinite(direct) && direct >= 0
        ? direct
        : groups.length === 1 &&
            refs(groups[0]!.locatedIn).length === 1 &&
            typeof object(groups[0]).count === "number" &&
            Number.isFinite(object(groups[0]).count) &&
            (object(groups[0]).count as number) >= 0
          ? (object(groups[0]).count as number)
          : null;
    return { id: area.id, count };
  });
}
function inIncident(
  record: RecordItem,
  incident: CommandIncident,
  active: RecordItem | null,
): boolean {
  if (!record.caseId && !record.incidentId) return true;
  return (
    record.caseId === incident.id ||
    record.incidentId === incident.id ||
    (!!active && record.incidentId === active.id)
  );
}
function linkedCaseIds(
  entityId: string,
  selected: CommandIncident,
  incidents: readonly CommandIncident[],
): string[] {
  const linked = incidents
    .filter((incident) => {
      if (
        incident.id === selected.id ||
        incident.runSnapshot?.seed?.provider === entityId ||
        incident.runSnapshot?.impacts.some((i) => i.entityId === entityId)
      )
        return true;
      const context = incident.contextSnapshot;
      return (
        [
          context?.provider,
          context?.facility,
          context?.physicalAsset,
          context?.cyberAsset,
          context?.serviceArea,
        ].some((e) => e?.id === entityId) ||
        (context?.downstreamDependencies ?? []).some(
          (item) => item.dependent?.id === entityId,
        )
      );
    })
    .map((incident) => incident.id);
  return [...new Set([selected.id, ...linked])];
}
function dependencyLabel(dependency: Dependency, layer: Bootstrap): string {
  // Preserve recorded service semantics, rather than guess the mockup's function-specific wording.
  const service = dependency.requiredService
    ? words(dependency.requiredService)
    : "Service not recorded";
  const functionLabel = layer.serviceFunctions.find(
    (f) => f.id === dependency.dependentFunction,
  )?.label;
  return functionLabel ? `${service} · ${functionLabel}` : service;
}

/** Pure selected-incident projection; no current run lookup, scenario evaluation or writes. */
export function incidentStack(
  props: IncidentStackProps,
  incidentId: string | null | undefined = props.incidentId ??
    props.pickedIncidentId,
): IncidentStackModel {
  // Detach returned records, including the reused footprint model, from immutable caller snapshots.
  // The shared selected case is a UI cursor, not evidence of which capture belongs
  // to this register incident. Explicit caseId wins; otherwise the most recent
  // event-linked captured run wins, independently of input order/selection.
  const capturedTime = (c: CommandIncident): number => {
    const at = Date.parse(c.runSnapshot?.createdAt ?? "");
    return Number.isFinite(at) ? at : -Infinity;
  };
  const incidents = [...props.incidents].sort((a, b) =>
    Number(!!b.runSnapshot) - Number(!!a.runSnapshot) ||
    capturedTime(b) - capturedTime(a) ||
    a.id.localeCompare(b.id),
  );
  const footPrintModel = structuredClone(statewideFootprint(
    { ...props, incidents, selected: null }, incidentId,
  ));
  const incident = footPrintModel.caseRecord;
  const incidentRecord = footPrintModel.active;
  const run = incident?.runSnapshot ?? null;
  const captured = !!run;
  const layer = makeLayer(props.data, run);
  const sourceId = incident
    ? (run?.seed?.provider ??
      incident.contextSnapshot?.provider?.id ??
      footPrintModel.utility?.id ??
      null)
    : null;
  const provider = layer.entities.find((e) => e.id === sourceId) ?? null;
  const serviceAreaIds = refs(provider?.serves);
  const serviceAreas = layer.entities.filter((e) =>
    serviceAreaIds.includes(e.id),
  );
  const areaCounts = peopleByArea(serviceAreas, layer.entities);
  // Only a uniquely linked recorded scenario may supply the loss label before a run.
  const eventRefs = new Set([
    ...(incidentRecord?.linkedEventIds ?? []),
    ...(incident ? [incident.eventId] : []),
    ...(run?.seed?.eventRefs ?? []),
  ]);
  const linkedScenarios = (
    incident?.contextSnapshot?.scenarios ?? layer.scenarios
  ).filter(
    (s) =>
      s.seed.provider === sourceId &&
      s.seed.eventRefs.some((id) => eventRefs.has(id)),
  );
  const lossType =
    run?.seed?.lossType ??
    (linkedScenarios.length === 1 ? linkedScenarios[0]!.seed.lossType : null);
  const assetStatuses = incident
    ? structuredClone(
        (props.records?.assetStatuses ?? []).filter((r) =>
          inIncident(r, incident, incidentRecord),
        ),
      )
    : [];
  const context: IncidentNodeContext = {
    sourceId,
    lossType,
    entities: layer.entities,
    dependencies: layer.dependencies,
    run,
    assetStatuses,
    events: incident ? layer.events.filter((e) => eventRefs.has(e.id)) : [],
    serviceAreaIds,
    incident,
    incidentRecord,
  };
  const nodes: IncidentStackNode[] = [];
  const edges: IncidentStackEdge[] = [];
  const sourceIds = new Set(sourceId ? [sourceId] : []);
  // Plants in the source's partOf chain (not their hosted cyber/physical assets).
  const plants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of layer.entities)
      if (
        infrastructure(e) &&
        e.id !== sourceId &&
        refs(e.partOf).some((id) => sourceIds.has(id) || plants.has(id)) &&
        !plants.has(e.id)
      ) {
        plants.add(e.id);
        changed = true;
      }
  }
  const supply = reach(
    new Set([...sourceIds, ...plants]),
    layer.dependencies,
    "up",
  );
  const downstream = reach(sourceIds, layer.dependencies, "down");
  const modeledEntities = new Set((run?.impacts ?? []).map((i) => i.entityId));
  const scope = new Set([...supply, ...downstream, ...modeledEntities]);
  if (incident && sourceId)
    for (const e of layer.entities)
      if (
        infrastructure(e) &&
        refs(e.locatedIn).some((id) => serviceAreaIds.includes(id))
      )
        scope.add(e.id);
  const modeledDependencies = new Set(
    (run?.impacts ?? []).flatMap((i) => i.paths?.flat() ?? []),
  );
  let missingRecords = 0;
  for (const d of layer.dependencies)
    if (
      (scope.has(d.provider) || scope.has(d.dependent)) &&
      (!layer.entities.some((e) => e.id === d.provider) ||
        !layer.entities.some((e) => e.id === d.dependent))
    )
      missingRecords++;
  for (const impact of run?.impacts ?? [])
    if (!layer.entities.some((e) => e.id === impact.entityId)) missingRecords++;
  const link = (d: Dependency, id: string): IncidentStackDependencyLink => ({
    dependency: d,
    entityId: id,
    entityLabel: layer.entities.find((e) => e.id === id)?.label ?? null,
    functionLabel:
      layer.serviceFunctions.find((f) => f.id === d.dependentFunction)?.label ??
      null,
    captured,
    reference: !captured,
    modeled: modeledDependencies.has(d.id),
  });
  for (const entity of layer.entities) {
    if (!incident || !scope.has(entity.id) || !infrastructure(entity)) continue;
    const role: IncidentStackRole =
      entity.id === sourceId
        ? "source"
        : plants.has(entity.id)
          ? "plant"
          : supply.has(entity.id)
            ? "upstream"
            : downstream.has(entity.id) || modeledEntities.has(entity.id)
              ? "dependent"
              : "in-area";
    const state = incidentNodeState(entity.id, context);
    const impacts = (run?.impacts ?? []).filter(
      (i) => i.entityId === entity.id,
    );
    const family = hostedIds(entity.id, layer.entities);
    const statuses = statusesFor(family, context);
    const events = context.events.filter((e) =>
      eventIds(e).some((id) => family.has(id)),
    );
    const dependsOn = layer.dependencies
      .filter((d) => d.dependent === entity.id)
      .map((d) => link(d, d.provider));
    const supplies = layer.dependencies
      .filter((d) => d.provider === entity.id)
      .map((d) => link(d, d.dependent));
    const dependencies = [...dependsOn, ...supplies].map((l) => l.dependency);
    const affectedAssets = layer.entities.filter(
      (e) =>
        e.id !== entity.id &&
        family.has(e.id) &&
        (statuses.some(
          (s) => s.entityId === e.id && attackStatuses.has(key(s.status)),
        ) ||
          events.some(
            (event) => eventIds(event).includes(e.id) && confirmedAttack(event),
          )),
    );
    const sourceRefs = [
      ...new Set([
        ...refs(entity.sourceRefs),
        ...impacts.flatMap((i) => refs(i.sourceRefs)),
        ...dependencies.flatMap((d) => refs(d.sourceRefs)),
        ...statuses.flatMap((s) => refs(s.sourceRefs)),
        ...events.flatMap((e) => refs(e.sourceRefs)),
      ]),
    ];
    const group: IncidentFacilityGroup = [
      "source",
      "plant",
      "upstream",
    ].includes(role)
      ? "supply-chain"
      : ["red", "amber"].includes(state.tone)
        ? "at-risk"
        : state.line === "dashed" || state.line === "dotted"
          ? "not-affected"
          : "unmodeled";
    nodes.push({
      entity,
      state,
      role,
      group,
      impacts,
      windows: impacts
        .map((i) => i.windowHours)
        .filter(validWindow)
        .map((w) => [...w]),
      earliestWindow: earliestWindow(impacts),
      classification: capturedClassification(entity),
      idtCode: idtCode(entity),
      dependsOn,
      supplies,
      affectedAssets,
      assetStatuses: statuses,
      events,
      exclusions: exclusionRecords(entity.id, context),
      sourceRefs,
      sources: sourceLabels(sourceRefs, layer.sources),
      assumptions: [
        ...new Set([
          ...impacts.flatMap((i) => refs(i.assumptions)),
          ...dependencies.flatMap((d) => refs(d.assumptionNote)),
        ]),
      ],
      caseIds: linkedCaseIds(entity.id, incident, props.incidents),
      captured,
      recordBasis: captured ? "captured" : "reference",
      modelVersion: run?.modelVersion ?? null,
      capturedAt: run?.createdAt ?? null,
      baselineRevision: layer.baselineRevision,
      origin: originLabel(entity),
      coordinates: recordedPoint(entity),
    });
  }
  const byId = new Map(nodes.map((n) => [n.entity.id, n]));
  const edgeState = (
    source: IncidentStackNode,
    target: IncidentStackNode,
  ): Pick<IncidentStackEdge, "tone" | "line"> => {
    const greenSupply =
      (source.state.tone === "green" || source.role === "source") &&
      (target.state.tone === "green" || target.role === "source");
    return {
      tone: greenSupply
        ? (statusTone("normal") as IncidentTone)
        : target.state.tone,
      line: target.state.line,
    };
  };
  layer.dependencies.forEach((d, index) => {
    const source = byId.get(d.provider);
    const target = byId.get(d.dependent);
    if (!source || !target || source === target) return;
    edges.push({
      id: `dependency:${encodeURIComponent(d.id)}:${index}`,
      source: d.provider,
      target: d.dependent,
      label: dependencyLabel(d, layer),
      ...edgeState(source, target),
      kind: "dependency",
      dependency: d,
      captured,
      reference: !captured,
      modeled: modeledDependencies.has(d.id),
      sourceRefs: refs(d.sourceRefs),
    });
  });
  // A structural partOf record may be shown, but cannot manufacture a service dependency.
  for (const node of nodes)
    for (const parentId of refs(node.entity.partOf)) {
      const parent = byId.get(parentId);
      if (
        !parent ||
        edges.some((e) => e.source === node.entity.id && e.target === parentId)
      )
        continue;
      edges.push({
        id: `partOf:${encodeURIComponent(node.entity.id)}:${encodeURIComponent(parentId)}`,
        source: node.entity.id,
        target: parentId,
        label: "part of",
        ...edgeState(node, parent),
        kind: "structural",
        dependency: null,
        captured,
        reference: !captured,
        modeled: false,
        sourceRefs: refs(node.entity.sourceRefs),
      });
    }
  const sorted = (items: IncidentStackNode[]) =>
    [...items].sort(
      (a, b) =>
        (a.earliestWindow?.[0] ?? Infinity) -
          (b.earliestWindow?.[0] ?? Infinity) ||
        a.entity.label.localeCompare(b.entity.label) ||
        a.entity.id.localeCompare(b.entity.id),
    );
  const facilityGroups = groupIncidentFacilities(nodes);
  return {
    context,
    incident,
    incidentRecord,
    layer,
    nodes,
    edges,
    groups: {
      atRisk: sorted(nodes.filter((n) => n.group === "at-risk")),
      supplyChain: nodes
        .filter((n) => n.group === "supply-chain")
        .sort(
          (a, b) =>
            ["source", "plant", "upstream"].indexOf(a.role) -
              ["source", "plant", "upstream"].indexOf(b.role) ||
            a.entity.label.localeCompare(b.entity.label),
        ),
      notAffected: sorted(nodes.filter((n) => n.group === "not-affected")),
      unmodeled: sorted(nodes.filter((n) => n.group === "unmodeled")),
    },
    facilityGroups,
    aggregateFacilities:
      nodes.filter((n) => n.role === "dependent" || n.role === "in-area")
        .length > 12,
    sourceId,
    sourceLabel: provider?.label ?? null,
    provider,
    serviceAreas,
    serviceAreaLabel: serviceAreas.length
      ? serviceAreas.map((e) => e.label).join(" · ")
      : null,
    areaCounts,
    people:
      serviceAreas.length === serviceAreaIds.length &&
      areaCounts.length &&
      areaCounts.every((a) => a.count !== null)
        ? areaCounts.reduce((total, a) => total + a.count!, 0)
        : null,
    captured,
    run,
    infrastructureAvailable: !!provider && nodes.length > 0,
    missingRecords,
    footPrintModel,
  };
}

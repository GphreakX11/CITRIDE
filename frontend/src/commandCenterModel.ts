import type { Bootstrap, Entity, Event, Source } from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";
import { commandMetrics, orderIncidents } from "./commandMetrics.ts";
import { impactRows, snapshot } from "./prototypeViews.ts";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function sourceText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
export function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === "string" && !!item.trim(),
  );
}
export function words(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}
export function originLabel(value: unknown): string {
  const record = asRecord(value);
  const origin =
    sourceText(record.origin) ?? sourceText(record.evidenceCategory);
  if (origin) return words(origin);
  if (strings(record.handling).includes("SIMULATED")) return "simulated";
  return "Origin not recorded";
}
export function timeLabel(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return "Time not recorded";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}
export function planningWindow(value: [number, number] | null): string {
  return value ? `${value[0]}–${value[1]} scenario hours` : "Timing unknown";
}
export function capturedClassification(entity: Entity | undefined) {
  const idt = asRecord(asRecord(entity).idt);
  const path =
    idt.status === "coded"
      ? sourceText(idt.path)
      : idt.status === "below_idt_level"
        ? sourceText(idt.parentPath)
        : null;
  if (path && /^[1-9]\d*(?:\.[1-9]\d*)*$/.test(path)) {
    const sector = path.split(".")[0]!;
    return {
      key: `idt:${sector}`,
      label: `IDT sector ${sector}`,
      lineage: `Captured IDT ${path}${idt.status === "below_idt_level" ? " (parent classification)" : ""}`,
      classified: true,
    };
  }
  const type = entity?.type ?? "Unknown facility type";
  return {
    key: `unclassified:${type}`,
    label: `${words(type)} · IDT unavailable`,
    lineage: "IDT lineage not captured",
    classified: false,
  };
}

/** History is resolved exclusively from the run snapshot, never today's Bootstrap. */
export function consequenceModel(incident: CommandIncident | null) {
  const run = incident?.runSnapshot ?? null;
  const captured = snapshot(run);
  const rows = run
    ? impactRows(run).map((row) => {
        const entity = captured.entities.find(
          (item) => item.id === row.entityId,
        );
        const dependencies = row.paths.flatMap((path) =>
          path.flatMap((id) => {
            const dependency = captured.dependencies.find(
              (item) => item.id === id,
            );
            return dependency ? [dependency] : [];
          }),
        );
        return {
          ...row,
          classification: capturedClassification(entity),
          dependencies,
        };
      })
    : [];
  const groups = [...new Set(rows.map((row) => row.classification.key))].map(
    (key) => {
      const items = rows.filter((row) => row.classification.key === key);
      const earliest =
        items.find((row) => row.windowHours)?.windowHours ?? null;
      return {
        key,
        label: items[0]!.classification.label,
        count: new Set(items.map((row) => row.entityId)).size,
        earliest,
        items,
      };
    },
  );
  const seedEntity = captured.entities.find(
    (entity) => entity.id === run?.seed.provider,
  );
  const areas = strings(seedEntity?.serves);
  const populations = captured.entities.filter(
    (entity) =>
      entity.type === "PopulationGroup" &&
      strings(entity.locatedIn).some((id) => areas.includes(id)),
  );
  const areaCounts = areas.map((id) => {
    const area = captured.entities.find((entity) => entity.id === id);
    const direct = asRecord(area).peopleServed;
    const population = populations.filter((entity) => entity.locatedIn === id);
    const count =
      typeof direct === "number" && Number.isFinite(direct) && direct >= 0
        ? direct
        : population.length === 1 &&
            typeof asRecord(population[0]).count === "number" &&
            Number.isFinite(asRecord(population[0]).count) &&
            (asRecord(population[0]).count as number) >= 0
          ? (asRecord(population[0]).count as number)
          : null;
    return { id, count };
  });
  return {
    run,
    captured,
    rows,
    groups,
    areaCounts,
    sourceLabel: seedEntity?.label ?? "Source label not captured",
    facilities: new Set(rows.map((row) => row.entityId)).size,
    earliest: rows.find((row) => row.windowHours)?.windowHours ?? null,
    people:
      areaCounts.length && areaCounts.every((area) => area.count !== null)
        ? areaCounts.reduce((sum, area) => sum + area.count!, 0)
        : null,
  };
}
export type ConsequenceModel = ReturnType<typeof consequenceModel>;

export function recordedActivity(incidents: readonly CommandIncident[]) {
  return incidents
    .flatMap((incident) =>
      incident.activity.map((activity) => ({
        ...activity,
        caseId: incident.id,
        caseTitle: incident.title,
      })),
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
}
export function overviewModel(incidents: readonly CommandIncident[]) {
  const active = orderIncidents(incidents).filter(
    (incident) => incident.status !== "closed",
  );
  const models = active.map(consequenceModel);
  const areaValues = new Map<string, number | null>();
  for (const model of models)
    for (const area of model.areaCounts) {
      areaValues.set(
        area.id,
        areaValues.has(area.id) && areaValues.get(area.id) !== area.count
          ? null
          : area.count,
      );
    }
  const people =
    areaValues.size && [...areaValues.values()].every((value) => value !== null)
      ? [...areaValues.values()].reduce<number>((sum, value) => sum + value!, 0)
      : null;
  return {
    active,
    metrics: commandMetrics(incidents),
    people,
    classifiedSectors: new Set(
      models.flatMap((model) =>
        model.rows
          .filter((row) => row.classification.classified)
          .map((row) => row.classification.key),
      ),
    ).size,
    unclassifiedImpacts: models.flatMap((model) =>
      model.rows.filter((row) => !row.classification.classified),
    ).length,
    pending: active.flatMap((incident) =>
      incident.decisions
        .filter((decision) => !decision.reviewed)
        .map((decision) => ({ incident, decision })),
    ),
    facilities: models.flatMap((model, i) =>
      model.rows.map((row) => ({
        ...row,
        caseId: active[i]!.id,
        caseTitle: active[i]!.title,
      })),
    ),
    activity: recordedActivity(incidents),
  };
}
export function recordedTasks(incidents: readonly CommandIncident[]) {
  return orderIncidents(incidents).flatMap((incident) =>
    incident.tasks.map((task) => ({
      ...task,
      caseId: incident.id,
      caseTitle: incident.title,
      caseStatus: incident.status,
    })),
  );
}

/** All supplied evidence is visible; only the case's captured event is asserted to belong to it. */
export function eventTimeline(
  data: Bootstrap,
  incident: CommandIncident | null,
) {
  const events = new Map(data.events.map((event) => [event.id, event]));
  if (incident) events.set(incident.eventId, incident.eventSnapshot);
  return [...events.values()]
    .map((event) => {
      const raw = asRecord(event.rawRef);
      const timestamp = event.timestamp ?? event.eventTime;
      const relative =
        typeof event.relativeTimeHours === "number"
          ? event.relativeTimeHours
          : event.hour;
      return {
        event,
        label: event.label ?? event.title ?? "Recorded observation",
        description: event.description ?? "No narrative captured",
        time: timestamp
          ? timeLabel(timestamp)
          : typeof relative === "number"
            ? `${relative} scenario hours`
            : "Time not recorded",
        sort:
          timestamp && Number.isFinite(Date.parse(timestamp))
            ? Date.parse(timestamp)
            : typeof relative === "number"
              ? relative * 3600000
              : Infinity,
        origin: originLabel(event),
        stream: sourceText(raw.streamId),
        captured: incident?.eventId === event.id,
        techniques: strings(
          event.techniques ?? event.attackTechniques ?? event.attackTechnique,
        ),
      };
    })
    .sort((a, b) => a.sort - b.sort || a.event.id.localeCompare(b.event.id));
}
export function sourceLabels(
  refs: readonly string[],
  sources: readonly Source[],
) {
  return [...new Set(refs)].map((id) => {
    const source = sources.find((item) => item.id === id);
    return {
      id,
      label: source?.label ?? source?.title ?? "Source label not captured",
      origin: originLabel(source),
      description: source?.description ?? "Source metadata not captured",
    };
  });
}
export function contextChain(incident: CommandIncident): Entity[] {
  const context = incident.contextSnapshot;
  return [
    context.cyberAsset,
    context.physicalAsset,
    context.facility,
    context.provider,
    context.serviceArea,
  ]
    .filter((entity): entity is Entity => !!entity)
    .filter(
      (entity, index, all) =>
        all.findIndex((item) => item.id === entity.id) === index,
    );
}
export function leadershipDraft(incident: CommandIncident) {
  const model = consequenceModel(incident);
  return {
    title: incident.title,
    event:
      incident.eventSnapshot.label ??
      incident.eventSnapshot.title ??
      "Captured source event",
    description:
      incident.eventSnapshot.description ?? "No event description captured.",
    origin: originLabel(incident.eventSnapshot),
    impacts: model.rows.map(
      (row) =>
        `${row.label}: ${row.functionLabel}; ${words(row.state)} (modeled); ${planningWindow(row.windowHours)}.`,
    ),
    reviews: incident.decisions.map(
      (decision) =>
        `${decision.title}: ${decision.reviewed ? "Advisory review recorded" : "Awaiting advisory review"}${decision.reviewedAt ? ` · ${timeLabel(decision.reviewedAt)}` : ""}.`,
    ),
    tasks: incident.tasks.map(
      (task) =>
        `${task.label}: ${task.completed ? "Recorded complete" : "Recorded incomplete"}.`,
    ),
    modelVersion: model.run?.modelVersion ?? null,
    capturedAt: model.run?.createdAt ?? null,
    sourceRefs: [
      ...new Set([
        ...incident.contextSnapshot.sourceRefs,
        ...(incident.eventSnapshot.sourceRefs ?? []),
      ]),
    ],
  };
}
export function formattedBrief(
  incident: CommandIncident,
  title: string,
): string {
  const draft = leadershipDraft(incident);
  return [
    `# ${title}`,
    "Draft — not sent",
    `## ${draft.title}`,
    "## What happened",
    draft.event,
    draft.description,
    `Origin: ${draft.origin}`,
    "## So what",
    ...(draft.impacts.length
      ? draft.impacts
      : [
          "No captured consequence run; physical service effects are not established.",
        ]),
    "## Recorded next steps",
    ...draft.reviews,
    ...draft.tasks,
    "Task completion and advisory reviews do not authorize dispatch or confirm recovery.",
    "Chief response-option decisions, deployment records and contact statuses are not supplied by the current case contract.",
    `Consequence model: ${draft.modelVersion ?? "Not captured"}; capture: ${timeLabel(draft.capturedAt)}`,
    `Captured source references: ${draft.sourceRefs.join(", ") || "None recorded"}`,
    "Authority basis not configured. Policy gates not evaluated. Official TXCC performance measures are not populated.",
  ].join("\n\n");
}

export const previewAudiences = [
  "internal",
  "water",
  "health",
  "federal",
] as const;
export type PreviewAudience = (typeof previewAudiences)[number];
/** External previews are allow-listed aggregates; no identifying/free-form record text crosses this boundary. */
export function audiencePreview(
  audience: PreviewAudience,
  incident: CommandIncident,
) {
  const model = consequenceModel(incident);
  const titles = {
    internal: "TXCC internal",
    water: "Water-sector partners",
    health: "TDEM and healthcare",
    federal: "Federal partners",
  };
  const shows =
    audience === "internal"
      ? [incident.title, ...leadershipDraft(incident).impacts]
      : audience === "health"
        ? [
            `${model.facilities} facilities in captured modeled results.`,
            ...model.rows.map(
              (row) =>
                `${planningWindow(row.windowHours)} · modeled ${words(row.state)}`,
            ),
          ]
        : [
            `${model.rows.length} modeled function results in the selected captured run.`,
            `Captured consequence run: ${model.run ? "available" : "not recorded"}.`,
          ];
  return {
    audience,
    title: titles[audience],
    shows,
    notShown:
      audience === "internal"
        ? ["Raw evidence is accessed in Analyst, not in this preview."]
        : [
            "Case titles, utility/facility names and identifiers",
            "Network addresses, raw records, source identifiers and free-form notes",
            "Contact information and unrecorded analyst judgments",
          ],
    status: "Draft — not sent",
    boundary:
      "Illustrative audience preview, not an access-control or release decision. Owner consent and delivery are not configured.",
  };
}
// Events are deliberately not reclassified as incidents, compromised assets or outages.
export type RecordedEvent = Event;

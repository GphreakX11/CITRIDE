import type { Bootstrap, Entity, Event, Run } from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";
import { linkedCases } from "./investigationContext.ts";
import { graphEdges } from "./texasGraph.ts";

export function recordFields(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}
export function recordRefs(value: unknown): string[] {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [value]).filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  ];
}

/** Only hosting/containment can lift an observed event to a facility/provider.
 * No service edge, shared operator, geography, scenario or shared source can do so.
 * Ambiguous/dangling parents stop the chain; direct event references remain valid.
 */
export function eventEntityIds(
  event: Event,
  entities: readonly Entity[],
): Set<string> {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const result = new Set<string>();
  const direct = [
    event.seenOn,
    event.assetId,
    event.entityId,
    event.utilityId,
  ].flatMap(recordRefs);
  for (const id of direct) {
    let current: string | undefined = id;
    const visited = new Set<string>();
    while (current && byId.has(current) && !visited.has(current)) {
      visited.add(current);
      result.add(current);
      const entity: Entity = byId.get(current)!;
      const hostRefs = recordRefs(recordFields(entity).hostedBy);
      const inverseHosts = entities
        .filter((candidate) =>
          recordRefs(recordFields(candidate).hostsCyberAsset).includes(
            current!,
          ),
        )
        .map((candidate) => candidate.id);
      const hosts = [...new Set([...hostRefs, ...inverseHosts])];
      const parents: string[] = hosts.length
        ? hosts
        : recordRefs(recordFields(entity).partOf);
      current = parents.length === 1 ? parents[0] : undefined;
    }
  }
  return result;
}

export function entityEvents(
  data: Bootstrap,
  entityId: string | null,
): Event[] {
  if (!entityId) return [];
  return data.events
    .filter((event) => eventEntityIds(event, data.entities).has(entityId))
    .sort((a, b) => {
      const at = a.timestamp ?? a.eventTime;
      const bt = b.timestamp ?? b.eventTime;
      if (at && bt) return at.localeCompare(bt) || a.id.localeCompare(b.id);
      const ah = a.relativeTimeHours ?? a.hour;
      const bh = b.relativeTimeHours ?? b.hour;
      if (typeof ah === "number" && typeof bh === "number")
        return ah - bh || a.id.localeCompare(b.id);
      return a.id.localeCompare(b.id);
    });
}

/** Available inputs contain case-attached immutable runs, not the lab's full history. */
export function entityCaseRuns(
  incidents: readonly CommandIncident[],
  entityId: string | null,
) {
  const unique = new Map<string, Run>();
  if (!entityId) return [];
  for (const incident of incidents) {
    const run = incident.runSnapshot;
    if (run) unique.set(run.id, run);
  }
  return [...unique.values()]
    .map((run) => ({
      run,
      impacts: run.impacts.filter((impact) => {
        if (impact.entityId === entityId || run.seed.provider === entityId)
          return true;
        // Engine paths contain dependency IDs, not entity IDs. Resolve them only
        // against the captured run baseline, never today's inventory.
        const snapshot = run.baselineSnapshot;
        const dependencies =
          snapshot &&
          typeof snapshot === "object" &&
          "dependencies" in snapshot &&
          Array.isArray(snapshot.dependencies)
            ? snapshot.dependencies
            : [];
        return impact.paths.some((path) =>
          dependencies.some((dependency: unknown) => {
            if (!dependency || typeof dependency !== "object") return false;
            const record = recordFields(dependency);
            return (
              typeof record.id === "string" &&
              path.includes(record.id) &&
              (record.provider === entityId || record.dependent === entityId)
            );
          }),
        );
      }),
    }))
    .filter(({ impacts }) => impacts.length > 0)
    .sort(
      (a, b) =>
        (b.run.createdAt ?? "").localeCompare(a.run.createdAt ?? "") ||
        a.run.id.localeCompare(b.run.id),
    );
}

/** Explicit served counts only. An area's population or an occupant total is not people served. */
export function recordedPeopleServed(entity: Entity): number | null {
  const count = recordFields(entity).peopleServed;
  return typeof count === "number" && Number.isFinite(count) && count >= 0
    ? count
    : null;
}

export function analystEntityModel(
  data: Bootstrap,
  incidents: CommandIncident[],
  entityId: string | null,
) {
  const entity = data.entities.find((item) => item.id === entityId) ?? null;
  const edges = graphEdges(data);
  const dependencies = edges.filter(
    (edge) =>
      edge.kind === "dependency" &&
      (edge.source === entityId || edge.target === entityId),
  );
  const suppliers = dependencies.filter((edge) => edge.target === entityId);
  const supplies = dependencies.filter((edge) => edge.source === entityId);
  const context = edges.filter(
    (edge) =>
      edge.kind !== "dependency" &&
      (edge.source === entityId || edge.target === entityId),
  );
  const dependencyIds = new Set(
    dependencies.map((edge) => edge.dependency!.id),
  );
  const assumptions = entity
    ? data.assumptions.filter(
        (item) =>
          recordRefs(item.entityId).includes(entity.id) ||
          recordRefs(item.entityRefs).includes(entity.id) ||
          recordRefs(item.dependencyId).some((id) => dependencyIds.has(id)),
      )
    : [];
  const sourceRefs = entity
    ? [
        ...new Set([
          ...entity.sourceRefs,
          ...dependencies.flatMap((edge) => edge.sourceRefs),
          ...context.flatMap((edge) => edge.sourceRefs),
          ...assumptions.flatMap((item) => recordRefs(item.sourceRefs)),
        ]),
      ]
    : [];
  return {
    entity,
    suppliers,
    supplies,
    context,
    assumptions,
    sources: sourceRefs.map((id) => ({
      id,
      record: data.sources.find((source) => source.id === id) ?? null,
    })),
    cases: entity ? linkedCases(incidents, entity.id) : [],
    events: entity ? entityEvents(data, entity.id) : [],
    runs: entity ? entityCaseRuns(incidents, entity.id) : [],
    peopleServed: entity ? recordedPeopleServed(entity) : null,
  };
}

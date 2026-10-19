import type { Bootstrap, Event } from "./types.ts";
import type { RecordItem } from "./scriptedTypes.ts";
import type { ConsequenceProjection } from "./consequencesModel.ts";
import { eventEntityIds, recordRefs } from "./analystEntityModel.ts";

/** A late response from another selection must never become this incident's analysis. */
export function incidentProjection(
  incident: RecordItem | null,
  projection: ConsequenceProjection | null,
) {
  return incident && projection?.incident?.id === incident.id
    ? projection
    : null;
}

/** Only explicit register event links seed observation scope. Supply propagation is
 * directed downstream; geography, shared sources/operators and sibling assets do
 * not turn into evidence. Projection assets are modeled context, not observations.
 */
export function analystIncidentScreenModel(
  data: Bootstrap,
  incident: RecordItem | null,
  projection: ConsequenceProjection | null = null,
) {
  const linked = new Set(recordRefs(incident?.linkedEventIds));
  const events = data.events.filter((event) => linked.has(event.id));
  const observedEntityIds = new Set(
    events.flatMap((event) => [...eventEntityIds(event, data.entities)]),
  );
  const entityIds = new Set(observedEntityIds);
  const dependencyIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of data.dependencies) {
      if (!entityIds.has(dependency.provider)) continue;
      dependencyIds.add(dependency.id);
      if (!entityIds.has(dependency.dependent)) {
        entityIds.add(dependency.dependent);
        changed = true;
      }
    }
  }
  const currentProjection = incidentProjection(incident, projection);
  for (const node of currentProjection?.nodes ?? []) entityIds.add(node.id);
  if (currentProjection?.source) entityIds.add(currentProjection.source.id);
  for (const system of currentProjection?.sourceSystems ?? [])
    entityIds.add(system.id);
  // Include explicitly modeled relationships only when both actual endpoints are in scope.
  for (const dependency of data.dependencies) {
    if (
      entityIds.has(dependency.provider) &&
      entityIds.has(dependency.dependent)
    )
      dependencyIds.add(dependency.id);
  }
  return {
    events,
    missingEventIds: [...linked].filter(
      (id) => !events.some((event) => event.id === id),
    ),
    observedEntityIds,
    entities: data.entities.filter((entity) => entityIds.has(entity.id)),
    dependencies: data.dependencies.filter((dependency) =>
      dependencyIds.has(dependency.id),
    ),
    projection: currentProjection,
  };
}

export interface IncidentTechnique {
  id: string;
  name?: string;
  tactic?: string;
}
export function incidentEventTechniques(event: Event): IncidentTechnique[] {
  const values = Array.isArray(event.attackTechniques)
    ? event.attackTechniques
    : [];
  return values.flatMap((value) => {
    if (typeof value === "string") return [{ id: value }];
    if (!value || typeof value !== "object" || typeof value.id !== "string")
      return [];
    return [
      {
        id: value.id,
        name: typeof value.name === "string" ? value.name : undefined,
        tactic: typeof value.tactic === "string" ? value.tactic : undefined,
      },
    ];
  });
}

export const analystNoCaseViews = [
  "cop",
  "cyber",
  "consequence",
  "coordination",
  "uctf",
  "case-file",
] as const;
export type AnalystNoCaseView = (typeof analystNoCaseViews)[number];
export function handlesAnalystIncidentView(
  view: string,
  activeCase: unknown,
): view is AnalystNoCaseView {
  return (
    !activeCase && analystNoCaseViews.some((candidate) => candidate === view)
  );
}

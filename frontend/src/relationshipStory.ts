import type { Entity } from "./types";
import type { MapEdge } from "./texasGraph";
import type { RelationshipDirection } from "./mapViewState";

/** Only recorded, direct service dependencies: ownership and proximity are not supply. */
export function serviceConnections(
  edges: readonly MapEdge[],
  selectedId: string,
  direction: RelationshipDirection = "all",
): MapEdge[] {
  return edges.filter(
    (edge) =>
      edge.kind === "dependency" &&
      edge.source !== edge.target &&
      ((direction !== "dependents" && edge.target === selectedId) ||
        (direction !== "suppliers" && edge.source === selectedId)),
  );
}

export function relationshipStory(
  edges: readonly MapEdge[],
  selectedId: string,
  entities: readonly Entity[],
) {
  const names = new Map(entities.map((entity) => [entity.id, entity.label]));
  // Do not let dangling endpoints become a supplier or a supported entity.
  const valid = edges.filter(
    (edge) => names.has(edge.source) && names.has(edge.target),
  );
  const suppliers = serviceConnections(valid, selectedId, "suppliers");
  const dependents = serviceConnections(valid, selectedId, "dependents");
  const supplierIds = [...new Set(suppliers.map((edge) => edge.source))];
  const dependentIds = [...new Set(dependents.map((edge) => edge.target))];
  const list = (ids: string[]) =>
    ids.map((id) => names.get(id) ?? id).join(", ");
  const selectedName = names.get(selectedId) ?? selectedId;
  const summary = `${selectedName} has ${supplierIds.length} recorded direct ${supplierIds.length === 1 ? "supplier" : "suppliers"}${supplierIds.length ? `: ${list(supplierIds)}` : ""}. It directly supports ${dependentIds.length} ${dependentIds.length === 1 ? "entity" : "entities"}${dependentIds.length ? `: ${list(dependentIds)}` : ""}.`;
  return {
    suppliers,
    dependents,
    supplierIds,
    dependentIds,
    summary,
    context: valid.filter(
      (edge) =>
        edge.kind !== "dependency" &&
        (edge.source === selectedId || edge.target === selectedId),
    ),
  };
}

/** Directional views keep the selected entity even when it has no service links. */
export function serviceNeighborhood(
  edges: readonly MapEdge[],
  selectedId: string,
  direction: RelationshipDirection,
): Set<string> {
  return new Set([
    selectedId,
    ...serviceConnections(edges, selectedId, direction).flatMap((edge) => [
      edge.source,
      edge.target,
    ]),
  ]);
}

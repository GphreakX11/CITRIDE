import type { Entity, ServiceFunction } from "./types";
import type { MapEdge } from "./texasGraph";
import type { RelationshipDirection } from "./mapViewState";
import { displayText } from "./presentation.ts";

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
const englishList = (items: string[]) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const plain = (value: string) =>
  value.replaceAll("_", " ").replaceAll("-", " ");
const serviceName = (value?: string) =>
  value === "water_treatment"
    ? "treated water"
    : value
      ? plain(value)
      : "a recorded service";

export function relationshipStory(
  edges: readonly MapEdge[],
  selectedId: string,
  entities: readonly Entity[],
  functions: readonly ServiceFunction[] = [],
) {
  const names = new Map(
    entities.map((entity) => [entity.id, displayText(entity.label)]),
  );
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
  const advancedSummary = `${selectedName} has ${supplierIds.length} recorded direct ${supplierIds.length === 1 ? "supplier" : "suppliers"}${supplierIds.length ? `: ${list(supplierIds)}` : ""}. It directly supports ${dependentIds.length} ${dependentIds.length === 1 ? "entity" : "entities"}${dependentIds.length ? `: ${list(dependentIds)}` : ""}.`;
  const functionFor = (edge: MapEdge) =>
    functions.find((f) => f.id === edge.dependency?.dependentFunction);
  const firePressure = (edge: MapEdge) => {
    const d = edge.dependency;
    return (
      !!d &&
      (functionFor(edge)?.service === "fire_flow" ||
        d.dependentFunction === "fire-flow") &&
      d.lossTypes.includes("low_pressure") &&
      !d.lossTypes.includes("unsafe_water")
    );
  };
  const detail = (edge: MapEdge) => {
    const d = edge.dependency;
    if (!d) return edge.label;
    if (firePressure(edge))
      return "needs water pressure; unsafe water alone does not affect fire flow";
    const f = functionFor(edge);
    const functionLabel = (
      f?.label ?? plain(d.dependentFunction)
    ).toLowerCase();
    const min = d.usableBackupMinHours,
      max = d.usableBackupMaxHours;
    const reserve =
      min === null || max === null
        ? "reserve not established"
        : `${min === max ? `about ${min}` : `${min}–${max}`} h${d.requiredService === "treated_water" && d.validForLossTypes.includes("unsafe_water") ? " of clean-water" : ""} reserve`;
    return `${functionLabel} · ${reserve}`;
  };
  const dependentRows = dependentIds.map((entityId) => ({
    entityId,
    edges: dependents.filter((edge) => edge.target === entityId),
    summary: `${names.get(entityId)} · ${[...new Set(dependents.filter((edge) => edge.target === entityId).map(detail))].join("; ")}`,
  }));
  const sentences: string[] = [];
  if (dependentIds.length) {
    const services = [
      ...new Set(
        dependents.map((edge) => serviceName(edge.dependency?.requiredService)),
      ),
    ];
    sentences.push(
      `${selectedName} supplies ${englishList(services)} to ${dependentIds.length} ${dependentIds.length === 1 ? "facility" : "facilities"}: ${englishList(dependentIds.map((id) => names.get(id)!))}.`,
    );
  }
  for (const supplierId of supplierIds) {
    const edge = suppliers.find((edge) => edge.source === supplierId)!;
    const prefix = sentences.length ? "It" : selectedName;
    const upstream = serviceConnections(valid, supplierId, "suppliers").filter(
      (e) => e.source !== selectedId,
    );
    const power = upstream.filter(
      (e) => e.dependency?.requiredService === "electricity",
    );
    const rest = upstream.filter(
      (e) => e.dependency?.requiredService !== "electricity",
    );
    const clauses = [
      ...(power.length
        ? [
            `runs on power from ${englishList([...new Set(power.map((e) => names.get(e.source)!))])}`,
          ]
        : []),
      ...rest.map(
        (e) =>
          `gets ${serviceName(e.dependency?.requiredService)} from ${names.get(e.source)}`,
      ),
    ];
    sentences.push(
      `${prefix} gets ${serviceName(edge.dependency?.requiredService)} from ${names.get(supplierId)}${clauses.length ? `, which ${englishList(clauses)}` : ""}.`,
    );
  }
  if (suppliers.some(firePressure))
    sentences.push(
      `${sentences.length ? "It" : selectedName} needs water pressure; unsafe water alone does not affect fire flow.`,
    );
  if (!sentences.length) {
    const areas = valid.filter(
      (e) =>
        e.source === selectedId &&
        e.relation === "locatedIn" &&
        entities.find((entity) => entity.id === e.target)?.type ===
          "ServiceArea",
    );
    sentences.push(
      areas.length
        ? `${selectedName} is inside ${englishList(areas.map((e) => names.get(e.target)!))}, but no service dependency is recorded.`
        : `${selectedName} has no recorded service dependencies.`,
    );
  }
  return {
    suppliers,
    dependents,
    supplierIds,
    dependentIds,
    summary: sentences.join(" "),
    advancedSummary,
    dependentRows,
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

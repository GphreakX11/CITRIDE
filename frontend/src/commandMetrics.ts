import type { CommandIncident, CommandMetrics } from "./commandTypes.ts";
import type { Entity } from "./types.ts";

const priorities = { critical: 0, high: 1, medium: 2, low: 3 } as const;
export function orderIncidents(
  incidents: readonly CommandIncident[],
): CommandIncident[] {
  return [...incidents].sort(
    (a, b) =>
      Number(a.status === "closed") - Number(b.status === "closed") ||
      priorities[a.priority] - priorities[b.priority] ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
export function commandMetrics(
  incidents: readonly CommandIncident[],
): CommandMetrics {
  const active = incidents.filter((incident) => incident.status !== "closed");
  const durations = incidents
    .flatMap((incident) => {
      const created = Date.parse(incident.createdAt);
      const reviews = incident.decisions
        .filter((decision) => decision.reviewed && decision.reviewedAt)
        .map((decision) => Date.parse(decision.reviewedAt!))
        .filter(Number.isFinite);
      if (!Number.isFinite(created) || !reviews.length) return [];
      const duration = (Math.min(...reviews) - created) / 1000;
      return duration >= 0 ? [duration] : [];
    })
    .sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  const median = durations.length
    ? durations.length % 2
      ? durations[middle]!
      : (durations[middle - 1]! + durations[middle]!) / 2
    : null;
  return {
    activeIncidents: active.length,
    pendingDecisions: active.reduce(
      (count, item) =>
        count + item.decisions.filter((decision) => !decision.reviewed).length,
      0,
    ),
    pendingTasks: active.reduce(
      (count, item) =>
        count + item.tasks.filter((task) => !task.completed).length,
      0,
    ),
    modeledFunctions: new Set(
      active.flatMap((item) =>
        item.decisions.map((decision) => decision.functionId),
      ),
    ).size,
    savedCoordinationNotes: incidents.reduce(
      (count, item) => count + item.notes.length,
      0,
    ),
    closedIncidents: incidents.filter((item) => item.status === "closed")
      .length,
    firstReviewMedianSeconds: median,
  };
}
export function incidentBrief(incident: CommandIncident) {
  return {
    format: "citride-case-brief/v1",
    purpose: "advisory_casework_handoff",
    externalDelivery: "not_sent",
    authorityBasis: "not_configured",
    policyGateStatus: "not_evaluated",
    incident: JSON.parse(JSON.stringify(incident)) as CommandIncident,
  };
}
export interface ReferenceGeometry {
  entity: Entity;
  kind: "Point" | "Polygon";
  points: [number, number][];
}
function point(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [x, y] = value;
  return typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= 180 &&
    Math.abs(y) <= 90
    ? [x, y]
    : null;
}
export function referenceGeometries(
  entities: readonly Entity[],
): ReferenceGeometry[] {
  return entities.flatMap((entity): ReferenceGeometry[] => {
    const geometry = (
      entity as Entity & {
        geometry?: { type?: unknown; coordinates?: unknown };
      }
    ).geometry;
    if (!geometry) return [];
    if (geometry.type === "Point") {
      const coordinates = point(geometry.coordinates);
      return coordinates
        ? [{ entity, kind: "Point", points: [coordinates] }]
        : [];
    }
    if (geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates))
      return [];
    const ring = geometry.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 4) return [];
    const coordinates = ring.map(point);
    if (coordinates.some((entry) => entry === null)) return [];
    const points = coordinates as [number, number][];
    if (
      points[0]![0] !== points.at(-1)![0] ||
      points[0]![1] !== points.at(-1)![1]
    )
      return [];
    return [{ entity, kind: "Polygon", points }];
  });
}
export function geometryLayout(features: readonly ReferenceGeometry[]) {
  const points = features.flatMap((feature) => feature.points);
  if (!points.length) return () => [400, 200] as [number, number];
  const xs = points.map(([x]) => x),
    ys = points.map(([, y]) => y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  return ([x, y]: [number, number]): [number, number] => [
    40 + ((x - minX) / (maxX - minX || 1)) * 720,
    360 - ((y - minY) / (maxY - minY || 1)) * 320,
  ];
}

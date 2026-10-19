import type { Bootstrap, Dependency, Entity } from "./types";

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kind: "dependency" | "structural" | "spatial";
  relation: string;
  label: string;
  sourceRefs: string[];
  dependency?: Dependency;
}

export interface MapPosition {
  x: number;
  y: number;
  placement: "illustrative" | "source-coordinate";
}

const relations = [
  "partOf",
  "operatedBy",
  "hostsCyberAsset",
  "hostedBy",
  "serves",
  "locatedIn",
] as const;

// Bootstrap entities retain fields that are not yet declared in the shared UI type.
function record(entity: Entity): Record<string, unknown> {
  return entity as unknown as Record<string, unknown>;
}

function refs(value: unknown): string[] {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [value]).filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  ];
}

function edgeId(kind: string, ...parts: string[]): string {
  return `${kind}:${parts.map(encodeURIComponent).join(":")}`;
}

function label(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
}

/** Directed operational records and explicit context only; geography never creates dependencies. */
export function graphEdges(data: Bootstrap): MapEdge[] {
  const ids = new Set(data.entities.map((entity) => entity.id));
  const edges = new Map<string, MapEdge>();
  const valid = (source: string, target: string) =>
    source !== target && ids.has(source) && ids.has(target);
  for (const dependency of data.dependencies) {
    const { provider: source, dependent: target } = dependency;
    if (!valid(source, target)) continue;
    const id = edgeId("dependency", dependency.id, source, target);
    if (edges.has(id)) continue;
    edges.set(id, {
      id,
      source,
      target,
      kind: "dependency",
      relation: "dependency",
      label: label(dependency.requiredService),
      sourceRefs: refs(dependency.sourceRefs),
      dependency,
    });
  }
  for (const entity of data.entities) {
    for (const relation of relations) {
      for (const target of refs(record(entity)[relation])) {
        if (!valid(entity.id, target)) continue;
        const kind =
          relation === "locatedIn" || relation === "serves"
            ? "spatial"
            : "structural";
        const id = edgeId(kind, entity.id, relation, target);
        if (!edges.has(id))
          edges.set(id, {
            id,
            source: entity.id,
            target,
            kind,
            relation,
            label: label(relation),
            sourceRefs: refs(entity.sourceRefs),
          });
      }
    }
  }
  return [...edges.values()];
}

function point(entity: Entity): [number, number] | undefined {
  const geometry = record(entity).geometry;
  if (!geometry || typeof geometry !== "object") return;
  const { type, coordinates } = geometry as Record<string, unknown>;
  if (type !== "Point" || !Array.isArray(coordinates) || coordinates.length < 2)
    return;
  const [lon, lat] = coordinates;
  if (
    typeof lon !== "number" ||
    typeof lat !== "number" ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat)
  )
    return;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return;
  return [lon, lat];
}

/** Abstract context stays hidden unless it is an explicit, valid dependency endpoint. */
export function infrastructureIds(data: Bootstrap): string[] {
  const endpoints = new Set(
    graphEdges(data)
      .filter((edge) => edge.kind === "dependency")
      .flatMap((edge) => [edge.source, edge.target]),
  );
  return [
    ...new Set(
      data.entities
        .filter(
          (entity) =>
            endpoints.has(entity.id) ||
            entity.type === "WaterServiceProvider" ||
            (!/Area|Organization|PopulationGroup|Cyber/i.test(entity.type) &&
              point(entity) !== undefined),
        )
        .map((entity) => entity.id),
    ),
  ];
}

/** One-hop incident edges, preserving their original direction and record order. */
export function connectedEdges(
  edges: readonly MapEdge[],
  id: string,
): MapEdge[] {
  return edges.filter((edge) => edge.source === id || edge.target === id);
}

import displayCatalog from "../../data/reference/display_catalog.json" with { type: "json" };
const referencePositions: Readonly<Record<string, readonly [number, number]>> =
  Object.fromEntries(Object.entries(displayCatalog.schematicPositions)
    .map(([id, point]) => [id, [point[0], point[1]] as const]));

// Check structured provenance, including nested metadata, without interpreting narrative notes.
function synthetic(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string")
    return ["synthetic_schematic", "simulated"].includes(value.toLowerCase());
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(
    ([key, item]) =>
      (["synthetic_schematic", "simulated"].includes(key.toLowerCase()) &&
        item === true) ||
      synthetic(item, seen),
  );
}

function hash(id: string): number {
  let result = 2166136261;
  for (const character of id)
    result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * View-only topology. Illustrative positions are never written into source entities.
 * Unmarked Texas Points override reference slots and use the backdrop's exact projection.
 * Context follows shortest explicit parent/host/operator/provider chains, with stable rings.
 */
export function mapPositions(
  entities: readonly Entity[],
): Map<string, MapPosition> {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const ids = [...byId.keys()].sort(compare);
  const positions = new Map<string, MapPosition>();
  const distances = new Map<string, number>();
  const candidates = new Map<string, string[]>();
  const children = new Map<string, string[]>();

  for (const id of ids) {
    const entity = byId.get(id)!;
    const coordinates = point(entity);
    if (coordinates && !synthetic(record(entity))) {
      const [lon, lat] = coordinates;
      if (lon >= -106.7 && lon <= -93.4 && lat >= 25.7 && lat <= 36.6) {
        positions.set(id, {
          x: 90 + ((lon + 106.7) / 13.3) * 780,
          y: 60 + ((36.6 - lat) / 10.9) * 600,
          placement: "source-coordinate",
        });
      }
    }
    const reference = referencePositions[id];
    if (!positions.has(id) && reference)
      positions.set(id, {
        x: reference[0],
        y: reference[1],
        placement: "illustrative",
      });
    if (positions.has(id)) distances.set(id, 0);

    const own = record(entity);
    const parents = ["partOf", "hostedBy", "operatedBy"].flatMap((key) =>
      refs(own[key]).sort(compare),
    );
    // The inverse of a declared host, operator, or service-area relation is useful
    // for placement, but is NOT emitted as an inferred relationship or dependency.
    const inverse = ids
      .filter((other) => {
        const target = record(byId.get(other)!);
        return ["hostsCyberAsset", "operatedBy", "serves"].some((key) =>
          refs(target[key]).includes(id),
        );
      })
      .sort(
        (a, b) =>
          Number(byId.get(b)!.type === "WaterServiceProvider") -
            Number(byId.get(a)!.type === "WaterServiceProvider") ||
          compare(a, b),
      );
    const links = [
      ...new Set([
        ...parents,
        ...inverse,
        ...refs(own.locatedIn).sort(compare),
      ]),
    ].filter((parent) => parent !== id && byId.has(parent));
    candidates.set(id, links);
    for (const parent of links)
      children.set(parent, [...(children.get(parent) ?? []), id]);
  }

  // Multi-source breadth-first traversal avoids recursion, including cyclic chains.
  const propagate = (roots: string[]) => {
    const queue = [...roots];
    for (let index = 0; index < queue.length; index++) {
      const parent = queue[index];
      for (const child of children.get(parent) ?? []) {
        if (distances.has(child)) continue;
        distances.set(child, distances.get(parent)! + 1);
        queue.push(child);
      }
    }
  };
  propagate([...positions.keys()]);
  const occupied = new Set(
    [...positions.values()].map(({ x, y }) => `${x},${y}`),
  );
  // Components with no geographic/reference anchor get an explicitly illustrative root.
  for (const id of ids) {
    if (distances.has(id)) continue;
    const value = hash(id);
    let x = 300 + (value % 360);
    let y = 220 + ((value >>> 10) % 280);
    // Different IDs may hash to the same slot; only illustrative roots can move.
    while (occupied.has(`${x},${y}`)) {
      x += 0.125;
      if (x > 900) {
        x = 100;
        y = y >= 650 ? 100 : y + 0.125;
      }
    }
    occupied.add(`${x},${y}`);
    positions.set(id, { x, y, placement: "illustrative" });
    distances.set(id, 0);
    propagate([id]);
  }
  const ringCounts = new Map<string, number>();
  const unresolved = ids
    .filter((id) => !positions.has(id))
    .sort((a, b) => distances.get(a)! - distances.get(b)! || compare(a, b));
  for (const id of unresolved) {
    const parent = candidates
      .get(id)!
      .find(
        (candidate) => distances.get(candidate) === distances.get(id)! - 1,
      )!;
    const center = positions.get(parent)!;
    const slot = ringCounts.get(parent) ?? 0;
    ringCounts.set(parent, slot + 1);
    const radius = 42 + Math.min(5, Math.floor(slot / 10)) * 8;
    let attempt = 0;
    let x: number, y: number;
    do {
      const angle =
        ((hash(parent) % 360) * Math.PI) / 180 +
        (slot * Math.PI * 2) / 10 +
        attempt * 2.399963229728653;
      x = Math.max(20, Math.min(940, center.x + radius * Math.cos(angle)));
      y = Math.max(20, Math.min(700, center.y + radius * Math.sin(angle)));
      attempt++;
    } while (occupied.has(`${x},${y}`));
    occupied.add(`${x},${y}`);
    positions.set(id, { x, y, placement: "illustrative" });
  }
  return new Map(ids.map((id) => [id, positions.get(id)!]));
}

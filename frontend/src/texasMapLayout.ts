import { TEXAS_PATH } from "./texasOutline.ts";
import type { IncidentAnchor, IncidentMarker } from "./incidentMarkerLayout.ts";

type Point = { x: number; y: number };

/** All coordinates are illustrative schematic positions, never geolocations. */
export interface TexasIncidentMarker extends IncidentMarker {
  /** Safe presentation anchor, NOT the authored source point. Do not infer a location. */
  anchorX: number;
  anchorY: number;
  sourceAdjusted: boolean;
  indicative: true;
}

/** Capacity is the safe row-packing capacity, not a claim of optimal packing. */
export class TexasMarkerCapacityError extends RangeError {
  readonly requested: number;
  readonly capacity: number;
  readonly width: number;
  readonly height: number;
  readonly markerSize: number;

  constructor(
    requested: number,
    capacity: number,
    width: number,
    height: number,
    markerSize: number,
  ) {
    super(
      `Texas schematic fits ${capacity} safely spaced ${markerSize}px markers in ${width}×${height}px; requested ${requested}. Use a larger fitted state or an explicit list/aggregate, not overlapping markers. Height alone cannot enlarge a width-limited state.`,
    );
    this.name = "TexasMarkerCapacityError";
    this.requested = requested;
    this.capacity = capacity;
    this.width = width;
    this.height = height;
    this.markerSize = markerSize;
  }
}

// Parse the actual vendored linear boundary, rather than duplicating a rough
// silhouette or maintaining an unrelated rectangle. Fail if its format changes.
const commands = TEXAS_PATH.match(/[A-Za-z]/g) ?? [];
if (commands.some((command) => !["M", "L", "Z"].includes(command))) {
  throw new Error("Texas marker containment requires a linear TEXAS_PATH");
}
const polygon: Point[] = [...TEXAS_PATH.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(
  (match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }),
);
if (polygon.length < 3) throw new Error("Texas boundary is missing");
const edges = polygon.map(
  (point, index) => [point, polygon[(index + 1) % polygon.length]] as const,
);

function validateViewport(width: number, height: number, markerSize = 44) {
  if (
    ![width, height, markerSize].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new RangeError(
      "Texas viewport dimensions and marker size must be finite and positive",
    );
  }
}

/** Percentages refer to the original 1000×700 SVG, fitted xMidYMid meet.
 * This is the RAW authored schematic point and can lie outside Texas. Never
 * draw an unqualified location dot or leader from this point. No geocoding.
 */
export function projectTexasPoint(
  point: Point,
  width: number,
  height: number,
): Point {
  validateViewport(width, height);
  if (![point.x, point.y].every(Number.isFinite)) {
    throw new TypeError("Texas schematic coordinates must be finite");
  }
  const scale = Math.min(width / 1000, height / 700);
  const projected = {
    x: (width - 1000 * scale) / 2 + point.x * (10 * scale),
    y: (height - 700 * scale) / 2 + point.y * (7 * scale),
  };
  if (![projected.x, projected.y].every(Number.isFinite)) {
    throw new RangeError(
      "Texas schematic projection exceeds finite coordinates",
    );
  }
  return projected;
}

function inside(point: Point): boolean {
  let result = false;
  for (const [a, b] of edges) {
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y)
    )
      result = !result;
  }
  return result;
}

// Slab clipping catches a boundary crossing ANY part of the square, including
// coastal concavities that a corner-only test would incorrectly accept.
function boundaryTouchesSquare(
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  for (const [a, b] of edges) {
    let low = 0;
    let high = 1;
    let misses = false;
    for (const [start, delta, min, max] of [
      [a.x, b.x - a.x, left, right],
      [a.y, b.y - a.y, top, bottom],
    ]) {
      if (delta === 0) {
        if (start < min || start > max) {
          misses = true;
          break;
        }
      } else {
        const first = (min - start) / delta;
        const second = (max - start) / delta;
        low = Math.max(low, Math.min(first, second));
        high = Math.min(high, Math.max(first, second));
        if (low > high) {
          misses = true;
          break;
        }
      }
    }
    if (!misses) return true;
  }
  return false;
}

function containsSquare(point: Point, half: number): boolean {
  const left = point.x - half,
    right = point.x + half;
  const top = point.y - half,
    bottom = point.y + half;
  return (
    inside({ x: left, y: top }) &&
    inside({ x: right, y: top }) &&
    inside({ x: left, y: bottom }) &&
    inside({ x: right, y: bottom }) &&
    !boundaryTouchesSquare(left, top, right, bottom)
  );
}

/** Validate the entire CSS square plus 2px inset against the actual polygon. */
export function texasContainsMarker(
  point: Point,
  width: number,
  height: number,
  markerSize = 44,
): boolean {
  validateViewport(width, height, markerSize);
  if (![point.x, point.y].every(Number.isFinite)) return false;
  const scale = Math.min(width / 1000, height / 700);
  return containsSquare(
    {
      x: (point.x - (width - 1000 * scale) / 2) / scale,
      y: (point.y - (height - 700 * scale) / 2) / scale,
    },
    (markerSize / 2 + 2) / scale,
  );
}

type Packing = { rows: Point[][]; candidates: Point[] };
const packingCache = new Map<string, Packing>();

/** Sample 24 row phases. Every selected row is markerSize+4 apart and each
 * row is left-packed only from fully contained candidates. Unlike per-marker
 * greedy displacement, prepacking cannot strand later coincident anchors.
 */
function packing(width: number, height: number, markerSize: number): Packing {
  const key = `${width},${height},${markerSize}`;
  const cached = packingCache.get(key);
  if (cached) return cached;
  const scale = Math.min(width / 1000, height / 700);
  const ox = (width - 1000 * scale) / 2,
    oy = (height - 700 * scale) / 2;
  const half = (markerSize / 2 + 2) / scale;
  const spacing = (markerSize + 4 + 1e-6) / scale;
  const step = spacing / 24;
  const minX = Math.min(...polygon.map((p) => p.x)) + half;
  const maxX = Math.max(...polygon.map((p) => p.x)) - half;
  const minY = Math.min(...polygon.map((p) => p.y)) + half;
  const maxY = Math.max(...polygon.map((p) => p.y)) - half;
  const rows: Point[][] = [];
  const candidates: Point[] = [];
  for (let phase = 0; phase < 24; phase++) {
    const sites: Point[] = [];
    for (let y = minY + phase * step; y <= maxY; y += spacing) {
      let lastX = -Infinity;
      for (let x = minX; x <= maxX; x += step) {
        if (!containsSquare({ x, y }, half + 1e-7)) continue;
        const candidate = { x: ox + x * scale, y: oy + y * scale };
        candidates.push(candidate);
        // A small conservative tolerance ensures CSS spacing is never short.
        if (x - lastX >= spacing - 1e-7) {
          sites.push(candidate);
          lastX = x;
        }
      }
    }
    rows.push(sites);
  }
  const result = { rows, candidates };
  if (packingCache.size >= 8)
    packingCache.delete(packingCache.keys().next().value!);
  packingCache.set(key, result);
  return result;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function nearest(point: Point, candidates: readonly Point[]): Point {
  let best = candidates[0];
  let score = Infinity;
  for (const candidate of candidates) {
    const next = distance(point, candidate);
    if (next < score) {
      best = candidate;
      score = next;
    }
  }
  return best;
}

/** Safe indicative presentation anchor. Does not alter the record or claim a
 * geolocation. Even two safe endpoints can cross a concave boundary: omit
 * source leader lines, or clip them to TEXAS_PATH in the rendering layer.
 */
export function containedTexasAnchor(
  point: Point,
  width: number,
  height: number,
  markerSize = 44,
): Point & { adjusted: boolean; indicative: true } {
  validateViewport(width, height, markerSize);
  const source = projectTexasPoint(point, width, height);
  if (texasContainsMarker(source, width, height, markerSize))
    return { ...source, adjusted: false, indicative: true };
  const candidates = packing(width, height, markerSize).candidates;
  if (!candidates.length)
    throw new TexasMarkerCapacityError(1, 0, width, height, markerSize);
  return { ...nearest(source, candidates), adjusted: true, indicative: true };
}

/** CSS-pixel centers for a 1000×700 Texas SVG fitted xMidYMid meet.
 * Returns input order; placement is stable by ID even when input is reordered.
 * Full markerSize squares + 2px inset are inside the exact state polygon;
 * pairs have >= markerSize+4 separation along at least one axis. SourceX/Y
 * always retain the ORIGINAL uniformly projected point; anchorX/Y are safe
 * indicative alternatives. Offsets are display-minus-original-source.
 * No records mutate. Throws TexasMarkerCapacityError rather than overlapping,
 * dropping records or misrepresenting a dense set. Caller must show a list or
 * enlarge the actual fitted state (more height alone may not help).
 */
export function texasMarkerLayout(
  anchors: readonly IncidentAnchor[],
  width: number,
  height: number,
  markerSize = 44,
): TexasIncidentMarker[] {
  validateViewport(width, height, markerSize);
  const ids = new Set<string>();
  const sources = anchors.map((anchor) => {
    if (ids.has(anchor.id))
      throw new TypeError(`Duplicate Texas marker ID: ${anchor.id}`);
    ids.add(anchor.id);
    return { id: anchor.id, ...projectTexasPoint(anchor, width, height) };
  });
  if (!sources.length) return [];
  const packed = packing(width, height, markerSize);
  const capacity = Math.max(...packed.rows.map((row) => row.length));
  const spacing = markerSize + 4;
  const alreadySafe = sources.every(
    (source, index) =>
      texasContainsMarker(source, width, height, markerSize) &&
      sources
        .slice(0, index)
        .every(
          (other) =>
            Math.abs(source.x - other.x) >= spacing ||
            Math.abs(source.y - other.y) >= spacing,
        ),
  );
  // Safe authored positions need no displacement, even if this regular row
  // packing would have a lower capacity than their irregular arrangement.
  let targets = new Map<string, Point>();
  if (alreadySafe)
    targets = new Map(sources.map((source) => [source.id, source]));
  else {
    if (sources.length > capacity)
      throw new TexasMarkerCapacityError(
        sources.length,
        capacity,
        width,
        height,
        markerSize,
      );
    const ordered = [...sources].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    let bestCost = Infinity;
    for (const sites of packed.rows) {
      if (sites.length < sources.length) continue;
      const remaining = [...sites];
      const placed = new Map<string, Point>();
      let cost = 0;
      for (const source of ordered) {
        const target = nearest(source, remaining);
        remaining.splice(remaining.indexOf(target), 1);
        placed.set(source.id, target);
        cost += distance(source, target);
      }
      if (cost < bestCost) {
        targets = placed;
        bestCost = cost;
      }
    }
  }
  return sources.map((source) => {
    const target = targets.get(source.id)!;
    const safe = texasContainsMarker(source, width, height, markerSize);
    const anchor = safe ? source : nearest(source, packed.candidates);
    return {
      id: source.id,
      sourceX: source.x,
      sourceY: source.y,
      x: target.x,
      y: target.y,
      offsetX: target.x - source.x,
      offsetY: target.y - source.y,
      anchorX: anchor.x,
      anchorY: anchor.y,
      sourceAdjusted: !safe,
      indicative: true,
    };
  });
}

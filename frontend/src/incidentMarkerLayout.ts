export {
  texasMarkerLayout,
  projectTexasPoint,
  containedTexasAnchor,
  texasContainsMarker,
  TexasMarkerCapacityError,
} from "./texasMapLayout.ts";
export type { TexasIncidentMarker } from "./texasMapLayout.ts";

export interface IncidentAnchor {
  id: string;
  x: number;
  y: number;
}
export interface IncidentMarker {
  id: string;
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
}

/** Space display badges, never the stored schematic anchors. Units are CSS px. */
export function incidentMarkerLayout(
  anchors: readonly IncidentAnchor[],
  width: number,
  height: number,
): IncidentMarker[] {
  const inset = 26;
  const spacing = 48;
  const clamp = (value: number, size: number) =>
    Math.max(inset, Math.min(size - inset, value));
  const placed: IncidentMarker[] = [];
  for (const anchor of anchors) {
    const sourceX = (anchor.x * width) / 100;
    const sourceY = (anchor.y * height) / 100;
    const baseX = clamp(sourceX, width);
    const baseY = clamp(sourceY, height);
    const ring = Math.ceil(Math.max(width, height) / spacing);
    const candidates = new Map<string, { x: number; y: number }>();
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        const x = clamp(baseX + dx * spacing, width);
        const y = clamp(baseY + dy * spacing, height);
        candidates.set(`${x},${y}`, { x, y });
      }
    }
    const ranked = [...candidates.values()].sort(
      (a, b) =>
        (a.x - sourceX) ** 2 +
        (a.y - sourceY) ** 2 -
        ((b.x - sourceX) ** 2 + (b.y - sourceY) ** 2),
    );
    const target =
      ranked.find((candidate) =>
        placed.every(
          (other) =>
            Math.abs(candidate.x - other.x) >= spacing ||
            Math.abs(candidate.y - other.y) >= spacing,
        ),
      ) ?? ranked[0];
    placed.push({
      id: anchor.id,
      sourceX,
      sourceY,
      ...target,
      offsetX: target.x - sourceX,
      offsetY: target.y - sourceY,
    });
  }
  return placed;
}

import { fittedTexasMarkerLayout } from "./fittedTexasMap.ts";
import type { IncidentAnchor } from "./incidentMarkerLayout.ts";

export type MapBox = { x: number; y: number; width: number; height: number };
export const c1BoxesOverlap = (a: MapBox, b: MapBox, gap = 5) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

/** Exact equirectangular frame used by texasGraph.ts and the vendored boundary.
 * Geographic [longitude, latitude] ONLY; local XY must never enter this function. */
export function c1TexasLonLat(lon: number, lat: number) {
  return { x: 90 + ((lon + 106.7) / 13.3) * 780, y: 60 + ((36.6 - lat) / 10.9) * 600 };
}
export function c1FittedPoint(point: { x: number; y: number }, width: number, height: number) {
  const scale = Math.min(width / 800, height / 620);
  return { x: (width - 800 * scale) / 2 + (point.x - 80) * scale,
    y: (height - 620 * scale) / 2 + (point.y - 45) * scale };
}

/** Labels occupy CSS pixels just like the 44px touch targets. Every label is
 * tested against ALL markers (including its own), then previously placed labels.
 * No collision-prone 'best effort': an unplaceable label requests a real list. */
export function c1PlaceLabels(items: readonly { id: string; x: number; y: number; width: number; height?: number }[], obstacles: readonly MapBox[], width: number, height: number) {
  const labels: (MapBox & { id: string })[] = [];
  const missing: string[] = [];
  for (const item of items) {
    const h = item.height ?? 44;
    const candidates: MapBox[] = [];
    for (const dy of [-52, 8, -80, 36, -110, 66, -140, 96]) {
      for (const x of [item.x + 32, item.x - item.width - 32, item.x - item.width / 2]) {
        candidates.push({ x, y: item.y + dy, width: item.width, height: h });
      }
    }
    // Dense incident clusters need a deterministic whole-canvas fallback. Keep
    // actual marker anchors fixed; existing leader lines tie displaced labels
    // back to their incidents instead of blanking every pin on a desktop map.
    const fallback: MapBox[] = [];
    for (let y = 8; y + h <= height - 8; y += 12) {
      for (let x = 8; x + item.width <= width - 8; x += 12) fallback.push({x,y,width:item.width,height:h});
    }
    fallback.sort((a,b) => (a.x+item.width/2-item.x)**2+(a.y+h/2-item.y)**2 - ((b.x+item.width/2-item.x)**2+(b.y+h/2-item.y)**2) || a.y-b.y || a.x-b.x);
    candidates.push(...fallback);
    const box = candidates.find(candidate => candidate.x >= 8 && candidate.y >= 8 &&
      candidate.x + candidate.width <= width - 8 && candidate.y + candidate.height <= height - 8 &&
      [...obstacles, ...labels].every(other => !c1BoxesOverlap(candidate, other)));
    if (box) labels.push({ ...box, id: item.id }); else missing.push(item.id);
  }
  return { labels, missing };
}
/** Stored geographic coordinates win; only explicitly authored schematic anchors are fallback. */
export function c1GeographicAnchor(row: { id: string; location?: { longitude?: number; latitude?: number; schematic?: {x:number;y:number} } }): IncidentAnchor | null {
  const location = row.location;
  if (typeof location?.longitude === 'number' && typeof location.latitude === 'number' && Number.isFinite(location.longitude) && Number.isFinite(location.latitude)) {
    const point = c1TexasLonLat(location.longitude, location.latitude);
    return {id:row.id,x:point.x/10,y:point.y/7};
  }
  const p=location?.schematic;
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? {id:row.id,...p} : null;
}
export function c1IncidentLayout(anchors: readonly IncidentAnchor[], width: number, height: number) {
  if (width <= 0 || height <= 0) return { markers: [], capacityExceeded: true };
  return fittedTexasMarkerLayout(anchors, width, height, 44);
}

export const C1_CITIES = [
  { name: "Dallas", lon: -96.797, lat: 32.777 },
  { name: "Houston", lon: -95.370, lat: 29.760 },
  { name: "Austin", lon: -97.743, lat: 30.267 },
  { name: "San Antonio", lon: -98.494, lat: 29.425 },
  { name: "El Paso", lon: -106.485, lat: 31.762 },
  { name: "Lubbock", lon: -101.855, lat: 33.578 },
  { name: "Amarillo", lon: -101.832, lat: 35.222 },
  { name: "Corpus Christi", lon: -97.396, lat: 27.801 },
] as const;

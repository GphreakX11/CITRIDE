import { texasMarkerLayout, TexasMarkerCapacityError, type IncidentAnchor } from "./incidentMarkerLayout.ts";

/** Fit the actual state, not the empty margins around the 1000×700 source SVG.
 * Underlying records and percentages remain in the original authored frame.
 */
export const FITTED_TEXAS_VIEWBOX = "80 45 800 620";
export function fittedTexasMarkerLayout(anchors: readonly IncidentAnchor[], width: number, height: number, markerSize = 44) {
  const scale = Math.min(width / 800, height / 620);
  const offsetX = (width - 800 * scale) / 2 - 80 * scale;
  const offsetY = (height - 620 * scale) / 2 - 45 * scale;
  try {
    const markers = texasMarkerLayout(anchors, 1000 * scale, 700 * scale, markerSize);
    return { markers: markers.map(marker => ({ ...marker,
      x: marker.x + offsetX, y: marker.y + offsetY,
      sourceX: marker.sourceX + offsetX, sourceY: marker.sourceY + offsetY,
      anchorX: marker.anchorX + offsetX, anchorY: marker.anchorY + offsetY,
    })), capacityExceeded: false };
  } catch (error) {
    // Never crash the application, conceal records, overlap targets, or draw
    // outside Texas when a deliberately dense view cannot physically fit.
    if (!(error instanceof TexasMarkerCapacityError)) throw error;
    return { markers: [], capacityExceeded: true };
  }
}

export interface LabelNode {
  id: string;
  x: number;
  y: number;
  label: string;
}
export interface NodeLabel {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}
const intersects = (a: NodeLabel, b: NodeLabel) =>
  Math.abs(a.x - b.x) * 2 < a.width + b.width + 8 &&
  Math.abs(a.y - b.y) * 2 < a.height + b.height + 6;

/** Display-only label placement. Collision handling never changes source positions or links. */
export function nodeLabels(
  nodes: readonly LabelNode[],
  selectedId?: string,
  bounds = { minX: 0, minY: 0, maxX: 960, maxY: 720 },
): Map<string, NodeLabel> {
  const result = new Map<string, NodeLabel>();
  const order = [...nodes].sort(
    (a, b) =>
      Number(b.id === selectedId) - Number(a.id === selectedId) ||
      a.id.localeCompare(b.id),
  );
  for (const node of order) {
    const maxCharacters = Math.max(
      5,
      Math.min(29, Math.floor((bounds.maxX - bounds.minX - 32) / 10.2)),
    );
    const text =
      node.label.length > maxCharacters
        ? `${node.label.slice(0, maxCharacters - 2)}…`
        : node.label;
    const width = text.length * 10.2 + 8,
      height = 23;
    const offsets = [
      [0, 33],
      [0, -29],
      [width / 2 + 25, 0],
      [-width / 2 - 25, 0],
      [0, 58],
      [0, -54],
      [width / 2 + 25, 30],
      [-width / 2 - 25, 30],
      [0, 84],
      [0, -80],
    ];
    const candidates = offsets.map(([dx, dy]) => ({
      x: Math.max(
        bounds.minX + width / 2 + 12,
        Math.min(bounds.maxX - 12 - width / 2, node.x + dx),
      ),
      y: Math.max(bounds.minY + 26, Math.min(bounds.maxY - 30, node.y + dy)),
      width,
      height,
      text,
    }));
    const penalty = (candidate: NodeLabel) =>
      [...result.values()].filter((other) => intersects(candidate, other))
        .length *
        10 +
      nodes.filter((other) =>
        intersects(candidate, {
          x: other.x,
          y: other.y,
          width: 28,
          height: 28,
          text: "",
        }),
      ).length;
    const best = candidates.reduce((a, b) => (penalty(b) < penalty(a) ? b : a));
    result.set(node.id, best);
  }
  return result;
}

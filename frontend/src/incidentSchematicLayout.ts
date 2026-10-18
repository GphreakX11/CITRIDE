import type { IncidentStackModel, IncidentStackNode, IncidentNodeState, IncidentStackRole } from "./incidentStack.ts";
import { infrastructureSymbol } from "./infrastructureSymbols.ts";

export type SchematicFilter = "all" | "water" | "healthcare" | "power" | "emergency";
export interface SchematicItem {
  id: string;
  name: string;
  secondary: string;
  state: IncidentNodeState;
  role: IncidentStackRole;
  node: IncidentStackNode;
  members: IncidentStackNode[];
  aggregate: boolean;
  groupId?: string;
}
export const matchesSector = (node: IncidentStackNode, filter: SchematicFilter) => {
  const kind = infrastructureSymbol(node.entity).kind;
  return filter === "all" || (filter === "water" && ["water", "plant"].includes(kind)) ||
    (filter === "healthcare" && ["hospital", "dialysis", "care"].includes(kind)) ||
    (filter === "power" && kind === "power") || (filter === "emergency" && kind === "fire");
};
export function schematicItems(model: IncidentStackModel, expanded: ReadonlySet<string>, filter: SchematicFilter): SchematicItem[] {
  const grouped = new Set<string>();
  const items: SchematicItem[] = [];
  if (model.aggregateFacilities) for (const group of model.facilityGroups) {
    const members = group.nodes.filter(n => matchesSector(n, filter));
    if (!members.length) continue;
    for (const n of members) grouped.add(n.entity.id);
    if (expanded.has(group.id)) {
      for (const node of members) items.push({ id: node.entity.id, name: node.entity.label, secondary: node.state.label, state: node.state, role: node.role, node, members: [node], aggregate: false, groupId: group.id });
    } else {
      items.push({ id: `sector:${group.id}`, name: group.label, secondary: `${group.count} facilities · ${group.atRisk} at risk`, state: group.state, role: "dependent", node: members[0], members, aggregate: true, groupId: group.id });
    }
  }
  for (const node of model.nodes) if (!grouped.has(node.entity.id) && matchesSector(node, filter)) {
    items.push({ id: node.entity.id, name: node.entity.label, secondary: node.state.label, state: node.state, role: node.role, node, members: [node], aggregate: false });
  }
  return items;
}
export interface SchematicPoint { x: number; y: number }
/** Pixel coordinates: no initial viewBox scaling can shrink the wall-size labels. */
export function schematicLayout(items: readonly SchematicItem[], availableWidth: number) {
  const width = Math.max(940, availableWidth);
  const right = items.filter(i => i.role === "dependent" && (i.aggregate || i.state.line !== "dashed"));
  const bottom = items.filter(i => i.role === "in-area" || (i.role === "dependent" && !i.aggregate && i.state.line === "dashed"));
  const left = items.filter(i => i.role === "upstream" || i.role === "plant");
  const bottomRows = Math.ceil(bottom.length / 3);
  const height = Math.max(620, 60 + right.length * 140 + bottomRows * 140, 160 + left.length * 140);
  const positions = new Map<string, SchematicPoint>();
  const rightEnd = height - (bottomRows ? bottomRows * 140 + 70 : 110);
  right.forEach((i, index) => positions.set(i.id, { x: width * .82, y: right.length === 1 ? 245 : 130 + index * Math.max(140, (rightEnd - 130) / (right.length - 1)) }));
  bottom.forEach((i, index) => positions.set(i.id, { x: width * [.37, .61, .83][index % 3], y: height - 90 - (bottomRows - 1 - Math.floor(index / 3)) * 140 }));
  const upstream = items.filter(i => i.role === "upstream");
  const plants = items.filter(i => i.role === "plant");
  upstream.forEach((i, index) => positions.set(i.id, { x: width * .115, y: 120 + index * 140 }));
  plants.forEach((i, index) => positions.set(i.id, { x: width * .255, y: 290 + index * 140 }));
  items.filter(i => i.role === "source").forEach((i, index) => positions.set(i.id, { x: width * .51, y: 280 + index * 140 }));
  return { width, height, positions };
}
export function wrapSchematicText(text: string, max = 29): string[] {
  const lines: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    if (!lines.length || (lines[lines.length - 1].length + word.length + 1 > max)) lines.push(word);
    else lines[lines.length - 1] += ` ${word}`;
  }
  return lines;
}

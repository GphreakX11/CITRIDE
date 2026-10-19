export interface DependencyLayoutNode {
  id: string;
  source?: boolean;
  schematic?: { x: number; y: number };
  upstream?: boolean;
  status?: string | null;
}
export interface DependencyLayoutEdge {
  from: string;
  to: string;
  kind?: string;
}
export interface DependencyLayoutResult {
  /** Coordinates are node centers; reserve a 300 × 140 box per node. */
  nodes: { id: string; x: number; y: number }[];
  width: number;
  height: number;
}

const HORIZONTAL = 300;
/** Only actual geometry changes may discard a user's zoom/pan viewport. */
export function dependencyTopologyKey(nodes: readonly DependencyLayoutNode[], edges: readonly DependencyLayoutEdge[], sourceId: string): string {
  const ordered = (rows: unknown[][]) => rows.map(row=>JSON.stringify(row)).sort();
  return JSON.stringify([sourceId, ordered(nodes.map(n=>[n.id,!!n.upstream,n.status==='on_watch',n.schematic?.x ?? null,n.schematic?.y ?? null])), ordered(edges.map(e=>[e.from,e.to,e.kind ?? 'dependency']))]);
}
const VERTICAL = 140;
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Source-centered, nongeographic dependency schematic. Omitted edge kinds are
 * causal (ConsequenceProjection edges have no kind); explicit kinds must be
 * "dependency" (IncidentStack/texasGraph). Structural, spatial, campaign, watch,
 * and unknown kinds cannot manufacture a service dependency.
 *
 * Columns use shortest directed distance. A node reachable in both directions
 * uses the nearer side; ties use upstream metadata, otherwise downstream.
 * Watch-only status and unreachable nodes occupy a separate bottom grid.
 * Missing source IDs are not synthesized; all supplied nodes then go below.
 */
export function dependencyLayout(
  nodes: readonly DependencyLayoutNode[],
  edges: readonly DependencyLayoutEdge[],
  sourceId: string,
): DependencyLayoutResult {
  // Aggregate duplicate metadata without making results depend on input order.
  const byId = new Map<string, { upstream: boolean; watch: boolean }>();
  for (const node of nodes) {
    const previous = byId.get(node.id);
    byId.set(node.id, {
      upstream: !!node.upstream || !!previous?.upstream,
      watch: node.status === "on_watch" || !!previous?.watch,
    });
  }
  const ids = [...byId.keys()].sort(compareIds);
  const outgoing = new Map(ids.map(id => [id, new Set<string>()]));
  const incoming = new Map(ids.map(id => [id, new Set<string>()]));
  for (const edge of edges) {
    if (edge.kind !== undefined && edge.kind !== "dependency") continue;
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    if ((edge.from !== sourceId && byId.get(edge.from)!.watch) ||
        (edge.to !== sourceId && byId.get(edge.to)!.watch)) continue;
    outgoing.get(edge.from)!.add(edge.to);
    incoming.get(edge.to)!.add(edge.from);
  }
  const distances = (adjacency: Map<string, Set<string>>) => {
    const result = new Map<string, number>();
    if (!byId.has(sourceId)) return result;
    result.set(sourceId, 0);
    const queue = [sourceId];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      for (const neighbor of adjacency.get(id)!) {
        if (result.has(neighbor)) continue;
        result.set(neighbor, result.get(id)! + 1);
        queue.push(neighbor);
      }
    }
    return result;
  };
  const upstream = distances(incoming);
  const downstream = distances(outgoing);
  const columns = new Map<number, string[]>();
  const bottom: string[] = [];
  for (const id of ids) {
    if (id === sourceId) continue;
    const up = upstream.get(id), down = downstream.get(id);
    if (byId.get(id)!.watch || (up === undefined && down === undefined)) {
      bottom.push(id);
      continue;
    }
    const left = up !== undefined &&
      (down === undefined || up < down || (up === down && byId.get(id)!.upstream));
    const column = left ? -up! : down!;
    const members = columns.get(column) ?? [];
    members.push(id);
    columns.set(column, members);
  }
  const relative = new Map<string, { x: number; y: number }>();
  if (byId.has(sourceId)) relative.set(sourceId, { x: 0, y: 0 });
  let halfWidth = HORIZONTAL / 2;
  let causalRadius = 0;
  for (const [column, members] of columns) {
    halfWidth = Math.max(halfWidth, Math.abs(column) * HORIZONTAL + HORIZONTAL / 2);
    const radius = (members.length - 1) * VERTICAL / 2;
    causalRadius = Math.max(causalRadius, radius);
    members.forEach((id, index) => relative.set(id, {
      x: column * HORIZONTAL,
      y: index * VERTICAL - radius,
    }));
  }
  const bottomColumns = Math.min(3, bottom.length);
  if (bottomColumns) halfWidth = Math.max(halfWidth, bottomColumns * HORIZONTAL / 2);
  bottom.forEach((id, index) => relative.set(id, {
    x: (index % bottomColumns - (bottomColumns - 1) / 2) * HORIZONTAL,
    y: causalRadius + VERTICAL * (1 + Math.floor(index / bottomColumns)),
  }));
  const bottomExtent = bottom.length
    ? causalRadius + VERTICAL * Math.ceil(bottom.length / bottomColumns)
    : causalRadius;
  const halfHeight = bottomExtent + VERTICAL / 2;
  // A single uniform display transform preserves authored geometry. Never write
  // back display coordinates to entity metadata. Missing positions alone fall back.
  const authored = nodes.filter(n => Number.isFinite(n.schematic?.x) && Number.isFinite(n.schematic?.y))
    .sort((a,b) => compareIds(a.id,b.id) || a.schematic!.x-b.schematic!.x || a.schematic!.y-b.schematic!.y);
  if (authored.length) {
    const anchors = new Map<string, {x:number;y:number}>();
    for (const n of authored) if (!anchors.has(n.id)) anchors.set(n.id,n.schematic!);
    const values = [...anchors.values()];
    let scale = 1;
    for (let i=0;i<values.length;i++) for (let j=0;j<i;j++) {
      const dx=Math.abs(values[i].x-values[j].x), dy=Math.abs(values[i].y-values[j].y);
      if (dx || dy) scale=Math.max(scale,Math.min(dx ? HORIZONTAL/dx : Infinity,dy ? VERTICAL/dy : Infinity));
    }
    scale *= 1.000001; // numerical clearance at exact card-spacing boundaries
    const placed = new Map<string,{x:number;y:number}>();
    const overlaps = (p:{x:number;y:number}) => [...placed.values()].some(q=>Math.abs(p.x-q.x)<HORIZONTAL-.001 && Math.abs(p.y-q.y)<VERTICAL-.001);
    for (const [id,p] of anchors) {
      const display={x:p.x*scale,y:p.y*scale};
      // Exact duplicate authored anchors cannot be separated by scaling alone.
      // Keep stored anchors intact and stack only their display cards.
      while(overlaps(display)) display.y+=VERTICAL;
      placed.set(id,display);
    }
    const sourceAnchor=placed.get(sourceId) ?? {x:0,y:0};
    for (const id of ids) if(!placed.has(id)) {
      const fallback=relative.get(id)!;
      const display={x:sourceAnchor.x+fallback.x,y:sourceAnchor.y+fallback.y};
      while(overlaps(display)) display.y+=VERTICAL;
      placed.set(id,display);
    }
    const minX=Math.min(...[...placed.values()].map(p=>p.x))-HORIZONTAL/2;
    const minY=Math.min(...[...placed.values()].map(p=>p.y))-VERTICAL/2;
    return {nodes:ids.map(id=>({id,x:placed.get(id)!.x-minX,y:placed.get(id)!.y-minY})),
      width:Math.max(...[...placed.values()].map(p=>p.x))-minX+HORIZONTAL/2,
      height:Math.max(...[...placed.values()].map(p=>p.y))-minY+VERTICAL/2};
  }
  return {
    nodes: ids.map(id => ({ id, x: relative.get(id)!.x + halfWidth, y: relative.get(id)!.y + halfHeight })),
    width: halfWidth * 2,
    height: halfHeight * 2,
  };
}

/** Filtering never hides the incident source or removes layout context. */
export function filteredNodeOpacity(
  id: string,
  visible: ReadonlySet<string>,
  sourceId: string,
): 1 | 0.18 {
  return id === sourceId || visible.has(id) ? 1 : 0.18;
}

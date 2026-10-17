/**
 * Linked consequence graph for C4 (display) and A4 (explore).
 *
 * Built from the captured run's dependency records around the scenario source,
 * not from the impact list, so connected-but-unaffected and upstream sectors
 * stay visible. Every value comes from the captured run snapshot.
 */
import type { Entity } from "./types.ts";
import {
  asRecord,
  capturedClassification,
  strings,
  words,
  type ConsequenceModel,
} from "./commandCenterModel.ts";
import { idtSectorName } from "./idt.ts";

export type GraphTone = "red" | "amber" | "grey" | "green" | "source";
export type GraphNodeKind = "source" | "sector" | "people" | "facility";
export type Direction = "down" | "up" | "self";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  idt: string;
  sub: string;
  tone: GraphTone;
  line: "solid" | "dashed" | "dotted";
  weight: number;
  direction: Direction;
  depth: number;
  sectorKey?: string;
  entityId?: string;
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  tone: GraphTone;
  dashed: boolean;
}
export interface GraphView {
  title: string;
  hint: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type Dependency = ConsequenceModel["captured"]["dependencies"][number];
type Row = ConsequenceModel["rows"][number];

const NON_FACILITY = new Set(["PopulationGroup", "ServiceArea", "CyberAsset"]);

function sectorOf(entity: Entity | undefined) {
  const c = capturedClassification(entity);
  if (!c.classified) return null;
  const sector = c.key.slice("idt:".length);
  return {
    key: c.key,
    sector,
    name: idtSectorName(sector) ?? `Sector ${sector}`,
  };
}
function idtPath(entity: Entity | undefined): string {
  const idt = asRecord(asRecord(entity).idt);
  if (idt.status === "coded" && typeof idt.path === "string")
    return `IDT ${idt.path}`;
  if (idt.status === "below_idt_level" && typeof idt.parentPath === "string")
    return `in ${idt.parentPath}`;
  return "";
}
function windowText(w: [number, number] | null | undefined) {
  return w ? `${w[0]}–${w[1]} h` : "window unknown";
}
function toneForWindow(w: [number, number] | null | undefined): GraphTone {
  return w && w[0] >= 4 ? "amber" : "red";
}
function earliest(rows: Row[]): [number, number] | null {
  const ws = rows
    .map((r) => r.windowHours)
    .filter((w): w is [number, number] => Array.isArray(w));
  ws.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return ws[0] ?? null;
}
function say(value: unknown): string {
  return typeof value === "string" && value ? words(value) : "";
}
function lower(text: string) {
  return text ? text[0]!.toLowerCase() + text.slice(1) : text;
}

/** Breadth-first walk over captured dependencies from the source. */
function walk(deps: Dependency[], source: string, direction: "down" | "up") {
  const depth = new Map<string, number>([[source, 0]]);
  const via = new Map<string, Dependency>();
  const queue = [source];
  while (queue.length) {
    const id = queue.shift()!;
    for (const d of deps) {
      const from = direction === "down" ? d.provider : d.dependent;
      const to = direction === "down" ? d.dependent : d.provider;
      if (from !== id || depth.has(to)) continue;
      depth.set(to, depth.get(id)! + 1);
      via.set(to, d);
      queue.push(to);
    }
  }
  depth.delete(source);
  return { depth, via };
}

export function consequenceGraph(
  model: ConsequenceModel,
  options: { boilWaterLabel?: string | null } = {},
) {
  const run = model.run;
  if (!run) return null;
  const seed = run.seed;
  const entities = model.captured.entities;
  const deps = model.captured.dependencies;
  const byId = new Map(entities.map((e) => [e.id, e]));
  const functions = new Map(
    model.captured.serviceFunctions.map((f) => [f.id, f.label]),
  );
  const source = seed.provider;
  const sourceEntity = byId.get(source);
  const sourceSector = sectorOf(sourceEntity);
  const excluded = new Map(
    (run.excluded ?? []).map((value) => {
      const r = asRecord(value);
      return [String(r.dependencyId), String(r.reason ?? "not carried")];
    }),
  );
  const rowsFor = (id: string) => model.rows.filter((r) => r.entityId === id);
  const down = walk(deps, source, "down");
  const up = walk(deps, source, "up");
  const people = model.areaCounts.reduce(
    (sum, a) => (a.count === null ? sum : sum + a.count),
    0,
  );
  const hasPeople = model.areaCounts.some((a) => a.count !== null);

  function entityState(id: string, direction: "down" | "up") {
    const rows = rowsFor(id);
    const w = earliest(rows);
    if (rows.length)
      return {
        affected: true,
        tone: toneForWindow(w),
        sub: `At risk ${windowText(w)}`,
        line: "solid" as const,
        window: w,
      };
    if (direction === "up")
      return {
        affected: false,
        tone: "green" as GraphTone,
        sub: "Normal · upstream",
        line: "solid" as const,
        window: null,
      };
    const dep = down.via.get(id);
    return {
      affected: false,
      tone: "grey" as GraphTone,
      sub: dep && excluded.has(dep.id) ? "Not affected" : "No modeled impact",
      line: "dashed" as const,
      window: null,
    };
  }

  // Group reached entities by IDT sector. Upstream members of the source's own
  // sector fold into the source-sector ("self") node with the people served.
  type Member = { id: string; direction: "down" | "up"; depth: number };
  const groups = new Map<string, { direction: Direction; members: Member[] }>();
  const add = (key: string, direction: Direction, m: Member) => {
    const g = groups.get(key) ?? { direction, members: [] };
    g.members.push(m);
    groups.set(key, g);
  };
  for (const [id, depth] of down.depth) {
    const e = byId.get(id);
    const s = sectorOf(e);
    if (!s || !e || NON_FACILITY.has(e.type)) continue;
    add(s.key, "down", { id, direction: "down", depth });
  }
  for (const [id, depth] of up.depth) {
    const e = byId.get(id);
    const s = sectorOf(e);
    if (!s || !e || NON_FACILITY.has(e.type)) continue;
    const self = sourceSector && s.key === sourceSector.key;
    add(self ? `self:${s.key}` : s.key, self ? "self" : "up", {
      id,
      direction: "up",
      depth: -depth,
    });
  }
  if (sourceSector && hasPeople && !groups.has(`self:${sourceSector.key}`))
    groups.set(`self:${sourceSector.key}`, { direction: "self", members: [] });

  function enteringServices(memberIds: Set<string>, direction: "down" | "up") {
    const labels = new Set<string>();
    for (const id of memberIds) {
      if (direction === "down") {
        const d = down.via.get(id);
        if (d && !memberIds.has(d.provider)) labels.add(say(d.requiredService));
      } else {
        // Upstream: the service this sector supplies, then each hop to the source.
        const chain: string[] = [];
        let cur = id;
        let guard = 0;
        while (cur !== source && guard++ < 20) {
          const d = up.via.get(cur);
          if (!d) break;
          chain.push(say(d.requiredService));
          cur = d.dependent;
        }
        if (chain.length) labels.add(chain.join(" → "));
      }
    }
    return [...labels].join(" · ");
  }

  const sectorNodes: GraphNode[] = [];
  const overviewEdges: GraphEdge[] = [];
  const memberSets = new Map<string, Member[]>();
  for (const [key, g] of groups) {
    const sectorKey = key.startsWith("self:") ? key.slice(5) : key;
    const sector = sectorKey.slice("idt:".length);
    const name = idtSectorName(sector) ?? `Sector ${sector}`;
    memberSets.set(key, g.members);
    const affectedRows = g.members.flatMap((m) => rowsFor(m.id));
    const affectedCount = new Set(affectedRows.map((r) => r.entityId)).size;
    const w = earliest(affectedRows);
    let sub: string;
    let tone: GraphTone;
    let line: GraphNode["line"] = "solid";
    if (g.direction === "self") {
      const parts = [];
      if (hasPeople) parts.push(`${people.toLocaleString("en-US")} people`);
      if (options.boilWaterLabel) parts.push("boil-water possible");
      if (affectedCount)
        parts.push(`${affectedCount} at risk · ${windowText(w)}`);
      sub = parts.join(" · ") || "Source sector";
      tone = affectedCount ? toneForWindow(w) : "amber";
    } else if (affectedCount) {
      sub = `${affectedCount} at risk · ${windowText(w)}`;
      tone = toneForWindow(w);
    } else if (g.direction === "up") {
      sub = "Normal · upstream";
      tone = "green";
    } else {
      sub = "Not affected";
      tone = "grey";
      line = "dashed";
    }
    const node: GraphNode = {
      id: `sector:${key}`,
      kind: g.direction === "self" ? "people" : "sector",
      label: g.direction === "self" ? `${name} customers` : name,
      idt: `IDT ${sector}`,
      sub,
      tone,
      line,
      weight: Math.max(
        1,
        affectedCount || g.members.length,
        hasPeople && g.direction === "self" ? 3 : 0,
      ),
      direction: g.direction,
      depth: g.direction === "up" ? -1 : 1,
      sectorKey: key,
    };
    sectorNodes.push(node);
    const ids = new Set(g.members.map((m) => m.id));
    const label =
      g.direction === "self"
        ? say(seed.service)
        : enteringServices(ids, g.direction === "up" ? "up" : "down");
    overviewEdges.push({
      id: `edge:${key}`,
      from: g.direction === "up" ? node.id : "source",
      to: g.direction === "up" ? "source" : node.id,
      label: label || "dependency",
      tone,
      dashed: line === "dashed",
    });
  }
  // Order: upstream first, then the source sector, then downstream by urgency.
  const rank = (n: GraphNode) =>
    n.direction === "up" ? 0 : n.direction === "self" ? 1 : 2;
  sectorNodes.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(b.tone === "red") - Number(a.tone === "red") ||
      a.label.localeCompare(b.label),
  );
  const sourceNode: GraphNode = {
    id: "source",
    kind: "source",
    label: sourceEntity?.label || "Scenario source",
    idt: idtPath(sourceEntity),
    sub: `${lower(say(seed.lossType))} · source`,
    tone: "source",
    line: "solid",
    weight: 4,
    direction: "self",
    depth: 0,
    entityId: source,
  };
  const overview: GraphView = {
    title: `Sector dependencies · ${sourceNode.label}`,
    hint: "Select a sector to see the facilities behind it",
    nodes: [sourceNode, ...sectorNodes],
    edges: overviewEdges,
  };

  const servedAreas = new Set(strings(asRecord(sourceEntity).serves));
  const reached = new Set([source, ...down.depth.keys(), ...up.depth.keys()]);

  function sectorView(key: string): GraphView | null {
    const members = memberSets.get(key);
    const node = sectorNodes.find((n) => n.sectorKey === key);
    if (!members || !node) return null;
    const include = new Map<string, number>([[source, 0]]);
    for (const m of members) {
      include.set(m.id, m.depth);
      // Keep the path back to the source so multi-hop chains read correctly.
      let cur = m.id;
      let guard = 0;
      const via = m.direction === "down" ? down.via : up.via;
      while (cur !== source && guard++ < 20) {
        const d = via.get(cur);
        if (!d) break;
        cur = m.direction === "down" ? d.provider : d.dependent;
        if (cur !== source)
          include.set(
            cur,
            m.direction === "down"
              ? (down.depth.get(cur) ?? 0)
              : -(up.depth.get(cur) ?? 0),
          );
      }
    }
    const nodes: GraphNode[] = [];
    for (const [id, depth] of include) {
      const e = byId.get(id);
      if (id === source) {
        nodes.push({ ...sourceNode, id, entityId: id });
        continue;
      }
      const dir = depth < 0 ? "up" : "down";
      const st = entityState(id, dir);
      nodes.push({
        id,
        kind: "facility",
        label: e?.label || id,
        idt: idtPath(e),
        sub: st.sub,
        tone: st.tone,
        line: st.line,
        weight: 1,
        direction: dir,
        depth,
        entityId: id,
      });
    }
    // Same-sector facilities in the source's service area with no dependency.
    if (node.direction === "down")
      for (const e of entities) {
        if (reached.has(e.id) || NON_FACILITY.has(e.type)) continue;
        const s = sectorOf(e);
        if (!s || s.key !== key) continue;
        if (!strings(asRecord(e).locatedIn).some((a) => servedAreas.has(a)))
          continue;
        nodes.push({
          id: e.id,
          kind: "facility",
          label: e.label || e.id,
          idt: idtPath(e),
          sub: "In area · no dependency",
          tone: "grey",
          line: "dotted",
          weight: 1,
          direction: "down",
          depth: 1,
          entityId: e.id,
        });
      }
    if (node.kind === "people" && hasPeople)
      nodes.push({
        id: "people",
        kind: "people",
        label: `${people.toLocaleString("en-US")} people`,
        idt: "Service area",
        sub: options.boilWaterLabel
          ? "Boil-water notice possible"
          : "People served",
        tone: "amber",
        line: "solid",
        weight: 1,
        direction: "down",
        depth: 1,
      });
    const ids = new Set(nodes.map((n) => n.id));
    const edges: GraphEdge[] = deps
      .filter((d) => ids.has(d.provider) && ids.has(d.dependent))
      .map((d) => {
        const target = nodes.find((n) => n.id === d.dependent)!;
        const upstream = (include.get(d.dependent) ?? 0) <= 0;
        const fn = d.dependentFunction
          ? functions.get(d.dependentFunction)
          : null;
        return {
          id: d.id,
          from: d.provider,
          to: d.dependent,
          label: upstream || !fn ? say(d.requiredService) : lower(fn),
          tone: upstream ? "green" : target.tone,
          dashed: excluded.has(d.id) || target.line !== "solid",
        };
      });
    if (ids.has("people"))
      edges.push({
        id: "edge:people",
        from: source,
        to: "people",
        label: say(seed.service),
        tone: "amber",
        dashed: false,
      });
    return {
      title:
        node.kind === "people"
          ? `${node.label.replace(/ customers$/, "")} (${node.idt})`
          : `${node.label} (${node.idt})`,
      hint:
        node.kind === "people"
          ? (options.boilWaterLabel ??
            "The utility serves the people in its service area")
          : "Select a facility to see why",
      nodes,
      edges,
    };
  }

  return { overview, sectorView, source };
}

/** Deterministic layout for the overview: source in the middle, sectors around it. */
export function radialLayout(view: GraphView, width = 1000, height = 460) {
  const cx = width / 2,
    cy = height / 2;
  const others = view.nodes.filter((n) => n.kind !== "source");
  const up = others.filter((n) => n.direction === "up" || n.direction === "self");
  const rest = others.filter((n) => n.direction === "down")
    .sort((a, b) => Number(a.line !== "solid") - Number(b.line !== "solid"));
  const pos = new Map<string, { x: number; y: number }>();
  pos.set("source", { x: cx, y: cy });
  const rx = width * 0.36,
    ry = height * 0.36;
  const place = (list: GraphNode[], from: number, to: number) =>
    list.forEach((n, i) => {
      const t =
        list.length === 1
          ? (from + to) / 2
          : from + ((to - from) * i) / (list.length - 1);
      pos.set(n.id, { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
    });
  // Upstream supply and source-sector customers on the left; dependent sectors
  // on the right, with affected sectors before explicitly unpropagated paths.
  place(
    up,
    (-150 * Math.PI) / 180,
    up.length > 1 ? (-210 * Math.PI) / 180 : (-150 * Math.PI) / 180,
  );
  place(rest, (-30 * Math.PI) / 180, (30 * Math.PI) / 180);
  return pos;
}

/** Columns by depth from the source (upstream left, downstream right). */
export function layeredLayout(view: GraphView, width = 1000, height = 460) {
  const depths = [...new Set(view.nodes.map((n) => n.depth))].sort(
    (a, b) => a - b,
  );
  const pos = new Map<string, { x: number; y: number }>();
  const pad = 110;
  depths.forEach((d, col) => {
    const column = view.nodes.filter((n) => n.depth === d);
    const x =
      depths.length === 1
        ? width / 2
        : pad + ((width - 2 * pad) * col) / (depths.length - 1);
    column.forEach((n, i) => {
      const y = (height * (i + 1)) / (column.length + 1);
      pos.set(n.id, { x, y });
    });
  });
  return pos;
}

type ExploreNetwork = {
  nodes: Entity[];
  edges: (Dependency & { excludedReason?: string })[];
  relations: { id: string; from: string; to: string; kind: string }[];
};

/** A4 explore mode: the exploration network drawn as columns by depth. */
export function explorationView(
  model: ConsequenceModel,
  network: ExploreNetwork,
): GraphView | null {
  const run = model.run;
  if (!run) return null;
  const seed = run.seed;
  const source = seed.provider;
  const deps = network.edges;
  const down = walk(deps, source, "down");
  const up = walk(deps, source, "up");
  const depthOf = new Map<string, number>([[source, 0]]);
  for (const [id, d] of down.depth) depthOf.set(id, d);
  for (const [id, d] of up.depth) if (!depthOf.has(id)) depthOf.set(id, -d);
  // Context-only relations sit in their partner's column.
  for (let pass = 0; pass < 3; pass++)
    for (const r of network.relations) {
      if (depthOf.has(r.from) && !depthOf.has(r.to))
        depthOf.set(r.to, depthOf.get(r.from)!);
      if (depthOf.has(r.to) && !depthOf.has(r.from))
        depthOf.set(r.from, depthOf.get(r.to)!);
    }
  const nodes: GraphNode[] = network.nodes.map((e) => {
    const depth = depthOf.get(e.id) ?? 0;
    const rows = model.rows.filter((r) => r.entityId === e.id);
    const w = earliest(rows);
    const isSource = e.id === source;
    const tone: GraphTone = isSource
      ? "source"
      : rows.length
        ? toneForWindow(w)
        : depth < 0
          ? "green"
          : "grey";
    return {
      id: e.id,
      kind: isSource ? "source" : "facility",
      label: e.label || e.id,
      idt: idtPath(e),
      sub: isSource
        ? `${lower(say(seed.lossType))} · source`
        : rows.length
          ? `At risk ${windowText(w)}`
          : depth < 0
            ? "Normal · upstream"
            : deps.some((d) => d.dependent === e.id && d.excludedReason)
              ? "Not affected"
              : "No modeled impact",
      tone,
      line: !isSource && !rows.length && depth >= 0 ? "dashed" : "solid",
      weight: 1,
      direction: depth < 0 ? "up" : "down",
      depth,
      entityId: e.id,
    };
  });
  const functions = new Map(
    model.captured.serviceFunctions.map((f) => [f.id, f.label]),
  );
  const tones = new Map(nodes.map((n) => [n.id, n.tone]));
  const edges: GraphEdge[] = [
    ...deps.map((d) => {
      const upstream = (depthOf.get(d.dependent) ?? 0) <= 0;
      const fn = d.dependentFunction
        ? functions.get(d.dependentFunction)
        : null;
      return {
        id: d.id,
        from: d.provider,
        to: d.dependent,
        label: upstream || !fn ? say(d.requiredService) : lower(fn),
        tone: upstream
          ? ("green" as GraphTone)
          : (tones.get(d.dependent) ?? "grey"),
        dashed: !!d.excludedReason,
      };
    }),
    ...network.relations.map((r) => ({
      id: r.id,
      from: r.from,
      to: r.to,
      label: r.kind.replace(/ context$/, ""),
      tone: "grey" as GraphTone,
      dashed: true,
    })),
  ];
  return {
    title: "Explore dependencies",
    hint: "Select a node for details · use Expand upstream to add suppliers",
    nodes,
    edges,
  };
}

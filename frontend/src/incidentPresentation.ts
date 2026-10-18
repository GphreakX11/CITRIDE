import { infrastructureKind, type InfrastructureIconItem } from "./infrastructureIcons.ts";
import { idtSectorName, sectorOf as idtSectorOf, type IdtIndex } from "./idt.ts";
import { object, list, text, type RecordItem } from "./scriptedTypes.ts";
export { defaultIncidentId } from "./incidentSelection.ts";
export type { IncidentSelectionRecords, IncidentSelectionConfig } from "./incidentSelection.ts";

/** API records only. No fetching, model computation, storage or customer constants. */
export interface IncidentAnalysis {
  id?: string;
  kind?: string;
  createdAt?: string;
  computedAt?: string;
  [key: string]: unknown;
}
const timestamp = (value: unknown) => {
  const time = Date.parse(text(value));
  return Number.isFinite(time) ? time : -Infinity;
};
/** Reviewed beats preliminary even if older. A captured case run is reviewed. */
export function bestAnalysisFor(incident: unknown): IncidentAnalysis | null {
  const row = object(incident);
  const candidates: { analysis: IncidentAnalysis; reviewed: boolean }[] = [];
  const add = (value: unknown, reviewed = false) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const analysis = value as IncidentAnalysis;
    if (!Object.keys(analysis).length) return;
    candidates.push({ analysis, reviewed: reviewed || analysis.kind === "reviewed" });
  };
  for (const analysis of list(row.analyses)) add(analysis);
  add(row.analysis);
  add(row.preliminaryAnalysis);
  add(row.reviewedAnalysis, true);
  add(row.runSnapshot, true);
  candidates.sort((a, b) => Number(b.reviewed) - Number(a.reviewed)
    || timestamp(b.analysis.computedAt ?? b.analysis.createdAt) - timestamp(a.analysis.computedAt ?? a.analysis.createdAt)
    || text(a.analysis.id).localeCompare(text(b.analysis.id)));
  return candidates[0]?.analysis ?? null;
}
const validWindow = (value: unknown) => Array.isArray(value) && value.length === 2
  && value.every(n => typeof n === "number" && Number.isFinite(n)) && value[0] >= 0 && value[1] >= value[0];
/** Harm beyond the source, never severity or existence of an analyst case. */
export function hasCascadingImpact(incident: unknown): boolean {
  const row = object(incident);
  if (["closed", "recovering"].includes(text(row.status, text(object(row.incident).status)))) return false;
  const analysis = bestAnalysisFor(incident);
  if (!analysis) return false;
  const run = object(analysis.run ?? (Array.isArray(row.nodes) ? row : analysis));
  const source = text(object(run.source).id, text(object(run.seed).provider, text(object(run.seed).entityId)));
  const sourceIds = new Set([source, ...list(run.nodes).filter(n => n.source).map(n => n.id)]);
  const impacts = Array.isArray(run.impacts) ? list(run.impacts) : list(run.nodes);
  return impacts.some(item => !sourceIds.has(text(item.entityId, item.id)) && !item.source && !item.notAffected
    && validWindow(item.windowHours)
    && (item.state === undefined || ["at_risk", "degraded", "failed"].includes(text(item.state)))
    && (item.lossOfFunction === undefined || (typeof item.lossOfFunction === "number" && item.lossOfFunction > 0)));
}
/** Returns the record's sector label, then the IDT top-level reference label. */
export function sectorOf(entity: unknown, index: IdtIndex | null = null): string | null {
  const row = object(entity);
  if (text(row.sector).trim()) return text(row.sector).trim();
  if (index) return idtSectorOf(row, index)?.name ?? null;
  const assignment = object(row.idt);
  const path = assignment.status === "coded" ? text(assignment.path)
    : assignment.status === "below_idt_level" ? text(assignment.parentPath) : "";
  return path ? idtSectorName(path.split(".")[0]) : null;
}
/** Icon token accepted by InfrastructureIcon: explicit > supplied type map > legacy map. */
export function iconFor(entity: InfrastructureIconItem & { icon?: string }, entityIcons: Readonly<Record<string, string>> = {}): string {
  if (entity.icon?.trim()) return entity.icon.trim();
  const mapped = entity.type && Object.hasOwn(entityIcons, entity.type) ? entityIcons[entity.type] : undefined;
  return mapped?.trim() || infrastructureKind(entity);
}
/** Central record collection is authoritative when supplied; no event-derived watch inference. */
export function watchAssetsFor(incident: unknown, records?: { watchAssets?: readonly RecordItem[] }): RecordItem[] {
  const row = object(incident);
  if (records) return (records.watchAssets ?? []).filter(item => item.incidentId === row.id);
  return list(row.watchAssets);
}
/** Union of entity IDs on captured model paths, including source and target.
 * Paths contain dependency IDs, not entity IDs. Edges resolve them without rerunning
 * the model; raw runs resolve against their captured baselineSnapshot dependencies.
 */
export function pathToSource(entityId: string, analysis: unknown): string[] {
  const outer = object(analysis);
  const run = object(outer.run ?? outer);
  const source = text(object(run.source).id, text(object(run.seed).provider, text(object(run.seed).entityId)));
  if (source === entityId) return [entityId];
  const nodes = [...list(run.nodes), ...list(run.impacts)];
  const targets = nodes.filter(node => text(node.entityId, node.id) === entityId);
  if (!targets.length) return [];
  const snapshot = object(run.baselineSnapshot);
  const edges = [...list(run.edges), ...list(snapshot.dependencies)];
  const edgeById = new Map(edges.map(edge => [edge.id, edge]));
  const result = new Set<string>();
  for (const target of targets) {
    for (const path of Array.isArray(target.paths) ? target.paths : []) {
      if (!Array.isArray(path)) continue;
      const resolved = path.map(id => edgeById.get(id));
      // Never invent connectivity when the captured path cannot be resolved.
      if (!resolved.length || resolved.some(edge => !edge)) continue;
      for (const edge of resolved) {
        const from = text(edge!.from, text(edge!.provider));
        const to = text(edge!.to, text(edge!.dependent));
        if (from) result.add(from);
        if (to) result.add(to);
      }
      if (source) result.add(source);
      result.add(entityId);
    }
  }
  if (result.size) return [...result];
  // Connected, non-impacted nodes have no modeled loss paths. For filtering
  // only, intersect source reachability with target ancestry (cycle-safe).
  const forward = new Map<string, string[]>(), reverse = new Map<string, string[]>();
  for (const edge of edges) {
    const from = text(edge.from, text(edge.provider)), to = text(edge.to, text(edge.dependent));
    if (!from || !to) continue;
    forward.set(from, [...(forward.get(from) ?? []), to]);
    reverse.set(to, [...(reverse.get(to) ?? []), from]);
  }
  const walk = (start: string, adjacency: Map<string, string[]>) => {
    const visited = new Set<string>(), queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push(...(adjacency.get(id) ?? []));
    }
    return visited;
  };
  if (!source) return [];
  const reachable = walk(source, forward);
  if (!reachable.has(entityId)) return [];
  const ancestors = walk(entityId, reverse);
  return [...reachable].filter(id => ancestors.has(id));
}

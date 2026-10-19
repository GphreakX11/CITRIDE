import { defaultIncidentId, type IncidentSelectionRecords } from "./incidentSelection.ts";
export type Hours = [number, number] | null;
export interface C4Watch {
  entityId: string; reason: string; status?: string; inCascade?: boolean;
  entity?: { name?: string; label?: string; icon?: string; type?: string; sector?: string } | null;
}
export interface C4SectorView {
  sector: string; idt?: string; score?: number | null;
  items: { label: string; idt?: string; score?: number | null; status?: string; entityId?: string; tag?: string }[];
  vessels?: { name: string; role?: string; status?: string }[];
}
export interface ConsequenceNode {
  id: string;
  name: string;
  label?: string;
  type: string;
  sector: string;
  icon?: string;
  score?: number | null;
  schematic?: { x: number; y: number };
  watch?: C4Watch[];
  source?: boolean;
  upstream?: boolean;
  connected?: boolean;
  inArea?: boolean;
  notAffected?: boolean;
  status?: string | null;
  windowHours: Hours;
  impactCount: number;
  order?: number | null;
  paths: string[][];
  reserves: [number, number][];
  reserveLabel: string;
  sourceRefs: string[];
  idtPath?: string;
  idt?: { path?: string };
}
export interface ConsequenceIncident {
  id: string;
  referenceOnly?: boolean;
  title: string;
  caseId?: string;
  severity?: string;
}
export interface ConsequenceProjection {
  now: string;
  featuredIncidentId?: string | null;
  operationsTimeZone?: string;
  incidents: ConsequenceIncident[];
  incident: ConsequenceIncident | null;
  analysis: null | {
    kind: string;
    request?: { horizonHours: number };
    createdAt: string;
    computedAt?: string;
    modelVersion: string;
    seed: { lossType: string };
  };
  source?: {
    id: string;
    name: string;
    label?: string;
    type: string;
    idt?: { path?: string };
    throughput?: { value: number | string; unit: string; basis?: string };
    spread?: { level: string; note?: string };
  };
  sourceSystems?: { id: string; type: string; label?: string; name?: string; eventRefs: string[] }[];
  people?: number | null;
  serviceAffected?: { value: number; unit: string; note?: string } | null;
  atRisk?: number;
  infrastructureCount?: number;
  cascadeCount?: number;
  watchOnlyCount?: number;
  watchAssets?: C4Watch[];
  sectorLinks?: { id: string; from: string; fromKind: 'source' | 'sector'; to: string; service: string; step: number; windowHours: Hours; dependencyIds: string[] }[];
  entityIcons?: Record<string, string>;
  criticalFunctions?: { function: string; level: string; idt?: string; windowHours?: Hours; note?: string }[];
  sectorViews?: { sectors: C4SectorView[]; note?: string }[];
  consequenceScores?: { basis?: string; sectors: { sector: string; score?: number | null }[]; energySubsectors?: { label: string; idt?: string; score?: number | null }[] }[];
  earliestWindow?: Hours;
  restoration?: { hours: Hours; basis?: string; note?: string } | null;
  economic?: { dailyUsd: [number, number]; basis: string } | null;
  publicAction?: { action: string; decidedBy: string } | null;
  nodes: ConsequenceNode[];
  edges: { id: string; from: string; to: string; label: string }[];
  sectors: {
    label: string;
    source: boolean;
    score?: number | null;
    atRisk: number;
    windowHours: Hours;
    order: number | null;
    spread?: { level: string; note?: string };
    nodes: string[];
  }[];
  alternatives?: {
    label: string;
    covers?: string;
    status: string;
    checkFirst?: boolean;
    note?: string;
  }[];
  thresholds?: { hours: number; text: string; basis?: string }[];
  responseOwners?: { role: string; who: string; does: string }[];
  confidence?: { level: string; note: string; value?: number };
}
export const missing = "Not recorded for this asset";
export function hours(value?: Hours): string {
  if (value && value[0] >= 48 && value.every(v => v % 24 === 0))
    return `${value[0] / 24}–${value[1] / 24} days`;
  return value ? `${value[0]}–${value[1]} h` : missing;
}
export function windowTone(value?: Hours): string {
  return value ? (value[0] < 4 ? "red" : "amber") : "grey";
}
export function consequenceNodeState(node: Partial<ConsequenceNode>) {
  if (node.source) return { tone: "red", line: "solid", label: "Source" };
  if (node.windowHours)
    return {
      tone: windowTone(node.windowHours),
      line: "solid",
      label: hours(node.windowHours),
    };
  if (node.watch?.length || node.status === "on_watch")
    return { tone: "amber", line: "dashed", label: "On watch · no modeled service loss" };
  if (node.notAffected)
    return { tone: "grey", line: "dashed", label: "Not affected" };
  if (node.inArea && !node.connected)
    return { tone: "grey", line: "dotted", label: "In area · no dependency" };
  if (node.upstream && (!node.status || node.status === "normal"))
    return { tone: "green", line: "solid", label: "Normal · upstream" };
  return { tone: "grey", line: "solid", label: "No status recorded" };
}
export function initialConsequenceIncident(
  search: string,
  selected?: string | null,
  records?: IncidentSelectionRecords,
) {
  const id = defaultIncidentId(records ?? { statewideIncidents: [] }, { url: `/${search}` });
  return id ?? (records ? null : selected ?? null);
}
export function elapsedLabel(timestamp: string, now: number) {
  const minutes = Math.max(
    0,
    Math.floor((now - Date.parse(timestamp)) / 60000),
  );
  if (!Number.isFinite(minutes)) return "Time not recorded";
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} days ago`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ago`;
  return `${minutes} min ago`;
}

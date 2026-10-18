export type Hours = [number, number] | null;
export interface ConsequenceNode {
  id: string;
  name: string;
  label?: string;
  type: string;
  sector: string;
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
  people?: number | null;
  serviceAffected?: { value: number; unit: string; note?: string } | null;
  atRisk?: number;
  earliestWindow?: Hours;
  restoration?: { hours: Hours; basis?: string; note?: string } | null;
  economic?: { dailyUsd: [number, number]; basis: string } | null;
  publicAction?: { action: string; decidedBy: string } | null;
  nodes: ConsequenceNode[];
  edges: { id: string; from: string; to: string; label: string }[];
  sectors: {
    label: string;
    source: boolean;
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
  confidence?: { level: string; note: string };
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
) {
  const query = new URLSearchParams(search);
  return (
    query.get("incidentId") || query.get("incident") || selected || "TX-26-0412"
  );
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

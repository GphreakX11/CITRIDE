import type {
  Dependency,
  Entity,
  Event,
  Run,
  Scenario,
  ServiceFunction,
  Source,
} from "./types.ts";

export const commandNavigation = [
  { id: "command", code: "S1", label: "Command overview", color: "#60a5fa" },
  { id: "cop", code: "S2", label: "Service-area COP", color: "#fb923c" },
  { id: "cyber", code: "S3", label: "Cyber operations", color: "#34d399" },
  { id: "coordination", code: "S4", label: "Coordination", color: "#fbbf24" },
  { id: "uctf", code: "S5", label: "Task force workspace", color: "#f472b6" },
  { id: "consequence", code: "S6", label: "Consequence", color: "#a78bfa" },
  { id: "leadership", code: "S7", label: "Leadership brief", color: "#22d3ee" },
  {
    id: "federation",
    code: "S8",
    label: "Organizations & handoff",
    color: "#cbd5e1",
  },
] as const;
export type CommandView = (typeof commandNavigation)[number]["id"];
export type IncidentPriority = "critical" | "high" | "medium" | "low";
export type IncidentStatus = "open" | "monitoring" | "closed";

export interface CommandContext {
  baselineRevision: number;
  event: Event;
  cyberAsset: Entity | null;
  physicalAsset: Entity | null;
  facility: Entity | null;
  provider: Entity | null;
  serviceArea: Entity | null;
  downstreamDependencies: {
    dependency: Dependency;
    dependent: Entity;
    function: ServiceFunction;
  }[];
  scenarios: Scenario[];
  sourceRefs: string[];
  warnings: string[];
}
export interface CommandTask {
  id: string;
  label: string;
  completed: boolean;
  completedAt: string | null;
}
export interface CommandDecision {
  id: string;
  title: string;
  entityId: string;
  entityLabel: string;
  functionId: string;
  functionLabel: string;
  state: string;
  windowHours: [number, number] | null;
  sourceRefs: string[];
  sourceSnapshots: Source[];
  assumptions: string[];
  reviewed: boolean;
  reviewNote: string | null;
  reviewedAt: string | null;
  authorityBasis: "not_configured";
  gateStatus: "not_evaluated";
}
export interface CommandIncident {
  id: string;
  version: number;
  title: string;
  priority: IncidentPriority;
  status: IncidentStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closureNote: string | null;
  eventId: string;
  baselineRevision: number;
  eventSnapshot: Event;
  contextSnapshot: CommandContext;
  tasks: CommandTask[];
  decisions: CommandDecision[];
  notes: { id: string; text: string; createdAt: string }[];
  activity: { id: string; kind: string; message: string; createdAt: string }[];
  runId: string | null;
  runSnapshot: Run | null;
}
export interface CommandCreate {
  eventId: string;
  title: string;
  priority: IncidentPriority;
  expectedBaselineRevision: number;
  clientRequestId: string;
}
export type CommandAction =
  | { action: "set_status"; status: IncidentStatus; note: string }
  | { action: "set_task"; taskId: string; completed: boolean }
  | { action: "review_decision"; decisionId: string; note: string }
  | { action: "add_note"; note: string }
  | {
      action: "analyze";
      scenarioId: string;
      evaluationHour: number;
      horizonHours: number;
    };
export type CommandActionRequest = CommandAction & {
  expectedVersion: number;
  clientRequestId: string;
};

export interface CommandMetrics {
  activeIncidents: number;
  pendingDecisions: number;
  pendingTasks: number;
  modeledFunctions: number;
  savedCoordinationNotes: number;
  closedIncidents: number;
  firstReviewMedianSeconds: number | null;
}

export interface Entity {
  id: string;
  label: string;
  type: string;
  partOf?: string;
  operatedBy?: string;
  serves?: string | string[];
  locatedIn?: string;
  hostsCyberAsset?: string | string[];
  hostedBy?: string;
  terrain?: string;
  sourceRefs: string[];
}

export interface ServiceFunction {
  id: string;
  label: string;
  entityId?: string;
  entity?: string;
  belongsTo?: string;
  facility?: string;
  service?: string;
  sourceRefs?: string[];
}

export interface Dependency {
  id: string;
  revision: number;
  provider: string;
  dependent: string;
  requiredService: string;
  dependentFunction: string;
  dependencyType: string;
  coupling: string;
  lossTypes: string[];
  propagationDelayMinHours: number;
  propagationDelayMaxHours: number;
  usableBackupMinHours: number | null;
  usableBackupMaxHours: number | null;
  validForLossTypes: string[];
  lossOfFunction: number;
  outputLossType: string | null;
  sourceRefs: string[];
  assumptionNote: string;
  classification: string;
  handling: string[];
}

export interface Source {
  id: string;
  label?: string;
  title?: string;
  description?: string;
  handling?: string[];
  [key: string]: unknown;
}

export interface Scenario {
  id: string;
  label: string;
  description: string;
  seed: {
    provider: string;
    service: string;
    lossType: string;
    windowHours: [number, number];
    persistsThroughHour: number;
    eventRefs: string[];
    sourceRefs: string[];
  };
}

export interface Event {
  id: string;
  label?: string;
  title?: string;
  description?: string;
  timestamp?: string;
  eventTime?: string;
  hour?: number;
  relativeTimeHours?: number;
  type?: string;
  sourceRefs?: string[];
  [key: string]: unknown;
}

export interface Bootstrap {
  baselineRevision: number;
  modelVersion: string;
  entities: Entity[];
  serviceFunctions: ServiceFunction[];
  dependencies: Dependency[];
  sources: Source[];
  assumptions: Record<string, unknown>[];
  events: Event[];
  assessments: Record<string, unknown>[];
  scenarios: Scenario[];
  defaultScenarioId: string;
}

export interface Override {
  dependencyId: string;
  backupMinHours: number | null;
  backupMaxHours: number | null;
  note: string;
}

export interface RunRequest {
  scenarioId: string;
  evaluationHour: number;
  horizonHours: number;
  overrides: Override[];
}

export interface Impact {
  id: string;
  entityId: string;
  functionId: string;
  lossType: string;
  state: "at_risk" | "degraded" | "failed" | "unknown";
  evidenceStatus: "modeled";
  windowHours: [number, number] | null;
  timingStatus: string;
  lossOfFunction: number;
  paths: string[][];
  sourceRefs: string[];
  assumptions: string[];
}

export interface Run {
  id: string;
  createdAt?: string;
  scenarioId: string;
  baselineRevision: number;
  modelVersion: string;
  request: RunRequest;
  seed: Scenario["seed"];
  impacts: Impact[];
  excluded: unknown[];
  warnings: unknown[];
  baselineSnapshot: unknown;
}

export interface RunSummary {
  id: string;
  createdAt: string;
  scenarioId: string;
  baselineRevision: number;
}

export interface Comparison {
  leftRunId: string;
  rightRunId: string;
  changes: {
    entityId: string;
    functionId: string;
    leftWindowHours: [number, number] | null;
    rightWindowHours: [number, number] | null;
    leftState: string | null;
    rightState: string | null;
  }[];
}

export interface Proposal {
  id: string;
  status: string;
  dependency: Dependency;
  expectedBaselineRevision: number;
}

export interface Validation {
  id: string;
  status: string;
  valid: boolean;
  errors: string[];
}

export interface Telemetry {
  streams: {
    id: string;
    label: string;
    sourceRef: string;
    records: Record<string, unknown>[];
  }[];
}

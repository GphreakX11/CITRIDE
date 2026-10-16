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
  incidentOrigin?: string;
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
  clientRequestId?: string;
  expectedBaselineRevision?: number;
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
    format?: string;
    origin?: string;
    records: Record<string, unknown>[];
  }[];
}

export interface OntologyAxiom {
  id: string;
  label: string;
  description: string;
}

export interface OntologyMetadata {
  id: string;
  version: string;
  sha256: string;
  axioms: OntologyAxiom[];
  profile: string;
  engine: { name: string; version: string };
  limitations?: string[];
  /** Complete validated ontology source counts, distinct from a run's loaded slice. */
  idtClassCount?: number;
  classCount?: number;
  loadedIdtClassCount?: number;
  loadedClassCount?: number;
  idtLoadMode?: "full" | "assigned_closure";
}

export interface InferenceTerm {
  id: string;
  iri: string;
  label: string;
}

export interface InferenceFact {
  id: string;
  subject: InferenceTerm;
  predicate: { iri: string; label: string };
  object: InferenceTerm;
  status: "asserted" | "inferred";
  sourceRefs: string[];
  axiomIds: string[];
  premiseFactIds: string[];
}

export interface InferenceRunSummary {
  id: string;
  createdAt: string;
  baselineRevision: number;
  ontologyVersion: string;
  inferredCount: number;
  stale?: boolean;
  staleReasons?: { baselineRevision: boolean; ontology: boolean };
}

export interface InferenceRun {
  id: string;
  baselineRevision: number;
  createdAt?: string;
  profile: string;
  engine: { name: string; version: string };
  ontology: Pick<OntologyMetadata, "id" | "version" | "sha256" | "axioms">;
  baselineSnapshot: unknown;
  assertedFacts: InferenceFact[];
  inferredFacts: InferenceFact[];
  warnings: unknown[];
  limitations?: string[];
  diagnostics: unknown[];
  statistics: Record<string, unknown>;
  stale?: boolean;
  staleReasons?: { baselineRevision: boolean; ontology: boolean };
  currentBaselineRevision?: number;
  currentOntologySha256?: string;
}

export interface InferenceProof {
  runId: string;
  fact: InferenceFact;
  proofFacts: InferenceFact[];
  axioms: OntologyAxiom[];
  sources: Source[];
  baselineRevision: number;
}

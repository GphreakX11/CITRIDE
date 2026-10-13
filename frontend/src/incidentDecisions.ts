import { displayText } from "./presentation.ts";
import type { Impact, Run } from "./types.ts";

export interface ReviewSource {
  readonly id: string;
  readonly label: string;
  readonly description: string | null;
  readonly known: boolean;
}
export interface ReviewPathStep {
  readonly id: string;
  readonly label: string;
  readonly assumption: string | null;
  readonly known: boolean;
}
export interface IncidentDecisionCard {
  readonly id: string;
  readonly title: string;
  readonly entityLabel: string;
  readonly functionLabel: string;
  readonly state: Impact["state"];
  readonly lossType: string;
  readonly windowHours: readonly [number, number] | null;
  readonly timingStatus: string;
  readonly lossOfFunction: number;
  readonly paths: readonly (readonly ReviewPathStep[])[];
  readonly sources: readonly ReviewSource[];
  readonly assumptions: readonly string[];
  readonly warnings: readonly string[];
  readonly options: readonly string[];
  readonly authorityBasis: "Not configured";
  readonly policyGates: "Not evaluated — approved policy definitions required";
}
export interface IncidentDecisionReview {
  readonly status: "no-run" | "unrelated-run" | "invalid-snapshot" | "ready";
  readonly message: string;
  readonly runId: string | null;
  readonly baselineRevision: number | null;
  readonly modelVersion: string | null;
  readonly scenarioLabel: string | null;
  readonly warnings: readonly string[];
  readonly cards: readonly IncidentDecisionCard[];
}

const options = Object.freeze([
  "Review reserve and source assumptions.",
  "Confirm service conditions with the responsible operator.",
  "Compare a what-if reserve in the scenario lab; no operational change is applied.",
]);

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}
function identified(
  value: unknown,
): value is Record<string, unknown> & { id: string } {
  return record(value) && typeof value.id === "string" && value.id.length > 0;
}
function collection(
  value: unknown,
): value is (Record<string, unknown> & { id: string })[] {
  return (
    Array.isArray(value) &&
    value.every(identified) &&
    new Set(value.map((item) => item.id)).size === value.length
  );
}

/** Narrow aliases for engine-authored copy; custom records and raw run data stay intact. */
export function reviewDisplayText(value: string): string {
  if (
    value ===
    "SIMULATED physical-effect seed; no observed facility failure is asserted."
  ) {
    return "Conditional physical-effect seed; no observed facility failure is asserted.";
  }
  if (
    value ===
    "Explicit simulated effect and persistence; not an observed operational effect."
  ) {
    return "Explicit assumed effect and persistence; not an observed operational effect.";
  }
  const linkNote =
    "Synthetic link and parameters initialized in local baseline version 1. No real-world verification or authority approval is implied. Output loss conversion, where present, is an explicit scenario assumption.";
  const revisionNote = /^(\S+ revision \d+: )/.exec(value);
  if (revisionNote && value.slice(revisionNote[0].length) === linkNote) {
    return revisionNote[0] + displayText(linkNote);
  }
  if (/^SIMULATED what-if reserve \[[\d., ]+\]: /.test(value)) {
    return value.replace(/^SIMULATED what-if reserve /, "What-if reserve ");
  }
  if (
    /^\S+: \S+\/\S+ becomes \S+\/\S+ under an explicit simulated service-loss conversion\.$/.test(
      value,
    )
  ) {
    return value.replace(
      "under an explicit simulated service-loss conversion.",
      "under an explicit assumed service-loss conversion.",
    );
  }
  return displayText(value);
}

export function reviewWarning(value: unknown): string {
  if (typeof value === "string") return reviewDisplayText(value);
  if (record(value) && typeof value.message === "string")
    return reviewDisplayText(value.message);
  return JSON.stringify(value) ?? "Warning details unavailable";
}

function validImpact(value: unknown): value is Impact {
  if (!record(value)) return false;
  const window = value.windowHours;
  return (
    ["id", "entityId", "functionId", "lossType", "timingStatus"].every(
      (key) => typeof value[key] === "string",
    ) &&
    ["at_risk", "degraded", "failed", "unknown"].includes(
      String(value.state),
    ) &&
    value.evidenceStatus === "modeled" &&
    typeof value.lossOfFunction === "number" &&
    Number.isFinite(value.lossOfFunction) &&
    value.lossOfFunction >= 0 &&
    value.lossOfFunction <= 1 &&
    (window === null ||
      (Array.isArray(window) &&
        window.length === 2 &&
        window.every(
          (bound) => typeof bound === "number" && Number.isFinite(bound),
        ) &&
        window[0] <= window[1])) &&
    Array.isArray(value.paths) &&
    value.paths.every(strings) &&
    strings(value.sourceRefs) &&
    strings(value.assumptions)
  );
}

/** Pure review derivation. Never uses the current baseline to relabel historical evidence. */
export function deriveIncidentDecisions(
  run: Run | null,
  eventId: string,
  matchedScenarioIds: readonly string[],
): IncidentDecisionReview {
  const base = {
    runId: run?.id ?? null,
    baselineRevision: run?.baselineRevision ?? null,
    modelVersion: run ? displayText(run.modelVersion) : null,
    scenarioLabel: null,
    warnings: Object.freeze((run?.warnings ?? []).map(reviewWarning)),
    cards: Object.freeze([]) as readonly IncidentDecisionCard[],
  };
  const result = (status: IncidentDecisionReview["status"], message: string) =>
    Object.freeze({ ...base, status, message });
  if (!run)
    return result(
      "no-run",
      "No consequence run is available for review. Model a linked scenario first.",
    );
  if (
    !strings(run.seed?.eventRefs) ||
    !run.seed.eventRefs.includes(eventId) ||
    !matchedScenarioIds.includes(run.scenarioId) ||
    run.request.scenarioId !== run.scenarioId
  ) {
    return result(
      "unrelated-run",
      "The retained lab run does not match this event and its explicitly linked scenario. Its decision cards are not shown.",
    );
  }
  const snapshot = run.baselineSnapshot;
  if (
    !record(snapshot) ||
    snapshot.baselineRevision !== run.baselineRevision ||
    !collection(snapshot.entities) ||
    !collection(snapshot.serviceFunctions) ||
    !collection(snapshot.dependencies) ||
    !collection(snapshot.sources) ||
    !collection(snapshot.scenarios) ||
    !Array.isArray(run.impacts) ||
    !run.impacts.every(validImpact)
  ) {
    return result(
      "invalid-snapshot",
      "Captured evidence is missing or invalid. Advisory cards cannot be derived safely; open evidence or rerun the linked scenario.",
    );
  }
  const scenario = snapshot.scenarios.find(
    (item) => item.id === run.scenarioId,
  );
  if (
    !scenario ||
    !record(scenario.seed) ||
    !strings(scenario.seed.eventRefs) ||
    !scenario.seed.eventRefs.includes(eventId)
  ) {
    return result(
      "invalid-snapshot",
      "The captured scenario does not establish an explicit link to this event. Advisory cards are withheld.",
    );
  }
  const label = (
    items: (Record<string, unknown> & { id: string })[],
    id: string,
    kind: string,
  ) => {
    const item = items.find((entry) => entry.id === id);
    return item && typeof item.label === "string"
      ? displayText(item.label)
      : `Unknown ${kind} (${id})`;
  };
  const {
    entities,
    serviceFunctions,
    dependencies,
    sources: snapshotSources,
  } = snapshot;
  const cards = run.impacts.map((impact): IncidentDecisionCard => {
    const warnings: string[] = [...base.warnings];
    const entityLabel = label(entities, impact.entityId, "entity");
    const functionLabel = label(
      serviceFunctions,
      impact.functionId,
      "service function",
    );
    if (!entities.some((item) => item.id === impact.entityId))
      warnings.push(
        `Entity ${impact.entityId} is absent from the captured snapshot.`,
      );
    if (!serviceFunctions.some((item) => item.id === impact.functionId))
      warnings.push(
        `Service function ${impact.functionId} is absent from the captured snapshot.`,
      );
    const paths = impact.paths.map((path) =>
      Object.freeze(
        path.map((id): ReviewPathStep => {
          const dependency = dependencies.find((entry) => entry.id === id);
          const known =
            !!dependency &&
            typeof dependency.provider === "string" &&
            typeof dependency.dependent === "string";
          if (!known)
            warnings.push(
              `Dependency ${id} is unresolved in the captured snapshot.`,
            );
          return Object.freeze({
            id,
            known,
            label: known
              ? `${label(entities, String(dependency!.provider), "provider")} → ${label(entities, String(dependency!.dependent), "dependent")}`
              : "Unknown dependency",
            assumption:
              dependency && typeof dependency.assumptionNote === "string"
                ? reviewDisplayText(dependency.assumptionNote)
                : null,
          });
        }),
      ),
    );
    const sources = impact.sourceRefs.map((id): ReviewSource => {
      const source = snapshotSources.find((entry) => entry.id === id);
      if (!source)
        warnings.push(
          `Source ${id} is not present in the captured snapshot; no label or evidence is inferred.`,
        );
      return Object.freeze({
        id,
        known: !!source,
        label: source
          ? displayText(
              typeof source.label === "string"
                ? source.label
                : typeof source.title === "string"
                  ? source.title
                  : id,
            )
          : `Unknown source (${id})`,
        description:
          source && typeof source.description === "string"
            ? reviewDisplayText(source.description)
            : null,
      });
    });
    const windowHours =
      impact.windowHours === null
        ? null
        : (Object.freeze([...impact.windowHours]) as readonly [number, number]);
    return Object.freeze({
      id: impact.id,
      title: `Review continuity: ${entityLabel}`,
      entityLabel,
      functionLabel,
      state: impact.state,
      lossType: impact.lossType,
      windowHours,
      timingStatus: impact.timingStatus,
      lossOfFunction: impact.lossOfFunction,
      paths: Object.freeze(paths),
      sources: Object.freeze(sources),
      assumptions: Object.freeze(impact.assumptions.map(reviewDisplayText)),
      warnings: Object.freeze([...new Set(warnings)]),
      options,
      authorityBasis: "Not configured",
      policyGates: "Not evaluated — approved policy definitions required",
    });
  });
  // Earliest modeled onset first; unknown timing remains explicitly unknown.
  cards.sort(
    (a, b) =>
      (a.windowHours?.[0] ?? Infinity) - (b.windowHours?.[0] ?? Infinity) ||
      a.id.localeCompare(b.id),
  );
  return Object.freeze({
    ...base,
    status: "ready",
    message: "Review draft · not an approved decision record",
    scenarioLabel:
      typeof scenario.label === "string"
        ? displayText(scenario.label)
        : run.scenarioId,
    cards: Object.freeze(cards),
  });
}

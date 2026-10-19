import type { CommandAction, CommandIncident } from "./commandTypes.ts";
import type { Bootstrap, RunRequest, Scenario } from "./types.ts";

/** Captured scenarios stay available; alternate models follow upstream service links, not names. */
export function analysisScenarios(data: Bootstrap, incident: CommandIncident): Scenario[] {
  const linked = incident.contextSnapshot.scenarios;
  const providers = new Set(linked.map((scenario) => scenario.seed.provider));
  if (incident.contextSnapshot.provider) providers.add(incident.contextSnapshot.provider.id);
  const pending = [...providers];
  for (let i = 0; i < pending.length; i++) {
    for (const dependency of data.dependencies) {
      if (dependency.dependent === pending[i] && !providers.has(dependency.provider)) {
        providers.add(dependency.provider);
        pending.push(dependency.provider);
      }
    }
  }
  return [...linked, ...data.scenarios.filter((scenario) =>
    !linked.some((captured) => captured.id === scenario.id) && providers.has(scenario.seed.provider))];
}

export function analysisHorizons(scenarios: Scenario[], captured?: number): number[] {
  return [...new Set([12, 24, captured, ...scenarios.map((scenario) => scenario.horizonHours)]
    .filter((hours): hours is number => typeof hours === "number" && Number.isFinite(hours) && hours > 0 && hours <= 7200))]
    .sort((a, b) => a - b);
}
export type AnalysisIntent =
  | { kind: "capture"; caseId: string; version: number; action: CommandAction }
  | { kind: "separate"; caseId: string; version: number; request: RunRequest };
/** Case captures are write-once for A4 exploration; switching scenarios is never a case mutation. */
export function analysisIntent(
  incident: CommandIncident,
  scenarioId: string,
  horizonHours: number,
): AnalysisIntent {
  if (!scenarioId || !analysisHorizons(incident.contextSnapshot.scenarios, incident.runSnapshot?.request.horizonHours).includes(horizonHours))
    throw new Error("Choose a scenario and a supported planning horizon.");
  const evaluationHour = incident.runSnapshot?.request.evaluationHour ?? 1;
  if (evaluationHour > horizonHours)
    throw new Error("Look-ahead must include the captured evaluation hour.");
  const base = { caseId: incident.id, version: incident.version };
  if (
    !incident.runSnapshot &&
    incident.contextSnapshot.scenarios.some((s) => s.id === scenarioId)
  )
    return {
      ...base,
      kind: "capture",
      action: { action: "analyze", scenarioId, evaluationHour, horizonHours },
    };
  return {
    ...base,
    kind: "separate",
    request: { scenarioId, evaluationHour, horizonHours, overrides: [] },
  };
}

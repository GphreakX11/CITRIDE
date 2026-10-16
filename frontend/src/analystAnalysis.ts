import type { CommandAction, CommandIncident } from "./commandTypes.ts";
import type { RunRequest } from "./types.ts";
export type AnalysisIntent =
  | { kind: "capture"; caseId: string; version: number; action: CommandAction }
  | { kind: "separate"; caseId: string; version: number; request: RunRequest };
/** Case captures are write-once for A4 exploration; switching scenarios is never a case mutation. */
export function analysisIntent(
  incident: CommandIncident,
  scenarioId: string,
  horizonHours: number,
): AnalysisIntent {
  if (!scenarioId || ![12, 24].includes(horizonHours))
    throw new Error("Choose a scenario and a 12 or 24 hour look-ahead.");
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

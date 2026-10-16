import type { Impact, Run } from "./types.ts";

/** GET /v1/reference uses low/high, not the design draft's costPerHour fields. */
export interface PlanningRate {
  functionId?: string;
  low?: number;
  high?: number;
}
export interface ExposureSummary {
  horizonHours: number;
  serviceHours: [number, number];
  costUsd: [number, number] | null;
  notEstimated: {
    entityId: string;
    functionId: string;
    reason: "unknown_timing" | "no_rate";
  }[];
  referenceVersion: string;
}
function hours(impact: Impact, horizon: number): [number, number] | null {
  if (
    !impact.windowHours ||
    !impact.windowHours.every(Number.isFinite) ||
    !Number.isFinite(impact.lossOfFunction)
  )
    return null;
  return [
    Math.max(0, horizon - impact.windowHours[1]) * impact.lossOfFunction,
    Math.max(0, horizon - impact.windowHours[0]) * impact.lossOfFunction,
  ];
}
function rateIndex(rates: PlanningRate[]) {
  return new Map(
    rates
      .filter(
        (r) =>
          r.functionId &&
          Number.isFinite(r.low) &&
          Number.isFinite(r.high) &&
          r.low! >= 0 &&
          r.high! >= r.low!,
      )
      .map((r) => [r.functionId!, [r.low!, r.high!] as [number, number]]),
  );
}
export function runExposure(
  run: Run,
  rates: PlanningRate[],
  referenceVersion: string,
): ExposureSummary {
  const index = rateIndex(rates);
  const summary: ExposureSummary = {
    horizonHours: run.request.horizonHours,
    serviceHours: [0, 0],
    costUsd: null,
    notEstimated: [],
    referenceVersion,
  };
  for (const impact of run.impacts) {
    const interval = hours(impact, run.request.horizonHours);
    if (!interval) {
      summary.notEstimated.push({
        entityId: impact.entityId,
        functionId: impact.functionId,
        reason: "unknown_timing",
      });
      continue;
    }
    summary.serviceHours[0] += interval[0];
    summary.serviceHours[1] += interval[1];
    const rate = index.get(impact.functionId);
    if (!rate) {
      summary.notEstimated.push({
        entityId: impact.entityId,
        functionId: impact.functionId,
        reason: "no_rate",
      });
      continue;
    }
    summary.costUsd ??= [0, 0];
    summary.costUsd[0] += interval[0] * rate[0];
    summary.costUsd[1] += interval[1] * rate[1];
  }
  return summary;
}
/** Optional view-time rates keep the two-run API valid without fabricating dollars. */
export function exposureAvoided(
  base: Run,
  whatIf: Run,
  rates: PlanningRate[] = [],
  referenceVersion = "unavailable",
):
  Pick<ExposureSummary, "serviceHours" | "costUsd"> | { incomparable: string } {
  for (const field of [
    "scenarioId",
    "evaluationHour",
    "horizonHours",
  ] as const) {
    if (base.request[field] !== whatIf.request[field])
      return { incomparable: `Cannot compare different ${field}.` };
  }
  if (base.scenarioId !== whatIf.scenarioId)
    return { incomparable: "Cannot compare different scenarioId." };
  // Correlated endpoint differences, NOT independent interval subtraction: a
  // four-hour reserve shift buys four hours at both endpoints, not two to six.
  const a = runExposure(base, rates, referenceVersion),
    b = runExposure(whatIf, rates, referenceVersion);
  if (
    a.notEstimated.some((i) => i.reason === "unknown_timing") ||
    b.notEstimated.some((i) => i.reason === "unknown_timing")
  )
    return { incomparable: "Cannot compare exposure with unknown timing." };
  return {
    serviceHours: [
      a.serviceHours[0] - b.serviceHours[0],
      a.serviceHours[1] - b.serviceHours[1],
    ],
    costUsd:
      a.costUsd && b.costUsd
        ? [a.costUsd[0] - b.costUsd[0], a.costUsd[1] - b.costUsd[1]]
        : null,
  };
}
export function exposureDollars(value: [number, number] | null): string {
  if (!value) return "Dollars not estimated";
  const dollar = (n: number) =>
    `$${(Math.round(n / 1000) * 1000).toLocaleString("en-US")}`;
  return `${dollar(value[0])}–${dollar(value[1])}`;
}

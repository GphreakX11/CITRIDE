import type { CommandIncident } from "./commandTypes.ts";
import type {
  Entity,
  Dependency,
  ServiceFunction,
  Run,
  Source,
} from "./types.ts";
import type { ReferenceData } from "./scriptedTypes.ts";
export function planningRates(
  reference?: ReferenceData,
): Record<string, [number, number]> {
  return Object.fromEntries(
    (reference?.planningRates ?? [])
      .filter(
        (r) =>
          typeof r.functionId === "string" &&
          typeof r.low === "number" &&
          typeof r.high === "number",
      )
      .map((r) => [r.functionId!, [r.low!, r.high!]]),
  );
}
export function snapshot(run: Run | null) {
  const raw = run?.baselineSnapshot as
    | {
        entities?: Entity[];
        dependencies?: Dependency[];
        serviceFunctions?: ServiceFunction[];
        sources?: Source[];
      }
    | undefined;
  return {
    entities: Array.isArray(raw?.entities) ? raw.entities : [],
    dependencies: Array.isArray(raw?.dependencies) ? raw.dependencies : [],
    serviceFunctions: Array.isArray(raw?.serviceFunctions)
      ? raw.serviceFunctions
      : [],
    sources: Array.isArray(raw?.sources) ? raw.sources : [],
  };
}
export function impactRows(run: Run) {
  const data = snapshot(run);
  return run.impacts
    .map((impact) => ({
      ...impact,
      label:
        data.entities.find((e) => e.id === impact.entityId)?.label ??
        "Captured facility label unavailable",
      functionLabel:
        data.serviceFunctions.find((f) => f.id === impact.functionId)?.label ??
        "Captured function label unavailable",
      chains: impact.paths.map((path) =>
        path
          .map((id) => data.dependencies.find((d) => d.id === id))
          .filter((d): d is Dependency => !!d)
          .map(
            (d) =>
              `${data.entities.find((e) => e.id === d.provider)?.label ?? "Unknown provider"} → ${data.entities.find((e) => e.id === d.dependent)?.label ?? "Unknown dependent"} (${d.requiredService.replaceAll("_", " ")})`,
          ),
      ),
    }))
    .sort(
      (a, b) =>
        (a.windowHours?.[0] ?? Infinity) - (b.windowHours?.[0] ?? Infinity) ||
        a.entityId.localeCompare(b.entityId),
    );
}
export function exposure(run: Run, reference?: ReferenceData) {
  const rates = planningRates(reference);
  let minHours = 0,
    maxHours = 0,
    minCost = 0,
    maxCost = 0,
    estimatedRates = 0;
  const notEstimated: string[] = [];
  for (const i of run.impacts) {
    if (!i.windowHours) {
      notEstimated.push(`${i.entityId}: unknown timing`);
      continue;
    }
    const lo =
        Math.max(0, run.request.horizonHours - i.windowHours[1]) *
        i.lossOfFunction,
      hi =
        Math.max(0, run.request.horizonHours - i.windowHours[0]) *
        i.lossOfFunction;
    minHours += lo;
    maxHours += hi;
    const rate = rates[i.functionId];
    if (!rate) {
      notEstimated.push(`${i.entityId}: no planning rate`);
      continue;
    }
    estimatedRates++;
    minCost += lo * rate[0];
    maxCost += hi * rate[1];
  }
  return {
    serviceHours: [minHours, maxHours],
    costUsd: estimatedRates ? [minCost, maxCost] : null,
    notEstimated,
    referenceVersion: reference?.referenceVersion ?? "unavailable",
  };
}
export function responseOptions(reference?: ReferenceData) {
  return (reference?.responseOptions ?? []).map((option) => ({
    id: option.id,
    title: option.title ?? option.id,
    actor: option.actor ?? option.unit ?? "",
    basis: option.citation ?? "",
    verification: option.verification ?? "reference",
  }));
}
export function brief(incident: CommandIncident, reference?: ReferenceData) {
  const context = incident.contextSnapshot;
  const happened = [
    incident.eventSnapshot.label ??
      incident.eventSnapshot.title ??
      "Captured source event",
    incident.eventSnapshot.description ?? "Description not captured",
    context.provider
      ? `Captured utility: ${context.provider.label}.`
      : "Evidence is case-local; no utility/model link is established.",
  ];
  const soWhat = incident.runSnapshot
    ? impactRows(incident.runSnapshot).map(
        (i) =>
          `${i.label}: ${i.functionLabel}; ${i.state.replaceAll("_", " ")} ${i.windowHours ? `within ${i.windowHours[0]}–${i.windowHours[1]} scenario hours` : "with unknown timing"} (modeled).`,
      )
    : [
        "No captured consequence run. Physical service effects are not established.",
      ];
  return {
    title: incident.title,
    happened,
    soWhat,
    options: responseOptions(reference),
    sourceRefs: context.sourceRefs,
    status: "Draft — not sent",
  };
}
export type Audience = "txcc" | "water_partners" | "tdem_health" | "federal";
export function audienceView(
  audience: Audience,
  incident: CommandIncident,
  reference?: ReferenceData,
) {
  if (audience === "txcc")
    return {
      audience,
      title: "TXCC internal",
      shows: brief(incident, reference),
      notShown: [],
      status: "Draft — not sent",
    };
  const impactCount = incident.runSnapshot?.impacts.length ?? 0;
  const windows =
    incident.runSnapshot?.impacts.map((i) => ({
      windowHours: i.windowHours,
      state: "modeled",
      timingStatus: i.windowHours ? "scenario-relative" : "unknown",
    })) ?? [];
  return {
    audience,
    title:
      audience === "water_partners"
        ? "Water-sector partners"
        : audience === "tdem_health"
          ? "TDEM and healthcare"
          : "Federal partners",
    shows:
      audience === "water_partners"
        ? {
            summary: "A water-sector cyber observation is under review.",
            checks: [
              "Review relevant access and control records.",
              "Validate observations with the utility owner.",
            ],
            serviceEffects: "Not confirmed",
          }
        : audience === "tdem_health"
          ? {
              area: "a water service area",
              modeledFunctions: impactCount,
              planningWindows: windows,
              serviceEffects: "Modeled, not observed",
            }
          : {
              summary: "Water-sector cyber activity is under review.",
              release: "Owner consent required — not configured",
            },
    notShown: [
      "Utility, facility, vendor and service-area names",
      "Asset identifiers, private network addresses and raw records",
      "Free-form notes and planning cost estimates",
    ],
    status: "Draft — not sent",
  };
}
export function audienceMarkdown(view: ReturnType<typeof audienceView>) {
  return `# ${view.title}\n\n${view.status}\n\n## Shows\n\n${JSON.stringify(view.shows, null, 2)}\n\n## Not shown\n\n${view.notShown.map((t) => `- ${t}`).join("\n")}\n`;
}

import type {
  Bootstrap,
  Entity,
  Event,
  Run,
  RunSummary,
  RunRequest,
} from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";
import type { ReferenceData } from "./scriptedTypes.ts";
import { object, text, list, number } from "./scriptedTypes.ts";

export type EvidenceStatus =
  "effect_observed" | "compromise_suspected" | "probing_only" | "none";
export interface UtilityPriority {
  utilityId: string;
  label: string;
  evidenceStatus: EvidenceStatus;
  peopleServed: number | null;
  windowHours: [number, number] | null;
  facilityId: string | null;
  facilityLabel: string | null;
  potential: boolean;
  runId: string | null;
  firstActionsLabel: string;
  firstActions: { id: string; text: string; contactRole: string }[];
}
const refs = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((x): x is string => typeof x === "string")
      : [];
const code = (entity: unknown): string => {
  const idt = object(object(entity).idt);
  return idt.status === "coded" ? text(idt.path) : "";
};
const within = (path: string, sector: string) =>
  path === sector || path.startsWith(sector + ".");
/** Hosting, containment and explicit operator links only. Geography cannot establish a utility. */
export function utilityForEntity(id: string, data: Bootstrap): string | null {
  const index = new Map(data.entities.map((e) => [e.id, e]));
  const queue = [id],
    seen = new Set<string>();
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const entity = index.get(next);
    if (!entity) continue;
    if (entity.type === "WaterServiceProvider") return entity.id;
    const operated = data.entities.filter(
      (e) => e.type === "WaterServiceProvider" && e.operatedBy === next,
    );
    if (operated.length === 1) return operated[0].id;
    queue.push(
      ...refs(entity.hostedBy),
      ...refs(entity.partOf),
      ...refs(entity.operatedBy),
    );
    // Some inventories record hosting in the physical-to-cyber direction only.
    queue.push(
      ...data.entities
        .filter((e) => refs(e.hostsCyberAsset).includes(next))
        .map((e) => e.id),
    );
  }
  return null;
}
export function utilityForEvent(event: Event, data: Bootstrap): string | null {
  return utilityForEntity(text(event.seenOn, text(event.entityId)), data);
}
export function peopleServed(
  utilityId: string,
  data: Bootstrap,
): number | null {
  const utility = data.entities.find((e) => e.id === utilityId);
  const areas = new Set(refs(utility?.serves));
  const populations = data.entities.filter(
    (e) =>
      e.type === "PopulationGroup" &&
      refs(e.locatedIn).some((a) => areas.has(a)),
  );
  if (
    !populations.length ||
    populations.some(
      (e) =>
        typeof object(e).count !== "number" ||
        !Number.isFinite(object(e).count) ||
        number(object(e).count) < 0,
    )
  )
    return null;
  return populations.reduce((sum, e) => sum + number(object(e).count), 0);
}
const validWindow = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0) &&
  value[0] <= value[1];
const potentialIds = [
  "potential-unsafe-water-b",
  "potential-unsafe-water-c",
] as const;
export function potentialRequests(data: Bootstrap) {
  return potentialIds.map((scenarioId) => {
    if (!data.scenarios.some((s) => s.id === scenarioId))
      throw new Error(
        `Scenario unavailable: ${scenarioId}. Refresh baseline before estimating.`,
      );
    const config = object(data);
    return {
      scenarioId,
      evaluationHour: number(config.defaultEvaluationHour, 1),
      horizonHours: number(config.defaultHorizonHours, 12),
      overrides: [],
      expectedBaselineRevision: data.baselineRevision,
      clientRequestId: crypto.randomUUID(),
    };
  });
}
/** Value scope survives child remounts without crossing case/reference/model changes. */
export function potentialScope(
  data: Bootstrap,
  selected: CommandIncident | null,
  reference: ReferenceData | null,
) {
  return JSON.stringify([
    selected?.id,
    selected?.version,
    selected?.runSnapshot?.id,
    data.baselineRevision,
    data.modelVersion,
    data.scenarios,
    object(data).defaultEvaluationHour,
    object(data).defaultHorizonHours,
    reference,
  ]);
}
export interface PendingPotential {
  scope: string;
  caseId: string;
  requests: RunRequest[];
  saved: (Run | null)[];
  complete: boolean[];
}
function criticalWindow(run: Run | undefined) {
  if (!run) return null;
  const entities = list(object(run.baselineSnapshot).entities);
  const candidates = run.impacts
    .map((impact) => ({
      impact,
      entity: entities.find((e) => e.id === impact.entityId),
    }))
    .filter((x) => x.entity);
  const healthcare = candidates.filter((x) => within(code(x.entity), "10"));
  const chosen = (healthcare.length ? healthcare : candidates)
    .filter((x) => validWindow(x.impact.windowHours))
    .sort((a, b) => a.impact.windowHours![0] - b.impact.windowHours![0])[0];
  return chosen
    ? {
        windowHours: [...chosen.impact.windowHours!] as [number, number],
        facilityId: chosen.entity!.id,
        facilityLabel: text(chosen.entity!.label, chosen.entity!.id),
        healthcare: within(code(chosen.entity), "10"),
      }
    : null;
}
function actionsFor(
  utility: Entity,
  observations: Set<string>,
  run: Run | undefined,
  data: Bootstrap,
  reference: ReferenceData,
  critical: ReturnType<typeof criticalWindow>,
) {
  const snapshot = run ? object(run.baselineSnapshot) : object(data);
  const entities = list(snapshot.entities),
    dependencies = list(snapshot.dependencies);
  const served = dependencies
    .filter((d) => d.provider === utility.id)
    .map((d) => entities.find((e) => e.id === d.dependent))
    .filter(Boolean);
  const u = utility.label.replace(/^Utility\s+/i, "");
  const template = (value: unknown) =>
    text(value)
      .replaceAll("{u}", u)
      .replaceAll("{facility}", critical?.facilityLabel ?? "");
  return reference.firstActions
    .filter((action) => {
      const when = object(action.when);
      if (!Object.keys(when).length) return false;
      if (
        when.observation &&
        !observations.has(text(when.observation)) &&
        !(
          when.observation === "vendor_vpn_login_off_hours" &&
          observations.has("offsite_vpn_login")
        )
      )
        return false;
      if (
        when.utilityServesSector &&
        !served.some((e) => within(code(e), text(when.utilityServesSector)))
      )
        return false;
      if (
        when.impactFacilitySector &&
        (!critical ||
          !entities.some(
            (e) =>
              e.id === critical.facilityId &&
              within(code(e), text(when.impactFacilitySector)),
          ))
      )
        return false;
      if (when.boilWaterRule) {
        const rule = reference.boilWaterRules.find(
          (r) => r.id === when.boilWaterRule,
        );
        const predicate = object(rule?.when);
        if (
          !rule ||
          !run ||
          run.seed.lossType !== predicate.seedLossType ||
          utility.type !== predicate.providerType ||
          run.seed.persistsThroughHour - run.seed.windowHours[0] <
            number(predicate.minPersistHours)
        )
          return false;
      }
      // Unknown predicates must not accidentally match a future reference rule.
      return Object.keys(when).every((k) =>
        [
          "observation",
          "utilityServesSector",
          "impactFacilitySector",
          "boilWaterRule",
        ].includes(k),
      );
    })
    .map((action) => ({
      id: action.id,
      text: template(action.text),
      contactRole: template(action.contactRole),
    }));
}
/** Evidence classification shared by A5 ranking and the A2 overlay; never inferred from location. */
export function utilityEvidenceStatus(
  utilityId: string,
  data: Bootstrap,
): EvidenceStatus {
  const events = data.events.filter(
    (e) => utilityForEvent(e, data) === utilityId,
  );
  const observations = new Set(events.map((e) => text(e.observation)));
  const effect = data.scenarios.some(
    (s) =>
      s.seed.provider === utilityId &&
      s.seed.eventRefs.length > 0 &&
      s.seed.eventRefs.every((id) =>
        events.some((e) => e.id === id && e.observation !== "probing_only"),
      ),
  );
  const suspected = [
    "controller_authentication",
    "dosing_parameter_change",
    "vendor_vpn_login_off_hours",
    "offsite_vpn_login",
  ].some((o) => observations.has(o));
  return effect
    ? "effect_observed"
    : suspected
      ? "compromise_suspected"
      : observations.has("probing_only")
        ? "probing_only"
        : "none";
}

/** Active cases gate attack labels, not A5 evidence ranking. A probe is never compromise. */
export function utilityMapStatus(
  utilityId: string,
  data: Bootstrap,
  incidents: readonly CommandIncident[] = [],
) {
  const openCaseCount = incidents.filter(
    (incident) =>
      (incident.status === "open" || incident.status === "monitoring") &&
      (incident.contextSnapshot?.provider?.id ??
        utilityForEvent(incident.eventSnapshot, data)) === utilityId,
  ).length;
  const evidenceStatus = utilityEvidenceStatus(utilityId, data);
  const status =
    openCaseCount > 0 &&
    (evidenceStatus === "effect_observed" ||
      evidenceStatus === "compromise_suspected")
      ? "under-attack"
      : evidenceStatus === "probing_only"
        ? "probed"
        : "none";
  return {
    evidenceStatus,
    status,
    label:
      status === "under-attack"
        ? "Under attack"
        : status === "probed"
          ? "Probed"
          : null,
    openCaseCount,
  };
}

/** Read-only advisory ranking. Saved potential runs never become captured case consequences. */
export function rankUtilities(
  data: Bootstrap,
  cases: CommandIncident[],
  runs: (Run | RunSummary)[],
  reference: ReferenceData,
): UtilityPriority[] {
  const evidenceOrder: Record<EvidenceStatus, number> = {
    effect_observed: 0,
    compromise_suspected: 1,
    probing_only: 2,
    none: 3,
  };
  return data.entities
    .filter((e) => e.type === "WaterServiceProvider")
    .map((utility) => {
      const events = data.events.filter(
        (e) => utilityForEvent(e, data) === utility.id,
      );
      const observations = new Set(events.map((e) => text(e.observation)));
      const evidenceStatus = utilityEvidenceStatus(utility.id, data);
      const potentialScenario =
        potentialIds.find(
          (id) =>
            data.scenarios.find((s) => s.id === id)?.seed.provider ===
            utility.id,
        ) ??
        potentialIds.find(
          (id) =>
            id ===
            `potential-unsafe-water-${utility.id.replace(/^utility-/, "")}`,
        );
      const caseRun =
        cases
          .filter((c) => c.runSnapshot?.seed.provider === utility.id)
          .sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)))[0]
          ?.runSnapshot ?? undefined;
      const potentialRun = runs
        .filter(
          (r): r is Run =>
            r.scenarioId === potentialScenario &&
            Array.isArray(object(r).impacts) &&
            object(r).seed !== undefined,
        )
        .filter(
          (r) =>
            r.seed.provider === utility.id &&
            r.seed.lossType === "unsafe_water" &&
            !r.request?.overrides?.length,
        )
        .sort((a, b) => text(b.createdAt).localeCompare(text(a.createdAt)))[0];
      const potential = !!potentialScenario;
      const run = potential ? potentialRun : caseRun;
      const critical = criticalWindow(run);
      return {
        utilityId: utility.id,
        label: utility.label,
        evidenceStatus,
        peopleServed: peopleServed(utility.id, data),
        windowHours: critical?.windowHours ?? null,
        facilityId: critical?.facilityId ?? null,
        facilityLabel: critical?.facilityLabel ?? null,
        potential,
        runId: run?.id ?? null,
        firstActionsLabel: reference.firstActionsLabel,
        firstActions: actionsFor(
          utility,
          observations,
          run,
          data,
          reference,
          critical,
        ),
      };
    })
    .sort(
      (a, b) =>
        evidenceOrder[a.evidenceStatus] - evidenceOrder[b.evidenceStatus] ||
        (a.windowHours?.[0] ?? Infinity) - (b.windowHours?.[0] ?? Infinity) ||
        (b.peopleServed ?? -1) - (a.peopleServed ?? -1) ||
        a.utilityId.localeCompare(b.utilityId),
    );
}

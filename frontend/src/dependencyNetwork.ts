import {
  asRecord,
  strings,
  type ConsequenceModel,
} from "./commandCenterModel.ts";
import type { RunRequest } from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";

/** Snapshot-only, cycle-safe provider closure; expansion never adds model results. */
export function expandUpstream(
  model: ConsequenceModel,
  entityId: string,
): string[] {
  const found = new Set<string>();
  function visit(id: string) {
    if (found.has(id)) return;
    found.add(id);
    for (const dependency of model.captured.dependencies)
      if (dependency.dependent === id) visit(dependency.provider);
  }
  visit(entityId);
  return [...found];
}
export interface NetworkOptions {
  showUnaffected?: boolean;
  ownership?: boolean;
  cyberLinks?: boolean;
  expanded?: string[];
}
export function explorationNetwork(
  model: ConsequenceModel,
  options: NetworkOptions = {},
) {
  const ids = new Set([
    ...(model.run ? [model.run.seed.provider] : []),
    ...model.rows.map((r) => r.entityId),
    ...(options.expanded ?? []),
  ]);
  const excluded = new Map(
    (model.run?.excluded ?? []).map((value) => {
      const record = asRecord(value);
      return [String(record.dependencyId), String(record.reason ?? "Excluded")];
    }),
  );
  if (options.showUnaffected)
    for (const dependency of model.captured.dependencies)
      if (
        dependency.provider === model.run?.seed.provider ||
        excluded.has(dependency.id)
      ) {
        ids.add(dependency.provider);
        ids.add(dependency.dependent);
      }
  const relations: { id: string; from: string; to: string; kind: string }[] =
    [];
  // Reveal captured physical children before their hosted network identities.
  // This is context only; it never creates a modeled path or impact.
  if (options.cyberLinks) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const entity of model.captured.entities)
        if (entity.partOf && ids.has(entity.partOf) && !ids.has(entity.id)) {
          ids.add(entity.id);
          changed = true;
          relations.push({
            id: `part:${entity.id}`,
            from: entity.partOf,
            to: entity.id,
            kind: "physical containment context",
          });
        }
    }
  }
  for (const entity of model.captured.entities) {
    if (options.ownership && ids.has(entity.id))
      for (const owner of strings(entity.operatedBy)) {
        ids.add(owner);
        relations.push({
          id: `owner:${entity.id}:${owner}`,
          from: owner,
          to: entity.id,
          kind: "ownership context",
        });
      }
    if (options.cyberLinks) {
      const raw = asRecord(entity);
      for (const host of strings(raw.hostedBy))
        if (ids.has(host)) {
          ids.add(entity.id);
          relations.push({
            id: `cyber:${entity.id}`,
            from: host,
            to: entity.id,
            kind: "cyber hosting context",
          });
        }
      if (ids.has(entity.id))
        for (const cyber of strings(raw.hostsCyberAsset)) {
          ids.add(cyber);
          relations.push({
            id: `hosts:${cyber}`,
            from: entity.id,
            to: cyber,
            kind: "cyber hosting context",
          });
        }
    }
  }
  return {
    nodes: model.captured.entities.filter((e) => ids.has(e.id)),
    edges: model.captured.dependencies
      .filter((d) => ids.has(d.provider) && ids.has(d.dependent))
      .map((d) => ({ ...d, excludedReason: excluded.get(d.id) })),
    relations,
  };
}
export function quickWhatIfRequest(
  incident: CommandIncident,
  dependencyId: string,
  reserveHours: number,
): RunRequest {
  const run = incident.runSnapshot;
  if (!run) throw new Error("Capture a case run before trying a what-if.");
  if (!Number.isFinite(reserveHours) || reserveHours < 0)
    throw new Error("Reserve must be a non-negative number of hours.");
  const raw = asRecord(run.baselineSnapshot);
  const dependencies = Array.isArray(raw.dependencies) ? raw.dependencies : [];
  const dependency = dependencies
    .map(asRecord)
    .find((d) => d.id === dependencyId);
  if (
    !dependency ||
    !run.impacts.some(
      (i) =>
        i.entityId === dependency.dependent &&
        i.paths.some((path) => path.includes(dependencyId)),
    )
  )
    throw new Error("Choose a captured impacted dependency.");
  return {
    ...run.request,
    overrides: [
      {
        dependencyId,
        backupMinHours: reserveHours,
        backupMaxHours: reserveHours,
        note: `What-if from case ${incident.title}`,
      },
    ],
  };
}
export function excludedSentence(
  value: unknown,
  model: ConsequenceModel,
): string {
  const record = asRecord(value),
    dependency = model.captured.dependencies.find(
      (d) => d.id === record.dependencyId,
    );
  const label =
    model.captured.entities.find((e) => e.id === dependency?.dependent)
      ?.label ?? "Captured dependency";
  if (record.reason === "loss type is not applicable")
    return `${label} is not affected through this dependency by this scenario's loss type; it requires ${dependency?.validForLossTypes.join(" or ").replaceAll("_", " ") || "a different service loss"}. This is not a normal-operations assertion.`;
  return `${label}: ${String(record.reason ?? "Reason not captured").replaceAll("_", " ")}.`;
}

import type { Bootstrap, Dependency } from "./types.ts";
export interface DependencyPrefill {
  entityId: string;
  role: "provider" | "dependent";
}
/** A fresh reviewed proposal; never edits or promotes a live dependency. */
export function newDependencyDraft(
  data: Bootstrap,
  prefill?: DependencyPrefill,
): Dependency {
  if (prefill && !data.entities.some((e) => e.id === prefill.entityId))
    throw new Error("Selected entity is not in this baseline.");
  const template =
    (prefill &&
      data.dependencies.find((d) => d[prefill.role] === prefill.entityId)) ||
    data.dependencies[0];
  if (!template) throw new Error("No dependency template is available.");
  const draft: Dependency = {
    id: `dep-${crypto.randomUUID()}`,
    revision: 1,
    provider: template.provider,
    dependent: template.dependent,
    requiredService: template.requiredService,
    dependentFunction: template.dependentFunction,
    dependencyType: "physical",
    coupling: "tight",
    lossTypes: [...template.lossTypes],
    propagationDelayMinHours: 0,
    propagationDelayMaxHours: 0,
    usableBackupMinHours: null,
    usableBackupMaxHours: null,
    validForLossTypes: [],
    lossOfFunction: 1,
    outputLossType: null,
    sourceRefs: [],
    assumptionNote: "",
    classification: "U",
    handling: ["SIMULATED"],
  };
  if (prefill) draft[prefill.role] = prefill.entityId;
  return draft;
}

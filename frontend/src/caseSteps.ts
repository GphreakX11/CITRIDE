import type { CommandIncident } from "./commandTypes.ts";
export const caseStepLabels = [
  "Review evidence",
  "Assess service impacts",
  "Record reviews",
  "Complete tasks",
  "Close case",
] as const;
export function caseProgress(incident: CommandIncident) {
  const evidence =
    incident.tasks.find((task) => task.label === "Review source evidence") ??
    incident.tasks[0];
  const applicable = incident.contextSnapshot.scenarios.length > 0;
  const impactDone = !applicable || incident.runSnapshot !== null;
  const done = [
    !!evidence?.completed,
    impactDone,
    impactDone &&
      incident.decisions.every((d) => d.reviewed && !!d.reviewNote?.trim()),
    incident.tasks.every((task) => task.completed),
    incident.status === "closed",
  ];
  const current = done.findIndex((value) => !value);
  return {
    done,
    current,
    impactApplicable: applicable,
    label: current < 0 ? "Case complete" : caseStepLabels[current],
    target:
      current === 1
        ? "consequence"
        : current === 2
          ? "decisions"
          : current === 4
            ? "tracking"
            : "tasks",
    remainingTasks: incident.tasks.filter((task) => !task.completed).length,
  };
}

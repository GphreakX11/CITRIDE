import { commandNavigation, analystNavigation } from "./commandTypes.ts";
export type WorkspaceMode = "command" | "analyst";
export const advancedViews = [
  "overview",
  "incident",
  "blueprint",
  "relationships",
  "reasoning",
  "lab",
  "evidence",
  "sources",
] as const;
export function modeForView(
  view: string,
  current: WorkspaceMode,
): WorkspaceMode {
  if (
    advancedViews.some((v) => v === view) ||
    ["case-file", "entity-profile", "coordination"].includes(view)
  )
    return "analyst";
  if (
    commandNavigation.some((item) => item.id === view) &&
    !analystNavigation.some((item) => item.id === view)
  )
    return "command";
  return current;
}
/** A case and an incident are views of the same durable record, not copies. */
export function modeLanding(
  mode: WorkspaceMode,
  view: string,
  hasCase: boolean,
): string {
  const list = mode === "command" ? commandNavigation : analystNavigation;
  if (list.some((item) => item.id === view)) return view;
  if (mode === "analyst" && hasCase) return "case-file";
  return "command";
}

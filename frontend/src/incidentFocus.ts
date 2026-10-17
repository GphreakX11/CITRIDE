import { identifier } from "./prototypeLocation.ts";
/** Statewide record focus is independent of the saved-case selection. */
export function readIncidentFocus(input: string): string | null {
  return identifier(new URL(input, "https://prototype.invalid").searchParams.get("incident"));
}
export function incidentFocusLocation(input: string, id: string | null): string {
  const url = new URL(input, "https://prototype.invalid"), safe = identifier(id);
  if (safe) url.searchParams.set("incident", safe); else url.searchParams.delete("incident");
  return `${url.pathname}${url.search}${url.hash}`;
}

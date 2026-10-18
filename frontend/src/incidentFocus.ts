import { identifier } from "./prototypeLocation.ts";
/** Statewide record focus is independent of the saved-case selection. */
export function readIncidentFocus(input: string): string | null {
  const query = new URL(input, "https://prototype.invalid").searchParams;
  return identifier(query.get("incidentId")) ?? identifier(query.get("incident"));
}
export function incidentFocusLocation(input: string, id: string | null): string {
  const url = new URL(input, "https://prototype.invalid"), safe = identifier(id);
  for (const key of ["incident", "incidentId"]) {
    if (safe) url.searchParams.set(key, safe); else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

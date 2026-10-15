import type { CommandIncident } from "./commandTypes.ts";
export interface WorkFilters {
  query: string;
  status: string;
  priority: string;
}
export function filterWork(
  records: readonly CommandIncident[],
  filters: WorkFilters,
): CommandIncident[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return records.filter(
    (r) =>
      (filters.status === "all" ||
        (filters.status === "active"
          ? r.status !== "closed"
          : r.status === filters.status)) &&
      (filters.priority === "all" || r.priority === filters.priority) &&
      (!query ||
        [
          r.id,
          r.title,
          r.eventId,
          r.contextSnapshot.provider?.label,
          r.contextSnapshot.event?.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)),
  );
}

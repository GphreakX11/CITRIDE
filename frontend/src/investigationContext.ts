import type { Bootstrap, Event } from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";

/** Only captured assets and explicit service/decision endpoints establish a case link. */
export function caseEntityIds(incident: CommandIncident): Set<string> {
  const context = incident.contextSnapshot;
  return new Set(
    [
      context.provider?.id,
      context.facility?.id,
      context.physicalAsset?.id,
      context.cyberAsset?.id,
      ...context.downstreamDependencies.flatMap(({ dependency, dependent }) => [
        dependency.provider,
        dependency.dependent,
        dependent.id,
      ]),
      ...incident.decisions.map((decision) => decision.entityId),
    ].filter((id): id is string => typeof id === "string" && id.length > 0),
  );
}
export function linkedCases(
  records: CommandIncident[],
  entityId: string | null,
): CommandIncident[] {
  if (!entityId) return [];
  return records
    .filter((record) => caseEntityIds(record).has(entityId))
    .sort(
      (a, b) =>
        Number(a.status === "closed") - Number(b.status === "closed") ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
}
export function linkedCaseId(
  records: CommandIncident[],
  entityId: string | null,
  currentId: string | null,
): string | null {
  const linked = linkedCases(records, entityId);
  return (
    linked.find((record) => record.id === currentId)?.id ??
    linked[0]?.id ??
    null
  );
}
/** Default only once: explicit cleared/new-case intent survives subsequent reads. */
export function caseSelectionAfterRead(
  records: CommandIncident[],
  entityId: string | null,
  currentId: string | null,
  chooseInitialDefault: boolean,
): string | null {
  if (entityId) return linkedCaseId(records, entityId, currentId);
  if (currentId && records.some((record) => record.id === currentId))
    return currentId;
  if (!chooseInitialDefault) return null;
  return (
    (records.find((record) => record.status !== "closed") ?? records[0])?.id ??
    null
  );
}
export function caseFocusEntity(
  record: CommandIncident,
  currentEntity: string | null,
): string | null {
  if (currentEntity && caseEntityIds(record).has(currentEntity))
    return currentEntity;
  const context = record.contextSnapshot;
  return (
    context.provider?.id ??
    context.facility?.id ??
    context.physicalAsset?.id ??
    context.cyberAsset?.id ??
    null
  );
}
export function evidenceForContext(
  data: Bootstrap,
  record: CommandIncident | null,
  entityId: string | null,
): Event[] {
  if (record) return [record.eventSnapshot];
  if (!entityId) return [];
  return data.events.filter((event) => {
    const refs = [
      event.seenOn,
      event.assetId,
      event.entityId,
      event.utilityId,
    ].flatMap((value) =>
      typeof value === "string"
        ? [value]
        : Array.isArray(value)
          ? value.filter((id): id is string => typeof id === "string")
          : [],
    );
    return refs.includes(entityId);
  });
}

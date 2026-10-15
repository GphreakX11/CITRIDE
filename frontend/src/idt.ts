// Pure IDT reference helpers. Workbook ancestry is lookup, never OWL inference.
// No Entity type change, storage mutation, browser cache, or global singleton.
export const IDT_VERSION = "IDT v4 (22 Jun 2011)";
export const IDT_SOURCE_SHA256 =
  "ffeddc10b98cca1cd15abd53d70ba8a2bafd593760c8704e76834860fcf193a2";

export type IdtEntry = Readonly<{
  path: string;
  idtId: string | null;
  name: string | null;
  level: number;
  description: string | null;
  crossReference: string | null;
  naics: string | null;
  parent: string | null;
}>;
export type IdtAssignment =
  | Readonly<{ status: "coded"; path: string }>
  | Readonly<{
      status: "below_idt_level";
      parentEntity: string;
      parentPath: string;
    }>
  | Readonly<{
      status: "not_idt_asset";
      reason: "cyber_identity" | "service_area" | "population_group";
    }>
  | Readonly<{ status: "unassigned" }>;
export type IdtEntity = { id?: unknown; idt?: unknown };
export type IdtLookupOptions = {
  // Opt in ONLY for current inventory. Captured run/case history must leave false.
  allowSeedLookup?: boolean;
};
export type IdtIndex = Readonly<{
  version: string;
  sourceSha256: string;
  jsonSha256: string | null;
  ttlSha256: string;
  entryCount: number;
  sectorCount: number;
  semanticStatus: "reference_only";
  runtimeOntologyLoaded: false;
  entries: Readonly<Record<string, IdtEntry>>;
  assignments: Readonly<Record<string, IdtAssignment>>;
}>;

const codePattern = /^[1-9][0-9]*(?:\.[1-9][0-9]*)*$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function textOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validAssignment(
  value: unknown,
  entries: Readonly<Record<string, IdtEntry>>,
): IdtAssignment | null {
  const item = record(value);
  if (!item) return null;
  if (
    item.status === "coded" &&
    typeof item.path === "string" &&
    entries[item.path]
  )
    return Object.freeze({ status: "coded", path: item.path });
  if (
    item.status === "below_idt_level" &&
    typeof item.parentPath === "string" &&
    entries[item.parentPath] &&
    typeof item.parentEntity === "string" &&
    idPattern.test(item.parentEntity)
  )
    return Object.freeze({
      status: "below_idt_level",
      parentEntity: item.parentEntity,
      parentPath: item.parentPath,
    });
  if (
    item.status === "not_idt_asset" &&
    (item.reason === "cyber_identity" ||
      item.reason === "service_area" ||
      item.reason === "population_group")
  )
    return Object.freeze({ status: "not_idt_asset", reason: item.reason });
  if (item.status === "unassigned")
    return Object.freeze({ status: "unassigned" });
  return null;
}

export function createIdtIndex(value: unknown): IdtIndex {
  const data = record(value);
  if (
    !data ||
    data.version !== IDT_VERSION ||
    data.sourceSha256 !== IDT_SOURCE_SHA256 ||
    data.semanticStatus !== "reference_only" ||
    data.runtimeOntologyLoaded !== false ||
    data.entryCount !== 1985 ||
    data.sectorCount !== 18 ||
    typeof data.ttlSha256 !== "string" ||
    !hashPattern.test(data.ttlSha256) ||
    !Array.isArray(data.entries) ||
    data.entries.length !== 1985
  )
    throw new Error("Invalid IDT v4 reference metadata");
  const entries: Record<string, IdtEntry> = Object.create(null);
  for (const raw of data.entries) {
    const item = record(raw);
    if (
      !item ||
      typeof item.path !== "string" ||
      !codePattern.test(item.path) ||
      item.path.split(".").length > 5 ||
      entries[item.path] ||
      item.level !== item.path.split(".").length ||
      !textOrNull(item.name) ||
      !textOrNull(item.idtId) ||
      !textOrNull(item.description) ||
      !textOrNull(item.crossReference) ||
      !textOrNull(item.naics) ||
      !textOrNull(item.parent)
    )
      throw new Error("Invalid IDT v4 reference entry");
    const parent = item.path.includes(".")
      ? item.path.slice(0, item.path.lastIndexOf("."))
      : null;
    if (item.parent !== parent)
      throw new Error("Invalid IDT v4 reference ancestry");
    entries[item.path] = Object.freeze({
      path: item.path,
      idtId: item.idtId,
      name: item.name,
      level: item.level as number,
      description: item.description,
      crossReference: item.crossReference,
      naics: item.naics,
      parent,
    });
  }
  if (
    Object.values(entries).filter((item) => item.parent === null).length !==
      18 ||
    Object.values(entries).some(
      (item) => item.parent !== null && !entries[item.parent],
    )
  )
    throw new Error("Incomplete IDT v4 reference ancestry");
  const rawAssignments = record(data.assignments);
  if (!rawAssignments || Object.keys(rawAssignments).length !== 67)
    throw new Error("Invalid IDT v4 assignment reference");
  const assignments: Record<string, IdtAssignment> = Object.create(null);
  for (const [id, raw] of Object.entries(rawAssignments)) {
    const assignment = validAssignment(raw, entries);
    if (!idPattern.test(id) || !assignment)
      throw new Error("Invalid IDT v4 assignment");
    assignments[id] = assignment;
  }
  const jsonSha256 =
    typeof data.jsonSha256 === "string" && hashPattern.test(data.jsonSha256)
      ? data.jsonSha256
      : null;
  return Object.freeze({
    version: IDT_VERSION,
    sourceSha256: IDT_SOURCE_SHA256,
    jsonSha256,
    ttlSha256: data.ttlSha256,
    entryCount: 1985,
    sectorCount: 18,
    semanticStatus: "reference_only",
    runtimeOntologyLoaded: false,
    entries: Object.freeze(entries),
    assignments: Object.freeze(assignments),
  });
}

export function idtEntry(
  path: string,
  index: IdtIndex | null,
): IdtEntry | null {
  return index?.entries[path] ?? null;
}
export function entryName(entry: IdtEntry): string {
  return entry.name?.trim() ? entry.name : `Unnamed IDT v4 entry ${entry.path}`;
}
export function lineage(path: string, index: IdtIndex | null): IdtEntry[] {
  const result: IdtEntry[] = [];
  let current = idtEntry(path, index);
  // The index validates strict path truncation, so no cycles are possible.
  while (current) {
    result.push(current);
    current = current.parent ? idtEntry(current.parent, index) : null;
  }
  return result;
}
export function assignmentForId(
  id: string,
  index: IdtIndex | null,
): IdtAssignment | null {
  return index?.assignments[id] ?? null;
}
export function assignmentFor(
  entity: IdtEntity,
  index: IdtIndex | null,
  options: IdtLookupOptions = {},
): IdtAssignment | null {
  if (!index || !record(entity)) return null;
  // Never let fallback hide malformed, explicitly unknown or historic IDT fields.
  if (Object.prototype.hasOwnProperty.call(entity, "idt"))
    return validAssignment(entity.idt, index.entries);
  return options.allowSeedLookup && typeof entity.id === "string"
    ? assignmentForId(entity.id, index)
    : null;
}
export function assignmentPath(
  assignment: IdtAssignment | null,
): string | null {
  if (assignment?.status === "coded") return assignment.path;
  if (assignment?.status === "below_idt_level") return assignment.parentPath;
  return null;
}
export function sectorOf(
  entity: IdtEntity,
  index: IdtIndex | null,
  options: IdtLookupOptions = {},
): IdtEntry | null {
  const path = assignmentPath(assignmentFor(entity, index, options));
  return path ? idtEntry(path.split(".")[0], index) : null;
}
export function idtChip(
  entity: IdtEntity,
  index: IdtIndex | null,
  options: IdtLookupOptions = {},
): string {
  const assignment = assignmentFor(entity, index, options);
  const path = assignmentPath(assignment);
  const entry = path ? idtEntry(path, index) : null;
  if (assignment?.status === "coded" && entry)
    return `IDT ${entry.path} · ${entryName(entry)}`;
  if (assignment?.status === "below_idt_level" && entry)
    return `Part of IDT ${entry.path} · ${entryName(entry)}`;
  if (assignment?.status === "not_idt_asset")
    return `Not an IDT asset · ${assignment.reason.replaceAll("_", " ")}`;
  return "IDT code not assigned";
}

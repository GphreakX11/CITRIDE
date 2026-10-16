import {
  assignmentFor,
  assignmentPath,
  entryName,
  idtChip,
  idtEntry,
  lineage,
  type IdtEntity,
  type IdtIndex,
} from "./idt";

export type IdtChipProps = {
  entity: IdtEntity;
  index: IdtIndex | null;
  // Current inventory only; default false preserves captured history faithfully.
  allowSeedLookup?: boolean;
};

/** Native details gives hover text AND keyboard/tap disclosure without a portal. */
export function IdtChip({
  entity,
  index,
  allowSeedLookup = false,
}: IdtChipProps) {
  const options = { allowSeedLookup };
  const assignment = assignmentFor(entity, index, options);
  const path = assignmentPath(assignment);
  const entry = path ? idtEntry(path, index) : null;
  const label = index
    ? idtChip(entity, index, options)
    : "IDT reference not loaded";
  const ancestry = path ? lineage(path, index) : [];
  const description = entry?.description?.trim()
    ? entry.description
    : "No IDT v4 description.";
  const source =
    allowSeedLookup && !Object.prototype.hasOwnProperty.call(entity, "idt")
      ? "Stakeholder design assignment lookup; not persisted on this entity."
      : "Captured entity assignment; reference names from IDT v4.";
  const title = [
    label,
    ...(entry
      ? [
          description,
          ancestry.map((item) => `${item.path} ${entryName(item)}`).join(" → "),
        ]
      : []),
    index?.version ?? "IDT reference not loaded",
    "Workbook reference lookup, not runtime OWL inference.",
  ].join("\n");
  if (!entry)
    return (
      <span className="idt-chip chip-mono" title={title}>
        {label}
      </span>
    );
  return (
    <details
      className="idt-chip chip-mono"
      style={{ display: "inline-block", maxWidth: "100%" }}
    >
      <summary
        title={title}
        style={{
          cursor: "pointer",
          border: "1px solid currentColor",
          borderRadius: "0.35rem",
          padding: "0.15rem 0.4rem",
          fontSize: "var(--fs-chip)",
        }}
      >
        {label}
      </summary>
      <div
        className="idt-chip-details"
        style={{
          padding: "0.5rem",
          maxWidth: "30rem",
          overflowWrap: "anywhere",
        }}
      >
        <strong>{index?.version}</strong>
        <p>{description}</p>
        <p>
          Workbook ancestry:{" "}
          {ancestry
            .map((item) => `${item.path} · ${entryName(item)}`)
            .join(" → ")}
        </p>
        {assignment?.status === "below_idt_level" && (
          <p>
            Below IDT level. Associated parent: {assignment.parentEntity}. This
            is not a taxonomy type assertion or physical-containment proof.
          </p>
        )}
        <p>{source}</p>
        <p>
          Reference lookup only; this chip is not an OWL classification proof,
          nor evidence that IDT is loaded or not loaded in runtime OWL
          reasoning. Inspect a current inference run for the actual facts and
          source trail.
        </p>
        <small>Workbook SHA-256: {index?.sourceSha256}</small>
      </div>
    </details>
  );
}

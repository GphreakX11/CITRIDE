import { StatusChip } from "./visualPrimitives.ts";
import type { AnalystIncidentContextValue } from "./analystIncidentContext.ts";
import { formatTime } from "./displayTime.ts";
import { useEffect, useId, useState } from "react";
import type {
  Bootstrap,
  Dependency,
  InferenceRunSummary,
  OntologyMetadata,
} from "./types";
import type { CommandIncident } from "./commandTypes";
import type { MapEdge } from "./texasGraph";
import type { DependencyPrefill } from "./dependencyDraft";
import { api, humanize, windowLabel } from "./api";
import { displayText } from "./presentation";
import { reviewDisplayText } from "./incidentDecisions";
import { createIdtIndex, type IdtIndex } from "./idt";
import { IdtChip } from "./IdtChip";
import { currentInferenceRun, idtConclusion, idtSectorIri } from "./idtProof";
import {
  analystEntityModel,
  recordFields,
  recordRefs,
} from "./analystEntityModel";
import "./command-casework.css";
import "./analyst-detail.css";

export interface AnalystEntityProfileProps {
  /** Host supplies public selection context; standalone/case embeddings remain unchanged. */
  incidentContext?: AnalystIncidentContextValue | null;
  data: Bootstrap;
  entityId: string | null;
  incidents: CommandIncident[];
  locked: boolean;
  onSelectEntity: (id: string) => void;
  onOpenCase: (id: string) => void;
  onOpenTool: (
    tool: "relationships" | "reasoning" | "evidence" | "lab" | "sources",
    entityId?: string,
  ) => void;
  onEditDependency: (
    dependency: Dependency | null,
    prefill?: DependencyPrefill,
  ) => void;
  onBack: () => void;
}

export default function AnalystEntityProfile({
  incidentContext,
  data: suppliedData,
  entityId,
  incidents,
  locked,
  onSelectEntity,
  onOpenCase,
  onOpenTool,
  onEditDependency,
  onBack,
}: AnalystEntityProfileProps) {
  // With no saved case the host may still hold a previous case snapshot. Never
  // use that snapshot as inventory; preserve the existing case path unchanged.
  const noCaseContext = incidentContext && !incidentContext.activeCase ? incidentContext : null;
  const data = noCaseContext?.mainStore ?? suppliedData;
  const prefix = useId();
  const sectionId = (name: string) => `${prefix}-entity-${name}`;
  const model = analystEntityModel(data, incidents, entityId);
  const { entity } = model;
  const [idtIndex, setIdtIndex] = useState<IdtIndex | null>(null);
  const [idtError, setIdtError] = useState("");
  const sectorIri = entity ? idtSectorIri(entity) : null;
  const [proofStatus, setProofStatus] = useState<{
    entityId: string;
    baselineRevision: number;
    sectorIri: string;
    ready: boolean;
    error?: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    setProofStatus(null);
    if (!entity || !sectorIri) return;
    const identity = {
      entityId: entity.id,
      baselineRevision: data.baselineRevision,
      sectorIri,
    };
    Promise.all([
      api<OntologyMetadata>("/v1/ontology"),
      api<{ runs: InferenceRunSummary[] }>("/v1/inference-runs"),
    ])
      .then(async ([metadata, history]) => {
        const current = await currentInferenceRun(
          api,
          data.baselineRevision,
          metadata,
          history.runs,
        );
        if (active)
          setProofStatus({
            ...identity,
            ready: Boolean(current && idtConclusion(entity, current)),
          });
      })
      .catch(() => {
        if (active)
          setProofStatus({
            ...identity,
            ready: false,
            error:
              "Current inference status unavailable. Open reasoning to refresh or explicitly run inference.",
          });
      });
    return () => {
      active = false;
    };
  }, [entity?.id, data.baselineRevision, sectorIri]);
  const currentProofStatus =
    proofStatus?.entityId === entity?.id &&
    proofStatus?.baselineRevision === data.baselineRevision &&
    proofStatus?.sectorIri === sectorIri
      ? proofStatus
      : null;
  useEffect(() => {
    let active = true;
    api<unknown>("/v1/reference/idt")
      .then((value) => {
        if (active) setIdtIndex(createIdtIndex(value));
      })
      .catch(() => {
        if (active)
          setIdtError(
            "IDT reference unavailable. Recorded classification is preserved under Advanced.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const entityLink = (id: string) => (
    <button
      type="button"
      className="analyst-record-link"
      disabled={locked}
      onClick={() => onSelectEntity(id)}
    >
      {displayText(data.entities.find((item) => item.id === id)?.label ?? id)}
    </button>
  );
  const dependencyRows = (edges: MapEdge[], upstream: boolean) =>
    edges.length ? (
      edges.map((edge) => {
        const dependency = edge.dependency!;
        const serviceFunction = data.serviceFunctions.find(
          (item) => item.id === dependency.dependentFunction,
        );
        return (
          <article className="analyst-relationship-row" key={edge.id}>
            <div>
              {entityLink(upstream ? edge.source : edge.target)} ·{" "}
              {displayText(humanize(dependency.requiredService))}
            </div>
            <p>
              {displayText(
                serviceFunction?.label ?? dependency.dependentFunction,
              )}{" "}
              · scoped to{" "}
              {dependency.lossTypes.map(humanize).join(", ") ||
                "loss types not recorded"}
            </p>
            <p className="cc-muted">
              Propagation delay{" "}
              {windowLabel([
                dependency.propagationDelayMinHours,
                dependency.propagationDelayMaxHours,
              ])}{" "}
              · usable backup{" "}
              {dependency.usableBackupMinHours === null ||
              dependency.usableBackupMaxHours === null
                ? "unknown"
                : windowLabel([
                    dependency.usableBackupMinHours,
                    dependency.usableBackupMaxHours,
                  ])}{" "}
              · backup valid for{" "}
              {dependency.validForLossTypes.map(humanize).join(", ") ||
                "no recorded loss types"}
            </p>
            <details>
              <summary>Dependency assumptions and provenance</summary>
              <p>
                {reviewDisplayText(
                  dependency.assumptionNote || "No assumption note recorded.",
                )}
              </p>
              <pre className="analyst-raw-record">
                {JSON.stringify(dependency, null, 2)}
              </pre>
            </details>
            <button
              type="button"
              disabled={locked}
              onClick={() => onEditDependency(dependency)}
            >
              Edit dependency
            </button>
          </article>
        );
      })
    ) : (
      <p className="cc-muted">
        No direct dependencies recorded. Coverage is unknown, not proof of
        independence.
      </p>
    );

  if (!entity)
    return (
      <section
        className="command-casework analyst-entity-profile"
        aria-label="Entity Profile"
      >
        <div className="cc-panel">
          <button type="button" disabled={locked} onClick={onBack}>
            ← Back to previous view
          </button>
          <h2>Entity Profile</h2>
          <p>
            {entityId
              ? "No current inventory record."
              : "Select an entity from the investigation map or a case context chain."}
          </p>
        </div>
      </section>
    );
  const raw = recordFields(entity);
  const status = typeof raw.status === "string" ? raw.status : null;
  return (
    <section
      className="command-casework analyst-entity-profile"
      aria-label="Entity Profile"
    >
      <nav aria-label="Breadcrumb" className="analyst-breadcrumb">
        <button type="button" disabled={locked} onClick={onBack}>
          ← Back to previous view
        </button>
        <span aria-hidden="true">›</span>
        <span>{displayText(entity.label)}</span>
      </nav>
      <header className="cc-panel cc-header">
        <div>
          <p className="cc-muted">
            ENTITY PROFILE · {displayText(humanize(entity.type))}
          </p>
          <h2>{displayText(entity.label)}</h2>
          <div className="cc-chips">
            <IdtChip entity={entity} index={idtIndex} />
            <span className="cc-chip">
              People served:{" "}
              {model.peopleServed === null
                ? "unknown"
                : model.peopleServed.toLocaleString("en-US")}
            </span>
            <StatusChip status={status} className="cc-chip">
              Recorded status: {status ? displayText(status) : "unknown"}
            </StatusChip>
            <span className="cc-chip">
              {model.cases.filter((item) => item.status !== "closed").length}{" "}
              active linked cases
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled={locked}
          onClick={() => onOpenTool("relationships", entity.id)}
        >
          Explore relationship model
        </button>
      </header>
      <p className="analyst-profile-summary">
        {displayText(entity.label)} has{" "}
        {new Set(model.suppliers.map((edge) => edge.source)).size} recorded
        direct suppliers and supplies{" "}
        {new Set(model.supplies.map((edge) => edge.target)).size} entities.
      </p>
      <nav className="analyst-section-nav" aria-label="Entity profile sections">
        {[
          ["relationships", "Relationships"],
          ["cases", `Cases ${model.cases.length}`],
          ["events", `Events ${model.events.length}`],
          ["runs", "Impacts across runs"],
          ["classification", "Classification"],
          ["sources", "Sources"],
          ["advanced", "Advanced"],
        ].map(([id, label]) => (
          <a key={id} href={`#${sectionId(id)}`}>
            {label}
          </a>
        ))}
      </nav>
      <section
        className="cc-panel analyst-detail-section"
        id={sectionId("relationships")}
      >
        <h2>Relationships</h2>
        <div className="analyst-detail-columns">
          <div>
            <h3>Depends on</h3>
            {dependencyRows(model.suppliers, true)}
          </div>
          <div>
            <h3>Supplies</h3>
            {dependencyRows(model.supplies, false)}
          </div>
        </div>
        <details open>
          <summary>
            Ownership, hosting and location ({model.context.length} explicit
            links)
          </summary>
          <p className="cc-muted">
            Structural and spatial context is separate from service supply.
          </p>
          {model.context.map((edge) => (
            <p key={edge.id}>
              {edge.source === entity.id ? (
                <>
                  {humanize(edge.relation)} → {entityLink(edge.target)}
                </>
              ) : (
                <>
                  {entityLink(edge.source)} → {humanize(edge.relation)} →{" "}
                  {displayText(entity.label)}
                </>
              )}
            </p>
          ))}
          {!model.context.length && (
            <p>No ownership, hosting or location links recorded.</p>
          )}
        </details>
        <div className="cc-actions">
          <button
            type="button"
            disabled={locked}
            onClick={() =>
              onEditDependency(null, { entityId: entity.id, role: "dependent" })
            }
          >
            Propose a new dependency
          </button>
        </div>
        <p className="cc-muted">
          Opens the existing editor: stage → validate → promote. Earlier runs
          keep their captured evidence.
        </p>
      </section>
      <div className="analyst-detail-columns">
        <section
          className="cc-panel analyst-detail-section"
          id={sectionId("cases")}
        >
          <h2>Linked cases</h2>
          {model.cases.map((incident) => (
            <article className="analyst-relationship-row" key={incident.id}>
              <button
                type="button"
                className="analyst-record-link"
                disabled={locked}
                onClick={() => onOpenCase(incident.id)}
              >
                {incident.title}
              </button>
              <p>
                {incident.status} · {incident.priority} ·{" "}
                {incident.decisions.filter((item) => item.reviewed).length}/
                {incident.decisions.length} reviews recorded
              </p>
            </article>
          ))}
          {!model.cases.length && <p>No captured case linkage.</p>}
          <p className="cc-muted">
            Only captured assets and explicit service/decision endpoints link
            cases. Shared location or operator never links a case.
          </p>
        </section>
        <section
          className="cc-panel analyst-detail-section"
          id={sectionId("events")}
        >
          <h2>Recorded events</h2>
          <button
            type="button"
            disabled={locked}
            onClick={() => onOpenTool("evidence", entity.id)}
          >
            Open cyber evidence
          </button>
          <p className="cc-muted">
            Observations linked by recorded hosting and containment.
          </p>
          {model.events.map((event) => (
            <article className="analyst-relationship-row" key={event.id}>
              <h3>{displayText(event.label ?? event.title ?? event.id)}</h3>
              <p>
                {noCaseContext
                  ? formatTime(noCaseContext.eventTimestamp(event), undefined, "Time not recorded")
                  : event.timestamp ?? event.eventTime ?? "Time not recorded"} ·{" "}
                {typeof event.origin === "string"
                  ? event.origin
                  : typeof event.evidenceCategory === "string"
                    ? event.evidenceCategory
                    : "Origin unknown"}
              </p>
              <p>
                {displayText(
                  event.description ?? "No event description recorded.",
                )}
              </p>
              <details>
                <summary>Raw event record</summary>
                <pre className="analyst-raw-record">
                  {JSON.stringify(event, null, 2)}
                </pre>
              </details>
            </article>
          ))}
          {!model.events.length && <p>No explicitly linked events recorded.</p>}
        </section>
      </div>
      <section
        className="cc-panel analyst-detail-section"
        id={sectionId("runs")}
      >
        <h2>Impacts across saved case runs</h2>
        <p className="cc-muted">Modeled · not observed outages</p>
        <button
          type="button"
          disabled={locked}
          onClick={() => onOpenTool("lab", entity.id)}
        >
          Open full scenario lab
        </button>
        {model.runs.map(({ run, impacts }) => (
          <article className="analyst-relationship-row" key={run.id}>
            <h3>
              {run.id} · {run.scenarioId}
            </h3>
            <p>
              Captured {run.createdAt ?? "time unknown"} · baseline{" "}
              {run.baselineRevision} · {run.modelVersion}
            </p>
            <ul>
              {impacts.map((impact) => (
                <li key={impact.id}>
                  {impact.entityId} / {impact.functionId} · modeled{" "}
                  {impact.state} · {windowLabel(impact.windowHours)},
                  scenario-relative
                </li>
              ))}
            </ul>
            <details>
              <summary>Captured impacts, paths and assumptions</summary>
              <pre className="analyst-raw-record">
                {JSON.stringify(impacts, null, 2)}
              </pre>
            </details>
          </article>
        ))}
        {!model.runs.length && (
          <p>No matching impacts in available case snapshots.</p>
        )}
      </section>
      <section
        className="cc-panel analyst-detail-section"
        id={sectionId("classification")}
      >
        <h2>Classification</h2>
        <IdtChip entity={entity} index={idtIndex} />
        {idtError && (
          <p className="cc-warning" role="status">
            {idtError}
          </p>
        )}
        <p>
          Entity type: {displayText(entity.type)} · Handling classification:{" "}
          {typeof raw.classification === "string"
            ? raw.classification
            : "unknown"}{" "}
          · {recordRefs(raw.handling).join(", ") || "Handling not recorded"}
        </p>
        <p className="cc-muted">
          IDT names and ancestry are workbook reference lookups, not runtime OWL
          proof.{" "}
          {sectorIri
            ? "Inspect the current inference run for the actual classification facts and lineage."
            : "No coded IDT type assignment is recorded for this entity; no IDT type proof is implied."}
        </p>
        {currentProofStatus?.error && (
          <p className="cc-warning" role="status">
            {currentProofStatus.error}
          </p>
        )}
        <button
          type="button"
          disabled={locked}
          onClick={() => onOpenTool("reasoning", entity.id)}
        >
          {!sectorIri
            ? "Open ontology reasoning"
            : currentProofStatus?.ready
              ? "Why is it classified this way? See the proof →"
              : "Run reasoning to see the proof"}
        </button>
      </section>
      <section
        className="cc-panel analyst-detail-section"
        id={sectionId("sources")}
      >
        <h2>Sources and assumptions</h2>
        <div className="cc-chips">
          {model.sources.map(({ id, record }) => (
            <details className="analyst-source-record" key={id}>
              <summary>
                {displayText(record?.label ?? record?.title ?? id)}
                {!record && " · unresolved"}
              </summary>
              {record ? (
                <>
                  <p>
                    {reviewDisplayText(
                      record.description ?? "No source description recorded.",
                    )}
                  </p>
                  <pre className="analyst-raw-record">
                    {JSON.stringify(record, null, 2)}
                  </pre>
                </>
              ) : (
                <p>Source record not available in the current inventory.</p>
              )}
            </details>
          ))}
        </div>
        {!model.sources.length && <p>No source references recorded.</p>}
        {model.assumptions.map((assumption, index) => (
          <details
            key={typeof assumption.id === "string" ? assumption.id : index}
          >
            <summary>
              {typeof assumption.id === "string"
                ? assumption.id
                : "Recorded assumption"}
            </summary>
            <pre className="analyst-raw-record">
              {JSON.stringify(assumption, null, 2)}
            </pre>
          </details>
        ))}
        {!model.assumptions.length && (
          <p>No separately catalogued entity/dependency assumptions.</p>
        )}
        <button
          type="button"
          disabled={locked}
          onClick={() => onOpenTool("sources", entity.id)}
        >
          Open sources and assumptions
        </button>
      </section>
      <section
        className="cc-panel analyst-detail-section"
        id={sectionId("advanced")}
      >
        <h2>Advanced</h2>
        <p>
          Entity ID: <code>{entity.id}</code> · current baseline{" "}
          {data.baselineRevision}
        </p>
        <details>
          <summary>Raw entity record (JSON)</summary>
          <pre className="analyst-raw-record">
            {JSON.stringify(entity, null, 2)}
          </pre>
        </details>
      </section>
    </section>
  );
}

import { useEffect, useId, useState } from "react";
import type { Bootstrap, Dependency } from "./types";
import type { CommandIncident } from "./commandTypes";
import type { MapEdge } from "./texasGraph";
import { api, humanize, windowLabel } from "./api";
import { displayText } from "./presentation";
import { reviewDisplayText } from "./incidentDecisions";
import { createIdtIndex, type IdtIndex } from "./idt";
import { IdtChip } from "./IdtChip";
import {
  analystEntityModel,
  recordFields,
  recordRefs,
} from "./analystEntityModel";
import "./command-casework.css";
import "./analyst-detail.css";

export interface AnalystEntityProfileProps {
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
  onEditDependency: (dependency: Dependency | null) => void;
  onBack: () => void;
}

export default function AnalystEntityProfile({
  data,
  entityId,
  incidents,
  locked,
  onSelectEntity,
  onOpenCase,
  onOpenTool,
  onEditDependency,
  onBack,
}: AnalystEntityProfileProps) {
  const prefix = useId();
  const sectionId = (name: string) => `${prefix}-entity-${name}`;
  const model = analystEntityModel(data, incidents, entityId);
  const { entity } = model;
  const [idtIndex, setIdtIndex] = useState<IdtIndex | null>(null);
  const [idtError, setIdtError] = useState("");
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
              ? "This entity is not in the current inventory. Captured case records remain unchanged."
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
            <IdtChip entity={entity} index={idtIndex} allowSeedLookup />
            <span className="cc-chip">
              People served:{" "}
              {model.peopleServed === null
                ? "unknown"
                : model.peopleServed.toLocaleString("en-US")}
            </span>
            <span className="cc-chip">
              Recorded status: {status ? displayText(status) : "unknown"}
            </span>
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
        These are conditional service dependencies, not current outages. Walk
        the links below to follow the chain.
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
            onClick={() => onEditDependency(null)}
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
            Direct observations and explicit hosting/containment ancestors only;
            not proof of compromise.
          </p>
          {model.events.map((event) => (
            <article className="analyst-relationship-row" key={event.id}>
              <h3>{displayText(event.label ?? event.title ?? event.id)}</h3>
              <p>
                {event.timestamp ?? event.eventTime ?? "Time not recorded"} ·{" "}
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
        <p className="cc-muted">
          Case-attached snapshots only; this view does not load the scenario
          lab's full run history. Impacts remain modeled, not observed.
        </p>
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
        <IdtChip entity={entity} index={idtIndex} allowSeedLookup />
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
          proof. No IDT classification proof is supplied to this profile.
        </p>
        <button
          type="button"
          disabled={locked}
          onClick={() => onOpenTool("reasoning", entity.id)}
        >
          Inspect ontology reasoning
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

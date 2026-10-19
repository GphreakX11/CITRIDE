import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { createIdtIndex, type IdtIndex } from "./idt";
import { IdtChip } from "./IdtChip";
import NetworkEvidence from "./NetworkEvidence";
import AnalystAlerts from "./AnalystAlerts";
import AnalystConsequences from "./AnalystConsequences.tsx";
import { utilityForEvent } from "./whoActsFirst";
import PrototypeCaseViews from "./PrototypeCaseViews";
import TexasInfrastructureMap from "./TexasInfrastructureMap";
import {
  ArrowRight,
  FileText,
  ShieldCheck,
  Users,
  Download,
} from "lucide-react";
import { displayText } from "./presentation";
import { activityDisplayText } from "./caseFilePresentation.ts";
import { formatTime } from "./displayTime.ts";
import { eventTimestamp } from "./caseTimeline.ts";
import { humanize, windowLabel } from "./api";
import { commandMetrics, orderIncidents } from "./commandMetrics";
import type { Bootstrap, Event, Telemetry, Run, RunRequest } from "./types";
import type { MapViewState } from "./mapViewState";
import type {
  CommandCreate,
  CommandAction,
  CommandIncident,
  CommandView,
} from "./commandTypes";
import { filterWork } from "./workFilters";
import type { RecordsState, ReferenceData } from "./scriptedTypes";

interface Props {
  onMutate: (action: CommandAction) => Promise<void>;
  onAnalyze: (scenarioId: string, horizonHours: number) => void;
  onWhatIf?: (request: RunRequest) => Promise<Run>;
  lastPlanningRun?: Run | null;
  onPropose: (id: string, role?: "provider" | "dependent") => void;
  records?: RecordsState | null;
  onCreate?: (request: CommandCreate) => Promise<CommandIncident>;
  reference?: ReferenceData;
  telemetry?: Telemetry | null;
  data: Bootstrap;
  incidents: CommandIncident[];
  selected: CommandIncident | null;
  view: CommandView;
  refreshedAt: string | null;
  onSelect: (id: string) => void;
  onNavigate: (view: CommandView) => void;
  onOpenAnalyst: (view: CommandView, caseId?: string | null, entityId?: string | null) => void;
  onOpenTool: (
    tool:
      | "overview"
      | "relationships"
      | "evidence"
      | "blueprint"
      | "incident"
      | "lab",
    entityId?: string,
  ) => void;
  onDownload: () => void;
  onInvestigate: (event: Event) => void;
  workflowLocked: boolean;
  onNote: (note: string) => Promise<unknown>;
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  mapState: MapViewState;
  onMapStateChange: (state: MapViewState) => void;
}
export default function CommandReadouts({
  onMutate,
  onAnalyze,
  onPropose,
  onWhatIf,
  lastPlanningRun,
  records,
  onCreate,
  reference,
  telemetry = null,
  data,
  incidents,
  selected,
  view,
  refreshedAt,
  onSelect,
  onNavigate,
  onOpenAnalyst,
  onOpenTool,
  onDownload,
  onInvestigate,
  workflowLocked,
  onNote,
  selectedEntityId,
  onSelectEntity,
  mapState,
  onMapStateChange,
}: Props) {
  const metrics = useMemo(() => commandMetrics(incidents), [incidents]);
  const areas = data.entities.filter((entity) => entity.type === "ServiceArea");
  const label = (id: string) =>
    displayText(data.entities.find((entity) => entity.id === id)?.label ?? id);
  const [idtIndex, setIdtIndex] = useState<IdtIndex | null>(null);

  const [referenceError, setReferenceError] = useState("");
  const [workFilters, setWorkFilters] = useState({
    query: "",
    status: "active",
    priority: "all",
  });
  const [evidenceId, setEvidenceId] = useState(
    selected?.eventId ?? data.events[0]?.id ?? "",
  );
  const [evidenceQuery, setEvidenceQuery] = useState("");
  const [evidenceSource, setEvidenceSource] = useState("all");
  const selectedEventId = selected?.eventId;
  useEffect(() => {
    if (selectedEventId) setEvidenceId(selectedEventId);
  }, [selectedEventId]);
  const filteredWork = filterWork(incidents, workFilters);
  useEffect(() => {
    let current = true;
    api<unknown>("/v1/reference/idt")
      .then((idt) => {
        if (current) {
          setIdtIndex(createIdtIndex(idt));

          setReferenceError("");
        }
      })
      .catch((error) => {
        if (current)
          setReferenceError(
            error instanceof Error ? error.message : "Reference unavailable",
          );
      });
    return () => {
      current = false;
    };
  }, []);

  const active = orderIncidents(incidents).filter(
    (incident) => incident.status !== "closed",
  );
  const eventLabel = (event: Bootstrap["events"][number]) =>
    displayText(event.label ?? event.title ?? event.id);
  const casesTable = (records: CommandIncident[]) => (
    <div className="command-table-wrap">
      <table className="command-table">
        <thead>
          <tr>
            <th>Incident</th>
            <th>Context</th>
            <th>Triage priority</th>
            <th>Tracking status</th>
            <th>Pending review</th>
          </tr>
        </thead>
        <tbody>
          {records.map((incident) => (
            <tr key={incident.id}>
              <td>
                <button
                  className="command-link"
                  disabled={workflowLocked}
                  onClick={() => onSelect(incident.id)}
                >
                  {incident.title}
                </button>
                <small>{incident.id}</small>
              </td>
              <td>
                {displayText(
                  incident.contextSnapshot.provider?.label ??
                    "Provider unresolved",
                )}
                <small>Captured model v{incident.baselineRevision}</small>
              </td>
              <td>
                <span className={`command-priority ${incident.priority}`}>
                  {humanize(incident.priority)}
                </span>
              </td>
              <td>
                {humanize(incident.status)}
                <small>Workspace state only</small>
              </td>
              <td>
                {
                  incident.decisions.filter((decision) => !decision.reviewed)
                    .length
                }{" "}
                reviews ·{" "}
                {incident.tasks.filter((task) => !task.completed).length} tasks
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (selected && ["coordination", "leadership", "federation"].includes(view))
    return (
      <PrototypeCaseViews
        reference={reference}
        key={selected.id}
        incident={selected}
        view={view}
        onOpenLab={() => onOpenTool("lab")}
        onNote={onNote}
        locked={workflowLocked}
      />
    );

  if (view === "command")
    return (
      <>
        <AnalystAlerts
          data={data}
          incidents={incidents}
          records={records}
          workflowLocked={workflowLocked}
          onCreate={
            onCreate ??
            (() =>
              Promise.reject(
                new Error("Case creation is unavailable. Refresh casework."),
              ))
          }
          onOpenCase={onSelect}
        />
        <section className="command-metrics" aria-label="Saved casework counts">
          {[
            [
              metrics.activeIncidents,
              "Active incidents",
              "Explicitly opened cases",
            ],
            [
              metrics.pendingDecisions,
              "Pending reviews",
              "Advisory, not approvals",
            ],
            [metrics.pendingTasks, "Playbook tasks", "Workspace checklist"],
            [
              metrics.modeledFunctions,
              "Modeled functions",
              "Not observed failures",
            ],
            [
              metrics.savedCoordinationNotes,
              "Coordination notes",
              "Saved locally, not sent",
            ],
          ].map(([value, title, note]) => (
            <article key={title} className="command-metric">
              <strong>{value}</strong>
              <span>{title}</span>
              <small>{note}</small>
            </article>
          ))}
        </section>
        <div className="command-dashboard-grid">
          <section className="command-panel">
            <div className="command-panel-heading">
              <h2>My Work · case queue</h2>
              <span>{filteredWork.length} matching case records</span>
            </div>
            <div className="analyst-filters" aria-label="Case queue filters">
              <label>
                Search cases
                <input
                  aria-label="Search cases"
                  value={workFilters.query}
                  onChange={(e) =>
                    setWorkFilters({ ...workFilters, query: e.target.value })
                  }
                />
              </label>
              <label>
                Status
                <select
                  aria-label="Case status filter"
                  value={workFilters.status}
                  onChange={(e) =>
                    setWorkFilters({ ...workFilters, status: e.target.value })
                  }
                >
                  <option value="active">Open and monitoring</option>
                  <option value="all">All statuses</option>
                  <option value="open">Open</option>
                  <option value="monitoring">Monitoring</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label>
                Priority
                <select
                  aria-label="Case priority filter"
                  value={workFilters.priority}
                  onChange={(e) =>
                    setWorkFilters({ ...workFilters, priority: e.target.value })
                  }
                >
                  <option value="all">All priorities</option>
                  {["critical", "high", "medium", "low"].map((p) => (
                    <option key={p} value={p}>
                      {humanize(p)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {filteredWork.length ? (
              casesTable(filteredWork)
            ) : (
              <div className="command-empty">
                <ShieldCheck size={27} />
                <h3>
                  {incidents.length
                    ? "No cases match these filters"
                    : "No cases yet"}
                </h3>
                <p>Select an evidence card to investigate.</p>
              </div>
            )}
          </section>
          <aside className="command-panel">
            <h2>Needs you next</h2>
            {active
              .flatMap((incident) =>
                incident.decisions
                  .filter((decision) => !decision.reviewed)
                  .map((decision) => ({ incident, decision })),
              )
              .slice(0, 4)
              .map(({ incident, decision }) => (
                <button
                  key={decision.id}
                  className="command-action-card"
                  disabled={workflowLocked}
                  onClick={() => {
                    onSelect(incident.id);
                    onNavigate("consequence");
                  }}
                >
                  <strong>{displayText(decision.title)}</strong>
                  <span>
                    {windowLabel(decision.windowHours)} · scenario-relative
                  </span>
                  <small>
                    Review required <ArrowRight size={13} />
                  </small>
                </button>
              ))}
            {!metrics.pendingDecisions && (
              <p className="command-muted">No pending consequence reviews.</p>
            )}
            <div className="command-boundary">
              <strong>Workspace readiness</strong>
              <p>Model loaded · version {data.baselineRevision}</p>

              <small>
                Last confirmed casework read:{" "}
                {refreshedAt
                  ? formatTime(refreshedAt)
                  : "Unknown"}
              </small>
            </div>
          </aside>
        </div>
      </>
    );

  if (view === "cop")
    return (
      <>
        <TexasInfrastructureMap
          idtIndex={idtIndex}
          data={data}
          incidents={incidents}
          onOpenEntityProfile={(id) => {
            if (workflowLocked) return;
            onOpenAnalyst("entity-profile", selected?.id ?? null, id);
          }}
          selectedId={selectedEntityId}
          onSelectEntity={onSelectEntity}
          mapState={mapState}
          onMapStateChange={onMapStateChange}
          onOpenEntity={(id) => {
            if (workflowLocked) return;
            onOpenAnalyst("entity-profile", selected?.id ?? null, id);
          }}
        />
        <details className="command-panel">
          <summary>Advanced · all located records</summary>
          <div className="command-three-grid">
            {areas.map((area) => {
              const providers = data.entities.filter(
                (entity) =>
                  entity.serves === area.id ||
                  (Array.isArray(entity.serves) &&
                    entity.serves.includes(area.id)),
              );
              const members = data.entities.filter(
                (entity) => entity.locatedIn === area.id,
              );
              const cases = active.filter(
                (incident) =>
                  incident.contextSnapshot.serviceArea?.id === area.id ||
                  providers.some(
                    (provider) =>
                      provider.id ===
                      (incident.contextSnapshot.provider?.id ??
                        (incident.eventSnapshot
                          ? utilityForEvent(incident.eventSnapshot, data)
                          : null)),
                  ),
              );
              return (
                <section className="command-panel" key={area.id}>
                  <h2>
                    <button
                      className="command-link"
                      disabled={workflowLocked}
                      onClick={() => {
                        onSelectEntity(area.id);
                        onNavigate("entity-profile");
                      }}
                    >
                      {displayText(area.label)}
                    </button>
                  </h2>
                  <p>
                    {providers.length
                      ? providers.map((entity) => (
                          <button
                            className="command-link"
                            key={entity.id}
                            disabled={workflowLocked}
                            onClick={() => {
                              onSelectEntity(entity.id);
                              onNavigate("entity-profile");
                            }}
                          >
                            {displayText(entity.label)}
                          </button>
                        ))
                      : "Provider association unknown"}
                  </p>
                  <div className="command-facts">
                    <span>{members.length} located records</span>
                    <span>{cases.length} tracked cases</span>
                  </div>
                  <ul className="command-record-list">
                    {members.map((entity) => (
                      <li key={entity.id}>
                        <button
                          className="command-link"
                          disabled={workflowLocked}
                          onClick={() => {
                            onSelectEntity(entity.id);
                            onNavigate("entity-profile");
                          }}
                        >
                          {displayText(entity.label)}
                        </button>
                        <small>{humanize(entity.type)}</small>
                        <IdtChip entity={entity} index={idtIndex} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </details>
      </>
    );

  const evidenceRecords = [
    ...data.events.map((event) => ({ ...event, evidenceOrigin: "scenario" })),
  ];
  const cyberSelector = (
    <section className="command-panel">
      <div className="command-panel-heading">
        <h2>Cyber evidence</h2>
        <button
          className="button secondary"
          disabled={workflowLocked}
          onClick={() => onOpenTool("evidence")}
        >
          Open raw telemetry
        </button>
      </div>
      <div className="analyst-filters">
        <label>
          Search evidence
          <input
            aria-label="Search evidence"
            value={evidenceQuery}
            onChange={(e) => setEvidenceQuery(e.target.value)}
          />
        </label>
        <label>
          Source
          <select
            aria-label="Evidence source filter"
            value={evidenceSource}
            onChange={(e) => setEvidenceSource(e.target.value)}
          >
            <option value="all">All sources</option>

            <option value="scenario">Scenario records</option>
          </select>
        </label>
      </div>
      <div className="evidence-picker" aria-label="Evidence records">
        {evidenceRecords
          .filter(
            (event) =>
              (evidenceSource === "all" ||
                event.evidenceOrigin === evidenceSource) &&
              `${eventLabel(event)} ${event.description ?? ""}`
                .toLocaleLowerCase()
                .includes(evidenceQuery.toLocaleLowerCase()),
          )
          .map((event) => (
            <button
              key={event.id}
              className="command-action-card"
              aria-pressed={evidenceId === event.id}
              onClick={() => setEvidenceId(event.id)}
            >
              <strong>{eventLabel(event)}</strong>
              <small>Scenario evidence · source record</small>
            </button>
          ))}
      </div>
      <button
        className="button primary"
        disabled={workflowLocked || !evidenceId}
        onClick={() => {
          const event = evidenceRecords.find((item) => item.id === evidenceId);
          if (event) onInvestigate(event);
        }}
      >
        Open case
      </button>
      {referenceError && (
        <p role="alert">Reference evidence unavailable: {referenceError}</p>
      )}
    </section>
  );

  if (view === "consequence")
    return selected ? (
      <AnalystConsequences
        data={data}
        incident={selected}
        reference={reference ?? null}
        idtIndex={idtIndex}
        busy={workflowLocked}
        onAnalyze={onAnalyze}
        onMutate={onMutate}
        onWhatIf={onWhatIf}
        lastPlanningRun={lastPlanningRun}
        onPropose={onPropose}
        onOpenMap={(id) => {
          if (workflowLocked) return;
          onSelectEntity(id);
          onNavigate("cop");
        }}
        onOpenEntity={(id) => {
          if (workflowLocked) return;
          onOpenAnalyst("entity-profile", selected?.id ?? null, id);
        }}
        onOpenLab={() => onOpenTool("lab")}
      />
    ) : (
      <section className="command-panel">
        <h2>Consequence analysis</h2>
        <p>
          Select a case, or open one from an alert, before running a case
          analysis.
        </p>
      </section>
    );

  if (view === "cyber")
    return (
      <>
        <NetworkEvidence
          data={data}
          telemetry={telemetry}
          incident={selected}
          records={records}
          busy={workflowLocked}
          onMutate={onMutate}
          onOpenCaseFile={() => onNavigate("case-file")}
          events={
            selected
              ? [
                  ...data.events.filter(
                    (event) => event.id !== selected.eventId,
                  ),
                  selected.eventSnapshot,
                ]
              : data.events
          }
        />
        <details>
          <summary>Advanced · event context and case linkage</summary>
          {cyberSelector}
          <section className="command-panel">
            <div className="command-panel-heading">
              <div>
                <h2>Cyber observations and case linkage</h2>
                <p>Recorded observations and linked cases.</p>
              </div>
              <button
                className="button secondary"
                onClick={() => onOpenTool("evidence")}
              >
                <FileText size={16} />
                Inspect event evidence
              </button>
            </div>
            <div className="command-event-grid">
              {data.events
                .filter((event) => event.id === evidenceId)
                .map((event) => {
                  const casework = incidents.filter(
                    (incident) => incident.eventId === event.id,
                  );
                  const refs =
                    typeof event.seenOn === "string"
                      ? [event.seenOn]
                      : Array.isArray(event.seenOn)
                        ? event.seenOn.filter(
                            (value): value is string =>
                              typeof value === "string",
                          )
                        : [];
                  return (
                    <article className="command-event" key={event.id}>
                      <span className="command-source-tag">SOURCE RECORD</span>
                      <h3>{eventLabel(event)}</h3>
                      <p>
                        {displayText(
                          event.description ?? "Description not provided",
                        )}
                      </p>
                      <small>
                        Seen on:{" "}
                        {refs.length
                          ? refs.map(label).join(", ")
                          : "Asset association unknown"}
                      </small>
                      <small>
                        Recorded:{" "}
                        {formatTime(eventTimestamp(event, data, records))}
                      </small>
                      <div className="command-tags">
                        {(event.sourceRefs ?? []).map((id) => (
                          <span key={id}>
                            {displayText(
                              data.sources.find((source) => source.id === id)
                                ?.label ?? id,
                            )}
                          </span>
                        ))}
                      </div>
                      {casework.map((incident) => (
                        <button
                          key={incident.id}
                          className="command-link"
                          disabled={workflowLocked}
                          onClick={() => onSelect(incident.id)}
                        >
                          Open {incident.title} · {humanize(incident.status)}{" "}
                          <ArrowRight size={13} />
                        </button>
                      ))}
                      {!casework.length && (
                        <p className="command-muted">
                          No incident opened for this record. Open casework to
                          triage an event explicitly.
                        </p>
                      )}
                    </article>
                  );
                })}
            </div>
          </section>
        </details>
      </>
    );

  if (view === "leadership")
    return (
      <>
        <section className="command-panel">
          <div className="command-panel-heading">
            <div>
              <h2>Leadership casework brief</h2>
              <p>
                Measures below are derived from saved workspace records only.
              </p>
            </div>
            <button
              className="button secondary"
              onClick={onDownload}
              disabled={!selected}
            >
              <Download size={16} />
              Download selected brief
            </button>
          </div>
          <div className="command-metrics">
            <article className="command-metric">
              <strong>{metrics.activeIncidents}</strong>
              <span>Active cases</span>
            </article>
            <article className="command-metric">
              <strong>{metrics.closedIncidents}</strong>
              <span>Closed in workspace</span>
            </article>
            <article className="command-metric">
              <strong>{metrics.pendingDecisions}</strong>
              <span>Pending impact reviews</span>
            </article>
            <article className="command-metric">
              <strong>
                {metrics.firstReviewMedianSeconds === null
                  ? "—"
                  : `${Math.round(metrics.firstReviewMedianSeconds)}s`}
              </strong>
              <span>Median opening → first review</span>
              <small>
                {metrics.firstReviewMedianSeconds === null
                  ? "No valid review timing recorded"
                  : "Casework duration, not threat detection time"}
              </small>
            </article>
          </div>
          <div className="command-boundary">
            <p>No operational performance timestamps recorded.</p>
          </div>
        </section>
        <section className="command-panel">
          <h2>Incident register</h2>
          {incidents.length ? (
            casesTable(orderIncidents(incidents))
          ) : (
            <p>No casework has been recorded.</p>
          )}
        </section>
        <section className="command-panel">
          <h2>Latest recorded activity</h2>
          <ol className="command-activity">
            {incidents
              .flatMap((incident) =>
                incident.activity.map((entry) => ({
                  ...entry,
                  title: incident.title,
                })),
              )
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 10)
              .map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.title}</strong>
                  <p>{activityDisplayText(entry.message)}</p>
                  <time dateTime={entry.createdAt}>
                    {formatTime(entry.createdAt)}
                  </time>
                </li>
              ))}
          </ol>
          {!incidents.length && (
            <p>Activity begins after a case is explicitly opened.</p>
          )}
        </section>
      </>
    );

  if (view === "federation")
    return (
      <>
        <section className="command-panel">
          <div className="command-panel-heading">
            <div>
              <h2>
                <Users size={18} />
                Organizations and briefing handoff
              </h2>
            </div>
            <button
              className="button secondary"
              onClick={onDownload}
              disabled={!selected}
            >
              <Download size={16} />
              Download selected brief
            </button>
          </div>
          <div className="command-boundary">
            <strong>Draft · not sent</strong>
            {selected && (
              <p>
                Selected brief: <strong>{selected.title}</strong> ·{" "}
                {selected.id}
              </p>
            )}
          </div>
          <div className="command-three-grid">
            {data.entities
              .filter((entity) => entity.type === "Organization")
              .map((organization) => (
                <article className="command-event" key={organization.id}>
                  <h3>{displayText(organization.label)}</h3>
                  <span className="command-source-tag">MODEL INVENTORY</span>
                  <ul className="command-record-list">
                    {data.entities
                      .filter((entity) => entity.operatedBy === organization.id)
                      .map((entity) => (
                        <li key={entity.id}>
                          <button
                            className="command-link"
                            onClick={() =>
                              onOpenTool("relationships", entity.id)
                            }
                          >
                            {displayText(entity.label)}
                          </button>
                        </li>
                      ))}
                  </ul>
                  <small>No delivery endpoint recorded.</small>
                </article>
              ))}
          </div>
        </section>
      </>
    );

  return (
    <section className="command-panel command-role-intro">
      <h2>
        {view === "coordination"
          ? "Local coordination and handoff notes"
          : view === "uctf"
            ? "Task force casework checklist"
            : "Conditional consequence and decision review"}
      </h2>
      <p>
        {view === "coordination"
          ? "Record coordination needs and prepare a briefing."
          : view === "uctf"
            ? "Track analyst checklist completion against a selected case."
            : "Run an explicitly linked scenario and review the captured evidence."}
      </p>
    </section>
  );
}

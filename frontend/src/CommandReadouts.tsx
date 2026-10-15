import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { createIdtIndex, type IdtIndex } from "./idt";
import { IdtChip } from "./IdtChip";
import {
  pcapEvent,
  pcapFromEvent,
  parsePcapEvidence,
  type PcapEvidence,
} from "./pcapEvidence";
import PcapEvidencePanel from "./PcapEvidencePanel";
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
import { humanize, windowLabel } from "./api";
import { commandMetrics, orderIncidents } from "./commandMetrics";
import type { Bootstrap, Event } from "./types";
import type { MapViewState } from "./mapViewState";
import type { CommandIncident, CommandView } from "./commandTypes";
import { filterWork } from "./workFilters";

interface Props {
  data: Bootstrap;
  incidents: CommandIncident[];
  selected: CommandIncident | null;
  view: CommandView;
  refreshedAt: string | null;
  onSelect: (id: string) => void;
  onNavigate: (view: CommandView) => void;
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
  data,
  incidents,
  selected,
  view,
  refreshedAt,
  onSelect,
  onNavigate,
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
  const [capture, setCapture] = useState<PcapEvidence | null>(null);
  const [referenceError, setReferenceError] = useState("");
  const [workFilters, setWorkFilters] = useState({
    query: "",
    status: "active",
    priority: "all",
  });
  const [evidenceId, setEvidenceId] = useState(
    selected?.eventId ?? pcapEvent.id,
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
    Promise.all([
      api<unknown>("/v1/reference/idt"),
      api<unknown>("/v1/reference/pcap"),
    ])
      .then(([idt, pcap]) => {
        if (current) {
          setIdtIndex(createIdtIndex(idt));
          const parsed = parsePcapEvidence(pcap);
          if (!parsed) throw new Error("Packet reference failed validation");
          setCapture(parsed);
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
  const capturedPacketEvidence = pcapFromEvent(selected?.eventSnapshot);
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

  if (
    selected &&
    ["consequence", "coordination", "leadership", "federation"].includes(view)
  )
    return (
      <PrototypeCaseViews
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
        <section className="command-panel">
          <div className="command-panel-heading">
            <h2>Evidence to investigate</h2>
            <span>Source-linked · no automatic incident declaration</span>
          </div>
          {referenceError && (
            <p role="alert">
              Reference evidence unavailable: {referenceError}. Restart/recheck
              the local API; no substitute evidence has been invented.
            </p>
          )}
          <div className="prototype-alerts">
            <article className="command-event prototype-alert">
              <span className="command-source-tag">
                Corelight capture · offline evidence
              </span>
              <h3>Review water-sector network activity</h3>
              <p>
                {capture
                  ? `${capture.capture.packet_count} packets · ${capture.tcpFlowCount} TCP flows · historical capture`
                  : "Capture reference loading"}
              </p>
              <button
                className="button primary"
                disabled={workflowLocked || !capture}
                onClick={() => onInvestigate(pcapEvent)}
              >
                {active.some((record) => record.eventId === pcapEvent.id)
                  ? "Resume investigation"
                  : "Investigate"}
              </button>
            </article>
            {data.events.slice(0, 2).map((event) => (
              <article className="command-event prototype-alert" key={event.id}>
                <span className="command-source-tag">Scenario evidence</span>
                <h3>{eventLabel(event)}</h3>
                <p>
                  {displayText(
                    event.description ?? "Recorded scenario observation",
                  )}
                </p>
                <button
                  className="button primary"
                  disabled={workflowLocked}
                  onClick={() => onInvestigate(event)}
                >
                  {active.some((record) => record.eventId === event.id)
                    ? "Resume investigation"
                    : "Investigate"}
                </button>
              </article>
            ))}
          </div>
        </section>
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
                    : "No active incidents"}
                </h3>
                <p>
                  Select an evidence card to investigate. Alerts do not by
                  themselves establish an incident or a physical outage.
                </p>
              </div>
            )}
          </section>
          <aside className="command-panel">
            <h2>Pending action</h2>
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
              <p className="command-muted">
                No pending consequence reviews. This is not confirmation that
                services are unaffected.
              </p>
            )}
            <div className="command-boundary">
              <strong>Workspace readiness</strong>
              <p>Model loaded · version {data.baselineRevision}</p>
              <p>Formal authority / policy gates: not configured.</p>
              <p>
                Live OT feeds and partner notification transport: not connected.
              </p>
              <small>
                Last confirmed casework read:{" "}
                {refreshedAt
                  ? new Date(refreshedAt).toLocaleString()
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
          selectedId={selectedEntityId}
          onSelectEntity={onSelectEntity}
          mapState={mapState}
          onMapStateChange={onMapStateChange}
          onOpenEntity={(id) => {
            onSelectEntity(id);
            onNavigate("entity-profile");
          }}
        />
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
                incident.contextSnapshot.serviceArea?.id === area.id,
            );
            return (
              <section className="command-panel" key={area.id}>
                <h2>{displayText(area.label)}</h2>
                <p>
                  {providers
                    .map((entity) => displayText(entity.label))
                    .join(", ") || "Provider association unknown"}
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
                        onClick={() => onSelectEntity(entity.id)}
                      >
                        {displayText(entity.label)}
                      </button>
                      <small>{humanize(entity.type)}</small>
                      <IdtChip
                        entity={entity}
                        index={idtIndex}
                        allowSeedLookup
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </>
    );

  const evidenceRecords = [
    { ...pcapEvent, label: "Offline packet capture", evidenceOrigin: "packet" },
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
            <option value="packet">Offline packet capture</option>
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
              <small>
                {event.evidenceOrigin === "packet"
                  ? "Offline capture · packet observations"
                  : "Scenario evidence · reference record"}
              </small>
            </button>
          ))}
      </div>
      <button
        className="button primary"
        disabled={workflowLocked || (evidenceId === pcapEvent.id && !capture)}
        onClick={() => {
          const event = evidenceRecords.find((item) => item.id === evidenceId);
          if (event) onInvestigate(event);
        }}
      >
        Investigate selected evidence
      </button>
      {referenceError && (
        <p role="alert">Reference evidence unavailable: {referenceError}</p>
      )}
    </section>
  );
  if (view === "cyber" && evidenceId === pcapEvent.id)
    return (
      <>
        {cyberSelector}
        {capturedPacketEvidence || capture ? (
          <PcapEvidencePanel evidence={(capturedPacketEvidence || capture)!} />
        ) : (
          <p className="notice">
            Packet reference unavailable. No substitute evidence has been
            invented.
          </p>
        )}
      </>
    );
  if (view === "cyber")
    return (
      <>
        {cyberSelector}
        <section className="command-panel">
          <div className="command-panel-heading">
            <div>
              <h2>Cyber observations and case linkage</h2>
              <p>
                Recorded reference evidence, not a live sensor or compromise
                declaration.
              </p>
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
                          (value): value is string => typeof value === "string",
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
                      {event.timestamp ?? event.eventTime ?? "Unknown"}
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
              <span>Pending advisory reviews</span>
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
            <strong>Operational performance measures are not populated</strong>
            <p>
              Compromise, detection, mitigation, dissemination and
              partner-delivery timestamps are not supplied. No official TXCC
              performance or readiness result is inferred.
            </p>
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
                  <p>{entry.message}</p>
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString()}
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
              <p>
                Inventory associations are not connected federation endpoints.
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
          <div className="command-boundary">
            <strong>External transport is not configured</strong>
            <p>
              Briefs download to your device only. No partner is notified, no
              message is delivered, and no cross-agency access or clearance is
              asserted.
            </p>
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
                  <small>
                    Directory, contact and delivery endpoint: not configured.
                  </small>
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
          ? "Record coordination needs and prepare a briefing. Saving a note does not send a notification."
          : view === "uctf"
            ? "Track analyst checklist completion against a selected case. No roster or duty assignment is invented."
            : "Run an explicitly linked scenario and review the captured evidence. Analysis is advisory, not an execution order."}
      </p>
    </section>
  );
}

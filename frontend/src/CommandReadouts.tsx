import { useMemo } from "react";
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
import type { Bootstrap } from "./types";
import type { CommandIncident, CommandView } from "./commandTypes";

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
}: Props) {
  const metrics = useMemo(() => commandMetrics(incidents), [incidents]);
  const areas = data.entities.filter((entity) => entity.type === "ServiceArea");
  const label = (id: string) =>
    displayText(data.entities.find((entity) => entity.id === id)?.label ?? id);
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

  if (view === "command")
    return (
      <>
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
              <h2>Active incidents · workspace picture</h2>
              <span>{active.length} open / monitoring</span>
            </div>
            {active.length ? (
              casesTable(active)
            ) : (
              <div className="command-empty">
                <ShieldCheck size={27} />
                <h3>No active incidents</h3>
                <p>
                  Choose Start incident to create a case from a recorded event.
                  Alerts are not automatically declared incidents or physical
                  outages.
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
          data={data}
          onOpenEntity={(id) => onOpenTool("overview", id)}
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
                        onClick={() => onOpenTool("relationships", entity.id)}
                      >
                        {displayText(entity.label)}
                      </button>
                      <small>{humanize(entity.type)}</small>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </>
    );

  if (view === "cyber")
    return (
      <>
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
            {data.events.map((event) => {
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
                    Recorded: {event.timestamp ?? event.eventTime ?? "Unknown"}
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

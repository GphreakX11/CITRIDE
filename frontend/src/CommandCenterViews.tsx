import { useState, type ReactNode } from "react";
import type { Bootstrap, Entity, Source } from "./types.ts";
import type { CommandIncident, CommandView } from "./commandTypes.ts";
import { orderIncidents } from "./commandMetrics.ts";
import { displayText } from "./presentation.ts";
import { graphEdges, mapPositions } from "./texasGraph.ts";
import { TEXAS_PATH, TEXAS_BOUNDARY_SOURCE } from "./texasOutline.ts";
import {
  audiencePreview,
  contextChain,
  consequenceModel,
  eventTimeline,
  formattedBrief,
  leadershipDraft,
  originLabel,
  overviewModel,
  planningWindow,
  previewAudiences,
  recordedActivity,
  recordedTasks,
  sourceLabels,
  sourceText,
  strings,
  timeLabel,
  words,
  type ConsequenceModel,
} from "./commandCenterModel.ts";
import "./command-center-views.css";

export interface CommandCenterViewsProps {
  data: Bootstrap;
  incidents: CommandIncident[];
  selected: CommandIncident | null;
  view: CommandView;
  onSelect: (id: string) => void;
  onOpenAnalyst: (
    view: CommandView,
    caseId?: string,
    entityId?: string,
  ) => void;
  onNavigate: (view: CommandView) => void;
}

const headings: Partial<Record<CommandView, [string, string]>> = {
  command: ["C1", "Command Overview"],
  cop: ["C2", "Statewide Map"],
  cyber: ["C3", "Attack Picture"],
  consequence: ["C4", "Consequences"],
  uctf: ["C5", "Response Teams"],
  leadership: ["C6", "Leadership Brief"],
  federation: ["C7", "Partner and Stakeholder Coordination"],
};
function Panel({
  title,
  children,
  note,
}: {
  title: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className="command-panel cc-panel">
      <div className="command-panel-heading">
        <h2>{title}</h2>
        {note && <span>{note}</span>}
      </div>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="cc-empty">{children}</p>;
}
function Metrics({ values }: { values: [ReactNode, string, string][] }) {
  return (
    <section
      className="command-metrics cc-metrics"
      aria-label="Recorded measures"
    >
      {values.map(([value, label, note]) => (
        <article className="command-metric" key={label}>
          <strong>{value}</strong>
          <span>{label}</span>
          <small>{note}</small>
        </article>
      ))}
    </section>
  );
}
function Sources({ refs, sources }: { refs: string[]; sources: Source[] }) {
  return (
    <div className="cc-sources" aria-label="Source provenance">
      {sourceLabels(refs, sources).map((source) => (
        <details key={source.id}>
          <summary>{displayText(source.label)}</summary>
          <p>{source.description}</p>
          <small>Origin: {source.origin}</small>
        </details>
      ))}
      {!refs.length && (
        <span className="command-muted">No source references captured</span>
      )}
    </div>
  );
}
function ImpactList({ model }: { model: ConsequenceModel }) {
  return model.run ? (
    <ul className="command-record-list">
      {model.rows.map((row) => (
        <li key={row.id}>
          <strong>{displayText(row.label)}</strong>
          <span> · {displayText(row.functionLabel)}</span>
          <small>
            Modeled {words(row.state)} · {planningWindow(row.windowHours)}
          </small>
        </li>
      ))}
      {!model.rows.length && (
        <li>
          No impacts in this captured run. This does not establish normal
          operations.
        </li>
      )}
    </ul>
  ) : (
    <Empty>
      No captured consequence run. Physical service effects are not established.
    </Empty>
  );
}
function CaseRegister({
  incidents,
  onSummary,
}: {
  incidents: CommandIncident[];
  onSummary: (id: string) => void;
}) {
  return incidents.length ? (
    <div className="command-table-wrap">
      <table className="command-table cc-register">
        <thead>
          <tr>
            <th scope="col">Incident</th>
            <th scope="col">Captured context</th>
            <th scope="col">Priority</th>
            <th scope="col">Tracking status</th>
            <th scope="col">Progress</th>
          </tr>
        </thead>
        <tbody>
          {orderIncidents(incidents).map((incident) => (
            <tr key={incident.id}>
              <td>
                <button
                  className="command-link"
                  onClick={() => onSummary(incident.id)}
                >
                  {incident.title}
                </button>
                <small>Opened {timeLabel(incident.createdAt)}</small>
              </td>
              <td>
                {displayText(
                  incident.contextSnapshot.provider?.label ??
                    "Provider not established",
                )}
                <small>
                  {displayText(
                    incident.contextSnapshot.serviceArea?.label ??
                      "Service area not established",
                  )}
                </small>
              </td>
              <td>
                <span className={`command-priority ${incident.priority}`}>
                  {words(incident.priority)}
                </span>
              </td>
              <td>
                {words(incident.status)}
                <small>Case tracking only</small>
              </td>
              <td>
                {
                  incident.decisions.filter((decision) => decision.reviewed)
                    .length
                }{" "}
                / {incident.decisions.length} advisory reviews
                <small>
                  {incident.tasks.filter((task) => task.completed).length} /{" "}
                  {incident.tasks.length} tasks recorded complete
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty>
      No saved cases. Source alerts do not become incidents automatically.
    </Empty>
  );
}
function CaseSummary({
  incident,
  onOpen,
  onClose,
}: {
  incident: CommandIncident;
  onOpen: () => void;
  onClose: () => void;
}) {
  const model = consequenceModel(incident);
  return (
    <aside
      className="command-panel cc-case-summary"
      aria-label="Case summary · read-only"
    >
      <div className="command-panel-heading">
        <h2>Case Summary · Read-only</h2>
        <button className="command-link" onClick={onClose}>
          Close summary
        </button>
      </div>
      <h3>{incident.title}</h3>
      <p>
        <span className={`command-priority ${incident.priority}`}>
          {words(incident.priority)}
        </span>{" "}
        · {words(incident.status)} tracking
      </p>
      <h4>Captured context</h4>
      <p>
        {contextChain(incident)
          .map((entity) => displayText(entity.label))
          .join(" → ") || "Context chain not established"}
      </p>
      <p>
        {displayText(
          incident.eventSnapshot.description ?? "No description captured",
        )}
      </p>
      <small>
        Event origin: {originLabel(incident.eventSnapshot)} · Updated{" "}
        {timeLabel(incident.updatedAt)}
      </small>
      {incident.contextSnapshot.warnings.length > 0 && (
        <ul className="cc-notice">
          {incident.contextSnapshot.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}
      <h4>Captured impacts</h4>
      <ImpactList model={model} />
      <h4>Recorded progress</h4>
      <p>
        {incident.decisions.filter((decision) => decision.reviewed).length} of{" "}
        {incident.decisions.length} advisory reviews ·{" "}
        {incident.tasks.filter((task) => task.completed).length} of{" "}
        {incident.tasks.length} tasks recorded complete
      </p>
      <p className="command-muted">
        Chief response-option decisions are not supplied. Advisory reviews are
        not approvals; completed tasks do not establish dispatch or recovery.
      </p>
      <h4>Latest activity</h4>
      {recordedActivity([incident])
        .slice(0, 3)
        .map((item) => (
          <p key={item.id}>
            {item.message}
            <small className="cc-block">{timeLabel(item.createdAt)}</small>
          </p>
        ))}
      {!incident.activity.length && <Empty>No activity recorded.</Empty>}
      <Sources
        refs={incident.contextSnapshot.sourceRefs}
        sources={model.captured.sources}
      />
      <button className="button primary" onClick={onOpen}>
        Open full case file
      </button>
    </aside>
  );
}

/** Infrastructure-only topology; no equipment, inventory search or Analyst map controls. */
function InfrastructureSchematic({
  data,
  selected,
}: {
  data: Bootstrap;
  selected: CommandIncident | null;
}) {
  const model = consequenceModel(selected);
  const entities = [
    ...new Map(
      [
        ...data.entities,
        ...(selected ? contextChain(selected) : []),
        ...model.captured.entities,
      ].map((entity) => [entity.id, entity]),
    ).values(),
  ];
  const equipment = (entity: Entity) =>
    /Cyber|PhysicalITAsset|PhysicalOTAsset|NetworkIdentity/i.test(entity.type);
  const ids = new Set(
    [...data.dependencies, ...model.captured.dependencies].flatMap(
      (dependency) => [dependency.provider, dependency.dependent],
    ),
  );
  const nodes = entities.filter(
    (entity) =>
      !equipment(entity) &&
      (ids.has(entity.id) ||
        entity.type === "WaterServiceProvider" ||
        entity.type === "TreatmentPlant"),
  );
  const visible = new Set(nodes.map((entity) => entity.id));
  const positions = mapPositions(entities);
  const edges = graphEdges({ ...data, entities }).filter(
    (edge) =>
      edge.kind === "dependency" &&
      visible.has(edge.source) &&
      visible.has(edge.target),
  );
  const impacts = new Set(
    model.rows
      .filter((row) =>
        model.captured.entities.some((entity) => entity.id === row.entityId),
      )
      .map((row) => row.entityId),
  );
  return (
    <>
      <div className="cc-map-frame">
        <svg
          className="cc-schematic"
          viewBox="50 35 880 670"
          role="img"
          aria-label="Infrastructure schematic; positions are illustrative, not incident locations"
        >
          <path className="cc-state-outline" d={TEXAS_PATH} />
          {edges.map((edge) => {
            const from = positions.get(edge.source),
              to = positions.get(edge.target);
            return from && to ? (
              <line
                key={edge.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="cc-map-edge"
              >
                <title>{`${edge.label} · reference dependency`}</title>
              </line>
            ) : null;
          })}
          {nodes.map((entity) => {
            const position = positions.get(entity.id);
            if (!position) return null;
            const affected = impacts.has(entity.id),
              context = selected?.contextSnapshot.provider?.id === entity.id;
            return (
              <g
                key={entity.id}
                className={
                  affected
                    ? "cc-map-node modeled"
                    : context
                      ? "cc-map-node context"
                      : "cc-map-node"
                }
              >
                <title>{`${displayText(entity.label)} · ${affected ? "captured modeled result, not observed outage" : context ? "captured case context, not confirmed outage" : "reference infrastructure; operational status not established"}`}</title>
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={affected || context ? 10 : 6}
                />
                <text x={position.x + 13} y={position.y + 4}>
                  {displayText(entity.label)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="command-muted">
        Schematic topology, not deployment locations or service boundaries.
        Orange: captured modeled results. Blue: selected case context. Gray:
        reference infrastructure, not a normal-status assertion.
      </p>
      <a
        className="command-link"
        href={TEXAS_BOUNDARY_SOURCE}
        target="_blank"
        rel="noreferrer"
      >
        Texas boundary source
      </a>
    </>
  );
}
function ConsequenceNetwork({ model }: { model: ConsequenceModel }) {
  const [sector, setSector] = useState<string | null>(null);
  const [asset, setAsset] = useState<string | null>(null);
  const group = model.groups.find((item) => item.key === sector);
  const rows = group?.items ?? model.rows;
  const row = rows.find((item) => item.id === asset) ?? rows[0];
  const count = model.groups.length;
  return (
    <>
      <div className="cc-network-layout">
        <Panel
          title={group ? group.label : "Captured Dependency Network"}
          note="Modeled · not observed outages"
        >
          {group && (
            <button
              className="command-link"
              onClick={() => {
                setSector(null);
                setAsset(null);
              }}
            >
              ← All sectors
            </button>
          )}
          {!group && (
            <>
              <div className="cc-network-graphic">
                <svg
                  viewBox="0 0 640 360"
                  role="img"
                  aria-label="Captured source linked to modeled impact groups"
                >
                  {model.groups.map((item, i) => {
                    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
                    const x = 320 + Math.cos(angle) * 225,
                      y = 180 + Math.sin(angle) * 120;
                    const radius = 18 + Math.sqrt(item.count) * 6;
                    const services = [
                      ...new Set(
                        item.items.flatMap((impact) =>
                          impact.dependencies.map((dependency) =>
                            words(dependency.requiredService),
                          ),
                        ),
                      ),
                    ];
                    return (
                      <g
                        key={item.key}
                        role="button"
                        tabIndex={0}
                        aria-label={`Show ${item.label}: ${item.count} facilities`}
                        onClick={() => {
                          setSector(item.key);
                          setAsset(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSector(item.key);
                            setAsset(null);
                          }
                        }}
                      >
                        <line x1="320" y1="180" x2={x} y2={y} />
                        <circle cx={x} cy={y} r={radius} />
                        <text x={x} y={y + 5} textAnchor="middle">
                          {item.count}
                        </text>
                        <title>{`${item.label}: ${item.count} modeled facilities · ${services.join(", ") || "Dependency labels not captured"}`}</title>
                      </g>
                    );
                  })}
                  <circle
                    cx="320"
                    cy="180"
                    r="38"
                    className="cc-network-source"
                  />
                  <text x="320" y="245" textAnchor="middle">
                    {displayText(model.sourceLabel)}
                  </text>
                </svg>
              </div>
              <p className="command-muted">
                Circle size: unique facilities with modeled results. Select a
                sector below to drill down. Classification gaps remain explicit.
              </p>
              <div className="cc-sector-buttons">
                {model.groups.map((item) => (
                  <button
                    key={item.key}
                    className="cc-sector-button"
                    onClick={() => {
                      setSector(item.key);
                      setAsset(null);
                    }}
                  >
                    <strong>{item.label}</strong>
                    <span>
                      {item.count} facilities · {planningWindow(item.earliest)}
                    </span>
                    <small>
                      {[
                        ...new Set(
                          item.items.flatMap((impact) =>
                            impact.dependencies.map((dependency) =>
                              words(dependency.requiredService),
                            ),
                          ),
                        ),
                      ].join(" · ") || "Dependency labels not captured"}
                    </small>
                  </button>
                ))}
              </div>
            </>
          )}
          {group && (
            <ul className="command-record-list">
              {rows.map((item) => (
                <li key={item.id}>
                  <button
                    className="command-link"
                    onClick={() => setAsset(item.id)}
                    aria-pressed={row?.id === item.id}
                  >
                    {displayText(item.label)} ·{" "}
                    {displayText(item.functionLabel)}
                  </button>
                  <small>
                    {words(item.state)} · {planningWindow(item.windowHours)} ·
                    modeled
                  </small>
                </li>
              ))}
            </ul>
          )}
          {!model.rows.length && (
            <Empty>No modeled impacts in this captured run.</Empty>
          )}
        </Panel>
        <Panel title="Why It's at Risk">
          {row ? (
            <>
              <h3>{displayText(row.label)}</h3>
              <p>{row.classification.lineage}</p>
              <dl className="cc-facts">
                <dt>Modeled state</dt>
                <dd>{words(row.state)}</dd>
                <dt>Window</dt>
                <dd>{planningWindow(row.windowHours)}</dd>
                <dt>Reserve</dt>
                <dd>
                  {row.dependencies.length
                    ? [
                        ...new Set(
                          row.dependencies.map((dependency) =>
                            dependency.usableBackupMinHours === null ||
                            dependency.usableBackupMaxHours === null
                              ? "Unknown captured reserve"
                              : `${dependency.usableBackupMinHours}–${dependency.usableBackupMaxHours} hours`,
                          ),
                        ),
                      ].join("; ")
                    : "No dependency reserve captured"}
                </dd>
                <dt>Path</dt>
                <dd>
                  {row.chains.flat().map(displayText).join(" → ") ||
                    "Path labels not captured"}
                </dd>
              </dl>
              <h4>Captured assumptions</h4>
              <ul>
                {row.assumptions.map((assumption, i) => (
                  <li key={i}>{displayText(assumption)}</li>
                ))}
              </ul>
              <Sources refs={row.sourceRefs} sources={model.captured.sources} />
            </>
          ) : (
            <Empty>No modeled result to inspect.</Empty>
          )}
        </Panel>
      </div>
      <Panel
        title="Who Runs Out First"
        note="Scenario-relative planning intervals, not live countdowns"
      >
        <ImpactList model={model} />
      </Panel>
      <Panel title="By Sector">
        <div className="command-table-wrap">
          <table className="command-table">
            <thead>
              <tr>
                <th scope="col">Captured classification</th>
                <th scope="col">Facilities in results</th>
                <th scope="col">Earliest window</th>
              </tr>
            </thead>
            <tbody>
              {model.groups.map((item) => (
                <tr key={item.key}>
                  <td>
                    <button
                      className="command-link"
                      onClick={() => {
                        setSector(item.key);
                        setAsset(null);
                      }}
                    >
                      {item.label}
                    </button>
                  </td>
                  <td>{item.count}</td>
                  <td>{planningWindow(item.earliest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="command-muted">
          Consequence model: {model.run?.modelVersion} · Captured{" "}
          {timeLabel(model.run?.createdAt)} · Baseline revision{" "}
          {model.run?.baselineRevision}
        </p>
        {!!model.run?.warnings.length && (
          <p className="cc-notice">
            Needs model review:{" "}
            {model.run.warnings
              .map((warning) =>
                typeof warning === "string" ? warning : JSON.stringify(warning),
              )
              .join("; ")}
          </p>
        )}
        <p className="command-muted">
          {model.run?.excluded.length} excluded path records remain excluded; a
          facility absent from results is not asserted unaffected.
        </p>
      </Panel>
    </>
  );
}

function DraftExports({ incident }: { incident: CommandIncident }) {
  return (
    <div className="cc-actions">
      {["Brief for the Governor's office", "SITREP for TDEM"].map(
        (title, i) => (
          <a
            className="button"
            key={title}
            href={`data:text/markdown;charset=utf-8,${encodeURIComponent(formattedBrief(incident, title))}`}
            download={i === 0 ? "leadership-brief-draft.md" : "sitrep-draft.md"}
          >
            {title} · draft
          </a>
        ),
      )}
    </div>
  );
}

export default function CommandCenterViews({
  data,
  incidents,
  selected,
  view,
  onSelect,
  onOpenAnalyst,
  onNavigate,
}: CommandCenterViewsProps) {
  const overview = overviewModel(incidents);
  const model = consequenceModel(selected);
  // Parent selection is authoritative: a locally pinned case must never
  // disagree with the incident picker or its full-record action.
  const selectedId = selected?.id ?? null;
  const [summaryState, setSummaryState] = useState({
    selectedId,
    closed: false,
  });
  const selectionChanged = summaryState.selectedId !== selectedId;
  if (selectionChanged) setSummaryState({ selectedId, closed: false });
  const summary = selectionChanged || !summaryState.closed ? selected : null;
  const openSummary = (id: string) => {
    setSummaryState({ selectedId: id, closed: false });
    onSelect(id);
  };
  const openCase = (incident: CommandIncident) =>
    onOpenAnalyst("case-file" as CommandView, incident.id);
  const heading = headings[view];
  if (!heading)
    return (
      <div className="command-center-views">
        <Empty>This is not a Command Center screen.</Empty>
      </div>
    );
  let content: ReactNode;
  if (view === "command") {
    content = (
      <>
        <Metrics
          values={[
            [
              overview.metrics.activeIncidents,
              "Active incidents",
              "Saved open and monitoring cases",
            ],
            [
              overview.classifiedSectors || "Not captured",
              "IDT sectors in modeled results",
              overview.unclassifiedImpacts
                ? "Some captured impacts lack IDT classification"
                : "Captured run classification only",
            ],
            [
              overview.people ?? "Not captured",
              "People in modeled service areas",
              "Inventory population, not confirmed outage exposure",
            ],
            [
              overview.metrics.pendingDecisions,
              "Advisory reviews waiting",
              "Chief decisions are not supplied",
            ],
          ]}
        />
        <div className="cc-two-columns">
          <Panel title="Statewide Picture">
            <InfrastructureSchematic data={data} selected={selected} />
          </Panel>
          <Panel title="Reviews Waiting">
            {overview.pending.map(({ incident, decision }) => (
              <article
                className="cc-list-card"
                key={`${incident.id}:${decision.id}`}
              >
                <button
                  className="command-link"
                  onClick={() => openSummary(incident.id)}
                >
                  {incident.title}
                </button>
                <p>{decision.title}</p>
                <small>
                  {planningWindow(decision.windowHours)} · advisory, not
                  approval
                </small>
              </article>
            ))}
            {!overview.pending.length && (
              <Empty>No pending advisory reviews in active cases.</Empty>
            )}
          </Panel>
        </div>
        <Panel
          title="Saved Incident Register"
          note="Source alerts are not outage declarations"
        >
          <CaseRegister incidents={incidents} onSummary={openSummary} />
        </Panel>
        <div className="cc-two-columns">
          <Panel title="Facilities in Modeled Results">
            {overview.facilities.map((row) => (
              <article className="cc-list-card" key={`${row.caseId}:${row.id}`}>
                <strong>{displayText(row.label)}</strong>
                <p>
                  {planningWindow(row.windowHours)} · modeled {words(row.state)}
                </p>
                <button
                  className="command-link"
                  onClick={() => openSummary(row.caseId)}
                >
                  {row.caseTitle}
                </button>
              </article>
            ))}
            {!overview.facilities.length && (
              <Empty>
                No captured modeled facility results in active cases.
              </Empty>
            )}
          </Panel>
          <Panel title="From the Analysts" note="Recorded case activity">
            {overview.activity.slice(0, 12).map((item) => (
              <article
                className="cc-list-card"
                key={`${item.caseId}:${item.id}`}
              >
                <small>{timeLabel(item.createdAt)}</small>
                <p>{item.message}</p>
                <button
                  className="command-link"
                  onClick={() => openSummary(item.caseId)}
                >
                  {item.caseTitle}
                </button>
              </article>
            ))}
            {!overview.activity.length && (
              <Empty>No analyst activity recorded.</Empty>
            )}
            {overview.activity.length > 12 && (
              <p className="command-muted">
                Showing the latest 12 of {overview.activity.length} activity
                records. Full activity is available in each case file.
              </p>
            )}
          </Panel>
        </div>
      </>
    );
  } else if (view === "cop") {
    content = (
      <>
        <div className="cc-case-buttons" aria-label="Saved incidents">
          {orderIncidents(incidents).map((incident) => (
            <button
              className="cc-sector-button"
              key={incident.id}
              aria-pressed={selected?.id === incident.id}
              onClick={() => onSelect(incident.id)}
            >
              {incident.title}
              <small>
                {words(incident.priority)} · {words(incident.status)} tracking
              </small>
            </button>
          ))}
        </div>
        <div className="cc-two-columns">
          <Panel title="Infrastructure Schematic">
            <InfrastructureSchematic data={data} selected={selected} />
          </Panel>
          <Panel title="Selected Incident">
            {selected ? (
              <>
                <h3>{selected.title}</h3>
                <p>
                  {words(selected.priority)} · {words(selected.status)} tracking
                </p>
                <p>
                  {contextChain(selected)
                    .filter(
                      (entity) =>
                        !/Cyber|PhysicalITAsset|PhysicalOTAsset/.test(
                          entity.type,
                        ),
                    )
                    .map((entity) => displayText(entity.label))
                    .join(" → ") || "Infrastructure linkage not established"}
                </p>
                <ImpactList model={model} />
                <button
                  className="button primary"
                  onClick={() => openCase(selected)}
                >
                  Open in Analyst
                </button>
              </>
            ) : (
              <Empty>
                Select a saved case to inspect its captured footprint.
              </Empty>
            )}
          </Panel>
        </div>
      </>
    );
  } else if (view === "cyber") {
    const timeline = eventTimeline(data, selected);
    content = (
      <>
        <Panel
          title="Recorded Event Timeline"
          note="CTIC · source observations, not outage or attribution judgments"
        >
          <p className="command-muted">
            All supplied event records are shown. The selected case's captured
            event is marked; other events are not automatically linked to that
            case.
          </p>
          <ol className="cc-event-timeline">
            {timeline.map((item) => (
              <li
                key={item.event.id}
                className={item.captured ? "captured" : ""}
              >
                <small>
                  {item.time} · {item.origin}
                  {item.stream ? ` · ${words(item.stream)} records` : ""}
                </small>
                <h3>
                  {displayText(item.label)}
                  {item.captured && (
                    <span className="cc-tag">Captured case event</span>
                  )}
                </h3>
                <p>{displayText(item.description)}</p>
                {item.techniques.length > 0 && (
                  <p>Recorded techniques: {item.techniques.join(" · ")}</p>
                )}
                <Sources
                  refs={item.event.sourceRefs ?? []}
                  sources={
                    item.captured ? model.captured.sources : data.sources
                  }
                />
              </li>
            ))}
          </ol>
          {!timeline.length && <Empty>No event records supplied.</Empty>}
        </Panel>
        <div className="cc-two-columns">
          <Panel title="Recorded Assessments">
            {data.assessments.map((assessment, i) => (
              <article
                className="cc-list-card"
                key={sourceText(assessment.id) ?? i}
              >
                <h3>
                  {sourceText(assessment.label) ??
                    sourceText(assessment.title) ??
                    "Assessment record"}
                </h3>
                <p>
                  {sourceText(assessment.description) ??
                    sourceText(assessment.finding) ??
                    "No assessment narrative recorded"}
                </p>
                <small>
                  Origin: {originLabel(assessment)} ·{" "}
                  {timeLabel(assessment.timestamp)}
                </small>
                <Sources
                  refs={strings(assessment.sourceRefs)}
                  sources={data.sources}
                />
              </article>
            ))}
            {!data.assessments.length && (
              <Empty>No assessment records supplied.</Empty>
            )}
          </Panel>
          <Panel title="Attack Picture Coverage">
            <p>
              Actor attribution, analyst confidence, compromise-status records,
              ATT&CK stage judgments and active-hunt statuses are not supplied
              by the current case contract.
            </p>
            <p>
              No attack-stage duration or vendor exposure count is inferred from
              unrelated observations. A source observation alone does not
              establish a physical outage.
            </p>
            {selected && (
              <button
                className="command-link"
                onClick={() => onOpenAnalyst("cyber", selected.id)}
              >
                Open in Analyst
              </button>
            )}
          </Panel>
        </div>
      </>
    );
  } else if (view === "consequence") {
    content = model.run ? (
      <>
        <Metrics
          values={[
            [
              model.people ?? "Not captured",
              "People in modeled service areas",
              "Captured population, not observed exposure",
            ],
            [
              model.facilities,
              "Facilities in modeled results",
              "Not observed outages",
            ],
            [
              planningWindow(model.earliest),
              "Earliest planning window",
              "Relative to the scenario",
            ],
            [
              model.groups.length,
              "Captured result groups",
              "IDT gaps remain explicit",
            ],
          ]}
        />
        <ConsequenceNetwork key={model.run.id} model={model} />
      </>
    ) : (
      <Panel title="Captured Consequences">
        <Empty>
          {selected
            ? "No captured consequence run for this case. Run analysis in Analyst; no current-baseline results are substituted."
            : "Select a saved case with a captured consequence run."}
        </Empty>
        {selected && (
          <button
            className="command-link"
            onClick={() => onOpenAnalyst("consequence", selected.id)}
          >
            Open in Analyst
          </button>
        )}
      </Panel>
    );
  } else if (view === "uctf") {
    const tasks = recordedTasks(incidents);
    content = (
      <>
        <Metrics
          values={[
            [
              tasks.length,
              "Recorded response tasks",
              "Across saved cases, including closed",
            ],
            [
              tasks.filter((task) => task.completed).length,
              "Recorded complete",
              "Not confirmed dispatch or recovery",
            ],
            [
              tasks.filter((task) => !task.completed).length,
              "Recorded incomplete",
              "No due dates supplied",
            ],
          ]}
        />
        <Panel title="Deployment Coverage" note="UCTF">
          <p>
            Team, deployment, staffing, location, en-route, forensics/testing
            and response-clock target records are not supplied. No deployment
            map, team count or response-clock status can be established from
            task completion.
          </p>
        </Panel>
        <Panel title="Recorded Response Tasks">
          {tasks.length ? (
            <div className="command-table-wrap">
              <table className="command-table">
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Case</th>
                    <th scope="col">Recorded state</th>
                    <th scope="col">Completed at</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={`${task.caseId}:${task.id}`}>
                      <td>{task.label}</td>
                      <td>
                        <button
                          className="command-link"
                          onClick={() => {
                            onSelect(task.caseId);
                            onOpenAnalyst("uctf", task.caseId);
                          }}
                        >
                          {task.caseTitle}
                        </button>
                        <small>{words(task.caseStatus)} tracking</small>
                      </td>
                      <td>
                        {task.completed
                          ? "Recorded complete"
                          : "Recorded incomplete"}
                      </td>
                      <td>
                        {task.completed
                          ? timeLabel(task.completedAt)
                          : "Not recorded complete"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No response tasks recorded.</Empty>
          )}
        </Panel>
      </>
    );
  } else if (view === "leadership") {
    const draft = selected ? leadershipDraft(selected) : null;
    content = (
      <>
        {selected && draft ? (
          <>
            <DraftExports incident={selected} />
            <Panel title="What Happened">
              <h3>{draft.event}</h3>
              <p>{displayText(draft.description)}</p>
              <p className="command-muted">
                Captured event origin: {draft.origin}
              </p>
              <Sources
                refs={draft.sourceRefs}
                sources={model.captured.sources}
              />
            </Panel>
            <Panel title="So What">
              <ImpactList model={model} />
              <button
                className="command-link"
                onClick={() => onNavigate("consequence")}
              >
                See Consequences →
              </button>
            </Panel>
            <Panel
              title="What Can We Do"
              note="Recorded next steps, not dispatch instructions"
            >
              <ul className="command-record-list">
                {draft.reviews.map((review, i) => (
                  <li key={`review:${i}`}>{review}</li>
                ))}
                {draft.tasks.map((task, i) => (
                  <li key={`task:${i}`}>{task}</li>
                ))}
              </ul>
              {!draft.tasks.length && !draft.reviews.length && (
                <Empty>No next-step records captured.</Empty>
              )}
              <p className="command-muted">
                Chief response-option decisions and approved reference options
                are not supplied. Advisory reviews do not constitute Chief
                decisions; authority is not configured and policy gates are not
                evaluated.
              </p>
              <button
                className="command-link"
                onClick={() => openCase(selected)}
              >
                Open in Analyst
              </button>
            </Panel>
            <Panel title="Recorded Review and Analysis Trail">
              {recordedActivity([selected])
                .filter((item) => /review|analy|decision/.test(item.kind))
                .map((item) => (
                  <p key={item.id}>
                    {item.message}
                    <small className="cc-block">
                      {timeLabel(item.createdAt)}
                    </small>
                  </p>
                ))}
              {!selected.activity.some((item) =>
                /review|analy|decision/.test(item.kind),
              ) && <Empty>No review or analysis activity recorded.</Empty>}
              <p className="command-muted">
                Case activity, not a certified audit system or Chief decision
                record.
              </p>
            </Panel>
          </>
        ) : (
          <Panel title="Leadership Draft">
            <Empty>
              Select a saved case to prepare its formatted draft. Nothing is
              sent.
            </Empty>
          </Panel>
        )}
        <Metrics
          values={[
            [
              overview.metrics.activeIncidents,
              "Active cases",
              "Saved casework",
            ],
            [
              overview.metrics.closedIncidents,
              "Closed cases",
              "Tracking only, not confirmed recovery",
            ],
            [
              overview.metrics.pendingDecisions,
              "Advisory reviews waiting",
              "Active cases",
            ],
            [
              overview.metrics.firstReviewMedianSeconds === null
                ? "Not recorded"
                : `${overview.metrics.firstReviewMedianSeconds} seconds`,
              "Case opened → first review",
              "Median of recorded advisory review timestamps",
            ],
          ]}
        />
        <p className="command-muted">
          Official TXCC performance measures (detection, mitigation and
          dissemination) are not populated.
        </p>
        <Panel
          title="Cases Behind This Brief"
          note="Includes closed cases · opens read-only summary"
        >
          <CaseRegister incidents={incidents} onSummary={openSummary} />
        </Panel>
      </>
    );
  } else {
    content = (
      <>
        <Panel title="Who We Need, and Where We Are">
          <p>
            Contact-status and partner-role records are not supplied. Need to
            act / Need to know / Helping us group counts cannot be established
            from coordination notes.
          </p>
          <p className="command-muted">
            Status must be recorded by analysts. CITRIDE does not send
            notifications. Saved notes do not establish that a partner was
            contacted or engaged.
          </p>
        </Panel>
        <Panel
          title="What Each Partner and Stakeholder Can See"
          note="Draft audience previews · not sent"
        >
          {selected ? (
            <div className="cc-audiences">
              {previewAudiences.map((audience) => {
                const preview = audiencePreview(audience, selected);
                return (
                  <article className="cc-list-card" key={audience}>
                    <h3>{preview.title}</h3>
                    <small>{preview.status}</small>
                    <h4>Shows</h4>
                    <ul>
                      {preview.shows.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                    <h4>Not shown</h4>
                    <ul>
                      {preview.notShown.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <p className="command-muted">{preview.boundary}</p>
                    <a
                      className="command-link"
                      download={`audience-${audience}-draft.md`}
                      href={`data:text/markdown;charset=utf-8,${encodeURIComponent([`# ${preview.title}`, preview.status, "## Shows", ...preview.shows, "## Not shown", ...preview.notShown, preview.boundary].join("\n\n"))}`}
                    >
                      Download audience draft
                    </a>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty>Select a saved case for audience previews.</Empty>
          )}
        </Panel>
      </>
    );
  }
  return (
    <div className="command-center-views">
      <header className="cc-page-heading">
        <p>
          {heading[0]} · Read-only display
          {view === "cyber"
            ? " · CTIC"
            : view === "uctf"
              ? " · UCTF"
              : view === "leadership"
                ? " · Chief"
                : ""}
        </p>
        <h2>{heading[1]}</h2>
        {selected && <p>{selected.title}</p>}
      </header>
      {content}
      {summary && (view === "command" || view === "leadership") && (
        <CaseSummary
          incident={summary}
          onOpen={() => openCase(summary)}
          onClose={() => {
            setSummaryState({ selectedId, closed: true });
          }}
        />
      )}
    </div>
  );
}

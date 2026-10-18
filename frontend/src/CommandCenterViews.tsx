import { StatusChip } from "./visualPrimitives.ts";
import { VisualCard } from "./visualPrimitives.ts";
import { SummaryTile } from "./visualPrimitives.ts";
import DependencyNetwork from "./components/DependencyNetwork.tsx";
import { boilWaterLabel } from "./statewideFootprint.ts";
import { useState, type ReactNode } from "react";
import type { Bootstrap, Run, Source } from "./types.ts";
import { exposureAvoided, exposureDollars } from "./exposure.ts";
import type { CommandIncident, CommandView } from "./commandTypes.ts";
import { orderIncidents } from "./commandMetrics.ts";
import { displayText } from "./presentation.ts";
import { activityDisplayText } from "./caseFilePresentation.ts";
import CommandInfrastructureMap from "./CommandInfrastructureMap.tsx";
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
import { eventSourceChips } from "./networkEvidence.ts";
import ScriptedCommandViews from "./ScriptedCommandViews.tsx";
import IncidentView from "./IncidentView.tsx";
import ConsequencesView from "./ConsequencesView.tsx";
import type { RecordsState, ReferenceData } from "./scriptedTypes.ts";

export interface CommandCenterViewsProps {
  records?: RecordsState;
  reference?: ReferenceData;
  /** Session-only what-if result; the owning workspace keeps it scoped to the case. */
  lastPlanningRun?: Run | null;
  data: Bootstrap;
  incidents: CommandIncident[];
  selected: CommandIncident | null;
  selectedEntityId?: string | null;
  onSelectEntity?: (id: string | null) => void;
  view: CommandView;
  onSelect: (id: string) => void;
  onClearSelection?: () => void;
  onOpenAnalyst: (
    view: CommandView,
    caseId?: string | null,
    entityId?: string | null,
  ) => void;
  onNavigate: (view: CommandView) => void;
}

const headings: Partial<Record<CommandView, [string, string]>> = {
  command: ["C1", "Command Overview"],
  cop: ["C2", "Incident View"],
  cyber: ["C3", "Attack Picture CTIC"],
  consequence: ["C4", "Consequences"],
  uctf: ["C5", "Response Teams UCTF"],
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
    <VisualCard className="command-panel cc-panel">
      <div className="command-panel-heading">
        <h2>{title}</h2>
        {note && <span>{note}</span>}
      </div>
      {children}
    </VisualCard>
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
        <SummaryTile className="command-metric" key={label}>
          <strong>
            {typeof value === "number" ? value.toLocaleString("en-US") : value}
          </strong>
          <span>{label}</span>
          <small>{note}</small>
        </SummaryTile>
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
      {!model.rows.length && <li>No modeled impacts.</li>}
    </ul>
  ) : (
    <Empty>No analysis recorded.</Empty>
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
                <StatusChip
                  status={incident.priority}
                  className={`command-priority ${incident.priority}`}
                >
                  {words(incident.priority)}
                </StatusChip>
              </td>
              <td>
                <StatusChip status={incident.status}>
                  {words(incident.status)}
                </StatusChip>
                <small>Case tracking only</small>
              </td>
              <td>
                {
                  incident.decisions.filter((decision) => decision.reviewed)
                    .length
                }{" "}
                / {incident.decisions.length} impact reviews
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
    <Empty>No saved cases.</Empty>
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
      <h4>Captured impacts · Modeled · not observed outages</h4>
      <ImpactList model={model} />
      <h4>Recorded progress</h4>
      <p>
        {incident.decisions.filter((decision) => decision.reviewed).length} of{" "}
        {incident.decisions.length} impact reviews ·{" "}
        {incident.tasks.filter((task) => task.completed).length} of{" "}
        {incident.tasks.length} tasks recorded complete
      </p>
      <p className="command-muted">Advisory, not approvals</p>
      <h4>Latest activity</h4>
      {recordedActivity([incident])
        .slice(0, 3)
        .map((item) => (
          <p key={item.id}>
            {activityDisplayText(item.message)}
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
            {title} · Draft · not sent
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
  selectedEntityId,
  onSelectEntity,
  view,
  onSelect,
  onClearSelection,
  onOpenAnalyst,
  onNavigate,
  records,
  reference,
  lastPlanningRun,
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
  if (view === "cop" && records && reference) return <IncidentView data={data} incidents={incidents} selected={selected} records={records} reference={reference} view={view} selectedEntityId={selectedEntityId} onSelect={onSelect} onClearSelection={onClearSelection} onSelectEntity={onSelectEntity} onOpenAnalyst={onOpenAnalyst} onNavigate={onNavigate} />;
  let content: ReactNode;
  const scripted =
    records &&
    reference &&
    ["command", "cop", "cyber", "uctf", "leadership", "federation"].includes(
      view,
    ) ? (
      <ScriptedCommandViews
        data={data}
        incidents={incidents}
        selected={selected}
        view={view}
        records={records}
        reference={reference}
        onSelect={onSelect}
        onClearSelection={onClearSelection}
        onOpenAnalyst={onOpenAnalyst}
        onNavigate={onNavigate}
        onSelectEntity={onSelectEntity}
      />
    ) : null;
  if (scripted && view !== "cop") return scripted;
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
                : "Analysis classification",
            ],
            [
              overview.people ?? "Not captured",
              "People in modeled service areas",
              "Modeled · not observed outages",
            ],
            [
              overview.metrics.pendingDecisions,
              "Impact reviews waiting",
              "Advisory, not approvals",
            ],
          ]}
        />
        <div className="cc-map-dashboard">
          <Panel title="Statewide Picture">
            <CommandInfrastructureMap
              key={selected?.id ?? "all"}
              data={data}
              incidents={incidents}
              selected={selected}
              selectedEntityId={selectedEntityId}
              onSelectEntity={onSelectEntity}
              onOpenEntity={(id, caseId) =>
                onOpenAnalyst(
                  data.entities.some((entity) => entity.id === id)
                    ? "entity-profile"
                    : "case-file",
                  caseId,
                  id,
                )
              }
              onSelectCase={openSummary}
            />
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
                  {planningWindow(decision.windowHours)} · Advisory, not
                  approvals
                </small>
              </article>
            ))}
            {!overview.pending.length && (
              <Empty>No pending impact reviews in active cases.</Empty>
            )}
          </Panel>
        </div>
        <Panel title="Saved Incident Register" note="Saved cases">
          <CaseRegister incidents={incidents} onSummary={openSummary} />
        </Panel>
        <div className="cc-two-columns">
          <Panel
            title="Facilities in Modeled Results"
            note="Modeled · not observed outages"
          >
            {overview.facilities.map((row) => (
              <article className="cc-list-card" key={`${row.caseId}:${row.id}`}>
                <strong>{displayText(row.label)}</strong>
                <small>{row.classification.label}</small>
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
                <p>{activityDisplayText(item.message)}</p>
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
    const infrastructure = (
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
        <div className="cc-map-dashboard">
          <Panel title="Infrastructure Schematic">
            <CommandInfrastructureMap
              key={selected?.id ?? "all"}
              data={data}
              incidents={incidents}
              selected={selected}
              selectedEntityId={selectedEntityId}
              onSelectEntity={onSelectEntity}
              onOpenEntity={(id, caseId) =>
                onOpenAnalyst(
                  data.entities.some((entity) => entity.id === id)
                    ? "entity-profile"
                    : "case-file",
                  caseId,
                  id,
                )
              }
              onSelectCase={openSummary}
            />
          </Panel>
          <Panel
            title="Selected Incident"
            note="Modeled · not observed outages"
          >
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
    content = (
      <>
        {scripted}
        {scripted ? (
          <details>
            <summary>Advanced · infrastructure inventory</summary>
            {infrastructure}
          </details>
        ) : (
          infrastructure
        )}
      </>
    );
  } else if (view === "cyber") {
    const timeline = eventTimeline(data, selected);
    content = (
      <>
        <Panel title="Recorded Event Timeline" note="CTIC analyst assessment">
          <p>Network · Corelight format (simulated)</p>

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
            <p>No additional attack assessments recorded.</p>
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
    const notice = boilWaterLabel(model.run, model.captured.entities, reference ?? null);
    const candidate = model.run && lastPlanningRun && selected &&
      model.run.baselineSnapshot != null && lastPlanningRun.baselineSnapshot != null &&
      model.run.baselineRevision === lastPlanningRun.baselineRevision &&
      model.run.modelVersion === lastPlanningRun.modelVersion &&
      JSON.stringify(model.run.baselineSnapshot) === JSON.stringify(lastPlanningRun.baselineSnapshot) &&
      (lastPlanningRun.request.expectedBaselineRevision === undefined ||
        lastPlanningRun.request.expectedBaselineRevision === model.run.baselineRevision) &&
      lastPlanningRun.scenarioId === lastPlanningRun.request.scenarioId &&
      lastPlanningRun.request.overrides.length === 1 &&
      lastPlanningRun.request.overrides.every((override) =>
        override.note === `What-if from case ${selected.title}` &&
        typeof override.backupMinHours === "number" && Number.isFinite(override.backupMinHours) &&
        override.backupMinHours >= 0 && override.backupMinHours === override.backupMaxHours &&
        model.rows.some((row) => row.dependencies.some((dependency) =>
          dependency.id === override.dependencyId && dependency.requiredService === "treated_water")),
      ) ? lastPlanningRun : null;
    const avoided = model.run && candidate
      ? exposureAvoided(model.run, candidate, reference?.planningRates ?? [], reference?.referenceVersion)
      : null;
    content = model.run ? (
      <div className="cc-consequence-wall">
        <section className="cc-consequence-totals" aria-label="Totals">
          <SummaryTile className="command-metric">
            <strong>{model.people?.toLocaleString("en-US") ?? "Not captured"}</strong>
            <span>People in affected water service</span>
          </SummaryTile>
          <SummaryTile className="command-metric">
            <strong>{model.facilities}</strong><span>Critical facilities at risk</span>
          </SummaryTile>
          <SummaryTile className="command-metric cc-metric-red">
            <strong>{planningWindow(model.earliest)}</strong>
            <span>Earliest window{model.rows.find((row) => row.windowHours)?.label
              ? ` · ${displayText(model.rows.find((row) => row.windowHours)!.label)}` : ""}</span>
          </SummaryTile>
          <SummaryTile className="command-metric cc-metric-amber">
            <strong>{notice ? "Possible" : "Not indicated"}</strong>
            <span>Boil-water notice</span><small>{notice ?? "No matching reference rule for this run"}</small>
          </SummaryTile>
        </section>
        {avoided && !("incomparable" in avoided) && (
          <SummaryTile className="command-metric cc-metric-green">
            <strong>{avoided.serviceHours[0]}–{avoided.serviceHours[1]} service-hours</strong>
            <span>Modeled consequence avoided</span>
            <small>{exposureDollars(avoided.costUsd)} · matching what-if · not observed savings</small>
          </SummaryTile>
        )}
        <DependencyNetwork
          key={model.run.id}
          model={model}
          mode="display"
          boilWaterLabel={notice}
        />
      </div>
    ) : (
      <Panel title="Captured Consequences">
        <Empty>
          {selected
            ? "No captured consequence run for this case."
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
              "Saved tasks",
            ],
            [
              tasks.filter((task) => !task.completed).length,
              "Recorded incomplete",
              "Due dates unknown",
            ],
          ]}
        />
        <Panel title="Deployment Coverage" note="UCTF">
          <p>No teams deployed for this incident.</p>
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
            <Panel
              title="Available evidence sources"
              note="Event source provenance"
            >
              <div className="cc-sources">
                {[
                  ...new Set(
                    [
                      ...data.events.filter(
                        (event) => event.id !== selected.eventId,
                      ),
                      selected.eventSnapshot,
                    ].flatMap(eventSourceChips),
                  ),
                ].map((label) => (
                  <span className="cc-tag" key={label}>
                    {label}
                  </span>
                ))}
              </div>
            </Panel>
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
            <Panel title="So What" note="Modeled · not observed outages">
              <ImpactList model={model} />
              <button
                className="command-link"
                onClick={() => onNavigate("consequence")}
              >
                See Consequences →
              </button>
            </Panel>
            <Panel title="What Can We Do" note="Advisory, not approvals">
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
                    {activityDisplayText(item.message)}
                    <small className="cc-block">
                      {timeLabel(item.createdAt)}
                    </small>
                  </p>
                ))}
              {!selected.activity.some((item) =>
                /review|analy|decision/.test(item.kind),
              ) && <Empty>No review or analysis activity recorded.</Empty>}
            </Panel>
          </>
        ) : (
          <Panel title="Leadership Draft">
            <Empty>Select a saved case to prepare its draft.</Empty>
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
              "Saved casework",
            ],
            [
              overview.metrics.pendingDecisions,
              "Impact reviews waiting",
              "Active cases",
            ],
            [
              overview.metrics.firstReviewMedianSeconds === null
                ? "Not recorded"
                : `${overview.metrics.firstReviewMedianSeconds} seconds`,
              "Case opened → first review",
              "Median of recorded impact review timestamps",
            ],
          ]}
        />
        <p className="command-muted">
          No approve or dispatch buttons here. The duty officer records the
          Chief's decision in the Analyst workspace.
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
          <p>No partner coordination records.</p>
          <p className="command-muted">CITRIDE does not send notifications</p>
        </Panel>
        <Panel
          title="What Each Partner and Stakeholder Can See"
          note="Audience previews"
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
  if (view === "consequence" && typeof window !== "undefined") {
    const linkedIncident = selected ? records?.statewideIncidents.find((incident) => incident.caseId === selected.id)
      ?? records?.statewideIncidents.find((incident) => !incident.caseId && incident.linkedEventIds?.includes(selected.eventId)) : null;
    const publicIncidentId = linkedIncident?.id ?? selected?.id;
    return <ConsequencesView key={publicIncidentId} selectedId={publicIncidentId} onSelect={onSelect} onOpenAnalyst={onOpenAnalyst} onNavigate={onNavigate} captured={content} />;
  }
  return (
    <div
      className="command-center-views"
      aria-label={`${heading[0]} ${heading[1]}`}
    >
      {!records && !scripted && (
        <header className="cc-page-heading">
          <p>
            {heading[0]} · Read-only display
            {view === "cyber" ? " · CTIC" : view === "uctf" ? " · UCTF" : ""}
          </p>

          {selected && <p>{selected.title}</p>}
        </header>
      )}
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

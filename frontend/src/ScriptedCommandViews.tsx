import { useState, type ReactNode } from "react";
import { activityDisplayText } from "./caseFilePresentation.ts";
import type { CommandView } from "./commandTypes.ts";
import {
  object,
  text,
  number,
  type RecordItem,
  type ScriptedViewProps,
} from "./scriptedTypes.ts";
import {
  attackDurations,
  attackPath,
  elapsedMinutes,
  optionCards,
  recordTime,
  responseClock,
  scopedRecords,
  staffing,
  statewideRows,
  vendorExposure,
} from "./scriptedCommandModel.ts";
import {
  audiencePreview,
  consequenceModel,
  eventTimeline,
  overviewModel,
  planningWindow,
  previewAudiences,
  recordedActivity,
  timeLabel,
  words,
} from "./commandCenterModel.ts";
import { eventSourceChips } from "./networkEvidence.ts";
import { idtSectorName } from "./idt.ts";
import "./scripted-command.css";
import StatewideFootprint from "./StatewideFootprint.tsx";
import { StatusChip } from "./visualPrimitives.ts";
import { VisualCard } from "./visualPrimitives.ts";
import { SummaryTile } from "./visualPrimitives.ts";

export interface ScriptedCommandViewsProps extends ScriptedViewProps {
  onSelect: (id: string) => void;
  onOpenAnalyst: (
    view: CommandView,
    caseId?: string,
    entityId?: string,
  ) => void;
  onNavigate: (view: CommandView) => void;
  onSelectEntity?: (id: string | null) => void;
}
// Forward reference data when the shared audience projection supports it;
// the legacy two-argument implementation remains assignable without casts.
const recordAudiencePreview: (
  audience: (typeof previewAudiences)[number],
  incident: NonNullable<ScriptedViewProps["selected"]>,
  reference: ScriptedViewProps["reference"],
) => ReturnType<typeof audiencePreview> = audiencePreview;
const titles: Partial<Record<CommandView, string>> = {
  command: "Command Overview",
  cop: "Statewide Map",
  cyber: "Attack Picture CTIC",
  uctf: "Response Teams UCTF",
  leadership: "Leadership Brief",
  federation: "Partner and Stakeholder Coordination",
};
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VisualCard className="command-panel cc-panel sc-panel">
      <h2>{title}</h2>
      {children}
    </VisualCard>
  );
}
function Metrics({ values }: { values: [ReactNode, string][] }) {
  return (
    <section className="command-metrics cc-metrics">
      {values.map(([value, label]) => (
        <SummaryTile className="command-metric" key={label}>
          <strong>
            {typeof value === "number" ? value.toLocaleString("en-US") : value}
          </strong>
          <span>{label}</span>
        </SummaryTile>
      ))}
    </section>
  );
}
function Schematic({
  items,
  active,
  onSelect,
  label,
}: {
  items: RecordItem[];
  active: string | null;
  onSelect: (id: string) => void;
  label: string;
}) {
  return (
    <div className="sc-schematic" aria-label={label}>
      {items.map((item) => {
        const pos = item.schematic ?? item.location?.schematic;
        return pos ? (
          <button
            key={item.id}
            className={`sc-pin ${active === item.id ? "selected" : ""}`}
            data-label-side={pos.x > 50 ? "left" : "right"}
            style={{
              left: `${Math.max(0, Math.min(100, pos.x))}%`,
              top: `${Math.max(8, Math.min(90, pos.y))}%`,
            }}
            onClick={() => onSelect(item.id)}
            aria-pressed={active === item.id}
            title={[
              item.name ?? item.title,
              item.statusText ?? words(item.status ?? ""),
              item.locationLabel ?? item.location?.label,
              item.workingOn,
              item.forensics,
              item.lead,
            ]
              .filter(Boolean)
              .join("\n")}
          >
            <span className="sc-pin-marker" aria-hidden="true">
              ●
            </span>{" "}
            <span className="sc-pin-label">
              {item.short ?? item.name ?? item.title}
            </span>
          </button>
        ) : null;
      })}
    </div>
  );
}

/** Callback-only recorded views. The parent owns refresh, persisted state and all mutations. */
export default function ScriptedCommandViews(props: ScriptedCommandViewsProps) {
  const {
    data,
    incidents,
    selected,
    view,
    records,
    reference,
    onSelect,
    onOpenAnalyst,
    onNavigate,
    onSelectEntity,
  } = props;
  const [picked, setPicked] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const rows = statewideRows(records, incidents);
  const selectedRow = rows.find((row) => row.caseId === selected?.id);
  const scope = (items: RecordItem[]) =>
    scopedRecords(items, records, selected);
  const models = incidents
    .filter((item) => item.status !== "closed")
    .map(consequenceModel);
  const model = consequenceModel(selected);
  const selectRow = (id: string) => {
    setPicked(id);
    const row = rows.find((item) => item.id === id);
    if (row?.caseId) onSelect(row.caseId);
  };
  const pickedRow = rows.find((row) => row.id === (picked ?? selectedRow?.id));
  const rowSummary = pickedRow ? (
    <aside className="sc-summary" aria-label="Read-only summary">
      <h3>{pickedRow.title}</h3>
      <p>
        {pickedRow.id} · {words(pickedRow.status ?? "unknown")} · Read-only
        summary
      </p>
      <p>{pickedRow.summary}</p>
      {pickedRow.caseId && (
        <button
          className="command-link"
          onClick={() => onOpenAnalyst("case-file", pickedRow.caseId)}
        >
          Open full case file
        </button>
      )}
    </aside>
  ) : null;
  const register = (
    <div className="command-table-wrap">
      <table className="command-table">
        <thead>
          <tr>
            {[
              "Incident",
              "Where",
              "IDT sectors",
              "Severity",
              "Status",
              "Elapsed",
            ].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const start =
              row.startedAt ??
              recordTime(
                { relativeTimeHours: row.startedRelativeHours },
                data,
                null,
              );
            const end =
              row.closedAt ??
              recordTime(
                {
                  relativeTimeHours:
                    typeof row.closedRelativeHours === "number"
                      ? row.closedRelativeHours
                      : undefined,
                },
                data,
                null,
              ) ??
              records.storyNow;
            const elapsed = elapsedMinutes(start, end);
            return (
              <tr key={row.id}>
                <td>
                  <button
                    className="command-link"
                    onClick={() => selectRow(row.id)}
                  >
                    {row.title}
                  </button>
                  <small>{row.id}</small>
                </td>
                <td>{row.location?.label}</td>
                <td>
                  {row.sectors
                    ?.map((code) => idtSectorName(code) ?? `IDT ${code}`)
                    .join(" · ") ?? "Unknown"}
                </td>
                <td>
                  <StatusChip status={row.severity}>
                    {words(row.severity ?? "unknown")}
                  </StatusChip>
                </td>
                <td>
                  <StatusChip status={row.status}>
                    {words(row.status ?? "unknown")}
                  </StatusChip>
                </td>
                <td>{elapsed === null ? "Unknown" : `${elapsed} minutes`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  let content: ReactNode;
  if (view === "command") {
    const active = rows.filter((row) => row.status !== "closed");
    const pending = active.flatMap((row) =>
      row.caseId
        ? reference.responseOptions
            .filter(
              (option) =>
                !records.decisions.some(
                  (decision) =>
                    decision.optionId === option.id &&
                    (decision.incidentId === row.id ||
                      decision.incidentId === row.caseId ||
                      decision.caseId === row.caseId),
                ),
            )
            .map((option) => ({ row, option }))
        : [],
    );
    const overview = overviewModel(incidents);
    const updates = rows
      .flatMap((row) =>
        (row.updates ?? []).map((update, index) => ({
          id: `${row.id}:${index}`,
          message: update.text,
          at: recordTime(update, data, null),
          label: row.title,
        })),
      )
      .concat(
        recordedActivity(incidents).map((item) => ({
          id: item.id,
          message: item.message,
          at: item.createdAt,
          label: item.caseTitle,
        })),
      )
      .sort(
        (a, b) => (Date.parse(b.at ?? "") || 0) - (Date.parse(a.at ?? "") || 0),
      );
    content = (
      <>
        <Metrics
          values={[
            [active.length, "Active incidents"],
            [
              new Set(active.flatMap((row) => row.sectors ?? [])).size,
              "IDT sectors",
            ],
            [overview.people ?? "Unknown", "People in affected water service"],
            [pending.length, "Decisions waiting"],
          ]}
        />
        <Panel title="Statewide Picture">
          <Schematic
            items={rows}
            active={picked ?? selectedRow?.id ?? null}
            onSelect={selectRow}
            label="Statewide incident schematic"
          />
          {rowSummary}
        </Panel>
        <Panel title="Incident Register">{register}</Panel>
        <div className="sc-grid">
          <Panel title="Decisions Waiting">
            {pending.map(({ row, option }) => (
              <p key={`${row.id}:${option.id}`}>
                <button
                  className="command-link"
                  onClick={() => {
                    if (row.caseId) onSelect(row.caseId);
                    onNavigate("leadership");
                  }}
                >
                  {option.title}
                </button>
                <small>{row.title}</small>
              </p>
            ))}
            {!pending.length && (
              <p>No response options awaiting a recorded decision.</p>
            )}
          </Panel>
          <Panel title="Critical Facilities at Risk">
            <small>Modeled · not observed outages</small>
            {models.flatMap((item) =>
              item.rows.map((row) => (
                <p key={`${item.run?.id}:${row.id}`}>
                  <button
                    className="command-link"
                    onClick={() => onSelectEntity?.(row.entityId)}
                  >
                    {row.label}
                  </button>{" "}
                  · {row.functionLabel}
                  <small>
                    Modeled {words(row.state)} ·{" "}
                    {planningWindow(row.windowHours)}
                  </small>
                </p>
              )),
            )}
            {!models.some((item) => item.rows.length) && (
              <p>No captured impact results. Facility risk remains unknown.</p>
            )}
          </Panel>
          <Panel title="From the Analysts">
            {updates.map((update) => (
              <p key={update.id}>
                {activityDisplayText(update.message)}
                <small>
                  {update.label} · {timeLabel(update.at)}
                </small>
              </p>
            ))}
          </Panel>
        </div>
      </>
    );
  } else if (view === "cop") {
    content = (
      <Panel title="All Statewide Incidents">
        <StatewideFootprint
          data={data}
          incidents={incidents}
          selected={selected}
          records={records}
          reference={reference}
          onSelect={onSelect}
          onOpenAnalyst={onOpenAnalyst}
        />
        <details>
          <summary>Advanced · statewide incident register</summary>
          {register}
          {rowSummary}
        </details>
      </Panel>
    );
  } else if (view === "cyber") {
    const timeline = eventTimeline(data, selected);
    const durations = attackDurations(
      timeline
        .filter(
          (item) =>
            !selected ||
            selectedRow?.linkedEventIds?.includes(item.event.id) ||
            item.captured,
        )
        .map((item) => item.event),
      data,
    );
    const statuses = scope(records.assetStatuses);
    const assessments = scope(records.assessments);
    const hunts = scope(records.hunts);
    const events = timeline.filter(
      (item) =>
        selectedRow?.linkedEventIds?.includes(item.event.id) || item.captured,
    );
    content = (
      <>
        <Panel title="Attack Stages">
          <p>Network · Corelight format (simulated)</p>
          <Metrics
            values={[
              [
                durations.beforePlant === null
                  ? "Unknown"
                  : `${durations.beforePlant} minutes`,
                "Time inside before reaching the plant",
              ],
              [
                durations.plantToChange === null
                  ? "Unknown"
                  : `${durations.plantToChange} minutes`,
                "Plant access to setpoint change",
              ],
            ]}
          />
          <ol className="cc-event-timeline">
            {timeline.map((item) => (
              <li key={item.event.id}>
                <small>
                  {item.time} · {item.origin}
                </small>
                <h3>{item.label}</h3>
                <p>{item.description}</p>
                {item.techniques.length > 0 && (
                  <p>Recorded techniques: {item.techniques.join(" · ")}</p>
                )}
                <div className="cc-sources">
                  {eventSourceChips(item.event).map((label) => (
                    <span className="cc-tag" key={label}>
                      {label}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Attack Path">
          <p>
            {attackPath(
              events.map((item) => item.event),
              data,
            ).nodes.join(" → ") || "No linked path captured."}
          </p>
          <p>
            Related probes only (not traversal):{" "}
            {attackPath(
              events.map((item) => item.event),
              data,
            ).probes.join(" · ") || "None in this captured path"}
          </p>
        </Panel>
        <div className="sc-grid">
          <Panel title="Who Is Behind It">
            {!assessments.length && <p>CTIC analyst assessment · Unknown</p>}
            {assessments.map((item) => (
              <article key={item.id}>
                <h3>CTIC analyst assessment</h3>
                <small>{item.byUnit}</small>
                <p>{item.cluster}</p>
                <strong>{item.actorLabel}</strong>
                <p>
                  Confidence: {words(item.confidence ?? "unknown")} ·{" "}
                  {timeLabel(recordTime(item, data, selected))}
                </p>
                <p>{item.note}</p>
                <p>
                  {text(object(item.publication).label)} ·{" "}
                  {text(object(item.publication).format)}
                </p>
                <ul>
                  {item.indicators?.map((indicator) => (
                    <li key={`${indicator.type}:${indicator.value}`}>
                      {indicator.label}: <code>{indicator.value}</code> ·{" "}
                      <StatusChip status={indicator.status}>
                        {words(indicator.status)}
                      </StatusChip>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </Panel>
          <Panel title="Exposure Check">
            {vendorExposure(data, selected).map(({ vendor, utilities }) => (
              <p key={vendor.id}>
                {utilities.length} more utilities use {vendor.label}:{" "}
                {utilities.map((utility) => utility.label).join(", ") ||
                  "None identified in the supplied relationships"}
                .
              </p>
            ))}
          </Panel>
          <Panel title="What's Been Hit">
            <Metrics
              values={[
                ...new Set(statuses.map((item) => item.status ?? "unknown")),
              ].map(
                (status) =>
                  [
                    statuses.filter((item) => item.status === status).length,
                    records.assetStatusLabels?.[status] ?? words(status),
                  ] as [ReactNode, string],
              )}
            />
            {statuses.map((item) => (
              <p key={item.id}>
                {data.entities.find((entity) => entity.id === item.entityId)
                  ?.label ?? item.entityId}{" "}
                ·{" "}
                <StatusChip status={item.status}>
                  {records.assetStatusLabels?.[item.status ?? ""] ??
                    words(item.status ?? "unknown")}
                </StatusChip>
                <small>
                  {item.label} · {item.detail} ·{" "}
                  {timeLabel(recordTime(item, data, selected))}
                </small>
              </p>
            ))}
          </Panel>
          <Panel title="Threat Hunts">
            {hunts.map((item) => (
              <article key={item.id}>
                <h3>{item.label}</h3>
                <p>
                  <StatusChip status={item.status}>
                    {records.huntStatusLabels[item.status ?? ""] ??
                      words(item.status ?? "unknown")}
                  </StatusChip>{" "}
                  · {timeLabel(recordTime(item, data, selected))}
                </p>
                <p>
                  {item.query?.kind}: <code>{item.query?.value}</code> ·{" "}
                  {item.query?.scope}
                </p>
                <p>{item.resultNote}</p>
              </article>
            ))}
          </Panel>
        </div>
      </>
    );
  } else if (view === "uctf") {
    const people = staffing(records);
    const clock = responseClock(records, reference, selected);
    const team = records.teams.find((item) => item.id === teamId);
    const eta = (item: RecordItem) =>
      item.etaAt ??
      (selected &&
      item.incidentId === selectedRow?.id &&
      typeof item.etaOffsetMinutes === "number"
        ? new Date(
            Date.parse(selected.createdAt) + item.etaOffsetMinutes * 60000,
          ).toISOString()
        : undefined);
    content = (
      <>
        <Metrics
          values={[
            [records.teams.length, "Teams"],
            [people.onSite, "Analysts on site"],
            [people.remote, "Analysts remote"],
            [people.traveling, "Analysts traveling"],
            [people.standby, "Analysts on standby"],
            [
              records.teams.filter((item) => item.status === "en_route").length,
              "Teams en route",
            ],
          ]}
        />
        <Panel title="Response Clock">
          <p className={`sc-clock ${clock.tone}`}>
            {selected?.status === "closed" ? "Closed case · " : ""}
            {clock.elapsedMinutes === null
              ? "Unknown start"
              : `${clock.elapsedMinutes} minutes elapsed`}{" "}
            / {clock.targetMinutes} minute target · {words(clock.tone)}
          </p>
        </Panel>
        <Panel title="Deployment Map">
          {!records.teams.length && <p>No teams deployed for this incident.</p>}
          <Schematic
            items={records.teams}
            active={teamId}
            onSelect={setTeamId}
            label="Team deployment schematic"
          />
          {team && (
            <aside className="sc-summary">
              <h3>{team.name}</h3>
              <p>
                {team.locationLabel} ·{" "}
                <StatusChip status={team.status}>
                  {team.statusText ??
                    records.teamStatusLabels?.[team.status ?? ""] ??
                    words(team.status ?? "unknown")}
                </StatusChip>
              </p>
              <p>{team.workingOn}</p>
              <p>{team.forensics}</p>
              <p>
                {team.lead} · ETA {timeLabel(eta(team))}
              </p>
            </aside>
          )}
        </Panel>
        <Panel title="All Teams">
          <div className="command-table-wrap">
            <table className="command-table">
              <thead>
                <tr>
                  {[
                    "Team",
                    "Status",
                    "People by location",
                    "Assignment / forensics",
                    "ETA / latest updates",
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.teams.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button
                        className="command-link"
                        onClick={() => setTeamId(item.id)}
                      >
                        {item.name}
                      </button>
                      <small>{item.lead}</small>
                    </td>
                    <td>
                      <StatusChip status={item.status}>
                        {item.statusText ??
                          records.teamStatusLabels?.[item.status ?? ""] ??
                          words(item.status ?? "unknown")}
                      </StatusChip>
                    </td>
                    <td>
                      {item.locationLabel}
                      <small>
                        {number(item.people?.onSite)} on site ·{" "}
                        {number(item.people?.remote)} remote ·{" "}
                        {number(item.people?.traveling)} traveling ·{" "}
                        {number(item.people?.standby)} standby
                      </small>
                    </td>
                    <td>
                      {item.workingOn}
                      <small>{item.forensics}</small>
                    </td>
                    <td>
                      {timeLabel(eta(item))}
                      {item.updates?.map((update, index) => (
                        <small key={index}>
                          {update.text} ·{" "}
                          {timeLabel(
                            recordTime(
                              update,
                              data,
                              item.incidentId === selectedRow?.id
                                ? selected
                                : null,
                            ),
                          )}
                        </small>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </>
    );
  } else if (view === "leadership") {
    const decisions = scope(records.decisions);
    const products = scope(records.partnerProducts);
    content = (
      <>
        <Panel title="What Happened">
          <h3>{selected?.title ?? "Select a saved case"}</h3>
          <p>{selected?.eventSnapshot.description}</p>
          {selected?.status === "closed" && (
            <p>Closed case · Read-only summary · {selected.closureNote}</p>
          )}
        </Panel>
        <Panel title="So What">
          <small>Modeled · not observed outages</small>
          {model.rows.map((row) => (
            <p key={row.id}>
              {row.label} · {row.functionLabel}
              <small>
                Modeled {words(row.state)} · {planningWindow(row.windowHours)}
              </small>
            </p>
          ))}
          {!model.run && (
            <p>No captured consequence run; service effects remain unknown.</p>
          )}
        </Panel>
        <Panel title="Response Options">
          <p>
            No approve or dispatch buttons here. The duty officer records the
            Chief's decision in the Analyst workspace.
          </p>
          <div className="sc-grid">
            {optionCards(reference, selected).map(({ option, timing }) => {
              const decision = decisions
                .filter((item) => item.optionId === option.id)
                .at(-1);
              return (
                <article className="sc-option" key={option.id}>
                  <small>{timing}</small>
                  <h3>{option.title}</h3>
                  <strong>
                    <StatusChip status={decision?.decision ?? "none"}>
                      {records.decisionLabels[decision?.decision ?? "none"] ??
                        words(decision?.decision ?? "unknown")}
                    </StatusChip>
                  </strong>
                  <p>{option.detail}</p>
                  <p>
                    {option.actor}
                    {option.unit ? ` · ${option.unit}` : ""}
                  </p>
                  <p>
                    {option.basisText} {option.citation}
                  </p>
                  {decision && (
                    <p>
                      {decision.note} · {decision.decidedBy} ·{" "}
                      {timeLabel(recordTime(decision, data, selected))}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </Panel>
        <Panel title="Decision Trail">
          {decisions.map((item) => (
            <p key={item.id}>
              {reference.responseOptions.find(
                (option) => option.id === item.optionId,
              )?.title ?? item.optionId}{" "}
              ·{" "}
              <StatusChip status={item.decision}>
                {records.decisionLabels[item.decision ?? ""] ??
                  words(item.decision ?? "unknown")}
              </StatusChip>
              <small>
                {item.note} · {item.decidedBy} · Recorded by {item.recordedBy} ·{" "}
                {timeLabel(recordTime(item, data, selected))}
              </small>
            </p>
          ))}
        </Panel>
        <Panel title="Partner Products">
          <small>Draft · not sent</small>
          {products.map((item) => (
            <p key={item.id}>
              {item.label} ·{" "}
              <StatusChip status={item.status}>
                {words(item.status ?? "unknown")}
              </StatusChip>
              <small>{item.detail}</small>
            </p>
          ))}
        </Panel>
        <Panel title="Cases Behind This Brief">
          {register}
          {rows
            .filter((row) => row.status === "closed")
            .map((row) => (
              <aside key={row.id} className="sc-summary">
                <h3>{row.title}</h3>
                <p>{row.id} · Closed · Read-only summary</p>
                <p>{row.summary}</p>
              </aside>
            ))}
          {rowSummary}
        </Panel>
      </>
    );
  } else {
    const contacts = scope(records.contacts);
    content = (
      <>
        <Panel title="Who We Need, and Where We Are">
          <p>CITRIDE does not send notifications</p>
          <div className="sc-grid">
            {(["act", "know", "helping"] as const).map((group) => {
              const items = contacts.filter((item) => item.group === group);
              return (
                <article key={group}>
                  <h3>
                    {
                      {
                        act: "Need to act",
                        know: "Need to know",
                        helping: "Helping us",
                      }[group]
                    }{" "}
                    · {items.length}
                  </h3>
                  {items.map((item) => (
                    <p key={item.id}>
                      {item.partnerRole}
                      <small>
                        <StatusChip status={item.status}>
                          {records.contactStatusLabels[item.status ?? ""] ??
                            words(item.status ?? "unknown")}
                        </StatusChip>{" "}
                        · {timeLabel(recordTime(item, data, selected))}
                      </small>
                      {item.note}
                    </p>
                  ))}
                </article>
              );
            })}
          </div>
        </Panel>
        <Panel title="What Each Partner and Stakeholder Can See">
          <div className="sc-grid">
            {selected ? (
              previewAudiences.map((audience) => {
                const preview = recordAudiencePreview(
                  audience,
                  selected,
                  reference,
                );
                return (
                  <article key={audience} data-audience={audience}>
                    <h3>{preview.title}</h3>
                    <small>{preview.status}</small>
                    <h4>Shows</h4>
                    <ul>
                      {preview.shows.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                    <h4>Not shown</h4>
                    <ul>
                      {preview.notShown.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </article>
                );
              })
            ) : (
              <p>Select a saved case for audience previews.</p>
            )}
          </div>
        </Panel>
      </>
    );
  }
  // C2 is embedded before the preserved infrastructure map and uses its parent's single header.
  return (
    <div
      className="scripted-command"
      data-screen={view}
      aria-label={titles[view]}
    >
      {view !== "cop" && (
        <header className="cc-page-heading">
          <p>Read-only display · Records as of {timeLabel(records.storyNow)}</p>

          {selected && <h3>{selected.title}</h3>}
        </header>
      )}
      {content}
    </div>
  );
}

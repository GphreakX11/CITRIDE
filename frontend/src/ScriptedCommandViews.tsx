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
  capturedClassification,
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
import { formatDuration, formatTimeCT } from "./displayTime.ts";
import { statewideFootprint, boilWaterLabel } from "./statewideFootprint.ts";
import { incidentMarkerLayout } from "./incidentMarkerLayout.ts";
import { TEXAS_PATH } from "./texasOutline.ts";
import "./scripted-command.css";
import "./attack-picture.css";
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
function Panel({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <VisualCard className="command-panel cc-panel sc-panel">
      <header className="command-panel-heading"><h2>{title}</h2>{note && <small>{note}</small>}</header>
      {children}
    </VisualCard>
  );
}
function Metrics({ values }: { values: [ReactNode, string, string?][] }) {
  return (
    <section className="command-metrics cc-metrics">
      {values.map(([value, label, note]) => (
        <SummaryTile className="command-metric" key={label}>
          <strong>
            {typeof value === "number" ? value.toLocaleString("en-US") : value}
          </strong>
          <span>{label}</span>
          {note && <small>{note}</small>}
        </SummaryTile>
      ))}
    </section>
  );
}
export function Schematic({
  items,
  active,
  onSelect,
  label,
  mode = "incidents",
  incidents = [],
}: {
  items: RecordItem[];
  active: string | null;
  onSelect: (id: string) => void;
  label: string;
  mode?: "incidents" | "teams";
  incidents?: RecordItem[];
}) {
  // Space badges with C2's presentation-only layout. Full labels occupy a
  // separate deterministic grid, so even identical authored anchors cannot
  // collide with text. No input record or coordinate is written back.
  const ordered = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const anchors = ordered.map((item, index) => {
    const position = item.schematic ?? item.location?.schematic;
    return { id: item.id, x: position?.x ?? 20 + (index % 4) * 20,
      y: position?.y ?? 20 + Math.floor(index / 4) * 20 };
  });
  const markers = incidentMarkerLayout(anchors, 640, 240);
  const badge = (item: RecordItem, index: number) => mode === "teams"
    ? item.unit === "CIRU" ? (item.short ?? item.name ?? "").split(/\s+/).map((part) => part[0]).join("") : (item.unit ?? item.short ?? item.name ?? "?").slice(0, 1)
    : index + 1;
  const hover = (item: RecordItem) => [item.name ?? item.title, item.statusText ?? words(item.status ?? ""), item.locationLabel ?? item.location?.label, item.workingOn, item.forensics, item.lead].filter(Boolean).join("\n");
  return (
    <div className="sc-schematic sc-safe-schematic" data-marker-mode={mode} aria-label={label}>
      <svg className="sc-safe-map" viewBox="0 0 640 240" role="group" aria-label={mode === "teams" ? "Texas schematic · team status markers and incident footprint" : "Texas schematic · numbered incident anchors"}>
        <path d={TEXAS_PATH} transform="translate(140 -10) scale(.37)" className="sc-texas-outline" />
        {mode === "teams" && incidents.map((incident) => {
          const position = incident.schematic ?? incident.location?.schematic;
          return position && <g key={incident.id} className="sc-team-incident" data-incident-id={incident.id} aria-label={`${incident.title} · incident footprint`}><title>{`${incident.title} · ${incident.location?.label ?? "Illustrative incident footprint"}`}</title><circle cx={position.x * 6.4} cy={position.y * 2.4} r="25" /></g>;
        })}
        {markers.map((marker, index) => (
          <g key={marker.id} className={`sc-safe-anchor ${active === marker.id ? "selected" : ""}`}
            data-team-status={mode === "teams" ? ordered[index].status : undefined}
            role="button" tabIndex={0} aria-pressed={active === marker.id}
            aria-label={`${index + 1}. ${ordered[index].short ?? ordered[index].name ?? ordered[index].title}`}
            onClick={() => onSelect(marker.id)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(marker.id); } }}>
            <title>{hover(ordered[index])}</title>
            {(marker.offsetX !== 0 || marker.offsetY !== 0) && <line x1={marker.sourceX} y1={marker.sourceY} x2={marker.x} y2={marker.y} />}
            <circle cx={marker.x} cy={marker.y} r="14" />
            <text x={marker.x} y={marker.y + 5} textAnchor="middle">{badge(ordered[index], index)}</text>
          </g>
        ))}
      </svg>
      <div className="sc-safe-labels">
        {ordered.map((item, index) => (
          <button key={item.id} className={`sc-safe-label ${active === item.id ? "selected" : ""}`}
            data-label-anchor={index + 1} aria-pressed={active === item.id} onClick={() => onSelect(item.id)}
            data-team-status={mode === "teams" ? item.status : undefined} title={hover(item)}>
            <span className="sc-safe-number" aria-hidden="true">{badge(item, index)}</span>
            <span>{item.short ?? item.name ?? item.title}</span>
          </button>
        ))}
      </div>
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
  const model = consequenceModel(selected);
  const selectRow = (id: string) => {
    setPicked(id);
    const row = rows.find((item) => item.id === id);
    if (row?.caseId) onSelect(row.caseId);
  };
  const pickedRow = rows.find((row) => row.id === (picked ?? selectedRow?.id));
  // Keep archived summaries available without replacing the canonical case or
  // inventing a saved run. Only the locally selected summary is visible.
  const summaryFor = (row: RecordItem, hidden = false) => (
    <aside key={row.id} id={`brief-summary-${row.id}`} className="sc-summary" aria-label="Read-only summary" hidden={hidden}>
      <h3>{row.title}</h3>
      <p>
        {row.id} · {words(row.status ?? "unknown")} · Read-only
        summary
      </p>
      <p>{row.summary}</p>
      {row.caseId && (
        <button
          className="command-link"
          onClick={() => onOpenAnalyst("case-file", row.caseId)}
        >
          Open full case file
        </button>
      )}
    </aside>
  );
  const rowSummary = pickedRow ? summaryFor(pickedRow) : null;
  const registerFor = (registerRows: RecordItem[], kind = "all") => (
    <div className="command-table-wrap">
      <table className={`command-table ${view === "command" ? "sc-overview-register" : ""}`} data-register={kind}>
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
          {registerRows.map((row) => {
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
            const saved = incidents.find((incident) => incident.id === row.caseId);
            const reviews = saved?.decisions ?? [];
            const isSelected = row.id === (picked ?? selectedRow?.id);
            return (
              <tr key={row.id} className={isSelected ? "selected" : undefined} aria-selected={isSelected}>
                <td>
                  <button
                    className="command-link"
                    onClick={() => selectRow(row.id)}
                  >
                    {row.title}
                  </button>
                  <small>{row.id}{row.relatedNote ? ` · ${row.relatedNote}` : ""}</small>
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
                    {row.status === "open" && saved ? "Under investigation" : words(row.status ?? "unknown").replace(/^./, (letter) => letter.toUpperCase())}
                  </StatusChip>
                  {!!reviews.length && <small>{reviews.filter((review) => review.reviewed).length} of {reviews.length} reviews recorded</small>}
                </td>
                <td>{formatDuration(elapsed, "Unknown")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  const register = registerFor(rows);
  let content: ReactNode;
  if (view === "command") {
    const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const recordedStart = (row: RecordItem) => Date.parse(row.startedAt ?? recordTime(
      { relativeTimeHours: row.startedRelativeHours }, data, null,
    ) ?? "") || Number.POSITIVE_INFINITY;
    const isWatershed = (row: RecordItem) => incidents.some((incident) => incident.id === row.caseId && incident.eventId === "event-vpn-a");
    const active = rows.filter((row) => row.status !== "closed").sort((a, b) =>
      Number(isWatershed(b)) - Number(isWatershed(a)) ||
      (severityRank[a.severity ?? ""] ?? 4) - (severityRank[b.severity ?? ""] ?? 4) ||
      recordedStart(a) - recordedStart(b) || a.id.localeCompare(b.id),
    );
    const footprint = statewideFootprint({ ...props,
      selected: selected?.status !== "closed" ? selected : incidents.find((item) => item.status !== "closed") ?? null,
    });
    const activeCaseIds = new Set(active.map((row) => row.caseId).filter(Boolean));
    const activeModels = incidents.filter((item) => activeCaseIds.has(item.id)).map(consequenceModel);
    const earliest = activeModels.map((item) => item.earliest).filter((window): window is [number, number] => !!window).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0];
    const notices = [...new Set(activeModels.map((item) => boilWaterLabel(item.run, item.captured.entities, reference)).filter(Boolean))];
    const underInvestigation = active.filter((row) => row.caseId && incidents.some((item) => item.id === row.caseId && item.status === "open")).length;
    const mapItems: RecordItem[] = [...active, ...footprint.probed.map((utility) => ({
      id: utility.id, title: `${utility.label} · probed`, status: "probed",
    }))];
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
    const overview = overviewModel(incidents.filter((item) => item.status !== "closed"));
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
      <div className="sc-overview-wall" data-pending-decisions={pending.length}>
        <Metrics
          values={[
            [active.length, "Active incidents", `${underInvestigation} under investigation · ${active.length - underInvestigation} others statewide`],
            [
              new Set(active.flatMap((row) => row.sectors ?? [])).size,
              "Sectors affected",
              [...new Set(active.flatMap((row) => row.sectors ?? []))].map((code) => idtSectorName(code) ?? `IDT ${code}`).join(" · "),
            ],
            [overview.people ?? footprint.people ?? "Not captured", "People in affected water service", footprint.probed.length ? `${footprint.probed.reduce((sum, utility) => sum + (utility.people ?? 0), 0).toLocaleString("en-US")} more served by probed utilities` : footprint.utility?.label],
            [pending.length, "Decisions waiting on the Chief", earliest ? `Earliest window: ${planningWindow(earliest)}` : pending.length ? "Earliest window: not yet modeled" : "No response options awaiting a recorded decision"],
          ]}
        />
        <div className="sc-overview-layout">
          <div className="sc-overview-main">
            <Panel title="Statewide picture" note="Illustrative schematic · labels match numbered anchors · not geographic locations">
              <Schematic
                items={mapItems}
                active={picked ?? selectedRow?.id ?? null}
                onSelect={(id) => {
                  if (active.some((row) => row.id === id)) selectRow(id);
                  else onSelectEntity?.(id);
                }}
                label="Statewide incident schematic"
              />
              <div className="sc-map-key"><span>● Active incident</span><span>Linked utilities: recorded probes, not additional incidents</span></div>
            </Panel>
            <Panel title="Active incidents · statewide" note="Select an incident to see its consequences">
              {registerFor(active, "active")}
              {picked && rowSummary}
            </Panel>
          </div>
          <aside className="sc-overview-sidebar" aria-label="Decision support">
          <Panel title="Decisions waiting on the Chief">
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
          <Panel title="Critical facilities at risk">
            <small>Modeled · not observed outages</small>
            {activeModels.flatMap((item) =>
              item.rows.map((row) => (
                <p key={`${item.run?.id}:${row.id}`} className="sc-overview-facility" title={`${row.functionLabel} · Modeled ${words(row.state)}`}>
                  <button
                    className="command-link"
                    onClick={() => onSelectEntity?.(row.entityId)}
                  >
                    {row.label}
                  </button>
                  <span>{planningWindow(row.windowHours)}</span>
                </p>
              )),
            )}
            {notices.map((notice) => <p key={notice} className="sc-overview-notice">{notice}</p>)}
            {!activeModels.some((item) => item.rows.length) && (
              <p>Not yet modeled. Facility risk remains unknown.</p>
            )}
          </Panel>
          <Panel title="From the analysts">
            {updates.slice(0, 4).map((update) => (
              <p key={update.id} className="sc-overview-update" title={update.label}>
                <time>{timeLabel(update.at)}</time>
                <span>{activityDisplayText(update.message)}</span>
              </p>
            ))}
            {updates.length > 4 && <details><summary>Earlier analyst updates ({updates.length - 4})</summary>{updates.slice(4).map((update) => <p key={update.id}>{activityDisplayText(update.message)}<small>{update.label} · {timeLabel(update.at)}</small></p>)}</details>}
          </Panel>
          </aside>
        </div>
      </div>
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
    // A display group, not a synthetic event: every probe keeps its identity,
    // timestamp, techniques and evidence inside the shared stage card.
    const probes = timeline.filter((item) => item.event.observation === "probing_only");
    const stages = timeline.flatMap((item) => item.event.observation !== "probing_only"
      ? [[item]] : item === probes[0] ? [probes] : []);
    const stageLabels: Record<string, string> = {
      vendor_vpn_login_off_hours: "Initial access",
      unusual_inbound_connection: "IT to plant controls",
      controller_authentication: "Account misuse",
      dosing_parameter_change: "Setpoint changed",
      water_quality_drift: "Water quality drifts",
    };
    content = (
      <>
        <Panel title="How far the attack got">
          <div className="sc-attack-banner"><StatusChip status={events.some((item) => /prob/i.test(item.label)) ? "high" : "monitoring"}>{events.some((item) => /prob/i.test(item.label)) ? "ATTACK ACTIVE · SPREADING" : "ATTACK ACTIVITY RECORDED"}</StatusChip></div>
          <div className="sc-stage-cards" aria-label="Attack stages">
            {stages.map((group) => {
              const first = group[0];
              const observation = text(first.event.observation);
              const tone = observation === "probing_only" ? "ongoing" : observation === "water_quality_drift" ? "effect" : observation === "dosing_parameter_change" ? "confirmed" : "baseline";
              return <article key={first.event.id} className="sc-stage-card" data-origin={first.origin} data-stage-tone={tone}>
                <h3>{observation === "probing_only" ? `Probes at ${group.map((item) => item.label.replace(/^Related source probes /, "")).join(" and ")}` : stageLabels[observation] ?? first.label}</h3>
                {[...new Set(group.flatMap((item) => item.techniques))].map((technique) => <span className="cc-tag" key={technique} title={technique}>{technique.split(" · ").slice(0, 2).join(" ")}</span>)}
                <small className="sc-stage-state">{tone === "ongoing" ? "Ongoing" : tone === "effect" ? "Observed effect" : tone === "confirmed" ? "Confirmed" : "Recorded"} · {group.map((item) => item.time).join(" / ")}</small>
                <small className="sc-stage-origin">{first.origin}</small>
                <details className="sc-stage-evidence"><summary>Evidence details</summary>{group.map((item) => <div key={item.event.id} data-event-id={item.event.id}><strong>{item.label}</strong><p>{item.description}</p><div className="cc-sources">{eventSourceChips(item.event).map((label) => <span className="cc-tag" key={label}>{label}</span>)}</div></div>)}</details>
              </article>;
            })}
          </div>
          <div className="sc-attack-durations">
            <span>Time inside before reaching the plant <strong>{durations.beforePlant === null ? "Unknown" : formatDuration(durations.beforePlant)}</strong></span>
            <span>Plant access to setpoint change <strong>{durations.plantToChange === null ? "Unknown" : formatDuration(durations.plantToChange)}</strong></span>
          </div>
          <p className="mono sc-attack-path">{attackPath(events.map((item) => item.event), data).nodes.join(" → ") || "No linked path captured."}</p>
          <p className="cc-muted">Related probes only (not traversal): {attackPath(events.map((item) => item.event), data).probes.join(" · ") || "None in this captured path"}</p>
        </Panel>
        <div className="sc-grid sc-cyber-grid">
          <Panel title="Who is behind it">
            {!assessments.length && <p>CTIC analyst assessment · Unknown</p>}
            {assessments.map((item) => (
              <article key={item.id} className="sc-attribution">
                <div className="sc-attribution-heading"><div><h3>{item.cluster}</h3><p>{item.actorLabel}</p></div><div className="sc-confidence"><strong>{words(item.confidence ?? "unknown")}</strong><small>{item.byUnit} analyst assessment</small></div></div>
                <p className="sc-publication">{text(object(item.publication).label)} · {timeLabel(recordTime(item, data, selected))}</p>
                <details><summary>Assessment detail</summary><p>{item.note}</p></details>
                <div className="sc-indicators"><small>{text(object(item.publication).format)} · {item.indicators?.filter((indicator) => indicator.status === "confirmed").length ?? 0} confirmed indicators</small>
                  <div className="cc-sources">{item.indicators?.map((indicator) => <details key={`${indicator.type}:${indicator.value}`}><summary>{indicator.label}</summary><code>{indicator.value}</code> · <StatusChip status={indicator.status}>{words(indicator.status)}</StatusChip></details>)}</div>
                </div>
              </article>
            ))}
            <div className="sc-exposure-check"><h3>Exposure check</h3>
            {vendorExposure(data, selected).map(({ vendor, utilities }) => (
              <p key={vendor.id}>
                {utilities.length} more utilities use {vendor.label}:{" "}
                {utilities.map((utility) => utility.label).join(", ") ||
                  "None identified in the supplied relationships"}
                .
              </p>
            ))}</div>
          </Panel>
          <Panel title="What's been hit">
            <div className="sc-asset-counts"><Metrics
              values={[
                ...new Set(statuses.map((item) => item.status ?? "unknown")),
              ].filter((status) => status !== "normal")
              .sort((a, b) => ["confirmed", "suspected", "at_risk"].indexOf(a) - ["confirmed", "suspected", "at_risk"].indexOf(b))
              .map((status) => [
                statuses.filter((item) => item.status === status).length,
                records.assetStatusLabels?.[status] ?? words(status),
              ] as [ReactNode, string])}
            /></div>
            <p className="sc-normal-count">Normal: {statuses.filter((item) => item.status === "normal").length}</p>
            {statuses.map((item) => (
              <p key={item.id} className="sc-asset-status">
                <span>{data.entities.find((entity) => entity.id === item.entityId)?.label ?? item.entityId}</span>
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
          <Panel title="Active hunts">
            {hunts.map((item) => (
              <article key={item.id} className="sc-hunt-row">
                <div className="sc-hunt-heading"><h3>{item.label}</h3><StatusChip status={item.status}>{records.huntStatusLabels[item.status ?? ""] ?? words(item.status ?? "unknown")}</StatusChip></div>
                <details><summary>Hunt details · {timeLabel(recordTime(item, data, selected))}</summary><p>{item.query?.kind}: <code>{item.query?.value}</code> · {item.query?.scope}</p><p>{item.resultNote}</p></details>
              </article>
            ))}
          </Panel>
        </div>
      </>
    );
  } else if (view === "uctf") {
    const people = staffing(records);
    const clock = responseClock(records, reference, selected);
    const team = records.teams.find((item) => item.id === teamId) ?? records.teams.find((item) => item.incidentId === selectedRow?.id) ?? records.teams[0];
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
            [people.onSite + people.remote + people.traveling, "Analysts deployed", `${people.onSite} on site · ${people.remote} remote · ${people.traveling} traveling · ${people.standby} on standby`],
            [records.teams.filter((item) => item.status === "en_route").length, "En route", records.teams.filter((item) => item.status === "en_route").map((item) => `${item.shortLabel ?? item.name} · ETA ${formatTimeCT(eta(item))}`).join(" · ")],
            [
              clock.elapsedMinutes === null ? "—" : formatDuration(clock.elapsedMinutes),
              "Response clock",
              `${words(clock.tone)} · target ${formatDuration(clock.targetMinutes)}`,
            ],
          ]}
        />

        <div className="sc-team-layout"><Panel title="Deployment map">
          {!records.teams.length && <p>No teams deployed for this incident.</p>}
          <Schematic
            items={records.teams}
            active={team?.id ?? null}
            onSelect={setTeamId}
            label="Team deployment schematic"
            mode="teams"
            incidents={rows.filter((row) => row.status !== "closed" && records.teams.some((item) => item.incidentId === row.id))}
          />
          <p className="sc-team-map-key">Illustrative locations · circles show recorded team status; dashed rings show incident footprints. Select or hover a team for details.</p>
          </Panel><Panel title="Team details">{team && (
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
              <p className="sc-team-incident-label">Incident: {team.incidentId} · {rows.find((row) => row.id === team.incidentId)?.title ?? "No incident summary captured"}</p>
              <h4>Working on</h4><p>{team.workingOn}</p>
              <h4>Forensics</h4><p>{team.forensics}</p>
              <div className="sc-team-facts"><p><small>ETA</small>{formatTimeCT(eta(team))}</p><p><small>Team lead</small>{team.lead}</p></div>
              <small>{number(team.people?.onSite)} on site · {number(team.people?.remote)} remote · {number(team.people?.traveling)} traveling · {number(team.people?.standby)} standby</small>
              {team.updates?.at(-1) && <p className="sc-team-latest">Latest update: {team.updates.at(-1)?.text} · {formatTimeCT(recordTime(team.updates.at(-1)!, data, selected))}</p>}
              <div className="sc-clock-details" data-clock-tone={clock.tone}>
                <p className={`sc-clock ${clock.tone}`}>
                  {selected?.status === "closed" ? "Closed case · " : ""}
                  {clock.elapsedMinutes === null ? "Unknown start" : `${formatDuration(clock.elapsedMinutes)} elapsed`}
                  {" / "}{formatDuration(clock.targetMinutes)} target · {words(clock.tone)}
                </p>
                <div className="sc-clock-track" role="progressbar" aria-label="Response clock" aria-valuemin={0} aria-valuemax={clock.targetMinutes} aria-valuenow={Math.min(clock.targetMinutes, Math.max(0, clock.elapsedMinutes ?? 0))} aria-valuetext={clock.elapsedMinutes === null ? "Unknown start" : `${formatDuration(clock.elapsedMinutes)} elapsed; ${formatDuration(clock.targetMinutes)} target`}><span style={{width: `${Math.min(100, Math.max(0, (clock.elapsedMinutes ?? 0) / clock.targetMinutes * 100))}%`}} /></div>
              </div>
            </aside>
          )}
        </Panel></div>
        <Panel title="All teams" note={`${records.teams.filter((item) => item.status === "en_route").length} en route`}>
          <div className="command-table-wrap">
            <table className="command-table sc-team-register">
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
                  <tr key={item.id} className={item.id === team?.id ? "selected" : undefined} aria-selected={item.id === team?.id}>
                    <td>
                      <button
                        className="command-link"
                        onClick={() => setTeamId(item.id)}
                      >
                        {item.name}
                      </button>
                      <small>{item.incidentId} · {item.lead}</small>
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
                      <details><summary>Forensics</summary><p>{item.forensics}</p></details>
                    </td>
                    <td>
                      {formatTimeCT(eta(item))}
                      {item.updates?.at(-1) && <small className="sc-team-latest">{item.updates.at(-1)?.text} · {timeLabel(recordTime(item.updates.at(-1)!, data, item.incidentId === selectedRow?.id ? selected : null))}</small>}
                      {(item.updates?.length ?? 0) > 1 && <details><summary>Earlier updates ({item.updates!.length - 1})</summary>{item.updates!.slice(0, -1).map((update, index) => (
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
                      ))}</details>}
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
    const caseMetrics = overviewModel(incidents).metrics;
    const decisions = scope(records.decisions);
    const products = scope(records.partnerProducts);
    const briefRow = rows.find((row) => row.caseId === selected?.id);
    const briefEvents = eventTimeline(data, selected).filter((item) => briefRow?.linkedEventIds?.includes(item.event.id) || item.captured);
    const notice = boilWaterLabel(model.run, model.captured.entities, reference);
    const sectorClasses = [capturedClassification(model.captured.entities.find((entity) => entity.id === model.run?.seed.provider)), ...model.rows.map((row) => row.classification)].filter((item) => item.classified);
    const sectors = new Map(sectorClasses.map((item) => [item.key, item.label]));
    content = (
      <>
        <Panel title="1 · What happened">
          <p className="sc-brief-story">{briefEvents.length ? briefEvents.map((item, index) => <span key={item.event.id} data-story-event={item.event.id}>{index ? "; " : ""}{item.label}</span>) : briefRow?.summary ?? selected?.eventSnapshot.description ?? "Select a saved case."}</p>
          <div className="cc-sources">{[...new Set(briefEvents.flatMap((item) => item.event.sourceRefs ?? []))].map((id) => <span className="cc-tag" key={id}>{data.sources.find((source) => source.id === id)?.label ?? id}</span>)}</div>
          <details className="sc-brief-sequence"><summary>Recorded sequence and evidence</summary>{briefRow?.summary && <p>{briefRow.summary}</p>}{briefEvents.map((item) => <p key={item.event.id}>{item.time} {item.label}<small>{item.description}</small><small>{eventSourceChips(item.event).join(" · ")}</small></p>)}</details>
          {selected?.status === "closed" && (
            <p>Closed case · Read-only summary · {selected.closureNote}</p>
          )}
        </Panel>
        <Panel title="2 · So what">
          <small>Modeled · not observed outages</small>
          <div className="sc-brief-impact" data-earliest-known={!!model.earliest} data-notice={notice ? "possible" : "unknown"}><Metrics values={[
            [model.people === null ? "Unknown" : model.people.toLocaleString("en-US"), "People in affected water service"],
            [planningWindow(model.earliest), "Earliest window"],
            [model.run ? sectors.size : "Unknown", "Sectors affected", [...sectors.values()].join(" · ")],
            [notice ? "Possible" : model.run ? "Not triggered" : "Not yet modeled", "Boil-water notice"],
          ]} /></div>
          <p className="sc-brief-windows">{model.rows.map((row) => `${row.label} ${planningWindow(row.windowHours)}`).join(" · ")}</p>
          {!model.run && (
            <p>No captured consequence run; service effects remain unknown.</p>
          )}
          <button className="command-link" onClick={() => onNavigate("consequence")}>See C4 →</button>
        </Panel>
        <Panel title="3 · What can we do">
          <p>
            No approve or dispatch buttons here. The duty officer records the
            Chief's decision in the Analyst workspace.
          </p>
          <div className="sc-grid sc-brief-option-cards">
            {optionCards(reference, selected).map(({ option, timing }) => {
              const decision = decisions
                .filter((item) => item.optionId === option.id)
                .at(-1);
              return (
                <article className="sc-option" key={option.id} data-option-id={option.id} data-decision={decision?.decision ?? "none"}>
                  <small>{timing}</small>
                  <h3>{option.title}</h3>
                  <p>{option.detail}</p>
                  <p>
                    {option.actor}
                    {option.unit ? ` · ${option.unit}` : ""}
                  </p>
                  <details className="sc-option-basis"><summary>Basis: {option.citation}</summary><p>{option.basisText}</p></details>
                  {decision && (
                    <details className="sc-option-record"><summary>Recorded decision</summary><p>
                      {decision.note} · {decision.decidedBy} ·{" "}
                      {timeLabel(recordTime(decision, data, selected))}
                    </p></details>
                  )}
                  <div className="sc-option-decision"><StatusChip status={decision?.decision ?? "none"}>
                    {records.decisionLabels[decision?.decision ?? "none"] ?? words(decision?.decision ?? "unknown")}
                  </StatusChip></div>
                </article>
              );
            })}
          </div>
        </Panel>
        <div className="sc-brief-lower"><Panel title="Decision Trail">
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
        <Panel title="Response measures">
          <Metrics values={[
            [caseMetrics.activeIncidents, "Active cases"],
            [caseMetrics.closedIncidents, "Closed"],
            [caseMetrics.pendingDecisions, "Reviews waiting"],
            [caseMetrics.firstReviewMedianSeconds === null ? "—" : formatDuration(caseMetrics.firstReviewMedianSeconds / 60), "Case opened → first review"],
          ]} />
          <p className="sc-muted">Saved casework only; official performance measures are not populated.</p>
          <details className="sc-brief-products"><summary>Partner products ({products.length}) · Draft · not sent</summary>
          {products.map((item) => (
            <p key={item.id}>
              {item.label} ·{" "}
              <StatusChip status={item.status}>
                {words(item.status ?? "unknown")}
              </StatusChip>
              <small>{item.detail}</small>
            </p>
          ))}
          </details>
        </Panel></div>
        <Panel title="Cases behind this brief">
          <div className="sc-brief-case-layout">
            <nav className="sc-brief-case-list" aria-label="Cases behind this brief">
              {[...rows].sort((a, b) => Number(b.caseId === selected?.id) - Number(a.caseId === selected?.id) || Number(a.status === "closed") - Number(b.status === "closed")).map((row) => <button key={row.id} className={row.id === pickedRow?.id ? "selected" : ""} aria-controls={`brief-summary-${row.id}`} aria-pressed={row.id === pickedRow?.id} onClick={() => setPicked(row.id)}><span>{row.title}<small>{row.id}</small></span><StatusChip status={row.status}>{words(row.status ?? "unknown")}</StatusChip></button>)}
            </nav>
            {[...rows].sort((a, b) => Number(b.id === pickedRow?.id) - Number(a.id === pickedRow?.id)).map((row) => summaryFor(row, row.id !== pickedRow?.id))}
          </div>
          <details className="sc-brief-register"><summary>Full incident register</summary>{register}</details>
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
      data-clock-tone={view === "uctf" ? responseClock(records, reference, selected).tone : undefined}
      aria-label={titles[view]}
    >
      {view !== "cop" && <p className="sc-records-asof">Read-only display · Records as of {timeLabel(records.storyNow)}</p>}
      {content}
    </div>
  );
}

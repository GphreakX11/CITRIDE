import { StatusChip } from "./visualPrimitives.ts";
import displayCatalog from "../../data/reference/display_catalog.json" with { type: "json" };
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { CommandAction } from "./commandTypes.ts";
import type { Run, RunSummary, RunRequest } from "./types.ts";
import type {
  RecordAction,
  RecordItem,
  RecordsState,
  ScriptedViewProps,
} from "./scriptedTypes.ts";
import { object, text } from "./scriptedTypes.ts";
import { api, humanize, windowLabel } from "./api.ts";
import { potentialRequests, rankUtilities, utilityForEvent } from "./whoActsFirst.ts";
import { caseRecordScope, sourceIncidentForCase } from "./analystCaseScope.ts";
import type { ConsequenceProjection } from "./consequencesModel.ts";
import { responseClock } from "./scriptedCommandModel.ts";
import { formatDuration, formatDueTime, formatTime } from "./displayTime.ts";
import "./scripted-analyst.css";

export interface ScriptedAnalystProps extends ScriptedViewProps {
  caseClosure?: ReactNode;
  onMutate: (action: CommandAction) => Promise<unknown>;
  busy: boolean;
  uncertain: boolean;
  onRefresh: () => unknown;
  onEstimatePotential?: (requests: RunRequest[]) => Promise<Run[]>;
  potentialRuns?: Run[];
}
export function isLate(task: RecordItem, records: RecordsState): boolean {
  return (
    task.status !== "done" &&
    !!task.dueAt &&
    Number.isFinite(Date.parse(records.now)) &&
    Date.parse(task.dueAt) < Date.parse(records.now)
  );
}
export function LateTasks({ records }: { records: RecordsState }) {
  const tasks = records.responseTasks.filter((task) => isLate(task, records));
  return tasks.length ? (
    <section
      className="scripted-analyst late-tasks"
      aria-label="Late response tasks"
    >
      <h3>Needs you next · late response tasks</h3>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <strong>{task.label}</strong> · {task.ownerRole ?? task.teamId} ·
            {formatDueTime(task.dueAt)}
          </li>
        ))}
      </ul>
    </section>
  ) : null;
}
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unable to save. Keep your inputs and refresh the records.";
export default function ScriptedAnalystViews(props: ScriptedAnalystProps) {
  const {
    data,
    incidents,
    selected,
    view,
    records,
    reference,
    busy,
    uncertain,
    onMutate,
    onRefresh,
  } = props;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState("");
  const [runsLoaded, setRunsLoaded] = useState(false);
  const sourceIncident = sourceIncidentForCase(selected, records);
  const selectedEvent = selected?.eventSnapshot ?? data.events.find((event) => event.id === selected?.eventId);
  const waterCase = !!selected && (selected.contextSnapshot?.provider?.type === "WaterServiceProvider" ||
    (!!selectedEvent && !!utilityForEvent(selectedEvent, data)));
  const [ownerProjection, setOwnerProjection] = useState<ConsequenceProjection | null>(null);
  const [ownerError, setOwnerError] = useState("");
  useEffect(() => {
    let live = true;
    setOwnerProjection(null);
    setOwnerError("");
    if (view === "coordination" && sourceIncident && !waterCase) {
      const id = sourceIncident.id;
      void api<ConsequenceProjection>(`/v1/command/consequences?incidentId=${encodeURIComponent(id)}`)
        .then((value) => {
          if (live && value.incident?.id === id) setOwnerProjection(value);
          else if (live) setOwnerError("Response owner incident did not match the selected case.");
        })
        .catch((error) => { if (live) setOwnerError(errorText(error)); });
    }
    return () => { live = false; };
  }, [view, sourceIncident?.id, selected?.id, selected?.version, waterCase]);
  useEffect(() => {
    setRunError("");
  }, [props.potentialRuns]);
  const latest = useRef(props);
  latest.current = props;
  const inFlight = useRef(false);
  const estimateFlight = useRef(false);
  const mounted = useRef(true);
  const blocked =
    busy || uncertain || saving || !selected || selected.status === "closed";
  const eligible = () =>
    !latest.current.busy &&
    !latest.current.uncertain &&
    !!latest.current.selected &&
    latest.current.selected.status !== "closed";
  const scope = (items: RecordItem[]) => caseRecordScope(items, selected, records);
  async function readRuns() {
    const saved = await api<(Run | RunSummary)[]>("/v1/runs");
    const relevant = saved.filter((r) =>
      displayCatalog.potentialScenarioIds.includes(
        r.scenarioId,
      ),
    );
    return Promise.all(
      relevant.map((r) =>
        Array.isArray(object(r).impacts) && object(r).baselineSnapshot
          ? Promise.resolve(r as Run)
          : api<Run>(`/v1/runs/${encodeURIComponent(r.id)}`),
      ),
    );
  }
  useEffect(() => {
    mounted.current = true;
    if (view === "coordination" && waterCase) {
      void readRuns()
        .then((saved) => {
          if (mounted.current) {
            setRuns(saved);
            setRunsLoaded(true);
          }
        })
        .catch((e) => {
          if (mounted.current) setRunError(errorText(e));
        });
    }
    return () => {
      mounted.current = false;
    };
  }, [view, waterCase]);
  async function refreshRuns() {
    if (estimateFlight.current) return;
    setRunBusy(true);
    try {
      setRuns(await readRuns());
      setRunsLoaded(true);
      setRunError("");
    } catch (e) {
      setRunError(errorText(e));
    } finally {
      setRunBusy(false);
    }
  }
  async function estimate() {
    if (
      !eligible() ||
      estimateFlight.current ||
      inFlight.current ||
      runBusy ||
      !latest.current.onEstimatePotential ||
      !runsLoaded
    )
      return;
    const original = latest.current;
    // Both payloads and displayed scenario labels are captured before opening the native confirmation.
    let requests: ReturnType<typeof potentialRequests>;
    try {
      requests = structuredClone(potentialRequests(data));
    } catch (e) {
      setRunError(errorText(e));
      return;
    }
    const confirmation = requests
      .map(
        (r) =>
          data.scenarios.find((s) => s.id === r.scenarioId)?.label ??
          r.scenarioId,
      )
      .join("\n");
    if (
      !window.confirm(
        `Save two potential-only estimates?\n${confirmation}\nBaseline ${data.baselineRevision}; evaluation ${requests[0].evaluationHour} h; horizon ${requests[0].horizonHours} h.\nNo case attachment, notifications, or map overlay changes.`,
      )
    )
      return;
    if (
      !eligible() ||
      latest.current.data !== original.data ||
      latest.current.selected?.id !== original.selected?.id ||
      latest.current.selected?.version !== original.selected?.version
    )
      return;
    estimateFlight.current = true;
    setRunBusy(true);
    setRunError("");
    try {
      await original.onEstimatePotential!(requests);
    } catch (e) {
      if (mounted.current) setRunError(errorText(e));
    } finally {
      estimateFlight.current = false;
      if (mounted.current) setRunBusy(false);
    }
  }
  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: CommandAction | RecordAction,
  ) {
    event.preventDefault();
    if (!eligible() || inFlight.current || estimateFlight.current) return;
    const original = latest.current;
    const frozen = structuredClone(action);
    if (
      !window.confirm(
        `Record ${humanize(action.action)} for ${original.selected!.title ?? original.selected!.id}?\n${JSON.stringify(frozen, null, 2)}\nTracking record only; no dispatch or notification.`,
      )
    )
      return;
    if (
      !eligible() ||
      latest.current.selected?.id !== original.selected?.id ||
      latest.current.selected?.version !== original.selected?.version ||
      latest.current.records !== original.records ||
      latest.current.data !== original.data
    )
      return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await onMutate(frozen);
    } catch (e) {
      setError(errorText(e));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  const value = (form: HTMLFormElement, key: string) =>
    text(new FormData(form).get(key));
  const input = (
    label: string,
    name: string,
    initial: unknown = "",
    type = "text",
    required = true,
  ) => (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={typeof initial === "number" ? initial : text(initial)}
        required={required}
        disabled={blocked}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? 1 : undefined}
      />
    </label>
  );
  const note = (name: string, initial: unknown = "", label = "Note") => (
    <label>
      {label}
      <textarea name={name} defaultValue={text(initial)} disabled={blocked} />
    </label>
  );
  const select = (
    label: string,
    name: string,
    initial: unknown,
    labels: Record<string, string>,
  ) => (
    <label>
      {label}
      <select
        name={name}
        defaultValue={text(initial)}
        disabled={blocked}
        required
      >
        {Object.entries(labels).map(([id, label]) => (
          <option value={id} key={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const labels = (
    supplied: unknown,
    items: RecordItem[],
    field = "status",
  ): Record<string, string> =>
    Object.fromEntries(
      [
        ...items.map((i) => [text(i[field]), humanize(text(i[field]))]),
        ...Object.entries(object(supplied)).map(([key, label]) => [
          key,
          text(label, key),
        ]),
      ].filter(([key]) => key),
    );
  const form = (
    id: string,
    action: CommandAction["action"] | RecordAction["action"],
    title: string,
    fields: ReactNode,
    payload: (el: HTMLFormElement) => CommandAction | RecordAction,
  ) => (
    <form
      key={id}
      data-action={action}
      onSubmit={(e) => {
        e.preventDefault();
        return submit(e, payload(e.currentTarget));
      }}
    >
      <h4>{title}</h4>
      <fieldset disabled={blocked}>
        {fields}
        <button type="submit" disabled={blocked}>
          {action === "add_note" ? "Save note — not sent" : "Record update"}
        </button>
      </fieldset>
    </form>
  );
  const entityName = (id: unknown) =>
    data.entities.find((e) => e.id === id)?.label ?? text(id, "Unknown asset");
  const teamNames = Object.fromEntries([
    ...records.taskGroups.map((g) => [g.id, text(g.label, g.id)]),
    ...scope(records.teams).map((t) => [t.id, text(t.name, t.id)]),
  ]);
  function cyberPanels() {
    const assets = scope(records.assetStatuses),
      hunts = scope(records.hunts);
    return (
      <>
        <section>
          <h3>Attribution assessment</h3>
          {scope(records.assessments).map((a) =>
            form(
              a.id,
              "record_assessment",
              text(a.byUnit) + " analyst assessment",
              <>
                {input("Subject", "subject", a.subject)}
                {input("Cluster", "cluster", a.cluster)}
                {input("Actor label", "actorLabel", a.actorLabel)}
                {select("Confidence", "confidence", a.confidence, {
                  low: "Low",
                  medium: "Medium",
                  high: "High",
                  ...(object(records.confidenceLabels) as Record<
                    string,
                    string
                  >),
                })}
                {note("note", a.note)}
              </>,
              (el) => ({
                action: "record_assessment",
                subject: value(el, "subject"),
                cluster: value(el, "cluster"),
                actorLabel: value(el, "actorLabel"),
                confidence: value(el, "confidence"),
                note: value(el, "note"),
              }),
            ),
          )}
        </section>
        <section>
          <h3>Asset compromise statuses</h3>
          {assets.map((a) =>
            form(
              a.id,
              "set_asset_status",
              entityName(a.entityId),
              <>
                <StatusChip status={a.status} className="sa-chip">
                  {a.label ?? a.status}
                </StatusChip>
                {select(
                  "Status",
                  "status",
                  a.status,
                  labels(records.assetStatusLabels, assets),
                )}
                {note("note", a.detail)}
              </>,
              (el) => ({
                action: "set_asset_status",
                entityId: text(a.entityId),
                status: value(el, "status"),
                note: value(el, "note"),
              }),
            ),
          )}
        </section>
        <section>
          <h3>Threat hunts · recorded results</h3>
          {hunts.map((h) =>
            form(
              h.id,
              "record_hunt",
              text(h.label),
              <>
                <p>
                  {h.query?.kind}: {h.query?.value} · {h.query?.scope}
                </p>
                <p>Owner: {teamNames[text(h.ownerTeamId)] ?? h.ownerTeamId}</p>
                {select(
                  "Hunt status",
                  "status",
                  h.status,
                  records.huntStatusLabels,
                )}
                {note("resultNote", h.resultNote, "Result note")}
              </>,
              (el) => ({
                action: "record_hunt",
                huntId: h.id,
                status: value(el, "status"),
                resultNote: value(el, "resultNote"),
              }),
            ),
          )}
        </section>
      </>
    );
  }
  function coordination() {
    const ranking = waterCase ? rankUtilities(
      data,
      incidents,
      props.potentialRuns ?? runs,
      reference,
    ) : [];
    const owners = ownerProjection?.incident?.id === sourceIncident?.id ? ownerProjection?.responseOwners ?? [] : [];
    const responseOptions = reference.responseOptions.filter((option) =>
      option.incidentId || option.caseId ? scope([option]).length > 0 : waterCase);
    return (
      <>
        {waterCase ? <section className="sa-rank-panel">
          <h3>Who acts first</h3>
          <p>
            Evidence first, then earliest healthcare planning window, then
            people served. Unknown windows sort last.
          </p>
          <button
            disabled={
              blocked || runBusy || !props.onEstimatePotential || !runsLoaded
            }
            onClick={() => void estimate()}
          >
            Estimate potential impact for B and C
          </button>
          <button disabled={runBusy} onClick={() => void refreshRuns()}>
            Recheck saved estimates
          </button>
          {runError && <p role="alert">{runError}</p>}
          <ol className="sa-ranking">
            {ranking.map((row) => (
              <li key={row.utilityId}>
                <div className="sa-rank-summary">
                <h4>{row.label}</h4>
                <p>
                  <StatusChip status={row.evidenceStatus === "effect_observed" ? "confirmed" : row.evidenceStatus}>{humanize(row.evidenceStatus)}</StatusChip> ·{" "}
                  {row.peopleServed?.toLocaleString("en-US") ?? "Unknown"}{" "}
                  people served
                </p>
                <p className={row.potential ? "sa-potential" : ""}>
                  {row.potential
                    ? "Potential, not observed · "
                    : "Captured case model · "}
                  {row.facilityLabel && `${row.facilityLabel} · `}
                  {row.windowHours
                    ? `${windowLabel(row.windowHours)}${row.potential ? " if compromised" : ""}`
                    : "unknown window"}
                </p>
                </div><div className="sa-first-actions"><p>Suggested -- cyber SME to confirm</p>
                <ul>
                  {row.firstActions.map((a) => (
                    <li key={a.id}>
                      {a.text}
                    </li>
                  ))}
                </ul><p className="sa-contact-roles">Contacts: {[...new Set(row.firstActions.map((a) => a.contactRole).filter(Boolean))].join(" · ")}</p></div>
                <button type="button" disabled={blocked} onClick={() => {
                  const panel = typeof document !== "undefined" ? document.getElementById("sa-decision-notes") : null;
                  if (panel) { (panel as HTMLDetailsElement).open = true; panel.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
                }}>Record decision note</button>
              </li>
            ))}
          </ol>
        </section>
        : <section className="sa-rank-panel">
          <h3>Who acts first</h3>
          <h4>Response owners</h4>
          {ownerError && <p role="alert">Response owners unavailable: {ownerError}</p>}
          {owners.length ? <ul className="sa-ranking">{owners.map((owner, index) =>
            <li key={index}><h4>{text(owner.role)}</h4><strong>{text(owner.who)}</strong><p>{text(owner.does)}</p></li>
          )}</ul> : <p>{!ownerProjection && !ownerError && sourceIncident
            ? "Loading response owners…" : "No response owners recorded."}</p>}
        </section>}
        <section className="sa-contacts-panel">
          <h3>Contacts · coordination tracking</h3>
          <div className="command-table-wrap"><table className="command-table"><thead><tr><th>Partner</th><th>Group</th><th>Status</th><th>Last update</th><th>Action</th></tr></thead><tbody>
          {scope(records.contacts).map((c) => <tr key={c.id}><td>{text(c.partnerRole)}</td><td>{text(c.group ?? c.unit ?? c.partnerGroup, "—")}</td><td><StatusChip status={c.status}>{records.contactStatusLabels[text(c.status)] ?? humanize(text(c.status))}</StatusChip></td><td>{formatTime(text(c.updatedAt ?? c.lastUpdateAt ?? c.createdAt, ""))}<small>{text(c.note)}</small></td><td><details className="sa-contact-row"><summary>Update contact</summary>{form(
              c.id,
              "set_contact_status",
              text(c.partnerRole),
              <>
                {select("Contact status", "status", c.status, records.contactStatusLabels)}
                {note("note", c.note)}
              </>,
              (el) => ({ action: "set_contact_status", contactId: c.id, status: value(el, "status"), note: value(el, "note") }),
            )}</details></td></tr>,
          )}
          </tbody></table></div>
        </section>
        <section className="sa-decisions-panel">
          <details id="sa-decision-notes"><summary>Record decision note</summary>
          {responseOptions.map((option) => <details key={option.id} className="sa-decision-row"><summary>{text(option.title)}</summary>{form(
              option.id,
              "record_decision",
              text(option.title),
              <>
                <p>
                  {option.actor} · {option.unit}
                </p>
                <p>{option.detail}</p>
                <p>
                  {option.basisText} {option.citation}
                </p>
                {scope(records.decisions)
                  .filter((d) => d.optionId === option.id)
                  .map((d) => (
                    <p key={d.id}>
                      {records.decisionLabels[text(d.decision)] ?? d.decision} ·{" "}
                      {d.decidedBy}: {d.note}
                    </p>
                  ))}
                {select(
                  "Decision",
                  "decision",
                  scope(records.decisions).find((d) => d.optionId === option.id)
                    ?.decision ?? "deferred",
                  Object.fromEntries(
                    Object.entries(records.decisionLabels).filter(
                      ([id]) => id !== "none",
                    ),
                  ),
                )}
                {input(
                  "Declared decision role",
                  "decidedBy",
                  scope(records.decisions).find((d) => d.optionId === option.id)
                    ?.decidedBy,
                )}
                {note("note")}
              </>,
              (el) => ({
                action: "record_decision",
                optionId: option.id,
                decision: value(el, "decision"),
                decidedBy: value(el, "decidedBy"),
                note: value(el, "note"),
              }),
            )}</details>,
          )}
          </details>
        </section>
        <section className="sa-products-panel">
          <h3>Partner products · Draft · not sent</h3>
          <ul>
            {scope(records.partnerProducts).map((p) => (
              <li key={p.id}>
                <strong>{p.label}</strong> ·{" "}
                <StatusChip status={p.status}>{p.status}</StatusChip>
                <p>{p.detail}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="sa-notes-panel">
          <h3>Coordination notes</h3>
          <ul>
            {selected?.notes?.map((n) => (
              <li key={n.id}><time dateTime={n.createdAt}>{formatTime(n.createdAt)}</time> {n.text}</li>
            ))}
          </ul>
          {form(
            "coordination-note",
            "add_note",
            "Add coordination note",
            note("note"),
            (el) => ({ action: "add_note", note: value(el, "note") }),
          )}
        </section>
      </>
    );
  }
  function response() {
    const tasks = scope(records.responseTasks),
      teams = scope(records.teams);
    const taskLabels = labels(records.taskStatusLabels, tasks);
    const elapsed =
      responseClock(records, reference, selected).elapsedMinutes ?? NaN;
    const clock = reference.responseClock;
    const color =
      elapsed >= clock.redMinutes
        ? "red"
        : elapsed >= clock.amberMinutes
          ? "amber"
          : "normal";
    return (
      <>
        <section className="sa-response-clock">
          <h3>Response clock</h3>
          <div className="sa-task-counts"><StatusChip status="done">{tasks.filter((task) => task.status === "done").length} of {tasks.length} done</StatusChip><StatusChip status="late">{tasks.filter((task) => isLate(task, records)).length} late</StatusChip><StatusChip status="waiting">{tasks.filter((task) => task.status === "waiting").length} waiting</StatusChip></div>
          <p className={`sa-clock sa-${color}`}>
            {Number.isFinite(elapsed)
              ? `${formatDuration(Math.max(0, elapsed))} since case opened`
              : "Unknown start time"}{" "}
            · target {formatDuration(clock.targetMinutes)}
          </p>
          <div className={`sa-clock-track sa-${color}`} role="progressbar" aria-label="Response clock against target" aria-valuemin={0} aria-valuemax={clock.targetMinutes} aria-valuenow={Number.isFinite(elapsed) ? Math.min(clock.targetMinutes, Math.max(0, elapsed)) : undefined}><span style={{ width: `${Number.isFinite(elapsed) ? Math.min(100, Math.max(0, elapsed / clock.targetMinutes * 100)) : 0}%` }} /></div>
          <div className="sa-clock-marks" aria-label="Clock thresholds">
            <span>0:00</span><span className="sa-threshold sa-threshold-amber" style={{ left: `${clock.amberMinutes / clock.targetMinutes * 100}%` }}>Amber {formatDuration(clock.amberMinutes)}</span><span className="sa-threshold sa-threshold-red" style={{ left: `${clock.redMinutes / clock.targetMinutes * 100}%` }}>Red {formatDuration(clock.redMinutes)}</span><span>{formatDuration(clock.targetMinutes)} target</span>
          </div>
          <p>{clock.note}</p>
        </section>
        <section className="sa-task-groups">
          <h3>Tasks by team</h3>
          {Object.entries({...teamNames, ...Object.fromEntries(tasks.filter((task) => !teamNames[text(task.teamId)]).map((task) => [text(task.teamId), humanize(text(task.teamId, "Unassigned"))]))}).filter(([id]) => tasks.some((task) => text(task.teamId) === id)).map(([id, label]) => (
            <section key={id} className="sa-team-group">
              <h4>{text(label)}</h4>
              {tasks
                .filter((t) => text(t.teamId) === id)
                .map((task) => (
                  <div key={task.id} className="sa-task">
                    <label>
                      <input
                        type="checkbox"
                        disabled={blocked}
                        checked={task.status === "done"}
                        onChange={(e) => {
                          const status = e.currentTarget.checked
                            ? "done"
                            : "not_started";
                          void submit(
                            {
                              preventDefault() {},
                            } as FormEvent<HTMLFormElement>,
                            {
                              action: "set_task_status",
                              taskId: task.id,
                              status,
                            },
                          );
                        }}
                      />
                      {task.label}
                    </label>
                    <details className="sa-task-edit"><summary aria-label={`Change status: ${task.label}`}><StatusChip
                      status={isLate(task, records) ? "late" : task.status}
                      className="sa-chip"
                    >
                      {taskLabels[text(task.status)] ?? task.status}
                      {isLate(task, records) ? " · Late" : ""}
                    </StatusChip></summary>{form(
                      task.id,
                      "set_task_status",
                      "Task status",
                      select("Task status", "status", task.status, taskLabels),
                      (el) => ({ action: "set_task_status", taskId: task.id, status: value(el, "status") }),
                    )}</details>
                    <p>
                      {[text(task.detail), text(task.ownerRole), formatDueTime(task.dueAt, "unknown")].filter(Boolean).join(" · ")}
                    </p>

                  </div>
                ))}
            </section>
          ))}
        </section>
        <div className="sa-response-side"><section className="sa-add-task">
          <h3>Add task</h3>
          {form(
            "add-task",
            "add_task",
            "New response task",
            <>
              {input("Task label", "label")}
              {select("Team", "teamId", "", {
                "": "Choose team",
                ...teamNames,
              })}
              {input("Owner role", "ownerRole")}
              {input("Due (your local time)", "dueAt", "", "datetime-local")}
            </>,
            (el) => ({
              action: "add_task",
              label: value(el, "label"),
              teamId: value(el, "teamId"),
              ownerRole: value(el, "ownerRole"),
              dueAt: new Date(value(el, "dueAt")).toISOString(),
            }),
          )}
        </section>
        {props.caseClosure && <div className="sa-case-closure">{props.caseClosure}</div>}
        <section className="sa-team-tracking">
          <details><summary>Team deployment tracking</summary>
          {teams.map((team) => <details key={team.id}><summary>{text(team.name)} · {humanize(text(team.status))}</summary>{form(
              team.id,
              "set_team_status",
              text(team.name),
              <>
                {select(
                  "Team status",
                  "status",
                  team.status,
                  labels(records.teamStatusLabels, teams),
                )}
                {(["onSite", "remote", "traveling", "standby"] as const).map(
                  (key) => (
                    <div key={key}>
                      {input(
                        humanize(key),
                        key,
                        team.people?.[key] ?? 0,
                        "number",
                      )}
                    </div>
                  ),
                )}
                {input("Location", "locationLabel", team.locationLabel)}
                {note("updateText", team.updates?.at(-1)?.text, "Update text")}
              </>,
              (el) => ({
                action: "set_team_status",
                teamId: team.id,
                status: value(el, "status"),
                people: {
                  onSite: Number(value(el, "onSite")),
                  remote: Number(value(el, "remote")),
                  traveling: Number(value(el, "traveling")),
                  standby: Number(value(el, "standby")),
                },
                locationLabel: value(el, "locationLabel"),
                updateText: value(el, "updateText"),
              }),
            )}</details>,
          )}
          </details>
        </section>
        </div>
      </>
    );
  }
  return (
    <div className={`scripted-analyst sa-view-${view}`} aria-label="Analyst record workspace">
      {uncertain && (
        <p role="alert">
          Save outcome uncertain. Use the parent recovery controls before
          recording another change.
        </p>
      )}
      {!selected && <p>Select a case to edit records.</p>}
      {selected?.status === "closed" && <p>Closed case · read-only records</p>}
      {error && <p role="alert">{error} Inputs retained.</p>}
      <details className="sa-refresh"><summary>Record tools</summary><button type="button" disabled={busy} onClick={() => onRefresh()}>
        Refresh records
      </button></details>
      {view === "cyber"
        ? cyberPanels()
        : view === "coordination"
          ? coordination()
          : view === "uctf"
            ? response()
            : null}
    </div>
  );
}

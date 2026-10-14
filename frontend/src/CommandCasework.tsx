import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Bootstrap, Event, Source } from "./types";
import type {
  CommandAction,
  CommandCreate,
  CommandIncident,
  IncidentPriority,
} from "./commandTypes";
import { displayText } from "./presentation";
import { reviewDisplayText, reviewWarning } from "./incidentDecisions";
import "./command-casework.css";

export interface CommandCaseworkProps {
  data: Bootstrap;
  incidents: CommandIncident[];
  selected: CommandIncident | null;
  mode: "full" | "tasks" | "decisions" | "coordination" | "consequence";
  onSelect: (id: string) => void;
  onCreate: (request: CommandCreate) => Promise<CommandIncident>;
  onMutate: (
    action: CommandAction,
    expectedVersion: number,
    caseId: string,
  ) => Promise<CommandIncident>;
  busy: boolean;
  uncertain: boolean;
  onRecheck: () => void;
  onRetryPending: () => void;
  onOpenEvidence: () => void;
}
const eventName = (event: Event) =>
  displayText(event.label || event.title || event.id);
const failure = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function snapshotSources(snapshot: unknown): Source[] {
  if (!snapshot || typeof snapshot !== "object" || !("sources" in snapshot))
    return [];
  const sources = snapshot.sources;
  return Array.isArray(sources)
    ? sources.filter(
        (source): source is Source =>
          !!source &&
          typeof source === "object" &&
          typeof source.id === "string",
      )
    : [];
}
function Sources({ refs, sources }: { refs: string[]; sources: Source[] }) {
  return (
    <div className="cc-chips" aria-label="Source references">
      {refs.length ? (
        refs.map((id) => {
          const source = sources.find((item) => item.id === id);
          return (
            <span key={id} className="cc-chip" title={id}>
              {displayText(source?.label || source?.title || id)}
            </span>
          );
        })
      ) : (
        <span className="cc-muted">No source references captured.</span>
      )}
    </div>
  );
}
function ConfirmDialog({
  title,
  children,
  disabled,
  confirmDisabled,
  error,
  onCancel,
  onConfirm,
  label,
}: {
  title: string;
  children: ReactNode;
  disabled: boolean;
  confirmDisabled: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="cc-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!disabled) onCancel();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          disabled={disabled}
          aria-label="Close confirmation"
          onClick={onCancel}
        >
          Close
        </button>
      </header>
      <div className="cc-dialog-body">
        {children}
        {error && (
          <p className="cc-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button type="button" disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="cc-primary"
          disabled={disabled || confirmDisabled}
          onClick={onConfirm}
        >
          {label}
        </button>
      </footer>
    </dialog>
  );
}

export default function CommandCasework(props: CommandCaseworkProps) {
  const {
    data,
    incidents,
    selected,
    onSelect,
    onCreate,
    busy,
    uncertain,
    onRecheck,
    onRetryPending,
    onOpenEvidence,
  } = props;
  const [eventId, setEventId] = useState(
    () =>
      data.events.find((event) => event.id === "event-dosing")?.id ||
      data.events[0]?.id ||
      "",
  );
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<IncidentPriority>("medium");
  const [baseline, setBaseline] = useState(data.baselineRevision);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const createGuard = useRef(false);
  const blocked = busy || uncertain || creating;
  async function create() {
    if (blocked || createGuard.current) return;
    setError("");
    if (
      !title.trim() ||
      !eventId.trim() ||
      !data.events.some((event) => event.id === eventId)
    ) {
      setError(
        "Select an available source event and enter a nonempty case title.",
      );
      return;
    }
    createGuard.current = true;
    setCreating(true);
    try {
      const created = await onCreate({
        eventId: eventId.trim(),
        title: title.trim(),
        priority,
        expectedBaselineRevision: baseline,
        clientRequestId: crypto.randomUUID(),
      });
      setTitle("");
      setPriority("medium");
      setBaseline(data.baselineRevision);
      onSelect(created.id);
    } catch (cause) {
      setError(failure(cause));
    } finally {
      createGuard.current = false;
      setCreating(false);
    }
  }
  return (
    <section className="command-casework" aria-label="Workspace casework">
      <header className="cc-panel cc-header">
        <div>
          <h2>Workspace casework</h2>
          <p className="cc-muted">
            Durable local triage and advisory review. Priority and status are
            user-assigned tracking, not source-system severity.
          </p>
        </div>
        <label>
          Workspace case
          <select
            aria-label="Workspace case"
            value={selected?.id || ""}
            onChange={(event) => onSelect(event.target.value)}
            disabled={blocked}
          >
            <option value="" disabled>
              Select a workspace case
            </option>
            {incidents.map((incident) => (
              <option key={incident.id} value={incident.id}>
                {incident.title} — {incident.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onOpenEvidence}>
          Open source evidence
        </button>
      </header>
      {uncertain && (
        <aside className="cc-warning" role="alert">
          <h3>Save outcome is uncertain</h3>
          <p>
            Inputs are retained. Recheck the saved workflow before taking
            another action. Retry only the same request saved by the workspace;
            nothing is automatically resubmitted.
          </p>
          <div className="cc-actions">
            <button
              type="button"
              disabled={busy || creating}
              onClick={onRecheck}
            >
              Recheck workflow
            </button>
            <button
              type="button"
              disabled={busy || creating}
              onClick={onRetryPending}
            >
              Retry same saved request
            </button>
          </div>
        </aside>
      )}
      <details className="cc-panel" open={!selected}>
        <summary>Create workspace case from a source event</summary>
        <p className="cc-muted">
          Captures reference-source context; this is not a real incident report
          or a source-event update.
        </p>
        <form
          className="cc-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label>
            Source event
            <select
              aria-label="Source event"
              value={eventId}
              disabled={blocked}
              onChange={(event) => setEventId(event.target.value)}
            >
              <option value="" disabled>
                Select a source event
              </option>
              {data.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {eventName(event)} — {event.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Case title
            <input
              value={title}
              required
              maxLength={160}
              disabled={blocked}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Describe the review to track"
            />
          </label>
          <label>
            Local triage priority
            <select
              aria-label="Local triage priority"
              value={priority}
              disabled={blocked}
              onChange={(event) =>
                setPriority(event.target.value as IncidentPriority)
              }
            >
              {["critical", "high", "medium", "low"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <p className="cc-muted">
            Captured source baseline: revision {baseline}. Current source
            baseline: revision {data.baselineRevision}.
          </p>
          {baseline !== data.baselineRevision && (
            <button
              type="button"
              disabled={blocked}
              onClick={() => setBaseline(data.baselineRevision)}
            >
              Use current source baseline
            </button>
          )}
          {error && (
            <p className="cc-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="cc-primary"
            disabled={blocked || !data.events.length}
            type="submit"
          >
            {creating ? "Saving workspace case…" : "Create workspace case"}
          </button>
        </form>
      </details>
      {selected ? (
        <CaseDetails
          key={selected.id}
          {...props}
          selected={selected}
          busy={busy || creating}
        />
      ) : (
        <div className="cc-panel cc-empty">
          <h2>No workspace case selected</h2>
          <p>
            Select an existing case by its ID, or create a case from an
            available source event above. Tasks, notes and advisory reviews are
            saved to that case.
          </p>
          {!data.events.length && (
            <p>
              No source events are available. Recheck the workflow to reload
              source context.
            </p>
          )}
          <button type="button" disabled={blocked} onClick={onRecheck}>
            Recheck workflow
          </button>
        </div>
      )}
    </section>
  );
}

type Confirmation = {
  caseId: string;
  version: number;
  action: CommandAction;
  title: string;
  detail: ReactNode;
  label: string;
};
function CaseDetails({
  data,
  selected,
  mode,
  onMutate,
  busy,
  uncertain,
}: CommandCaseworkProps & { selected: CommandIncident }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const guard = useRef(false);
  const [note, setNote] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [scenarioId, setScenarioId] = useState("");
  const [evaluation, setEvaluation] = useState("1");
  const [horizon, setHorizon] = useState("12");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const blocked = busy || uncertain || saving;
  const locked = blocked || selected.status === "closed";
  const context = selected.contextSnapshot;
  const scenarios = context.scenarios.filter((scenario) =>
    scenario.seed.eventRefs.includes(selected.eventId),
  );
  const scenario =
    scenarios.find((item) => item.id === scenarioId) ||
    (scenarioId === "" ? scenarios[0] : undefined);
  const baselineMatches =
    selected.baselineRevision === data.baselineRevision &&
    context.baselineRevision === selected.baselineRevision;
  const canAnalyze =
    !locked &&
    !selected.runId &&
    !selected.runSnapshot &&
    baselineMatches &&
    !!scenario;
  const closureReady =
    selected.tasks.every((task) => task.completed) &&
    selected.decisions.every((decision) => decision.reviewed);
  const run = selected.runSnapshot;
  const sources = snapshotSources(run?.baselineSnapshot);
  const contextSources = sources.length
    ? sources
    : baselineMatches
      ? data.sources
      : [];
  const show = (section: CommandCaseworkProps["mode"]) =>
    mode === "full" || mode === section;
  async function mutate(
    action: CommandAction,
    version = selected.version,
    caseId = selected.id,
    after?: () => void,
  ) {
    if (blocked || guard.current) return;
    if (
      selected.status === "closed" &&
      !(action.action === "set_status" && action.status === "open")
    )
      return;
    guard.current = true;
    setSaving(true);
    setError("");
    try {
      await onMutate(action, version, caseId);
      after?.();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      guard.current = false;
      setSaving(false);
    }
  }
  function analyze() {
    setError("");
    const evaluationHour = Number(evaluation),
      horizonHours = Number(horizon);
    if (
      !evaluation.trim() ||
      !horizon.trim() ||
      !Number.isFinite(evaluationHour) ||
      !Number.isFinite(horizonHours) ||
      evaluationHour < 0 ||
      horizonHours <= 0 ||
      evaluationHour > horizonHours ||
      horizonHours > 7200
    ) {
      setError(
        "Enter finite hours with a horizon greater than 0 and no greater than 7200, and an evaluation hour from 0 through the horizon.",
      );
      return;
    }
    if (!canAnalyze || !scenario) return;
    setConfirmation({
      caseId: selected.id,
      version: selected.version,
      action: {
        action: "analyze",
        scenarioId: scenario.id,
        evaluationHour,
        horizonHours,
      },
      title: "Confirm advisory analysis",
      label: "Analyze captured scenario",
      detail: (
        <>
          <p>
            This creates one immutable modeled analysis, not an observed outage
            or an operational authorization.
          </p>
          <dl className="cc-metadata">
            <dt>Source event</dt>
            <dd>
              {eventName(selected.eventSnapshot)} — {selected.eventId}
            </dd>
            <dt>Scenario</dt>
            <dd>
              {displayText(scenario.label)} — {scenario.id}
            </dd>
            <dt>Assumption</dt>
            <dd>{reviewDisplayText(scenario.description)}</dd>
            <dt>Source baseline</dt>
            <dd>Revision {selected.baselineRevision}</dd>
            <dt>Evaluation / horizon</dt>
            <dd>
              {evaluationHour}h / {horizonHours}h, scenario-relative
            </dd>
            <dt>Seed effect</dt>
            <dd>
              {scenario.seed.provider} / {scenario.seed.service} /{" "}
              {scenario.seed.lossType}; window{" "}
              {scenario.seed.windowHours.join("–")}h; persists through{" "}
              {scenario.seed.persistsThroughHour}h
            </dd>
          </dl>
          <Sources refs={scenario.seed.sourceRefs} sources={contextSources} />
        </>
      ),
    });
  }
  function closeCase() {
    setError("");
    if (!statusNote.trim()) {
      setError(
        "Enter a tracking note explaining why this workspace case can be closed.",
      );
      return;
    }
    if (locked || !closureReady) return;
    setConfirmation({
      caseId: selected.id,
      version: selected.version,
      action: {
        action: "set_status",
        status: "closed",
        note: statusNote.trim(),
      },
      title: "Close workspace case",
      label: "Close workspace case",
      detail: (
        <>
          <p>
            All captured checklist tasks are complete and all captured decisions
            have an app review. Closing this workspace case does not remove its
            source event, establish recovery, notify partners, or authorize
            execution.
          </p>
          <p className="cc-note">{statusNote.trim()}</p>
        </>
      ),
    });
  }
  function track(status: "open" | "monitoring") {
    if (!statusNote.trim()) {
      setError("Enter a tracking note before changing case status.");
      return;
    }
    void mutate(
      { action: "set_status", status, note: statusNote.trim() },
      selected.version,
      selected.id,
      () => setStatusNote(""),
    );
  }
  return (
    <>
      <section className="cc-panel">
        <div className="cc-heading">
          <h2>{selected.title}</h2>
          <div className="cc-chips">
            <span className="cc-chip">Local priority: {selected.priority}</span>
            <span className="cc-chip">Tracking: {selected.status}</span>
          </div>
        </div>
        <p>
          {eventName(selected.eventSnapshot)} ·{" "}
          {displayText(context.provider?.label ?? "Provider unresolved")}
        </p>
        <details>
          <summary>Captured context & sources</summary>
          <dl className="cc-metadata">
            <dt>Case / version</dt>
            <dd>
              {selected.id} / {selected.version}
            </dd>
            <dt>Source event</dt>
            <dd>
              {eventName(selected.eventSnapshot)} — {selected.eventId}
            </dd>
            <dt>Provider</dt>
            <dd>
              {context.provider
                ? displayText(context.provider.label)
                : "Not captured"}
            </dd>
            <dt>Service area</dt>
            <dd>
              {context.serviceArea
                ? displayText(context.serviceArea.label)
                : "Not captured"}
            </dd>
            <dt>Captured baseline</dt>
            <dd>Revision {selected.baselineRevision}</dd>
            <dt>Created / updated</dt>
            <dd>
              <time dateTime={selected.createdAt}>{selected.createdAt}</time> /{" "}
              <time dateTime={selected.updatedAt}>{selected.updatedAt}</time>
            </dd>
          </dl>
          <p className="cc-muted">
            Captured reference-source snapshot, not live telemetry. Source
            aliases are presentation-only; identifiers and raw evidence exports
            are unchanged.
          </p>
          <Sources refs={context.sourceRefs} sources={contextSources} />
          {context.warnings.length > 0 && (
            <aside className="cc-warning">
              <h3>Context warnings</h3>
              <ul>
                {context.warnings.map((warning, index) => (
                  <li key={index}>{reviewDisplayText(warning)}</li>
                ))}
              </ul>
            </aside>
          )}
        </details>
        {!baselineMatches && (
          <p className="cc-warning">
            The source baseline differs from this case snapshot. New analysis is
            disabled; captured evidence and any existing run remain unchanged.
          </p>
        )}
        {selected.status === "closed" && (
          <p className="cc-note">
            Closed at {selected.closedAt || "timestamp not captured"}. Closure
            note: {selected.closureNote || "Not captured"}. Reopen with a
            tracking note to resume app review.
          </p>
        )}
      </section>
      {error && (
        <p className="cc-error" role="alert">
          {error}
        </p>
      )}
      {show("tasks") && (
        <section className="cc-panel">
          <h2>Saved checklist</h2>
          <p className="cc-muted">
            Checklist completion records workspace review only.
          </p>
          <div className="cc-stack">
            {selected.tasks.map((task) => (
              <label className="cc-task" key={task.id}>
                <input
                  type="checkbox"
                  checked={task.completed}
                  disabled={locked}
                  onChange={(event) =>
                    void mutate({
                      action: "set_task",
                      taskId: task.id,
                      completed: event.target.checked,
                    })
                  }
                />
                <span>
                  {displayText(task.label)}
                  {task.completedAt && (
                    <time dateTime={task.completedAt}>{task.completedAt}</time>
                  )}
                </span>
              </label>
            ))}
            {!selected.tasks.length && <p>No checklist tasks captured.</p>}
          </div>
        </section>
      )}
      {show("consequence") && (
        <section className="cc-panel">
          <h2>Consequence analysis</h2>
          <p className="cc-muted">
            Conditional modeled consequences; not observed failures. One
            analysis can be attached to this case, without replacement.
          </p>
          {selected.runId || run ? (
            <>
              <h3>Immutable captured run</h3>
              {run ? (
                <>
                  <details>
                    <summary>Captured run details & sources</summary>
                    <dl className="cc-metadata">
                      <dt>Run</dt>
                      <dd>{run.id}</dd>
                      <dt>Scenario</dt>
                      <dd>
                        {displayText(
                          context.scenarios.find(
                            (item) => item.id === run.scenarioId,
                          )?.label || run.scenarioId,
                        )}{" "}
                        — {run.scenarioId}
                      </dd>
                      <dt>Created</dt>
                      <dd>{run.createdAt || "Not captured"}</dd>
                      <dt>Baseline / model</dt>
                      <dd>
                        Revision {run.baselineRevision} /{" "}
                        {displayText(run.modelVersion)}
                      </dd>
                      <dt>Evaluation / horizon</dt>
                      <dd>
                        {run.request.evaluationHour}h /{" "}
                        {run.request.horizonHours}
                        h, scenario-relative
                      </dd>
                      <dt>Seed effect</dt>
                      <dd>
                        {run.seed.provider} / {run.seed.service} /{" "}
                        {run.seed.lossType}; window{" "}
                        {run.seed.windowHours.join("–")}h; persists through{" "}
                        {run.seed.persistsThroughHour}h
                      </dd>
                    </dl>
                    <Sources refs={run.seed.sourceRefs} sources={sources} />
                    {run.warnings.length > 0 && (
                      <ul>
                        {run.warnings.map((warning, index) => (
                          <li key={index}>{reviewWarning(warning)}</li>
                        ))}
                      </ul>
                    )}
                  </details>
                  <p>
                    {run.impacts.length} captured modeled impacts. Advisory
                    decision records appear below.
                  </p>
                </>
              ) : (
                <p>
                  Run {selected.runId} is attached, but its captured snapshot is
                  unavailable. Recheck workflow; analysis cannot be overwritten.
                </p>
              )}
            </>
          ) : scenarios.length ? (
            <>
              <form
                className="cc-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  analyze();
                }}
              >
                <label>
                  Linked scenario
                  <select
                    aria-label="Linked scenario"
                    value={scenario?.id || ""}
                    disabled={locked}
                    onChange={(event) => setScenarioId(event.target.value)}
                  >
                    {scenarios.map((item) => (
                      <option key={item.id} value={item.id}>
                        {displayText(item.label)} — {item.id}
                      </option>
                    ))}
                  </select>
                </label>
                {scenario && (
                  <div className="cc-note">
                    <p>{reviewDisplayText(scenario.description)}</p>
                    <p>
                      Seed: {scenario.seed.provider} / {scenario.seed.service} /{" "}
                      {scenario.seed.lossType}. Scenario-relative window{" "}
                      {scenario.seed.windowHours.join("–")}h; persists through{" "}
                      {scenario.seed.persistsThroughHour}h.
                    </p>
                    <Sources
                      refs={scenario.seed.sourceRefs}
                      sources={contextSources}
                    />
                  </div>
                )}
                <div className="cc-columns">
                  <label>
                    Evaluation hour
                    <input
                      type="number"
                      min="0"
                      max="7200"
                      step="any"
                      value={evaluation}
                      disabled={locked}
                      onChange={(event) => setEvaluation(event.target.value)}
                    />
                  </label>
                  <label>
                    Horizon hours
                    <input
                      type="number"
                      min="0"
                      max="7200"
                      step="any"
                      value={horizon}
                      disabled={locked}
                      onChange={(event) => setHorizon(event.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="cc-primary"
                  type="submit"
                  disabled={!canAnalyze}
                >
                  Analyze linked scenario…
                </button>
              </form>
            </>
          ) : (
            <p>
              No consequence linkage for this event. No unrelated scenario will
              be substituted.
            </p>
          )}
        </section>
      )}
      {(show("decisions") || mode === "consequence") && (
        <section className="cc-panel">
          <h2>Advisory decision reviews</h2>
          <div className="cc-chips">
            <span className="cc-chip">Authority not configured</span>
            <span className="cc-chip">Formal gates not evaluated</span>
          </div>
          <p className="cc-muted">
            Reviewed means app review only. These records do not approve,
            execute, dispatch, or establish recovery. Timing windows are
            scenario-relative planning intervals, not countdowns.
          </p>
          <div className="cc-stack">
            {selected.decisions.map((decision) => (
              <article className="cc-review" key={decision.id}>
                <h3>{reviewDisplayText(decision.title)}</h3>
                <p>
                  {displayText(decision.entityLabel)} /{" "}
                  {displayText(decision.functionLabel)}
                </p>
                <p>
                  Modeled state: {decision.state}. Window:{" "}
                  {decision.windowHours
                    ? `${decision.windowHours[0]}–${decision.windowHours[1]}h, scenario-relative`
                    : "Not captured"}
                  .
                </p>
                <Sources
                  refs={decision.sourceRefs}
                  sources={decision.sourceSnapshots}
                />
                <details>
                  <summary>Captured assumptions</summary>
                  {decision.assumptions.length ? (
                    <ul>
                      {decision.assumptions.map((assumption, index) => (
                        <li key={index}>{reviewDisplayText(assumption)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No assumptions captured.</p>
                  )}
                </details>
                {decision.reviewed ? (
                  <div className="cc-note">
                    <p>
                      Advisory app review recorded
                      {decision.reviewedAt
                        ? ` at ${decision.reviewedAt}`
                        : " (timestamp not captured)"}
                      .
                    </p>
                    <p>{decision.reviewNote || "Review note not captured"}</p>
                  </div>
                ) : (
                  <form
                    className="cc-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const reviewNote = (
                        reviewNotes[decision.id] || ""
                      ).trim();
                      if (!reviewNote) {
                        setError(
                          "Enter a nonempty advisory review note for this decision.",
                        );
                        return;
                      }
                      void mutate(
                        {
                          action: "review_decision",
                          decisionId: decision.id,
                          note: reviewNote,
                        },
                        selected.version,
                        selected.id,
                        () =>
                          setReviewNotes((notes) => ({
                            ...notes,
                            [decision.id]: "",
                          })),
                      );
                    }}
                  >
                    <label>
                      Advisory review note
                      <textarea
                        aria-label="Advisory review note"
                        required
                        value={reviewNotes[decision.id] || ""}
                        disabled={locked}
                        onChange={(event) =>
                          setReviewNotes((notes) => ({
                            ...notes,
                            [decision.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <button disabled={locked} type="submit">
                      Record advisory review
                    </button>
                  </form>
                )}
              </article>
            ))}
            {!selected.decisions.length && (
              <p>No advisory decisions captured for this case.</p>
            )}
          </div>
        </section>
      )}
      {show("coordination") && (
        <section className="cc-panel">
          <h2>Coordination notes</h2>
          <p className="cc-muted">
            Saved locally to this case. Notes are not sent to partners.
          </p>
          <form
            className="cc-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!note.trim()) {
                setError("Enter a nonempty coordination note before saving.");
                return;
              }
              void mutate(
                { action: "add_note", note: note.trim() },
                selected.version,
                selected.id,
                () => setNote(""),
              );
            }}
          >
            <label>
              Coordination note
              <textarea
                aria-label="Coordination note"
                value={note}
                required
                disabled={locked}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <button disabled={locked} type="submit">
              Save coordination note — not sent
            </button>
          </form>
          <ol className="cc-timeline">
            {selected.notes.map((item) => (
              <li key={item.id}>
                <time dateTime={item.createdAt}>{item.createdAt}</time>
                <p className="cc-user-text">{item.text}</p>
              </li>
            ))}
          </ol>
          {!selected.notes.length && <p>No saved coordination notes.</p>}
          <h3>Activity timeline</h3>
          <ol className="cc-timeline">
            {selected.activity.map((item) => (
              <li key={item.id}>
                <time dateTime={item.createdAt}>{item.createdAt}</time>
                <span className="cc-chip">{item.kind}</span>
                <p className="cc-user-text">{item.message}</p>
              </li>
            ))}
          </ol>
          {!selected.activity.length && <p>No activity captured.</p>}
        </section>
      )}
      <section className="cc-panel">
        <h2>Case tracking</h2>
        <p className="cc-muted">
          Local tracking only; status changes do not change source events or
          modeled evidence.
        </p>
        <label>
          Required tracking / closure note
          <textarea
            aria-label="Required tracking / closure note"
            value={statusNote}
            disabled={blocked}
            onChange={(event) => setStatusNote(event.target.value)}
          />
        </label>
        <div className="cc-actions">
          {selected.status === "closed" ? (
            <button
              type="button"
              disabled={blocked}
              onClick={() => track("open")}
            >
              Reopen workspace case
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={locked || selected.status === "open"}
                onClick={() => track("open")}
              >
                Track as open
              </button>
              <button
                type="button"
                disabled={locked || selected.status === "monitoring"}
                onClick={() => track("monitoring")}
              >
                Track as monitoring
              </button>
              <button
                type="button"
                disabled={locked || !closureReady}
                onClick={closeCase}
              >
                Close workspace case…
              </button>
            </>
          )}
        </div>
        {selected.status !== "closed" && !closureReady && (
          <p className="cc-muted">
            Complete every checklist task and record every advisory decision
            review before closure.
          </p>
        )}
      </section>
      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          label={confirmation.label}
          disabled={busy || saving}
          confirmDisabled={
            blocked ||
            selected.status === "closed" ||
            (confirmation.action.action === "analyze"
              ? !canAnalyze
              : !closureReady)
          }
          error={error}
          onCancel={() => setConfirmation(null)}
          onConfirm={() =>
            void mutate(
              confirmation.action,
              confirmation.version,
              confirmation.caseId,
              () => {
                setConfirmation(null);
                if (confirmation.action.action === "set_status")
                  setStatusNote("");
              },
            )
          }
        >
          <p className="cc-note">
            Case {confirmation.caseId} · frozen version {confirmation.version}
          </p>
          {confirmation.detail}
        </ConfirmDialog>
      )}
    </>
  );
}

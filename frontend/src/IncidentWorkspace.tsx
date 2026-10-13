import { useEffect, useId, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  FileText,
  FlaskConical,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { api, humanize } from "./api";
import { displayText } from "./presentation";
import {
  deriveIncidentDecisions,
  reviewDisplayText,
} from "./incidentDecisions";
import type { ReviewSource } from "./incidentDecisions";
import type {
  Bootstrap,
  Dependency,
  Entity,
  Event,
  Run,
  Scenario,
  ServiceFunction,
} from "./types";
import "./incident-workspace.css";

interface IncidentContext {
  baselineRevision: number;
  event: Event;
  cyberAsset: Entity | null;
  physicalAsset: Entity | null;
  facility: Entity | null;
  provider: Entity | null;
  serviceArea: Entity | null;
  downstreamDependencies: {
    dependency: Dependency;
    dependent: Entity;
    function: ServiceFunction;
  }[];
  scenarios: Scenario[];
  sourceRefs: string[];
  warnings: string[];
}
export interface IncidentWorkspaceProps {
  data: Bootstrap;
  run: Run | null;
  onOpenLab: (scenarioId?: string) => void;
  onOpenEvidence: () => void;
  onOpenBlueprint: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function stringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
function namedRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string"
  );
}
function entityRecord(value: unknown): boolean {
  return (
    namedRecord(value) &&
    isRecord(value) &&
    typeof value.type === "string" &&
    stringList(value.sourceRefs)
  );
}
function interval(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (bound) => typeof bound === "number" && Number.isFinite(bound),
    ) &&
    value[0] <= value[1]
  );
}
/** Validate the read-only boundary before showing context or enabling a scenario link. */
function validContext(
  value: unknown,
  eventId: string,
): value is IncidentContext {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.baselineRevision) ||
    !isRecord(value.event) ||
    value.event.id !== eventId
  )
    return false;
  if (
    !["label", "title", "description", "timestamp"].every(
      (key) =>
        value.event &&
        isRecord(value.event) &&
        (value.event[key] === undefined ||
          typeof value.event[key] === "string"),
    )
  )
    return false;
  if (
    value.event.sourceRefs !== undefined &&
    !stringList(value.event.sourceRefs)
  )
    return false;
  if (
    ![
      "cyberAsset",
      "physicalAsset",
      "facility",
      "provider",
      "serviceArea",
    ].every((key) => value[key] === null || entityRecord(value[key]))
  )
    return false;
  if (
    !stringList(value.sourceRefs) ||
    !stringList(value.warnings) ||
    !Array.isArray(value.downstreamDependencies) ||
    !Array.isArray(value.scenarios)
  )
    return false;
  if (
    !value.downstreamDependencies.every(
      (item) =>
        isRecord(item) &&
        entityRecord(item.dependent) &&
        namedRecord(item.function) &&
        isRecord(item.function) &&
        (item.function.sourceRefs === undefined ||
          stringList(item.function.sourceRefs)) &&
        isRecord(item.dependency) &&
        typeof item.dependency.id === "string" &&
        stringList(item.dependency.sourceRefs) &&
        typeof item.dependency.assumptionNote === "string",
    )
  )
    return false;
  return value.scenarios.every(
    (item) =>
      namedRecord(item) &&
      isRecord(item) &&
      typeof item.description === "string" &&
      isRecord(item.seed) &&
      stringList(item.seed.eventRefs) &&
      stringList(item.seed.sourceRefs) &&
      typeof item.seed.provider === "string" &&
      typeof item.seed.service === "string" &&
      typeof item.seed.lossType === "string" &&
      interval(item.seed.windowHours) &&
      typeof item.seed.persistsThroughHour === "number" &&
      Number.isFinite(item.seed.persistsThroughHour),
  );
}
function eventLabel(event: Event): string {
  return displayText(event.label ?? event.title ?? event.id);
}
function intervalLabel(window: readonly [number, number] | null): string {
  if (window === null) return "Unknown onset";
  return window[0] === window[1]
    ? `Hour ${window[0]}`
    : `Hours ${window[0]}–${window[1]}`;
}
function Sources({ sources }: { sources: readonly ReviewSource[] }) {
  return sources.length ? (
    <div className="incident-sources" aria-label="Source provenance">
      {sources.map((source, index) => (
        <details className="incident-source" key={`${source.id}-${index}`}>
          <summary>
            {source.label}
            {!source.known && " · unresolved"}
          </summary>
          <div>
            <code>{source.id}</code>
            <p>
              {source.description ??
                (source.known
                  ? "No source description recorded."
                  : "This reference is not resolved in this evidence snapshot.")}
            </p>
          </div>
        </details>
      ))}
    </div>
  ) : (
    <p className="incident-muted">No source references recorded.</p>
  );
}
function WarningList({ warnings }: { warnings: readonly string[] }) {
  return warnings.length ? (
    <ul className="incident-warnings" aria-label="Evidence warnings">
      {warnings.map((warning, index) => (
        <li key={index}>{reviewDisplayText(warning)}</li>
      ))}
    </ul>
  ) : null;
}

export default function IncidentWorkspace({
  data,
  run,
  onOpenLab,
  onOpenEvidence,
  onOpenBlueprint,
}: IncidentWorkspaceProps) {
  const inputId = useId();
  const defaultEvent =
    data.events.find((event) => event.id === "event-dosing") ?? data.events[0];
  const [requestedEventId, setRequestedEventId] = useState(
    defaultEvent?.id ?? "",
  );
  const event =
    data.events.find((item) => item.id === requestedEventId) ?? defaultEvent;
  const eventId = event?.id ?? "";
  const [context, setContext] = useState<IncidentContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [requestedScenarioId, setRequestedScenarioId] = useState("");

  useEffect(() => {
    let active = true;
    setError("");
    setLoading(!!eventId);
    if (!eventId) {
      setContext(null);
      return;
    }
    api<unknown>(`/v1/incident-context?eventId=${encodeURIComponent(eventId)}`)
      .then((result) => {
        if (!active) return;
        if (!validContext(result, eventId))
          throw new Error(
            "Incident context is incomplete or invalid. No consequence is assumed.",
          );
        setContext(result);
      })
      .catch((failure: unknown) => {
        if (active) {
          setContext(null);
          setError(
            failure instanceof Error
              ? failure.message
              : "Incident context could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, data.baselineRevision, reloadKey]);

  const stale =
    !!context &&
    context.event.id === eventId &&
    context.baselineRevision !== data.baselineRevision;
  const currentContext =
    !error && context?.event.id === eventId && !stale ? context : null;
  const matchedScenarios = useMemo(
    () =>
      currentContext?.scenarios.filter((scenario) =>
        scenario.seed.eventRefs.includes(eventId),
      ) ?? [],
    [currentContext, eventId],
  );
  const scenario =
    matchedScenarios.find((item) => item.id === requestedScenarioId) ??
    matchedScenarios[0];
  const review = useMemo(
    () =>
      deriveIncidentDecisions(
        run,
        eventId,
        matchedScenarios.map((item) => item.id),
      ),
    [run, eventId, matchedScenarios],
  );
  const sourceRecords = (refs: readonly string[]): ReviewSource[] =>
    refs.map((id) => {
      const source = data.sources.find((item) => item.id === id);
      return {
        id,
        label: source
          ? displayText(source.label ?? source.title ?? id)
          : `Unknown source (${id})`,
        description: source?.description
          ? reviewDisplayText(source.description)
          : null,
        known: !!source,
      };
    });
  const stages = currentContext
    ? [
        {
          title: "Cyber asset",
          relation: "Event seenOn",
          entity: currentContext.cyberAsset,
        },
        {
          title: "Physical asset",
          relation: "Cyber hostedBy",
          entity: currentContext.physicalAsset,
        },
        {
          title: "Facility",
          relation: "Physical partOf",
          entity: currentContext.facility,
        },
        {
          title: "Provider",
          relation: "Facility partOf",
          entity: currentContext.provider,
        },
        {
          title: "Service area",
          relation: "Provider serves",
          entity: currentContext.serviceArea,
        },
      ]
    : [];

  return (
    <div className="incident-workspace">
      <header className="incident-header">
        <div>
          <p className="incident-eyebrow">Read-only incident workspace</p>
          <h2 className="incident-title">From evidence to decision review</h2>
          <p>
            Inspect an event’s infrastructure context, then review conditional
            consequences. Context is not proof of compromise or an actual
            outage.
          </p>
        </div>
        <div className="incident-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onOpenEvidence}
          >
            <FileText size={16} aria-hidden="true" />
            Inspect evidence
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={onOpenBlueprint}
          >
            <BookOpen size={16} aria-hidden="true" />
            View blueprint
          </button>
        </div>
      </header>
      <section
        className="card incident-event"
        aria-labelledby={`${inputId}-event-heading`}
      >
        <div className="incident-section-head">
          <h2 id={`${inputId}-event-heading`}>1 · Recorded event</h2>
          <span className="incident-tag">
            Baseline version {data.baselineRevision}
          </span>
        </div>
        <label className="incident-field" htmlFor={`${inputId}-event`}>
          Select event
          <select
            id={`${inputId}-event`}
            aria-label="Select event"
            value={eventId}
            onChange={(change) => setRequestedEventId(change.target.value)}
            disabled={!data.events.length}
          >
            {!data.events.length && (
              <option value="">No events available</option>
            )}
            {data.events.map((item) => (
              <option key={item.id} value={item.id}>
                {eventLabel(item)}
              </option>
            ))}
          </select>
        </label>
        {event ? (
          <>
            <h3>{eventLabel(event)}</h3>
            <p>
              {displayText(
                event.description ?? "No event description recorded.",
              )}
            </p>
            <p className="incident-muted">
              Event <code>{event.id}</code>
              {event.timestamp ? (
                <>
                  {" "}
                  · Recorded{" "}
                  <time dateTime={event.timestamp}>{event.timestamp}</time>
                </>
              ) : (
                " · Recorded time unknown"
              )}
            </p>
            <Sources sources={sourceRecords(event.sourceRefs ?? [])} />
          </>
        ) : (
          <p>
            No event records are available. Infrastructure and consequence
            coverage are unknown.
          </p>
        )}
      </section>

      <section
        className="card incident-context"
        aria-labelledby={`${inputId}-context-heading`}
        aria-busy={loading}
      >
        <div className="incident-section-head">
          <h2 id={`${inputId}-context-heading`}>2 · Infrastructure context</h2>
          <button
            type="button"
            className="button secondary"
            onClick={() => setReloadKey((key) => key + 1)}
            disabled={loading || !eventId}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {loading ? "Refreshing…" : "Refresh context"}
          </button>
        </div>
        <div role="status" aria-live="polite">
          {loading && <p>Loading context for the selected event…</p>}
          {stale && (
            <p className="incident-notice">
              Context version {context?.baselineRevision} differs from baseline
              version {data.baselineRevision}. Outdated context and decision
              cards are withheld; refresh is required.
            </p>
          )}
        </div>
        {error && (
          <div className="incident-notice" role="alert">
            <p>{displayText(error)}</p>
            <button
              type="button"
              className="button secondary"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Retry context
            </button>
          </div>
        )}
        {!loading && !error && !currentContext && !stale && (
          <p>Context is unknown. No operational consequence is assumed.</p>
        )}
        {currentContext && (
          <>
            <ol
              className="incident-ribbon"
              aria-label="Event to infrastructure context"
            >
              {stages.map((stage, index) => (
                <li key={stage.title}>
                  <p className="incident-eyebrow">{stage.title}</p>
                  <h3>
                    {stage.entity ? displayText(stage.entity.label) : "Unknown"}
                  </h3>
                  <p className="incident-relation">{stage.relation}</p>
                  {stage.entity && <code>{stage.entity.id}</code>}
                  <Sources
                    sources={sourceRecords(stage.entity?.sourceRefs ?? [])}
                  />
                  {index < stages.length - 1 && (
                    <ArrowRight
                      className="incident-ribbon-arrow"
                      size={16}
                      aria-hidden="true"
                    />
                  )}
                </li>
              ))}
            </ol>
            <WarningList warnings={currentContext.warnings} />
            <details className="incident-detail">
              <summary>
                Context provenance · version {currentContext.baselineRevision}
              </summary>
              <Sources sources={sourceRecords(currentContext.sourceRefs)} />
            </details>
            <div className="incident-bridges">
              <article>
                <span className="incident-step">Bridge 1</span>
                <h3>Facility hosts cyber context</h3>
                <p>
                  {currentContext.cyberAsset &&
                  currentContext.physicalAsset &&
                  currentContext.facility
                    ? "Hosting and part-of links are present in the baseline. They locate the event, not establish its consequence."
                    : "Hosting context is incomplete. Missing links remain unknown."}
                </p>
              </article>
              <article>
                <span className="incident-step">Bridge 2</span>
                <h3>Cyber event → conditional consequence</h3>
                <p>
                  {matchedScenarios.length
                    ? `${matchedScenarios.length} scenario${matchedScenarios.length === 1 ? "" : "s"} explicitly reference this event. The physical effect remains an authored assumption.`
                    : "No scenario linked. No forced outage or unrelated scenario is selected."}
                </p>
              </article>
              <article>
                <span className="incident-step">Bridge 3</span>
                <h3>Cascade → advisory review</h3>
                <p>
                  A matching consequence run supplies interval-model evidence
                  for human review. It does not supply decision authority.
                </p>
              </article>
            </div>
            <details className="incident-detail">
              <summary>
                Downstream dependency context ·{" "}
                {currentContext.downstreamDependencies.length} links
              </summary>
              <p className="incident-muted">
                Dependency presence is not evidence of service loss.
              </p>
              {currentContext.downstreamDependencies.length ? (
                <ul className="incident-dependencies">
                  {currentContext.downstreamDependencies.map(
                    ({ dependency, dependent, function: serviceFunction }) => (
                      <li key={dependency.id}>
                        <strong>
                          {displayText(dependent.label)} ·{" "}
                          {displayText(serviceFunction.label)}
                        </strong>
                        <p>
                          <code>{dependency.id}</code> ·{" "}
                          {reviewDisplayText(dependency.assumptionNote)}
                        </p>
                        <Sources
                          sources={sourceRecords([
                            ...new Set([
                              ...dependency.sourceRefs,
                              ...dependent.sourceRefs,
                              ...(serviceFunction.sourceRefs ?? []),
                            ]),
                          ])}
                        />
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                <p>
                  No downstream links were returned. This does not establish
                  absence of operational dependencies.
                </p>
              )}
            </details>
          </>
        )}
      </section>

      <section
        className="card incident-model"
        aria-labelledby={`${inputId}-model-heading`}
      >
        <div className="incident-section-head">
          <h2 id={`${inputId}-model-heading`}>
            3 · Conditional consequence model
          </h2>
          <span className="incident-tag">Deterministic interval model</span>
        </div>
        {scenario && currentContext ? (
          <>
            {matchedScenarios.length > 1 && (
              <label className="incident-field" htmlFor={`${inputId}-scenario`}>
                Explicitly linked scenario
                <select
                  id={`${inputId}-scenario`}
                  value={scenario.id}
                  onChange={(change) =>
                    setRequestedScenarioId(change.target.value)
                  }
                >
                  {matchedScenarios.map((item) => (
                    <option key={item.id} value={item.id}>
                      {displayText(item.label)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <h3>{displayText(scenario.label)}</h3>
            <p>{displayText(scenario.description)}</p>
            <p className="incident-muted">
              Assumed {humanize(scenario.seed.lossType)} ·{" "}
              {humanize(scenario.seed.service)} ·{" "}
              {intervalLabel(scenario.seed.windowHours)} onset · Persists
              through scenario hour {scenario.seed.persistsThroughHour}
            </p>
            <Sources sources={sourceRecords(scenario.seed.sourceRefs)} />
            <button
              type="button"
              className="button primary"
              onClick={() => onOpenLab(scenario.id)}
            >
              <FlaskConical size={16} aria-hidden="true" />
              Model consequences
            </button>
          </>
        ) : (
          <p>
            {loading
              ? "Scenario links will be shown after context loads."
              : "No scenario linked in the available current context. No physical effect is assumed."}
          </p>
        )}
        <p className="incident-muted">
          Modeling opens the scenario lab; it does not dispatch actions or alter
          production. Intervals are scenario-relative hours, not a live
          countdown.
        </p>
      </section>

      <section
        className="incident-review"
        aria-labelledby={`${inputId}-review-heading`}
      >
        <div className="incident-section-head">
          <div>
            <p className="incident-eyebrow">Human decision required</p>
            <h2 id={`${inputId}-review-heading`}>
              4 · Advisory decision review
            </h2>
          </div>
          <ShieldAlert size={22} aria-hidden="true" />
        </div>
        <p className="incident-notice">
          Review draft · not an approved decision record. Decision records and
          append-only audit are not persisted here. This workspace grants no
          approval or execution authority.
        </p>
        {review.status !== "ready" ? (
          <div className="card incident-empty">
            <p>
              {stale || !currentContext
                ? "Current incident context is unavailable; retained run cards are withheld."
                : review.message}
            </p>
            {run && (
              <p className="incident-muted">
                Retained run <code>{run.id}</code> · scenario{" "}
                <code>{run.scenarioId}</code> · captured baseline version{" "}
                {run.baselineRevision}
              </p>
            )}
            {scenario && (
              <button
                type="button"
                className="button secondary"
                onClick={() => onOpenLab(scenario.id)}
              >
                Open linked scenario lab
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="card incident-snapshot">
              <h3>Captured consequence evidence</h3>
              <p>
                <strong>{review.scenarioLabel}</strong> · Run{" "}
                <code>{review.runId}</code>
              </p>
              <p>
                Snapshot version {review.baselineRevision} · Model{" "}
                {review.modelVersion}
                {run?.baselineRevision !== data.baselineRevision
                  ? " · Historical snapshot; not the current baseline"
                  : " · Captured baseline snapshot"}
              </p>
              {run && (
                <p className="incident-muted">
                  Evaluated at scenario hour {run.request.evaluationHour} ·
                  Horizon {run.request.horizonHours} hours · Assumed persistence
                  through hour {run.seed.persistsThroughHour}
                </p>
              )}
              <WarningList warnings={review.warnings} />
            </div>
            <p className="incident-muted">
              {review.cards.length} affected service-function review
              {review.cards.length === 1 ? "" : "s"}, earliest known onset
              first. Unknown timing is not a safe window. Modeled state is not
              observed service status.
            </p>
            {!review.cards.length && (
              <p className="card incident-empty">
                No impact records were returned for this matching run. This is
                not confirmation that services are unaffected.
              </p>
            )}
            <div className="incident-decision-grid">
              {review.cards.map((card) => (
                <article className="card incident-decision" key={card.id}>
                  <div className="incident-section-head">
                    <span
                      className={`incident-state incident-state-${card.state}`}
                    >
                      Modeled · {humanize(card.state)}
                    </span>
                    <span className="incident-tag">Human review</span>
                  </div>
                  <h3>{card.title}</h3>
                  <p>
                    {card.functionLabel} · {humanize(card.lossType)}
                  </p>
                  <div className="incident-interval">
                    <strong>{intervalLabel(card.windowHours)}</strong>
                    <span>
                      Scenario-relative onset · {humanize(card.timingStatus)}
                    </span>
                  </div>
                  <p className="incident-muted">
                    Modeled loss-of-function fraction: {card.lossOfFunction}.
                    Not a probability or a clinical planning value.
                  </p>
                  <details className="incident-detail">
                    <summary>Inspect dependency paths and assumptions</summary>
                    {card.paths.length ? (
                      card.paths.map((path, index) => (
                        <ol
                          className="incident-path"
                          key={index}
                          aria-label={`Dependency path ${index + 1}`}
                        >
                          {path.map((step, stepIndex) => (
                            <li key={`${step.id}-${stepIndex}`}>
                              <code>{step.id}</code> · {step.label}
                              {step.assumption && <p>{step.assumption}</p>}
                            </li>
                          ))}
                        </ol>
                      ))
                    ) : (
                      <p>No dependency paths recorded.</p>
                    )}
                    <h4>Run impact assumptions</h4>
                    {card.assumptions.length ? (
                      <ul>
                        {card.assumptions.map((assumption, index) => (
                          <li key={index}>{assumption}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        No impact assumptions recorded; coverage is unknown.
                      </p>
                    )}
                  </details>
                  <Sources sources={card.sources} />
                  <WarningList warnings={card.warnings} />
                  <h4>Options for review only</h4>
                  <ul>
                    {card.options.map((option) => (
                      <li key={option}>{option}</li>
                    ))}
                  </ul>
                  <dl className="incident-authority">
                    <div>
                      <dt>Authority basis</dt>
                      <dd>{card.authorityBasis}</dd>
                    </div>
                    <div>
                      <dt>Formal G1–G5</dt>
                      <dd>{card.policyGates}</dd>
                    </div>
                  </dl>
                  <p className="incident-muted">
                    Review draft · not an approved decision record
                  </p>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => onOpenLab(run!.scenarioId)}
                  >
                    Review what-if in lab
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

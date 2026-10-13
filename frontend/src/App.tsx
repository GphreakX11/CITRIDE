import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  Droplets,
  FileText,
  FlaskConical,
  GitCompareArrows,
  Layers3,
  Link2,
  Loader2,
  Menu,
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Graph from "./Graph";
import RelationshipEditor from "./RelationshipEditor";
import { api, describe, humanize, windowLabel } from "./api";
import type {
  Bootstrap,
  Comparison,
  Dependency,
  Impact,
  Override,
  Run,
  RunSummary,
  Telemetry,
} from "./types";

type View = "overview" | "relationships" | "lab" | "evidence" | "sources";
const navigation: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Situation overview", icon: Layers3 },
  { id: "relationships", label: "Relationship model", icon: Network },
  { id: "lab", label: "Scenario lab", icon: FlaskConical },
  { id: "evidence", label: "Event evidence", icon: Activity },
  { id: "sources", label: "Sources & assumptions", icon: FileText },
];

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ initial: Dependency | null } | null>(
    null,
  );
  const [scenarioId, setScenarioId] = useState("");
  const [evaluationHour, setEvaluationHour] = useState(1);
  const [horizonHours, setHorizonHours] = useState(12);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [busy, setBusy] = useState("");
  const [selectedImpact, setSelectedImpact] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [explainError, setExplainError] = useState("");
  const [compareId, setCompareId] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [streamId, setStreamId] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [baseline, feeds, history] = await Promise.all([
        api<Bootstrap>("/v1/bootstrap"),
        api<Telemetry>("/v1/telemetry"),
        api<{ runs: RunSummary[] }>("/v1/cascade-runs"),
      ]);
      setData(baseline);
      setTelemetry(feeds);
      setRuns(history.runs);
      setScenarioId((current) => current || baseline.defaultScenarioId);
      setStreamId((current) => current || feeds.streams[0]?.id || "");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setExplanation(null);
    setExplainError("");
    if (!run || !selectedImpact) return;
    let active = true;
    api<Record<string, unknown>>(
      `/v1/explain?runId=${encodeURIComponent(run.id)}&impactId=${encodeURIComponent(selectedImpact)}`,
    )
      .then((result) => {
        if (active) setExplanation(result);
      })
      .catch((failure) => {
        if (active)
          setExplainError(
            failure instanceof Error ? failure.message : String(failure),
          );
      });
    return () => {
      active = false;
    };
  }, [run, selectedImpact]);

  async function operate(name: string, operation: () => Promise<void>) {
    setBusy(name);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy("");
    }
  }
  function changeView(next: View) {
    setView(next);
    setMobileMenu(false);
  }
  const entityLabel = (id: string) =>
    data?.entities.find((item) => item.id === id)?.label ?? id;
  const functionLabel = (id: string) =>
    data?.serviceFunctions.find((item) => item.id === id)?.label ?? id;
  const sourceLabel = (id: string) => {
    const source = data?.sources.find((item) => item.id === id);
    return source?.label ?? source?.title ?? id;
  };
  const scenario = data?.scenarios.find((item) => item.id === scenarioId);
  const inspected = data?.entities.find((item) => item.id === selectedEntity);
  const currentImpact = run?.impacts.find((item) => item.id === selectedImpact);
  const selectedStream = telemetry?.streams.find(
    (item) => item.id === streamId,
  );
  const recordKeys = [
    ...new Set(
      selectedStream?.records
        .slice(0, 20)
        .flatMap((item) => Object.keys(item)) ?? [],
    ),
  ];
  const title = navigation.find((item) => item.id === view)?.label;

  function renderSources(ids: string[]) {
    return (
      <div className="source-chips">
        {ids.map((id) => (
          <span key={id} title={id}>
            <FileText size={12} />
            {sourceLabel(id)}
          </span>
        ))}
      </div>
    );
  }
  function renderImpact(impact: Impact) {
    return (
      <tr
        key={impact.id}
        className={impact.id === selectedImpact ? "selected-row" : ""}
      >
        <td>
          <button
            className="text-button"
            onClick={() => {
              setSelectedImpact(impact.id);
              setSelectedEntity(impact.entityId);
            }}
          >
            {entityLabel(impact.entityId)}
            <ChevronRight size={14} />
          </button>
          <span className="cell-subtitle">
            {functionLabel(impact.functionId)}
          </span>
        </td>
        <td>
          <span className={`badge state-${impact.state}`}>
            {humanize(impact.state)}
          </span>
          <span className="cell-subtitle">{humanize(impact.timingStatus)}</span>
        </td>
        <td className="tabular">
          <strong>{windowLabel(impact.windowHours)}</strong>
          <span className="cell-subtitle">{humanize(impact.lossType)}</span>
        </td>
        <td className="tabular">
          {Math.round(impact.lossOfFunction * 100)}%
          <span className="cell-subtitle">Modeled function loss</span>
        </td>
        <td>
          <span className="badge modeled">MODELED</span>
        </td>
      </tr>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            changeView("overview");
          }}
        >
          <span className="brand-symbol">
            <Droplets size={24} />
          </span>
          <span>
            CITRIDE<small>INCIDENT → DECISION</small>
          </span>
        </a>
        <button
          type="button"
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        >
          <X size={20} />
        </button>
        <div className="workspace-selector">
          <span className="workspace-icon">
            <Building2 size={18} />
          </span>
          <div>
            <strong>Watershed 250</strong>
            <small>Fictional OT environment</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "nav-item active" : "nav-item"}
              aria-current={view === id ? "page" : undefined}
              onClick={() => changeView(id)}
            >
              <Icon size={18} />
              {label}
              {view === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="badge simulation">SIMULATED</span>
          <p>A synthetic exercise for exploring downstream consequences.</p>
          <div className="environment-status">
            <i />
            Local demo mode
          </div>
          <small>Human review required for decisions.</small>
        </div>
      </aside>
      {mobileMenu && (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <main>
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              type="button"
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span>Watershed 250</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-status">
            <span className="badge simulation">SIMULATED DATA</span>
            <span className="revision">
              Baseline r{data?.baselineRevision ?? "—"}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Reload model"
              title="Reload model"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">WATERSHED 250 · BETA DEMONSTRATION</div>
              <h1>
                {view === "overview"
                  ? "From incident to downstream impact"
                  : title}
              </h1>
              <p>
                {view === "overview"
                  ? "Follow a fictional water-control incident through infrastructure, dependencies, and essential services."
                  : view === "relationships"
                    ? "Build explicit service dependencies with timing, reserve assumptions, and traceable sources."
                    : view === "lab"
                      ? "Explore loss-specific consequences and compare isolated what-if runs."
                      : view === "evidence"
                        ? "Inspect coordinated synthetic events and the underlying raw telemetry."
                        : "Review the fictional evidence and assumptions behind the model."}
              </p>
            </div>
            {view === "overview" && (
              <button
                type="button"
                className="button primary"
                disabled={!data}
                onClick={() => changeView("lab")}
              >
                <FlaskConical size={17} />
                Open scenario lab
                <ArrowRight size={16} />
              </button>
            )}
            {view === "relationships" && (
              <button
                type="button"
                className="button primary"
                disabled={!data}
                onClick={() => setEditor({ initial: null })}
              >
                <Plus size={17} />
                New relationship
              </button>
            )}
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button
                type="button"
                className="text-button"
                onClick={() => setError("")}
              >
                Dismiss
              </button>
            </div>
          )}
          {!data && loading && (
            <div className="empty-state">
              <Loader2 size={28} className="spin" />
              <h2>Loading the Watershed model</h2>
              <p>Fetching relationships, sources, and telemetry.</p>
            </div>
          )}
          {!data && !loading && (
            <div className="empty-state">
              <Database size={30} />
              <h2>The model could not be loaded</h2>
              <p>Check that the demo API is running, then retry.</p>
              <button className="button primary" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {data && (
            <>
              {view === "overview" && (
                <>
                  <section className="incident-banner">
                    <div className="incident-icon">
                      <ShieldCheck size={24} />
                    </div>
                    <div>
                      <div className="banner-meta">
                        <span className="badge exercise">
                          FICTIONAL EXERCISE
                        </span>
                        <span>OT water-control scenario</span>
                      </div>
                      <h2>
                        Unusual access → controller change → water-quality drift
                      </h2>
                      <p>
                        Telemetry supplies synthetic observations. Operational
                        effects are explicitly configured scenario assumptions.
                      </p>
                    </div>
                    <span className="incident-marker">W250</span>
                  </section>
                  <div className="metric-grid">
                    <Metric
                      icon={Building2}
                      label="Infrastructure entities"
                      value={data.entities.length}
                      detail="Utilities, facilities & OT assets"
                    />
                    <Metric
                      icon={Link2}
                      label="Operational dependencies"
                      value={data.dependencies.length}
                      detail="Directed, source-labeled links"
                    />
                    <Metric
                      icon={Activity}
                      label="Synthetic events"
                      value={data.events.length}
                      detail="Coordinated incident timeline"
                    />
                    <Metric
                      icon={FlaskConical}
                      label="Configured loss scenarios"
                      value={data.scenarios.length}
                      detail="Effects are scenario assumptions"
                    />
                  </div>
                  <div className="overview-grid">
                    <Graph
                      data={data}
                      selectedId={selectedEntity}
                      onSelect={setSelectedEntity}
                      impactedIds={run?.impacts.map((item) => item.entityId)}
                    />
                    <section className="card inspector">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">Model context</span>
                          <h2>
                            {inspected
                              ? "Selected entity"
                              : "Scenario boundary"}
                          </h2>
                        </div>
                        <CircleHelp size={18} />
                      </div>
                      {inspected ? (
                        <>
                          <span className="badge muted">
                            {humanize(inspected.type)}
                          </span>
                          <h3>{inspected.label}</h3>
                          <p className="muted-text">{inspected.id}</p>
                          {inspected.terrain && (
                            <p>Operational terrain: {inspected.terrain}</p>
                          )}
                          <h4>Operational links</h4>
                          {data.dependencies
                            .filter(
                              (item) =>
                                item.provider === inspected.id ||
                                item.dependent === inspected.id,
                            )
                            .map((link) => (
                              <button
                                key={link.id}
                                type="button"
                                className="inspector-link"
                                onClick={() => setEditor({ initial: link })}
                              >
                                <span>
                                  {entityLabel(link.provider)}
                                  <ArrowRight size={12} />
                                  {entityLabel(link.dependent)}
                                </span>
                                <small>
                                  {functionLabel(link.dependentFunction)}
                                </small>
                              </button>
                            ))}
                          {!data.dependencies.some(
                            (item) =>
                              item.provider === inspected.id ||
                              item.dependent === inspected.id,
                          ) && (
                            <p>
                              No operational dependency is configured. Context
                              alone does not establish a consequence.
                            </p>
                          )}
                          <h4>Source references</h4>
                          {renderSources(inspected.sourceRefs ?? [])}
                        </>
                      ) : (
                        <>
                          <h3>Quality loss and pressure loss are separate.</h3>
                          <p>
                            Unsafe water can affect dialysis and sterilization
                            without establishing loss of fire flow.
                          </p>
                          <div className="boundary-item">
                            <i />
                            Operational dependency
                            <span>
                              Activates only for applicable loss types.
                            </span>
                          </div>
                          <div className="boundary-item">
                            <i className="spatial-dot" />
                            Spatial exposure
                            <span>
                              Candidate exposure; no computed failure.
                            </span>
                          </div>
                          <div className="boundary-item">
                            <i className="unknown-dot" />
                            Unknown reserve
                            <span>
                              Kept unknown; never silently set to zero.
                            </span>
                          </div>
                          <button
                            className="button secondary full-width"
                            onClick={() => changeView("relationships")}
                          >
                            Inspect relationships
                            <ArrowRight size={15} />
                          </button>
                        </>
                      )}
                    </section>
                  </div>
                  <section className="card">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">Exercise progression</span>
                        <h2>
                          <Clock3 size={18} />
                          Synthetic event timeline
                        </h2>
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => changeView("evidence")}
                      >
                        View evidence
                        <ArrowRight size={15} />
                      </button>
                    </div>
                    <div className="timeline">
                      {data.events.slice(0, 6).map((event) => (
                        <div key={event.id} className="timeline-event">
                          <span className="timeline-time">
                            {typeof event.relativeTimeHours === "number"
                              ? `T${event.relativeTimeHours >= 0 ? "+" : ""}${event.relativeTimeHours}h`
                              : (event.timestamp?.slice(11, 16) ?? "Event")}
                          </span>
                          <span className="timeline-point" />
                          <strong>
                            {event.label ?? event.title ?? event.id}
                          </strong>
                          <p>{event.description}</p>
                          <span className="badge simulation small">
                            SIMULATED OBSERVATION
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {view === "relationships" && (
                <>
                  <div className="notice">
                    <Link2 size={20} />
                    <div>
                      <strong>Dependencies carry consequences.</strong>
                      <p>
                        Ownership and location provide context. This table
                        contains the explicit operational links used by the
                        cascade engine.
                      </p>
                    </div>
                  </div>
                  <section className="card">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">
                          Baseline r{data.baselineRevision}
                        </span>
                        <h2>
                          {data.dependencies.length} operational relationships
                        </h2>
                      </div>
                      <span className="badge simulation">SIMULATED</span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Provider → dependent</th>
                            <th>Function & applicable losses</th>
                            <th>Delay</th>
                            <th>Usable backup</th>
                            <th>Revision</th>
                            <th>
                              <span className="visually-hidden">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.dependencies.map((link) => (
                            <tr key={link.id}>
                              <td>
                                <strong>{entityLabel(link.provider)}</strong>
                                <span className="cell-subtitle arrow-line">
                                  <ArrowRight size={12} />
                                  {entityLabel(link.dependent)}
                                </span>
                              </td>
                              <td>
                                {functionLabel(link.dependentFunction)}
                                <span className="cell-subtitle">
                                  {link.lossTypes.map(humanize).join(" · ")}
                                </span>
                              </td>
                              <td className="tabular">
                                {windowLabel([
                                  link.propagationDelayMinHours,
                                  link.propagationDelayMaxHours,
                                ])}
                              </td>
                              <td className="tabular">
                                {link.usableBackupMinHours === null ||
                                link.usableBackupMaxHours === null
                                  ? "Unknown"
                                  : windowLabel([
                                      link.usableBackupMinHours,
                                      link.usableBackupMaxHours,
                                    ])}
                                <span className="cell-subtitle">
                                  {link.validForLossTypes
                                    .map(humanize)
                                    .join(" · ") || "No credited loss types"}
                                </span>
                              </td>
                              <td>r{link.revision}</td>
                              <td>
                                <button
                                  type="button"
                                  className="button secondary small-button"
                                  aria-label={`Edit dependency from ${entityLabel(link.provider)} to ${entityLabel(link.dependent)}`}
                                  onClick={() => setEditor({ initial: link })}
                                >
                                  Inspect / edit
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <div className="method-grid">
                    <div className="card method-card">
                      <span>01</span>
                      <h3>Stage a proposal</h3>
                      <p>
                        Set endpoints, functions, applicability, timing,
                        reserve, and evidence.
                      </p>
                    </div>
                    <div className="card method-card">
                      <span>02</span>
                      <h3>Validate the model</h3>
                      <p>
                        Check references, ranges, service alignment, and
                        unsupported topology.
                      </p>
                    </div>
                    <div className="card method-card">
                      <span>03</span>
                      <h3>Promote deliberately</h3>
                      <p>
                        Update the local baseline. Previously saved runs keep
                        their original evidence.
                      </p>
                    </div>
                  </div>
                </>
              )}

              {view === "lab" && (
                <>
                  <section className="card scenario-controls">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">Run configuration</span>
                        <h2>
                          <SlidersHorizontal size={18} />
                          Evaluate a configured scenario
                        </h2>
                      </div>
                      <span className="badge modeled">MODELED EFFECTS</span>
                    </div>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void operate("Running", async () => {
                          const result = await api<Run>("/v1/cascade-runs", {
                            scenarioId,
                            evaluationHour,
                            horizonHours,
                            overrides,
                          });
                          setRun(result);
                          setSelectedImpact(result.impacts[0]?.id ?? null);
                          setComparison(null);
                          setCompareId("");
                          setRuns(
                            (
                              await api<{ runs: RunSummary[] }>(
                                "/v1/cascade-runs",
                              )
                            ).runs,
                          );
                        });
                      }}
                    >
                      <div className="scenario-form">
                        <label>
                          Loss scenario
                          <select
                            value={scenarioId}
                            onChange={(event) =>
                              setScenarioId(event.target.value)
                            }
                          >
                            {data.scenarios.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Evaluate at hour
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            required
                            value={evaluationHour}
                            onChange={(event) =>
                              setEvaluationHour(Number(event.target.value))
                            }
                          />
                        </label>
                        <label>
                          Look-ahead horizon (hours)
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            required
                            value={horizonHours}
                            onChange={(event) =>
                              setHorizonHours(Number(event.target.value))
                            }
                          />
                        </label>
                        <button
                          type="submit"
                          className="button primary run-button"
                          disabled={Boolean(busy)}
                        >
                          <FlaskConical size={17} />
                          {busy === "Running"
                            ? "Computing…"
                            : "Run impact analysis"}
                        </button>
                      </div>
                      {scenario && (
                        <div className="scenario-description">
                          <p>{scenario.description}</p>
                          <div>
                            <span>
                              Seed:{" "}
                              <strong>
                                {entityLabel(scenario.seed.provider)}
                              </strong>
                            </span>
                            <span>
                              Loss:{" "}
                              <strong>
                                {humanize(scenario.seed.lossType)}
                              </strong>
                            </span>
                            <span>
                              Onset:{" "}
                              <strong>
                                {windowLabel(scenario.seed.windowHours)}
                              </strong>
                            </span>
                            <span>
                              Persists through:{" "}
                              <strong>
                                {scenario.seed.persistsThroughHour} h
                              </strong>
                            </span>
                          </div>
                          <small>
                            All times are relative to the scenario origin.
                            Evaluation state and future onset windows are
                            reported separately.
                          </small>
                        </div>
                      )}
                      <details className="what-if" open={overrides.length > 0}>
                        <summary>
                          <FlaskConical size={16} />
                          What-if reserve assumptions
                          <span>
                            {overrides.length > 0
                              ? `${overrides.length} overrides`
                              : "Optional"}
                          </span>
                        </summary>
                        <p>
                          Override usable reserve for a selected link. Runs stay
                          isolated from the baseline. Applicability rules still
                          control whether backup can be credited.
                        </p>
                        {overrides.map((override, index) => (
                          <div className="override-row" key={index}>
                            <label>
                              Dependency
                              <select
                                value={override.dependencyId}
                                onChange={(event) =>
                                  setOverrides((current) =>
                                    current.map((item, position) =>
                                      position === index
                                        ? {
                                            ...item,
                                            dependencyId: event.target.value,
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              >
                                {data.dependencies.map((item) => (
                                  <option value={item.id} key={item.id}>
                                    {entityLabel(item.dependent)} ·{" "}
                                    {functionLabel(item.dependentFunction)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Minimum reserve (h)
                              <input
                                type="number"
                                min="0"
                                step="0.25"
                                value={override.backupMinHours ?? ""}
                                required
                                onChange={(event) =>
                                  setOverrides((current) =>
                                    current.map((item, position) =>
                                      position === index
                                        ? {
                                            ...item,
                                            backupMinHours: Number(
                                              event.target.value,
                                            ),
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              Maximum reserve (h)
                              <input
                                type="number"
                                min="0"
                                step="0.25"
                                value={override.backupMaxHours ?? ""}
                                required
                                onChange={(event) =>
                                  setOverrides((current) =>
                                    current.map((item, position) =>
                                      position === index
                                        ? {
                                            ...item,
                                            backupMaxHours: Number(
                                              event.target.value,
                                            ),
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              Assumption note
                              <input
                                value={override.note}
                                required
                                placeholder="Explain this fictional reserve"
                                onChange={(event) =>
                                  setOverrides((current) =>
                                    current.map((item, position) =>
                                      position === index
                                        ? { ...item, note: event.target.value }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <button
                              className="icon-button"
                              type="button"
                              aria-label={`Remove override ${index + 1}`}
                              onClick={() =>
                                setOverrides((current) =>
                                  current.filter(
                                    (_, position) => position !== index,
                                  ),
                                )
                              }
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        ))}
                        <button
                          className="button secondary small-button"
                          type="button"
                          onClick={() =>
                            setOverrides((current) => [
                              ...current,
                              {
                                dependencyId: data.dependencies[0].id,
                                backupMinHours: 6,
                                backupMaxHours: 6,
                                note: "",
                              },
                            ])
                          }
                        >
                          <Plus size={15} />
                          Add reserve override
                        </button>
                      </details>
                    </form>
                  </section>
                  {run ? (
                    <>
                      <div className="run-heading">
                        <div>
                          <span className="eyebrow">
                            IMMUTABLE RUN · BASELINE r{run.baselineRevision}
                          </span>
                          <h2>
                            {data.scenarios.find(
                              (item) => item.id === run.scenarioId,
                            )?.label ?? run.scenarioId}
                          </h2>
                          <p>
                            Evaluation T+{run.request.evaluationHour} h ·
                            Horizon {run.request.horizonHours} h ·{" "}
                            {run.impacts.length} modeled consequences
                          </p>
                        </div>
                        <code>{run.id}</code>
                      </div>
                      {run.warnings.length > 0 && (
                        <div className="alert warning" role="status">
                          <strong>Model review required</strong>
                          <ul>
                            {run.warnings.map((warning, index) => (
                              <li key={index}>{describe(warning)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="result-grid">
                        <section className="card result-table">
                          <div className="panel-heading">
                            <div>
                              <span className="eyebrow">
                                Downstream consequences
                              </span>
                              <h2>Function impact windows</h2>
                            </div>
                            <span className="badge modeled">
                              NOT OBSERVED FAILURES
                            </span>
                          </div>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Facility / function</th>
                                  <th>State at evaluation</th>
                                  <th>Onset window</th>
                                  <th>Function loss</th>
                                  <th>Evidence</th>
                                </tr>
                              </thead>
                              <tbody>{run.impacts.map(renderImpact)}</tbody>
                            </table>
                          </div>
                          {run.impacts.length === 0 && (
                            <div className="empty-state small-empty">
                              <h3>No downstream impact predicted</h3>
                              <p>
                                Inspect the exclusions for applicability,
                                recovery, or horizon limits.
                              </p>
                            </div>
                          )}
                          <details className="excluded">
                            <summary>
                              {run.excluded.length} excluded or untriggered
                              paths
                            </summary>
                            <ul>
                              {run.excluded.map((item, index) => (
                                <li key={index}>{describe(item)}</li>
                              ))}
                            </ul>
                          </details>
                        </section>
                        <section className="card impact-inspector">
                          <div className="panel-heading">
                            <div>
                              <span className="eyebrow">
                                Explain this result
                              </span>
                              <h2>
                                {currentImpact
                                  ? functionLabel(currentImpact.functionId)
                                  : "Select a consequence"}
                              </h2>
                            </div>
                            <FileText size={18} />
                          </div>
                          {currentImpact ? (
                            <>
                              <h3>{entityLabel(currentImpact.entityId)}</h3>
                              <div className="impact-window">
                                <Clock3 size={20} />
                                <strong>
                                  {windowLabel(currentImpact.windowHours)}
                                </strong>
                                <span>Modeled onset window</span>
                              </div>
                              <p className="muted-text">
                                {humanize(currentImpact.timingStatus)} at T+
                                {run.request.evaluationHour} h. Evidence status:{" "}
                                {currentImpact.evidenceStatus}.
                              </p>
                              <h4>Causal paths</h4>
                              {currentImpact.paths.map((path, index) => (
                                <div className="path" key={index}>
                                  {path.map((id, step) => (
                                    <span key={`${id}-${step}`}>
                                      <code>{id}</code>
                                      {step < path.length - 1 && (
                                        <ArrowRight size={13} />
                                      )}
                                    </span>
                                  ))}
                                </div>
                              ))}
                              <h4>Assumptions</h4>
                              <ul className="assumption-list">
                                {currentImpact.assumptions.map(
                                  (item, index) => (
                                    <li key={index}>{item}</li>
                                  ),
                                )}
                              </ul>
                              <h4>Sources</h4>
                              {renderSources(currentImpact.sourceRefs)}
                              {explainError && (
                                <p className="error-text" role="alert">
                                  {explainError}
                                </p>
                              )}
                              {!explanation && !explainError && (
                                <p className="muted-text">
                                  Loading immutable evidence…
                                </p>
                              )}
                              {explanation && (
                                <details className="snapshot">
                                  <summary>
                                    Full immutable evidence snapshot
                                  </summary>
                                  <pre>
                                    {JSON.stringify(explanation, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </>
                          ) : (
                            <p>
                              Choose a facility in the results to inspect its
                              dependencies, evidence, and assumptions.
                            </p>
                          )}
                        </section>
                      </div>
                      <section className="card comparison">
                        <div className="panel-heading">
                          <div>
                            <span className="eyebrow">
                              Isolated what-if analysis
                            </span>
                            <h2>
                              <GitCompareArrows size={18} />
                              Compare saved runs
                            </h2>
                          </div>
                        </div>
                        <div className="comparison-controls">
                          <label>
                            Compare current run with
                            <select
                              value={compareId}
                              onChange={(event) => {
                                setCompareId(event.target.value);
                                setComparison(null);
                              }}
                            >
                              <option value="">Choose a saved run…</option>
                              {runs
                                .filter((item) => item.id !== run.id)
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {data.scenarios.find(
                                      (scenarioItem) =>
                                        scenarioItem.id === item.scenarioId,
                                    )?.label ?? item.scenarioId}{" "}
                                    · r{item.baselineRevision} · {item.id}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <button
                            className="button secondary"
                            disabled={!compareId || Boolean(busy)}
                            onClick={() =>
                              void operate("Comparing", async () =>
                                setComparison(
                                  await api<Comparison>(
                                    `/v1/cascade-runs/${encodeURIComponent(run.id)}/compare?otherRunId=${encodeURIComponent(compareId)}`,
                                  ),
                                ),
                              )
                            }
                          >
                            {busy === "Comparing" ? "Comparing…" : "Compare"}
                          </button>
                        </div>
                        {comparison && (
                          <>
                            <p className="field-help">
                              Left = current run · Right = selected saved run.
                              Compare configuration and baseline revisions
                              before interpreting changes.
                            </p>
                            <div className="table-scroll">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Function</th>
                                    <th>Current onset</th>
                                    <th>Saved onset</th>
                                    <th>Current state</th>
                                    <th>Saved state</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {comparison.changes.map((item, index) => (
                                    <tr key={index}>
                                      <td>
                                        {entityLabel(item.entityId)}
                                        <span className="cell-subtitle">
                                          {functionLabel(item.functionId)}
                                        </span>
                                      </td>
                                      <td>
                                        {item.leftState === null
                                          ? "Not impacted"
                                          : windowLabel(item.leftWindowHours)}
                                      </td>
                                      <td>
                                        {item.rightState === null
                                          ? "Not impacted"
                                          : windowLabel(item.rightWindowHours)}
                                      </td>
                                      <td>
                                        {item.leftState === null
                                          ? "Not impacted"
                                          : humanize(item.leftState)}
                                      </td>
                                      <td>
                                        {item.rightState === null
                                          ? "Not impacted"
                                          : humanize(item.rightState)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {comparison.changes.length === 0 && (
                              <p className="notice compact">
                                No consequence changes between these runs.
                              </p>
                            )}
                          </>
                        )}
                      </section>
                    </>
                  ) : (
                    <section className="card empty-state">
                      <FlaskConical size={32} />
                      <h2>Explore downstream impact</h2>
                      <p>
                        Choose a loss scenario and run the model. Inspect each
                        result’s causal paths and source assumptions.
                      </p>
                    </section>
                  )}
                  {runs.length > 0 && (
                    <section className="card history">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">Saved locally</span>
                          <h2>Run history</h2>
                        </div>
                        <span className="muted-text">{runs.length} runs</span>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Scenario</th>
                              <th>Baseline</th>
                              <th>Run ID</th>
                              <th>Created (UTC)</th>
                              <th>
                                <span className="visually-hidden">Load</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {runs.map((item) => (
                              <tr key={item.id}>
                                <td>
                                  {data.scenarios.find(
                                    (scenarioItem) =>
                                      scenarioItem.id === item.scenarioId,
                                  )?.label ?? item.scenarioId}
                                </td>
                                <td>r{item.baselineRevision}</td>
                                <td>
                                  <code>{item.id}</code>
                                </td>
                                <td>{item.createdAt}</td>
                                <td>
                                  <button
                                    className="text-button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                      void operate("Loading run", async () => {
                                        const loaded = await api<Run>(
                                          `/v1/cascade-runs/${encodeURIComponent(item.id)}`,
                                        );
                                        setRun(loaded);
                                        setSelectedImpact(
                                          loaded.impacts[0]?.id ?? null,
                                        );
                                        setComparison(null);
                                        setCompareId("");
                                      })
                                    }
                                  >
                                    Load
                                    <ArrowRight size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}

              {view === "evidence" && (
                <>
                  <div className="notice">
                    <Activity size={20} />
                    <div>
                      <strong>
                        Synthetic observations are separate from modeled
                        effects.
                      </strong>
                      <p>
                        Network probing establishes activity. It does not
                        establish an outage. A scenario seed explicitly
                        activates each modeled physical effect.
                      </p>
                    </div>
                  </div>
                  <section className="card">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">Coordinated timeline</span>
                        <h2>{data.events.length} synthetic events</h2>
                      </div>
                      <span className="badge simulation">SIMULATED</span>
                    </div>
                    <div className="event-list">
                      {data.events.map((event) => (
                        <article key={event.id} className="event-card">
                          <div className="event-time">
                            <Clock3 size={17} />
                            <strong>
                              {typeof event.relativeTimeHours === "number"
                                ? `T${event.relativeTimeHours >= 0 ? "+" : ""}${event.relativeTimeHours}h`
                                : "Time unknown"}
                            </strong>
                            <small>{event.timestamp}</small>
                          </div>
                          <div>
                            <h3>{event.label ?? event.title ?? event.id}</h3>
                            <p>{event.description}</p>
                            {renderSources(event.sourceRefs ?? [])}
                            <details>
                              <summary>Event record</summary>
                              <pre>{JSON.stringify(event, null, 2)}</pre>
                            </details>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                  <section className="card telemetry">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">
                          Raw evidence · outside the knowledge graph
                        </span>
                        <h2>
                          <Database size={18} />
                          Telemetry streams
                        </h2>
                      </div>
                    </div>
                    <div className="telemetry-controls">
                      <label>
                        Stream
                        <select
                          value={streamId}
                          onChange={(event) => setStreamId(event.target.value)}
                        >
                          {telemetry?.streams.map((stream) => (
                            <option key={stream.id} value={stream.id}>
                              {stream.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedStream && (
                        <div>
                          <strong>
                            {selectedStream.records.length} records
                          </strong>
                          {renderSources([selectedStream.sourceRef])}
                        </div>
                      )}
                    </div>
                    {selectedStream && (
                      <>
                        <div className="table-scroll telemetry-table">
                          <table>
                            <thead>
                              <tr>
                                {recordKeys.map((key) => (
                                  <th key={key}>{humanize(key)}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {selectedStream.records
                                .slice(0, 100)
                                .map((record, index) => (
                                  <tr key={index}>
                                    {recordKeys.map((key) => (
                                      <td key={key}>
                                        {record[key] === undefined ||
                                        record[key] === null
                                          ? "—"
                                          : typeof record[key] === "string"
                                            ? (record[key] as string)
                                            : describe(record[key])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        {selectedStream.records.length > 100 && (
                          <p className="field-help telemetry-note">
                            Showing the first 100 records. The complete stream
                            is available through the telemetry API.
                          </p>
                        )}
                      </>
                    )}
                    {telemetry?.streams.length === 0 && (
                      <p className="notice compact">
                        No telemetry streams are configured.
                      </p>
                    )}
                  </section>
                </>
              )}

              {view === "sources" && (
                <>
                  <div className="notice">
                    <FileText size={20} />
                    <div>
                      <strong>All evidence in this demo is fictional.</strong>
                      <p>
                        These source labels describe generated datasets and
                        assumptions. They do not establish real utility behavior
                        or operational authority.
                      </p>
                    </div>
                  </div>
                  <div className="source-grid">
                    {data.sources.map((source) => (
                      <article key={source.id} className="card source-card">
                        <div className="source-title">
                          <span className="source-icon">
                            <FileText size={20} />
                          </span>
                          <span className="badge simulation">SIMULATED</span>
                        </div>
                        <h3>{source.label ?? source.title ?? source.id}</h3>
                        <code>{source.id}</code>
                        {source.description && <p>{source.description}</p>}
                        <details>
                          <summary>Source metadata</summary>
                          <pre>{JSON.stringify(source, null, 2)}</pre>
                        </details>
                      </article>
                    ))}
                  </div>
                  <section className="card">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">Model inputs</span>
                        <h2>Assumption catalog</h2>
                      </div>
                      <span className="muted-text">
                        {data.assumptions.length} records
                      </span>
                    </div>
                    <div className="assumption-records">
                      {data.assumptions.map((assumption, index) => (
                        <details key={String(assumption.id ?? index)}>
                          <summary>
                            {String(
                              assumption.label ??
                                assumption.note ??
                                assumption.id ??
                                `Assumption ${index + 1}`,
                            )}
                          </summary>
                          <pre>{JSON.stringify(assumption, null, 2)}</pre>
                        </details>
                      ))}
                    </div>
                  </section>
                  <section className="card limitations">
                    <h2>Model boundaries</h2>
                    <p>
                      This first slice evaluates directed physical dependencies.
                      Cycles, shared supply, and unresolved multi-supply groups
                      require explicit review. It does not implement
                      authenticated user roles, real utility integrations,
                      official authority approval, or decision execution.
                    </p>
                    <p>
                      Unknowns remain visible. Geographic exposure is not a
                      verified dependency. Prior runs preserve their baseline
                      snapshots when relationships change.
                    </p>
                    <a
                      className="button secondary"
                      href="/v1/graph/export"
                      download="citride-graph.nq"
                    >
                      <Database size={16} />
                      Export source-labeled RDF
                    </a>
                  </section>
                </>
              )}
              <footer className="content-footer">
                <span>CITRIDE · Watershed 250</span>
                <span>
                  Model {data.modelVersion} · Baseline r{data.baselineRevision}{" "}
                  · All inputs simulated
                </span>
              </footer>
            </>
          )}
        </div>
      </main>
      {data && editor && (
        <RelationshipEditor
          key={editor.initial?.id ?? "new"}
          data={data}
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onPromoted={refresh}
        />
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="card metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <span className="metric-icon">
        <Icon size={20} />
      </span>
    </div>
  );
}

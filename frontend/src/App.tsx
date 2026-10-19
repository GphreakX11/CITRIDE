import { caseSelectionLocation } from "./caseIncidentSelection.ts";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
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
import ReasoningView from "./ReasoningView";
import OntologyBlueprint from "./OntologyBlueprint";
import IncidentWorkspace from "./IncidentWorkspace";
import CommandWorkspace from "./CommandWorkspace";
import { commandNavigation, analystNavigation } from "./commandTypes";
import { modeForView, modeLanding, type WorkspaceMode } from "./navigation";
import "./workspace-modes.css";
import NetworkEvidence from "./NetworkEvidence";
import type { CommandView, CommandIncident } from "./commandTypes";
import type { WorkspaceSnapshot } from "./workspaceTypes";
import { defaultIncidentId } from "./incidentSelection.ts";
import { readIncidentFocus } from "./incidentFocus.ts";
import type { RecordsState } from "./scriptedTypes.ts";
import { configureDisplayTime } from "./displayTime.ts";
import InvestigationBar from "./InvestigationBar";
import {
  caseFocusEntity,
  evidenceForContext,
  caseSelectionAfterRead,
} from "./investigationContext";
import { initialMapView } from "./mapViewState";
import { ApiError, api, describe, humanize, windowLabel } from "./api";

import { displayText } from "./presentation";
import { reviewDisplayText } from "./incidentDecisions";
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

import { prototypeLocation, readPrototypeLocation } from "./prototypeLocation";
import "./screen-shell.css";

type View =
  | CommandView
  | "overview"
  | "incident"
  | "blueprint"
  | "relationships"
  | "reasoning"
  | "lab"
  | "evidence"
  | "sources";
const navigation: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Situation overview", icon: Layers3 },
  { id: "incident", label: "Incident → decision", icon: ShieldCheck },
  { id: "relationships", label: "Relationship model", icon: Network },
  { id: "blueprint", label: "Ontology blueprint", icon: BookOpen },
  { id: "reasoning", label: "Ontology reasoning", icon: BookOpen },
  { id: "lab", label: "Scenario lab", icon: FlaskConical },
  { id: "evidence", label: "Event evidence", icon: Activity },
  { id: "sources", label: "Sources & assumptions", icon: FileText },
];

function AccessState({ issue, retry }: { issue: ApiError; retry: () => void }) {
  if (issue.code === "auth_not_configured") {
    return (
      <section
        className="empty-state access-state"
        aria-labelledby="access-title"
      >
        <ShieldCheck size={30} />
        <h2 id="access-title">Configure workspace access</h2>
        <p>
          The deployment owner needs to configure a password before this hosted
          workspace can open.
        </p>
        <ol className="setup-steps">
          <li>
            Open the existing CITRIDE project in Vercel, then go to Settings →
            Environment Variables.
          </li>
          <li>
            Configure the workspace username and password using the deployment
            guide.
          </li>
          <li>
            Select the Production and Preview environments you use. If Vercel
            offers a service selector, choose <code>backend</code>.
          </li>
          <li>Redeploy the project, then check setup below.</li>
        </ol>
        <p>Share workspace credentials only with your invited viewers.</p>
        <button className="button primary" onClick={retry}>
          <RefreshCw size={16} />
          Check setup
        </button>
      </section>
    );
  }
  if (issue.code === "database_not_configured") {
    return (
      <section
        className="empty-state access-state"
        aria-labelledby="access-title"
      >
        <Database size={30} />
        <h2 id="access-title">Connect the workspace database</h2>
        <p>
          The deployment owner needs to add a Postgres connection so the
          workspace can save relationships and run history.
        </p>
        <ol className="setup-steps">
          <li>
            Open the existing CITRIDE project in Vercel, then go to Settings →
            Environment Variables.
          </li>
          <li>
            Set <code>CITRIDE_DATABASE_URL</code> to your Postgres connection
            string. An existing <code>DATABASE_URL</code> also works.
          </li>
          <li>
            Select the Production and Preview environments you use, and{" "}
            <code>backend</code> if Vercel offers a service selector.
          </li>
          <li>Redeploy the project, then check setup below.</li>
        </ol>
        <button className="button primary" onClick={retry}>
          <RefreshCw size={16} />
          Check setup
        </button>
      </section>
    );
  }
  return (
    <section
      className="empty-state access-state"
      aria-labelledby="access-title"
    >
      <ShieldCheck size={30} />
      <h2 id="access-title">Sign in to CITRIDE</h2>
      <p>
        Choose Sign in to open your browser’s login prompt. Use the workspace
        credentials provided by the deployment owner.
      </p>
      <p>Your Vercel dashboard sign-in is separate from workspace access.</p>
      <div className="access-actions">
        <a className="button primary" href="/v1/login">
          Sign in
        </a>
        <button className="button" onClick={retry}>
          Reload after signing in
        </button>
      </div>
    </section>
  );
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessIssue, setAccessIssue] = useState<ApiError | null>(null);
  const [view, setView] = useState<View>(
    () => readPrototypeLocation(window.location.href).view as View,
  );
  const [mode, setMode] = useState<WorkspaceMode>(
    () => readPrototypeLocation(window.location.href).mode,
  );
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    try {
      return localStorage.getItem("citride.advanced.open") === "true";
    } catch {
      return false;
    }
  });
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    () => readPrototypeLocation(window.location.href).caseId,
  );
  const [caseRecords, setCaseRecords] = useState<CommandIncident[]>([]);
  const caseRecordsRef = useRef<CommandIncident[]>([]);
  const selectionInitialized = useRef(
    mode !== "command" ||
      readPrototypeLocation(window.location.href).explicitFocus ||
      new URL(window.location.href).searchParams.has("case") ||
      new URL(window.location.href).searchParams.has("entity"),
  );
  const casesRead = useRef(false);
  const [mapState, setMapState] = useState(initialMapView);
  const [workflowLocked, setWorkflowLocked] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(
    () => readPrototypeLocation(window.location.href).entityId,
  );
  const [editor, setEditor] = useState<{
    initial: Dependency | null;
    prefill?: { entityId: string; role: "provider" | "dependent" };
  } | null>(null);
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

  function selectEntity(id: string | null) {
    if (workflowLocked) return;
    selectionInitialized.current = true;
    setSelectedEntity(id);
    // Entity exploration must not silently switch or clear the active case.
  }
  function selectCase(id: string | null) {
    selectionInitialized.current = true;
    const record = caseRecordsRef.current.find((item) => item.id === id);
    setSelectedCaseId(record?.id ?? null);
    const entityId = record ? caseFocusEntity(record, selectedEntity) : null;
    const validEntity = entityId && data?.entities.some((entity) => entity.id === entityId) ? entityId : null;
    setSelectedEntity(validEntity);
    window.history.replaceState(null, "", caseSelectionLocation(window.location.href, record ?? null, workspaceSnapshot?.records.statewideIncidents ?? [], validEntity));
    window.dispatchEvent(new Event("consequence-selection"));
    if (!record) return;
    // A new investigation should not be hidden by a previous utility's map filter.
    if (entityId !== selectedEntity)
      setMapState((current) => ({
        ...current,
        areaId: "all",
        query: "",
        direction: "all",
      }));
  }
  useEffect(() => {
    if (data && casesRead.current)
      window.history.replaceState(
        null,
        "",
        prototypeLocation(
          window.location.href,
          view,
          selectedEntity,
          selectedCaseId,
          mode,
        ),
      );
  }, [data, view, selectedEntity, selectedCaseId, caseRecords, mode]);
  useEffect(() => {
    const restore = () => {
      if (workflowLocked) return;
      const loc = readPrototypeLocation(window.location.href);
      selectionInitialized.current = true;
      setView(loc.view as View);
      setMode(loc.mode);
      setSelectedEntity(
        data?.entities.some((e) => e.id === loc.entityId) ? loc.entityId : null,
      );
      setSelectedCaseId(
        caseRecordsRef.current.some((r) => r.id === loc.caseId)
          ? loc.caseId
          : null,
      );
      setMobileMenu(false);
    };
    window.addEventListener("popstate", restore);
    window.addEventListener("consequence-selection", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("consequence-selection", restore);
    };
  }, [data, workflowLocked]);

  function receiveCases(records: CommandIncident[], sourceRecords?: RecordsState) {
    casesRead.current = true;
    caseRecordsRef.current = records;
    setCaseRecords(records);
    const chooseInitialDefault = !selectionInitialized.current;
    const perIncident = mode === "command" && view !== "command";
    const explicitIncident = readIncidentFocus(window.location.href);
    const incidentId = sourceRecords && (explicitIncident || (chooseInitialDefault && perIncident))
      ? defaultIncidentId(sourceRecords, { cases: records, data: data ?? undefined }) : null;
    const source = sourceRecords?.statewideIncidents.find(row => row.id === incidentId);
    const requestedCase = source?.caseId ?? (source && records.find(item => source.linkedEventIds?.includes(item.eventId))?.id) ?? incidentId;
    const nextId = incidentId
      ? records.find(item => item.id === requestedCase)?.id ?? null
      : caseSelectionAfterRead(
      records,
      selectedEntity,
      selectedCaseId,
      false,
    );
    selectionInitialized.current = true;
    setSelectedCaseId(nextId);
    if (chooseInitialDefault && !selectedEntity) {
      const record = records.find((item) => item.id === nextId);
      const entityId = record ? caseFocusEntity(record, null) : null;
      setSelectedEntity(
        entityId && data?.entities.some((entity) => entity.id === entityId)
          ? entityId
          : null,
      );
    }
  }
  function reportFailure(failure: unknown) {
    if (failure instanceof ApiError && failure.status === 401) {
      selectionInitialized.current = true;
      caseRecordsRef.current = [];
      setCaseRecords([]);
      setSelectedCaseId(null);
      setSelectedEntity(null);
      setMapState(initialMapView());
    }
    setError(failure instanceof Error ? failure.message : String(failure));
    setAccessIssue(
      failure instanceof ApiError &&
        (failure.status === 401 ||
          failure.code === "auth_not_configured" ||
          failure.code === "database_not_configured")
        ? failure
        : null,
    );
  }

  async function refresh() {
    setLoading(true);
    setError("");
    setAccessIssue(null);
    try {
      const [snapshot, feeds] = await Promise.all([
        api<WorkspaceSnapshot>("/v1/workspace"),
        api<Telemetry>("/v1/telemetry"),
      ]);
      configureDisplayTime(snapshot.records.operationsTimeZone);
      setWorkspaceSnapshot(snapshot);
      setData(snapshot.bootstrap);
      setTelemetry(feeds);
      setRuns(snapshot.runs);
      setScenarioId((current) => current || snapshot.bootstrap.defaultScenarioId);
    } catch (failure) {
      reportFailure(failure);
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
    setAccessIssue(null);
    try {
      await operation();
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setBusy("");
    }
  }
  function changeView(next: View) {
    if (workflowLocked) return;
    const nextMode = modeForView(next, mode);
    if (next !== view || nextMode !== mode)
      window.history.pushState(
        null,
        "",
        prototypeLocation(
          window.location.href,
          next,
          selectedEntity,
          selectedCaseId,
          nextMode,
        ),
      );
    setMode(nextMode);
    setView(next);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function switchMode(nextMode: WorkspaceMode) {
    if (workflowLocked || nextMode === mode) return;
    const nextView = modeLanding(nextMode, view, !!selectedCaseId) as View;
    window.history.pushState(
      null,
      "",
      prototypeLocation(
        window.location.href,
        nextView,
        selectedEntity,
        selectedCaseId,
        nextMode,
      ),
    );
    setMode(nextMode);
    setView(nextView);
    setMobileMenu(false);
    window.scrollTo({ top: 0 });
  }
  function openAnalyst(next: CommandView, caseId?: string | null, entityId?: string | null) {
    if (workflowLocked) return;
    if (caseId !== undefined) selectCase(caseId);
    if (entityId !== undefined) selectEntity(entityId);
    window.history.pushState(
      null,
      "",
      prototypeLocation(
        window.location.href,
        next,
        entityId !== undefined ? entityId : selectedEntity,
        caseId !== undefined ? caseId : selectedCaseId,
        "analyst",
      ),
    );
    setMode("analyst");
    setView(next);
    setMobileMenu(false);
    window.scrollTo({ top: 0 });
  }
  function openIncidentScenario(nextScenarioId?: string) {
    if (
      overrides.length &&
      !window.confirm(
        "Opening this incident in the scenario lab will clear your unsaved what-if changes. Continue?",
      )
    )
      return;
    if (nextScenarioId) {
      setScenarioId(nextScenarioId);
      setOverrides([]);
    }
    changeView("lab");
  }
  const entityLabel = (id: string) =>
    displayText(data?.entities.find((item) => item.id === id)?.label ?? id);
  const functionLabel = (id: string) =>
    data?.serviceFunctions.find((item) => item.id === id)?.label ?? id;
  const sourceLabel = (id: string) => {
    const source = data?.sources.find((item) => item.id === id);
    return displayText(source?.label ?? source?.title ?? id);
  };
  const scenario = data?.scenarios.find((item) => item.id === scenarioId);
  const inspected = data?.entities.find((item) => item.id === selectedEntity);
  const contextCase =
    caseRecords.find((item) => item.id === selectedCaseId) ?? null;
  const contextEvents = data
    ? evidenceForContext(data, contextCase, selectedEntity)
    : [];
  const currentImpact = run?.impacts.find((item) => item.id === selectedImpact);

  const workspaceNavigation =
    mode === "command" ? commandNavigation : analystNavigation;
  const commandView = [
    ...workspaceNavigation,
    { id: "case-file", label: "Case File" },
    { id: "entity-profile", label: "Entity Profile" },
  ].find((item) => item.id === view);
  const title =
    commandView?.label ?? navigation.find((item) => item.id === view)?.label;

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
            disabled={workflowLocked}
            onClick={() => {
              setSelectedImpact(impact.id);
              selectEntity(impact.entityId);
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
    <div
      data-mode={mode}
      data-view={view}
      data-workspace-mode={mode}
      className={`app-shell ${commandView ? "command-mode" : ""} workspace-${mode}`}
    >
      <header className="topbar shell-header">
        <div className="shell-brand-group">
          <button
            type="button"
            className="mobile-menu icon-button"
            aria-label="Open navigation"
            onClick={() => setMobileMenu(true)}
          >
            <Menu size={20} />
          </button>
          <a
            className="brand"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              changeView("command");
            }}
          >
            <span className="brand-symbol">
              <Droplets size={24} />
            </span>
            <span>
              CITRIDE
              <small>
                {mode === "command" ? "COMMAND CENTER" : "ANALYST WORKSPACE"}
              </small>
              <small className="shell-subtitle">
                {mode === "command"
                  ? "Texas Cyber Command · Statewide Command Center"
                  : "Analyst workspace · CTIC watch floor"}
              </small>
            </span>
          </a>
        </div>
        <nav className="workspace-mode-switch" aria-label="Workspace mode">
          <button
            type="button"
            aria-pressed={mode === "command"}
            disabled={workflowLocked}
            onClick={() => switchMode("command")}
          >
            Command Center
          </button>
          <button
            type="button"
            aria-pressed={mode === "analyst"}
            disabled={workflowLocked}
            onClick={() => switchMode("analyst")}
          >
            Analyst
          </button>
        </nav>
        <div className="topbar-status">
          <div id="workspace-header-context" className="shell-header-context">
            <span className="sample-data">
              Sample data · not connected to live systems
            </span>
          </div>
          {mode === "analyst" && !commandView && (
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
          )}
        </div>
      </header>
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <button
          type="button"
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        >
          <X size={20} />
        </button>

        <p className="shell-nav-heading">
          {mode === "command" ? "COMMAND CENTER" : "ANALYST"}
        </p>
        <nav aria-label="Main navigation">
          {workspaceNavigation.map(({ id, code, label, unit, color }) => (
            <button
              key={id}
              aria-label={`${code} ${label}${unit ? ` ${unit}` : ""}`}
              data-command-view={id}
              disabled={workflowLocked}
              className={view === id ? "nav-item active" : "nav-item"}
              aria-current={view === id ? "page" : undefined}
              onClick={() => changeView(id)}
            >
              <span className="command-nav-code" style={{ color }}>
                {code}
              </span>
              <span className="prototype-nav-label">
                {label}
                {unit && <small>{unit}</small>}
              </span>
              {view === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        {mode === "analyst" && (
          <details className="model-tools" open={advancedOpen}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                const open = !advancedOpen;
                setAdvancedOpen(open);
                try {
                  localStorage.setItem("citride.advanced.open", String(open));
                } catch {
                  /* preference storage unavailable */
                }
              }}
            >
              Advanced tools
            </summary>
            <nav aria-label="Model and evidence tools">
              {navigation.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={view === id ? "nav-item active" : "nav-item"}
                  aria-current={view === id ? "page" : undefined}
                  disabled={workflowLocked}
                  onClick={() => changeView(id)}
                >
                  <Icon size={18} />
                  {label}
                  {view === id && <span className="nav-active-dot" />}
                </button>
              ))}
            </nav>
          </details>
        )}
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
        {!commandView && (
          <div className="shell-breadcrumbs">
            <div className="breadcrumbs">
              <span>Watershed 250</span>
              <ChevronRight size={14} />
              <strong>{title}</strong>
            </div>
          </div>
        )}
        <div className="content">
          <div className="page-heading" style={mode === "command" && view === "consequence" ? { display: "none" } : undefined}>
            <div>
              {!commandView && (
                <div className="eyebrow">
                  WATERSHED 250 · INFRASTRUCTURE INTELLIGENCE
                </div>
              )}
              <h1>
                {commandView && "code" in commandView ? (
                  <>
                    {commandView.code} · {commandView.label}
                    {commandView.unit && (
                      <span className="muted-text"> {commandView.unit}</span>
                    )}
                  </>
                ) : view === "overview" ? (
                  "From incident to downstream impact"
                ) : (
                  title
                )}
              </h1>
              <p
                id="selected-incident-context"
                className="screen-incident-context"
                hidden={mode !== "command" || !commandView}
              />
              {!commandView ? (
                <p>
                  {view === "overview"
                    ? "Trace a water-control incident through infrastructure, dependencies, and essential services."
                    : view === "incident"
                      ? "Follow sourced event context into conditional consequences and human decision review."
                      : view === "blueprint"
                        ? "Explore the document-backed ontology stack and distinguish current capabilities from planned integrations."
                        : view === "relationships"
                          ? "Build explicit service dependencies with timing, reserve assumptions, and traceable sources."
                          : view === "reasoning"
                            ? "Derive and explain relationship context with a versioned OWL ontology and captured sources."
                            : view === "lab"
                              ? "Explore loss-specific consequences and compare isolated what-if runs."
                              : view === "evidence"
                                ? "Inspect the incident timeline and supporting telemetry records."
                                : "Review source provenance, evidence, and the assumptions behind the model."}
                </p>
              ) : null}
              {!commandView && (
                <span className="revision">
                  Baseline r{data?.baselineRevision ?? "—"}
                </span>
              )}
            </div>
            {view === "overview" && (
              <button
                type="button"
                className="button primary"
                disabled={!data || !!accessIssue}
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
                disabled={!data || !!accessIssue}
                onClick={() => setEditor({ initial: null })}
              >
                <Plus size={17} />
                New relationship
              </button>
            )}
          </div>
          {error && !accessIssue && (
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
          {accessIssue && (
            <AccessState issue={accessIssue} retry={() => void refresh()} />
          )}
          {!data && !loading && !accessIssue && (
            <div className="empty-state">
              <Database size={30} />
              <h2>The model could not be loaded</h2>
              <p>Check workspace connectivity, then retry.</p>
              <button className="button primary" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {data && !accessIssue && (
            <>
              {mode === "analyst" && !commandView && (
                <InvestigationBar
                  entity={inspected}
                  selectedCase={contextCase}
                  cases={caseRecords}
                  view={view}
                  locked={workflowLocked}
                  onSelectCase={(id) => {
                    if (!workflowLocked) selectCase(id);
                  }}
                  onNavigate={changeView}
                  onClear={() => {
                    if (!workflowLocked) selectEntity(null);
                  }}
                />
              )}
              {mode === "analyst" && view === "cop" && (
                <section
                  className="screen-investigation-row"
                  aria-label="Investigation navigation"
                  data-entity-id={inspected?.id ?? ""}
                  data-case-id={contextCase?.id ?? ""}
                >
                  <label className="screen-case-picker">
                    <span className="visually-hidden">Saved case</span>
                    <select
                      aria-label="Investigation case"
                      disabled={workflowLocked}
                      value={selectedCaseId ?? ""}
                      onChange={(event) => {
                        if (!workflowLocked)
                          selectCase(event.target.value || null);
                      }}
                    >
                      <option value="">Choose a saved case</option>
                      {caseRecords.map((record) => (
                        <option key={record.id} value={record.id}>
                          {record.title}
                          {record.status === "closed" ? " · closed" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <nav
                    className="screen-investigation-steps"
                    aria-label="Investigation steps"
                  >
                    {(
                      [
                        ["cop", "Map"],
                        ["cyber", "Evidence"],
                        ["consequence", "Consequences"],
                        ["coordination", "Who acts first"],
                        ["uctf", "Tasks"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        aria-current={view === id ? "page" : undefined}
                        disabled={
                          workflowLocked ||
                          ((id === "consequence" || id === "uctf") &&
                            !contextCase)
                        }
                        onClick={() => changeView(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </nav>
                  <button
                    type="button"
                    className="text-button"
                    disabled={workflowLocked}
                    onClick={() => {
                      if (!workflowLocked) selectEntity(null);
                    }}
                  >
                    Clear entity focus
                  </button>
                </section>
              )}
              <div hidden={!commandView}>
                <CommandWorkspace
                  telemetry={telemetry}
                  initialSnapshot={workspaceSnapshot}
                  mode={mode}
                  onOpenAnalyst={openAnalyst}
                  onEditDependency={(dependency, prefill) =>
                    setEditor({ initial: dependency, prefill })
                  }
                  data={data}
                  view={(commandView?.id ?? "command") as CommandView}
                  selectedId={selectedCaseId}
                  onSelect={selectCase}
                  onCasesLoaded={receiveCases}
                  onWorkflowLockChange={setWorkflowLocked}
                  selectedEntityId={selectedEntity}
                  onSelectEntity={selectEntity}
                  mapState={mapState}
                  onMapStateChange={setMapState}
                  onNavigate={changeView}
                  onOpenTool={(tool, entityId) => {
                    if (entityId) selectEntity(entityId);
                    if (tool === "lab") {
                      const selected = caseRecordsRef.current.find(
                        (r) => r.id === selectedCaseId,
                      );
                      const scenario =
                        selected?.runSnapshot?.scenarioId ??
                        selected?.contextSnapshot.scenarios[0]?.id;
                      if (scenario) {
                        if (
                          overrides.length &&
                          !window.confirm(
                            "Opening this captured scenario will clear your unsaved what-if changes. Continue?",
                          )
                        )
                          return;
                        setScenarioId(scenario);
                        setEvaluationHour(
                          selected?.runSnapshot?.request.evaluationHour ?? 1,
                        );
                        setHorizonHours(
                          selected?.runSnapshot?.request.horizonHours ?? 12,
                        );
                        setOverrides([]);
                        setRun(selected?.runSnapshot ?? null);
                      }
                    }
                    changeView(tool);
                  }}
                  onAccessFailure={reportFailure}
                />
              </div>
              {view === "overview" && (
                <>
                  <section className="incident-banner">
                    <div className="incident-icon">
                      <ShieldCheck size={24} />
                    </div>
                    <div>
                      <div className="banner-meta">
                        <span className="badge reference-source">
                          INCIDENT ANALYSIS
                        </span>
                        <span>OT water-control scenario</span>
                      </div>
                      <h2>
                        Unusual access → controller change → water-quality drift
                      </h2>
                      <p>
                        Trace event evidence into configured operational effects
                        and downstream service dependencies.
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
                      label="Incident events"
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
                      onSelect={selectEntity}
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
                          <h3>{displayText(inspected.label)}</h3>
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
                        <span className="eyebrow">Incident progression</span>
                        <h2>
                          <Clock3 size={18} />
                          Event timeline
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
                          <p>{displayText(event.description ?? "")}</p>
                          <span className="badge simulation small">
                            EVENT RECORD
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
                      <span className="badge simulation">BASELINE MODEL</span>
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
                          <p>{displayText(scenario.description ?? "")}</p>
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
                                placeholder="Document the reserve and its assumptions"
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
                              <li key={index}>
                                {reviewDisplayText(describe(warning))}
                              </li>
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
                                    <li key={index}>
                                      {reviewDisplayText(item)}
                                    </li>
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
                  {(inspected || contextCase) && (
                    <section
                      className="card context-evidence"
                      aria-label="Evidence for current investigation"
                    >
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">
                            {contextCase
                              ? `CAPTURED CASE · BASELINE R${contextCase.baselineRevision}`
                              : "EXPLICIT ASSET ASSOCIATION"}
                          </span>
                          <h2>
                            Evidence for{" "}
                            {inspected
                              ? displayText(inspected.label)
                              : "selected case"}
                          </h2>
                        </div>
                      </div>
                      {contextCase && (
                        <p>
                          {contextCase.title} · saved source snapshot, not live
                          telemetry.
                        </p>
                      )}
                      {contextEvents.map((event) => (
                        <article
                          key={event.id}
                          className="event-card"
                          data-context-event-id={event.id}
                        >
                          <div className="event-time">
                            <Clock3 size={17} />
                            <strong>
                              {event.timestamp ??
                                event.eventTime ??
                                "Time unknown"}
                            </strong>
                          </div>
                          <div>
                            <h3>
                              {displayText(
                                event.label ?? event.title ?? event.id,
                              )}
                            </h3>
                            <p>
                              {displayText(
                                event.description ?? "Description not provided",
                              )}
                            </p>
                            {renderSources(event.sourceRefs ?? [])}
                            <details>
                              <summary>
                                {contextCase
                                  ? "Captured event record"
                                  : "Event record"}
                              </summary>
                              <pre>{JSON.stringify(event, null, 2)}</pre>
                            </details>
                          </div>
                        </article>
                      ))}
                      {!contextEvents.length && (
                        <p>
                          No directly associated event or saved case is recorded
                          for this entity. Other source records below are not
                          assumed to belong to it.
                        </p>
                      )}
                    </section>
                  )}

                  <div className="notice">
                    <Activity size={20} />
                    <div>
                      <strong>
                        Event evidence is separate from modeled effects.
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
                        <h2>{data.events.length} incident events</h2>
                      </div>
                      <span className="badge simulation">EVENT RECORDS</span>
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
                            <p>{displayText(event.description ?? "")}</p>
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
                  <NetworkEvidence
                    data={data}
                    telemetry={telemetry}
                    events={
                      contextCase
                        ? [
                            ...data.events.filter(
                              (event) => event.id !== contextCase.eventId,
                            ),
                            contextCase.eventSnapshot,
                          ]
                        : data.events
                    }
                  />
                </>
              )}

              {view === "incident" && (
                <IncidentWorkspace
                  data={data}
                  run={run}
                  onOpenLab={openIncidentScenario}
                  onOpenEvidence={() => changeView("evidence")}
                  onOpenBlueprint={() => changeView("blueprint")}
                />
              )}
              {view === "blueprint" && (
                <OntologyBlueprint
                  onOpenReasoning={() => changeView("reasoning")}
                />
              )}
              {view === "reasoning" && (
                <ReasoningView data={data} selectedEntityId={selectedEntity} />
              )}
              {view === "sources" && (
                <>
                  <div className="notice">
                    <FileText size={20} />
                    <div>
                      <strong>Data provenance & intended use</strong>
                      <p>
                        Watershed 250 uses generated reference data for a
                        fictional infrastructure environment, not a live utility
                        feed. Results support scenario analysis, not verified
                        operational decisions. Original records and provenance
                        remain available in the metadata and exports.
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
                          <span className="badge simulation">
                            REFERENCE DATA
                          </span>
                        </div>
                        <h3>
                          {displayText(
                            source.label ?? source.title ?? source.id,
                          )}
                        </h3>
                        <code>{source.id}</code>
                        {source.description && (
                          <p>{displayText(source.description)}</p>
                        )}
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
                            {displayText(
                              String(
                                assumption.label ??
                                  assumption.note ??
                                  assumption.id ??
                                  `Assumption ${index + 1}`,
                              ),
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
                      The model evaluates directed physical dependencies.
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
              {!commandView && (
                <footer className="content-footer">
                  <span>CITRIDE · Watershed 250</span>
                  <span>
                    Model {displayText(data.modelVersion)} · Baseline r
                    {data.baselineRevision}
                  </span>
                </footer>
              )}
            </>
          )}
        </div>
      </main>
      {data && editor && (
        <RelationshipEditor
          key={editor.initial?.id ?? "new"}
          data={data}
          initial={editor.initial}
          prefill={editor.prefill}
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

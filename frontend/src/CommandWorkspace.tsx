import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Download, AlertTriangle } from "lucide-react";
import { api, ApiError } from "./api";
import type { Bootstrap, Event, Dependency } from "./types";
import type { WorkspaceMode } from "./navigation";
import type { MapViewState } from "./mapViewState";
import type {
  CommandAction,
  CommandActionRequest,
  CommandCreate,
  CommandIncident,
  CommandView,
} from "./commandTypes";
import { incidentBrief } from "./commandMetrics";
import CommandCasework from "./CommandCasework";
import CommandReadouts from "./CommandReadouts";
import CommandCenterViews from "./CommandCenterViews";
import AnalystEntityProfile from "./AnalystEntityProfile";
import "./command-shell.css";
import "./prototype.css";
import "./command-casework-dark.css";

type SavedRequest = { url: string; body: CommandCreate | CommandActionRequest };
export interface CommandWorkspaceProps {
  mode: WorkspaceMode;
  onOpenAnalyst: (
    view: CommandView,
    caseId?: string,
    entityId?: string,
  ) => void;
  onEditDependency: (dependency: Dependency | null) => void;
  data: Bootstrap;
  view: CommandView;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCasesLoaded: (records: CommandIncident[]) => void;
  onWorkflowLockChange: (locked: boolean) => void;
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  mapState: MapViewState;
  onMapStateChange: (state: MapViewState) => void;
  onNavigate: (view: CommandView) => void;
  onOpenTool: (
    tool:
      | "overview"
      | "relationships"
      | "evidence"
      | "blueprint"
      | "incident"
      | "lab"
      | "reasoning"
      | "sources",
    entityId?: string,
  ) => void;
  onAccessFailure: (failure: ApiError) => void;
}

export default function CommandWorkspace({
  mode,
  onOpenAnalyst,
  onEditDependency,
  data,
  view,
  selectedId,
  onSelect,
  onCasesLoaded,
  onWorkflowLockChange,
  selectedEntityId,
  onSelectEntity,
  mapState,
  onMapStateChange,
  onNavigate,
  onOpenTool,
  onAccessFailure,
}: CommandWorkspaceProps) {
  const [incidents, setIncidents] = useState<CommandIncident[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [health, setHealth] = useState<{ demoMode: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const pending = useRef<SavedRequest | null>(null);
  const writing = useRef(false);
  const active = useRef(true);
  const generation = useRef(0);
  const selectedRef = useRef(selectedId);
  const handlers = useRef({
    onSelect,
    onAccessFailure,
    onCasesLoaded,
    onWorkflowLockChange,
  });
  handlers.current = {
    onSelect,
    onAccessFailure,
    onCasesLoaded,
    onWorkflowLockChange,
  };
  selectedRef.current = selectedId;
  const selected = incidents.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    handlers.current.onWorkflowLockChange(loading || busy || uncertain);
  }, [loading, busy, uncertain]);

  const loadCases = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true);
    try {
      const response = await api<{ incidents: CommandIncident[] }>(
        "/v1/command/incidents",
      );
      if (!Array.isArray(response.incidents))
        throw new Error(
          "Incident response is invalid; casework is unavailable.",
        );
      if (!active.current || ticket !== generation.current) return;
      setIncidents(response.incidents);
      setLoaded(true);
      setRefreshedAt(new Date().toISOString());
      setRefreshFailed(false);
      handlers.current.onCasesLoaded(response.incidents);
      setError("");
      if (!pending.current) setUncertain(false);
    } catch (failure) {
      if (!active.current || ticket !== generation.current) return;
      if (failure instanceof ApiError && failure.status === 401) {
        setIncidents([]);
        setLoaded(false);
        handlers.current.onSelect(null);
        handlers.current.onAccessFailure(failure);
      }
      setError(failure instanceof Error ? failure.message : String(failure));
      setRefreshFailed(true);
      setUncertain(!!pending.current);
      throw failure;
    } finally {
      if (active.current && ticket === generation.current) setLoading(false);
    }
  }, [data.baselineRevision]);

  useEffect(() => {
    active.current = true;
    void loadCases().catch(() => {});
    return () => {
      active.current = false;
      ++generation.current;
    };
  }, [loadCases]);

  useEffect(() => {
    let current = true;
    api<{ demoMode: boolean }>("/health")
      .then((value) => {
        if (current) setHealth(value);
      })
      .catch(() => {
        if (current) setHealth(null);
      });
    return () => {
      current = false;
    };
  }, [data.baselineRevision]);
  useEffect(() => {
    const refresh = () => {
      if (
        mode === "command" &&
        !writing.current &&
        !pending.current &&
        document.visibilityState === "visible"
      )
        void loadCases().catch(() => {});
    };
    window.addEventListener("focus", refresh);
    const timer =
      mode === "command" && health?.demoMode
        ? window.setInterval(refresh, 15000)
        : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      if (timer) window.clearInterval(timer);
    };
  }, [mode, health?.demoMode, loadCases]);

  function mergeIncident(result: CommandIncident) {
    selectedRef.current = result.id;
    setIncidents((current) => [
      result,
      ...current.filter((item) => item.id !== result.id),
    ]);
    handlers.current.onCasesLoaded([
      result,
      ...incidents.filter((item) => item.id !== result.id),
    ]);
    onSelect(result.id);
  }
  async function submit(
    request: SavedRequest,
    replay = false,
  ): Promise<CommandIncident> {
    if (writing.current || (uncertain && !replay))
      throw new Error("Recheck the previous action before another change.");
    writing.current = true;
    ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    pending.current = request;
    let accepted = false;
    try {
      const result = await api<CommandIncident>(request.url, request.body);
      accepted = true;
      if (!active.current) return result;
      mergeIncident(result);
      setNotice(
        "Saved to workspace. No operational action or external notification was sent.",
      );
      // Retain the exact idempotent request until the subsequent read is proven.
      await loadCases();
      pending.current = null;
      setUncertain(false);
      return result;
    } catch (failure) {
      if (!active.current) throw failure;
      const knownRejection =
        !accepted &&
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500;
      if (knownRejection) {
        pending.current = null;
        setUncertain(false);
        if (failure.status === 409) {
          try {
            await loadCases();
          } catch {
            // A failed read remains blocked; never replay a rejected write.
          }
        }
      } else setUncertain(true);
      if (failure instanceof ApiError && failure.status === 401) {
        setIncidents([]);
        setLoaded(false);
        onSelect(null);
        onAccessFailure(failure);
      }
      setError(
        (accepted
          ? "The change was accepted, but its refresh failed. Recheck before continuing. "
          : "") +
          (failure instanceof Error ? failure.message : String(failure)),
      );
      throw failure;
    } finally {
      writing.current = false;
      if (active.current) setBusy(false);
    }
  }
  function create(request: CommandCreate) {
    return submit({ url: "/v1/command/incidents", body: request });
  }
  async function investigate(event: Event) {
    if (writing.current || busy || loading || uncertain) return;
    const existing = incidents.find(
      (record) => record.eventId === event.id && record.status !== "closed",
    );
    if (existing) {
      onSelect(existing.id);
      onNavigate("case-file");
      return;
    }
    try {
      await create({
        eventId: event.id,
        title: `Investigation — ${event.label ?? event.title ?? event.id}`,
        priority: "high",
        expectedBaselineRevision: data.baselineRevision,
        clientRequestId: crypto.randomUUID(),
      });
      onNavigate("case-file");
    } catch {
      /* existing save/retry controls retain the request */
    }
  }
  function mutate(
    action: CommandAction,
    expectedVersion: number,
    caseId: string,
  ) {
    return submit({
      url: `/v1/command/incidents/${encodeURIComponent(caseId)}/actions`,
      body: {
        ...action,
        expectedVersion,
        clientRequestId: crypto.randomUUID(),
      },
    });
  }
  async function recheck() {
    try {
      await loadCases();
      setNotice(
        pending.current
          ? "Workflow refreshed. The saved request is retained; use the same-request retry to reconcile an uncertain result without duplication."
          : "Workflow refreshed from storage.",
      );
    } catch {
      /* failure is visible, never replay a write */
    }
  }
  async function retryPending() {
    if (!pending.current) {
      await recheck();
      return;
    }
    try {
      await submit(pending.current, true);
    } catch {
      /* remain blocked until reconciled */
    }
  }
  function downloadBrief() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(incidentBrief(selected), null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selected.id}-brief.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(
      "Brief downloaded locally. It was not sent to another organization.",
    );
  }
  const focus = (id: string) => {
    if (!writing.current && !busy && !loading && !uncertain) {
      onSelect(id);
      onNavigate("case-file");
    }
  };
  const caseMode =
    view === "uctf"
      ? "tasks"
      : view === "coordination"
        ? "coordination"
        : view === "consequence"
          ? "consequence"
          : "full";
  const casework = (
    <CommandCasework
      data={data}
      incidents={incidents}
      selected={selected}
      mode={caseMode}
      onOpenEntity={(id) => {
        onSelectEntity(id);
        onNavigate("entity-profile");
      }}
      onOpenTool={(tool) => onOpenTool(tool)}
      onDownloadRecord={() => {
        if (!selected) return;
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(selected, null, 2)], {
            type: "application/json;charset=utf-8",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `${selected.id}-case-record.json`;
        a.click();
        URL.revokeObjectURL(url);
      }}
      onSelect={(id) => {
        if (!writing.current && !busy && !loading && !uncertain) onSelect(id);
      }}
      onCreate={create}
      onMutate={mutate}
      busy={busy || loading}
      uncertain={uncertain}
      onRecheck={() => void recheck()}
      onRetryPending={() => void retryPending()}
      onOpenEvidence={() => onNavigate("cyber")}
      onNavigate={(target) =>
        onNavigate(
          target === "consequence" || target === "decisions"
            ? "consequence"
            : "uctf",
        )
      }
    />
  );

  const dataStatus = (
    <div className="prototype-status" aria-label="Data status">
      <span>{health?.demoMode ? "Reference workspace" : "Workspace data"}</span>
      <span>Offline packet evidence + conditional scenarios</span>
      <span>Illustrative map positions · no live OT connection</span>
      <span>
        {refreshedAt
          ? `Updated ${new Date(refreshedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" })} CT`
          : "Update pending"}
      </span>
    </div>
  );

  if (mode === "command")
    return (
      <div
        className="command-workspace"
        data-readonly-command="true"
        data-casework-loaded={loaded}
        aria-busy={loading || busy}
      >
        {dataStatus}
        {error && (
          <div className="command-error" role="alert">
            <strong>Couldn't refresh — saved picture may be stale.</strong>
            <p>{error}</p>
            <button
              className="button secondary"
              onClick={() => void recheck()}
              disabled={loading}
            >
              Retry
            </button>
          </div>
        )}
        {!loaded ? (
          <section className="command-panel">
            <h2>
              {loading
                ? "Loading saved operating picture"
                : "Operating picture unavailable"}
            </h2>
            <p>No incident state has been assumed.</p>
          </section>
        ) : (
          <CommandCenterViews
            data={data}
            incidents={incidents}
            selected={selected}
            view={view}
            onSelect={(id) => {
              if (!busy && !loading && !uncertain) onSelect(id);
            }}
            onOpenAnalyst={onOpenAnalyst}
            onNavigate={onNavigate}
          />
        )}
      </div>
    );

  return (
    <div
      className="command-workspace"
      data-casework-loaded={loaded}
      aria-busy={loading || busy}
    >
      <div className="command-toolbar">
        <div>
          <span className="command-source-tag">
            REFERENCE MODEL · HUMAN REVIEW
          </span>
          <p>
            Case tracking and conditional planning · not a live OT command
            channel.
          </p>
        </div>
        <div className="command-toolbar-actions">
          {selected && view !== "case-file" && (
            <button
              className="button secondary"
              disabled={busy || loading || uncertain}
              onClick={() => onNavigate("case-file")}
            >
              Open full case file
            </button>
          )}
          {selected && (
            <button
              className="button secondary"
              onClick={downloadBrief}
              disabled={busy}
            >
              <Download size={16} />
              Download structured brief (JSON)
            </button>
          )}
          <button
            className="button secondary"
            onClick={() => void recheck()}
            disabled={busy || loading}
          >
            <RefreshCw size={16} />
            Refresh casework
          </button>
        </div>
      </div>
      {uncertain && pending.current && (
        <section className="command-panel" aria-label="Pending save recovery">
          <h2>Check your previous save</h2>
          <p>
            The previous save could not be fully confirmed. Other changes are
            paused to avoid duplicates. Refresh checks saved casework; retry
            uses the original request, not a new case or action. Nothing is
            retried automatically.
          </p>
          <button
            className="button primary"
            disabled={busy || loading}
            onClick={() => void retryPending()}
          >
            Retry same saved request
          </button>
        </section>
      )}
      {error && (
        <div className="command-error" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>
              {uncertain
                ? "Reconciliation required"
                : refreshFailed
                  ? "Couldn't refresh — Retry"
                  : "Change not accepted"}
            </strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      {notice && (
        <p className="command-notice" role="status">
          {notice}
        </p>
      )}
      <div className="prototype-status" aria-label="Data status">
        <span>Offline evidence + reference scenarios</span>
        <span>Illustrative map positions</span>
        <span>No live OT connection</span>
        <span>
          {refreshedAt
            ? `Refreshed ${new Date(refreshedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" })} CT`
            : "Refresh pending"}
        </span>
      </div>
      {!loaded ? (
        <section className="command-panel">
          <h2>{loading ? "Loading saved casework" : "Casework unavailable"}</h2>
          <p>
            {loading
              ? "Reading the current workspace from storage."
              : "No workflow counts are available. Refresh to retry; no incident state has been assumed."}
          </p>
        </section>
      ) : (
        <>
          {view === "entity-profile" && (
            <AnalystEntityProfile
              data={data}
              entityId={selectedEntityId}
              incidents={incidents}
              locked={busy || loading || uncertain}
              onSelectEntity={onSelectEntity}
              onOpenCase={focus}
              onOpenTool={onOpenTool}
              onEditDependency={onEditDependency}
              onBack={() => onNavigate("cop")}
            />
          )}
          {view !== "case-file" && view !== "entity-profile" && (
            <CommandReadouts
              data={data}
              incidents={incidents}
              selected={selected}
              view={view}
              refreshedAt={refreshedAt}
              onSelect={focus}
              onNavigate={onNavigate}
              onOpenTool={onOpenTool}
              selectedEntityId={selectedEntityId}
              onSelectEntity={onSelectEntity}
              mapState={mapState}
              onMapStateChange={onMapStateChange}
              onDownload={downloadBrief}
              onNote={(note) =>
                selected
                  ? mutate(
                      { action: "add_note", note },
                      selected.version,
                      selected.id,
                    )
                  : Promise.reject(new Error("Select a case first"))
              }
              onInvestigate={(event) => void investigate(event)}
              workflowLocked={busy || loading || uncertain}
            />
          )}
          {(view === "case-file" ||
            ["coordination", "uctf", "consequence"].includes(view)) &&
            casework}
        </>
      )}
    </div>
  );
}

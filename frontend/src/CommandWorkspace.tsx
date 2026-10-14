import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Download, AlertTriangle } from "lucide-react";
import { api, ApiError } from "./api";
import type { Bootstrap } from "./types";
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
import "./command-shell.css";
import "./command-casework-dark.css";

type SavedRequest = { url: string; body: CommandCreate | CommandActionRequest };
export interface CommandWorkspaceProps {
  data: Bootstrap;
  view: CommandView;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNavigate: (view: CommandView) => void;
  onOpenTool: (
    tool:
      | "overview"
      | "relationships"
      | "evidence"
      | "blueprint"
      | "incident"
      | "lab",
    entityId?: string,
  ) => void;
  onAccessFailure: (failure: ApiError) => void;
}

export default function CommandWorkspace({
  data,
  view,
  selectedId,
  onSelect,
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
  const [notice, setNotice] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [showCasework, setShowCasework] = useState(false);
  const pending = useRef<SavedRequest | null>(null);
  const writing = useRef(false);
  const active = useRef(true);
  const generation = useRef(0);
  const selectedRef = useRef(selectedId);
  const handlers = useRef({ onSelect, onAccessFailure });
  handlers.current = { onSelect, onAccessFailure };
  selectedRef.current = selectedId;
  const selected = incidents.find((item) => item.id === selectedId) ?? null;

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
      if (!response.incidents.some((item) => item.id === selectedRef.current)) {
        handlers.current.onSelect(
          response.incidents.find((item) => item.status !== "closed")?.id ??
            response.incidents[0]?.id ??
            null,
        );
      }
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
      setUncertain(true);
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
    if (view !== "command") setShowCasework(false);
  }, [view]);

  function mergeIncident(result: CommandIncident) {
    selectedRef.current = result.id;
    setIncidents((current) => [
      result,
      ...current.filter((item) => item.id !== result.id),
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
    if (!writing.current) {
      onSelect(id);
      setShowCasework(true);
      onNavigate("command");
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
      onSelect={(id) => {
        if (!writing.current) onSelect(id);
      }}
      onCreate={create}
      onMutate={mutate}
      busy={busy || loading}
      uncertain={uncertain}
      onRecheck={() => void recheck()}
      onRetryPending={() => void retryPending()}
      onOpenEvidence={() => onOpenTool("evidence")}
    />
  );

  return (
    <div className="command-workspace">
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
          {view === "command" && showCasework && (
            <button
              className="button secondary"
              onClick={() => setShowCasework(false)}
            >
              Command overview
            </button>
          )}
          <button
            className="button primary"
            disabled={!loaded || busy || loading || uncertain}
            onClick={() => {
              onSelect(null);
              setShowCasework(true);
              onNavigate("command");
            }}
          >
            Start incident
          </button>
          {selected && view === "command" && !showCasework && (
            <button
              className="button secondary"
              onClick={() => setShowCasework(true)}
            >
              Manage selected case
            </button>
          )}
          {selected && (
            <button
              className="button secondary"
              onClick={downloadBrief}
              disabled={busy}
            >
              <Download size={16} />
              Download brief
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
      {error && (
        <div className="command-error" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>
              {uncertain ? "Reconciliation required" : "Change not accepted"}
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
          {!(view === "command" && showCasework) && (
            <CommandReadouts
              data={data}
              incidents={incidents}
              selected={selected}
              view={view}
              refreshedAt={refreshedAt}
              onSelect={focus}
              onNavigate={onNavigate}
              onOpenTool={onOpenTool}
              onDownload={downloadBrief}
            />
          )}
          {((view === "command" && showCasework) ||
            ["coordination", "uctf", "consequence"].includes(view)) &&
            casework}
        </>
      )}
    </div>
  );
}

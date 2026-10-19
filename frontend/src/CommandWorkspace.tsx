import { c1OverviewModel } from "./c1OverviewModel.ts";
import { readIncidentFocus } from "./incidentFocus.ts";
import type { ConsequenceProjection } from "./consequencesModel.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Download, AlertTriangle } from "lucide-react";
import { api, ApiError } from "./api";
import type {
  Bootstrap,
  Event,
  Dependency,
  Telemetry,
  Run,
  RunRequest,
} from "./types";
import type { DependencyPrefill } from "./dependencyDraft";
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
import CommandCasework, { ConfirmDialog } from "./CommandCasework";
import { analysisIntent, type AnalysisIntent } from "./analystAnalysis";
import CommandReadouts from "./CommandReadouts";
import CommandCenterViews from "./CommandCenterViews";
import AnalystEntityProfile from "./AnalystEntityProfile";
import ScriptedAnalystViews, { LateTasks } from "./ScriptedAnalystViews";
import ResetDemoControl from "./ResetDemoControl";
import { defaultAlertPriority } from "./analystAlerts";
import { caseDisplayId } from "./caseFilePresentation";
import { displayText } from "./presentation";
import OperationsClock from "./OperationsClock";
import { configureDisplayTime } from "./displayTime.ts";
import { defaultIncidentId } from "./incidentSelection.ts";
import IncidentContextBar from "./IncidentContextBar";
import {
  potentialScope,
  potentialRequests,
  type PendingPotential,
} from "./whoActsFirst";

import type { RecordsState, ReferenceData } from "./scriptedTypes";
import type { WorkspaceSnapshot } from "./workspaceTypes";
import "./command-shell.css";
import "./prototype.css";
import "./command-casework-dark.css";

type SavedRequest = { url: string; body: CommandCreate | CommandActionRequest };
type WorkspaceRead = Pick<WorkspaceSnapshot, "incidents" | "records" | "reference"> & {
  health?: WorkspaceSnapshot["health"];
};

export function workspaceNavigationLocked(
  loaded: boolean,
  loading: boolean,
  busy: boolean,
  uncertain: boolean,
) {
  // Refreshing already-visible records must not freeze read-only navigation.
  // Save controls keep their own loading guard and uncertain writes stay locked.
  return busy || uncertain || (!loaded && loading);
}

export interface CommandWorkspaceProps {
  telemetry?: Telemetry | null;
  initialSnapshot?: WorkspaceSnapshot | null;
  mode: WorkspaceMode;
  onReturnToSource?: () => void;
  onOpenAnalyst: (
    view: CommandView,
    caseId?: string | null,
    entityId?: string | null,
  ) => void;
  onEditDependency: (
    dependency: Dependency | null,
    prefill?: DependencyPrefill,
  ) => void;
  data: Bootstrap;
  view: CommandView;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCasesLoaded: (records: CommandIncident[], sourceRecords?: RecordsState) => void;
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
  telemetry = null,
  initialSnapshot = null,
  mode,
  onReturnToSource,
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
  const initial = initialSnapshot?.bootstrap.baselineRevision === data.baselineRevision
    ? initialSnapshot : null;
  const [incidents, setIncidents] = useState<CommandIncident[]>(initial?.incidents ?? []);
  const [loaded, setLoaded] = useState(Boolean(initial));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [health, setHealth] = useState<{
    demoMode: boolean;
    resetEnabled?: boolean;
    now?: string;
  } | null>(initial?.health ?? null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [records, setRecords] = useState<RecordsState | null>(initial?.records ?? null);
  const [reference, setReference] = useState<ReferenceData | null>(initial?.reference ?? null);
  // Transport capability outlives the hydration snapshot's baseline revision.
  // Promotion/replacement must not fall back to the old multi-request path.
  const initialRef = useRef(Boolean(initialSnapshot));
  initialRef.current ||= Boolean(initialSnapshot);

  const pending = useRef<SavedRequest | null>(null);
  const pendingRun = useRef<RunRequest | null>(null);
  const pendingRunCase = useRef<string | null>(null);
  const pendingPotential = useRef<PendingPotential | null>(null);
  const [potentialResults, setPotentialResults] = useState<
    Record<string, Run[]>
  >({});
  const [lastPlanningRun, setLastPlanningRun] = useState<Run | null>(null);
  const [lastPlanningCaseId, setLastPlanningCaseId] = useState<string | null>(
    null,
  );
  const [analysisConfirmation, setAnalysisConfirmation] =
    useState<AnalysisIntent | null>(null);
  const [analysisError, setAnalysisError] = useState("");
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
    if (mode !== "command" || view === "command" || !records || selectedId) return;
    const id = defaultIncidentId(records, { cases: incidents, data });
    const row = records.statewideIncidents.find(item => item.id === id);
    const saved = incidents.find(item => item.id === (row?.caseId ?? id))
      ?? (row && !row.caseId ? incidents.find(item => row.linkedEventIds?.includes(item.eventId)) : null);
    if (saved) handlers.current.onSelect(saved.id);
  }, [mode, view, records, incidents, data, selectedId]);
  const estimateScope = potentialScope(data, selected, reference);
  const estimateContext = useRef({ scope: estimateScope, view, mode });
  estimateContext.current = { scope: estimateScope, view, mode };
  useEffect(() => {
    handlers.current.onWorkflowLockChange(workspaceNavigationLocked(loaded, loading, busy, uncertain));
  }, [loaded, loading, busy, uncertain]);

  function acceptRead(response: WorkspaceRead) {
    if (!Array.isArray(response.incidents))
      throw new Error("Incident response is invalid; casework is unavailable.");
    setIncidents(response.incidents);
    configureDisplayTime(response.records.operationsTimeZone);
    setRecords(response.records);
    setReference(response.reference);
    if (response.health) setHealth(response.health);
    setLoaded(true);
    setRefreshedAt(new Date().toISOString());
    setRefreshFailed(false);
    handlers.current.onCasesLoaded(response.incidents, response.records);
    setError("");
    if (!pending.current && !pendingRun.current && !pendingPotential.current)
      setUncertain(false);
  }

  const loadCases = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true);
    try {
      // The app supplies a coherent startup snapshot. Legacy standalone
      // embeddings without it retain their existing read contract.
      let response: WorkspaceRead;
      if (initialRef.current) {
        response = await api<WorkspaceSnapshot>("/v1/workspace");
      } else {
        const [incidents, records, reference] = await Promise.all([
          api<{ incidents: CommandIncident[] }>("/v1/command/incidents"),
          api<RecordsState>("/v1/command/records"),
          api<ReferenceData>("/v1/reference"),
        ]);
        response = { incidents: incidents.incidents, records, reference };
      }
      if (!active.current || ticket !== generation.current) return;
      acceptRead(response);
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
      setUncertain(
        !!pending.current || !!pendingRun.current || !!pendingPotential.current,
      );
      throw failure;
    } finally {
      if (active.current && ticket === generation.current) setLoading(false);
    }
  }, [data.baselineRevision]);

  useEffect(() => {
    active.current = true;
    if (initial) {
      ++generation.current;
      acceptRead(initial);
      setLoading(false);
    } else {
      void loadCases().catch(() => {});
    }
    return () => {
      active.current = false;
      ++generation.current;
    };
  }, [loadCases, initial]);

  useEffect(() => {
    if (initialRef.current) return;
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
  }, [data.baselineRevision, initial]);
  useEffect(() => {
    const refresh = () => {
      if (
        mode === "command" &&
        !writing.current &&
        !pending.current &&
        !pendingRun.current &&
        !pendingPotential.current &&
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
    if (writing.current || ((uncertain || pendingPotential.current) && !replay))
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
      setNotice("Saved to case.");
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
  async function savePlanningRun(
    request: RunRequest,
    retry = false,
  ): Promise<Run> {
    if (!retry && !selected) throw new Error("Select a case first.");
    if (writing.current || busy || loading || (uncertain && !retry))
      throw new Error("Recheck the pending save before creating another run.");
    if (
      !retry &&
      (pending.current || pendingRun.current || pendingPotential.current)
    )
      throw new Error("A saved request still needs reconciliation.");
    const body = retry
      ? pendingRun.current
      : structuredClone({
          ...request,
          expectedBaselineRevision:
            request.expectedBaselineRevision ??
            selected?.runSnapshot?.baselineRevision ??
            data.baselineRevision,
          clientRequestId: request.clientRequestId ?? crypto.randomUUID(),
        });
    if (!body)
      throw new Error("No planning request is awaiting reconciliation.");
    writing.current = true;
    ++generation.current;
    setBusy(true);
    setError("");
    pendingRun.current = body;
    if (!retry) pendingRunCase.current = selectedId;
    try {
      const saved = await api<Run>("/v1/cascade-runs", body);
      if (!saved || typeof saved.id !== "string")
        throw new Error(
          "Planning response is incomplete; reconcile the saved request.",
        );
      if (active.current) {
        setLastPlanningRun(saved);
        setLastPlanningCaseId(pendingRunCase.current);
        setNotice("Planning run saved. Captured run unchanged.");
        pendingRun.current = null;
        setUncertain(false);
      }
      return saved;
    } catch (failure) {
      if (active.current) {
        const rejected =
          failure instanceof ApiError &&
          failure.status >= 400 &&
          failure.status < 500;
        if (rejected) pendingRun.current = null;
        setUncertain(!rejected);
        setError(failure instanceof Error ? failure.message : String(failure));
        if (failure instanceof ApiError && failure.status === 401)
          onAccessFailure(failure);
      }
      throw failure;
    } finally {
      writing.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function savePotential(
    requests: RunRequest[],
    retry = false,
  ): Promise<Run[]> {
    if (
      writing.current ||
      busy ||
      loading ||
      (!retry &&
        (uncertain ||
          pending.current ||
          pendingRun.current ||
          pendingPotential.current))
    )
      throw new Error("Recheck the pending save before creating another run.");
    if (
      !retry &&
      (!selected ||
        selected.status === "closed" ||
        estimateContext.current.mode !== "analyst" ||
        estimateContext.current.view !== "coordination" ||
        estimateContext.current.scope !== estimateScope)
    )
      throw new Error("Select an open case before estimating.");
    if (!retry) {
      const expected = potentialRequests(data);
      if (
        requests.length !== 2 ||
        requests.some(
          (r, i) =>
            r.scenarioId !== expected[i].scenarioId ||
            r.expectedBaselineRevision !==
              expected[i].expectedBaselineRevision ||
            r.evaluationHour !== expected[i].evaluationHour ||
            r.horizonHours !== expected[i].horizonHours ||
            r.overrides.length ||
            !r.clientRequestId,
        ) ||
        requests[0].clientRequestId === requests[1].clientRequestId
      )
        throw new Error(
          "Potential estimate settings changed. Refresh before estimating.",
        );
      pendingPotential.current = {
        scope: estimateScope,
        caseId: selected!.id,
        requests: structuredClone(requests),
        saved: [null, null],
        complete: [false, false],
      };
    }
    const operation = pendingPotential.current;
    if (!operation) throw new Error("No estimate is awaiting reconciliation.");
    writing.current = true;
    ++generation.current;
    setBusy(true);
    handlers.current.onWorkflowLockChange(true);
    setError("");
    let posting = false;
    const publish = () =>
      setPotentialResults((current) => ({
        ...current,
        [operation.scope]: operation.saved.filter(
          (r, i): r is Run => !!r && operation.complete[i],
        ),
      }));
    try {
      for (let i = 0; i < operation.requests.length; i++) {
        if (operation.complete[i]) continue;
        if (
          !active.current ||
          (!retry &&
            (estimateContext.current.view !== "coordination" ||
              estimateContext.current.mode !== "analyst" ||
              estimateContext.current.scope !== operation.scope))
        )
          throw new Error(
            "Estimate paused. Reconcile the saved request before continuing.",
          );
        if (!operation.saved[i]) {
          posting = true;
          const saved = await api<Run>("/v1/runs", operation.requests[i]);
          posting = false;
          if (!saved || typeof saved.id !== "string")
            throw new Error(
              "Estimate response is incomplete; reconcile the saved request.",
            );
          operation.saved[i] = saved;
        }
        let saved = operation.saved[i]!;
        if (!Array.isArray(saved.impacts) || !saved.baselineSnapshot)
          saved = await api<Run>(`/v1/runs/${encodeURIComponent(saved.id)}`);
        if (
          !saved ||
          !Array.isArray(saved.impacts) ||
          !saved.baselineSnapshot ||
          saved.scenarioId !== operation.requests[i].scenarioId
        )
          throw new Error(
            "Estimate details are incomplete; reconcile the saved request.",
          );
        operation.saved[i] = saved;
        operation.complete[i] = true;
        publish();
      }
      pendingPotential.current = null;
      setUncertain(false);
      return operation.saved as Run[];
    } catch (failure) {
      // A rejected detail GET does not reject the already accepted POST.
      const rejected =
        posting &&
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500;
      if (rejected) pendingPotential.current = null;
      setUncertain(!rejected);
      setError(failure instanceof Error ? failure.message : String(failure));
      if (failure instanceof ApiError && failure.status === 401)
        onAccessFailure(failure);
      throw failure;
    } finally {
      writing.current = false;
      setBusy(false);
      handlers.current.onWorkflowLockChange(
        !!pendingPotential.current || !!pending.current || !!pendingRun.current,
      );
    }
  }
  async function investigate(event: Event) {
    if (writing.current || busy || loading || uncertain) return;
    const linked = records?.statewideIncidents.find(
      (item) => item.linkedEventIds?.includes(event.id) && item.caseId,
    );
    const existing = incidents.find(
      (record) =>
        (record.eventId === event.id || record.id === linked?.caseId) &&
        record.status !== "closed",
    );
    if (existing) {
      onSelect(existing.id);
      onNavigate("case-file");
      return;
    }
    try {
      await create({
        eventId: event.id,
        title: String(event.label ?? event.title ?? event.id).slice(0, 160),
        priority: defaultAlertPriority(event),
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
        pending.current || pendingRun.current || pendingPotential.current
          ? "Workflow refreshed. The saved request is retained; use the same-request retry to reconcile an uncertain result without duplication."
          : "Workflow refreshed from storage.",
      );
    } catch {
      /* failure is visible, never replay a write */
    }
  }
  async function retryPending() {
    if (pendingPotential.current) {
      try {
        await savePotential(pendingPotential.current.requests, true);
      } catch {
        /* only explicit retries resume the retained operation */
      }
      return;
    }
    if (pendingRun.current) {
      try {
        await savePlanningRun(pendingRun.current, true);
      } catch {
        /* retained, never automatically replayed */
      }
      return;
    }
    if (!pending.current) {
      await recheck();
      return;
    }
    try {
      const retained = pending.current;
      await submit(retained, true);
      if (retained.url === "/v1/command/incidents") onNavigate("case-file");
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
      ? "tracking"
      : view === "coordination"
        ? "coordination"
        : view === "consequence"
          ? "consequence"
          : "full";
  const casework = (
    <CommandCasework
      data={data}
      records={records}
      incidents={incidents}
      selected={selected}
      mode={caseMode}
      onOpenEntity={(id) => onOpenAnalyst("entity-profile", selected?.id, id)}
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

  const headerContext =
    typeof document === "undefined"
      ? null
      : document.getElementById("workspace-header-context");
  const incidentContext =
    typeof document === "undefined"
      ? null
      : document.getElementById("selected-incident-context");
  const selectedSource = selected
    ? records?.statewideIncidents?.find(record => record.caseId === selected.id)
      ?? records?.statewideIncidents?.find(record =>
        !record.caseId && record.linkedEventIds?.includes(selected.eventId))
    : null;
  const statewideProjectionIds = mode === "command" && view === "command" ? (records?.statewideIncidents ?? []).filter(r => r.status !== "closed" && r.modeled).map(r => r.id).sort().join("|") : "";
  const [statewideProjections, setStatewideProjections] = useState<Record<string, ConsequenceProjection>>({});
  useEffect(() => {
    let live = true;
    setStatewideProjections({});
    for (const id of statewideProjectionIds.split('|').filter(Boolean)) api<ConsequenceProjection>(`/v1/command/consequences?incidentId=${encodeURIComponent(id)}`).then(value => { if (live && value.incident?.id === id) setStatewideProjections(old => ({...old,[id]:value})); }).catch(() => {});
    return () => { live = false; };
  }, [statewideProjectionIds]);
  const statewideContext = mode === "command" && view === "command" && records && reference
    ? c1OverviewModel({ data, incidents, selected: null, view, records, reference }, statewideProjections)
    : null;
  const recordContextId = ((mode === "command" && ["cyber", "uctf", "leadership", "federation"].includes(view)) || (mode === "analyst" && view === "command")) && typeof window !== "undefined"
    ? readIncidentFocus(window.location.href)
    : null;
  const contextRecord = recordContextId ? records?.statewideIncidents.find(row => row.id === recordContextId || row.caseId === recordContextId) : null;
  const incidentLine = recordContextId
    ? contextRecord ? [contextRecord.id, contextRecord.title, contextRecord.location?.label].filter(Boolean).join(" · ") : "Incident record not available"
    : statewideContext
    ? `Statewide · ${statewideContext.totals.active} open incidents · ${statewideContext.totals.investigating} under investigation · ${statewideContext.rows.filter(row => row.cascading).length} cascading`
    : mode === "command" && (view === "cop" || view === "consequence")
    ? null // Record-owned views can display references without a saved case.
    : selected
    ? [
        caseDisplayId(selected, records),
        selectedSource?.title ?? selected.title,
        selected.contextSnapshot?.provider?.label,
      ]
        .filter(Boolean)
        .map((part) => displayText(String(part)))
        .join(" · ")
    : "No incident selected";
  // C1 remains statewide. C2/C4 own record selection, including reference
  // scenarios without saved cases; never overlay an unrelated saved-case banner.
  const showIncidentContextBar = !(mode === "command" && (view === "command" || view === "cop" || view === "consequence"));
  const [contextSelectionRevision, setContextSelectionRevision] = useState(0);
  const selectedIncidentContextBar = showIncidentContextBar && contextRecord ? (
    <section className="incident-context-bar" aria-label="Selected incident context">
      <div className="incident-context-main"><span className="incident-context-label">Selected incident</span>
        <strong>{contextRecord?.title ?? "Incident record not available"}</strong>
        <p>{contextRecord?.id} · {contextRecord?.location?.label ?? "Location not recorded"} · {contextRecord?.status ?? "Not recorded"}</p>
      </div>
      <label>Change saved incident<select disabled={workspaceNavigationLocked(loaded, loading, busy, uncertain)} value={contextRecord?.caseId ?? ""} onChange={event => {
        if (writing.current || workspaceNavigationLocked(loaded, loading, busy, uncertain)) return;
        const id = event.target.value;
        if (id && !incidents.some(incident => incident.id === id)) return;
        const url = new URL(window.location.href);
        url.searchParams.delete("incidentId"); url.searchParams.delete("incident");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        setContextSelectionRevision(revision => revision + 1);
        onSelect(id || null);
      }}><option value="">Choose a saved incident</option>{incidents.map(incident => <option key={incident.id} value={incident.id}>{incident.title}</option>)}</select></label>
    </section>
  ) : showIncidentContextBar ? (
    <IncidentContextBar
      selected={recordContextId ? null : selected}
      incidents={incidents}
      location={[selectedSource?.location?.label, selectedSource?.location?.region].filter(Boolean).join(" · ") || selectedSource?.locationLabel}
      locked={workspaceNavigationLocked(loaded, loading, busy, uncertain)}
      onSelect={(id) => {
        if (writing.current || workspaceNavigationLocked(loaded, loading, busy, uncertain)) return;
        // An explicit saved-case choice supersedes URL-owned statewide focus.
        // Do this before children mount: C4 prefers incidentId over selectedId.
        if (typeof window !== "undefined" && window.location?.href) {
          const url = new URL(window.location.href);
          url.searchParams.delete("incidentId");
          url.searchParams.delete("incident");
          window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        }
        setContextSelectionRevision(revision => revision + 1);
        onSelect(id);
      }}
    />
  ) : null;
  const openCaseFromAlert = (
    <button
      className="button primary"
      disabled={busy || loading || uncertain || !loaded}
      onClick={() => {
        onNavigate("command");
        requestAnimationFrame(() => {
          const alerts = document.getElementById("analyst-alerts");
          alerts?.scrollIntoView({ behavior: "smooth", block: "start" });
          alerts?.focus({ preventScroll: true });
        });
      }}
    >
      Open case from alert
    </button>
  );
  const commandHeaderContext =
    mode === "command" && headerContext
      ? createPortal(
          <>
            <OperationsClock timeZone={records?.operationsTimeZone} />
          </>,
          headerContext,
        )
      : null;

  if (mode === "command")
    return (
      <div
        className="command-workspace"
        data-readonly-command="true"
        data-casework-loaded={loaded}
        aria-busy={loading || busy}
      >
        {commandHeaderContext}
        {!showIncidentContextBar && incidentContext && createPortal(incidentLine, incidentContext)}
        {selectedIncidentContextBar}
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
            <p>Case records are unavailable.</p>
          </section>
        ) : (
          <CommandCenterViews
            key={view === "consequence" ? contextSelectionRevision : "record-owned"}
            records={records ?? undefined}
            reference={reference ?? undefined}
            lastPlanningRun={
              lastPlanningCaseId === selectedId ? lastPlanningRun : null
            }
            data={data}
            incidents={incidents}
            selected={selected}
            selectedEntityId={selectedEntityId}
            onSelectEntity={(id) => {
              if (!busy && !uncertain) onSelectEntity(id);
            }}
            view={view}
            onSelect={(id) => {
              if (!busy && !uncertain) onSelect(id);
            }}
            onOpenAnalyst={onOpenAnalyst}
            onClearSelection={() => onSelect(null)}
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
      {(() => {
        const controls = (
          <div className="screen-header-actions">
            {openCaseFromAlert}
            {health?.resetEnabled && (
              <span className="screen-header-reset">
                <ResetDemoControl
                  revision={data.baselineRevision}
                  disabled={busy || loading || uncertain}
                  onBusy={(value) => {
                    writing.current = value;
                    setBusy(value);
                  }}
                  onFailure={(message) => {
                    setError(message);
                    setUncertain(true);
                  }}
                />
              </span>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh casework"
              title="Refresh casework"
              onClick={() => void recheck()}
              disabled={busy || loading}
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
              <span className="visually-hidden">Refresh casework</span>
            </button>
            {selected && (
              <details className="screen-case-tools">
                <summary>Case tools</summary>
                <div>
                  {view !== "case-file" && (
                    <button
                      className="text-button"
                      disabled={busy || loading || uncertain}
                      onClick={() => onNavigate("case-file")}
                    >
                      Open full case file
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={downloadBrief}
                    disabled={busy}
                  >
                    <Download size={16} />
                    Download structured brief (JSON)
                  </button>
                </div>
              </details>
            )}
          </div>
        );
        return headerContext ? createPortal(controls, headerContext) : controls;
      })()}
      {selectedIncidentContextBar}
      {uncertain &&
        (pending.current || pendingRun.current || pendingPotential.current) && (
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
        <p className="screen-save-toast" role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {!loaded ? (
        <section className="command-panel">
          <h2>{loading ? "Loading saved casework" : "Casework unavailable"}</h2>
          <p>
            {loading
              ? "Loading cases."
              : "Case records are unavailable. Refresh to retry."}
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
              onBack={onReturnToSource ?? (() => onNavigate("cop"))}
            />
          )}
          {records && view === "command" && <LateTasks records={records} />}
          {view !== "case-file" &&
            view !== "entity-profile" &&
            !(
              records &&
              reference &&
              ["coordination", "uctf"].includes(view)
            ) && (
              <CommandReadouts
                key={contextSelectionRevision}
                records={records}
                lastPlanningRun={
                  lastPlanningCaseId === selectedId ? lastPlanningRun : null
                }
                onWhatIf={savePlanningRun}
                onAnalyze={(scenarioId, horizonHours) => {
                  if (!selected || busy || loading || uncertain) return;
                  try {
                    setAnalysisConfirmation(
                      analysisIntent(selected, scenarioId, horizonHours),
                    );
                    setAnalysisError("");
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : String(cause),
                    );
                  }
                }}
                onPropose={(entityId, role = "dependent") => {
                  if (!busy && !loading && !uncertain)
                    onEditDependency(null, { entityId, role });
                }}
                onMutate={async (action) => {
                  if (!selected) throw new Error("Select a case first.");
                  await mutate(action, selected.version, selected.id);
                }}
                onCreate={async (request) => {
                  const saved = await create(request);
                  onNavigate("case-file");
                  return saved;
                }}
                reference={reference ?? undefined}
                telemetry={telemetry}
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
          {records && reference && ["coordination", "uctf"].includes(view) && (
            <ScriptedAnalystViews
              caseClosure={view === "uctf" ? casework : undefined}
              data={data}
              incidents={incidents}
              selected={selected}
              view={view}
              records={records}
              reference={reference}
              onEstimatePotential={savePotential}
              potentialRuns={potentialResults[estimateScope] ?? []}
              onMutate={(action) =>
                selected
                  ? mutate(action, selected.version, selected.id)
                  : Promise.reject(new Error("Select a case first"))
              }
              busy={busy || loading}
              uncertain={uncertain || refreshFailed}
              onRefresh={loadCases}
            />
          )}
          {view === "case-file" && casework}
          {view === "coordination" && <details className="analyst-record-tools"><summary>Case record tools</summary>{casework}</details>}

        </>
      )}
      {analysisConfirmation && (
        <ConfirmDialog
          title="Confirm analysis"
          label="Run analysis"
          disabled={busy || loading}
          confirmDisabled={
            uncertain ||
            analysisConfirmation.caseId !== selected?.id ||
            analysisConfirmation.version !== selected?.version
          }
          error={analysisError}
          onCancel={() => setAnalysisConfirmation(null)}
          onConfirm={async () => {
            const frozen = analysisConfirmation;
            if (
              busy ||
              loading ||
              uncertain ||
              frozen.caseId !== selected?.id ||
              frozen.version !== selected?.version
            )
              return;
            try {
              if (frozen.kind === "capture")
                await mutate(frozen.action, frozen.version, frozen.caseId);
              else await savePlanningRun(frozen.request);
              setAnalysisConfirmation(null);
            } catch (cause) {
              setAnalysisError(
                cause instanceof Error ? cause.message : String(cause),
              );
            }
          }}
        >
          <p>Run the modeled scenario with these settings.</p>
          <p>
            {analysisConfirmation.kind === "capture"
              ? "This analysis feeds C4."
              : "Separate analysis; the case's captured run stays unchanged."}
          </p>
          <dl className="cc-metadata">
            <dt>Case</dt>
            <dd>
              {caseDisplayId(
                {
                  id: analysisConfirmation.caseId,
                  eventId: selected?.eventId ?? "",
                },
                records,
              ) ?? "Display ID not assigned"}
            </dd>
            <dt>Scenario</dt>
            <dd>
              {analysisConfirmation.kind === "capture" &&
              analysisConfirmation.action.action === "analyze"
                ? analysisConfirmation.action.scenarioId
                : analysisConfirmation.kind === "separate"
                  ? analysisConfirmation.request.scenarioId
                  : "Unavailable"}
            </dd>
          </dl>
          {uncertain && (
            <button
              className="button secondary"
              disabled={busy || loading}
              onClick={async () => {
                await retryPending();
                setAnalysisConfirmation(null);
              }}
            >
              Reconcile same saved request
            </button>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

import { StatusChip } from "./visualPrimitives.ts";
import { TechniqueChip } from "./visualPrimitives.ts";
import { useEffect, useRef, useState } from "react";
import type { Bootstrap, Event, Telemetry } from "./types.ts";
import type { CommandAction, CommandIncident } from "./commandTypes.ts";
import type { RecordItem, RecordsState } from "./scriptedTypes.ts";
import { scopedRecords } from "./scriptedCommandModel.ts";
import { caseTimeline } from "./caseTimeline.ts";
import { runHunt, type HuntQuery, type HuntScope } from "./threatHunts.ts";
import {
  networkStreams,
  orderedFields,
  visibleRecords,
  networkSource,
  compactNetworkSource,
  streamSourceLabel,
  ctTime,
  jsonlExport,
  evidenceRefs,
  eventSourceChips,
  type Hunt,
} from "./networkEvidence.ts";
import "./network-evidence.css";

export interface NetworkEvidenceProps {
  data: Pick<Bootstrap, "events"> &
    Partial<Pick<Bootstrap, "entities" | "incidentOrigin">>;
  telemetry: Telemetry | null;
  events?: Event[];
  initialTab?: "timeline" | "raw" | "hunt";
  initialStreamId?: string;
  incident?: CommandIncident | null;
  records?: RecordsState | null;
  busy?: boolean;
  uncertain?: boolean;
  onMutate?: (action: CommandAction) => Promise<void>;
  onOpenCaseFile?: () => void;
}
type EvidenceTab = "timeline" | "hunt" | "raw";
interface Navigation {
  tab: EvidenceTab;
  streamId: string;
  recordId: string | null;
}
const defaultQuery: HuntQuery = {
  kind: "source",
  value: "203.0.113.250",
  scope: "all-monitored",
};
function readLocation(defaultTab: EvidenceTab, streamId: string): Navigation {
  const params =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  return {
    tab:
      tab === "timeline" || tab === "hunt" || tab === "raw" ? tab : defaultTab,
    streamId: params.get("stream") || streamId,
    recordId: params.get("record"),
  };
}
export default function NetworkEvidence({
  data,
  telemetry,
  events = data.events,
  initialTab,
  initialStreamId,
  incident,
  records,
  busy = false,
  uncertain = false,
  onMutate,
  onOpenCaseFile,
}: NetworkEvidenceProps) {
  const fallback = initialTab ?? (incident ? "timeline" : "hunt");
  const [navigation, setNavigation] = useState(() =>
    readLocation(fallback, initialStreamId ?? "corelight/conn"),
  );
  const { tab, streamId, recordId } = navigation;
  const [hunt, setHunt] = useState<Hunt>("shared-source");
  const [scope, setScope] = useState<HuntScope>("all-monitored");
  const [start, setStart] = useState("00:00");
  const [end, setEnd] = useState("05:00");
  // Keep legacy initialTab=hunt readouts; the new workflow runs searches explicitly.
  const [executed, setExecuted] = useState<HuntQuery | null>(
    incident === undefined && initialTab === "hunt" ? defaultQuery : null,
  );
  const [drafts, setDrafts] = useState<
    Record<string, { status: string; note: string }>
  >({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Cases arrive asynchronously on a fresh URL. Follow the contextual default
    // only until the analyst has made an explicit, URL-persisted tab choice.
    const explicitTab = new URLSearchParams(window.location.search).get("tab");
    if (!["timeline", "hunt", "raw"].includes(explicitTab ?? "")) {
      setNavigation((previous) =>
        previous.tab === fallback ? previous : { ...previous, tab: fallback },
      );
    }
    const changed = () =>
      setNavigation(
        readLocation(fallback, initialStreamId ?? "corelight/conn"),
      );
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, [fallback, initialStreamId]);
  function navigate(next: Partial<Navigation>) {
    const value = { ...navigation, ...next };
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", value.tab);
      if (value.streamId) url.searchParams.set("stream", value.streamId);
      if (value.recordId) url.searchParams.set("record", value.recordId);
      else url.searchParams.delete("record");
      window.history.pushState(null, "", url);
    }
    setNavigation(value);
  }
  const raw = (id: string, record: string) =>
    navigate({ tab: "raw", streamId: id, recordId: record });
  const timeline = caseTimeline(incident, { ...data, events }, telemetry);
  const stream = telemetry?.streams.find((item) => item.id === streamId);
  const fields = stream ? orderedFields(stream) : [];
  const rows = stream
    ? visibleRecords(
        stream,
        timeline.map((row) => row.event),
        200,
        recordId,
      )
    : [];
  const selected = stream?.records.find((record) => record.id === recordId);
  const result = executed ? runHunt(telemetry, executed) : null;
  const hunts = records
    ? scopedRecords(records.hunts, records, incident ?? null)
    : [];
  const locked =
    busy ||
    uncertain ||
    saving ||
    !onMutate ||
    !incident ||
    incident.status === "closed";
  function draft(item: RecordItem) {
    return (
      drafts[item.id] ?? {
        status: ["running", "done", "no_findings", "findings"].includes(
          item.status ?? "",
        )
          ? item.status!
          : "running",
        note: item.resultNote ?? "",
      }
    );
  }
  function edit(
    item: RecordItem,
    change: Partial<{ status: string; note: string }>,
  ) {
    setDrafts((previous) => ({
      ...previous,
      [item.id]: { ...(previous[item.id] ?? draft(item)), ...change },
    }));
  }
  async function save(item: RecordItem) {
    const value = draft(item);
    if (
      locked ||
      pending.current ||
      !value.note.trim() ||
      !["running", "done", "no_findings", "findings"].includes(value.status)
    )
      return;
    pending.current = true;
    setSaving(true);
    setSaveError("");
    try {
      // Existing API accepts huntId/status/resultNote only. Query stays on the stored hunt.
      await onMutate!({
        action: "record_hunt",
        huntId: item.id,
        status: value.status,
        resultNote: value.note.trim(),
      });
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not record hunt result. Your note is retained.",
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  function searchQuery(): HuntQuery {
    return {
      kind:
        hunt === "shared-source"
          ? "source"
          : hunt === "vendor-account"
            ? "account"
            : "off-hours",
      value:
        hunt === "shared-source"
          ? "203.0.113.250"
          : hunt === "vendor-account"
            ? "vendor-v-support"
            : `${start}–${end}`,
      scope,
    };
  }
  function searchStored(item: RecordItem) {
    const query = item.query;
    if (
      !query ||
      !["source", "account", "off-hours"].includes(query.kind) ||
      !["watershed-250-utilities", "all-monitored"].includes(query.scope)
    )
      return;
    const value = query as HuntQuery;
    setHunt(
      value.kind === "source"
        ? "shared-source"
        : value.kind === "account"
          ? "vendor-account"
          : "off-hours",
    );
    setScope(value.scope);
    setExecuted({ ...value });
  }
  return (
    <section
      className="network-evidence command-panel"
      aria-label="Network evidence"
    >
      <header className="network-heading">
        <div>
          <h2>Cyber Evidence</h2>
          <p>{incident ? incident.title : "All recorded events."}</p>
        </div>
        {incident && onOpenCaseFile && (
          <button type="button" onClick={onOpenCaseFile}>
            Open case file
          </button>
        )}
      </header>
      <nav className="network-tabs" aria-label="Evidence views">
        {(
          [
            ["timeline", "Incident timeline"],
            ["hunt", "Threat hunt"],
            ["raw", "Raw records"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => navigate({ tab: id })}
          >
            {label}
          </button>
        ))}
      </nav>
      {!telemetry && <p role="status">Telemetry unavailable.</p>}
      {tab === "timeline" && (
        <>
          <p className="network-caveat">
            B/C campaign probes · no established compromise or service effect
          </p>
          {!timeline.length && <p>No case-linked events recorded.</p>}
          <ol className="network-timeline">
            {timeline.map((row) => (
              <li key={row.event.id} data-case-event={row.isCaseEvent}>
                <div className="network-tags">
                  <time>{row.time}</time>
                  <strong>{row.utility?.label ?? "Utility unmapped"}</strong>
                  {row.isCaseEvent && (
                    <span className="network-chip">case event</span>
                  )}
                  {row.observedEffect && (
                    <span className="network-chip">observed effect</span>
                  )}
                </div>
                <h3>{row.event.label ?? row.event.title ?? row.event.id}</h3>
                <p>{row.event.description}</p>
                {row.asset && <p>{row.asset.label}</p>}
                <div className="network-tags">
                  <span className="network-chip">{row.evidenceCategory}</span>
                  {eventSourceChips(row.event).map((source) => (
                    <span className="network-chip" key={source}>
                      {source}
                    </span>
                  ))}
                  {row.techniques.map((technique) => (
                    <TechniqueChip
                      className="network-chip network-attack"
                      key={technique.id}
                      id={technique.id}
                      name={technique.name}
                      tactic={technique.tactic}
                      title={technique.tactic}
                    >
                      {technique.id} · {technique.name}
                    </TechniqueChip>
                  ))}
                </div>
                <div className="network-tags">
                  {evidenceRefs(row.event).map((ref) => (
                    <button
                      type="button"
                      key={`${ref.streamId}/${ref.recordId}`}
                      data-record-id={ref.recordId}
                      onClick={() => raw(ref.streamId, ref.recordId)}
                    >
                      Raw record · {ref.streamId.split("/").at(-1)} ·{" "}
                      {ref.recordId}
                    </button>
                  ))}
                </div>
                <details>
                  <summary>Event record</summary>
                  <pre>{JSON.stringify(row.event, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
      {tab === "raw" && (
        <>
          <div className="network-controls">
            <label>
              Log stream
              <select
                aria-label="Log stream"
                value={streamId}
                onChange={(e) =>
                  navigate({ streamId: e.target.value, recordId: null })
                }
              >
                {networkStreams.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {stream && (
              <>
                <strong>{stream.records.length} records</strong>
                <button
                  type="button"
                  onClick={() => {
                    const file = jsonlExport(stream);
                    const url = URL.createObjectURL(
                      new Blob([file.contents], {
                        type: "application/x-ndjson;charset=utf-8",
                      }),
                    );
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = file.filename;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download full stream · JSONlines
                </button>
              </>
            )}
          </div>
          {recordId && (
            <div
              aria-label="Selected raw record"
              className="network-selected-record"
            >
              <h3>Selected raw record · {recordId}</h3>
              {selected ? (
                <pre>{JSON.stringify(selected, null, 2)}</pre>
              ) : (
                <p>Selected record is unavailable in this stream.</p>
              )}
            </div>
          )}
          {stream ? (
            <>
              <p>
                Showing {rows.length} of {stream.records.length} records.{" "}
                {streamSourceLabel(stream)}. Event-linked rows highlighted;
                selected row first. Download includes every original field and
                row.
              </p>
              {rows.some(
                ({ linked, record }) => linked && record.address !== undefined,
              ) && (
                <div
                  className="network-linked-summary"
                  role="note"
                  aria-label="Event-linked records"
                >
                  {rows
                    .filter(
                      ({ linked, record }) =>
                        linked && record.address !== undefined,
                    )
                    .map(({ record, index }) => (
                      <div key={index}>
                        <strong>{ctTime(record.ts ?? record.timestamp)}</strong>
                        <span>{String(record.func ?? "Network record")}</span>
                        <span>{`Address ${String(record.address)}`}</span>
                        {record.quantity !== undefined && (
                          <span>{`Quantity ${String(record.quantity)}`}</span>
                        )}
                        {record.values !== undefined && (
                          <span>{`Values ${JSON.stringify(record.values)}`}</span>
                        )}
                      </div>
                    ))}
                </div>
              )}
              <div className="network-table">
                <table>
                  <thead>
                    <tr>
                      <th>Time (CT)</th>
                      <th>Source / mapping</th>
                      {fields.map((field) => (
                        <th key={field}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(
                      ({ record, index, linked, selected: isSelected }) => (
                        <tr
                          key={index}
                          data-record-id={String(record.id ?? index)}
                          data-event-linked={linked}
                          data-selected={isSelected}
                          className={`${linked ? "network-linked" : ""} ${isSelected ? "network-selected" : ""}`}
                        >
                          <td>{ctTime(record.ts ?? record.timestamp)}</td>
                          <td>
                            {compactNetworkSource(stream, record)}
                            <small>
                              {typeof record.targetAssetId === "string"
                                ? record.targetAssetId
                                : "Unmapped"}
                            </small>
                            {linked && <strong>Event-linked</strong>}
                            {isSelected && <strong>Selected</strong>}
                            {typeof record.id === "string" && (
                              <button
                                type="button"
                                onClick={() =>
                                  raw(streamId, record.id as string)
                                }
                              >
                                Inspect record
                              </button>
                            )}
                          </td>
                          {fields.map((field) => (
                            <td key={field}>
                              {record[field] === undefined
                                ? "—"
                                : typeof record[field] === "string"
                                  ? (record[field] as string)
                                  : JSON.stringify(record[field])}
                            </td>
                          ))}
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p>No records supplied for this log.</p>
          )}
        </>
      )}
      {tab === "hunt" && (
        <>
          <div className="network-controls">
            <label>
              Hunt for
              <select
                aria-label="Hunt for"
                value={hunt}
                onChange={(e) => setHunt(e.target.value as Hunt)}
              >
                <option value="shared-source">
                  Shared attacker source · 203.0.113.250
                </option>
                <option value="vendor-account">
                  Vendor V support account · vendor-v-support
                </option>
                <option value="off-hours">Off-hours controller logins</option>
              </select>
            </label>
            <label>
              Across
              <select
                aria-label="Across"
                value={scope}
                onChange={(e) => setScope(e.target.value as HuntScope)}
              >
                <option value="watershed-250-utilities">
                  All Watershed 250 utilities
                </option>
                <option value="all-monitored">All monitored networks</option>
              </select>
            </label>
            {hunt === "off-hours" && (
              <>
                <label>
                  From (CT)
                  <input
                    aria-label="Off-hours start"
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label>
                  Until (CT)
                  <input
                    aria-label="Off-hours end"
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
              </>
            )}
            <button
              type="button"
              disabled={!telemetry}
              onClick={() => setExecuted(searchQuery())}
            >
              Run search
            </button>
          </div>
          <p className="network-caveat">
            B/C campaign probes · no established compromise or service effect
          </p>
          <p>
            Searches evaluate supplied telemetry only, not unrecorded networks.
            Completed background sessions are not attacker activity.
          </p>
          {result ? (
            <div aria-label="Hunt search results">
              <p>
                {result.results.length} matching supplied records. Query:{" "}
                {executed?.kind} · {executed?.value} · {executed?.scope}
              </p>
              {!result.results.length && (
                <p>NO FINDINGS in supplied records.</p>
              )}
              <ul className="network-verdicts">
                {result.utilities.map((utility) => (
                  <li key={utility.utilityId} data-verdict={utility.verdict}>
                    <strong>
                      {utility.utilityId} · {utility.verdict}
                    </strong>
                    <p>
                      {utility.completed} completed attacker connections ·{" "}
                      {utility.probes} probes · {utility.matches} matching
                      records
                    </p>
                    <small>
                      {utility.completed
                        ? "Completed SF session; no service effect established by this session."
                        : utility.matches
                          ? "No completed SF session in matching telemetry."
                          : "No matching supplied telemetry."}
                    </small>
                  </li>
                ))}
              </ul>
              <ol className="network-hunt-matches">
                {result.results.map(({ stream: source, record }, index) => (
                  <li key={`${source.id}/${index}`}>
                    <time>{ctTime(record.ts ?? record.timestamp)}</time> ·{" "}
                    {networkSource(source, record)} ·{" "}
                    {String(record.id ?? record.uid ?? "Unmapped record")}
                    {typeof record.id === "string" && (
                      <button
                        type="button"
                        onClick={() => raw(source.id, record.id as string)}
                      >
                        Raw record
                      </button>
                    )}
                    <details>
                      <summary>Matching raw record</summary>
                      <pre>{JSON.stringify(record, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p>Choose a hunt and run a search.</p>
          )}
          <section aria-label="Recorded case hunts">
            <h3>Case hunt records</h3>
            {!incident && <p>Open a case to record a hunt result.</p>}
            {incident && !records && <p>Hunt records unavailable.</p>}
            {incident && records && !hunts.length && (
              <p>No hunt records for this case.</p>
            )}
            {uncertain && (
              <p role="status">
                Write outcome uncertain. Reconcile the pending request before
                recording another result.
              </p>
            )}
            {saveError && <p role="alert">{saveError}</p>}
            {hunts.map((item) => (
              <form
                className="network-hunt-record"
                key={item.id}
                onSubmit={async (e) => {
                  e.preventDefault();
                  await save(item);
                }}
              >
                <h4>{item.label ?? item.id}</h4>
                <p>
                  Recorded status:{" "}
                  <StatusChip status={item.status}>
                    {item.status ?? "unknown"}
                  </StatusChip>{" "}
                  · {item.origin ?? "provenance unknown"}
                </p>
                {item.resultNote && <p>{item.resultNote}</p>}
                {item.query && (
                  <>
                    <p>
                      {item.query.kind} · {item.query.value} ·{" "}
                      {item.query.scope}
                    </p>
                    <button
                      type="button"
                      disabled={!telemetry}
                      onClick={() => searchStored(item)}
                    >
                      Run recorded query
                    </button>
                  </>
                )}
                <label>
                  Status
                  <select
                    aria-label={`Hunt result status ${item.id}`}
                    value={draft(item).status}
                    disabled={locked}
                    onChange={(e) => edit(item, { status: e.target.value })}
                  >
                    {["running", "done", "no_findings", "findings"].map(
                      (status) => (
                        <option key={status} value={status}>
                          {records?.huntStatusLabels?.[status] ??
                            status.replaceAll("_", " ")}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Required result note
                  <textarea
                    aria-label={`Hunt result note ${item.id}`}
                    value={draft(item).note}
                    required
                    disabled={locked}
                    onChange={(e) => edit(item, { note: e.target.value })}
                  />
                </label>
                <button
                  type="submit"
                  disabled={locked || !draft(item).note.trim()}
                >
                  Record a hunt result
                </button>
              </form>
            ))}
          </section>
        </>
      )}
    </section>
  );
}

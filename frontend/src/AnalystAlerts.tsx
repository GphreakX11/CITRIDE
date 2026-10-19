import { useEffect, useState } from "react";
import { readConsequenceSelection } from "./consequenceSelection.ts";
import type { Bootstrap, Event } from "./types.ts";
import type { CommandCreate, CommandIncident } from "./commandTypes.ts";
import type { RecordsState } from "./scriptedTypes.ts";
import { CaseCreateForm } from "./CaseCreateForm.tsx";
import {
  orderedAlerts,
  alertLocation,
  openCaseForEvent,
  campaignCaseLink,
  alertTime,
  alertTechniques,
} from "./analystAlerts.ts";
import { resolveEventTimestamp, formatTime } from "./displayTime.ts";
import { useAnalystIncident } from "./analystIncidentContext.ts";
interface Props {
  data: Bootstrap;
  incidents: CommandIncident[];
  records?: RecordsState | null;
  workflowLocked: boolean;
  onCreate: (request: CommandCreate) => Promise<CommandIncident>;
  onOpenCase: (id: string) => void;
  showAllInitially?: boolean;
}
export default function AnalystAlerts({
  data: legacyData,
  incidents: legacyIncidents,
  records: legacyRecords,
  workflowLocked,
  onCreate,
  onOpenCase,
  showAllInitially = true,
}: Props) {
  const context = useAnalystIncident();
  const data = context?.mainStore ?? legacyData;
  const incidents = context?.cases ?? legacyIncidents;
  const records = context?.records ?? legacyRecords;
  const [showAll, setShowAll] = useState(showAllInitially),
    [editing, setEditing] = useState<string | null>(null);
  const [focusId, setFocusId] = useState(() => typeof window === "undefined" ? null : readConsequenceSelection(window.location.href).incidentId);
  useEffect(() => {
    const restore = () => setFocusId(readConsequenceSelection(window.location.href).incidentId);
    window.addEventListener("popstate", restore);
    window.addEventListener("consequence-selection", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("consequence-selection", restore);
    };
  }, []);
  const selectedId = context ? context.selectedIncidentId : focusId;
  const focusRecord = context?.selectedIncident ?? records?.statewideIncidents.find(record => record.id === selectedId);
  const focusedEvents = new Set(focusRecord?.linkedEventIds ?? []);
  const eventTimestamp = context?.eventTimestamp ?? ((event: Event) => resolveEventTimestamp(event, records ?? {}));
  const alerts = orderedAlerts(data.events, focusedEvents, eventTimestamp);
  const pendingCount = alerts.filter(event => !openCaseForEvent(event.id, incidents)).length;
  const row = (event: Event) => {
    const existing = openCaseForEvent(event.id, incidents),
      campaign = campaignCaseLink(event, incidents, records),
      timestamp = eventTimestamp(event);
    return (
      <li
        className="command-event prototype-alert"
        key={event.id}
        data-alert-id={event.id}
      >
        <span className="command-source-tag">
          {String(event.origin ?? event.evidenceCategory ?? "Source evidence")}
        </span>
        <p>
          <time dateTime={timestamp}>
            {context ? formatTime(timestamp, undefined, "Time unavailable") : alertTime(event, records)}
          </time>
          {" · "}
          {alertLocation(event, data)}
        </p>
        <h3>{String(event.label ?? event.title ?? event.id)}</h3>
        <div className="sc-chips" aria-label="ATT&CK techniques">
          {alertTechniques(event).map((t) => (
            <span className="command-source-tag" key={t}>
              {t}
            </span>
          ))}
        </div>
        {campaign && !existing && <small>linked to {campaign}</small>}
        {editing === event.id && !existing ? (
          <CaseCreateForm
            key={event.id}
            data={data}
            event={event}
            busy={workflowLocked}
            uncertain={workflowLocked}
            onCreate={onCreate}
            onCreated={(saved) => {
              setEditing(null);
              onOpenCase(saved.id);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button
            className="button primary"
            disabled={workflowLocked}
            onClick={() =>
              existing ? onOpenCase(existing.id) : setEditing(event.id)
            }
          >
            {existing ? "Open case file →" : "Open case"}
          </button>
        )}
      </li>
    );
  };
  return (
    <section
      className="command-panel"
      id="analyst-alerts"
      tabIndex={-1}
      aria-label="Analyst alerts"
    >
      {selectedId && <div role="status"><h3>Alerts for {focusRecord?.title ?? "requested incident"} first</h3><p>All source alerts remain listed below.</p>{!focusedEvents.size && <p>No linked source alerts were supplied for this incident. No case was created.</p>}</div>}
      <div className="command-panel-heading">
        <h2>Alerts</h2>
        <span>{alerts.length} source alerts · {pendingCount} without an open case</span>
      </div>
      <ul
        className="prototype-alerts"
        aria-label="Source alerts"
        style={{ listStyle: "none", padding: 0 }}
      >
        {(showAll ? alerts : alerts.slice(0, 7)).map(row)}
      </ul>
      {!alerts.length && <p>No source alerts were supplied.</p>}
      {alerts.length > 7 && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show fewer" : `Show all (${alerts.length})`}
        </button>
      )}
      <p className="cc-muted">
        Alerts never become cases on their own; an analyst opens the case.
      </p>
    </section>
  );
}

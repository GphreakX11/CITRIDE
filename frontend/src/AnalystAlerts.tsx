import { useEffect, useState } from "react";
import { readIncidentFocus, incidentFocusLocation } from "./incidentFocus.ts";
import type { Bootstrap, Event } from "./types.ts";
import type { CommandCreate, CommandIncident } from "./commandTypes.ts";
import type { RecordsState } from "./scriptedTypes.ts";
import { CaseCreateForm } from "./CaseCreateForm.tsx";
import {
  alertsWithoutCases,
  openCaseForEvent,
  campaignCaseLink,
  alertTime,
  alertTechniques,
} from "./analystAlerts.ts";
import { utilityForEvent } from "./whoActsFirst.ts";
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
  data,
  incidents,
  records,
  workflowLocked,
  onCreate,
  onOpenCase,
  showAllInitially = false,
}: Props) {
  const [showAll, setShowAll] = useState(showAllInitially),
    [editing, setEditing] = useState<string | null>(null);
  // The shared helper retains its newest-first record contract. Only this
  // queue presents story order, with unknown times after recorded times.
  const [focusId, setFocusId] = useState(() => typeof window === "undefined" ? null : readIncidentFocus(window.location.href));
  useEffect(() => {
    const restore = () => setFocusId(readIncidentFocus(window.location.href));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const focusRecord = records?.statewideIncidents.find(record => record.id === focusId);
  const focusedEvents = focusId ? new Set(focusRecord?.linkedEventIds ?? []) : null;
  const pending = [...alertsWithoutCases(data.events, incidents)].filter(event => !focusedEvents || focusedEvents.has(event.id)).sort(
    (a, b) => {
      const at = Date.parse(String(a.timestamp ?? "")),
        bt = Date.parse(String(b.timestamp ?? ""));
      if (Number.isFinite(at) && Number.isFinite(bt)) return at - bt;
      if (Number.isFinite(at) !== Number.isFinite(bt))
        return Number.isFinite(at) ? -1 : 1;
      return (
        (typeof a.relativeTimeHours === "number"
          ? a.relativeTimeHours
          : Infinity) -
        (typeof b.relativeTimeHours === "number"
          ? b.relativeTimeHours
          : Infinity)
      );
    },
  );
  const linked = data.events.filter((e) => openCaseForEvent(e.id, incidents) && (!focusedEvents || focusedEvents.has(e.id)));
  const row = (event: Event) => {
    const existing = openCaseForEvent(event.id, incidents),
      campaign = campaignCaseLink(event, incidents, records),
      utility = utilityForEvent(event, data);
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
          <time dateTime={String(event.timestamp ?? "")}>
            {alertTime(event)}
          </time>
          {" · "}
          {data.entities.find((e) => e.id === utility)?.label ??
            "Utility unresolved"}
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
      aria-label="Alerts not yet cases"
    >
      {focusId && <div className="command-panel" role="status"><h3>Alerts for {focusRecord?.title ?? "requested incident"}</h3><p>{focusRecord?.id ?? "Incident record unavailable"}</p>{!focusedEvents?.size && <p>No linked source alerts were supplied for this incident. No case was created.</p>}<button type="button" onClick={() => { window.history.replaceState(null, "", incidentFocusLocation(window.location.href, null)); setFocusId(null); }}>Clear incident filter</button></div>}
      <div className="command-panel-heading">
        <h2>Alerts not yet cases</h2>
        <span>{pending.length} source alerts without an open case</span>
      </div>
      <ul
        className="prototype-alerts"
        aria-label="Alerts without open cases"
        style={{ listStyle: "none", padding: 0 }}
      >
        {(showAll ? pending : pending.slice(0, 7)).map(row)}
      </ul>
      {!pending.length && <p>No alerts are waiting for a case.</p>}
      {pending.length > 7 && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show fewer" : `Show all (${pending.length})`}
        </button>
      )}
      <p className="cc-muted">
        Alerts never become cases on their own; an analyst opens the case.
      </p>
      {!!linked.length && (
        <details open>
          <summary>Alerts with open cases ({linked.length})</summary>
          <ul
            className="prototype-alerts"
            aria-label="Alerts with open cases"
            style={{ listStyle: "none", padding: 0 }}
          >
            {linked.map(row)}
          </ul>
        </details>
      )}
    </section>
  );
}

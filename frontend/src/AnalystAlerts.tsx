import { useState } from "react";
import type { Bootstrap, Event } from "./types.ts";
import type { CommandCreate, CommandIncident } from "./commandTypes.ts";
import type { RecordsState } from "./scriptedTypes.ts";
import { CaseCreateForm } from "./CaseCreateForm.tsx";
import {
  alertsWithoutCases,
  openCaseForEvent,
  campaignCaseLink,
  alertTimeCT,
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
  const pending = alertsWithoutCases(data.events, incidents);
  const linked = data.events.filter((e) => openCaseForEvent(e.id, incidents));
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
            {alertTimeCT(event)}
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
      <div className="command-panel-heading">
        <h2>Alerts not yet cases</h2>
        <span>{pending.length} source alerts without an open case</span>
      </div>
      <ul
        className="prototype-alerts"
        aria-label="Alerts without open cases"
        style={{ listStyle: "none", padding: 0 }}
      >
        {(showAll ? pending : pending.slice(0, 5)).map(row)}
      </ul>
      {!pending.length && <p>No alerts are waiting for a case.</p>}
      {pending.length > 5 && (
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

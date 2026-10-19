import { useId, useState } from "react";
import type { AnalystIncidentContextValue } from "./analystIncidentContext.ts";
import { useAnalystIncident } from "./analystIncidentContext.ts";
import { openCasesForIncident } from "./caseIncidentSelection.ts";
import "./incident-context-bar.css";

export interface AnalystIncidentChooserProps {
  context: AnalystIncidentContextValue;
}
/** Incident register, not a case-derived list. Selection/history belongs to host. */
export function AnalystIncidentChooser({ context }: AnalystIncidentChooserProps) {
  const [changing, setChanging] = useState(false);
  const id = useId();
  const selected = context.selectedIncident;
  const active = context.activeCase;
  const history = active && !context.matchingOpenCases.some(item => item.id === active.id) ? active : null;
  return <section className="incident-context-bar" aria-label="Selected incident context">
    <div className="incident-context-main">
      <span className="incident-context-label">Selected incident</span>
      <strong>{selected?.title ?? "No open incident available for this customer"}</strong>
      {selected && <dl className="incident-context-facts">
        <div><dt>Incident</dt><dd>{selected.id}</dd></div>
        <div><dt>Severity</dt><dd>{selected.severity ?? "Not recorded"}</dd></div>
        <div><dt>Status</dt><dd>{active ? (active.status === "closed" ? "Historical case" : "Case open") : "No case yet"}</dd></div>
      </dl>}
    </div>
    <button type="button" className="button secondary" disabled={context.locked}
      aria-expanded={changing} aria-controls={id} onClick={() => { if (!context.locked) setChanging(!changing); }}>
      Change incident
    </button>
    <div id={id} className="incident-context-picker" hidden={!changing}>
      {changing && <label>Incident
        <select aria-label="Incident" value={context.selectedIncidentId ?? ""} disabled={context.locked}
          onChange={event => {
            const next = event.target.value;
            if (context.locked || !context.openIncidents.some(row => row.id === next && row.status !== "closed" && !row.referenceOnly)) return;
            context.selectIncident(next);
            setChanging(false);
          }}>
          {!selected && <option value="" disabled>Choose an open incident</option>}
          {context.openIncidents.filter(row => row.status !== "closed" && !row.referenceOnly).map(row => <option key={row.id} value={row.id}>
            {row.id} · {row.title ?? "Title not recorded"} · {row.severity ?? "Severity not recorded"} · {openCasesForIncident(row, context.cases).length ? "Case open" : "No case yet"}
          </option>)}
        </select>
      </label>}
    </div>
    {(context.matchingOpenCases.length > 1 || history) && <label>Case
      <select aria-label="Case" value={active?.id ?? ""} disabled={context.locked} onChange={event => {
        const next = event.target.value;
        if (!context.locked && context.matchingOpenCases.some(item => item.id === next)) context.selectCase(next);
      }}>
        {!active && <option value="" disabled>Choose a case</option>}
        {history && <option value={history.id}>{history.title} · Historical case · {history.status}</option>}
        {context.matchingOpenCases.map(item => <option key={item.id} value={item.id}>{item.title} · {item.id}</option>)}
      </select>
    </label>}
  </section>;
}
/** Drop-in for a subtree already wrapped in Donna's public provider. */
export function AnalystIncidentContextBar() {
  const context = useAnalystIncident();
  return context ? <AnalystIncidentChooser context={context} /> : null;
}

import { useId, useRef, useState } from "react";
import type { CommandIncident } from "./commandTypes";
import "./incident-context-bar.css";

interface IncidentContextBarProps {
  selected: CommandIncident | null;
  incidents: CommandIncident[];
  location?: string;
  locked: boolean;
  onSelect: (id: string | null) => void;
}

/** Saved-case context only: statewide records without a case remain owned by C2. */
export default function IncidentContextBar({
  selected, incidents, location, locked, onSelect,
}: IncidentContextBarProps) {
  const [changing, setChanging] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{ id: string; message: string } | null>(null);
  const pickerId = useId();
  const changeButton = useRef<HTMLButtonElement>(null);
  async function copyId() {
    if (!selected) return;
    const id = selected.id;
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(id);
      setCopyFeedback({ id, message: "ID copied" });
    } catch {
      setCopyFeedback({ id, message: "Copy unavailable — select the ID and copy it manually." });
    }
  }
  return (
    <section className="incident-context-bar" aria-label="Selected incident context">
      <div className="incident-context-main">
        <span className="incident-context-label">Selected incident</span>
        <strong>{selected?.title || "No incident selected"}</strong>
        {selected ? (
          <dl className="incident-context-facts">
            <div><dt>Location</dt><dd>{location || selected.contextSnapshot?.serviceArea?.label || "Location not recorded"}</dd></div>
            <div><dt>Priority</dt><dd>{selected.priority || "Not recorded"}</dd></div>
            <div><dt>Status</dt><dd>{selected.status || "Not recorded"}</dd></div>
          </dl>
        ) : <p>Select a saved incident to keep the same context across workspaces.</p>}
      </div>
      <div className="incident-context-actions">
        <button ref={changeButton} type="button" className="button secondary" disabled={locked}
          aria-expanded={changing} aria-controls={pickerId}
          onClick={() => { if (!locked) setChanging(!changing); }}>
          Change incident
        </button>
        {selected && (
          <details className="incident-context-technical" key={selected.id}>
            <summary>Technical ID</summary>
            <code>{selected.id}</code>
            <button type="button" className="button secondary" onClick={copyId}>Copy ID</button>
            <span role="status" aria-live="polite">{copyFeedback?.id === selected.id ? copyFeedback.message : ""}</span>
          </details>
        )}
      </div>
      <div id={pickerId} className="incident-context-picker" hidden={!changing}>
        {changing && <label>Saved incident
          <select value={selected?.id ?? ""} disabled={locked} onChange={event => {
            if (locked) return;
            const id = event.target.value;
            if (id && !incidents.some(incident => incident.id === id)) return;
            onSelect(id || null);
            setChanging(false);
            changeButton.current?.focus();
          }}>
            <option value="">No incident selected</option>
            {incidents.map(incident => <option key={incident.id} value={incident.id}>{incident.title} · {incident.priority} priority · {incident.status}</option>)}
          </select>
        </label>}
      </div>
    </section>
  );
}

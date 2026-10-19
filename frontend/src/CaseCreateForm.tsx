import { useRef, useState } from "react";
import displayCatalog from "../../data/reference/display_catalog.json" with { type: "json" };
import type { Bootstrap, Event } from "./types.ts";
import type {
  CommandCreate,
  CommandIncident,
  IncidentPriority,
} from "./commandTypes.ts";
import { defaultAlertPriority } from "./analystAlerts.ts";

interface Props {
  data: Bootstrap;
  event?: Event;
  busy: boolean;
  uncertain: boolean;
  onCreate: (request: CommandCreate) => Promise<CommandIncident>;
  onCreated: (incident: CommandIncident) => void;
  onCancel?: () => void;
  onBusy?: (busy: boolean) => void;
}
/** Shared by the Case File and A1; request identity/reconciliation remain owned by CommandWorkspace. */
export function CaseCreateForm({
  data,
  event,
  busy,
  uncertain,
  onCreate,
  onCreated,
  onCancel,
  onBusy,
}: Props) {
  const [eventId, setEventId] = useState(
    () =>
      event?.id ??
      data.events.find((e) => e.id === displayCatalog.defaultCaseEventId)?.id ??
      data.events[0]?.id ??
      "",
  );
  const [title, setTitle] = useState(() =>
    event ? String(event.label ?? event.title ?? event.id) : "",
  );
  const [priority, setPriority] = useState<IncidentPriority>(() =>
    event ? defaultAlertPriority(event) : "medium",
  );
  const [baseline, setBaseline] = useState(data.baselineRevision);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const guard = useRef(false);
  const blocked = busy || uncertain || creating;
  async function create() {
    if (blocked || guard.current) return;
    setError("");
    if (
      !title.trim() ||
      title.trim().length > 160 ||
      !data.events.some((e) => e.id === eventId)
    ) {
      setError(
        "Select an available source event and enter a case title of 1–160 characters.",
      );
      return;
    }
    const request: CommandCreate = {
      eventId,
      title: title.trim(),
      priority,
      expectedBaselineRevision: baseline,
      clientRequestId: crypto.randomUUID(),
    };
    guard.current = true;
    setCreating(true);
    onBusy?.(true);
    try {
      const saved = await onCreate(request);
      if (!event) {
        setTitle("");
        setPriority("medium");
        setBaseline(data.baselineRevision);
      }
      onCreated(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      guard.current = false;
      setCreating(false);
      onBusy?.(false);
    }
  }
  return (
    <form
      className="cc-form"
      aria-label={event ? "Open case from alert" : "Open case"}
      onSubmit={(e) => {
        e.preventDefault();
        return create();
      }}
    >
      {!event && (
        <label>
          Source event
          <select
            aria-label="Source event"
            value={eventId}
            disabled={blocked}
            onChange={(e) => setEventId(e.target.value)}
          >
            <option value="" disabled>
              Select a source event
            </option>
            {data.events.map((e) => (
              <option key={e.id} value={e.id}>
                {String(e.label ?? e.title ?? e.id)} — {e.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Case title
        <input
          aria-label="Case title"
          value={title}
          required
          maxLength={160}
          disabled={blocked}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Describe the review to track"
        />
      </label>
      <label>
        Local triage priority
        <select
          aria-label="Local triage priority"
          value={priority}
          disabled={blocked}
          onChange={(e) => setPriority(e.target.value as IncidentPriority)}
        >
          {["critical", "high", "medium", "low"].map((v) => (
            <option key={v} value={v}>
              {v[0].toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <p className="cc-muted">
        Captured source baseline: revision {baseline}. Current source baseline:
        revision {data.baselineRevision}.
      </p>
      {baseline !== data.baselineRevision && (
        <button
          type="button"
          disabled={blocked}
          onClick={() => setBaseline(data.baselineRevision)}
        >
          Use current source baseline
        </button>
      )}
      {error && (
        <p className="cc-error" role="alert">
          {error}
        </p>
      )}
      <div className="cc-actions">
        {onCancel && (
          <button type="button" disabled={blocked} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          className="cc-primary"
          disabled={blocked || !data.events.length}
          type="submit"
        >
          {creating ? "Saving case…" : event ? "Open case" : "Open case"}
        </button>
      </div>
    </form>
  );
}

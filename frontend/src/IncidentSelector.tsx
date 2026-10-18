import { useEffect, useId, useRef, useState } from "react";
import type { Bootstrap } from "./types.ts";
import type { RecordItem } from "./scriptedTypes.ts";
import { openIncidentChoices, searchIncidentChoices } from "./incidentSelection.ts";
import { elapsedMinutes } from "./scriptedCommandModel.ts";
import { words, timeLabel } from "./commandCenterModel.ts";
import { formatDuration } from "./displayTime.ts";
import { StatusChip } from "./visualPrimitives.ts";

export interface IncidentSelectorProps {
  rows: readonly RecordItem[];
  current: RecordItem | null;
  data: Bootstrap;
  now: string;
  recordsAsOf: string;
  onChoose: (id: string) => void;
}
export default function IncidentSelector({ rows, current, data, now, recordsAsOf, onChoose }: IncidentSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId().replaceAll(":", "");
  const all = openIncidentChoices(rows, data);
  const choices = searchIncidentChoices(all, query, data);
  const activeIndex = choices.length ? Math.min(index, choices.length - 1) : -1;
  const shown = all.find(row => row.id === current?.id) ?? null;
  const close = (restore = false) => {
    setOpen(false); setQuery(""); setIndex(0);
    if (restore) trigger.current?.focus();
  };
  const show = (last = false) => {
    setQuery("");
    const selected = all.findIndex(row => row.id === current?.id);
    setIndex(last ? Math.max(0, all.length - 1) : Math.max(0, selected));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${id}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, query, id]);
  const choose = (next: string) => { onChoose(next); close(true); };
  const elapsed = (row: RecordItem) => {
    const origin = Date.parse(data.incidentOrigin ?? "");
    const relative = Number.isFinite(origin) && Number.isFinite(row.startedRelativeHours)
      ? new Date(origin + row.startedRelativeHours! * 3600000).toISOString() : undefined;
    return formatDuration(elapsedMinutes(row.startedAt ?? relative, now), "Unknown");
  };
  return <div className="iv-selector" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  }} onKeyDown={event => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(event.key === "ArrowUp"); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (choices.length) setIndex((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
    }
    if (event.key === "Enter" && event.target === search.current) {
      event.preventDefault();
      if (choices[activeIndex]) choose(choices[activeIndex].id);
    }
  }}>
    <button type="button" className="iv-select-trigger" ref={trigger} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} onClick={() => open ? close() : show()}>
      <span className="iv-caption">Incident</span><span className="iv-incident-id">{shown?.id ?? "None selected"}</span><strong>{shown?.title ?? (all.length ? "Choose an incident" : "No open incidents")}</strong>
      {shown && <StatusChip status={shown.severity}>{words(shown.severity ?? "unknown")}</StatusChip>}<span aria-hidden="true">▾</span>
    </button>
    <p className="iv-records-asof">Read-only display · records as of {/^\d{4}-\d\d-\d\dT/.test(recordsAsOf) ? timeLabel(recordsAsOf) : recordsAsOf || "Time not recorded"}</p>
    {open && <div className="iv-selector-popover">
      <input className="iv-selector-search" ref={search} type="search" aria-label="Search by ID, title, utility, place or sector" placeholder="Search by ID, title, utility, place or sector" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={activeIndex >= 0 ? `${id}-${activeIndex}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} />
      <div className="iv-selector-list" id={`${id}-list`} role="listbox" aria-label="Open and monitoring incidents">
        {choices.map((row, i) => <button type="button" role="option" tabIndex={-1} id={`${id}-${i}`} aria-selected={row.id === shown?.id} className={`iv-selector-row ${i === activeIndex ? "iv-keyboard-active" : ""}`} key={row.id} onMouseDown={event => event.preventDefault()} onMouseMove={() => setIndex(i)} onClick={() => choose(row.id)}>
          <span className="iv-select-row-title"><strong>{row.title ?? "Untitled incident"}</strong><StatusChip status={row.severity}>{words(row.severity ?? "unknown")}</StatusChip><span aria-hidden="true">{row.id === shown?.id ? "✓" : ""}</span></span>
          <span className="iv-caption">{row.id} · {row.location?.label ?? "Place not recorded"} · {words(row.status ?? "unknown")} · {elapsed(row)}</span>
        </button>)}
      </div>
      {!choices.length && <p className="iv-empty" role="status">{all.length ? "No matching open or monitoring incidents." : "No open or monitoring incidents."}</p>}
      <footer>Closed incidents are on C6 · same selection as C1</footer>
    </div>}
  </div>;
}

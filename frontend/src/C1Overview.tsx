import { useRef, useState } from "react";
import type { CommandView } from "./commandTypes.ts";
import { text, type ScriptedViewProps } from "./scriptedTypes.ts";
import { c1OverviewModel, type C1Incident } from "./c1OverviewModel.ts";
import { C1Map } from "./C1Map.tsx";
import { InfrastructureIcon } from "./InfrastructureIcon.tsx";
import { infrastructureKind } from "./infrastructureIcons.ts";
import { StatusChip, Tone } from "./visualPrimitives.ts";
import { statusTone, windowTone } from "./statusTone.ts";
import { planningWindow, timeLabel, words, strings } from "./commandCenterModel.ts";
import { formatDuration } from "./displayTime.ts";
import { idtSectorName } from "./idt.ts";
import { activityDisplayText } from "./caseFilePresentation.ts";
import { incidentFocusLocation } from "./incidentFocus.ts";
import "./c1-overview.css";
import { c1PulseStyle } from "./c1Pulse.ts";

interface Props extends ScriptedViewProps {
  onSelect: (id: string) => void;
  onClearSelection?: () => void;
  onNavigate: (view: CommandView) => void;
  onSelectEntity?: (id: string | null) => void;
  onOpenAnalyst: (view: CommandView, caseId?: string | null, entityId?: string | null) => void;
}
const count = (value: number | null) => value === null ? "Unknown" : value.toLocaleString("en-US");
const age = (at: string, now: string) => {
  const minutes = (Date.parse(now) - Date.parse(at)) / 60000;
  return Number.isFinite(minutes) && minutes >= 0 ? `${formatDuration(minutes)} ago` : "Elapsed time unavailable";
};
/** C1 never derives its totals, panels or expansion state from a selected case. */
export default function C1Overview(props: Props) {
  const model = c1OverviewModel(props);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [allFacilities, setAllFacilities] = useState(false);
  const cards = useRef(new Map<string, HTMLDetailsElement>());
  const listPanel = useRef<HTMLElement>(null);
  const persistFocus = (id: string | null) => {
    if (typeof window !== "undefined") window.history.replaceState(null, "", incidentFocusLocation(window.location.href, id));
  };
  const pick = (id: string, scroll = true) => {
    setExpanded(id);
    if (scroll && typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
      const card = cards.current.get(id);
      card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      card?.querySelector("summary")?.focus({ preventScroll: true });
    });
  };
  const entityFor = (row: C1Incident) => row.incident?.runSnapshot?.seed?.provider ?? row.incident?.contextSnapshot?.provider?.id ?? strings(row.record.nearEntityIds)[0] ?? null;
  const command = (view: CommandView, row = model.rows[0], entityId?: string) => {
    if (row) {
      persistFocus(row.record.id);
      if (row.incident) props.onSelect(row.incident.id); else props.onClearSelection?.();
      props.onSelectEntity?.(entityId ?? entityFor(row));
    }
    props.onNavigate(view);
  };
  const analyst = (view: CommandView, row: C1Incident) => {
    persistFocus(row.record.id);
    props.onOpenAnalyst(view, row.incident?.id ?? null, entityFor(row));
  };
  const cascadeIds = new Set(model.rows.filter(row => row.cascading).map(row => row.record.id));
  const earliest = model.totals.earliest;
  const anyRun = model.rows.some(row => !!row.incident?.runSnapshot);
  const allFacilityRows = model.facilities.flatMap(group => {
    const seen = new Set<string>();
    return group.items.filter(item => !seen.has(item.id) && !!seen.add(item.id)).map(item => ({ item, group }));
  }).sort((a, b) => (a.item.windowHours?.[0] ?? Infinity) - (b.item.windowHours?.[0] ?? Infinity));
  const displayFacilities = allFacilities ? allFacilityRows : allFacilityRows.slice(0, 3);
  const earliestEntity = earliest && allFacilityRows.find(({ group, item }) => group.row.record.id === earliest.row.record.id && item.label === earliest.facilityLabel)?.item.id;
  return <div className="c1-overview" data-screen="command" data-pending-decisions={model.totals.decisions}>
    <p className="c1-asof">Read-only display · records as of {timeLabel(model.recordsAsOf)}</p>
    <section className="c1-totals" aria-label="Statewide totals">
      <button className="c1-total" onClick={() => { listPanel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); listPanel.current?.focus({ preventScroll: true }); }}>
        <strong>{model.totals.active}</strong><span><b>Active incidents</b><small>{model.totals.investigating} under investigation · {model.totals.active - model.totals.investigating} others</small></span><i aria-hidden="true">→</i>
      </button>
      <button className={`c1-total ${model.totals.people && model.totals.people > 0 ? "c1-total-red" : "c1-total-grey"}`} onClick={() => model.mostPeople && command("consequence", model.mostPeople)} disabled={!model.mostPeople}>
        <strong>{model.totals.people === null ? (anyRun ? "Unknown" : "Not yet modeled") : count(model.totals.people)}</strong><span><b>People on unsafe water</b><small>statewide{model.totals.probedPeople !== null ? ` · ${count(model.totals.probedPeople)} more on probed utilities` : " · probe population unknown"}</small></span><i aria-hidden="true">→</i>
      </button>
      <button className={`c1-total c1-total-${windowTone(earliest?.window)}`} onClick={() => earliest && command("consequence", earliest.row, earliestEntity || undefined)} disabled={!earliest}>
        <strong>{earliest ? planningWindow(earliest.window) : (anyRun ? "No recorded window" : "Not yet modeled")}</strong><span><b>Earliest window</b><small>{earliest ? `${earliest.facilityLabel} · ${earliest.row.record.id}` : "No captured facility window"}</small></span><i aria-hidden="true">→</i>
      </button>
      <button className={`c1-total ${model.totals.decisions > 0 ? "c1-total-amber" : "c1-total-grey"}`} onClick={() => command("leadership", model.decisions[0]?.row ?? model.rows[0])}>
        <strong>{model.totals.decisions}</strong><span><b>Decisions waiting</b><small>on the Chief · all incidents</small></span><i aria-hidden="true">→</i>
      </button>
    </section>
    <div className="c1-columns">
      <section className="c1-panel c1-map-panel" aria-labelledby="c1-map-heading">
        <div className="c1-panel-heading"><h2 id="c1-map-heading">Statewide picture</h2><small>{model.rows.length} open incidents · {new Set(model.footprintModel.layers.flatMap(layer => layer.probed.map(item => item.id))).size} utilities probed</small></div>
        <C1Map model={model.footprintModel} cascadingIds={cascadeIds} riskCaseIds={new Set(model.facilities.flatMap(group => group.row.incident ? [group.row.incident.id] : []))} onPick={pick}/>
      </section>
      <aside className="c1-sidebar" aria-label="Statewide incident details and decisions">
        <section className="c1-panel" aria-labelledby="c1-incidents-heading" tabIndex={-1} ref={listPanel}>
          <div className="c1-panel-heading"><h2 id="c1-incidents-heading">Active incidents</h2><small>Highest severity first · click a card for details</small></div>
          <div className="c1-cards">{model.rows.map(row => {
            const record = row.record, isOpen = expanded === record.id;
            const group = model.facilities.find(item => item.row.record.id === record.id);
            const state = record.status === "open" ? "Under investigation" : words(record.status ?? "unknown");
            return <details key={record.id} style={c1PulseStyle(record.id)} className={`c1-incident c1-severity-${statusTone(record.severity)}`} data-incident-card={record.id} data-cascading={row.cascading || undefined} open={isOpen} ref={element => { if (element) cards.current.set(record.id, element); else cards.current.delete(record.id); }}>
              <summary aria-expanded={isOpen} aria-controls={`c1-details-${record.id}`} onClick={event => { event.preventDefault(); setExpanded(isOpen ? null : record.id); }}>
                <span className="c1-sector-icon"><InfrastructureIcon kind={infrastructureKind(record)} size={22}/></span>
                <span className="c1-card-title"><b>{record.title ?? "Untitled incident"}{row.cascading && <span className="c1-cascade-label"><i className="c1-cascade-dot" aria-hidden="true"/>CASCADING IMPACT</span>}</b><small><span className="mono">{record.id}</span> · {record.location?.label ?? "Location not recorded"}</small></span>
                <span className="c1-card-status"><StatusChip status={record.severity}>{words(record.severity ?? "unknown")}</StatusChip><Tone status={record.status}>{state}</Tone></span>
                <span className="c1-elapsed mono">{row.elapsed === null ? "Unknown" : formatDuration(row.elapsed)}</span><span className="c1-chevron" aria-hidden="true">›</span>
              </summary>
              {isOpen && <div className="c1-card-body" id={`c1-details-${record.id}`}>
                <div className="c1-detail-facts"><span>Sectors <b>{row.sectors.map(code => `${code} ${idtSectorName(code) ?? "Unclassified sector"}`).join(" · ") || "Not recorded"}</b></span></div>
                {!row.incident?.runSnapshot ? <p className="tone-grey">Not yet modeled</p> : <p className="c1-impact-line">{row.incident.runSnapshot.seed?.lossType === "unsafe_water" ? `${count(row.footprint?.utility?.people ?? null)} people on unsafe water` : words(row.incident.runSnapshot.seed?.lossType ?? "Captured impact")}{group?.items[0]?.windowHours && <> · earliest window <Tone window={group.items[0].windowHours}>{planningWindow(group.items[0].windowHours)}</Tone></>}{!!row.footprint?.probed.length && <> · {row.footprint.probed.length} utilities probed</>}</p>}
                <p className="c1-last-update"><b>Latest analyst update</b> {row.latestUpdate ? <>{activityDisplayText(String(row.latestUpdate.text ?? row.latestUpdate.message ?? ""))} <small>{timeLabel(String(row.latestUpdate.at ?? row.latestUpdate.createdAt ?? ""))}</small></> : "No analyst update recorded."}</p>
                <div className="c1-actions"><button onClick={() => command("cop", row)}>C2 Incident →</button>{row.incident?.runSnapshot && <><button onClick={() => command("cyber", row)}>C3 Attack →</button><button onClick={() => command("consequence", row)}>C4 Impact →</button></>}{row.incident ? <button className="c1-analyst-link" onClick={() => analyst("case-file", row)}>Case file in Analyst ↗</button> : <button className="c1-analyst-link" onClick={() => analyst("command", row)}>Alerts in Analyst ↗</button>}</div>
              </div>}
            </details>;
          })}</div>
          {!model.rows.length && <p className="tone-grey">No open incidents.</p>}
          <button className="c1-closed-link" onClick={() => command("leadership")}>Closed incidents are on C6 · Leadership brief →</button>
        </section>
        <section className="c1-panel" aria-labelledby="c1-decisions-heading">
          <div className="c1-panel-heading"><h2 id="c1-decisions-heading">Decisions waiting on the Chief</h2><small>All incidents</small></div>
          {model.decisions.map(decision => <button className="c1-action-row" key={`${decision.row.record.id}:${decision.record.id}`} onClick={() => command("leadership", decision.row)}><span><b>{decision.record.title ?? decision.record.label ?? text(decision.record.optionLabel, "Recorded decision")}</b><small className="mono">{decision.row.record.id}</small></span><span><Tone {...(decision.window ? { window: decision.window } : { status: "waiting_on_chief" })}>{decision.windowLabel}</Tone><i>C6 →</i></span></button>)}
          {!model.decisions.length && <p className="tone-grey">No decisions waiting on the Chief.</p>}
        </section>
        <section className="c1-panel" aria-labelledby="c1-facilities-heading">
          <div className="c1-panel-heading"><h2 id="c1-facilities-heading">Critical facilities at risk</h2><small>All incidents · modeled</small></div>
          <div className={allFacilities ? "c1-facilities-scroll" : ""}>{model.facilities.map(group => {
            const items = displayFacilities.filter(item => item.group === group);
            return !!items.length && <div className="c1-facility-group" key={group.row.record.id}><div className="c1-facility-context"><span><b className="mono">{group.row.record.id}</b> · {group.row.record.title}</span><button onClick={() => command("consequence", group.row)}>C4 →</button></div>{items.map(({ item }) => <button className="c1-action-row" data-facility={item.id} key={item.id} onClick={() => command("consequence", group.row, item.id)}><span><b>{item.label}</b><small className="mono">{group.row.record.id}</small></span><span><Tone window={item.windowHours}>{planningWindow(item.windowHours)}</Tone><i>C4 →</i></span></button>)}{group.boilWater && <p className="c1-boil-water tone-grey">{group.boilWater}</p>}</div>;
          })}</div>
          {allFacilityRows.length > 3 && <button className="c1-more" onClick={() => setAllFacilities(!allFacilities)}>{allFacilities ? "Show fewer" : `View all facilities (${allFacilityRows.length})`}</button>}
          {!allFacilityRows.length && <p className="tone-grey">{anyRun ? "No downstream facilities captured at risk." : "Not yet modeled"}</p>}
        </section>
      </aside>
    </div>
    <section className="c1-panel c1-updates" aria-labelledby="c1-updates-heading">
      <div className="c1-panel-heading"><h2 id="c1-updates-heading">From the analysts</h2><button className="c1-analyst-link" onClick={() => { persistFocus(null); props.onOpenAnalyst("command", null, null); }}>All updates in Analyst ↗</button></div>
      <div className="c1-update-grid">{model.updates.map(update => <button key={update.record.id} onClick={() => update.incidentId && pick(update.incidentId)} disabled={!update.incidentId}><time className="mono">{timeLabel(update.time)} · {age(update.time, model.recordsAsOf)}</time><p>{activityDisplayText(update.text)}</p>{update.incidentId && <small className="mono">{update.incidentId} →</small>}</button>)}</div>
      {!model.updates.length && <p className="tone-grey">No analyst updates recorded for open incidents.</p>}
    </section>
  </div>;
}

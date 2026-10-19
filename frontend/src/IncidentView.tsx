import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CommandView } from "./commandTypes.ts";
import type { ScriptedViewProps } from "./scriptedTypes.ts";
import { incidentStack, type IncidentStackNode, type IncidentStackDependencyLink } from "./incidentStack.ts";
import { defaultIncidentId } from "./incidentSelection.ts";
import { incidentFocusLocation, readIncidentFocus } from "./incidentFocus.ts";
import IncidentSelector from "./IncidentSelector.tsx";
import IncidentRecordedFootprints from "./IncidentRecordedFootprints.tsx";
import CommandInfrastructureMap from "./CommandInfrastructureMap.tsx";
import { StatusChip, Tone } from "./visualPrimitives.ts";
import { planningWindow, timeLabel, words } from "./commandCenterModel.ts";
import { formatDuration } from "./displayTime.ts";
import { idtSectorName } from "./idt.ts";
import { api } from './api.ts';
import { object, text } from './scriptedTypes.ts';
import { incidentViewModel } from './incidentViewModel.ts';
import { c1OverviewModel } from './c1OverviewModel.ts';
import { sectorOf } from './incidentPresentation.ts';
import IncidentDependencyMap from './IncidentDependencyMap.tsx';
import type { ConsequenceNode } from './consequencesModel.ts';
import { consequenceNodeState, type ConsequenceProjection } from './consequencesModel.ts';
import "./incident-view.css";

interface Props extends ScriptedViewProps {
  selectedEntityId?: string | null;
  onSelect: (id: string) => void;
  onClearSelection?: () => void;
  onSelectEntity?: (id: string | null) => void;
  onOpenAnalyst: (view: CommandView, caseId?: string | null, entityId?: string | null) => void;
  onNavigate: (view: CommandView) => void;
}
const count = (value: number | null) => value === null ? "Unknown" : value.toLocaleString("en-US");
const nodeMatches = (node: IncidentStackNode, query: string) => `${node.entity.label} ${node.entity.id} ${node.idtCode ?? ""} ${node.classification.label} ${node.state.label}`.toLowerCase().includes(query.trim().toLowerCase());
const roleLabel = (node: IncidentStackNode) => node.role === "source" ? "Source" : node.role === "plant" && node.state.tone === "red" ? "Attacked" : node.state.tone === "green" ? "Normal" : node.state.label;
const reserve = (node: IncidentStackNode) => {
  const values = node.dependsOn.map(({dependency:d}) => typeof d.usableBackupMinHours === "number" && typeof d.usableBackupMaxHours === "number" ? `${d.usableBackupMinHours}–${d.usableBackupMaxHours} h` : "Not recorded");
  return [...new Set(values)].join(" · ") || "Not recorded";
};

/** Five read-only C2 bands. Evidence and all writes remain owned by the workspace. */
export default function IncidentView(props: Props) {
  const [picked, setPicked] = useState<string | null>(() => typeof window === "undefined" ? null : readIncidentFocus(window.location.href));
  // C2 always starts closed. The workspace entity cursor must not auto-open a row.
  const [localEntity, setLocalEntity] = useState<string | null>(null);
  const priorEntity = useRef(props.selectedEntityId);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [notAffectedOpen, setNotAffectedOpen] = useState(false);
  const cards = useRef(new Map<string, HTMLElement>());
  const mapPanel = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState<number>();
  const stack = useMemo(() => {
    const initial = incidentStack(props, picked);
    const chosen = picked ?? defaultIncidentId({ ...props.records, statewideIncidents: initial.footPrintModel.rows }, { cases: props.incidents, data: props.data });
    if (!chosen) return { ...initial, incidentRecord: null };
    return chosen === initial.incidentRecord?.id ? initial : incidentStack(props, chosen);
  }, [props.data, props.incidents, props.selected, props.records, props.reference, picked]);
  const model = { ...stack.footPrintModel, layers: stack.footPrintModel.layers.filter(layer => layer.caseId === stack.incidentRecord?.caseId) };
  const rows = model.rows;
  const record = stack.incidentRecord;
  const caseId = stack.incident?.id ?? null;
  const selectedId = stack.nodes.some(n => n.entity.id === localEntity) ? localEntity : null;
  const incidentId = record?.id ?? null;
  const [projection, setProjection] = useState<ConsequenceProjection | null>(null);
  const projectionCards = useRef(new Map<string, HTMLElement>());
  const [projectionError, setProjectionError] = useState('');
  const [sector, setSector] = useState(() => typeof window === 'undefined' ? 'all' : new URL(window.location.href).searchParams.get('sector') ?? 'all');
  useEffect(() => {
    let live = true; setProjection(null); setProjectionError('');
    if (incidentId) api<ConsequenceProjection>(`/v1/command/consequences?incidentId=${encodeURIComponent(incidentId)}`).then(value => { if(live) setProjection(value); }).catch(error => { if(live) setProjectionError(String(error)); });
    return () => { live = false; };
  }, [incidentId]);
  const currentProjection = projection?.incident?.id === incidentId ? projection : null;
  const presentation = incidentViewModel(record ?? {id:''}, currentProjection, props.records, sector);
  // Watch records enrich the schematic without inventing geography or a dependency.
  const watchRows = presentation.watch.length ? presentation.watch : (currentProjection?.watchAssets ?? []).map((w,i)=>({...w,id:`watch-${i}`}));
  const mapNodes = useMemo(() => {
    const nodes: ConsequenceNode[] = (currentProjection?.nodes ?? []).map(node => {
      const watched = watchRows.some(w=>w.entityId===node.id);
      return watched && !node.windowHours && !node.source && !node.upstream ? {...node,status:'on_watch'} : node;
    });
    for(const watch of watchRows) if(!nodes.some(n=>n.id===watch.entityId)) {
      const entity = props.data.entities.find(e=>e.id===watch.entityId);
      const recorded = object(object(watch).entity);
      nodes.push({id:String(watch.entityId),name:entity?.label ?? text(recorded.name ?? recorded.label,String(watch.entityId)),type:entity?.type ?? text(recorded.type),icon:text(recorded.icon),sector:sectorOf(entity ?? recorded) ?? '',status:'on_watch',windowHours:null,impactCount:0,paths:[],reserves:[],reserveLabel:'Not recorded',sourceRefs:[]});
    }
    return nodes;
  }, [currentProjection, props.data.entities, JSON.stringify(watchRows)]);
  const mapVisible = new Set(presentation.visible);
  for(const node of mapNodes) if(sector==='all' || sectorOf(node)?.toLowerCase()===sector) mapVisible.add(node.id);
  const selectProjectionEntity = (id: string | null) => {
    setLocalEntity(id); props.onSelectEntity?.(id);
    if(id && !mapVisible.has(id)) changeSector('all');
    if(id) requestAnimationFrame(()=>projectionCards.current.get(id)?.scrollIntoView({behavior:'smooth',block:'nearest'}));
  };
  const waiting = c1OverviewModel(props).decisions.filter(d => d.row.record.id === incidentId);
  const changeSector = (value: string) => { setSector(value); const url = new URL(window.location.href); if(value === 'all') url.searchParams.delete('sector'); else url.searchParams.set('sector', value); window.history.replaceState(null, '', url); };
  useEffect(() => {
    const panel = mapPanel.current;
    if (!panel) return;
    const measure = () => setPanelHeight(Math.ceil(panel.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [incidentId, stack.infrastructureAvailable]);
  useEffect(() => {
    const sync = () => { setPicked(readIncidentFocus(window.location.href)); setSector(new URL(window.location.href).searchParams.get('sector') ?? 'all'); };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    setLocalEntity(null); setQuery(""); setShowAll(new Set()); setNotAffectedOpen(false);
  }, [incidentId]);
  useEffect(() => {
    if (priorEntity.current !== props.selectedEntityId) {
      priorEntity.current = props.selectedEntityId;
      // Workspace startup may publish its default cursor after C2 mounts.
      // That hydration is not a request to open a facility disclosure.
      setLocalEntity(current => current === null ? null : props.selectedEntityId ?? null);
    }
  }, [props.selectedEntityId]);
  useEffect(() => {
    if (incidentId) window.history.replaceState(null, "", incidentFocusLocation(window.location.href, incidentId));
  }, [incidentId]);
  const analyst = (view: CommandView, entityId?: string | null) => props.onOpenAnalyst(view, caseId, entityId ?? stack.sourceId);
  const navigate = (view: CommandView) => { if (caseId) props.onSelect(caseId); props.onNavigate(view); };
  const selectEntity = (id: string | null, reveal = true) => {
    setLocalEntity(id); props.onSelectEntity?.(id);
    const node = stack.nodes.find(n => n.entity.id === id);
    if (node?.group === "not-affected") setNotAffectedOpen(true);
    if (node) setShowAll(old => new Set([...old, node.group]));
    if (id && reveal && typeof requestAnimationFrame === "function") requestAnimationFrame(() => cards.current.get(id)?.scrollIntoView({ behavior:"smooth", block:"nearest" }));
  };
  const pick = (id: string) => {
    changeSector('all');
    const row = rows.find(r => r.id === id); if (!row) return;
    setPicked(id); setQuery(""); setShowAll(new Set()); setNotAffectedOpen(false); setLocalEntity(null);
    if (typeof window !== "undefined") window.history.replaceState(null,"",incidentFocusLocation(window.location.href,id));
    if (row.caseId) props.onSelect(row.caseId); else props.onClearSelection?.();
    props.onSelectEntity?.(null);
  };
  const dependencyLink = (link: IncidentStackDependencyLink) => <p key={link.dependency.id}><button className="iv-record-link" onClick={() => stack.nodes.some(n => n.entity.id === link.entityId) ? selectEntity(link.entityId) : analyst("entity-profile", link.entityId)}>{link.entityLabel ?? "Missing infrastructure record"}</button> · {link.functionLabel ?? words(link.dependency.requiredService)} <small>({link.captured ? "captured" : "reference"}{link.modeled ? ", modeled" : ", not a modeled effect"})</small></p>;
  const detail = (node: IncidentStackNode) => {
    const services = [...new Set(node.dependsOn.map(l => l.functionLabel ?? words(l.dependency.requiredService)))].join(" · ");
    const explanation = node.group === "at-risk" ? `${node.entity.label} depends on ${services || "recorded services"}${node.earliestWindow ? `; modeled loss of function in ${planningWindow(node.earliestWindow)}.` : "; timing is not recorded."}` : node.state.reason ?? (node.state.line === "dotted" ? "In the recorded service area, with no recorded dependency on the affected supply." : node.role === "source" ? `${node.entity.label} is the incident source: ${node.state.label}.` : node.role === "plant" ? `${node.entity.label} supplies the provider; ${node.state.label}.` : node.role === "upstream" ? `${node.entity.label} supplies the upstream chain; ${node.state.label}.` : node.state.label);
    const pathLabels = [...new Set(node.impacts.flatMap(i => (i.paths ?? []).map(path => path.map(id => { const d = stack.layer.dependencies.find(d => d.id === id); return d ? [d.provider,d.dependent].map(e => stack.layer.entities.find(n => n.id === e)?.label ?? "Missing record").join(" → ") : "Missing dependency record"; }).join(" → "))))];
    return <div className="iv-facility-body"><p>{explanation}</p>
      {node.role === "plant" && <button className="command-link" onClick={() => navigate("cyber")}>How it got in: C3 →</button>}
      <dl><dt>Depends on</dt><dd>{node.dependsOn.map(l => l.entityLabel ?? "Missing record").join(" · ") || "No recorded dependency"}</dd>
        {node.group === "at-risk" ? <><dt>Reserve</dt><dd className="mono">{reserve(node)}</dd><dt>Path</dt><dd>{pathLabels.join("; ") || "No captured path recorded"}</dd></> : <><dt>Supplies</dt><dd>{node.supplies.map(l => l.entityLabel ?? "Missing record").join(" · ") || "No outgoing dependency recorded"}</dd>{node.role === "source" && model.boilWaterRule && <><dt>Decides</dt><dd>{String(model.boilWaterRule.decidedBy ?? "Authority not recorded")}</dd></>}{node.affectedAssets.length > 0 && <><dt>Affected assets</dt><dd>{node.affectedAssets.map(a => a.label).join(" · ")}</dd></>}{node.group === "not-affected" && <><dt>Why not affected</dt><dd>{node.state.reason ?? node.state.label}</dd></>}</>}
      </dl>
      <details><summary>Record details</summary><div className="iv-record-details">
        <StatusChip status={node.captured ? "modeled" : "not_modeled"}>{node.captured ? "Captured analysis · modeled, not observed" : "Reference inventory · not yet modeled"}</StatusChip>
        <dl><dt>Entity</dt><dd>{node.entity.id}</dd><dt>IDT lineage</dt><dd>{node.classification.label}{node.idtCode ? ` · IDT ${node.idtCode}` : " · not assigned"}</dd><dt>Record basis</dt><dd>{node.captured ? "Captured analysis" : "Reference inventory"} · {node.origin}</dd><dt>Map position</dt><dd>Schematic positions{node.coordinates ? ` · recorded coordinates ${node.coordinates.join(", ")}` : " · coordinates not recorded"}</dd><dt>Model</dt><dd>{node.modelVersion ?? "Not modeled"} · revision {node.baselineRevision}</dd><dt>Captured</dt><dd>{node.capturedAt ? timeLabel(node.capturedAt) : "Not modeled"}</dd></dl>
        {node.assetStatuses.map(status => <p key={status.id}><Tone status={status.status}>{words(status.status ?? "unknown")}</Tone>{status.detail && <> · {status.detail}</>}{status.at && <> · {timeLabel(status.at)}</>}</p>)}
        {node.impacts.length > 0 && <ul className="iv-impacts">{node.impacts.map((impact,i) => <li key={`${impact.id}-${i}`}><span>{stack.layer.serviceFunctions.find(f => f.id === impact.functionId)?.label ?? words(impact.functionId)}</span><Tone className="mono" window={impact.windowHours}>{planningWindow(impact.windowHours)}</Tone><span>{words(impact.lossType)} · {words(impact.state)} · modeled</span></li>)}</ul>}
        {node.exclusions.map((exclusion,i) => <p key={i}>{String(exclusion.reason ?? "Exclusion reason not recorded")} · recorded exclusion</p>)}
        <div className="iv-dependencies"><h4>Depends on</h4>{node.dependsOn.length ? node.dependsOn.map(dependencyLink) : <p>None recorded</p>}<h4>Supplies</h4>{node.supplies.length ? node.supplies.map(dependencyLink) : <p>None recorded</p>}</div>
        <h4>Linked saved cases</h4>{node.caseIds.map(id => <p key={id}><button className="iv-record-link" onClick={() => props.onOpenAnalyst("case-file", id, node.entity.id)}>{props.incidents.find(c => c.id === id)?.title ?? "Saved case"} ↗</button> · {id}</p>)}
        <p>Sources: {node.sources.join(" · ") || node.sourceRefs.join(" · ") || "Not recorded"}</p><h4>Assumptions</h4>{node.assumptions.length ? <ul>{node.assumptions.map((a,i) => <li key={i}>{a}</li>)}</ul> : <p>None recorded</p>}
      </div></details>
      <button className="command-link" onClick={() => analyst("entity-profile",node.entity.id)}>Inspect current record in Analyst ↗</button>
    </div>;
  };
  const facility = (node: IncidentStackNode) => {
    const open = selectedId === node.entity.id;
    return <article className={`iv-facility${open ? " selected" : ""}`} key={node.entity.id} data-facility-id={node.entity.id} data-node-state={node.state.tone} ref={element => { if(element) cards.current.set(node.entity.id,element); else cards.current.delete(node.entity.id); }}>
      <button className="iv-facility-summary" aria-expanded={open} aria-controls={`iv-detail-${node.entity.id}`} onClick={() => selectEntity(open ? null : node.entity.id,false)}>
        <span className={`iv-state-ring tone-${node.state.tone}`} data-line={node.state.line} aria-hidden="true"/>
        <span className="iv-facility-title"><strong>{node.entity.label}</strong><small>{node.classification.label}{node.idtCode ? ` · IDT ${node.idtCode}` : ""}</small></span>
        <span className={`iv-state-label mono tone-${node.state.tone}`}>{roleLabel(node)}</span><span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>{open && <div id={`iv-detail-${node.entity.id}`}>{detail(node)}</div>}
    </article>;
  };
  const buckets = [{id:"at-risk",label:"At risk",items:stack.groups.atRisk},{id:"supply-chain",label:"Supply chain",items:stack.groups.supplyChain},{id:"not-affected",label:"Not affected",items:stack.groups.notAffected},{id:"unmodeled",label:stack.run ? "No status recorded" : "Not yet modeled",items:stack.groups.unmodeled}];
  const selector = <IncidentSelector rows={rows} current={record} data={props.data} now={props.records.now} recordsAsOf={props.records.now} onChoose={pick}/>;
  const incidentLine = record && <><span className="mono">{record.id}</span> {record.title} <StatusChip status={record.severity}>{words(record.severity ?? "unknown")}</StatusChip> <StatusChip status={record.status}>{record.status === "open" ? "Under investigation" : words(record.status ?? "unknown")}</StatusChip> <span className="mono">{formatDuration(model.elapsed,"Unknown")}</span></>;
  const header = typeof document === "undefined" ? null : document.querySelector(".page-heading");
  const context = typeof document === "undefined" ? null : document.getElementById("selected-incident-context");
  return <section className="incident-view" data-screen="cop" aria-label="Incident view">
    {header ? createPortal(selector,header) : <div className="iv-command-strip"><p>{incidentLine}</p>{selector}</div>}
    {context && createPortal(incidentLine,context)}
    {!record ? <p className="iv-empty" role="status">No incidents recorded. Incidents appear here when recorded by an analyst.</p> : <>
      <section className="iv-summary-band" aria-label="What happened">
        <p className="iv-risk-summary">{record.summary || stack.incident?.eventSnapshot?.description || "No incident summary recorded."}</p>
        <div className="iv-facts">
          <div className="iv-fact"><span>Where</span><b>{record.location?.label ?? "Location not recorded"}</b></div>
          <div className="iv-fact"><span>{presentation.service ? 'Service affected' : 'People affected'}</span><b>{presentation.service ?? (stack.run ? <Tone status="confirmed">{count(stack.people)}{stack.context.lossType ? ` on ${words(stack.context.lossType)}` : " in recorded service areas"}</Tone> : "Not yet modeled")}</b></div>
          <div className="iv-fact"><span>Sectors</span><b>{presentation.sectors.length ? presentation.sectors.map(name => <span className="iv-sector-chip" key={name}>{name}</span>) : record.sectors?.map(code => `${idtSectorName(code.split('.')[0]) ?? "Unassigned"} (${code})`).join(" · ") || "Not recorded"}</b></div>
          {presentation.economic && <div className="iv-fact"><span>Economic impact</span><b>{presentation.economic}</b></div>}
          {presentation.watch.length > 0 && <div className="iv-fact"><span>Also watching</span><b className="tone-amber">{presentation.watch.map(w => currentProjection?.nodes.find(n => n.id === w.entityId)?.name ?? props.data.entities.find(e => e.id === w.entityId)?.label ?? w.entityId).join(' · ')}</b></div>}
          <div className="iv-fact"><span>Also probed</span><b>{model.probed.length ? <Tone status="probed">{model.probed.map(p => p.label).join(" and ")} · {count(model.probedPeople)} people · probing only, no confirmed compromise</Tone> : "None recorded"}</b></div>
          <div className="iv-fact"><span>Waiting on</span><b><Tone status={waiting.length ? "waiting" : "not_yet"}>{waiting.length ? waiting.map(d => `${d.record.title ?? d.record.label ?? 'Decision'} · ${d.windowLabel}`).join('; ') : 'No waiting decisions'}</Tone> · <button className="command-link" onClick={() => navigate("leadership")}>C6 →</button></b></div>
        </div>
        <div className="iv-summary-links"><div>{model.boilWaterRule && <span><Tone status="possible">{String(model.boilWaterRule.label)}</Tone> · {String(model.boilWaterRule.decidedBy ?? "Authority not recorded")}</span>}{model.excluded.map(f => <span key={f.id}>{f.label} not affected · {f.reason}</span>)}</div><nav aria-label="Incident evidence"><button className="command-link" onClick={() => navigate("cyber")}>How it got in: C3 →</button><button className="command-link" onClick={() => navigate("consequence")}>Full consequences: C4 →</button></nav></div>
      </section>
      {projectionError && <p role="status">Infrastructure analysis unavailable: {projectionError}</p>}
      {currentProjection?.analysis ? <div className="iv-workspace">
        <section className="iv-panel iv-map-panel" aria-label="What it touches">
          <h2>What it touches · {currentProjection.source?.name ?? currentProjection.source?.label}</h2>
          <div className="iv-sector-filters" role="group" aria-label="Infrastructure sectors">{['All', ...presentation.sectors].map(name => <button key={name} aria-pressed={sector === name.toLowerCase()} onClick={() => changeSector(name.toLowerCase())}>{name}</button>)}</div>
          <IncidentDependencyMap key={incidentId} nodes={mapNodes} edges={currentProjection.edges} sourceId={currentProjection.source?.id ?? mapNodes.find(n => n.source)?.id ?? ''} visible={mapVisible} entityIcons={currentProjection.entityIcons ?? props.reference.entityIcons} watchRelationships={watchRows.map(w => ({entityId:String(w.entityId),reason:text(w.reason,'Watch reason not recorded')}))} attackedSystem={currentProjection.sourceSystems?.[0]} selectedId={localEntity} onSelect={selectProjectionEntity}/>
          <p className="iv-hint">Infrastructure at risk (modeled) · select an item to see why it matters</p>
        </section>
        <aside className="iv-panel iv-list-panel iv-projection-list"><header className="iv-panel-heading"><h2>Infrastructure</h2><small>Modeled {timeLabel(currentProjection.analysis.createdAt)}</small></header><p className="iv-hint">Select any item, here or on the drawing, to see why it matters.</p>
          <div className="iv-projection-scroll">
          {['At risk','Supply chain','Not affected'].map(group => { const nodes = currentProjection.nodes.filter(n => presentation.visible.has(n.id) && (group === 'At risk' ? !n.source && !!n.windowHours : group === 'Supply chain' ? n.source || n.upstream : n.notAffected)).sort((a,b)=>(a.windowHours?.[0] ?? Infinity)-(b.windowHours?.[0] ?? Infinity) || a.name.localeCompare(b.name)); return nodes.length > 0 && <section key={group}><h3 className="iv-group-caption">{group} · {nodes.length}</h3>{nodes.map(node => <details className={`iv-facility${localEntity===node.id?' selected':''}`} key={node.id} ref={element=>{if(element)projectionCards.current.set(node.id,element);else projectionCards.current.delete(node.id);}} open={localEntity === node.id}><summary onClick={event => {event.preventDefault(); selectProjectionEntity(localEntity === node.id ? null : node.id);}}><b>{node.name}</b><span className={`tone-${consequenceNodeState(node).tone}`}> · {consequenceNodeState(node).label}</span><small>{sectorOf(node)}{node.score!=null?` · score ${node.score}`:''}{node.idt?.path ? ` · IDT ${node.idt.path}` : ''}</small></summary><p>{text(object(node).whyItMatters, `${node.name} depends on ${currentProjection.edges.filter(e => e.to === node.id).map(e => e.label).join(', ') || 'the recorded infrastructure chain'}.`)}</p>{watchRows.filter(w=>w.entityId===node.id).map(w=><p className="tone-amber" key={w.id}>{text(w.reason,'Same campaign · relationship recorded, not proof of compromise')}</p>)}<button className="command-link iv-analyst-link" onClick={() => analyst('entity-profile',node.id)}>Inspect current record in Analyst ↗</button></details>)}</section>; })}
          {watchRows.filter(w=>mapVisible.has(String(w.entityId)) && !currentProjection.nodes.some(n=>n.id===w.entityId && n.windowHours)).length > 0 && <section><h3 className="iv-group-caption">On watch · same campaign · {watchRows.filter(w=>mapVisible.has(String(w.entityId)) && !currentProjection.nodes.some(n=>n.id===w.entityId && n.windowHours)).length}</h3>{watchRows.filter(w=>mapVisible.has(String(w.entityId)) && !currentProjection.nodes.some(n=>n.id===w.entityId && n.windowHours)).map(w => <article className={`iv-watch-record${localEntity===w.entityId?' selected':''}`} key={w.id} ref={element=>{if(element)projectionCards.current.set(String(w.entityId),element);else projectionCards.current.delete(String(w.entityId));}}><button className="iv-watch-button" aria-expanded={localEntity===w.entityId} onClick={()=>selectProjectionEntity(localEntity===w.entityId?null:String(w.entityId))}><b>{mapNodes.find(n => n.id === w.entityId)?.name ?? String(w.entityId)}</b><span>On watch · no modeled service loss</span></button><p>{text(w.reason,'Same campaign · relationship recorded, not proof of compromise')}</p>{localEntity===w.entityId && <button className="command-link iv-analyst-link" onClick={()=>analyst('entity-profile',String(w.entityId))}>Inspect current record in Analyst ↗</button>}</article>)}</section>}
          </div>
          <footer className="iv-list-footer"><button className="command-link iv-analyst-link" onClick={() => analyst(caseId ? 'case-file' : 'command')}>{caseId ? 'Case file' : 'Alerts'} in Analyst ↗</button></footer>
        </aside>
      </div> : !stack.infrastructureAvailable ? <section className="iv-panel iv-development"><p>No consequence model yet. Infrastructure view for this incident type is in development.</p><button className="command-link" onClick={() => analyst("command")}>Open in Analyst ↗</button></section> : <div className="iv-workspace">
        <section ref={mapPanel} className="iv-panel iv-map-panel" aria-label="What it touches"><CommandInfrastructureMap key={record.id} data={props.data} incidents={props.incidents} selected={stack.incident} selectedEntityId={selectedId} onSelectEntity={id => selectEntity(id)} onOpenEntity={id => analyst("entity-profile",id)} onSelectCase={props.onSelect} stack={stack} facilityQuery={query}/>{stack.missingRecords > 0 && <p className="iv-caption">{stack.missingRecords} captured records cannot be placed; no missing infrastructure inferred.</p>}</section>
        <aside className="iv-panel iv-list-panel" style={{height:panelHeight}} aria-labelledby="iv-facilities-heading"><header className="iv-panel-heading"><h2 id="iv-facilities-heading">Facilities</h2><small>{stack.run ? `Modeled ${timeLabel(stack.run.createdAt)}` : "Not yet modeled"}</small></header><p className="iv-hint">Select any facility, here or on the drawing, to see why it matters.</p>
          {stack.nodes.length > 12 && <input className="iv-facility-search" type="search" aria-label="Find a facility" placeholder="Find a facility" value={query} onChange={e => setQuery(e.target.value)}/>}
          <div className="iv-facilities">{buckets.map(bucket => {
            const items = bucket.items.filter(n => nodeMatches(n,query)); if (!items.length) return null;
            const collapsed = bucket.id === "not-affected" && !notAffectedOpen && !query;
            const expanded = !!query || showAll.has(bucket.id);
            const visible = expanded ? items : items.slice(0,8);
            return <section key={bucket.id} className="iv-facility-group" data-facility-group={bucket.id}>
              {bucket.id === "not-affected" ? <button className="iv-group-toggle" aria-expanded={!collapsed} onClick={() => setNotAffectedOpen(!notAffectedOpen)}>{bucket.label} · {items.length} {collapsed ? "▸ show" : "▾ hide"}</button> : <h3 className="iv-group-caption">{bucket.label}</h3>}
              {!collapsed && <>{visible.map(facility)}{items.length > 8 && <button className="command-link iv-show-all" onClick={() => setShowAll(old => { const next = new Set(old); if(next.has(bucket.id))next.delete(bucket.id);else next.add(bucket.id);return next; })}>{expanded ? "Show fewer" : `Show all ${items.length}${bucket.id === "at-risk" ? " at risk" : ""}`}</button>}</>}
            </section>;
          })}{!stack.nodes.some(n => nodeMatches(n,query)) && <p className="iv-empty">No facilities match this search.</p>}</div>
          <footer className="iv-list-footer"><button className="iv-open-analyst" onClick={() => analyst("cop",selectedId ?? stack.sourceId)}>Open in Analyst</button></footer>
        </aside>
      </div>}
      <section className="iv-more" aria-label="More"><h2 className="iv-group-caption">More</h2><IncidentRecordedFootprints model={model}/></section>
    </>}
  </section>;
}

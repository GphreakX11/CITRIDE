import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CommandView } from './commandTypes.ts';
import type { ScriptedViewProps } from './scriptedTypes.ts';
import { incidentStack } from './incidentStack.ts';
import { defaultIncidentId } from './incidentSelection.ts';
import { useConsequenceSelection, writeConsequenceSelection } from './consequenceSelection.ts';
import IncidentSelector from './IncidentSelector.tsx';
import IncidentRecordedFootprints from './IncidentRecordedFootprints.tsx';
import SectorCascadeView from './SectorCascadeView/SectorCascadeView.tsx';
import { StatusChip, Tone } from './visualPrimitives.ts';
import { words } from './commandCenterModel.ts';
import { formatDuration } from './displayTime.ts';
import { idtSectorName } from './idt.ts';
import { api } from './api.ts';
import { incidentViewModel } from './incidentViewModel.ts';
import { c1OverviewModel } from './c1OverviewModel.ts';
import type { ConsequenceProjection } from './consequencesModel.ts';
import './incident-view.css';
interface Props extends ScriptedViewProps {
 selectedEntityId?:string|null; onSelect:(id:string)=>void;onClearSelection?:()=>void;onSelectEntity?:(id:string|null)=>void;
 onOpenAnalyst:(view:CommandView,caseId?:string|null,entityId?:string|null)=>void;onNavigate:(view:CommandView)=>void;
}
/** Screen composition only: incident facts, sector feature, then recorded footprints. */
export default function IncidentView(props:Props) {
 const [selection]=useConsequenceSelection();
 const stack=useMemo(()=>{const initial=incidentStack(props,selection.incidentId);const chosen=selection.incidentId ?? defaultIncidentId({...props.records,statewideIncidents:initial.footPrintModel.rows},{cases:props.incidents,data:props.data});return chosen && chosen!==initial.incidentRecord?.id ? incidentStack(props,chosen):chosen?initial:{...initial,incidentRecord:null};},[props.data,props.incidents,props.selected,props.records,props.reference,selection.incidentId]);
 const record=stack.incidentRecord,incidentId=record?.id ?? null,caseId=stack.incident?.id ?? null;
 const model={...stack.footPrintModel,layers:stack.footPrintModel.layers.filter(l=>l.caseId===record?.caseId)};
 const [projection,setProjection]=useState<ConsequenceProjection|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{let live=true;setProjection(null);setError('');if(incidentId)api<ConsequenceProjection>(`/v1/command/consequences?incidentId=${encodeURIComponent(incidentId)}`).then(p=>{if(live)setProjection(p);}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[incidentId]);
 useEffect(()=>{if(incidentId)writeConsequenceSelection({incidentId},true);},[incidentId]);
 const current=projection?.incident?.id===incidentId?projection:null;
 const facts=incidentViewModel(record ?? {id:''},current,props.records,selection.sector,props.data);
 const waiting=c1OverviewModel(props).decisions.filter(d=>d.row.record.id===incidentId);
 const navigate=(view:CommandView,focus?:{sector:string;entityId:string|null})=>{if(caseId)props.onSelect(caseId);props.onNavigate(view);writeConsequenceSelection({incidentId,sector:focus?.sector ?? selection.sector,entityId:focus ? focus.entityId : selection.entityId},true);};
 const pick=(id:string)=>{const row=model.rows.find(r=>r.id===id);if(!row)return;if(row.caseId)props.onSelect(row.caseId);else props.onClearSelection?.();writeConsequenceSelection({incidentId:id,sector:'all',entityId:null});props.onSelectEntity?.(null);};
 const selector=<IncidentSelector rows={model.rows} current={record} data={props.data} now={props.records.now} recordsAsOf={props.records.now} onChoose={pick}/>;
 const line=record && <><span className="mono">{record.id}</span> {record.title} <StatusChip status={record.severity}>{words(record.severity ?? 'unknown')}</StatusChip> <StatusChip status={record.status}>{record.status==='open'?'Under investigation':words(record.status ?? 'unknown')}</StatusChip> <span className="mono">{formatDuration(model.elapsed,'Unknown')}</span></>;
 const header=typeof document==='undefined'?null:document.querySelector('.page-heading');
 const context=typeof document==='undefined'?null:document.getElementById('selected-incident-context');
 return <section className="incident-view" data-screen="cop" aria-label="Incident view">
 {header?createPortal(selector,header):<div className="iv-command-strip"><p>{line}</p>{selector}</div>}{context && createPortal(line,context)}
 {!record?<p className="iv-empty" role="status">No incidents recorded. Incidents appear here when recorded by an analyst.</p>:<>
 <section className="iv-summary-band" aria-label="What happened"><p className="iv-risk-summary">{record.summary || 'No incident summary recorded.'}</p><div className="iv-facts">
 <div className="iv-fact"><span>Where</span><b>{record.location?.label ?? 'Location not recorded'}</b></div>
 <div className="iv-fact"><span>{facts.service?'Service affected':'People affected'}</span><b>{facts.service ?? (current?.people!=null?current.people.toLocaleString('en-US'):'Not yet modeled')}</b></div>
 <div className="iv-fact"><span>Sectors</span><b>{facts.sectors.length?facts.sectors.map(s=><span key={s} className="iv-sector-chip">{s}</span>):record.sectors?.map(code=>idtSectorName(code.split('.')[0]) ?? 'Unassigned').join(' · ') || 'Not recorded'}</b></div>
 {facts.economic && <div className="iv-fact"><span>Economic impact</span><b>{facts.economic}</b></div>}
 {facts.watch.length>0 && <div className="iv-fact"><span>Also watching</span><b className="tone-amber">{facts.watch.map(w=>current?.nodes.find(n=>n.id===w.entityId)?.name ?? props.data.entities.find(e=>e.id===w.entityId)?.label ?? w.entityId).join(' · ')}</b></div>}
 <div className="iv-fact"><span>Also probed</span><b>{facts.probed.length?<Tone status="probed">{facts.probed.map(p=>p.label).join(' and ')}{facts.probedPeople!=null?` · ${facts.probedPeople.toLocaleString('en-US')} people`:''} · probing only, no confirmed compromise</Tone>:'None recorded'}</b></div>
 <div className="iv-fact"><span>Waiting on</span><b><Tone status={waiting.length?'waiting':'not_yet'}>{waiting.length?waiting.map(d=>`${d.record.title ?? d.record.label ?? 'Decision'} · ${d.windowLabel}`).join('; '):'No waiting decisions'}</Tone> · <button className="command-link" onClick={()=>navigate('leadership')}>C6 →</button></b></div>
 </div><nav className="iv-summary-links" aria-label="Incident evidence"><button className="command-link" onClick={()=>navigate('cyber')}>How it got in: C3 →</button><button className="command-link" onClick={()=>navigate('consequence')}>Full consequences: C4 →</button></nav></section>
 {current?.analysis?<SectorCascadeView value={current} onSelect={focus=>navigate('consequence',focus)}/>:<section className="iv-panel iv-development"><h2>What it touches · by sector</h2><p>{error?`Infrastructure analysis unavailable: ${error}`:'No consequence model yet. Infrastructure view for this incident type is in development.'}</p><p>Reference inventory · Not yet modeled</p><button className="command-link analyst-link" onClick={()=>props.onOpenAnalyst('command',caseId)}>Open in Analyst ↗</button></section>}
 <nav className="iv-consequence-link"><button className="command-link" onClick={()=>navigate('consequence')}>Every asset, and why: C4 →</button></nav>
 <section className="iv-more" aria-label="More"><h2 className="iv-group-caption">More</h2><IncidentRecordedFootprints model={model}/></section>
 </>}
 </section>;
}

import { useEffect, useRef, useState } from 'react';
import IncidentDependencyMap from '../IncidentDependencyMap.tsx';
import StatusChip from '../StatusChip.tsx';
import { type ConsequenceProjection, hours } from '../consequencesModel.ts';
import { useConsequenceSelection } from '../consequenceSelection.ts';
import { formatTime } from '../displayTime.ts';
import { assetConsequenceModel } from './viewModel.ts';
import type { CommandView } from '../commandTypes.ts';
import './asset-consequence.css';
export default function AssetConsequenceView({value,onAnalyst}:{value:ConsequenceProjection;onAnalyst:(view:CommandView,entityId?:string|null)=>void}) {
 const [selection,write]=useConsequenceSelection();
 const [query,setQuery]=useState('');
 const cards=useRef(new Map<string,HTMLElement>());
 const model=assetConsequenceModel(value,{sector:selection.sector,query});
 useEffect(()=>{
  const id=selection.entityId;
  if(!id)return;
  const frame=requestAnimationFrame(()=>cards.current.get(id)?.scrollIntoView({block:'nearest'}));
  return()=>cancelAnimationFrame(frame);
 },[selection.entityId,value.incident?.id,query]);
 const select=(id:string|null)=>{const node=model.nodes.find(n=>n.id===id);write({incidentId:value.incident?.id ?? null,entityId:id,...(id && !model.visible.has(id) ? {sector:node?.sector?.toLowerCase() || 'all'} : {})});if(id && typeof requestAnimationFrame==='function')requestAnimationFrame(()=>cards.current.get(id)?.scrollIntoView({behavior:'smooth',block:'nearest'}));};
 return <div className="asset-consequence-view" aria-label="Asset consequences">
  <section className="ac-panel ac-drawing"><h2>What it touches · {value.source?.label || value.source?.name}</h2>
   <div className="ac-filters" role="group" aria-label="Infrastructure sectors">{['All',...model.sectors].map(s=><button key={s} aria-pressed={selection.sector===s.toLowerCase()} onClick={()=>write({incidentId:value.incident?.id ?? null,sector:s.toLowerCase(),entityId:null})}>{s}</button>)}</div>
   <IncidentDependencyMap key={value.incident?.id} nodes={model.nodes} edges={value.edges} sourceId={value.source?.id || model.nodes.find(n=>n.source)?.id || ''} visible={model.visible} entityIcons={value.entityIcons} watchRelationships={model.watches} attackedSystem={value.sourceSystems?.[0]} selectedId={selection.entityId} onSelect={select}/>
   <p className="ac-hint">Infrastructure at risk (modeled) · select an item to see why it matters</p>
  </section>
  <aside className="ac-panel ac-list"><header><h2>Infrastructure</h2><small>Modeled {formatTime(value.analysis?.computedAt || value.analysis?.createdAt,value.operationsTimeZone,'time not recorded')}</small></header>
   <p className="ac-hint">Select any item, here or on the drawing, to see why it matters.</p>
   <input type="search" aria-label="Find infrastructure" placeholder="Find infrastructure" value={query} onChange={e=>setQuery(e.target.value)}/>
   <div className="ac-scroll">{model.groups.map(group=>{const items=model.items.filter(n=>n.group===group);return items.length>0 && <section key={group}><h3>{group} · {items.length}</h3>{items.map(n=><details className={`ac-asset${selection.entityId===n.id?' selected':''}`} data-facility-id={n.id} key={n.id} open={selection.entityId===n.id} ref={el=>{if(el)cards.current.set(n.id,el);else cards.current.delete(n.id);}}>
    <summary onClick={e=>{e.preventDefault();select(selection.entityId===n.id?null:n.id);}}><b>{n.name}</b><span className={`tone-${n.state.tone}`}> · {n.state.label}</span><small>{n.sector}{n.score!=null?` · score ${n.score}`:''}{n.idt?.path ? ` · IDT ${n.idt.path}`:''}</small></summary>
    <div className="ac-why"><p>{n.why}</p>{n.watch?.map((w,i)=><p key={i} className="tone-amber">{w.reason} · not a dependency</p>)}<dl><dt>Reserve</dt><dd>{n.reserves.length?n.reserves.map(hours).join(' · '):'Not recorded'}</dd><dt>Dependency paths</dt><dd>{n.pathsText}</dd><dt>Sources</dt><dd>{n.sourceRefs.join(', ') || 'Not recorded'}</dd></dl>{n.recordedDetails.map((item,i)=><p key={i}>{item.label}{item.score!=null && ` · Score ${item.score}`}<StatusChip status={item.status}/>{item.idt && <small>IDT {item.idt}</small>}{item.tag && <small>{item.tag}</small>}</p>)}<button className="ac-analyst" onClick={()=>onAnalyst('entity-profile',n.id)}>Inspect current record in Analyst ↗</button></div>
   </details>)}</section>;})}{!model.items.length && <p>No infrastructure matches this search.</p>}
    {!!model.recordedContext.length && <section aria-label="Recorded sector context"><h3>Recorded context</h3>{model.recordedContext.map((s,i)=><div key={i}><b>{s.sector}{s.idt && ` · IDT ${s.idt}`}</b>{s.items.map((item,j)=><p key={j}>{item.label}{item.score!=null && ` · Score ${item.score}`}<StatusChip status={item.status}/>{item.idt && <small>IDT {item.idt}</small>}{item.tag && <small>{item.tag}</small>}</p>)}{s.vessels.map((v,j)=><p key={j}>{v.name}{v.role && ` · ${v.role}`}<StatusChip status={v.status}/></p>)}</div>)}</section>}</div>
    <footer><button className="ac-analyst" onClick={()=>onAnalyst('command',selection.entityId)}>Alerts in Analyst ↗</button></footer>
  </aside>
 </div>;
}

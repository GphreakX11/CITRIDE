import { useRef, useState } from 'react';
import IncidentDependencyMap from '../IncidentDependencyMap.tsx';
import { type ConsequenceProjection, hours } from '../consequencesModel.ts';
import { useConsequenceSelection } from '../consequenceSelection.ts';
import { assetConsequenceModel } from './viewModel.ts';
import type { CommandView } from '../commandTypes.ts';
import './asset-consequence.css';
export default function AssetConsequenceView({value,onAnalyst}:{value:ConsequenceProjection;onAnalyst:(view:CommandView,entityId?:string|null)=>void}) {
 const [selection,write]=useConsequenceSelection();
 const [query,setQuery]=useState('');
 const cards=useRef(new Map<string,HTMLElement>());
 const model=assetConsequenceModel(value,{sector:selection.sector,query});
 const select=(id:string|null)=>{const node=model.nodes.find(n=>n.id===id);write({incidentId:value.incident?.id ?? null,entityId:id,...(id && !model.visible.has(id) ? {sector:node?.sector?.toLowerCase() || 'all'} : {})});if(id && typeof requestAnimationFrame==='function')requestAnimationFrame(()=>cards.current.get(id)?.scrollIntoView({behavior:'smooth',block:'nearest'}));};
 return <div className="asset-consequence-view" aria-label="Asset consequences">
  <section className="ac-panel ac-drawing"><h2>What it touches · {value.source?.label || value.source?.name}</h2>
   <div className="ac-filters" role="group" aria-label="Infrastructure sectors">{['All',...model.sectors].map(s=><button key={s} aria-pressed={selection.sector===s.toLowerCase()} onClick={()=>write({incidentId:value.incident?.id ?? null,sector:s.toLowerCase(),entityId:null})}>{s}</button>)}</div>
   <IncidentDependencyMap nodes={model.nodes} edges={value.edges} sourceId={value.source?.id || model.nodes.find(n=>n.source)?.id || ''} visible={model.visible} entityIcons={value.entityIcons} watchRelationships={model.watches} attackedSystem={value.sourceSystems?.[0]} selectedId={selection.entityId} onSelect={select}/>
   <p className="ac-hint">Infrastructure at risk (modeled) · select an item to see why it matters</p>
  </section>
  <aside className="ac-panel ac-list"><header><h2>Infrastructure</h2><small>Modeled {value.analysis?.createdAt ? new Date(value.analysis.createdAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:value.operationsTimeZone || 'UTC'}) : 'time not recorded'}</small></header>
   <p className="ac-hint">Select any item, here or on the drawing, to see why it matters.</p>
   <input type="search" aria-label="Find infrastructure" placeholder="Find infrastructure" value={query} onChange={e=>setQuery(e.target.value)}/>
   <div className="ac-scroll">{model.groups.map(group=>{const items=model.items.filter(n=>n.group===group);return items.length>0 && <section key={group}><h3>{group} · {items.length}</h3>{items.map(n=><details className={`ac-asset${selection.entityId===n.id?' selected':''}`} data-facility-id={n.id} key={n.id} open={selection.entityId===n.id} ref={el=>{if(el)cards.current.set(n.id,el);else cards.current.delete(n.id);}}>
    <summary onClick={e=>{e.preventDefault();select(selection.entityId===n.id?null:n.id);}}><b>{n.name}</b><span className={`tone-${n.state.tone}`}> · {n.state.label}</span><small>{n.sector}{n.score!=null?` · score ${n.score}`:''}{n.idt?.path ? ` · IDT ${n.idt.path}`:''}</small></summary>
    <div className="ac-why"><p>{n.why}</p>{n.watch?.map((w,i)=><p key={i} className="tone-amber">{w.reason} · not a dependency</p>)}<dl><dt>Reserve</dt><dd>{n.reserves.length?n.reserves.map(hours).join(' · '):'Not recorded'}</dd><dt>Dependency paths</dt><dd>{n.pathsText}</dd><dt>Sources</dt><dd>{n.sourceRefs.join(', ') || 'Not recorded'}</dd></dl><button className="ac-analyst" onClick={()=>onAnalyst('entity-profile',n.id)}>Inspect current record in Analyst ↗</button></div>
   </details>)}</section>;})}{!model.items.length && <p>No infrastructure matches this search.</p>}</div>
   <footer><button className="ac-analyst" onClick={()=>onAnalyst(value.incident?.caseId?'case-file':'command',selection.entityId)}>{value.incident?.caseId?'Case file':'Alerts'} in Analyst ↗</button></footer>
  </aside>
 </div>;
}

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ConsequenceNode, ConsequenceProjection } from './consequencesModel.ts';
import { consequenceNodeState } from './consequencesModel.ts';
import { iconFor } from './incidentPresentation.ts';
import { InfrastructureIcon } from './InfrastructureIcon.tsx';
import { dependencyLayout, dependencyTopologyKey, filteredNodeOpacity } from './incidentDependencyLayout.ts';
import './incident-dependency-map.css';
interface Props {
 nodes: (ConsequenceNode & { schematic?: {x:number;y:number} })[];
 edges: ConsequenceProjection['edges'];
 sourceId: string;
 visible: ReadonlySet<string>;
 entityIcons?: Record<string,string>;
 /** Recorded attacked asset, not simply the facility hosting the incident. */
 attackedSystem?: { type: string; label?: string; name?: string } | null;
 watchRelationships?: readonly { entityId: string; reason: string; inCascade?: boolean }[];
 selectedId: string | null;
 onSelect: (id: string) => void;
}
/** Nongeographic view of server-computed dependencies. Watch links are not causal. */
export default function IncidentDependencyMap({nodes,edges,sourceId,visible,entityIcons,attackedSystem,watchRelationships,selectedId,onSelect}:Props) {
 const marker = useId().replace(/:/g,'');
 const topology = dependencyTopologyKey(nodes,edges,sourceId);
 const layout = useMemo(()=>dependencyLayout(nodes,edges,sourceId),[topology]);
 const positions = useMemo(()=>new Map(layout.nodes.map(n=>[n.id,n])),[layout]);
 const fitWidth = Math.max(layout.width,layout.height/.65)*1.06;
 const fit = () => ({x:layout.width/2,y:layout.height/2,width:fitWidth});
 const initial = () => ({x:positions.get(sourceId)?.x ?? layout.width/2,y:positions.get(sourceId)?.y ?? layout.height/2,width:Math.min(fitWidth,1200)});
 const [view,setView] = useState(initial);
 const svg = useRef<SVGSVGElement>(null);
 const drag = useRef<{x:number;y:number;cx:number;cy:number;moved:boolean}|null>(null);
 useEffect(()=>setView(initial()),[layout]);
 useEffect(()=>{const p=selectedId && positions.get(selectedId); if(p) setView(v=>({...v,x:p.x,y:p.y}));},[selectedId,positions]);
 const height = view.width * .65;
 const zoom=(factor:number)=>setView(v=>({...v,width:Math.max(420,Math.min(Math.max(fitWidth,1200)*1.5,v.width*factor))}));
 const pan=(x:number,y:number)=>setView(v=>({...v,x:v.x+x*v.width*.18,y:v.y+y*v.width*.18}));
 const point=(id:string)=>positions.get(id);
 const watchLinks = watchRelationships ?? nodes.filter(n=>n.status==='on_watch').map(n=>({entityId:n.id,reason:'Watch relationship (reason not recorded)'}));
 const isAttackedIT = attackedSystem?.type === 'PhysicalITAsset';
 const showLabel = (edge: ConsequenceProjection['edges'][number]) => {
   const a=point(edge.from), b=point(edge.to);
   if(!a || !b || !edge.label.trim()) return false;
   const previous=edges.filter(p=>p.to===edge.from && p.from!==edge.to && p.label.trim().toLowerCase()===edge.label.trim().toLowerCase());
   return !previous.some(p=>{const start=point(p.from);return start && Math.hypot(b.x-a.x,b.y-a.y)<=Math.hypot(a.x-start.x,a.y-start.y)*1.5;});
 };
 return <div className="idm">
  <div className="idm-toolbar" role="group" aria-label="Dependency map controls">
   <button aria-label="Zoom in" onClick={()=>zoom(.8)}>+</button><button aria-label="Zoom out" onClick={()=>zoom(1.25)}>−</button>
   <button onClick={()=>setView(initial())}>Reset view</button>
   <button onClick={()=>setView(fit())}>Fit all</button>
   <button aria-label="Pan left" onClick={()=>pan(-1,0)}>←</button><button aria-label="Pan up" onClick={()=>pan(0,-1)}>↑</button><button aria-label="Pan down" onClick={()=>pan(0,1)}>↓</button><button aria-label="Pan right" onClick={()=>pan(1,0)}>→</button>
   <span>Schematic · upstream → source → downstream</span>
  </div>
  <div className="idm-viewport">
   <svg ref={svg} className="idm-canvas" viewBox={`${view.x-view.width/2} ${view.y-height/2} ${view.width} ${height}`} aria-label="Incident infrastructure dependencies" tabIndex={0}
    onKeyDown={e=>{if(e.target!==e.currentTarget)return; const moves:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}; if(moves[e.key]){e.preventDefault();pan(...moves[e.key]);} if(e.key==='+' || e.key==='=')zoom(.8);if(e.key==='-')zoom(1.25);if(e.key==='Home')setView(initial());}}
    onPointerDown={e=>{if((e.target as Element).closest('[data-map-node]'))return; e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,cx:view.x,cy:view.y,moved:false};}}
    onPointerMove={e=>{const d=drag.current;if(!d)return; const scale=view.width/(svg.current?.getBoundingClientRect().width||1);d.moved=true;setView(v=>({...v,x:d.cx-(e.clientX-d.x)*scale,y:d.cy-(e.clientY-d.y)*scale}));}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>
    {edges.map(edge=>{const a=point(edge.from),b=point(edge.to);if(!a||!b)return null;const watched=nodes.find(n=>n.id===edge.to)?.status==='on_watch';if(watched)return null;const right=b.x>=a.x;const ax=a.x+(right?122:-122),bx=b.x+(right?-122:122); const mid=(ax+bx)/2;return <g key={edge.id} className="idm-edge" opacity={visible.has(edge.from)&&visible.has(edge.to)?1:.18}><path d={`M${ax},${a.y} C${mid},${a.y} ${mid},${b.y} ${bx},${b.y}`} markerEnd={`url(#${marker})`}/><text x={mid} y={(a.y+b.y)/2-68} textAnchor="middle">{showLabel(edge)?edge.label:''}</text></g>;})}
    {watchLinks.map((watch,index)=>{const a=point(sourceId),b=point(watch.entityId);return a&&b?<g key={`watch-${watch.entityId}-${index}`} className="idm-watch-edge" opacity={visible.has(watch.entityId)?1:.18}><path d={`M${a.x},${a.y+55} Q${(a.x+b.x)/2+60},${Math.max(a.y,b.y)+100} ${b.x},${b.y+55}`}/><title>{`${watch.reason} · watch relationship, not a service dependency`}</title></g>:null;})}
    {nodes.map(node=>{const p=point(node.id);if(!p)return null;const state=consequenceNodeState(node);const opacity=filteredNodeOpacity(node.id,visible,sourceId);return <g key={node.id} data-map-node={node.id} data-line={state.line} data-selected={node.id===selectedId} className={`idm-node tone-${state.tone}${opacity<1?' idm-dimmed':''}`} transform={`translate(${p.x} ${p.y})`}>
     <foreignObject x="-130" y="-63" width="260" height="126"><button style={{margin:8}} className="idm-node-button" aria-label={`${node.name} · ${state.label}`} aria-pressed={node.id===selectedId} onClick={()=>onSelect(node.id)}>
      <InfrastructureIcon icon={iconFor(node, entityIcons)} size={24}/><strong>{node.name}</strong><span>{state.label}{node.score!=null?` · score ${node.score}`:''}{node.id===sourceId && isAttackedIT && <small className="idm-server-badge" title={attackedSystem?.label ?? attackedSystem?.name ?? 'Recorded attacked IT system'}><InfrastructureIcon icon="Server" size={12}/> Server</small>}</span>
     </button></foreignObject><title>{`${node.name} · ${state.label}`}</title>
    </g>;})}
   </svg>
   <svg className="idm-minimap" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Dependency overview" onClick={e=>{const box=e.currentTarget.getBoundingClientRect();setView(v=>({...v,x:(e.clientX-box.left)/box.width*layout.width,y:(e.clientY-box.top)/box.height*layout.height}));}}>
    {layout.nodes.map(p=><circle key={p.id} cx={p.x} cy={p.y} r={p.id===sourceId?20:12} fill={p.id===selectedId?'var(--blue-text)':'currentColor'}/>)}
    <rect x={view.x-view.width/2} y={view.y-height/2} width={view.width} height={height} fill="none" stroke="var(--blue-text)" strokeWidth="9"/>
   </svg>
  </div>
  <p className="idm-legend">Solid arrows: service dependency · dashed amber: recorded watch relationship (for example same campaign or login pattern), not a causal link. Hover a dashed link for its recorded reason. Drag to pan; use controls or arrow keys. Dimmed items are outside the sector filter.</p>
 </div>;
}

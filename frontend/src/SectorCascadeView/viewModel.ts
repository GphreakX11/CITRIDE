import { type ConsequenceProjection, windowTone, consequenceNodeState } from '../consequencesModel.ts';
import { assetConsequenceModel } from '../AssetConsequenceView/viewModel.ts';
/** Geometry positions records; it never supplies causal semantics. */
export function sectorCascadeModel(value:ConsequenceProjection) {
 const {nodes,watches}=assetConsequenceModel(value);
 const authored=[...new Map((value.sectorViews ?? []).flatMap(r=>r.sectors).map(s=>[s.sector,s])).values()];
 // Optional display metadata is not an exhaustive catalog of recorded sectors.
 const views: typeof authored=authored.length ? [...authored,...value.sectors.filter(s=>!authored.some(a=>a.sector===s.label)).map(s=>({sector:s.label,items:s.nodes.map(entityId=>({entityId,label:nodes.find(n=>n.id===entityId)?.name || entityId}))}))] : [];
 const hasSectorMap=views.length>0;
 const rows=Math.max(1,Math.ceil(views.length/2));
 const sectors=views.map((s,i)=>({...s,x:i%2?74:26,y:10+(Math.floor(i/2)+.5)*80/rows,window:value.sectors.find(r=>r.label===s.sector)?.windowHours,score:value.consequenceScores?.flatMap(r=>r.sectors).find(r=>r.sector===s.sector)?.score ?? s.score}));
 const watchGroups=[...new Set(watches.map(w=>nodes.find(n=>n.id===w.entityId)?.sector || ''))].flatMap(sector=>{
  const items=watches.filter(w=>(nodes.find(n=>n.id===w.entityId)?.sector || '')===sector);
  return items.length>5 ? [{id:`watch-${sector}`,sector,items}] : items.map(w=>({id:w.entityId,sector,items:[w]}));
 });
 const rowHeights=Array.from({length:rows},(_,row)=>Math.max(260,...sectors.slice(row*2,row*2+2).map(s=>watchGroups.filter(w=>w.sector===s.sector).length*250)));
 const contentHeight=rowHeights.reduce((sum,h)=>sum+h,0),height=Math.max(600,contentHeight);let top=(height-contentHeight)/2;
 rowHeights.forEach((rowHeight,row)=>{for(const sector of sectors.slice(row*2,row*2+2))sector.y=(top+rowHeight/2)*100/height;top+=rowHeight;});
 const satellites=watchGroups.map(w=>{const parent=sectors.find(s=>s.sector===w.sector) ?? sectors.find(s=>s.items.some(i=>w.items.some(w=>w.entityId===i.entityId)));const siblings=watchGroups.filter(g=>g.sector===w.sector);return {...w,parent,x:parent?(parent.x<50?8:92):50,y:parent?parent.y+(siblings.indexOf(w)-(siblings.length-1)/2)*25000/height:8};});
 const sectorLinks=(value.sectorLinks ?? []).filter(l=>value.sectors.some(s=>s.label===l.to) && (l.fromKind==='source' ? l.from===value.source?.id : value.sectors.some(s=>s.label===l.from))).map(l=>({...l,tone:windowTone(value.sectors.find(s=>s.label===l.to)?.windowHours ?? l.windowHours)}));
 const groups=[...nodes.filter(n=>n.source || n.upstream).map(n=>({id:n.id,name:n.name,node:n,ids:[n.id],kind:'entity'})),...value.sectors.flatMap(s=>{const members=nodes.filter(n=>s.nodes.includes(n.id) && !n.source && !n.upstream);if(!members.length)return [];return [{id:`sector-${s.label}`,name:s.label,node:members.find(n=>n.windowHours) || members[0],ids:members.map(n=>n.id),kind:'sector'}];})];
 for(const node of nodes)if(!groups.some(g=>g.ids.includes(node.id)))groups.push({id:node.id,name:node.name,node,ids:[node.id],kind:'entity'});
 const positions=groups.map((g,i)=>({...g,state:consequenceNodeState(g.node),x:g.node.source?35:g.node.upstream?13:76,y:g.node.source?50:g.node.upstream?16+groups.filter((n,j)=>j<i && n.node.upstream).length*68/Math.max(1,groups.filter(n=>n.node.upstream).length-1):12+groups.filter((n,j)=>j<i && !n.node.source && !n.node.upstream).length*76/Math.max(1,groups.filter(n=>!n.node.source && !n.node.upstream).length-1)}));
 const seen=new Set<string>();
 const links=value.edges.flatMap(e=>{const a=positions.find(g=>g.ids.includes(e.from)),b=positions.find(g=>g.ids.includes(e.to));const key=JSON.stringify([a?.id,b?.id,e.label]);if(!a || !b || a===b || seen.has(key))return [];seen.add(key);return [{e,a,b}];});
 const graphHeight=Math.max(600,groups.filter(g=>g.node.upstream).length*190,groups.filter(g=>!g.node.source && !g.node.upstream).length*170);
 return {hasSectorMap,sectors,sectorLinks,satellites,watchGroups,height,positions,links,graphHeight,nodes};
}

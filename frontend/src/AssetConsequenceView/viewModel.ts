import { consequenceNodeState, hours, type ConsequenceNode, type ConsequenceProjection, type C4Watch } from '../consequencesModel.ts';
import { pathToSource, sectorOf } from '../incidentPresentation.ts';
export function assetConsequenceModel(value: ConsequenceProjection, selection: {sector?: string; query?: string} = {}, extraWatch: readonly C4Watch[] = []) {
  const sector = selection.sector?.toLowerCase() || 'all';
  const query = selection.query?.trim().toLowerCase() || '';
  const watches = [...new Map([...(value.watchAssets ?? []),...extraWatch].map(w=>[w.entityId,w])).values()];
  const nodes: ConsequenceNode[] = value.nodes.map(node=>({...node,name:node.label || node.name || node.id,watch:watches.filter(w=>w.entityId===node.id)}));
  for(const watch of watches) if(!nodes.some(n=>n.id===watch.entityId)) nodes.push({id:watch.entityId,name:watch.entity?.label || watch.entity?.name || watch.entityId,type:watch.entity?.type || '',icon:watch.entity?.icon,sector:sectorOf(watch.entity) || '',status:'on_watch',windowHours:null,impactCount:0,paths:[],reserves:[],reserveLabel:'Reserve not recorded',sourceRefs:[],watch:[watch]});
  const sectors = [...new Set(nodes.map(n=>sectorOf(n)).filter((s):s is string=>!!s))];
  const visible = new Set<string>();
  for(const node of nodes) if(sector==='all' || sectorOf(node)?.toLowerCase()===sector) {visible.add(node.id);for(const id of pathToSource(node.id,value))visible.add(id);}
  for(const node of nodes) if(node.source || node.upstream)visible.add(node.id);
  const items = nodes.map(node=>{
    const incoming=value.edges.filter(e=>e.to===node.id);
    const services=[...new Set(incoming.map(e=>e.label))].join(', ');
    const supplied=(node as ConsequenceNode & {whyItMatters?:string}).whyItMatters;
    const state=consequenceNodeState(node);
    const why=supplied || (node.source ? `${node.name} is the incident source.` : node.windowHours ? `${node.name} depends on ${services || 'the recorded infrastructure chain'}; modeled loss of function in ${hours(node.windowHours)}. Service loss is conditional on recorded reserves.` : node.upstream ? `${node.name} supplies the recorded upstream chain; ${state.label}.` : node.notAffected ? `${node.name}: not affected by this scenario.` : node.watch?.length ? `${node.name} is on watch, not a modeled service loss. ${node.watch.map(w=>w.reason).join(' · ')}` : node.inArea && !node.connected ? `${node.name} is in the recorded area, with no recorded dependency.` : `${node.name}: ${state.label}.`);
    const group=node.windowHours && !node.source ? 'At risk' : node.source || node.upstream ? 'Supply chain' : node.watch?.length ? 'On watch' : node.notAffected || node.inArea ? 'Not affected' : 'No status recorded';
    const paths=node.paths.map(p=>p.map(id=>value.edges.find(e=>e.id===id)?.label || id).join(' → '));
    const recordedDetails=(value.sectorViews ?? []).flatMap(r=>r.sectors.flatMap(s=>s.items.filter(i=>i.entityId===node.id).map(i=>({...i,sector:s.sector}))));
    return {...node,state,why,group,recordedDetails,pathsText:paths.join('; ') || 'No modeled path recorded'};
  }).filter(n=>(sector==='all' || n.source || n.upstream || sectorOf(n)?.toLowerCase()===sector) && (!query || `${n.name} ${n.id} ${n.sector} ${n.idt?.path || ''} ${n.why}`.toLowerCase().includes(query))).sort((a,b)=>(a.windowHours?.[0] ?? Infinity)-(b.windowHours?.[0] ?? Infinity) || a.name.localeCompare(b.name));
  const recordedContext=(value.sectorViews ?? []).flatMap(r=>r.sectors).filter(s=>sector==='all'||s.sector.toLowerCase()===sector).map(s=>({sector:s.sector,idt:s.idt,items:s.items.filter(i=>!i.entityId||!nodes.some(n=>n.id===i.entityId)).filter(i=>!query||`${i.label} ${i.tag ?? ''} ${s.sector}`.toLowerCase().includes(query)).map(i=>({...i})),vessels:(s.vessels ?? []).filter(v=>!query||`${v.name} ${v.role ?? ''} ${s.sector}`.toLowerCase().includes(query)).map(v=>({...v}))})).filter(s=>s.items.length||s.vessels.length);
  return {nodes,sectors,visible,items,watches,recordedContext,groups:['At risk','Supply chain','Not affected','On watch','No status recorded']};
}

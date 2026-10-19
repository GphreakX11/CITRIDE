import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidElement } from 'react';
import { transformWithOxc } from 'vite';
const moduleData=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const hooksUrl=moduleData(`let values=[],cursor=0;export const callbacks=[];export function clear(){values=[];cursor=0}export function reset(){cursor=0;callbacks.length=0}export function useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],v=>values[i]=typeof v==='function'?v(values[i]):v]}export function useRef(initial){const i=cursor++;return values[i]??(values[i]={current:initial})}export function useEffect(){}export function useCallback(fn){callbacks.push(fn);return fn}`);
const apiUrl=moduleData(`let handler;export function plan(fn){handler=fn}export class ApiError extends Error{}export async function api(url,body){return handler(url,body)}`);
const hooks=await import(hooksUrl),transport=await import(apiUrl);
const source=new URL('../src/CommandWorkspace.tsx',import.meta.url);
let code=(await transformWithOxc(readFileSync(source,'utf8'),source.pathname,{jsx:{runtime:'automatic'}})).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm,'');
code=code.replace(/from\s+["']([^"']+)["']/g,(_,spec)=>{
 let target;
 if(spec==='react')target=hooksUrl;
 else if(spec==='./api')target=apiUrl;
 else if(spec.startsWith('.')&&/[A-Z]/.test(spec[2])){const name=spec.slice(2).replace(/\.tsx$/,'');target=moduleData(`function ${name}(){return null};export default ${name};export {${name} as ConfirmDialog,${name} as LateTasks};`);}
 else target=spec.startsWith('.')?new URL(spec.endsWith('.ts')?spec:spec+'.ts',source).href:import.meta.resolve(spec);
 return `from ${JSON.stringify(target)}`;
});
const Workspace=(await import(moduleData(code))).default;
const data=JSON.parse(readFileSync(new URL('../../data/scenario.json',import.meta.url)));
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):isValidElement(x)?[x,...nodes(x.props.children)]:[];
const text=x=>Array.isArray(x)?x.map(text).join(''):isValidElement(x)?text(x.props.children):typeof x==='string'?x:'';
for(const {mode,view} of [...['cyber','uctf','leadership','federation'].map(view=>({mode:'command',view})),{mode:'analyst',view:'command'}])test(`${mode} ${view} workspace renders URL record context instead of unrelated saved case`,async()=>{
 hooks.clear();let current=new URL('https://example.test/?incidentId=focused-record');
 globalThis.window={get location(){return current;},history:{replaceState(_a,_b,next){current=new URL(next,current);}}};
 try{
 const saved={id:'saved',title:'Unrelated saved case',priority:'high',status:'open',eventId:data.events[0].id,contextSnapshot:{provider:null},decisions:[],tasks:[],activity:[],notes:[]};
 transport.plan(url=>url==='/v1/command/incidents'?{incidents:[saved]}:url==='/v1/command/records'?{statewideIncidents:[{id:'focused-record',title:'Focused record title',location:{label:'Recorded location'},status:'active'}],now:'2026-10-13T10:00:00Z'}:{});
 const p={data,mode,view,selectedId:saved.id,selectedEntityId:null,mapState:{},onSelect(id){p.selectedId=id;},onCasesLoaded(){},onWorkflowLockChange(){},onSelectEntity(){},onMapStateChange(){},onNavigate(){},onOpenTool(){},onOpenAnalyst(){},onEditDependency(){},onAccessFailure(){}};
 const render=()=>{hooks.reset();return Workspace(p);};render();await hooks.callbacks[0]();
 const tree=render(),bar=nodes(tree).find(n=>n.props['aria-label']==='Selected incident context');
 assert.ok(bar);assert.match(text(bar),/Focused record title/);assert.match(text(bar),/Recorded location/);assert.doesNotMatch(text(bar),/No incident selected/);
 const chooser=nodes(bar).find(n=>n.type==='select');assert.ok(chooser);
 chooser.props.onChange({target:{value:saved.id}});assert.equal(current.searchParams.has('incidentId'),false);assert.equal(p.selectedId,saved.id);
 }finally{delete globalThis.window;}
});

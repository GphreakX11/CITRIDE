import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {isValidElement} from "react";
import {transformWithOxc} from "vite";
const mod=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const hooksUrl=mod(`let values=[],cursor=0;export const callbacks=[],effects=[];export function clear(){values=[];reset()}export function reset(){cursor=0;callbacks.length=0;effects.length=0}export function useState(x){const i=cursor++;if(!(i in values))values[i]=typeof x==='function'?x():x;return [values[i],x=>values[i]=typeof x==='function'?x(values[i]):x]}export function useRef(x){const i=cursor++;return values[i]??(values[i]={current:x})}export function useCallback(fn){callbacks.push(fn);return fn}export function useEffect(fn,deps){effects.push({fn,deps})}`);
const apiUrl=mod(`let handler;export const calls=[];export function plan(fn){handler=fn;calls.length=0}export class ApiError extends Error{constructor(m,status){super(m);this.status=status}}export async function api(path,body){calls.push({path,body});return handler(path,body)}`);
const hooks=await import(hooksUrl),transport=await import(apiUrl);
const source=new URL('../src/CommandWorkspace.tsx',import.meta.url);
let code=(await transformWithOxc(readFileSync(source,'utf8'),source.pathname,{jsx:{runtime:'automatic'}})).code;
code=code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm,'');
code=code.replace(/from\s+["']([^"']+)["']/g,(_m,s)=>{
 let target;
 if(s==='react')target=hooksUrl;
 else if(s==='./api')target=apiUrl;
 else if(['./CommandCasework','./CommandReadouts','./CommandCenterViews','./AnalystEntityProfile','./ScriptedAnalystViews','./NetworkEvidence','./ResetDemoControl','./OperationsClock','./IncidentContextBar'].includes(s))target=mod(`export default function ${s.slice(2)}(){return null};export function LateTasks(){return null};export function ConfirmDialog(){return null}`);
 else if(s.startsWith('.')){const u=new URL(/\.[cm]?[jt]s$/.test(s)?s:s+'.ts',source);assert.ok(existsSync(u));target=u.href;}
 else target=import.meta.resolve(s);
 return `from ${JSON.stringify(target)}`;
});
const component=await import(mod(code)),Workspace=component.default;
const bootstrap=JSON.parse(readFileSync(new URL('../../data/scenario.json',import.meta.url)));
const reference=JSON.parse(readFileSync(new URL('../../data/reference.json',import.meta.url)));
const records={statewideIncidents:[],responseTasks:[],assessments:[],assetStatuses:[],hunts:[],contacts:[],decisions:[],teams:[],storyNow:'2026-10-17T12:00:00Z'};
function setup(){
 hooks.clear();const received=[];
 const snapshot={bootstrap:structuredClone(bootstrap),runs:[],incidents:[],records:structuredClone(records),reference:structuredClone(reference),health:{status:'ok',baselineRevision:bootstrap.baselineRevision,demoMode:true,resetEnabled:false,storyNow:records.storyNow}};
 const props={data:bootstrap,initialSnapshot:snapshot,mode:'command',view:'command',selectedId:null,onSelect(){},onCasesLoaded:x=>received.push(x),onWorkflowLockChange(){},onOpenAnalyst(){},onEditDependency(){},selectedEntityId:null,onSelectEntity(){},mapState:{areaId:'all',query:'',direction:'all',focusOnly:false,structural:false},onMapStateChange(){},onNavigate(){},onOpenTool(){},onAccessFailure(){}};
 return{props,snapshot,received,render(){hooks.reset();return Workspace(props);}};
}
function nodes(n){if(Array.isArray(n))return n.flatMap(nodes);if(!isValidElement(n))return[];return[n,...nodes(n.props.children)];}
const workspace=t=>nodes(t).find(n=>n.props['data-casework-loaded']!==undefined);
test('the first workspace paint uses the already loaded snapshot',()=>{
 const s=setup(),tree=s.render();assert.equal(workspace(tree).props['data-casework-loaded'],true);assert.equal(workspace(tree).props['aria-busy'],false);
});
test('startup hydration reports cases without starting a second request wave',()=>{
 const s=setup();transport.plan(()=>{throw new Error('unexpected duplicate startup request');});s.render();
 const effect=hooks.effects.find(e=>e.deps?.includes(s.snapshot));assert.ok(effect,'snapshot hydration effect must be wired');
 const cleanup=effect.fn();assert.deepEqual(s.received,[[]]);assert.equal(transport.calls.length,0);cleanup?.();
});
test('an explicit/background refresh reads one coherent fresh workspace snapshot',async()=>{
 const s=setup();transport.plan(path=>{assert.equal(path,'/v1/workspace');return s.snapshot;});s.render();await hooks.callbacks.at(-1)();
 assert.deepEqual(transport.calls.map(c=>c.path),['/v1/workspace']);assert.equal(workspace(s.render()).props['data-casework-loaded'],true);
});
test('a baseline revision change keeps the combined refresh transport',async()=>{
 const s=setup();transport.plan(path=>{assert.equal(path,'/v1/workspace');return s.snapshot;});s.render();
 s.props.data={...s.props.data,baselineRevision:s.props.data.baselineRevision+1};s.render();await hooks.callbacks.at(-1)();
 assert.deepEqual(transport.calls.map(c=>c.path),['/v1/workspace']);
});
test('background reads do not freeze navigation; initial loading, writes and uncertain outcomes still do',()=>{
 assert.equal(typeof component.workspaceNavigationLocked,'function');
 for(let mask=0;mask<16;mask++){
  const loaded=!!(mask&1),loading=!!(mask&2),busy=!!(mask&4),uncertain=!!(mask&8);
  assert.equal(component.workspaceNavigationLocked(loaded,loading,busy,uncertain),busy||uncertain||(!loaded&&loading));
 }
});
test('background refresh preserves the requested case and facility when navigating',async()=>{
 const s=setup(),selected=[],entities=[],navigated=[],locks=[];
 s.props.onSelect=id=>selected.push(id);s.props.onSelectEntity=id=>entities.push(id);s.props.onNavigate=v=>navigated.push(v);s.props.onWorkflowLockChange=x=>locks.push(x);
 let resolve;const gate=new Promise(r=>resolve=r);transport.plan(()=>gate);s.render();
 const pending=hooks.callbacks.at(-1)();const tree=s.render();
 const child=nodes(tree).find(n=>typeof n.props.onClearSelection==='function');assert.ok(child);
 hooks.effects.find(e=>e.deps?.length===4).fn();
 child.props.onSelect('target-case');child.props.onSelectEntity('target-facility');child.props.onNavigate('consequence');
 assert.deepEqual(selected,['target-case']);assert.deepEqual(entities,['target-facility']);assert.deepEqual(navigated,['consequence']);assert.equal(locks.at(-1),false);
 resolve(s.snapshot);await pending;
});
test('App startup requests the combined snapshot instead of serial bootstrap/case waves',()=>{
 const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
 assert.match(app,/api<WorkspaceSnapshot>\("\/v1\/workspace"\)/);assert.match(app,/initialSnapshot=\{workspaceSnapshot\}/);
});

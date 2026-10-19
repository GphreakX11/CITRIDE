import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from './json-module-transform.mjs';
const cache=new Map();
async function compile(url){
 if(cache.has(url.href))return cache.get(url.href);
 let code=(await transformWithOxc(readFileSync(url,'utf8'),url.pathname,{jsx:{runtime:'automatic'}})).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm,'');
 const imports=new Map();
 for(const m of code.matchAll(/from\s+["']([^"']+)["']/g)){
  let next=new URL(m[1],url);if(m[1].startsWith('.')&&!existsSync(next))next=new URL(`${m[1]}.ts`,url);
  imports.set(m[1],m[1].startsWith('.')?await compile(next):import.meta.resolve(m[1]));
 }
 code=code.replace(/from\s+["']([^"']+)["']/g,(_,s)=>`from ${JSON.stringify(imports.get(s))}`);
 const result=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;cache.set(url.href,result);return result;
}
const Component=(await import(await compile(new URL('../src/ScriptedCommandViews.tsx',import.meta.url)))).default;
const data=JSON.parse(readFileSync(new URL('../../data/scenario.json',import.meta.url)));
const reference=JSON.parse(readFileSync(new URL('../../data/reference.json',import.meta.url)));
const supplied=JSON.parse(readFileSync(new URL('../../data/scripted/watershed_beta.json',import.meta.url)));
const water={id:'saved-water',title:'Unrelated saved case',status:'open',priority:'high',createdAt:'2026-10-13T08:00:00Z',eventId:data.events[0].id,eventSnapshot:data.events[0],contextSnapshot:{scenarios:[],warnings:[],sourceRefs:[]},decisions:[],tasks:[],notes:[],activity:[]};
const target={id:'arbitrary-record',title:'Focused incident',summary:'Focused recorded narrative',status:'active',startedAt:'2026-10-13T09:00:00Z',linkedEventIds:['target-event']};
function props(view,selected=null){const records=structuredClone(supplied);return {data:{...data,events:[...data.events,{id:'target-event',label:'Focused cyber event',observation:'recorded_access',sourceRefs:[]}]},view,selected,incidents:selected?[selected]:[],records:{...records,statewideIncidents:[{id:'water-record',caseId:water.id,linkedEventIds:[water.eventId]},target],responseTasks:records.tasks,now:'2026-10-13T10:00:00Z',assetStatuses:[...records.assetStatuses,{id:'target-status',incidentId:target.id,entityId:'target-asset',label:'Focused status',status:'confirmed'}]},reference,onSelect(){},onOpenAnalyst(){},onNavigate(){}};}
function render(view,selected=null,edit=()=>{}){globalThis.window={location:{href:'https://example.test/?incidentId=arbitrary-record'}};try{const p=props(view,selected);edit(p);return renderToStaticMarkup(createElement(Component,p));}finally{delete globalThis.window;}}
for(const selected of [null,water]){
 test(`C3 record focus scopes events and statuses with ${selected?'unrelated case':'no case'}`,()=>{const html=render('cyber',selected);assert.match(html,/Focused cyber event/);assert.match(html,/Focused status/);assert.doesNotMatch(html,/Setpoint changed|Water quality drifts|more utilities use/);});
 for(const view of ['uctf','leadership','federation'])test(`${view} record focus never borrows saved water records (${!!selected})`,()=>{const html=render(view,selected);assert.match(html,/Not recorded/i);assert.doesNotMatch(html,/Select a saved case|Boil-water notice|Water-sector partners|Unrelated saved case/);});
}
test('C5 shows only the focused record team and staff',()=>{const html=render('uctf',water,p=>{p.records.teams.push({id:'target-team',incidentId:target.id,name:'Focused responders',people:{onSite:3,remote:0,traveling:0,standby:0}});});assert.match(html,/Focused responders/);assert.doesNotMatch(html,/Water Utility A|CIRU North/);assert.match(html,/>3<\/strong><span>Analysts deployed/);});
for (const view of ['cyber','uctf','leadership','federation']) test(`${view} missing URL record never falls back to saved water case`,()=>{
 globalThis.window={location:{href:'https://example.test/?incident=missing-record'}};
 try { const html=renderToStaticMarkup(createElement(Component,props(view,water))); assert.doesNotMatch(html,/Unrelated saved case|Setpoint changed|Water quality drifts|Water Utility A|CIRU North/); } finally {delete globalThis.window;}
});
test('C6 saved-case URL alias selects its visible record summary',()=>{
 globalThis.window={location:{href:'https://example.test/?incident=saved-water'}};
 try { const html=renderToStaticMarkup(createElement(Component,props('leadership',water))); assert.match(html,/<aside[^>]*id="brief-summary-water-record"[^>]*aria-label="Read-only summary"(?![^>]*hidden)/); } finally {delete globalThis.window;}
});
test('C4 footer always offers Alerts in Analyst even with a saved case',()=>{const source=readFileSync(new URL('../src/AssetConsequenceView/AssetConsequenceView.tsx',import.meta.url),'utf8');assert.match(source,/onAnalyst\('command',selection.entityId\)/);assert.match(source,/Alerts in Analyst ↗/);});

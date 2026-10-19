import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const cache=new Map();
async function compile(url){
 if(cache.has(url.href))return cache.get(url.href);
 let code=(await transformWithOxc(readFileSync(url,'utf8'),url.pathname,{jsx:{runtime:'automatic'}})).code;
 code=code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm,'');
 const imports=new Map();
 for(const m of code.matchAll(/from\s+["']([^"']+)["']/g))imports.set(m[1],m[1].startsWith('.')?await compile(new URL(m[1],url)):import.meta.resolve(m[1]));
 code=code.replace(/from\s+["']([^"']+)["']/g,(_,s)=>`from ${JSON.stringify(imports.get(s))}`);
 const result=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;cache.set(url.href,result);return result;
}
const {ConsequencesContent}=await import(await compile(new URL('../src/ConsequencesView.tsx',import.meta.url)));
const {default:SectorCascadeView}=await import(await compile(new URL('../src/SectorCascadeView/SectorCascadeView.tsx',import.meta.url)));
const model=await import(await compile(new URL('../src/consequencesModel.ts',import.meta.url)));
const fixture={now:'2026-10-18T12:00:00Z',operationsTimeZone:'America/Chicago',incident:{id:'REFERENCE-1',title:'Reference scenario',referenceOnly:true},incidents:[],analysis:{kind:'reference_preview',createdAt:'2026-10-18T12:00:00Z',computedAt:'2026-10-18T12:00:00Z',modelVersion:'interval-v1',request:{horizonHours:48},seed:{lossType:'terminal_unavailable'}},source:{id:'source',name:'Terminal',type:'PortFacility'},serviceAffected:{value:47,unit:'product tankers'},atRisk:0,nodes:[],edges:[],sectors:[],alternatives:[],thresholds:[],responseOwners:[],confidence:{level:'low',note:'Conditional planning model'}};
const render=value=>renderToStaticMarkup(createElement(ConsequencesContent,{value,now:Date.parse(fixture.now),onAnalyst(){},onPartners(){}}));
test('unsaved reference projection never masquerades as captured automatic history',()=>{
 const html=render(fixture);assert.match(html,/READ-ONLY REFERENCE PROJECTION/);assert.match(html,/not saved case analysis/);assert.doesNotMatch(html,/Run automatically by CITRIDE|ANALYSIS REVIEWED/);
 assert.match(html,/As reported in the supplied reference scenario/);assert.doesNotMatch(html,/People in the modeled service area/);
});
test('timeline uses actual request horizon, including non-water 48-hour scenarios',()=>{
 const html=render(fixture);assert.match(html,/<span>48 h<\/span>/);assert.match(html,/<span>16 h<\/span>/);assert.doesNotMatch(html,/<span>12 h<\/span>/);
 const water=render({...fixture,analysis:{...fixture.analysis,request:{horizonHours:12}}});assert.match(water,/<span>12 h<\/span>/);assert.doesNotMatch(water,/<span>48 h<\/span>/);
 const graph=renderToStaticMarkup(createElement(SectorCascadeView,{value:fixture}));
 const height=graph.match(/class="sc-graph" style="height:(\d+)px"/)[1];
 assert.ok(Number(height)>=600);assert.ok(graph.includes(`viewBox="0 0 1000 ${height}"`));
 assert.match(html,/aria-label="Asset consequences"/);
 assert.doesNotMatch(html,/class="sc-graph"/);
});
test('multi-day restoration and old records have readable elapsed units without altering timestamps',()=>{
 assert.equal(model.hours([48,120]),'2–5 days');assert.equal(model.hours([12,24]),'12–24 h');
 assert.equal(model.elapsedLabel('2026-10-16T12:00:00Z',Date.parse(fixture.now)),'2 days ago');
 assert.equal(model.elapsedLabel('2026-10-18T13:00:00Z',Date.parse(fixture.now)),'0 min ago');
});

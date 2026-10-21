import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
const cache = new Map();
async function load(url) {
 if (cache.has(url.href)) return cache.get(url.href);
 let code = (await transformWithOxc(readFileSync(url,'utf8'),url.pathname,{jsx:{runtime:'automatic'}})).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm,'');
 const imports = new Map();
 for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
  const spec = match[1]; const next = spec.startsWith('.') ? new URL(spec,url) : null;
  imports.set(spec,next ? (spec.endsWith('.tsx') ? await load(next) : next.href) : import.meta.resolve(spec));
 }
 code = code.replace(/from\s+["']([^"']+)["']/g,(_,s)=>`from ${JSON.stringify(imports.get(s))}`);
 const result = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;cache.set(url.href,result);return result;
}
const {default:View} = await import(await load(new URL('../src/IncidentView.tsx',import.meta.url)));
const data = JSON.parse(readFileSync(new URL('../../data/scenario.json',import.meta.url),'utf8'));
const supplied = JSON.parse(readFileSync(new URL('../../data/scripted/watershed_beta.json',import.meta.url),'utf8'));
const reference = JSON.parse(readFileSync(new URL('../../data/reference.json',import.meta.url),'utf8'));
function props(run = true) {
 const baseline = structuredClone(data);
 baseline.entities.find(e=>e.id==='dialysis-x').label='Captured renal facility';
 const saved={id:'test-c2-case',title:'Captured incident',status:'open',priority:'high',version:1,createdAt:'2026-10-13T08:00:00Z',updatedAt:'2026-10-13T08:20:00Z',eventId:data.events[0].id,eventSnapshot:data.events[0],contextSnapshot:{provider:data.entities.find(e=>e.id==='utility-a'),warnings:[],sourceRefs:[]},decisions:[],tasks:[],notes:[],activity:[],runSnapshot:run?{id:'test-c2-run',createdAt:'2026-10-13T08:10:00Z',modelVersion:data.modelVersion,baselineRevision:data.baselineRevision,baselineSnapshot:baseline,seed:baseline.scenarios.find(s=>s.id==='unsafe-water').seed,impacts:[{id:'c2-impact',entityId:'dialysis-x',functionId:'dialysis-treatment',windowHours:[2,4],state:'at_risk',paths:[['dep-a-x']],sourceRefs:[],assumptions:[],lossType:'unsafe_water'}],excluded:[],warnings:[]}:null};
 const records={...structuredClone(supplied),statewideIncidents:[{id:'test-c2-record',caseId:saved.id,title:'Recorded incident',severity:'high',status:'open',startedAt:saved.createdAt}],now:'2026-10-13T08:30:00Z'};
 return {data:structuredClone(data),incidents:[saved],selected:saved,records,reference,view:'cop',onSelect(){},onClearSelection(){},onNavigate(){},onOpenAnalyst(){}};
}
const html=p=>renderToStaticMarkup(createElement(View,p));
test('C2 actually renders the configured third incident rather than the unrelated selected case',()=>{
 const p=props();
 p.records.featuredIncidentId='OTHER-CUSTOMER-THIRD';
 p.records.statewideIncidents.push({id:'OTHER-CUSTOMER-THIRD',title:'Third district grid incident',summary:'Third district energy records',status:'open',severity:'low',sectors:['3'],nearEntityIds:['third-grid'],location:{label:'Other district'}});
 const out=html(p);
 assert.match(out,/Third district energy records/);
 assert.match(out,/Loading sector consequences/);
 assert.doesNotMatch(out,/No consequence model yet|in development/);
 assert.doesNotMatch(out.split('<section class="iv-more"')[0],/Captured renal facility/);
});
test('C2 explicit URL incident overrides the configured third incident',()=>{
 const p=props(); p.records.featuredIncidentId='third';
 p.records.statewideIncidents.push({id:'third',title:'Third incident',status:'open',severity:'low'});
 globalThis.window={location:{href:'https://local.invalid/?view=cop&incidentId=test-c2-record'}};
 try { assert.match(html(p),/Captured renal facility/); } finally { delete globalThis.window; }
});
test('C2 composes summary, sector destination and recorded footprints without the statewide register',()=>{
 const out=html(props());
 for(const text of ['Incident view','records as of','What it touches · by sector','Every asset, and why: C4','Where','People affected','Sectors','Also probed','Waiting on','Recorded service footprints']) assert.ok(out.includes(text),text);
 assert.ok(out.indexOf('iv-summary-band') < out.indexOf('iv-development'));
 assert.ok(out.indexOf('iv-development') < out.indexOf('iv-more'));
 assert.doesNotMatch(out,/All Statewide Incidents|All incidents|Recorded infrastructure footprints|data-state-boundary="texas"/);
 assert.match(out,/data-screen="cop"/);
});
test('captured facility names, functions and window survive changed live inventory',()=>{
 const p=props();p.data.entities.find(e=>e.id==='dialysis-x').label='LIVE CHANGED NAME';
 const out=html(p);assert.match(out,/Captured renal facility/);assert.doesNotMatch(out,/LIVE CHANGED NAME/);assert.match(out,/2–4 h/);
});
test('while analysis loads C2 preserves unknown facts rather than copying risk windows',()=>{
 const out=html(props(false));assert.match(out,/Not yet modeled/);assert.doesNotMatch(out,/2–4 h/);assert.match(out,/Loading sector consequences/);
});
test('without incidents C2 keeps the selector and explains its empty state',()=>{
 const p=props();p.incidents=[];p.selected=null;p.records.statewideIncidents=[];
 const out=html(p);assert.match(out,/No incidents recorded/);assert.doesNotMatch(out,/test-c2-run|Captured renal facility/);
});
test('initial facility rows are collapsed, not proof dumps or automatic Analyst routes',()=>{
 const out=html(props());assert.match(out,/aria-expanded="false"/);assert.doesNotMatch(out,/iv-facility-body/);assert.match(out,/Open in Analyst/);
});

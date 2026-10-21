// Explicit real-App browser journeys over exact captured local synthetic API responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const dist = process.env.READINESS_DIST;
const fixtures = process.env.READINESS_FIXTURES;
const evidence = process.env.READINESS_EVIDENCE;
const chromePath = process.env.READINESS_CHROME;
assert.ok(dist && fixtures && evidence && chromePath, 'Set explicit external READINESS_DIST/FIXTURES/EVIDENCE/CHROME');
const snapshots = await Promise.all([0,1,2,3].map(async phase => JSON.parse(await readFile(join(fixtures, `workspace-${phase}.json`), 'utf8'))));
const projectionBytes = await Promise.all([0,1,2,3].map(phase => readFile(join(fixtures, `projection-${phase}.json`))));
const clockSnapshot = JSON.parse(await readFile(join(fixtures, 'workspace-clock.json'), 'utf8'));
const caseId = snapshots[0].incidents.find(item => item.title === 'QA readiness isolated saved water case').id;
const incidentId = 'TX-26-0412';
const query = (view, mode='analyst') => `/?mode=${mode}&view=${view}&incidentId=${incidentId}&incident=${incidentId}&case=${caseId}&entity=dialysis-x&returnMode=command&returnView=cop&focus=1#readiness`;

async function browserJourney(label, run) {
  const out = join(evidence, label); await mkdir(out, {recursive:true});
  const state = {phase:0, clockOnly:false, hold:false, held:[], requests:[], errors:[]};
  const server = createServer(async (req,res) => {
    try {
      const url = new URL(req.url, 'http://local.invalid');
      const entry={method:req.method,path:url.pathname,query:url.search,phase:state.phase,socket:req.socket.remotePort,finished:false};state.requests.push(entry);res.on('finish',()=>{entry.finished=true;});
      if (req.method !== 'GET') {res.statusCode=405;res.end('No application writes in detached replay');return;}
      if (url.pathname === '/v1/workspace') { res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state.clockOnly ? clockSnapshot : snapshots[state.phase])); }
      else if (url.pathname === '/v1/telemetry') {res.setHeader('Content-Type','application/json');res.end(await readFile(join(fixtures,'telemetry.json')));}
      else if (url.pathname === '/v1/command/consequences') {
        const bytes=projectionBytes[state.phase]; const reply=()=>{res.setHeader('Content-Type','application/json');res.end(bytes);};
        if(state.hold)state.held.push(reply);else reply();
      } else if (url.pathname.startsWith('/assets/')) {
        const path=resolve(dist,'.'+url.pathname);assert.ok(!relative(resolve(dist),path).startsWith('..'));
        const ext=path.split('.').pop();res.setHeader('Content-Type',({js:'text/javascript',css:'text/css',woff:'font/woff',woff2:'font/woff2'})[ext]??'application/octet-stream');res.end(await readFile(path));
      } else if (url.pathname==='/') {res.setHeader('Content-Type','text/html');res.end(await readFile(join(dist,'index.html')));}
      else {res.statusCode=404;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({detail:'Fixture route not captured'}));}
    } catch(error){res.statusCode=500;res.end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const profile=await mkdtemp(join(out,'isolated-chrome-'));
  const chrome=spawn(chromePath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let ws;
  try {
    let port;for(let i=0;i<150;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await delay(100);}}
    assert.ok(port,'Isolated browser started');let page;
    for(let i=0;i<100;i++){page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');if(page)break;await delay(50);}
    assert.ok(page,'Isolated page ready');ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let sequence=0;const waiting=new Map();
    ws.onmessage=({data})=>{const message=JSON.parse(data);if(message.id){const call=waiting.get(message.id);waiting.delete(message.id);message.error?call.reject(message.error):call.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')state.errors.push(message.params.exceptionDetails);};
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    const until=async expression=>{for(let i=0;i<160;i++){if(await evaluate(expression))return;await delay(50);}assert.fail(`Timed out ${expression}; body=${await evaluate('document.body.innerText')}; exceptions=${JSON.stringify(state.errors)}`);};
    const screenshot=async name=>{const shot=await cdp('Page.captureScreenshot',{captureBeyondViewport:true});await writeFile(join(out,name+'.png'),Buffer.from(shot.data,'base64'));};
    const navigate=async path=>{await cdp('Page.navigate',{url:origin+path});};
    const key=async key=>{await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Enter'?13:32,text:key==='Enter'?'\r':' ',unmodifiedText:key==='Enter'?'\r':' '});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:key==='Enter'?13:32});};
    await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await run({state,out,origin,cdp,evaluate,until,screenshot,navigate,key});
    assert.deepEqual(state.errors,[]);
    assert.equal(state.requests.filter(item=>item.method!=='GET').length,0,'Read-only browser journey must not create or mutate a case');
  } finally {
    state.held.forEach(reply=>reply());state.held=[];
    await writeFile(join(out,'journey-results.json'),JSON.stringify({...state,held:undefined},null,2));
    ws?.close();chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
}

test('A6 inline Case File preserves selected case incident entity and source-return context',async()=>browserJourney('a6',async({state,out,evaluate,until,screenshot,navigate,cdp,key})=>{
  await navigate(query('uctf'));
  await until('[...document.querySelectorAll(".cc-muted button")].some(e=>e.innerText==="Case File")');
  await until('document.querySelector("[aria-label=\\"Refresh casework\\"]")?.disabled===false');
  await delay(200);
  const before=await evaluate('location.href');await screenshot('before-inline-case-file');
  await evaluate('[...document.querySelectorAll(".cc-muted button")].find(e=>e.innerText==="Case File").click()');await delay(150);
  const after=await evaluate('location.href');await screenshot('after-inline-case-file');
  await writeFile(join(out,'navigation.json'),JSON.stringify({before,after},null,2));
  const actual=new URL(after);
  assert.equal(actual.searchParams.get('view'),'case-file','A6 inline Case File must not be remapped back to Response Tasks');
  for(const [name,value] of Object.entries({mode:'analyst',case:caseId,incidentId,incident:incidentId,entity:'dialysis-x',returnMode:'command',returnView:'cop'}))assert.equal(actual.searchParams.get(name),value,name);
  assert.equal(actual.hash,'#readiness');
  await until('!!document.querySelector("[aria-label=\\"Case file sections\\"]")');
  assert.match(await evaluate('document.body.innerText'),/QA readiness isolated saved water case/);
  // Existing top-level tools and a direct URL remain real siblings, not URL adapters in the fix.
  await navigate(query('uctf'));await until('!!document.querySelector(".screen-case-tools")');
  await evaluate('document.querySelector(".screen-case-tools").open=true');
  await evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText==="Open full case file").click()');
  await until('new URL(location.href).searchParams.get("view")==="case-file"');
  await navigate(query('case-file'));await until('!!document.querySelector("[aria-label=\\"Case file sections\\"]")');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
  await navigate(query('uctf'));await until('[...document.querySelectorAll(".cc-muted button")].some(e=>e.innerText==="Case File")');
  await evaluate('[...document.querySelectorAll(".cc-muted button")].find(e=>e.innerText==="Case File").click()');
  await until('new URL(location.href).searchParams.get("view")==="case-file"');await screenshot('case-file-narrow');
}));

test('C2 same-incident in-place refresh follows changed accepted snapshot without clock storms or late-response regression',async()=>browserJourney('refresh',async({state,out,evaluate,until,screenshot,navigate})=>{
  const reads=path=>state.requests.filter(item=>item.path===path).length;
  await navigate(query('cop','command'));
  await until('!!document.querySelector(".idm-canvas [data-map-node]")');
  await evaluate('window.__readinessMount=document.querySelector(".incident-view");true');
  await delay(150);assert.equal(reads('/v1/command/consequences'),1);
  const initialReads=reads('/v1/workspace');state.clockOnly=true;
  await evaluate('window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("focus"))');
  await until('document.querySelector(".command-workspace")?.getAttribute("aria-busy")==="false"');await delay(150);
  assert.equal(reads('/v1/workspace'),initialReads+1,'Overlapping unchanged workspace refreshes remain coalesced');
  assert.equal(reads('/v1/command/consequences'),1,'Clock-only accepted snapshot must not trigger expensive projection refetch');
  state.clockOnly=false;state.phase=1;
  await screenshot('before-same-incident-refresh');
  await evaluate('window.dispatchEvent(new Event("focus"))');
  await until('document.querySelector(".iv-facts")?.innerText.includes("Fire Service F")');await delay(150);
  await screenshot('after-same-incident-refresh');
  assert.equal(reads('/v1/command/consequences'),2,'Changed authoritative workspace for the same incident must issue a fresh consequence request');
  await until('document.querySelector(".sector-cascade-view .sc-watch-edge title")?.textContent.includes("QA readiness isolated watch revision 1")');
  assert.equal(await evaluate('window.__readinessMount===document.querySelector(".incident-view")'),true,'Refresh must not remount/reload the incident screen');
  // A newer accepted workspace must not join an old same-path projection promise.
  state.phase=2;state.hold=true;
  await evaluate('window.dispatchEvent(new Event("focus"))');
  await until('document.querySelector(".iv-development")?.getAttribute("aria-busy")==="true"');
  assert.equal(state.held.length,1);
  state.phase=3;state.hold=false;
  await evaluate('window.dispatchEvent(new Event("focus"))');
  for(let i=0;i<60 && reads('/v1/command/consequences')<4;i++)await delay(50);

  assert.equal(reads('/v1/command/consequences'),4,'Changed snapshot scope must start independent request, not dedupe into held obsolete projection');
  await until('document.querySelector(".sector-cascade-view .sc-watch-edge title")?.textContent.includes("QA readiness isolated watch revision 3")');
  assert.equal(reads('/v1/command/consequences'),4,'Changed snapshot scope must start independent request, not dedupe into held obsolete projection');
  state.held.splice(0).forEach(reply=>reply());await delay(150);
  assert.match(await evaluate('document.querySelector(".sector-cascade-view .sc-watch-edge title").textContent'),/revision 3/);
  const settled=reads('/v1/command/consequences');
  await evaluate('window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("focus"))');await delay(250);
  assert.equal(reads('/v1/command/consequences'),settled,'Unchanged snapshot reread must not fetch again');
  assert.equal(await evaluate('window.__readinessMount===document.querySelector(".incident-view")'),true);
  await writeFile(join(out,'refresh-contract.json'),JSON.stringify({workspaceReads:reads('/v1/workspace'),projectionReads:settled,sameMount:await evaluate('window.__readinessMount===document.querySelector(".incident-view")'),diagramWatchTitle:await evaluate('document.querySelector(".sector-cascade-view .sc-watch-edge title").textContent')},null,2));
  await screenshot('latest-projection-survives-late-response');
}));

test('C2 reverse selected-asset filter exclusion clears URL and parent cursor while preserving retained upstream context',async()=>browserJourney('reverse-filter',async({state,out,evaluate,until,screenshot,navigate,cdp,key})=>{
  await navigate(query('cop','command'));await until('!!document.querySelector("[data-map-node=fire-f] button")');
  const clickNode=id=>evaluate(`document.querySelector('[data-map-node="${id}"] button').click()`);
  const filter=async label=>{await evaluate(`[...document.querySelectorAll('.iv-detail-filters button')].find(e=>e.innerText===${JSON.stringify(label)}).focus()`);await key('Enter');await delay(100);};
  const selection=()=>evaluate('({entity:new URL(location.href).searchParams.get("entity"),sector:new URL(location.href).searchParams.get("sector")??"all",selected:[...document.querySelectorAll("[data-map-node][data-selected=true]")].map(e=>e.getAttribute("data-map-node")),open:[...document.querySelectorAll("[data-infrastructure-id][open]")].map(e=>e.getAttribute("data-infrastructure-id"))})');
  await clickNode('fire-f');await until('document.querySelector("[data-infrastructure-id=fire-f]")?.open');
  await screenshot('selected-before-excluding-filter');
  await filter('Healthcare');await until('new URL(location.href).searchParams.get("sector")==="healthcare"');
  const after=await selection();await writeFile(join(out,'reverse-selection.json'),JSON.stringify({after},null,2));await screenshot('after-excluding-filter');
  assert.equal(after.entity,null,'Explicit filter that omits selected roster asset must clear URL entity');
  assert.deepEqual(after.selected,[]);assert.deepEqual(after.open,[]);
  // Parent selectedEntity must clear too, or normal App navigation resurrects the excluded asset.
  await evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText.includes("How it got in: C3")).click()');
  await until('new URL(location.href).searchParams.get("view")==="cyber"');
  assert.equal(await evaluate('new URL(location.href).searchParams.get("entity")'),null,'Parent cursor must not restore excluded entity on a sibling route');
  await evaluate('history.back()');await until('!!document.querySelector(".idm-canvas")');
  await clickNode('electric-e');await until('document.querySelector("[data-infrastructure-id=electric-e]")?.open');
  await filter('Emergency Services');
  assert.equal((await selection()).entity,'electric-e','Upstream remains legitimately in filtered roster');
  assert.ok((await selection()).open.includes('electric-e'));
  await filter('Healthcare');await clickNode('dialysis-x');await until('document.querySelector("[data-infrastructure-id=dialysis-x]")?.open');
  await filter('Healthcare');assert.equal((await selection()).entity,'dialysis-x');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
  await filter('Emergency Services');
  const narrow=await selection();assert.equal(narrow.entity,null);assert.deepEqual(narrow.selected,[]);assert.deepEqual(narrow.open,[]);
  // Previous direction still works: explicit graph choice outside filter broadens All and reveals detail.
  await clickNode('dialysis-x');await until('document.querySelector("[data-infrastructure-id=dialysis-x]")?.open');
  const preserved=await selection();assert.equal(preserved.sector,'all');assert.equal(preserved.entity,'dialysis-x');
  const geometry=await evaluate('(() => {const svg=document.querySelector(".idm-canvas").getBoundingClientRect();const card=document.querySelector("[data-infrastructure-id=dialysis-x] p").getBoundingClientRect();const scroll=document.querySelector(".iv-detail-scroll").getBoundingClientRect();return {width:svg.width,height:svg.height,detailVisible:card.top>=scroll.top&&card.bottom<=scroll.bottom};})()');
  assert.ok(geometry.width>200&&geometry.width<=390&&geometry.height>200&&geometry.detailVisible);
  await screenshot('narrow-prior-direction-preserved');
  await writeFile(join(out,'reverse-selection.json'),JSON.stringify({after,narrow,preserved,geometry},null,2));
}));

test('C3 and operational graph retain meaningful recorded visuals across in-place refresh route return and resize',async()=>browserJourney('visual-return',async({state,out,evaluate,until,screenshot,navigate,cdp})=>{
  await navigate(query('cop','command'));await until('!!document.querySelector(".idm-canvas")');
  state.phase=1;await evaluate('window.dispatchEvent(new Event("focus"))');
  await until('document.querySelector(".sector-cascade-view .sc-watch-edge title")?.textContent.includes("watch revision 1")');
  await evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText.includes("How it got in: C3")).click()');
  await until('!!document.querySelector(".sc-stage-card")');
  const attack=await evaluate('({cards:[...document.querySelectorAll(".sc-stage-card")].map(e=>({label:e.querySelector("h3").innerText,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),path:document.querySelector(".sc-attack-path").innerText})');
  assert.ok(attack.cards.length>=4&&attack.cards.every(c=>c.width>100&&c.height>50));assert.match(attack.path,/→/);await screenshot('c3-after-in-place-refresh');
  await evaluate('history.back()');await until('!!document.querySelector(".idm-canvas [data-map-node]")');
  assert.equal(await evaluate('new URL(location.href).searchParams.get("view")'),'cop');
  await evaluate('history.forward()');await until('!!document.querySelector(".sc-stage-card")');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await screenshot('c3-after-history-narrow');
  await navigate(query('overview','analyst'));await until('!!document.querySelector(".graph-canvas canvas")');
  const graphState=()=>evaluate('(() => {const e=document.querySelector(".graph-canvas");const cy=e._cyreg.cy;const r=e.getBoundingClientRect();const pixels=[...e.querySelectorAll("canvas")].reduce((n,c)=>{const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n;},0);return {width:r.width,height:r.height,nodes:cy.nodes().length,edges:cy.edges().length,pixels,selected:cy.nodes(".selected").map(n=>n.id())};})()');
  await delay(200);const graph=await graphState();assert.ok(graph.width>200&&graph.height>200&&graph.nodes>5&&graph.edges>5&&graph.pixels>500);
  await evaluate('document.querySelector(".graph-panel input[type=checkbox]").click()');await delay(250);
  const context=await graphState();assert.ok(context.nodes>graph.nodes&&context.edges>graph.edges&&context.pixels>500);
  const entity=snapshots[0].bootstrap.entities.some(e=>e.id==='poh-port')?'poh-port':'utility-a';
  await evaluate(`(() => {const e=document.getElementById('entity-picker');e.value=${JSON.stringify(entity)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`new URL(location.href).searchParams.get('entity')===${JSON.stringify(entity)}`);await delay(150);
  const selected=await graphState();assert.ok(selected.selected.includes(entity));assert.ok(selected.pixels>500);await screenshot('operational-graph-context-selected-narrow');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await delay(200);
  const desktop=await graphState();assert.ok(desktop.width>400&&desktop.pixels>500);await screenshot('operational-graph-context-selected-desktop');
  await writeFile(join(out,'visual-results.json'),JSON.stringify({attack,graph,context,selected,desktop},null,2));
}));

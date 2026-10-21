// Run explicitly with node --test; requires scratch-built fixture and an existing Chromium.
// C2_C3_BUNDLE_DIR, C2_C3_CHROME and C2_C3_EVIDENCE must point outside the checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const bundle = process.env.C2_C3_BUNDLE_DIR;
const evidence = process.env.C2_C3_EVIDENCE;
const chromePath = process.env.C2_C3_CHROME;
assert.ok(bundle && evidence && chromePath, 'Provide explicit external bundle/evidence and existing Chromium paths');
await mkdir(evidence, { recursive: true });
const results = [];

test('C2 delayed projection renders loading then meaningful selectable sectors; C3 keeps recorded stages', async () => {
  const profile = await mkdtemp(join(evidence, 'isolated-chrome-'));
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/c2.js' || req.url === '/c2.css') {
        res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
        res.end(await readFile(join(bundle, req.url.slice(1))));
      } else {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><head><link rel="stylesheet" href="/c2.css"></head><body style="margin:20px"><main id="root" class="command-workspace"></main><script type="module" src="/c2.js"></script></body></html>');
      }
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let devtools;
    for (let i = 0; i < 150; i++) {
      try { devtools = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); }
    }
    assert.ok(devtools, 'Separate browser started');
    let page;
    for (let i = 0; i < 100; i++) {
      const tabs = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json();
      page = tabs.find(tab => tab.type === 'page');
      if (page) break;
      await delay(50);
    }
    assert.ok(page, 'Separate browser page ready');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let sequence = 0;
    const waiting = new Map();
    const errors = [];
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) { const call = waiting.get(message.id); waiting.delete(message.id); message.error ? call.reject(message.error) : call.resolve(message.result); }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    };
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => {
      const value = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
      return value.result.value;
    };
    const until = async expression => {
      for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await delay(50); }
      assert.fail(`Timed out: ${expression}; errors=${JSON.stringify(errors)}; body=${await evaluate('document.body.innerText')}`);
    };
    const screenshot = async name => { const shot = await cdp('Page.captureScreenshot', { captureBeyondViewport: true }); await writeFile(join(evidence, `${name}.png`), Buffer.from(shot.data, 'base64')); };
    await cdp('Runtime.enable');
    await cdp('Page.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/?view=cop&incidentId=TX-26-0412` });
    await until('window.fixture?.requests().includes("TX-26-0412")');
    await screenshot('c2-pending');
    const pending = await evaluate('({text: document.querySelector(".iv-development")?.innerText, role: document.querySelector(".iv-development")?.getAttribute("role"), busy: document.querySelector(".iv-development")?.getAttribute("aria-busy")})');
    results.push({ state: 'pending', ...pending });
    assert.match(pending.text, /Loading (sector consequences|infrastructure analysis)/, 'Pending request must not masquerade as an unavailable model');
    assert.doesNotMatch(pending.text, /No consequence model yet|in development/);
    assert.equal(pending.role, 'status');
    assert.equal(pending.busy, 'true');
    await evaluate('fixture.settle("TX-26-0412")');
    await until('!!document.querySelector(".sc-map svg path")');
    const map = await evaluate('(() => { const svg = document.querySelector(".sc-map svg"); const r = svg.getBoundingClientRect(); return { width:r.width, height:r.height, path:svg.querySelector("path").getAttribute("d"), labels:document.querySelector(".sc-map").innerText }; })()');
    results.push({ state: 'valid', ...map });
    assert.ok(map.width > 500 && map.height >= 500);
    assert.match(map.path, /^M.+L/);
    assert.match(map.labels, /Healthcare/);
    assert.match(map.labels, /Fixture source TX-26-0412/);
    await screenshot('c2-valid-desktop');
    const detail = await evaluate('(() => { const svg=document.querySelector(".idm-canvas"); const bounds=svg?.getBoundingClientRect(); return { controls:document.querySelector("[aria-label=\\"Dependency map controls\\"]")?.innerText ?? "", width:bounds?.width ?? 0, height:bounds?.height ?? 0, nodes:document.querySelectorAll("[data-map-node]").length, roster:document.querySelector("[aria-label=\\"Infrastructure roster\\"]")?.innerText ?? "" }; })()');
    results.push({ state: 'infrastructure-detail', ...detail });
    assert.match(detail.controls, /Reset view.*Fit all/s, 'Restore existing detailed infrastructure controls from the user reference');
    assert.ok(detail.width > 400 && detail.height > 200);
    assert.equal(detail.nodes, 2);
    assert.match(detail.roster, /At risk.*Fixture renal care.*Supply chain.*Fixture source/si);
    await evaluate('document.querySelector("[data-map-node=\\"dialysis-x\\"] button").click()');
    await until('document.querySelector("[data-infrastructure-id=\\"dialysis-x\\"]")?.open');
    assert.match(await evaluate('document.querySelector("[data-infrastructure-id=\\"dialysis-x\\"]").innerText'), /depends on Potable water/);
    const beforeZoom=await evaluate('document.querySelector(".idm-canvas").getAttribute("viewBox")');
    await evaluate('document.querySelector("[aria-label=\\"Zoom in\\"]").click()');
    await until(`document.querySelector('.idm-canvas').getAttribute('viewBox') !== ${JSON.stringify(beforeZoom)}`);
    // Real selector interaction, followed by held responses in reverse order.
    await evaluate('document.querySelector(".iv-select-trigger").click()');
    await until('!!document.querySelector(".iv-selector-row")');
    await evaluate('[...document.querySelectorAll(".iv-selector-row")].find(e => e.innerText.includes("TX-26-0409")).click()');
    await until('fixture.requests().includes("TX-26-0409")');
    assert.equal(await evaluate('document.querySelector(".sector-cascade-view")'), null);
    await evaluate('fixture.choose("TX-26-0411")');
    await until('fixture.requests().includes("TX-26-0411")');
    await evaluate('fixture.settle("TX-26-0411")');
    await until('document.querySelector(".sc-source")?.innerText.includes("TX-26-0411")');
    await evaluate('fixture.settle("TX-26-0409", "error")');
    await delay(100);
    assert.match(await evaluate('document.querySelector(".sc-source").innerText'), /TX-26-0411/);
    assert.doesNotMatch(await evaluate('document.body.innerText'), /Fixture analysis unavailable/);
    // Resolved empty and failure are distinct from pending and from a valid SVG.
    await evaluate('fixture.choose("TX-26-0404")');
    await until('fixture.requests().includes("TX-26-0404")');
    await evaluate('fixture.settle("TX-26-0404", "empty")');
    await until('document.querySelector(".iv-development")?.innerText.includes("No consequence model yet")');
    assert.equal(await evaluate('document.querySelector(".iv-development").getAttribute("aria-busy")'), 'false');
    await screenshot('c2-empty');
    await evaluate('fixture.choose("TX-26-0398")');
    await until('fixture.requests().includes("TX-26-0398")');
    await evaluate('fixture.settle("TX-26-0398", "error")');
    await until('document.querySelector("[role=alert]")?.innerText.includes("Infrastructure analysis unavailable")');
    await screenshot('c2-error');
    await evaluate('fixture.choose("TX-26-0404")');
    await until('fixture.requests().includes("TX-26-0404")');
    await evaluate('fixture.settle("TX-26-0404", "valid", "TX-26-0412")');
    await until('document.querySelector("[role=alert]")?.innerText.includes("does not match the selected incident")');
    assert.equal(await evaluate('!!document.querySelector(".idm-canvas")'), false);
    await evaluate('fixture.choose("TX-26-0412")');
    await until('fixture.requests().includes("TX-26-0412")');
    await evaluate('fixture.settle("TX-26-0412")');
    await until('!!document.querySelector(".sc-map svg path")');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
    const mobile = await evaluate('(() => { const e=document.querySelector(".sc-mobile"); return {display:getComputedStyle(e).display,width:e.getBoundingClientRect().width,text:e.innerText}; })()');
    assert.notEqual(mobile.display, 'none');
    assert.ok(mobile.width > 250 && mobile.width <= 390);
    assert.match(mobile.text, /Healthcare.*2–4 h/s);
    results.push({ state: 'narrow', ...mobile });
    await screenshot('c2-valid-narrow');
    await evaluate('document.querySelector(".sc-mobile [data-sector=Healthcare]").click()');
    await until('fixture.navigation.some(item => item.view === "consequence")');
    assert.equal(await evaluate('new URL(location.href).searchParams.get("sector")'), 'healthcare');
    // Click actual C3 evidence link; verify data-backed stages/evidence/path, not invented topology.
    await evaluate('[...document.querySelectorAll("button")].find(e => e.innerText.includes("How it got in: C3")).click()');
    await until('!!document.querySelector(".sc-stage-card")');
    const attack = await evaluate('({cards:[...document.querySelectorAll(".sc-stage-card")].map(e=>({text:e.innerText,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),path:document.querySelector(".sc-attack-path").innerText})');
    assert.ok(attack.cards.length >= 4);
    assert.ok(attack.cards.every(card => card.width > 200 && card.height > 40));
    assert.match(attack.cards.map(card=>card.text).join(' '), /Initial access/);
    assert.match(attack.path, /→/);
    await evaluate('document.querySelector(".sc-stage-evidence").open=true');
    assert.ok((await evaluate('document.querySelector("[data-event-id]").innerText')).length > 20);
    results.push({ state: 'c3', ...attack });
    await screenshot('c3-narrow');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await screenshot('c3-desktop');
    // The third reported surface currently exists: verify actual canvas rather than invent a missing graph.
    await evaluate('fixture.render("graph")');
    await until('!!document.querySelector(".graph-canvas canvas")');
    const graphState = () => evaluate('(() => { const e=document.querySelector(".graph-canvas"); const cy=e._cyreg.cy; const r=e.getBoundingClientRect(); const pixels=[...e.querySelectorAll("canvas")].reduce((count,c)=>{const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=4)if(d[i])count++;return count;},0);return {width:r.width,height:r.height,nodes:cy.nodes().length,edges:cy.edges().length,pixels,selected:cy.nodes(".selected").map(n=>n.id())}; })()');
    await delay(200);
    const graph=await graphState();
    assert.ok(graph.width>500 && graph.height>200 && graph.nodes>5 && graph.edges>5 && graph.pixels>500);
    await evaluate('document.querySelector(".graph-panel input[type=checkbox]").click()');
    await delay(250);
    const context=await graphState();
    assert.ok(context.nodes>graph.nodes && context.edges>graph.edges && context.pixels>500);
    await evaluate('(() => { const e=document.getElementById("entity-picker");e.value="utility-a";e.dispatchEvent(new Event("change",{bubbles:true})); })()');
    await delay(100);
    assert.deepEqual((await graphState()).selected, ['utility-a']);
    await screenshot('operational-relationships-desktop');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(200);
    const graphNarrow=await graphState();
    assert.ok(graphNarrow.width>250 && graphNarrow.width<=390 && graphNarrow.pixels>500);
    results.push({state:'operational-relationships', graph, context, graphNarrow});
    await screenshot('operational-relationships-narrow');
    assert.deepEqual(errors, []);
  } finally {
    await writeFile(join(evidence, 'render-results.json'), JSON.stringify(results, null, 2));
    ws?.close();
    chrome.kill();
    await new Promise(resolve => server.close(resolve));
  }
});

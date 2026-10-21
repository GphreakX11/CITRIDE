// Explicit real-browser regression: requires external bundle, existing Chromium,
// exact recorded local synthetic projection and external evidence output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const bundle = process.env.C2_SELECTION_BUNDLE;
const evidence = process.env.C2_SELECTION_EVIDENCE;
const chromePath = process.env.C2_SELECTION_CHROME;
const projectionPath = process.env.C2_SELECTION_PROJECTION;
assert.ok(bundle && evidence && chromePath && projectionPath, 'Set C2_SELECTION_BUNDLE/EVIDENCE/CHROME/PROJECTION to explicit external paths');
const projectionBytes = await readFile(projectionPath);
const value = JSON.parse(projectionBytes);
const healthcare = value.nodes.find(node => node.sector === 'Healthcare' && node.windowHours && !node.source && !node.upstream);
const excluded = value.nodes.find(node => node.sector === 'Emergency Services' && node.notAffected && !node.source && !node.upstream);
const upstream = value.nodes.find(node => node.sector === 'Energy' && node.upstream);
assert.ok(healthcare && excluded && upstream, 'Recorded projection must contain affected Healthcare, unaffected Emergency Services and upstream Energy assets');
await mkdir(evidence, { recursive: true });
const results = { projectionPath, projectionSha256: createHash('sha256').update(projectionBytes).digest('hex'), incidentId: value.incident.id, healthcare: healthcare.id, excluded: excluded.id, upstream: upstream.id, checkpoints: [] };

test('C2 dimmed out-of-sector selection reveals its recorded detail without disrupting visible selection or deselection', async () => {
  const profile = await mkdtemp(join(evidence, 'isolated-chrome-'));
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/projection.json') { res.setHeader('Content-Type', 'application/json'); res.end(projectionBytes); }
      else if (req.url === '/selection.js' || req.url === '/selection.css') {
        res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
        res.end(await readFile(join(bundle, req.url.slice(1))));
      } else if (req.url.startsWith('/?')) {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><head><link rel="stylesheet" href="/selection.css"></head><body style="margin:20px"><main id="root" class="command-workspace"></main><script type="module" src="/selection.js"></script></body></html>');
      } else { res.statusCode = 404; res.end('Not found'); }
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let port;
    for (let i = 0; i < 150; i++) { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); } }
    assert.ok(port, 'Isolated browser started');
    let page;
    for (let i = 0; i < 100; i++) { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(tab => tab.type === 'page'); if (page) break; await delay(50); }
    assert.ok(page, 'Isolated page ready');
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
    const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
    const until = async expression => { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await delay(50); } assert.fail(`Timed out ${expression}; exceptions=${JSON.stringify(errors)}`); };
    const screenshot = async name => { const shot = await cdp('Page.captureScreenshot', { captureBeyondViewport: true }); await writeFile(join(evidence, name + '.png'), Buffer.from(shot.data, 'base64')); };
    const state = id => evaluate(`(() => { const node=document.querySelector('[data-map-node="${id}"]'); const card=document.querySelector('[data-infrastructure-id="${id}"]'); const text=card?.querySelector('p')?.getBoundingClientRect(); const scroll=document.querySelector('.iv-detail-scroll').getBoundingClientRect(); return {sector:new URL(location.href).searchParams.get('sector') ?? 'all',entity:new URL(location.href).searchParams.get('entity'),dimmed:node.classList.contains('idm-dimmed'),selected:node.getAttribute('data-selected'),rosterExists:!!card,open:card?.open ?? false,detailVisible:!!text && text.top>=scroll.top && text.bottom<=scroll.bottom,text:card?.innerText ?? '',pressed:[...document.querySelectorAll('.iv-detail-filters button[aria-pressed=true]')].map(e=>e.innerText),callbacks:selectionFixture.selections}; })()`);
    const clickNode = id => evaluate(`document.querySelector('[data-map-node="${id}"] button').click()`);
    const clickSummary = id => evaluate(`document.querySelector('[data-infrastructure-id="${id}"] summary').click()`);
    await cdp('Runtime.enable'); await cdp('Page.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?view=cop&incidentId=${encodeURIComponent(value.incident.id)}` });
    await until('!!document.querySelector(".idm-canvas [data-map-node]")');
    const geometry = await evaluate('(() => { const svg=document.querySelector(".idm-canvas");const r=svg.getBoundingClientRect();return {width:r.width,height:r.height,nodes:svg.querySelectorAll("[data-map-node]").length,paths:svg.querySelectorAll(".idm-edge path").length}; })()');
    assert.ok(geometry.width > 400 && geometry.height > 200 && geometry.nodes >= value.nodes.length && geometry.paths > 0);
    results.geometry = geometry;
    await evaluate('[...document.querySelectorAll(".iv-detail-filters button")].find(e=>e.innerText==="Healthcare").click()');
    await until('new URL(location.href).searchParams.get("sector")==="healthcare"');
    // In-sector selection and disclosure deselection retain the chosen sector.
    await clickNode(healthcare.id);
    await until(`document.querySelector('[data-infrastructure-id="${healthcare.id}"]')?.open`);
    const inSector = await state(healthcare.id);
    assert.equal(inSector.sector, 'healthcare'); assert.deepEqual(inSector.pressed, ['Healthcare']);
    await clickSummary(healthcare.id);
    await until('!new URL(location.href).searchParams.has("entity")');
    const deselected = await state(healthcare.id);
    assert.equal(deselected.sector, 'healthcare'); assert.equal(deselected.open, false);
    // Upstream assets are intentionally always visible, even across sectors.
    const upstreamBefore = await state(upstream.id);
    assert.equal(upstreamBefore.dimmed, false); assert.equal(upstreamBefore.rosterExists, true);
    await clickNode(upstream.id);
    await until(`document.querySelector('[data-infrastructure-id="${upstream.id}"]')?.open`);
    const upstreamSelected = await state(upstream.id);
    assert.equal(upstreamSelected.sector, 'healthcare');
    const before = await state(excluded.id);
    assert.equal(before.dimmed, true); assert.equal(before.rosterExists, false);
    await screenshot('healthcare-before-out-of-sector-click');
    results.checkpoints.push({ inSector, deselected, upstreamBefore, upstreamSelected, before });
    await clickNode(excluded.id);
    await until(`new URL(location.href).searchParams.get('entity')===${JSON.stringify(excluded.id)}`);
    const after = await state(excluded.id);
    results.checkpoints.push({ after });
    await screenshot('out-of-sector-selected');
    assert.ok(after.rosterExists && after.open, 'Selecting a dimmed out-of-sector graph asset must reveal its matching recorded roster detail');
    assert.equal(after.sector, 'all', 'Selection must truthfully broaden the sector filter');
    assert.deepEqual(after.pressed, ['All']);
    assert.equal(after.dimmed, false); assert.equal(after.selected, 'true');
    assert.match(after.text, /Fire Service F/); assert.match(after.text, /Not affected/i);
    assert.equal(after.detailVisible, true, 'Selected detail must be visible inside the bounded roster, not only present below its scroll viewport');
    // Roster can close the selected asset without restoring a stale filter.
    await clickSummary(excluded.id);
    await until('!new URL(location.href).searchParams.has("entity")');
    const afterDeselect = await state(excluded.id);
    assert.equal(afterDeselect.sector, 'all'); assert.equal(afterDeselect.open, false);
    results.checkpoints.push({ afterDeselect });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate('[...document.querySelectorAll(".iv-detail-filters button")].find(e=>e.innerText==="Healthcare").click()');
    await clickNode(excluded.id);
    await until(`document.querySelector('[data-infrastructure-id="${excluded.id}"]')?.open`);
    const narrow = await state(excluded.id);
    assert.equal(narrow.sector, 'all'); assert.deepEqual(narrow.pressed, ['All']);
    assert.equal(narrow.detailVisible, true);
    results.checkpoints.push({ narrow });
    await screenshot('out-of-sector-selected-narrow');
    assert.deepEqual(errors, []);
  } finally {
    await writeFile(join(evidence, 'selection-results.json'), JSON.stringify(results, null, 2));
    ws?.close(); chrome.kill(); await new Promise(resolve => server.close(resolve));
  }
});

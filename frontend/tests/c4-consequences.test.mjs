import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const cache = new Map();
async function compile(url, mockHooks = false) {
  const key = `${url.href}:${mockHooks}`;
  if (cache.has(key)) return cache.get(key);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const s = m[1];
    imports.set(
      s,
      s.startsWith(".")
        ? await compile(new URL(s, url), mockHooks)
        : mockHooks && s === 'react'
          ? `data:text/javascript,export const useState=i=>[typeof i==='function'?i():i,()=>{}];export const useEffect=()=>{};`
          : import.meta.resolve(s),
    );
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_, s) => `from ${JSON.stringify(imports.get(s))}`,
  );
  const out = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(key, out);
  return out;
}
const model = await import(
  await compile(new URL("../src/consequencesModel.ts", import.meta.url))
);
const { ConsequencesContent, default: ConsequencesView } = await import(
  await compile(new URL("../src/ConsequencesView.tsx", import.meta.url))
);
const {default: SectorCascadeView} = await import(await compile(new URL('../src/SectorCascadeView/SectorCascadeView.tsx', import.meta.url)));
const {default: AssetConsequenceView} = await import(await compile(new URL('../src/AssetConsequenceView/AssetConsequenceView.tsx', import.meta.url)));
const renderSectors = value => renderToStaticMarkup(createElement(SectorCascadeView, {value}));
const { clockLabel } = await import(
  await compile(new URL("../src/useRealClock.ts", import.meta.url))
);
test("C4 SSR preserves captured analysis without window or a new projection", () => {
  const markup = renderToStaticMarkup(createElement(ConsequencesView, {
    selectedId: "legacy-case", captured: createElement("section", null, "Saved immutable graph"),
    onSelect() {}, onOpenAnalyst() {}, onNavigate() {},
  }));
  assert.match(markup, /Saved immutable graph/);
  assert.doesNotMatch(markup, /Loading consequence records/);
  assert.match(markup, /<time dateTime=/);
});
test("C4 actually starts on the configured third incident without a URL", () => {
  const records = {featuredIncidentId:'THIRD-GRID',statewideIncidents:[{id:'OTHER-CRITICAL',status:'open',severity:'critical'},{id:'THIRD-GRID',status:'open',severity:'low'}]};
  const markup = renderToStaticMarkup(createElement(ConsequencesView, {records, selectedId:'OTHER-CRITICAL',onSelect(){},onOpenAnalyst(){},onNavigate(){}}));
  assert.match(markup,/THIRD-GRID/);
  assert.doesNotMatch(markup,/OTHER-CRITICAL/);
});
test("node tones are evidence driven and never default green", () => {
  const state = model.consequenceNodeState;
  assert.equal(state({ source: true }).tone, "red");
  assert.equal(state({ windowHours: [1, 4] }).tone, "red");
  assert.equal(state({ windowHours: [4, 8] }).tone, "amber");
  assert.equal(state({ notAffected: true }).line, "dashed");
  assert.equal(state({ inArea: true }).line, "dotted");
  assert.equal(state({ upstream: true }).tone, "green");
  assert.equal(state({ upstream: true, status: "degraded" }).tone, "grey");
  assert.equal(state({}).tone, "grey");
});
test("incident URL is authoritative and an unconfigured C4 delegates defaults to the backend", () => {
  assert.equal(model.initialConsequenceIncident(""), null);
  assert.equal(
    model.initialConsequenceIncident("?incidentId=port", "case"),
    "port",
  );
  assert.equal(model.initialConsequenceIncident("?incident=other"), "other");
});
test("operations clock follows Chicago daylight savings", () => {
  assert.match(clockLabel(Date.parse("2026-10-18T12:00:00Z"), "America/Chicago"), /07:00.*CDT/);
  assert.equal(
    model.elapsedLabel(
      "2026-10-18T11:30:00Z",
      Date.parse("2026-10-18T12:00:00Z"),
    ),
    "30 min ago",
  );
});
const fixture = {
  now: "2026-10-18T12:00:00Z",
  operationsTimeZone: "America/Chicago",
  incident: { id: "OTHER-1", title: "Other jurisdiction" },
  incidents: [],
  analysis: {
    kind: "preliminary",
    createdAt: "2026-10-18T11:30:00Z",
    modelVersion: "interval-v1",
    seed: { lossType: "unsafe_water" },
  },
  source: { id: "source", name: "Other utility", type: "WaterServiceProvider" },
  people: 42,
  atRisk: 1,
  earliestWindow: [1, 4],
  nodes: [
    {
      id: "dependent",
      name: "Care center",
      sector: "Healthcare",
      type: "Hospital",
      windowHours: [1, 4],
      impactCount: 1,
      paths: [],
      reserves: [],
      sourceRefs: [],
      reserveLabel: "Clean-water reserve",
    },
  ],
  edges: [],
  sectors: [],
};
function render(value) {
  return renderToStaticMarkup(
    createElement(ConsequencesContent, {
      value,
      now: Date.parse(value.now),
      onAnalyst() {},
      onPartners() {},
    }),
  );
}
test("record-driven C4 includes missing-data, evidence, advisory and no place assumptions", () => {
  const html = render(fixture);
  for (const text of [
    "PRELIMINARY ESTIMATE",
    "42",
    "Critical infrastructure at risk",
    "1–4 h",
    "Not recorded for this asset",
    "Timeline and thresholds",
    "Workarounds",
    "Who owns the response",
    "Confidence:",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /Texas|Houston|14 facilities|Critical facilities|No incident selected/,
  );
  assert.match(html, /not yet reviewed by an analyst/);
});
test("phone briefing puts grounded impact and next action before technical detail", () => {
  const html = render(fixture);
  const start = html.indexOf('aria-label="Impact and next action"');
  assert.ok(start >= 0, "compact briefing exists");
  assert.ok(start < html.indexOf('class="c4-asset"'));
  const brief = html.slice(start, html.indexOf('</section>', start));
  assert.match(brief, /1 infrastructure asset at risk/);
  assert.match(brief, /1–4 h/);
  assert.match(brief, /Modeled · not observed outages/);
  assert.match(brief, /Review in Analyst/);
  assert.match(brief, /Preliminary · not analyst reviewed/);
});
test("phone briefing preserves unknown impact, zero and reference provenance", () => {
  function brief(value) {
    const html = render(value);
    const start = html.indexOf('aria-label="Impact and next action"');
    return html.slice(start, html.indexOf('</section>', start));
  }
  assert.match(brief({ ...fixture, atRisk: undefined, earliestWindow: null }), /Impact count not recorded/);
  assert.match(brief({ ...fixture, atRisk: 0 }), /0 infrastructure assets at risk/);
  const ref = brief({ ...fixture, analysis: { ...fixture.analysis, kind: "reference_preview" } });
  assert.match(ref, /Reference projection · not saved or analyst reviewed/);
  assert.doesNotMatch(ref, /ANALYSIS REVIEWED/);
});
test("reviewed banner and modeled colors are independent", () => {
  const html = render({
    ...fixture,
    analysis: { ...fixture.analysis, kind: "reviewed" },
  });
  assert.match(html, /ANALYSIS REVIEWED/);
  assert.doesNotMatch(html, /PRELIMINARY ESTIMATE/);
  assert.equal((html.match(/c4-tile tone-red/g) || []).length, 2);
});
test("unmodeled incident retains explicit development state", () => {
  const html = render({ ...fixture, analysis: null });
  assert.match(
    html,
    /Consequence view for this incident type is in development/,
  );
  assert.match(html, /Alerts in Analyst/);
});
test("C2 sector graph reserves vertical room and a larger source node for long labels", () => {
  const source = { ...fixture.nodes[0], id: "source", source: true, upstream: false,
    name: "Port of Houston · Barbours Cut Container Terminal" };
  const sectors = ["Chemical", "Emergency Services", "Energy", "Water"];
  const nodes = sectors.map((sector, i) => ({ ...fixture.nodes[0], id: `node-${i}`, sector }));
  const html = renderSectors({ ...fixture, nodes: [source, ...nodes],
    sectors: sectors.map((label, i) => ({ label, nodes: [`node-${i}`], atRisk: 1 })) });
  assert.match(html, /class="sc-graph" style="height:680px"/);
  assert.match(html, /sc-node tone-red sc-source/);
  assert.ok(html.includes(source.name));
  const css = readFileSync(new URL("../src/SectorCascadeView/sector-cascade.css", import.meta.url), "utf8");
  assert.match(css, /\.sc-node\s*\{[^}]*border-radius:50%/);
  assert.match(css, /\.sc-graph>\.sc-source\s*\{[^}]*width:210px/);
});
test("source-sector grouping retains impacted dependents instead of hiding them", () => {
  const source = { ...fixture.nodes[0], id: "source", name: "Source terminal", source: true, sector: "Transportation" };
  const dependent = { ...fixture.nodes[0], id: "ships", name: "Vessels", sector: "Transportation" };
  const html = renderSectors({ ...fixture, nodes: [source, dependent], sectors: [
    { label: "Transportation", source: true, nodes: ["source", "ships"], atRisk: 1 },
  ] });
  assert.match(html, /<strong>Transportation<\/strong>/);
});
test("C4 rich metadata is optional, generic, immutable and keeps zero scores", () => {
  const value = { ...fixture, infrastructureCount: 14, cascadeCount: 11, watchOnlyCount: 3,
    criticalFunctions: [{ function: "Keep regional freight moving", level: "medium", windowHours: [6, 9], note: "Regional feed" }],
    sectorViews: [{ sectors: [{ sector: "Logistics", score: 0, items: [{label: "Depot", status: "normal", score: 0}, {label: "Unknown score", status: "reviewing"}], vessels: [{name: "Regional carrier", role: "Inbound", status: "diverted"}] }] }],
    consequenceScores: [{basis: "Supplied model", sectors: [{sector: "Logistics", score: 0}], energySubsectors: [{label: "Local generation", score: 0}]}],
    watchAssets: [{ entityId: "peer", reason: "Correlated indicators", status: "monitoring", inCascade: false, entity: {name: "Peer depot"} }],
    confidence: {level: "high", value: 0.91, note: "Operator source"},
  };
  const before = JSON.stringify(value);
  const html = render(value);
  for (const text of ["14 infrastructure assets", "11 in the cascade", "3 watch-only", "Keep regional freight moving", "Regional carrier", "Local generation", "Score 0", "Peer depot", "not service dependencies", "91%"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Inside each sector/);
  assert.match(html, /status-chip--green/);
  assert.equal(JSON.stringify(value), before);
  assert.doesNotMatch(render(fixture), /Inside each sector|Critical functions at risk|ON WATCH/);
});
test("watch-only nodes stay amber dashed without computed impact or window", () => {
  assert.deepEqual(model.consequenceNodeState({status: "on_watch", watch: [{reason: "Review"}]}), {tone: "amber", line: "dashed", label: "On watch · no modeled service loss"});
  assert.equal(model.consequenceNodeState({windowHours: [1, 4], watch: [{reason: "Review"}]}).tone, "red");
});
test("watch graph edges remain separate from service dependencies and timeline", () => {
  const watch = {entityId: "peer", reason: "Same login pattern", status: "monitoring", inCascade: false};
  const value = {...fixture, nodes: [
    {...fixture.nodes[0], id: "source", name: "Regional source", source: true},
    {...fixture.nodes[0], id: "peer", name: "Peer depot", windowHours: null, impactCount: 0, watch: [watch]},
  ], watchAssets: [watch]};
  const before = JSON.stringify(value);
  const html = renderSectors(value);
  assert.match(html, /data-relationship="watch"/);
  assert.match(html, /class="sc-watch-edge"/);
  assert.doesNotMatch(render(value), /class="c4-timeline"/);
  assert.doesNotMatch(html, /class="c4-timeline"/);
  assert.equal(JSON.stringify(value), before);
});
const richMapFixture = {
  ...fixture,
  source: {id: 'hub', name: 'Regional freight hub', type: 'PortFacility'},
  nodes: [
    {...fixture.nodes[0], id: 'hub', name: 'Regional freight hub', source: true, sector: 'Freight'},
    {...fixture.nodes[0], id: 'grid', name: 'Upstream grid', upstream: true, sector: 'Power', windowHours: null, impactCount: 0},
    ...['Fuel', 'Freight', 'Materials', 'Water'].map((sector, i) => ({...fixture.nodes[0], id: `asset-${i}`, name: `Asset ${i}`, sector, windowHours: [3 + i * 5, 6 + i * 6]})),
    {...fixture.nodes[0], id: 'peer', name: 'Peer harbor', sector: 'Freight', windowHours: null, impactCount: 0},
  ],
  sectors: ['Fuel', 'Freight', 'Materials', 'Water'].map((label, i) => ({label, source: label === 'Freight', nodes: [`asset-${i}`], atRisk: 1, windowHours: [3 + i * 5, 6 + i * 6]})),
  sectorViews: [{sectors: ['Fuel', 'Freight', 'Materials', 'Water'].map((sector, i) => ({sector, score: i * 20, items: [{label: `Sector item ${i}`, entityId: `asset-${i}`}]}))}],
  watchAssets: [{entityId: 'asset-0', reason: 'Same login pattern', inCascade: true}, {entityId: 'peer', reason: 'Correlated indicators', inCascade: false}],
};
test('rich sector map centers source, preserves supplied windows and excludes upstream infrastructure', () => {
  const before = JSON.stringify(richMapFixture);
  const html = renderSectors(richMapFixture);
  assert.match(html, /aria-label="Sector consequence map"/);
  assert.match(html, /data-map-role="source"[^>]*style="left:50%;top:50%/);
  assert.equal((html.match(/data-map-role="sector"/g) || []).length, 4);
  assert.doesNotMatch(html, /Upstream grid/);
  assert.match(html, /Score 0/);
  assert.match(html, /6–12 h|8–12 h/);
  assert.equal(JSON.stringify(richMapFixture), before);
});
test('rich map watch satellites attach to their recorded sector even when also in cascade', () => {
  const html = renderSectors(richMapFixture);
  assert.match(html, /data-watch-sector="Fuel"/);
  assert.match(html, /data-watch-sector="Freight"/);
  assert.equal((html.match(/data-map-role="watch"/g) || []).length, 2);
  assert.match(html, /same login pattern/i);
  assert.match(html, /Correlated indicators/);
  assert.match(html, /Watch · not a dependency/);
  assert.match(html, /sc-watch tone-amber/);
});
test('C2 sector activation opens the corresponding C4 asset filter and retains the sector map', async () => {
  const {default: InteractiveSectors} = await import(await compile(new URL('../src/SectorCascadeView/SectorCascadeView.tsx', import.meta.url), true));
  let selected = null;
  function elements(node) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(elements)];
  }
  const tree = InteractiveSectors({value:richMapFixture,onSelect:s=>{selected=s;}});
  const target = elements(tree).find(e => e.props?.['data-sector'] === 'Materials');
  assert.equal(target.type, 'button');
  target.props.onClick();
  assert.deepEqual(selected, {sector:'materials',entityId:null});
  globalThis.window = {location:{href:'https://local.invalid/?view=consequence&incidentId=OTHER-1&sector=materials'}};
  try {
    const details = renderToStaticMarkup(createElement(AssetConsequenceView, {value:richMapFixture,onAnalyst(){}}));
    assert.match(details, /data-facility-id="asset-2"/);
    assert.doesNotMatch(details, /data-facility-id="asset-(?:0|1|3)"/);
    assert.match(details, /aria-label="Infrastructure sectors"/);
    const map = renderSectors(richMapFixture);
    assert.equal((map.match(/data-map-role="sector"/g) || []).length, 4);
    assert.match(map, /data-sector="Materials" aria-pressed="true"/);
  } finally { delete globalThis.window; }
});
test('compact phone map retains every sector and watch relationship without a wide canvas', () => {
  const value = {...richMapFixture, sectorLinks:richMapFixture.sectors.map(s=>({id:`link-${s.label}`,from:'hub',fromKind:'source',to:s.label,service:`Recorded service for ${s.label}`,step:1,windowHours:s.windowHours,dependencyIds:[]}))};
  const html = renderSectors(value);
  const mobile = html.slice(html.indexOf('class="sc-mobile"'));
  for (const sector of ['Fuel','Freight','Materials','Water']) assert.match(mobile, new RegExp(`data-sector="${sector}"`));
  assert.equal((html.match(/data-relationship="dependency"/g) || []).length,4);
  assert.equal((html.match(/marker-end="url\(/g) || []).length,4);
  assert.equal((mobile.match(/Recorded service for /g) || []).length,4);
  assert.equal((mobile.match(/class="sc-mobile-watch"/g) || []).length, 2);
  assert.match(mobile,/Same login pattern/);
  assert.match(mobile,/Correlated indicators/);
  const css=readFileSync(new URL('../src/SectorCascadeView/sector-cascade.css',import.meta.url),'utf8');
  assert.match(css,/@media\s*\(max-width:600px\)/);
  assert.match(css,/\.sc-desktop\{display:none\}/);
  assert.match(css,/\.sc-mobile\{display:grid/);
});
if (process.env.C4_PROJECTIONS) {
  const projections = JSON.parse(
    readFileSync(process.env.C4_PROJECTIONS, "utf8"),
  );
  for (const value of projections)
    test(`actual backend projection renders ${value.incident.id}`, () => {
      const html = render(value);
      assert.ok(html.includes(value.analysis.kind === "reference_preview" ? "READ-ONLY REFERENCE PROJECTION" : value.analysis.kind === "reviewed" ? "ANALYSIS REVIEWED" : "PRELIMINARY ESTIMATE"));
      assert.ok(html.includes(value.source.label || value.source.name));
      assert.ok(html.includes(String(value.atRisk)));
      assert.ok(html.includes("Who owns the response"));
    });
}

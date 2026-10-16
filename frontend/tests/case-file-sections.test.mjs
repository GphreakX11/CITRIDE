import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";

// Load real components artifact-free. CSS is intentionally omitted from SSR;
// this gate verifies rendered controls/section structure, not browser layout.
const cache = new Map();
async function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const source = readFileSync(url, "utf8");
  let code = (
    await transformWithOxc(source, url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const specs = [
    ...new Set(
      [...code.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  for (const spec of specs) {
    let target;
    if (spec.startsWith(".")) {
      target = new URL(spec, url);
      if (!existsSync(target)) {
        target = [".tsx", ".ts", ".json"]
          .map((ext) => new URL(spec + ext, url))
          .find((candidate) => existsSync(candidate));
      }
      assert.ok(target, `Missing dependency ${spec}`);
      target = await moduleUrl(target);
    } else target = import.meta.resolve(spec);
    code = code.replaceAll(JSON.stringify(spec), JSON.stringify(target));
  }
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, result);
  return result;
}
const caseSource = readFileSync(
  new URL("../src/CommandCasework.tsx", import.meta.url),
  "utf8",
);
const { default: CommandCasework } = await import(
  await moduleUrl(new URL("../src/CommandCasework.tsx", import.meta.url))
);
const { default: AnalystEntityProfile } = await import(
  await moduleUrl(new URL("../src/AnalystEntityProfile.tsx", import.meta.url))
);
const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url)),
);
const entity = (id) => data.entities.find((item) => item.id === id);
const selected = {
  id: "case-safety",
  version: 7,
  title: "Captured case",
  priority: "high",
  status: "open",
  createdAt: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:10:00Z",
  closedAt: null,
  closureNote: null,
  eventId: "event-dosing",
  baselineRevision: data.baselineRevision,
  eventSnapshot: data.events.find((event) => event.id === "event-dosing"),
  contextSnapshot: {
    baselineRevision: data.baselineRevision,
    cyberAsset: entity("cyber-plc-a"),
    physicalAsset: entity("plc-a"),
    facility: entity("plant-a"),
    provider: entity("utility-a"),
    serviceArea: entity("area-a"),
    downstreamDependencies: [],
    scenarios: data.scenarios.filter((scenario) =>
      scenario.seed.eventRefs.includes("event-dosing"),
    ),
    sourceRefs: ["src-controller"],
    warnings: ["Visible captured warning"],
  },
  tasks: [
    {
      id: "task",
      label: "Review source evidence",
      completed: false,
      completedAt: null,
    },
  ],
  decisions: [
    {
      id: "decision",
      title: "Review potential impact",
      entityId: "hospital-y",
      entityLabel: "Captured hospital label",
      functionId: "function",
      functionLabel: "Captured function",
      state: "at_risk",
      windowHours: [4, 8],
      sourceRefs: [],
      sourceSnapshots: [],
      assumptions: ["Captured assumption"],
      reviewed: false,
      reviewNote: null,
      reviewedAt: null,
      authorityBasis: "not_configured",
      gateStatus: "not_evaluated",
    },
  ],
  notes: [],
  activity: [],
  runId: null,
  runSnapshot: null,
};
const noAction = () => {
  throw new Error("SSR must never invoke a callback");
};
const props = {
  data,
  incidents: [selected],
  selected,
  mode: "full",
  onSelect: noAction,
  onCreate: noAction,
  onMutate: noAction,
  busy: false,
  uncertain: false,
  onRecheck: noAction,
  onRetryPending: noAction,
  onOpenEvidence: noAction,
};
const render = (overrides = {}) =>
  renderToStaticMarkup(
    createElement(CommandCasework, { ...props, ...overrides }),
  );

test("public Case File header and renamed counted sections preserve all content and tracking anchors", () => {
 const records={statewideIncidents:[{id:"TX-26-0412",caseId:selected.id,linkedEventIds:[selected.eventId]}]};
 const before=JSON.stringify(selected),html=render({records});
 assert.match(html,/CASE FILE · TX-26-0412 · version 7 · opened [0-9]{2}:[0-9]{2} CT from/);
 assert.match(html,/class="[^"]*mono/);
 const nav=html.match(/<nav[^>]+aria-label="Case file sections"[\s\S]*?<\/nav>/)[0];
 for(const name of ['Context','Cyber Evidence','Consequences',`Reviews ${selected.decisions.filter(d=>d.reviewed).length}/${selected.decisions.length}`,`Tasks ${selected.tasks.filter(t=>t.completed).length}/${selected.tasks.length}`,'Notes','Activity','Case status','Advanced'])assert.ok(nav.includes('>'+name+'</a>'),name);
 assert.match(nav,/href="#[^"]*-case-tracking"/);
 const ordinary=html.split('data-case-section="advanced"')[0].replace(/<[^>]+>/g,'');assert.ok(!ordinary.includes(selected.id));
 assert.equal(JSON.stringify(selected),before);
});
test("all nine full-case anchors resolve to mounted sections; Context defaults active", () => {
  const html = render();
  const nav = html.match(
    /<nav[^>]+aria-label="Case file sections"[\s\S]*?<\/nav>/,
  )[0];
  const links = [...nav.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
  assert.equal(links.length, 9);
  assert.equal(new Set(links).size, 9);
  for (const id of links) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(nav, /aria-current="location">Context<\/a>/);
  for (const section of [
    "context",
    "tasks",
    "consequence",
    "decisions",
    "notes",
    "activity",
    "tracking",
    "advanced",
  ])
    assert.ok(html.includes(`data-case-section="${section}"`));
  for (const field of [
    "Coordination note",
    "Impact review note",
    "Required tracking / closure note",
    "Evaluation hour",
    "Horizon hours",
  ])
    assert.ok(html.includes(field), field);
});

test("section selection cannot destructively unmount forms or mutate a case", () => {
  // Navigation state is read only for aria-current, never a section predicate/key.
  assert.equal([...caseSource.matchAll(/\bactiveSection\b/g)].length, 2);
  assert.match(caseSource, /onClick=\{\(\) => setActiveSection\(id\)\}/);
  assert.match(caseSource, /key=\{selected\.id\}/);
  assert.doesNotMatch(
    caseSource,
    /key=\{activeSection\}|activeSection\s*===\s*["'](?:tasks|notes|decisions)/,
  );
  assert.match(
    caseSource,
    /const show = [\s\S]*?mode === "full" \|\| mode === section/,
  );
});

test("captured context/run details default open and warnings sit outside disclosures", () => {
  const html = render();
  assert.match(
    html,
    /<details open=""><summary>Captured context &amp; sources<\/summary>/,
  );
  assert.ok(
    html.indexOf("Visible captured warning") <
      html.indexOf("Captured context &amp; sources"),
  );
  const run = {
    id: "captured-run",
    scenarioId: selected.contextSnapshot.scenarios[0].id,
    createdAt: selected.createdAt,
    baselineRevision: data.baselineRevision,
    modelVersion: "captured-model",
    request: { evaluationHour: 1, horizonHours: 12 },
    seed: selected.contextSnapshot.scenarios[0].seed,
    impacts: [],
    warnings: [],
    baselineSnapshot: { sources: data.sources },
  };
  assert.match(
    render({ selected: { ...selected, runId: run.id, runSnapshot: run } }),
    /<details open=""><summary>Captured run details &amp; sources<\/summary>/,
  );
});

test("non-full modes retain their controls and create form survives no selected case", () => {
  const expected = {
    tasks: ["tasks", "tracking"],
    consequence: ["consequence", "decisions", "tracking"],
    decisions: ["decisions", "tracking"],
    coordination: ["notes", "activity", "tracking"],
  };
  for (const [mode, sections] of Object.entries(expected)) {
    const html = render({ mode });
    assert.doesNotMatch(html, /aria-label="Case file sections"/);
    for (const section of sections)
      assert.ok(
        html.includes(`data-case-section="${section}"`),
        `${mode}: ${section}`,
      );
  }
  const html = render({ selected: null });
  assert.match(
    html,
    /<details class="cc-panel" open=""><summary>Open case/,
  );
  assert.match(html, /maxLength="160"/);
  assert.match(html, /No case selected/);
});

test("uncertain recovery, frozen optimistic versions, idempotency and dismissal guards remain", () => {
  const html = render({ uncertain: true });
  assert.match(html, /Recheck workflow/);
  assert.match(html, /Retry same saved request/);
  assert.match(html, /aria-label="Coordination note"[^>]*disabled=""/);
  assert.match(html, /type="checkbox"[^>]*disabled=""/);
  const createSource = readFileSync(
    new URL("../src/CaseCreateForm.tsx", import.meta.url),
    "utf8",
  );
  assert.match(createSource, /clientRequestId: crypto\.randomUUID\(\)/);
  assert.match(createSource, /if \(blocked \|\| guard\.current\) return/);
  assert.match(caseSource, /<CaseCreateForm/);
  for (const expression of [
    /if \(blocked \|\| guard\.current\) return/,
    /await onMutate\(action, version, caseId\)/,
    /confirmation\.action,\s*confirmation\.version,\s*confirmation\.caseId/,
    /disabled=\{busy \|\| saving\}/,
    /onCancel=\{\(\) => setConfirmation\(null\)\}/,
    /!selected\.runId &&\s*!selected\.runSnapshot &&\s*baselineMatches/,
  ])
    assert.match(caseSource, expression);
});

test("optional entity/download/tool callbacks add entry points without becoming required", () => {
  assert.doesNotMatch(render(), /Download case record \(JSON\)/);
  const html = render({
    onOpenEntity: noAction,
    onDownloadRecord: noAction,
    onOpenTool: noAction,
  });
  assert.match(html, /Download case record \(JSON\)/);
  assert.match(html, /Open in Incident → decision/);
  assert.match(html, /Open run in scenario lab/);
  assert.match(html, /Captured event-to-people chain/);
  assert.equal((html.match(/class="analyst-record-link"/g) ?? []).length, 5);
});

test("entity profile renders real sections, conservative unknowns, source records and raw data", () => {
  const html = renderToStaticMarkup(
    createElement(AnalystEntityProfile, {
      data,
      entityId: "utility-a",
      incidents: [selected],
      locked: false,
      onSelectEntity: noAction,
      onOpenCase: noAction,
      onOpenTool: noAction,
      onEditDependency: noAction,
      onBack: noAction,
    }),
  );
  for (const label of [
    "Depends on",
    "Supplies",
    "Ownership, hosting and location",
    "Linked cases",
    "Recorded events",
    "Impacts across saved case runs",
    "Classification",
    "Sources and assumptions",
    "Raw entity record",
  ])
    assert.ok(html.includes(label), label);
  assert.match(html, /People served: unknown/);
  assert.match(html, /Recorded status: unknown/);
  assert.match(html, /not runtime OWL proof/);
  assert.doesNotMatch(html, /Under attack|18,000 people|Derived by OWL/);
  assert.match(html, /Edit dependency/);
  assert.match(html, /Propose a new dependency/);
  assert.match(html, /Captured case/);
  assert.match(html, /Dosing parameter changed/);
  assert.doesNotMatch(html, /Related source probes Utility B/);
});

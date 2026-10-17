import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import { parseSync } from "rolldown/utils";

const sourceUrl = new URL("../src/CommandCenterViews.tsx", import.meta.url);
const source = readFileSync(sourceUrl, "utf8");
const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
// In-memory TSX compilation: no build, dependency install or emitted repository files.
const hookUrl = `data:text/javascript;base64,${Buffer.from(`let values=[],cursor=0;export function reset(){cursor=0}export function clear(){values=[];cursor=0}export function useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value}];}`).toString("base64")}`;
const hooks = await import(hookUrl);
async function loadComponent(hookHarness = false) {
  async function compile(url) {
    let code = (
      await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
        jsx: { runtime: "automatic" },
      })
    ).code;
    code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
    const imports = new Map();
    for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (hookHarness && specifier === "react") imports.set(specifier, hookUrl);
      // Parent callback tests isolate the child; actual SSR tests and browser QA
      // exercise its real controls/hooks. No fake map is used for acceptance.
      else if (
        hookHarness &&
        (specifier.endsWith("CommandInfrastructureMap.tsx") ||
          specifier.endsWith("StatewideFootprint.tsx"))
      )
        imports.set(
          specifier,
          "data:text/javascript,export default function IsolatedMap(){return null}",
        );
      else if (specifier.startsWith(".") && specifier.endsWith(".tsx"))
        imports.set(specifier, await compile(new URL(specifier, url)));
      else
        imports.set(
          specifier,
          specifier.startsWith(".")
            ? new URL(
                /\.[cm]?[jt]s$/.test(specifier) ? specifier : `${specifier}.ts`,
                url,
              ).href
            : import.meta.resolve(specifier),
        );
    }
    code = code.replace(
      /from\s+["']([^"']+)["']/g,
      (_match, specifier) => `from ${JSON.stringify(imports.get(specifier))}`,
    );
    return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  }
  return (await import(await compile(sourceUrl))).default;
}
const CommandCenterViews = await loadComponent();
const CallbackTreeComponent = await loadComponent(true);
const views = [
  "command",
  "cop",
  "cyber",
  "consequence",
  "uctf",
  "leadership",
  "federation",
];
function incident(id = "case-a", title = "Stored case A", captured = true) {
  const baseline = structuredClone(data);
  baseline.entities.find((e) => e.id === "dialysis-x").label =
    "Captured facility name";
  baseline.entities.find((e) => e.id === "dialysis-x").idt = {
    status: "coded",
    path: "10.1.2.4",
  };
  const run = {
    id: "run-a",
    modelVersion: baseline.modelVersion,
    baselineRevision: baseline.baselineRevision,
    createdAt: "2026-10-14T12:01:00Z",
    scenarioId: "test",
    request: {
      scenarioId: "test",
      evaluationHour: 0,
      horizonHours: 12,
      overrides: [],
    },
    seed: {
      provider: "utility-a",
      service: "treated_water",
      lossType: "unsafe_treated_water",
      windowHours: [0, 0],
      persistsThroughHour: 12,
      eventRefs: [],
      sourceRefs: [],
    },
    baselineSnapshot: baseline,
    impacts: [
      {
        id: "impact-a",
        entityId: "dialysis-x",
        functionId: "dialysis-treatment",
        state: "at_risk",
        windowHours: [2, 4],
        paths: [],
        sourceRefs: [],
        assumptions: ["Captured assumption"],
        evidenceStatus: "modeled",
        timingStatus: "interval",
      },
    ],
    warnings: [],
    excluded: [],
  };
  return {
    id,
    version: 1,
    title,
    status: "open",
    priority: "medium",
    eventId: baseline.events[0].id,
    eventSnapshot: baseline.events[0],
    baselineRevision: baseline.baselineRevision,
    contextSnapshot: {
      event: baseline.events[0],
      baselineRevision: baseline.baselineRevision,
      cyberAsset: baseline.entities.find((e) => e.id === "cyber-plc-a"),
      physicalAsset: baseline.entities.find((e) => e.id === "plc-a"),
      facility: baseline.entities.find((e) => e.id === "plant-a"),
      provider: baseline.entities.find((e) => e.id === "utility-a"),
      serviceArea: baseline.entities.find((e) => e.id === "area-a"),
      sourceRefs: ["src-network"],
      warnings: [],
      downstreamDependencies: [],
      scenarios: [],
    },
    tasks: [
      {
        id: "task-a",
        label: "Saved response task",
        completed: false,
        completedAt: null,
      },
    ],
    decisions: [],
    notes: [],
    activity: [
      {
        id: "activity-a",
        kind: "created",
        message: "Analyst opened this saved case",
        createdAt: "2026-10-14T12:00:00Z",
      },
    ],
    createdAt: "2026-10-14T12:00:00Z",
    updatedAt: "2026-10-14T12:00:00Z",
    closedAt: null,
    closureNote: null,
    runId: captured ? run.id : null,
    runSnapshot: captured ? run : null,
  };
}
function props(view, cases = [incident()], selected = cases[0] ?? null) {
  return {
    data,
    incidents: cases,
    selected,
    view,
    onSelect() {},
    onOpenAnalyst() {},
    onNavigate() {},
  };
}
function render(view, cases, selected) {
  return renderToStaticMarkup(
    createElement(CommandCenterViews, props(view, cases, selected)),
  );
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number"
    ? String(node)
    : "";
}
function resolveTree(node) {
  if (Array.isArray(node)) return node.map(resolveTree);
  if (!isValidElement(node)) return node;
  if (typeof node.type === "function")
    return resolveTree(node.type(node.props));
  return {
    ...node,
    props: { ...node.props, children: resolveTree(node.props.children) },
  };
}
function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  return [node, ...elements(node.props.children)];
}
function callbackTree(p) {
  hooks.reset();
  return resolveTree(CallbackTreeComponent(p));
}
function button(tree, label) {
  return elements(tree).find(
    (node) => node.type === "button" && text(node) === label,
  );
}
function recordedProps() {
  const p = props("leadership");
  p.records = JSON.parse(readFileSync(new URL("../../data/scripted/watershed_beta.json", import.meta.url), "utf8"));
  p.records.statewideIncidents = p.records.incidents;
  p.records.responseTasks = p.records.tasks;
  p.records.storyNow = "2026-10-13T08:30:00Z";
  p.reference = JSON.parse(readFileSync(new URL("../../data/reference.json", import.meta.url), "utf8"));
  return p;
}
test("recorded leadership sequence uses the timeline's formatted captured time", () => {
  const p = recordedProps();
  p.selected.eventSnapshot = { ...p.selected.eventSnapshot, timestamp: "2026-10-13T08:01:00Z", label: "Captured sequence marker" };
  const out = renderToStaticMarkup(createElement(CommandCenterViews, p));
  const sequence = out.match(/<details class="sc-brief-sequence">[\s\S]*?<\/details>/)?.[0];
  assert.ok(sequence);
  assert.match(sequence, /03:01 CT Captured sequence marker/);
});
test("recorded leadership case preview changes only the local summary and full-case target", () => {
  hooks.clear();
  const p = recordedProps();
  const closed = p.records.statewideIncidents.find((row) => row.status === "closed");
  assert.ok(closed);
  const before = JSON.stringify({ data: p.data, records: p.records, incidents: p.incidents });
  const selected = p.selected;
  const calls = [];
  p.onSelect = (...args) => calls.push(["select", ...args]);
  p.onOpenAnalyst = (...args) => calls.push(["open", ...args]);
  const previewList = (tree) => elements(tree).find((node) => node.props.className === "sc-brief-case-list");
  const treeBefore = callbackTree(p);
  const narrative = elements(treeBefore).find((node) => node.props.className === "sc-brief-sequence");
  const preview = elements(previewList(treeBefore)).find((node) => node.type === "button" && text(node).includes(closed.id));
  assert.ok(preview);
  preview.props.onClick();
  const treeAfter = callbackTree(p);
  const summary = elements(treeAfter).find((node) => node.props["aria-label"] === "Read-only summary");
  assert.match(text(summary), new RegExp(closed.id));
  const selectedButton = elements(previewList(treeAfter)).find((node) => node.type === "button" && node.props.className === "selected");
  assert.ok(text(selectedButton).includes(closed.id));
  assert.equal(p.selected, selected);
  assert.equal(text(elements(treeAfter).find((node) => node.props.className === "sc-brief-sequence")), text(narrative));
  assert.deepEqual(calls, []);
  assert.equal(JSON.stringify({ data: p.data, records: p.records, incidents: p.incidents }), before);
  const original = elements(previewList(treeBefore)).find((node) => node.type === "button" && node.props.className === "selected");
  assert.ok(original);
  original.props.onClick();
  button(callbackTree(p), "Open full case file").props.onClick();
  assert.deepEqual(calls, [["open", "case-file", selected.id]]);
});
test("recorded leadership renders an absent case status as unknown", () => {
  const p = recordedProps();
  p.records.statewideIncidents.push({ id: "status-absent", title: "Case with no recorded status", severity: "low" });
  const out = renderToStaticMarkup(createElement(CommandCenterViews, p));
  const list = out.match(/<nav class="sc-brief-case-list"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(list);
  assert.match(list, /status-absent[\s\S]*?>unknown<\/span>/);
});
test("command summary and full-record target follow picker changes and explicit clear", () => {
  for (const view of ["command", "leadership"]) {
    hooks.clear();
    const cases = [incident("case-a", "Case A"), incident("case-b", "Case B")];
    const p = props(view, cases, cases[0]);
    p.onSelect = (id) => {
      p.selected = cases.find((record) => record.id === id) ?? null;
    };
    const opened = [];
    p.onOpenAnalyst = (...args) => opened.push(args);
    let tree = callbackTree(p);
    button(tree, "Case A").props.onClick();
    tree = callbackTree(p);
    p.selected = cases[1];
    tree = callbackTree(p);
    const summary = elements(tree).find(
      (node) => node.props["aria-label"] === "Case summary · read-only",
    );
    assert.match(text(summary), /Case B/);
    assert.doesNotMatch(text(summary), /Case A/);
    button(tree, "Open full case file").props.onClick();
    assert.deepEqual(opened, [["case-file", "case-b"]]);
    p.selected = null;
    assert.equal(button(callbackTree(p), "Open full case file"), undefined);
  }
});
test("dismissing summary hides only current selection; a later selection can reopen it", () => {
  hooks.clear();
  const cases = [incident("case-a", "Case A"), incident("case-b", "Case B")];
  const p = props("command", cases, cases[0]);
  button(callbackTree(p), "Close summary").props.onClick();
  assert.equal(button(callbackTree(p), "Open full case file"), undefined);
  p.selected = cases[1];
  assert.ok(button(callbackTree(p), "Open full case file"));
  p.selected = cases[0];
  assert.ok(button(callbackTree(p), "Open full case file"));
});

test("all seven real-record views SSR without inputs, forms or editable checklists", () => {
  const cases = [incident()];
  const before = structuredClone(cases);
  for (const view of views) {
    const html = render(view, cases);
    assert.match(html, /command-center-views/);
    assert.doesNotMatch(html, /<(input|textarea|select|form)\b/i, view);
    assert.doesNotMatch(
      html,
      /type="checkbox"|contenteditable|Start incident|Record advisory review|Save coordination note/i,
      view,
    );
  }
  assert.deepEqual(cases, before);
});

test("all seven views render honest empty states from actual empty Bootstrap shape", () => {
  const empty = {
    ...data,
    entities: [],
    dependencies: [],
    events: [],
    assessments: [],
  };
  for (const view of views) {
    const html = renderToStaticMarkup(
      createElement(CommandCenterViews, { ...props(view, []), data: empty }),
    );
    assert.doesNotMatch(html, /<(input|textarea|select|form)\b/i);
    assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  }
});

test("C1 and C5 update from alternate saved records, not screen demo values", () => {
  const cases = [
    incident("alternate-one", "Alternate captured incident"),
    incident("alternate-two", "Another real saved case", false),
  ];
  cases[0].tasks[0].label = "Alternate task label";
  cases[1].tasks[0].completed = true;
  assert.match(render("command", cases), /Alternate captured incident/);
  assert.match(render("command", cases), /Another real saved case/);
  assert.match(render("command", cases), /Analyst opened this saved case/);
  const html = render("uctf", cases);
  assert.match(html, /Alternate task label/);
  assert.match(html, /Recorded complete/);
  assert.match(html, /No teams deployed for this incident\./);
  assert.doesNotMatch(html, /CIRU Alpha|En route|Teams committed|ETA /);
});

test("C2 is infrastructure only, and does not turn alert labels into utility status", () => {
  const html = render("cop");
  assert.match(html, /Infrastructure Schematic/);
  assert.doesNotMatch(
    html,
    /Dosing PLC A|network identity|Show ownership|Search|Filter/,
  );
  assert.match(html, /Reference record/);
  assert.match(html, /Case context/);
});

test("C1/C2 map markers are selectable controls, not a flattened image", () => {
  for (const view of ["command", "cop"]) {
    const html = render(view);
    assert.match(html, /data-infrastructure-map/);
    assert.match(html, /role="button"[^>]*tabindex="0"/);
    assert.match(html, /aria-label="Select Treatment Plant A/);
    assert.match(html, /aria-label="Zoom in infrastructure map"/);
    assert.match(html, /aria-label="Infrastructure details"/);
  }
});

test("All incidents retains modeled highlights instead of turning every marker gray", () => {
  const html = render("command", [incident()], null);
  assert.match(html, /data-impact-count="1"/);
});

test("C3 is sourced plain-text evidence with captured anchor and explicit missing judgments", () => {
  const html = render("cyber");
  assert.match(html, /Captured case event/);
  assert.match(html, /simulated/);
  assert.match(html, /Controller session at Utility A/);
  assert.match(html, /CTIC analyst assessment/);
  assert.match(html, /No additional attack assessments recorded\./);
  assert.doesNotMatch(html, /Campaign cluster|ATTACK ACTIVE|COMPROMISED/);
});

test("C4 captured graph displays source records, not current-baseline facility labels or scores", () => {
  const html = render("consequence");
  assert.match(html, /Captured facility name/);
  assert.match(html, /IDT sector 10/);
  assert.match(html, /2–4 h/);
  assert.match(html, /Captured assumption/);
  assert.match(html, /Show IDT sector 10/);
  assert.doesNotMatch(html, /0–100|risk score|Dialysis Center X/);
  const noRun = render("consequence", [incident("no-run", "No run", false)]);
  assert.match(noRun, /No captured consequence run/);
  assert.doesNotMatch(noRun, /Captured Dependency Network/);
});

test("C6 exports are formatted local draft downloads, and includes closed cases", () => {
  const closed = incident("closed", "Historical closed case");
  closed.status = "closed";
  const html = render("leadership", [incident(), closed]);
  assert.match(html, /Historical closed case/);
  assert.match(html, /Brief for the Governor/);
  assert.match(html, /data:text\/markdown/);
  assert.match(html, /download="sitrep-draft.md"/);
  assert.match(html, /No approve or dispatch buttons here\./);
  assert.match(
    html,
    /The duty officer records the Chief&#x27;s decision in the Analyst workspace\./,
  );
});

test("C7 previews and notes never invent contact records or operational statuses", () => {
  const html = render("federation");
  assert.match(html, /No partner coordination records\./);
  assert.match(html, /CITRIDE does not send notifications/);
  for (const category of ["internal", "water", "health", "federal"])
    assert.ok(html.includes(`<h3>${category}</h3>`)); // No authored reference titles were supplied to this fallback fixture.
  assert.doesNotMatch(html, /CONTACTED|ON STANDBY|WAITING ON CHIEF/);
});

test("C1/C6 summary callback tree opens the exact selected case in Analyst", () => {
  for (const view of ["command", "leadership"]) {
    hooks.clear();
    const cases = [incident(), incident("case-b", "Case B captured record")];
    const p = props(view, cases, null);
    const opened = [];
    p.onSelect = (id) => {
      p.selected = cases.find((record) => record.id === id);
    };
    p.onOpenAnalyst = (...args) => opened.push(args);
    let tree = callbackTree(p);
    const row = button(tree, cases[1].title);
    assert.ok(row);
    row.props.onClick();
    tree = callbackTree(p);
    assert.match(text(tree), /Case Summary · Read-only/);
    button(tree, "Open full case file").props.onClick();
    assert.deepEqual(opened, [["case-file", "case-b"]]);
    button(tree, "Close summary").props.onClick();
    assert.equal(button(callbackTree(p), "Open full case file"), undefined);
  }
});

test("C4 graph callback tree drills into captured sector and back without record mutation", () => {
  hooks.clear();
  const p = props("consequence");
  const before = structuredClone(p.incidents);
  let tree = callbackTree(p);
  const node = elements(tree).find(
    (element) => element.type === "g" && element.props.role === "button",
  );
  assert.ok(node);
  node.props.onClick();
  tree = callbackTree(p);
  assert.ok(button(tree, "← All sectors"));
  assert.match(text(tree), /Captured facility name/);
  button(tree, "← All sectors").props.onClick();
  tree = callbackTree(p);
  assert.equal(button(tree, "← All sectors"), undefined);
  assert.ok(
    elements(tree).some(
      (element) => element.type === "g" && element.props.role === "button",
    ),
  );
  assert.deepEqual(p.incidents, before);
});

test("owned component has no API, persistence, mutation callback or editable DOM dependency", () => {
  const parsed = parseSync("CommandCenterViews.tsx", source, { lang: "tsx" });
  assert.deepEqual(parsed.errors, []);
  const forbidden = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (
      (node.type === "JSXOpeningElement" ||
        node.type === "JSXSelfClosingElement") &&
      /^(input|textarea|select|form)$/.test(node.name?.name)
    )
      forbidden.push(node.name.name);
    if (
      (node.type === "Identifier" || node.type === "JSXIdentifier") &&
      /^(fetch|XMLHttpRequest|localStorage|sessionStorage|onNote|onAction|onMutate|onSubmit|onChange|contentEditable)$/.test(
        node.name,
      )
    )
      forbidden.push(node.name);
    Object.values(node).forEach(visit);
  }
  visit(parsed.program);
  assert.deepEqual(forbidden, []);
  assert.doesNotMatch(
    source,
    /from ["']\.\/(api|CommandCasework|TexasInfrastructureMap)["']/,
  );
});

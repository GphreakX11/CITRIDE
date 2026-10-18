import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";

const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const data = read("../../data/scenario.json");
const reference = read("../../data/reference.json");
const supplied = read("../../data/scripted/watershed_beta.json");
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = match[1];
    imports.set(
      spec,
      spec.startsWith(".") && spec.endsWith(".tsx")
        ? await compile(new URL(spec, url))
        : spec.startsWith(".")
          ? new URL(/\.[cm]?[jt]s$/.test(spec) ? spec : `${spec}.ts`, url).href
          : import.meta.resolve(spec),
    );
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_m, spec) => `from ${JSON.stringify(imports.get(spec))}`,
  );
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, result);
  return result;
}
const Component = (
  await import(
    await compile(new URL("../src/CommandCenterViews.tsx", import.meta.url))
  )
).default;
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const incident = {
  id: "wording-case",
  version: 1,
  title: "Captured wording case",
  status: "open",
  priority: "high",
  createdAt: "2026-10-13T08:00:00Z",
  updatedAt: "2026-10-13T08:10:00Z",
  eventId: data.events[0].id,
  eventSnapshot: structuredClone(data.events[0]),
  contextSnapshot: {
    event: data.events[0],
    provider: data.entities.find((e) => e.id === "utility-a"),
    serviceArea: data.entities.find((e) => e.id === "area-a"),
    warnings: ["Captured context warning"],
    sourceRefs: ["src-network"],
    downstreamDependencies: [],
    scenarios: [],
  },
  tasks: [{ id: "t", label: "Captured task", completed: false }],
  decisions: [],
  notes: [],
  activity: [],
  runId: "wording-run",
  runSnapshot: {
    id: "wording-run",
    modelVersion: data.modelVersion,
    baselineRevision: data.baselineRevision,
    createdAt: "2026-10-13T08:01:00Z",
    baselineSnapshot: structuredClone(data),
    seed: { provider: "utility-a", sourceRefs: [], eventRefs: [] },
    warnings: ["Captured run warning"],
    excluded: [],
    impacts: [
      {
        id: "impact",
        entityId: "dialysis-x",
        functionId: "dialysis-treatment",
        state: "at_risk",
        windowHours: [2, 4],
        paths: [],
        sourceRefs: ["src-network"],
        assumptions: ["Captured wording assumption"],
        evidenceStatus: "modeled",
        timingStatus: "interval",
      },
    ],
  },
};
const views = [
  "command",
  "cop",
  "cyber",
  "consequence",
  "uctf",
  "leadership",
  "federation",
];
const decisionNote =
  "No approve or dispatch buttons here. The duty officer records the Chief's decision in the Analyst workspace.";
const forbidden =
  /not supplied|not automatically linked|not outage or attribution judgments|not a certified audit|authority is not configured|policy gates|not an access-control|consent and delivery are not configured|does not establish normal|not asserted unaffected|no geographic overlay|not real locations|not geographic boundaries|not dispatch instructions|not delivery receipts|not live countdowns|not observed exposure|not confirmed dispatch|not confirmed recovery|not a normal-status assertion|not deployment locations|Official TXCC performance|current case contract/i;
function render(view, scripted, empty = false) {
  const r = structuredClone(supplied);
  r.statewideIncidents = empty ? [] : r.incidents;
  r.responseTasks = r.tasks;
  r.now = "2026-10-13T08:30:00Z";
  if (!empty) {
    r.statewideIncidents[0].caseId = incident.id;
    r.statewideIncidents[0].status = "open";
  }
  if (empty)
    for (const key of [
      "teams",
      "assessments",
      "hunts",
      "assetStatuses",
      "contacts",
      "decisions",
      "partnerProducts",
    ])
      r[key] = [];
  const props = freeze({
    data: empty
      ? { ...data, entities: [], dependencies: [], events: [], assessments: [] }
      : structuredClone(data),
    incidents: empty ? [] : [structuredClone(incident)],
    selected: empty ? null : structuredClone(incident),
    view,
    ...(scripted ? { records: r, reference: structuredClone(reference) } : {}),
    onSelect() {},
    onOpenAnalyst() {},
    onNavigate() {},
  });
  const before = JSON.stringify(props);
  const html = renderToStaticMarkup(createElement(Component, props));
  assert.equal(
    JSON.stringify(props),
    before,
    "SSR must not mutate captured inputs",
  );
  if (scripted && view === "cop") {
    assert.doesNotMatch(html, /<(textarea|select|form)\b/i);
    const inputs = html.match(/<input\b[^>]*>/g) || [];
    assert.ok(inputs.every(input => /type="search"/.test(input)), "C2 permits read-only search controls, never editing forms");
  } else assert.doesNotMatch(html, /<(input|textarea|select|form)\b/i);
  // Download bytes and collapsed Sources retain their existing provenance and export contract.
  const wall = html
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  return { html, wall };
}
for (const scripted of [false, true])
  for (const empty of [false, true])
    for (const view of views) {
      test(`${scripted ? "recorded" : "fallback"} ${view} ${empty ? "absent data" : "captured data"}: concise Command wall`, () => {
        const { html, wall } = render(view, scripted, empty);
        assert.doesNotMatch(wall, forbidden);
        assert.doesNotMatch(html, /NaN|undefined|Infinity/);
        assert.equal(
          (html.match(/<h1\b/g) || []).length,
          0,
          "App owns the page heading",
        );
        if (view === "leadership")
          assert.equal(wall.split(decisionNote).length - 1, 1);
        if (view === "federation")
          assert.equal(
            wall.split("CITRIDE does not send notifications").length - 1,
            1,
          );
        if (view === "cyber") assert.match(wall, /CTIC analyst assessment/);
        if (!empty && view === "consequence") {
          assert.match(wall, /Modeled · not observed outages/);
          assert.match(html, /Captured wording assumption/);
          assert.match(html, /Captured run warning/);
        }
        if (!scripted && !empty && ["command", "leadership"].includes(view))
          assert.match(html, /Captured context warning/);
        if (!scripted && view === "uctf")
          assert.match(wall, /No teams deployed for this incident\./);
        if (!empty && view === "federation") {
          assert.match(wall, /Draft · not sent/);
          assert.doesNotMatch(wall, /Illustrative audience preview/);
        }
      });
    }

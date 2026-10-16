import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import { networkSource } from "../src/networkEvidence.ts";
const root = new URL("../src/", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url)),
);
const reference = JSON.parse(
  readFileSync(new URL("../../data/reference.json", import.meta.url)),
);
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = match[1];
    let target = import.meta.resolve("react");
    if (spec.startsWith(".")) {
      let relative = new URL(spec, url);
      if (!existsSync(relative))
        relative = [".ts", ".tsx"]
          .map((ext) => new URL(spec + ext, url))
          .find(existsSync);
      target = await compile(relative);
    } else target = import.meta.resolve(spec);
    imports.set(spec, target);
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_, spec) => `from ${JSON.stringify(imports.get(spec))}`,
  );
  const out = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, out);
  return out;
}
const load = async (name) => import(await compile(new URL(name, root)));
const render = (Component, props) =>
  renderToStaticMarkup(createElement(Component, props));
const noop = () => {};
const event = data.events.find((e) => e.id === "event-dosing");
const run = {
  id: "wording-run",
  scenarioId: data.scenarios[0].id,
  createdAt: "2026-10-14T12:00:00Z",
  request: {
    scenarioId: data.scenarios[0].id,
    evaluationHour: 0,
    horizonHours: 12,
    overrides: [],
  },
  baselineRevision: data.baselineRevision,
  modelVersion: data.modelVersion,
  baselineSnapshot: data,
  seed: data.scenarios[0].seed,
  impacts: [
    {
      id: "wording-impact",
      entityId: "dialysis-x",
      functionId: "dialysis-treatment",
      lossType: "unsafe_treated_water",
      state: "at_risk",
      windowHours: [2, 4],
      lossOfFunction: 1,
      evidenceStatus: "modeled",
      timingStatus: "interval",
      paths: [["dep-a-x"]],
      sourceRefs: [],
      assumptions: ["Captured reserve"],
    },
  ],
  excluded: [],
  warnings: [],
};
const incident = {
  id: "wording-case",
  version: 7,
  title: "Captured case",
  status: "open",
  priority: "high",
  eventId: event.id,
  eventSnapshot: event,
  runId: run.id,
  runSnapshot: run,
  contextSnapshot: {
    scenarios: [data.scenarios[0]],
    sourceRefs: [],
    warnings: [],
  },
  decisions: [],
  tasks: [],
  notes: [],
  activity: [],
};
const forbidden = {
  "CommandReadouts.tsx":
    /not supplied|not confirmation that|Formal authority \/ policy gates:|Live OT feeds and partner notification|No official TXCC|No roster or duty assignment is invented|not an execution order/,
  "CommandCasework.tsx":
    /This creates one immutable modeled analysis|Reviewed means app review only|Conditional modeled consequences; not observed failures/,
  "AnalystEntityProfile.tsx":
    /Impacts remain modeled, not observed|this view does not load the scenario/,
  "PrototypeCaseViews.tsx":
    /These previews demonstrate field filtering|never observed outages|These reference options do not dispatch/,
  "AnalystConsequences.tsx":
    /This is modeled, not an observed outage|Absence of a result is not|unaffected facilities are not|does not validate model completeness/,
  "ScriptedAnalystViews.tsx":
    /CITRIDE does not send notifications|Draft — not sent/,
  "NetworkEvidence.tsx":
    /No substitute records are supplied|No case-linked events supplied|Probes link B and C to the campaign/,
};
for (const [file, pattern] of Object.entries(forbidden))
  test(`${file}: no redundant boundary paragraphs`, () =>
    assert.doesNotMatch(read(file), pattern));
test("A1 exact rule remains once, owned by Alerts; global sample notice stays out of analyst cards", () => {
  const sentence =
    "Alerts never become cases on their own; an analyst opens the case.";
  const files = ["AnalystAlerts.tsx", ...Object.keys(forbidden)];
  assert.equal(files.map(read).join("\n").split(sentence).length - 1, 1);
  for (const file of Object.keys(forbidden))
    assert.doesNotMatch(
      read(file),
      /Sample data · not connected to live systems/,
    );
});
test("A4 SSR: consequence/advisory labels and single planning estimate remain with live values and controls", async () => {
  const { default: Component } = await load("AnalystConsequences.tsx");
  const html = render(Component, {
    data,
    incident,
    reference,
    onAnalyze: noop,
    onOpenLab: noop,
    onMutate: noop,
    busy: false,
    uncertain: false,
  });
  assert.match(html, /Modeled · not observed outages/);
  assert.match(html, /Advisory, not approvals/);
  assert.equal(
    html.split("Planning estimate from scenario assumptions").length - 1,
    1,
  );
  for (const text of [
    "Dialysis",
    "2–4",
    "Run analysis",
    "Try a what-if",
    "Open full scenario lab",
  ])
    assert.ok(html.includes(text), text);
});
test("A4 SSR: genuine missing results use one-line empty states", async () => {
  const { default: Component } = await load("AnalystConsequences.tsx");
  const html = render(Component, {
    data,
    incident: { ...incident, runId: null, runSnapshot: null },
    reference,
    onAnalyze: noop,
    onOpenLab: noop,
    onMutate: noop,
    busy: false,
    uncertain: false,
  });
  for (const phrase of [
    "No captured modeled impacts.",
    "No explicit excluded paths captured.",
    "No captured model-review flags.",
  ])
    assert.ok(html.includes(phrase), phrase);
  assert.doesNotMatch(
    html,
    /unaffected assertion|validate model completeness|unaffected facilities are not inferred/,
  );
});
test("prototype SSR: exports are draft-labeled once without losing audience controls", async () => {
  const { default: Component } = await load("PrototypeCaseViews.tsx");
  const html = render(Component, {
    incident,
    reference,
    view: "federation",
    onNote: noop,
    onOpenLab: noop,
    locked: false,
  });
  assert.equal(html.split("Draft · not sent").length - 1, 1);
  for (const label of [
    "Water-sector partners",
    "Download draft Markdown",
    "Download draft JSON",
    "Not shown",
  ])
    assert.ok(html.includes(label));
});
test("grounded service semantics, origin provenance, frozen confirmation and recovery remain", () => {
  assert.match(
    read("PrototypeCaseViews.tsx"),
    /Unsafe water alone does not establish fire-flow loss/,
  );
  assert.match(
    read("PrototypeCaseViews.tsx"),
    /pressure-dependent paths remain excluded/,
  );
  assert.match(
    read("AnalystEntityProfile.tsx"),
    /dependencyRows\(model\.suppliers, true\)/,
  );
  assert.match(
    read("relationshipStory.ts"),
    /no service dependency is recorded/,
  );
  assert.equal(
    networkSource({ id: "corelight/conn" }, { origin: "simulated" }),
    "Network · Corelight format (simulated)",
  );
  const source = read("CommandCasework.tsx");
  for (const value of [
    "<ConfirmDialog",
    "confirmation.action",
    "confirmation.version",
    "confirmation.caseId",
    "onCancel={() => setConfirmation(null)}",
    "confirmDisabled=",
    "onRetryPending",
  ])
    assert.ok(source.includes(value), value);
  assert.match(source, /<p>Advisory, not approvals<\/p>/);
  assert.match(
    read("ScriptedAnalystViews.tsx"),
    /Suggested -- cyber SME to confirm/,
  );
  assert.match(read("ScriptedAnalystViews.tsx"), /Potential, not observed/);
  assert.match(read("ScriptedAnalystViews.tsx"), /Save outcome uncertain/);
});

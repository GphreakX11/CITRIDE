import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";

const root = new URL("../src/", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const data = read("../../data/scenario.json");
const supplied = read("../../data/scripted/watershed_beta.json");
const reference = read("../../data/reference.json");
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (await transformWithOxc(readFileSync(url, "utf8"), url.pathname, { jsx: { runtime: "automatic" } })).code
    .replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    let target;
    if (m[1].startsWith(".")) {
      let next = new URL(m[1], url);
      if (!existsSync(next)) next = new URL(`${m[1]}.ts`, url);
      target = await compile(next);
    } else target = import.meta.resolve(m[1]);
    imports.set(m[1], target);
  }
  code = code.replace(/from\s+["']([^"']+)["']/g, (_, s) => `from ${JSON.stringify(imports.get(s))}`);
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, result);
  return result;
}
const module = async (name) => import(await compile(new URL(name, root)));
const { consequenceModel } = await module("commandCenterModel.ts");
const { default: Network } = await module("components/DependencyNetwork.tsx");
const { default: Command } = await module("CommandCenterViews.tsx");
const { default: Scripted, Schematic } = await module("ScriptedCommandViews.tsx");
const html = (component, props) => renderToStaticMarkup(createElement(component, props));
const freeze = (value) => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function incident() {
  const run = {
    id: "wall-run", createdAt: "2026-10-13T08:09:00Z", scenarioId: "unsafe-water",
    request: { scenarioId: "unsafe-water", evaluationHour: 1, horizonHours: 12, overrides: [] },
    baselineRevision: data.baselineRevision, modelVersion: data.modelVersion,
    baselineSnapshot: structuredClone(data), seed: data.scenarios.find((s) => s.id === "unsafe-water").seed,
    impacts: [["nursing-z", "nursing-safe-water", [2, 5], "dep-a-z"], ["dialysis-x", "dialysis-treatment", [3, 7], "dep-a-x"], ["hospital-y", "hospital-sterilization", [5, 9], "dep-a-y"]].map(([entityId, functionId, windowHours, dep]) => ({
      id: entityId, entityId, functionId, windowHours, lossType: "unsafe_treated_water", state: "at_risk", lossOfFunction: 1,
      evidenceStatus: "modeled", timingStatus: "interval", paths: [[dep]], sourceRefs: ["src-inventory"], assumptions: ["Captured reserve"],
    })), excluded: [{ dependencyId: "dep-a-f", reason: "loss type is not applicable", path: ["dep-a-f"] }], warnings: [],
  };
  return { id: "case-wall", title: "Wall case", status: "open", priority: "high", version: 1,
    createdAt: "2026-10-13T08:00:00Z", updatedAt: "2026-10-13T08:10:00Z", eventId: data.events[0].id,
    eventSnapshot: data.events[0], contextSnapshot: { provider: data.entities.find((e) => e.id === "utility-a"), serviceArea: data.entities.find((e) => e.id === "area-a"), warnings: [], sourceRefs: [], scenarios: [] },
    runId: run.id, runSnapshot: run, decisions: [], tasks: [], notes: [], activity: [] };
}
function records() {
  const r = structuredClone(supplied);
  r.statewideIncidents = r.incidents;
  r.statewideIncidents[0].caseId = "case-wall";
  r.statewideIncidents[0].status = "open";
  r.responseTasks = r.tasks;
  r.storyNow = "2026-10-13T08:30:00Z";
  return r;
}
function props(view, r = records(), saved = incident()) {
  return { data, records: r, reference, incidents: [saved], selected: saved, view, onSelect() {}, onOpenAnalyst() {}, onNavigate() {} };
}

test("C4 has four record-bound summary tiles, including reference boil-water state", () => {
  const out = html(Command, props("consequence"));
  assert.match(out, /People in affected water service/);
  assert.match(out, /Critical facilities at risk/);
  assert.match(out, /Boil-water notice/);
  assert.match(out, /Possible/);
  assert.doesNotMatch(out, /Captured result groups/);
});
test("C4 timeline bars use exact captured windowHours, never subtract evaluation hour", () => {
  const saved = freeze(incident());
  const out = html(Network, { model: consequenceModel(saved), mode: "display" });
  assert.match(out, /class="cc-planning-timeline"/);
  assert.match(out, /data-window-start="2" data-window-end="5"/);
  assert.match(out, /left:16\.666666666666664%;width:25%/);
  for (const tick of ["0 h", "3 h", "6 h", "9 h", "12 h"]) assert.ok(out.includes(tick));
  assert.match(out, /not countdowns/);
});
test("C4 sector table includes the source, affected healthcare and explicitly excluded emergency dependency", () => {
  const out = html(Network, { model: consequenceModel(freeze(incident())), mode: "display", boilWaterLabel: "Boil-water notice: possible" });
  const table = out.match(/<table[^>]*class="[^"]*cc-sector-rollup[\s\S]*?<\/table>/)?.[0];
  assert.ok(table);
  assert.match(table, /Water \(12\)/);
  assert.match(table, /Healthcare and Public Health \(10\)/);
  assert.match(table, /Emergency Services \(6\)/);
  assert.match(table, /0 of 1/);
  assert.match(table, /loss type is not applicable/);
  assert.doesNotMatch(table, /Energy/);
});
test("C4 table does not declare an unmodeled dependency unaffected without explicit exclusion proof", () => {
  const saved = incident(); saved.runSnapshot.excluded = [];
  const out = html(Network, { model: consequenceModel(freeze(saved)), mode: "display" });
  const table = out.match(/<table[^>]*class="[^"]*cc-sector-rollup[\s\S]*?<\/table>/)?.[0];
  assert.match(table, /unaffected not established/);
});
test("C1 stacks map and active register beside decision support; closed records remain available on the brief only", () => {
  const out = html(Scripted, props("command"));
  assert.match(out, /class="sc-overview-layout"/);
  assert.match(out, /class="sc-overview-main"/);
  assert.match(out, /class="sc-overview-sidebar"/);
  assert.match(out, /Decisions waiting on the Chief/);
  assert.match(out, /Critical facilities at risk/);
  assert.match(out, /From the analysts/);
  const active = out.match(/<table[^>]*data-register="active"[\s\S]*?<\/table>/)?.[0];
  assert.ok(active);
  assert.doesNotMatch(active, /TX-26-0398/);
  assert.doesNotMatch(out, /TX-26-0398/);
  assert.match(html(Scripted, props("leadership")), /TX-26-0398/);
  assert.doesNotMatch(out, /\d+ minutes/);
});
test("C1 active register keeps the open Watershed case first, then severity and recorded start", () => {
  const r = records();
  r.statewideIncidents.push({ id: "early-high", title: "Earlier high severity", status: "open", severity: "high", startedAt: "2026-10-13T05:00:00Z", location: { label: "Authored" } });
  const out = html(Scripted, props("command", freeze(r)));
  const active = out.match(/<table[^>]*data-register="active"[\s\S]*?<\/table>/)?.[0];
  assert.ok(active.indexOf("Water utility cyber attack") < active.indexOf("Earlier high severity"));
  assert.equal((active.match(/<tr/g) ?? []).length, r.statewideIncidents.filter((row) => row.status !== "closed").length + 1);
});
test("C1 pending count remains computed and source population is shown before modeling", () => {
  const r = records(); const saved = incident(); saved.runId = null; saved.runSnapshot = null;
  const before = html(Scripted, props("command", r, saved));
  assert.match(before, /18,000/);
  assert.match(before, /Not yet modeled/);
  r.decisions = reference.responseOptions.map((option) => ({ id: option.id, optionId: option.id, caseId: saved.id, decision: "approved" }));
  const after = html(Scripted, props("command", r, saved));
  assert.match(after, /<strong>0<\/strong><span>Decisions waiting on the Chief/);
});
test("Schematic uses a deterministic safe label grid and never mutates authored coordinates", () => {
  const items = freeze(Array.from({ length: 12 }, (_, index) => ({ id: `pin-${index}`, title: `Long authored incident label ${index}`, schematic: { x: 52, y: 58 } })));
  const before = JSON.stringify(items);
  const out = html(Schematic, { items, active: "pin-1", label: "Safe labels", onSelect() {} });
  assert.match(out, /class="sc-safe-labels"/);
  assert.equal((out.match(/data-label-anchor=/g) ?? []).length, items.length);
  assert.equal(JSON.stringify(items), before);
  assert.equal(out, html(Schematic, { items, active: "pin-1", label: "Safe labels", onSelect() {} }));
});

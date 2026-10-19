import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "./json-module-transform.mjs";

const root = new URL("../src/", import.meta.url);
const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url)),
);
const reference = JSON.parse(
  readFileSync(new URL("../../data/reference.json", import.meta.url)),
);
const hookUrl = `data:text/javascript;base64,${Buffer.from(`let v=[],i=0;export function reset(){i=0}export function clear(){v=[];i=0}export function useState(x){let n=i++;if(!(n in v))v[n]=typeof x==='function'?x():x;return [v[n],x=>v[n]=typeof x==='function'?x(v[n]):x]}export function useRef(x){return useState({current:x})[0]}`).toString("base64")}`;
const hooks = await import(hookUrl);
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
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const s = m[1];
    let target;
    if (s === "react") target = hookUrl;
    else if (s.startsWith(".")) {
      let u = new URL(s, url);
      if (!existsSync(u)) u = new URL(s + ".ts", url);
      target = await compile(u);
    } else target = import.meta.resolve(s);
    imports.set(s, target);
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_, s) => `from ${JSON.stringify(imports.get(s))}`,
  );
  const out = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, out);
  return out;
}
async function module(name) {
  return import(await compile(new URL(name, root)));
}

function impact(id, entityId, functionId, windowHours, dep) {
  return {
    id, entityId, functionId, lossType: "unsafe_treated_water", state: "at_risk",
    windowHours, lossOfFunction: 1, evidenceStatus: "modeled", timingStatus: "interval",
    paths: [[dep]], sourceRefs: ["src-inventory"], assumptions: ["Captured reserve"],
  };
}
function incident(scenario = "unsafe-water") {
  const s = data.scenarios.find((x) => x.id === scenario);
  const impacts =
    scenario === "unsafe-water"
      ? [
          impact("i-z", "nursing-z", "nursing-safe-water", [1, 4], "dep-a-z"),
          impact("i-x", "dialysis-x", "dialysis-treatment", [2, 4], "dep-a-x"),
          impact("i-y", "hospital-y", "hospital-sterilization", [4, 8], "dep-a-y"),
        ]
      : [];
  const run = {
    id: "run-1", createdAt: "2026-10-13T08:09:00Z", scenarioId: scenario,
    request: { scenarioId: scenario, evaluationHour: 1, horizonHours: 12, overrides: [] },
    baselineRevision: data.baselineRevision, modelVersion: data.modelVersion,
    baselineSnapshot: structuredClone(data), seed: s.seed, impacts,
    excluded: scenario === "unsafe-water"
      ? [{ dependencyId: "dep-a-f", reason: "loss type is not applicable", path: ["dep-a-f"] }]
      : [],
    warnings: [],
  };
  return { id: "case-a", version: 1, title: "Case", runId: run.id, runSnapshot: run };
}

test("overview links the source to every connected sector, not just impacted ones", async () => {
  const { consequenceModel } = await module("commandCenterModel.ts");
  const { consequenceGraph } = await module("sectorNetwork.ts");
  const g = consequenceGraph(consequenceModel(incident()), { boilWaterLabel: "Boil-water notice: possible" });
  const labels = g.overview.nodes.filter((n) => n.kind !== "source").map((n) => n.label);
  assert.deepEqual(new Set(labels), new Set(["Energy", "Water customers", "Healthcare and Public Health", "Emergency Services"]));
  const health = g.overview.nodes.find((n) => n.label === "Healthcare and Public Health");
  assert.equal(health.sub, "3 at risk · 1–4 h");
  assert.equal(health.tone, "red");
  const fire = g.overview.nodes.find((n) => n.label === "Emergency Services");
  assert.equal(fire.sub, "Not affected");
  assert.equal(fire.line, "dashed");
  const water = g.overview.nodes.find((n) => n.label === "Water customers");
  assert.match(water.sub, /18,000 people · boil-water possible/);
  const energy = g.overview.nodes.find((n) => n.label === "Energy");
  assert.equal(energy.sub, "Normal · upstream");
  for (const e of g.overview.edges) assert.ok(e.label && e.label !== "dependency", e.id);
  assert.equal(g.overview.edges.find((e) => e.from === energy.id).label, "electricity → water treatment");
  assert.ok(g.overview.edges.find((e) => e.to === fire.id).dashed);
});

test("drilling into healthcare shows the three facilities with windows and Facility Q dotted", async () => {
  const { consequenceModel } = await module("commandCenterModel.ts");
  const { consequenceGraph } = await module("sectorNetwork.ts");
  const g = consequenceGraph(consequenceModel(incident()));
  const health = g.overview.nodes.find((n) => n.label === "Healthcare and Public Health");
  const v = g.sectorView(health.sectorKey);
  const by = Object.fromEntries(v.nodes.map((n) => [n.id, n]));
  assert.equal(by["nursing-z"].sub, "At risk 1–4 h");
  assert.equal(by["dialysis-x"].sub, "At risk 2–4 h");
  assert.equal(by["hospital-y"].tone, "amber");
  assert.equal(by["facility-q"].line, "dotted");
  assert.equal(by["facility-q"].sub, "In area · no dependency");
  assert.ok(v.edges.every((e) => e.label), "every facility link is labeled");
  assert.equal(v.edges.find((e) => e.to === "dialysis-x").label, "dialysis treatment");
});

test("power loss puts energy at the source and water and healthcare downstream", async () => {
  const { consequenceModel } = await module("commandCenterModel.ts");
  const { consequenceGraph } = await module("sectorNetwork.ts");
  const g = consequenceGraph(consequenceModel(incident("power-loss")));
  assert.equal(g.overview.nodes[0].label, "Electric Supply E");
  const labels = g.overview.nodes.map((n) => n.label);
  assert.ok(labels.includes("Water"));
  assert.ok(labels.includes("Healthcare and Public Health"));
});

test("the C4 component draws the linked graph and keeps the inventory chart only as collapsed context", async () => {
  const { consequenceModel } = await module("commandCenterModel.ts");
  const { default: Network } = await module("components/DependencyNetwork.tsx");
  hooks.clear();
  const html = renderToStaticMarkup(
    createElement(Network, { model: consequenceModel(incident()), mode: "display" }),
  );
  assert.match(html, /Sector dependencies/);
  assert.match(html, /data-node="sector:idt:10"/);
  assert.match(html, /electricity → water treatment/);
  assert.ok(html.indexOf("Sector dependencies") < html.indexOf("Saved inventory"));
  assert.doesNotMatch(html, /<(input|select|form)\b/);
});

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
function run() {
  return {
    id: "captured-run",
    createdAt: "2026-10-14T12:00:00Z",
    scenarioId: "unsafe-water",
    request: {
      scenarioId: "unsafe-water",
      evaluationHour: 0,
      horizonHours: 12,
      overrides: [],
    },
    baselineRevision: data.baselineRevision,
    modelVersion: data.modelVersion,
    baselineSnapshot: structuredClone(data),
    seed: data.scenarios[0].seed,
    impacts: [
      {
        id: "impact-x",
        entityId: "dialysis-x",
        functionId: "dialysis-treatment",
        lossType: "unsafe_treated_water",
        state: "at_risk",
        windowHours: [2, 4],
        lossOfFunction: 1,
        evidenceStatus: "modeled",
        timingStatus: "interval",
        paths: [["dep-a-x"]],
        sourceRefs: ["src-inventory"],
        assumptions: ["Captured reserve"],
      },
    ],
    excluded: [
      {
        dependencyId: "dep-a-f",
        reason: "loss type is not applicable",
        path: [],
      },
    ],
    warnings: [],
  };
}
function incident() {
  const r = run();
  return {
    id: "case-a",
    version: 1,
    title: "Dosing case",
    runId: r.id,
    runSnapshot: r,
    eventId: data.events[0].id,
    eventSnapshot: data.events[0],
    contextSnapshot: {
      scenarios: [data.scenarios[0]],
      sourceRefs: [],
      warnings: [],
    },
    decisions: [
      {
        id: "decision-x",
        entityId: "dialysis-x",
        functionId: "dialysis-treatment",
        reviewed: false,
      },
    ],
    tasks: [],
    notes: [],
    activity: [],
  };
}
function text(n) {
  if (Array.isArray(n)) return n.map(text).join("");
  if (isValidElement(n)) return text(n.props.children);
  return typeof n === "string" || typeof n === "number" ? String(n) : "";
}
function resolve(n) {
  if (Array.isArray(n)) return n.map(resolve);
  if (!isValidElement(n)) return n;
  if (typeof n.type === "function") return resolve(n.type(n.props));
  return { ...n, props: { ...n.props, children: resolve(n.props.children) } };
}
function elements(n) {
  if (Array.isArray(n)) return n.flatMap(elements);
  if (!isValidElement(n)) return [];
  return [n, ...elements(n.props.children)];
}
function find(t, type, label) {
  return elements(t).find(
    (n) =>
      n.type === type && (text(n) === label || n.props["aria-label"] === label),
  );
}

test("exposure uses live reference rates, paired bounds, unknowns and matching requests", async () => {
  const { runExposure, exposureAvoided } = await module("exposure.ts");
  const base = run(),
    wi = structuredClone(base);
  wi.impacts[0].windowHours = [6, 8];
  assert.deepEqual(
    runExposure(base, reference.planningRates, reference.referenceVersion)
      .serviceHours,
    [8, 10],
  );
  assert.deepEqual(
    runExposure(base, reference.planningRates, reference.referenceVersion)
      .costUsd,
    [64000, 150000],
  );
  assert.deepEqual(
    exposureAvoided(
      base,
      wi,
      reference.planningRates,
      reference.referenceVersion,
    ),
    { serviceHours: [4, 4], costUsd: [32000, 60000] },
  );
  assert.equal(runExposure(base, [], "missing").costUsd, null);
  const unknown = structuredClone(base);
  unknown.impacts[0].windowHours = null;
  assert.deepEqual(
    runExposure(unknown, reference.planningRates, "v").notEstimated,
    [
      {
        entityId: "dialysis-x",
        functionId: "dialysis-treatment",
        reason: "unknown_timing",
      },
    ],
  );
  wi.request.evaluationHour = 1;
  assert.match(exposureAvoided(base, wi).incomparable, /evaluation/i);
});
test("shared graph keeps C4 rollups in both modes and expands recursively to Electric E", async () => {
  const { consequenceModel } = await module("commandCenterModel.ts");
  const { default: Network } = await module("components/DependencyNetwork.tsx");
  const { expandUpstream } = await module("dependencyNetwork.ts");
  const model = consequenceModel(incident());
  const expanded = expandUpstream(model, "dialysis-x");
  assert.deepEqual(
    new Set(expanded),
    new Set(["dialysis-x", "utility-a", "plant-a", "electric-e"]),
  );
  for (const mode of ["display", "explore"]) {
    hooks.clear();
    const html = renderToStaticMarkup(
      createElement(Network, { model, mode, idtIndex: null }),
    );
    assert.match(html, /By Sector/);
    assert.match(html, /Healthcare and Public Health/);
    assert.match(html, /Saved inventory sector context/);
    if (mode === "display") assert.doesNotMatch(html, /<(input|select|form)\b/);
  }
});
test("A4 callback actions, strict review fields, quick what-if and scenario changes preserve captured case", async () => {
  const { default: A4 } = await module("AnalystConsequences.tsx");
  hooks.clear();
  const captured = incident(),
    before = structuredClone(captured);
  const calls = {
    propose: [],
    map: [],
    entity: [],
    analyze: [],
    mutate: [],
    whatif: [],
  };
  const p = {
    data,
    incident: captured,
    reference,
    idtIndex: null,
    onAnalyze: (...a) => calls.analyze.push(a),
    onMutate: async (a) => calls.mutate.push(a),
    onOpenMap: (id) => calls.map.push(id),
    onOpenEntity: (id) => calls.entity.push(id),
    onPropose: (...a) => calls.propose.push(a),
    onOpenLab() {},
    onWhatIf: async (req) => {
      calls.whatif.push(req);
      const r = run();
      r.id = "separate-what-if";
      r.request = req;
      r.impacts[0].windowHours = [6, 8];
      return r;
    },
  };
  const tree = () => {
    hooks.reset();
    return resolve(A4(p));
  };
  let t = tree();
  find(t, "button", "Propose missing dependency").props.onClick();
  assert.deepEqual(calls.propose, [["dialysis-x", "dependent"]]);
  find(t, "button", "Open on A2 map").props.onClick();
  assert.deepEqual(calls.map, ["dialysis-x"]);
  find(t, "button", "Open entity profile").props.onClick();
  assert.deepEqual(calls.entity, ["dialysis-x"]);
  find(t, "select", "Analysis scenario").props.onChange({
    target: { value: "power-loss" },
  });
  find(tree(), "button", "Run analysis").props.onClick();
  assert.deepEqual(calls.analyze, [["power-loss", 12]]);
  find(tree(), "textarea", "Review note for dialysis-x").props.onChange({
    target: { value: "Confirmed assumptions with operator" },
  });
  await find(tree(), "button", "Record review").props.onClick();
  assert.deepEqual(calls.mutate, [
    {
      action: "review_decision",
      decisionId: "decision-x",
      note: "Confirmed assumptions with operator",
    },
  ]);
  find(tree(), "input", "Clean-water reserve hours").props.onChange({
    target: { value: "6" },
  });
  await find(tree(), "button", "Run separate what-if").props.onClick();
  t = tree();
  assert.deepEqual(calls.whatif, [
    {
      ...before.runSnapshot.request,
      overrides: [
        {
          dependencyId: "dep-a-x",
          backupMinHours: 6,
          backupMaxHours: 6,
          note: "What-if from case Dosing case",
        },
      ],
    },
  ]);
  assert.match(text(t), /32,000.*60,000/);
  assert.match(text(t), /Planning estimate from scenario assumptions/);
  assert.ok(text(t).includes(reference.referenceVersion));
  assert.deepEqual(captured, before);
});
test("exploration expands selected upstream nodes and never fabricates impacts or calls missing what-if API", async () => {
  const { default: A4 } = await module("AnalystConsequences.tsx");
  hooks.clear();
  const p = {
    data,
    incident: incident(),
    reference: null,
    idtIndex: null,
    onAnalyze() {},
    onMutate: async () => {},
    onOpenMap() {},
    onOpenEntity() {},
    onPropose() {},
    onOpenLab() {},
  };
  const tree = () => {
    hooks.reset();
    return resolve(A4(p));
  };
  let t = tree();
  find(t, "button", "Expand upstream of Dialysis Center X").props.onClick();
  t = tree();
  assert.match(text(t), /Electric Supply E/);
  assert.equal(find(t, "button", "Run separate what-if").props.disabled, true);
});
test("snapshot exploration toggles only captured context and handles upstream cycles", async () => {
  const { consequenceModel } = await module("commandCenterModel.ts");
  const { explorationNetwork, expandUpstream, quickWhatIfRequest } =
    await module("dependencyNetwork.ts");
  const captured = incident(),
    model = consequenceModel(captured),
    before = structuredClone(captured);
  assert.ok(!explorationNetwork(model).nodes.some((e) => e.id === "fire-f"));
  assert.ok(
    explorationNetwork(model, { showUnaffected: true }).nodes.some(
      (e) => e.id === "fire-f",
    ),
  );
  assert.ok(
    explorationNetwork(model, { ownership: true }).relations.some(
      (e) => e.kind === "ownership context",
    ),
  );
  assert.ok(
    explorationNetwork(model, {
      cyberLinks: true,
      expanded: expandUpstream(model, "dialysis-x"),
    }).relations.some((e) => e.kind === "cyber hosting context"),
  );
  assert.throws(
    () => quickWhatIfRequest(captured, "dep-e-plant", 6),
    /captured impacted/,
  );
  assert.throws(
    () => quickWhatIfRequest(captured, "dep-a-x", -1),
    /non-negative/,
  );
  assert.deepEqual(captured, before);
  model.captured.dependencies.push({
    ...model.captured.dependencies[0],
    id: "cycle",
    provider: "dialysis-x",
    dependent: "electric-e",
  });
  assert.equal(expandUpstream(model, "dialysis-x").length, 4);
});
test("A4 what-if fill, required notes, model failures and workflow guard", async () => {
  const { default: A4 } = await module("AnalystConsequences.tsx");
  hooks.clear();
  let requests = 0;
  const p = {
    data,
    incident: incident(),
    reference,
    idtIndex: null,
    onAnalyze() {},
    onMutate: async () => {
      throw Error("Review not saved");
    },
    onOpenMap() {},
    onOpenEntity() {},
    onPropose() {},
    onOpenLab() {},
    onWhatIf: async () => {
      requests++;
      throw Error("Run not saved");
    },
  };
  const tree = () => {
    hooks.reset();
    return resolve(A4(p));
  };
  let t = tree();
  assert.equal(find(t, "button", "Record review").props.disabled, true);
  find(t, "button", "Run a what-if on this").props.onClick();
  t = tree();
  assert.equal(find(t, "input", "Clean-water reserve hours").props.value, "2");
  find(t, "textarea", "Review note for dialysis-x").props.onChange({
    target: { value: "Keep this note on failure" },
  });
  await find(tree(), "button", "Record review").props.onClick();
  assert.match(text(tree()), /Review not saved/);
  assert.equal(
    find(tree(), "textarea", "Review note for dialysis-x").props.value,
    "Keep this note on failure",
  );
  await find(tree(), "button", "Run separate what-if").props.onClick();
  assert.equal(requests, 1);
  assert.match(text(tree()), /Run not saved/);
  p.uncertain = true;
  t = tree();
  assert.equal(find(t, "button", "Run analysis").props.disabled, true);
  assert.equal(find(t, "button", "Run separate what-if").props.disabled, true);
  assert.equal(find(t, "button", "Record review").props.disabled, true);
});

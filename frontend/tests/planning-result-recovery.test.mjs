import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { isValidElement } from "react";
import { transformWithOxc } from "./json-module-transform.mjs";

// Artifact-free hook-slot/handler tests, not DOM or browser acceptance.
const moduleUrl = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const hookUrl = moduleUrl(
  `let values=[],i=0;export function reset(){i=0}export function clear(){values=[];i=0}export function useState(x){let n=i++;if(!(n in values))values[n]=typeof x==='function'?x():x;return [values[n],x=>values[n]=typeof x==='function'?x(values[n]):x]}export function useRef(x){return useState({current:x})[0]}export function useMemo(fn){return fn()}export function useEffect(){}`,
);
const hooks = await import(hookUrl);
const root = new URL("../src/", import.meta.url);
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
      // Readouts' other screens are deliberately not tested by this harness.
      if (
        url.pathname.endsWith("CommandReadouts.tsx") &&
        /\.tsx$/.test(u.pathname) &&
        !u.pathname.endsWith("AnalystConsequences.tsx")
      ) {
        target = moduleUrl(
          `export default function ${s.split("/").at(-1).replace(".tsx", "")}(){return null}`,
        );
      } else if (
        url.pathname.endsWith("CommandReadouts.tsx") &&
        !existsSync(u)
      ) {
        target = moduleUrl(
          `export default function OtherScreen(){return null};export function IdtChip(){return null}`,
        );
      } else target = await compile(u);
    } else target = import.meta.resolve(s);
    imports.set(s, target);
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_, s) => `from ${JSON.stringify(imports.get(s))}`,
  );
  const out = moduleUrl(code);
  cache.set(url.href, out);
  return out;
}
const A4 = (
  await import(await compile(new URL("AnalystConsequences.tsx", root)))
).default;
const Readouts = (
  await import(await compile(new URL("CommandReadouts.tsx", root)))
).default;
const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url)),
);
const reference = JSON.parse(
  readFileSync(new URL("../../data/reference.json", import.meta.url)),
);
function fixture() {
  const base = {
    id: "captured-run",
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
        sourceRefs: [],
        assumptions: [],
      },
    ],
    excluded: [],
    warnings: [],
  };
  const incident = {
    id: "case-a",
    title: "Dosing case",
    runId: base.id,
    runSnapshot: base,
    contextSnapshot: { scenarios: [data.scenarios[0]] },
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
  const saved = structuredClone(base);
  saved.id = "reconciled-what-if";
  saved.request.overrides = [
    {
      dependencyId: "dep-a-x",
      backupMinHours: 6,
      backupMaxHours: 6,
      note: "What-if from case Dosing case",
    },
  ];
  saved.impacts[0].windowHours = [6, 8];
  const writes = [];
  const props = {
    data,
    incident,
    reference,
    idtIndex: null,
    onAnalyze: (...a) => writes.push(a),
    onMutate: async (a) => writes.push(a),
    onWhatIf: async (a) => {
      writes.push(a);
      throw Error("Lost response");
    },
    onOpenMap() {},
    onOpenEntity() {},
    onPropose() {},
    onOpenLab() {},
  };
  return { base, incident, saved, props, writes };
}
function nodes(n) {
  if (Array.isArray(n)) return n.flatMap(nodes);
  return isValidElement(n) ? [n, ...nodes(n.props.children)] : [];
}
function text(n) {
  if (Array.isArray(n)) return n.map(text).join("");
  return isValidElement(n)
    ? text(n.props.children)
    : typeof n === "string" || typeof n === "number"
      ? String(n)
      : "";
}
function find(n, type, label) {
  return nodes(n).find(
    (n) =>
      n.type === type && (text(n) === label || n.props["aria-label"] === label),
  );
}
function render(props) {
  hooks.reset();
  const child = A4(props);
  return child.type(child.props);
}
function graph(t) {
  return nodes(t).find((n) => n.type?.name === "DependencyNetwork");
}

test("Readouts routes the scoped Root planning result to A4, not the legacy display", () => {
  hooks.clear();
  const { props, saved } = fixture();
  const tree = Readouts({
    ...props,
    selected: props.incident,
    incidents: [],
    view: "consequence",
    lastPlanningRun: saved,
    workflowLocked: false,
  });
  assert.equal(tree.type, A4);
  assert.equal(tree.props.lastPlanningRun, saved);
});

test("lost-response explicit retry prop restores saved windows/exposure with no automatic write", async () => {
  hooks.clear();
  const { props, saved, incident, writes } = fixture();
  const before = structuredClone(incident);
  await find(render(props), "button", "Run separate what-if").props.onClick();
  assert.match(text(render(props)), /Lost response/);
  props.lastPlanningRun = saved; // Root's explicit same-request retry returned this real run.
  const t = render(props);
  assert.match(text(t), /Before \/ after · separate run reconciled-what-if/);
  assert.match(text(t), /2–4 h.*6–8 h/);
  assert.match(
    text(t),
    /Exposure avoided: 4\.0–4\.0 service-hours; \$32,000–\$60,000/,
  );
  assert.doesNotMatch(text(t), /Lost response/);
  assert.equal(writes.length, 1);
  assert.deepEqual(incident, before);
});

test("remount restores result and explicitly identifies saved facility/reserve despite changed draft", () => {
  const { props, saved, writes } = fixture();
  const other = data.dependencies.find(
    (d) => d.requiredService === "treated_water" && d.id !== "dep-a-x",
  );
  props.incident.runSnapshot.impacts.push({
    ...structuredClone(props.incident.runSnapshot.impacts[0]),
    id: "impact-other",
    entityId: other.dependent,
    paths: [[other.id]],
  });
  props.lastPlanningRun = saved;
  hooks.clear();
  let t = render(props);
  assert.match(text(t), /Before \/ after · separate run reconciled-what-if/);
  find(t, "input", "Clean-water reserve hours").props.onChange({
    target: { value: "9" },
  });
  find(t, "select", "What-if impacted facility").props.onChange({
    target: { value: other.id },
  });
  t = render(props);
  assert.match(text(t), /Saved what-if: Dialysis Center X.*6 hours/);
  assert.equal(
    find(t, "select", "What-if impacted facility").props.value,
    other.id,
  );
  assert.match(text(t), /Before \/ after/);
  hooks.clear();
  assert.match(text(render(props)), /6–8 h/);
  assert.deepEqual(writes, []);
});

test("incomparable overrides cannot restore against changed parameters, baseline, dependency or case", () => {
  for (const change of [
    (r) => {
      r.request.scenarioId = r.scenarioId = "power-loss";
    },
    (r) => {
      r.request.evaluationHour = 1;
    },
    (r) => {
      r.request.horizonHours = 24;
    },
    (r) => {
      r.baselineRevision = -1;
    },
    (r) => {
      r.modelVersion = "other";
    },
    (r) => {
      r.baselineSnapshot.entities[0].label = "Other baseline";
    },
    (r) => {
      r.baselineSnapshot = null;
    },
    (r) => {
      r.request.expectedBaselineRevision = -1;
    },
    (r) => {
      r.request.overrides[0].dependencyId = "dep-e-plant";
    },
    (r) => {
      r.request.overrides[0].note = "What-if from case Another case";
    },
  ]) {
    hooks.clear();
    const { props, saved, writes } = fixture();
    change(saved);
    props.lastPlanningRun = saved;
    const t = render(props);
    assert.doesNotMatch(text(t), /Before \/ after|Exposure avoided/);
    assert.equal(graph(t).props.model.run.id, "captured-run");
    assert.deepEqual(writes, []);
  }
  hooks.clear();
  const { props } = fixture();
  props.incident = {
    ...props.incident,
    id: "other-case",
    title: "Another case",
  };
  props.lastPlanningRun = null; // Root gates by origin case ID.
  assert.doesNotMatch(text(render(props)), /Before \/ after/);
});

test("alternate and repeated zero-override analyses update only the clearly labeled exploratory graph", () => {
  for (const scenarioId of ["power-loss", "unsafe-water"]) {
    hooks.clear();
    const { props, saved, incident, writes } = fixture();
    const before = structuredClone(incident);
    saved.id = `explore-${scenarioId}`;
    saved.request.overrides = [];
    saved.request.scenarioId = saved.scenarioId = scenarioId;
    saved.request.horizonHours = scenarioId === "power-loss" ? 24 : 12;
    props.lastPlanningRun = saved;
    const t = render(props);
    assert.match(text(t), /Exploratory graph · separate run explore-/);
    assert.equal(graph(t).props.model.run.id, saved.id);
    assert.equal(
      graph(t).props.onWhatIf,
      undefined,
      "An exploratory impact must not become a captured-facility what-if shortcut",
    );
    assert.equal(
      find(t, "button", "Run separate what-if").props.disabled,
      false,
    );
    assert.match(text(t), /Captured run captured-run.*12 hours/);
    assert.match(text(t), /within 2–4 h under the captured scenario/);
    assert.ok(find(t, "textarea", "Review note for dialysis-x"));
    assert.equal(
      find(t, "select", "What-if impacted facility").props.value,
      "dep-a-x",
    );
    assert.doesNotMatch(text(t), /Before \/ after|Exposure avoided/);
    assert.deepEqual(incident, before);
    assert.deepEqual(writes, []);
  }
});

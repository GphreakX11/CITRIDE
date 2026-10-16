import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { isValidElement } from "react";
import { transformWithOxc } from "vite";
import { potentialRequests } from "../src/whoActsFirst.ts";
const mod = (s) =>
  `data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
const hookUrl = mod(
  `let stores=new Map(),v=[],i=0,e=[];export const callbacks=[];export function clear(){stores.clear()}export function reset(k){if(!stores.has(k))stores.set(k,[]);v=stores.get(k);i=0;e=[];callbacks.length=0}export function useState(x){const a=v,n=i++;if(!(n in a))a[n]=typeof x==='function'?x():x;return[a[n],x=>a[n]=typeof x==='function'?x(a[n]):x]}export function useRef(x){return useState({current:x})[0]}export function useEffect(fn,deps){const a=v,n=i++;if(!a[n]||deps?.some((x,j)=>x!==a[n].deps?.[j])){const old=a[n];e.push(()=>{old?.cleanup?.();a[n]={deps,cleanup:fn()}})}}export function effects(){for(const f of e)f();e=[]}export function useCallback(f,deps){const a=v,n=i++;if(!a[n]||deps?.some((x,j)=>x!==a[n].deps?.[j]))a[n]={deps,f};callbacks.push(a[n].f);return a[n].f}`,
);
const apiUrl = mod(
  `let handler;export const calls=[];export class ApiError extends Error{constructor(m,s){super(m);this.status=s}}export function plan(f){handler=f;calls.length=0}export async function api(url,body){calls.push({url,body:body===undefined?undefined:structuredClone(body)});return handler(url,body)}export const humanize=s=>String(s??'').replaceAll('_',' ');export const windowLabel=w=>w.join('–')+' h'`,
);
const hooks = await import(hookUrl),
  transport = await import(apiUrl);
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  confirm: () => true,
};
globalThis.document = {
  getElementById: () => null,
  visibilityState: "visible",
};
async function compile(name) {
  const url = new URL("../src/" + name, import.meta.url);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  code = code.replace(/from\s+["']([^"']+)["']/g, (_, s) => {
    let t;
    if (s === "react") t = hookUrl;
    else if (s === "./api" || s === "./api.ts") t = apiUrl;
    else if (
      s.startsWith(".") &&
      /Views$|Readouts$|Casework$|EntityProfile$|ResetDemoControl$/.test(s)
    )
      t = mod(
        `export default function ${s.slice(2)}(){return null}export function LateTasks(){return null}export function ConfirmDialog(){return null}`,
      );
    else if (s.startsWith(".")) {
      let u = new URL(s, url);
      if (!existsSync(u)) u = new URL(s + ".ts", url);
      t = u.href;
    } else t = import.meta.resolve(s);
    return "from " + JSON.stringify(t);
  });
  return (await import(mod(code))).default;
}
const Root = await compile("CommandWorkspace.tsx"),
  Child = await compile("ScriptedAnalystViews.tsx");
const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url)),
);
const reference = JSON.parse(
  readFileSync(new URL("../../data/reference.json", import.meta.url)),
);
const raw = JSON.parse(
  readFileSync(
    new URL("../../data/scripted/watershed_beta.json", import.meta.url),
  ),
);
const records = {
  ...raw,
  statewideIncidents: raw.incidents,
  responseTasks: raw.tasks,
  storyNow: "2026-10-13T08:00:00Z",
};
const incident = {
  id: "case-a",
  version: 1,
  status: "open",
  eventId: data.events[0].id,
  eventSnapshot: data.events[0],
  notes: [],
  tasks: [],
  decisions: [],
  activity: [],
  runSnapshot: {
    id: "captured",
    seed: data.scenarios[0].seed,
    impacts: [],
    baselineSnapshot: data,
  },
};
const nodes = (n) =>
  Array.isArray(n)
    ? n.flatMap(nodes)
    : isValidElement(n)
      ? [n, ...nodes(n.props.children)]
      : [];
const text = (n) =>
  Array.isArray(n)
    ? n.map(text).join("")
    : isValidElement(n)
      ? text(n.props.children)
      : typeof n === "string"
        ? n
        : "";
const component = (t, name) => nodes(t).find((n) => n.type?.name === name);
const button = (t, label) =>
  nodes(t).find((n) => n.type === "button" && text(n) === label);
const tick = () => new Promise((r) => setImmediate(r));
function setup() {
  hooks.clear();
  const locks = [],
    writes = new Map();
  const p = {
    data: structuredClone(data),
    mode: "analyst",
    view: "coordination",
    selectedId: "case-a",
    selectedEntityId: null,
    mapState: {},
    onSelect() {},
    onCasesLoaded() {},
    onWorkflowLockChange: (x) => locks.push(x),
    onAccessFailure() {},
    onNavigate() {},
    onOpenAnalyst() {},
    onEditDependency() {},
    onSelectEntity() {},
    onMapStateChange() {},
    onOpenTool() {},
  };
  const render = () => {
    hooks.reset("root");
    const t = Root(p);
    hooks.effects();
    return t;
  };
  return { p, locks, writes, render };
}
function reads(url) {
  if (url === "/v1/command/incidents")
    return { incidents: [incident, { ...incident, id: "case-b" }] };
  if (url === "/v1/command/records") return records;
  if (url === "/v1/reference") return reference;
  if (url === "/v1/runs") return [];
  return {};
}
function saved(body, id) {
  return {
    id,
    scenarioId: body.scenarioId,
    request: structuredClone(body),
    baselineRevision: body.expectedBaselineRevision,
    baselineSnapshot: data,
    seed: data.scenarios.find((s) => s.id === body.scenarioId).seed,
    impacts: [
      {
        entityId: body.scenarioId.endsWith("b") ? "hospital-w" : "dialysis-u",
        windowHours: [2, 4],
      },
    ],
  };
}
async function ready(s) {
  s.render();
  await tick();
  return s.render();
}
function child(props, key = "child") {
  hooks.reset(key);
  const t = Child(props);
  hooks.effects();
  return t;
}
const estimate = (t) => button(t, "Estimate potential impact for B and C");
test("potential payloads allocate distinct UUID identities before confirmation", () => {
  const r = potentialRequests(data);
  assert.ok(r.every((x) => /^[0-9a-f-]{36}$/.test(x.clientRequestId)));
  assert.notEqual(r[0].clientRequestId, r[1].clientRequestId);
});
for (const lost of [0, 1])
  test(`Root handoff: accepted/lost response ${lost + 1} reconciles exact ids, retains partials, isolates/remounts`, async () => {
    const s = setup();
    let lostOnce = false;
    transport.plan(async (url, body) => {
      if (!body) return reads(url);
      assert.equal(url, "/v1/runs");
      if (!s.writes.has(body.clientRequestId))
        s.writes.set(body.clientRequestId, saved(body, "run-" + s.writes.size));
      if (s.writes.size === lost + 1 && !lostOnce) {
        lostOnce = true;
        throw Error("lost accepted response");
      }
      return s.writes.get(body.clientRequestId);
    });
    let t = await ready(s);
    const before = structuredClone(incident);
    const handoff = component(t, "ScriptedAnalystViews").props;
    assert.equal(typeof handoff.onEstimatePotential, "function");
    const requests = potentialRequests(s.p.data);
    await assert.rejects(handoff.onEstimatePotential(requests), /lost/);
    requests[0].horizonHours = 999;
    t = s.render();
    assert.equal(s.locks.at(-1), true);
    assert.ok(button(t, "Retry same saved request"));
    assert.equal(
      component(t, "ScriptedAnalystViews").props.potentialRuns.length,
      lost,
    );
    assert.equal(component(t, "CommandCasework").props.busy, false);
    component(t, "CommandCasework").props.onSelect("case-b");
    await component(t, "ScriptedAnalystViews").props.onRefresh();
    await tick();
    t = s.render();
    assert.ok(button(t, "Retry same saved request"));
    const count = transport.calls.filter((c) => c.body).length;
    await tick();
    assert.equal(
      transport.calls.filter((c) => c.body).length,
      count,
      "No automatic writes",
    );
    await button(t, "Retry same saved request").props.onClick();
    await tick();
    t = s.render();
    assert.equal(s.writes.size, 2);
    assert.equal(s.locks.at(-1), false);
    const calls = transport.calls.filter((c) => c.body);
    assert.deepEqual(calls[lost + 1].body, calls[lost].body);
    assert.ok(calls.every((c) => c.body.horizonHours !== 999));
    assert.equal(
      component(t, "ScriptedAnalystViews").props.potentialRuns.length,
      2,
    );
    s.p.view = "uctf";
    s.render();
    s.p.view = "coordination";
    t = s.render();
    let cp = component(t, "ScriptedAnalystViews").props;
    child(cp, "remount");
    assert.match(text(child(cp, "remount")), /Hospital W|Dialysis Center U/);
    s.p.selectedId = "case-b";
    assert.deepEqual(
      component(s.render(), "ScriptedAnalystViews").props.potentialRuns,
      [],
    );
    s.p.selectedId = "case-a";
    s.p.data = { ...s.p.data, baselineRevision: -1 };
    assert.deepEqual(
      component(s.render(), "ScriptedAnalystViews").props.potentialRuns,
      [],
    );
    assert.deepEqual(incident, before);
  });
test("Root holds navigation lock synchronously and stops continuation after forced leave; explicit retry resumes frozen pair", async () => {
  const s = setup();
  let release;
  transport.plan((url, body) =>
    !body
      ? reads(url)
      : new Promise((r) => {
          release = () => r(saved(body, "saved-" + body.scenarioId));
        }),
  );
  let t = await ready(s);
  const promise = component(
    t,
    "ScriptedAnalystViews",
  ).props.onEstimatePotential(potentialRequests(data));
  assert.equal(s.locks.at(-1), true);
  s.p.view = "cyber";
  s.render();
  release();
  await assert.rejects(promise);
  assert.equal(transport.calls.filter((c) => c.body).length, 1);
  t = s.render();
  assert.ok(button(t, "Retry same saved request"));
  transport.plan((url, body) => (body ? saved(body, "second") : reads(url)));
  await button(t, "Retry same saved request").props.onClick();
  await tick();
  s.p.view = "coordination";
  assert.equal(
    component(s.render(), "ScriptedAnalystViews").props.potentialRuns.length,
    2,
  );
});
for (const stage of [0, 1])
  test(`known POST rejection ${stage + 1} unlocks without undoing accepted partial`, async () => {
    const s = setup();
    let n = 0;
    transport.plan((url, body) => {
      if (!body) return reads(url);
      if (n++ === stage) throw new transport.ApiError("rejected", 422);
      return saved(body, "accepted");
    });
    let t = await ready(s);
    await assert.rejects(
      component(t, "ScriptedAnalystViews").props.onEstimatePotential(
        potentialRequests(data),
      ),
    );
    t = s.render();
    assert.equal(s.locks.at(-1), false);
    assert.equal(button(t, "Retry same saved request"), undefined);
    assert.equal(
      component(t, "ScriptedAnalystViews").props.potentialRuns.length,
      stage,
    );
    assert.equal(transport.calls.filter((c) => c.body).length, stage + 1);
  });
test("child is callback-only, confirms frozen pair, supports absent callback, and never automatically writes", async () => {
  const s = setup();
  transport.plan(reads);
  let t = await ready(s);
  const calls = [];
  let props = {
    ...component(t, "ScriptedAnalystViews").props,
    onEstimatePotential: async (r) => {
      calls.push(structuredClone(r));
      return [];
    },
  };
  globalThis.window.confirm = () => false;
  child(props);
  await tick();
  let ct = child(props);
  assert.equal(estimate(ct).props.disabled, false);
  estimate(ct).props.onClick();
  await tick();
  assert.equal(calls.length, 0);
  const revision = props.data.baselineRevision;
  globalThis.window.confirm = () => {
    props.data.baselineRevision = 999;
    return true;
  };
  estimate(ct).props.onClick();
  await tick();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].every((r) => r.expectedBaselineRevision === revision));
  assert.notEqual(calls[0][0].clientRequestId, calls[0][1].clientRequestId);
  assert.equal(transport.calls.filter((c) => c.body).length, 0);
  const missing = { ...props, onEstimatePotential: undefined };
  assert.equal(estimate(child(missing, "missing")).props.disabled, true);
  await estimate(child(missing, "missing")).props.onClick();
  assert.equal(transport.calls.filter((c) => c.body).length, 0);
  assert.equal(calls.length, 1);
});
test("actual child click enters Root ownership and blocks other writes", async () => {
  const s = setup();
  const selections = [];
  s.p.onSelect = (id) => selections.push(id);
  let finish;
  transport.plan((url, body) =>
    !body
      ? reads(url)
      : new Promise((resolve) => {
          finish = () => resolve(saved(body, "accepted-child"));
        }),
  );
  let t = await ready(s);
  const props = component(t, "ScriptedAnalystViews").props;
  globalThis.window.confirm = () => true;
  child(props);
  await tick();
  estimate(child(props)).props.onClick();
  assert.equal(s.locks.at(-1), true);
  t = s.render();
  component(t, "CommandCasework").props.onSelect("case-b");
  assert.deepEqual(selections, []);
  await assert.rejects(
    component(t, "CommandCasework").props.onMutate(
      { action: "add_note", note: "blocked" },
      1,
      "case-a",
    ),
  );
  s.p.view = "consequence";
  t = s.render();
  await assert.rejects(
    component(t, "CommandReadouts").props.onWhatIf({
      scenarioId: "unsafe-water",
      evaluationHour: 1,
      horizonHours: 12,
      overrides: [],
    }),
  );
  finish();
  await tick();
  assert.equal(transport.calls.filter((c) => c.body).length, 1);
  assert.ok(button(s.render(), "Retry same saved request"));
});
test("stale child callbacks cannot write after navigation or case change", async () => {
  const s = setup();
  transport.plan(reads);
  const t = await ready(s);
  const callback = component(t, "ScriptedAnalystViews").props
    .onEstimatePotential;
  s.p.view = "uctf";
  s.render();
  await assert.rejects(callback(potentialRequests(data)));
  s.p.view = "coordination";
  s.p.selectedId = "case-b";
  s.render();
  await assert.rejects(callback(potentialRequests(data)));
  assert.equal(transport.calls.filter((c) => c.body).length, 0);
});
test("accepted summary survives rejected detail GET; explicit retry reads detail without another POST", async () => {
  const s = setup();
  let detailFails = true,
    posts = 0;
  transport.plan((url, body) => {
    if (body) {
      posts++;
      return posts === 1
        ? { id: "summary", scenarioId: body.scenarioId }
        : saved(body, "second");
    }
    if (url === "/v1/runs/summary") {
      if (detailFails) throw new transport.ApiError("detail unavailable", 404);
      return saved(potentialRequests(data)[0], "summary");
    }
    return reads(url);
  });
  let t = await ready(s);
  await assert.rejects(
    component(t, "ScriptedAnalystViews").props.onEstimatePotential(
      potentialRequests(data),
    ),
  );
  t = s.render();
  assert.equal(posts, 1);
  assert.equal(s.locks.at(-1), true);
  detailFails = false;
  await button(t, "Retry same saved request").props.onClick();
  await tick();
  assert.equal(posts, 2);
  assert.equal(
    component(s.render(), "ScriptedAnalystViews").props.potentialRuns.length,
    2,
  );
});

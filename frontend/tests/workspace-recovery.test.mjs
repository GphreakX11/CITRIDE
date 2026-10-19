import test from "node:test";
import { analystHostUnitStub } from './analyst-host-unit-stubs.mjs';
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { isValidElement } from "react";
import { transformWithOxc } from "vite";
const moduleData = (s) =>
  `data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
const hooksUrl = moduleData(
  `let values=[],cursor=0;export const callbacks=[];export function clear(){values=[];cursor=0;callbacks.length=0}export function reset(){cursor=0;callbacks.length=0}export function useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]}export function useRef(initial){const i=cursor++;return values[i]??(values[i]={current:initial})}export function useCallback(fn){callbacks.push(fn);return fn}export function useEffect(){}`,
);
const apiUrl = moduleData(
  `let handler;export const calls=[];export function plan(fn){handler=fn;calls.length=0}export class ApiError extends Error{constructor(message,status){super(message);this.status=status}}export async function api(url,body){calls.push({url,body:body===undefined?undefined:structuredClone(body)});return handler(url,body)}`,
);
const hooks = await import(hooksUrl),
  transport = await import(apiUrl);
const sourceUrl = new URL("../src/CommandWorkspace.tsx", import.meta.url);
let code = (
  await transformWithOxc(readFileSync(sourceUrl, "utf8"), sourceUrl.pathname, {
    jsx: { runtime: "automatic" },
  })
).code;
code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
code = code.replace(/from\s+["']([^"']+)["']/g, (_match, spec) => {
  let target;
  const boundary = analystHostUnitStub(spec);
  if (boundary) target = boundary;
  else if (spec === "react") target = hooksUrl;
  else if (spec === "./api") target = apiUrl;
  else if (
    [
      "./CommandCasework",
      "./CommandReadouts",
      "./CommandCenterViews",
      "./AnalystEntityProfile",
      "./ScriptedAnalystViews",
      "./NetworkEvidence",
      "./ResetDemoControl",
      "./OperationsClock",
      "./IncidentContextBar",
    ].includes(spec)
  )
    target = moduleData(
      `export default function ${spec.slice(2)}(){return null};export function LateTasks(){return null};export function ConfirmDialog(){return null}`,
    );
  else if (spec.startsWith(".")) {
    const p = new URL(/\.[cm]?[jt]s$/.test(spec) ? spec : spec + ".ts", sourceUrl);
    assert.ok(existsSync(p));
    target = p.href;
  } else target = import.meta.resolve(spec);
  return `from ${JSON.stringify(target)}`;
});
const Workspace = (await import(moduleData(code))).default;
const bootstrap = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const event = bootstrap.events[0];
const stored = {
  id: "case-recovery",
  eventId: event.id,
  version: 1,
  status: "open",
  title: "Recovered case",
  eventSnapshot: event,
  contextSnapshot: { provider: null },
  tasks: [],
  decisions: [],
  activity: [],
  notes: [],
};
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  return [node, ...nodes(node.props.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement(node)) return text(node.props.children);
  return typeof node === "string" ? node : "";
}
function button(tree, label) {
  return nodes(tree).find((n) => n.type === "button" && text(n) === label);
}
function component(tree, name) {
  return nodes(tree).find((n) => n.type?.name === name);
}
test('planning runs retain their request identity after a lost response and never merge into the case',async()=>{
 const {p,render}=setup('consequence');p.selectedId=stored.id;let posts=0;
 transport.plan(async(url,body)=>{
  if(body){posts++;if(posts===1)throw new Error('lost planning response');return{id:'planning-run-1',request:body,impacts:[],excluded:[]};}
  if(url==='/v1/command/incidents')return{incidents:[stored]};return{};
 });
 let tree=render();await hooks.callbacks.at(-1)();tree=render();
 const request={scenarioId:'unsafe-water',evaluationHour:1,horizonHours:12,overrides:[],expectedBaselineRevision:1};
 await assert.rejects(component(tree,'CommandReadouts').props.onWhatIf(request));tree=render();
 assert.equal(posts,1);const first=transport.calls.find(c=>c.body).body;
 assert.ok(first.clientRequestId);assert.ok(button(tree,'Retry same saved request'));
 await button(tree,'Retry same saved request').props.onClick();await tick();tree=render();
 assert.equal(posts,2);const writes=transport.calls.filter(c=>c.body);assert.deepEqual(writes[1].body,writes[0].body);
 assert.equal(component(tree,'CommandReadouts').props.lastPlanningRun.id,'planning-run-1');
 assert.equal(component(tree,'CommandReadouts').props.incidents[0].id,stored.id);
 assert.equal(component(tree,'CommandReadouts').props.incidents[0].title,stored.title);
 p.selectedId=null;tree=render();assert.equal(component(tree,'CommandReadouts').props.lastPlanningRun,null,'A planning result must not leak into another focus');
});
test('A4 review is required and alternate analysis saves separately from the captured case',async()=>{
 const {p,render}=setup('consequence');p.selectedId=stored.id;
 let current={...stored,contextSnapshot:{provider:null,scenarios:[{id:'unsafe-water'}]}};
 const captured={id:'captured-run',scenarioId:'unsafe-water',baselineRevision:1,request:{scenarioId:'unsafe-water',evaluationHour:1,horizonHours:12,overrides:[]},impacts:[],excluded:[]};
 transport.plan(async(url,body)=>{
  if(!body)return url==='/v1/command/incidents'?{incidents:[current]}:{};
  if(url.endsWith('/actions')){current={...current,version:2,runSnapshot:captured,runId:captured.id};return current;}
  assert.equal(url,'/v1/cascade-runs');return{...captured,id:'exploratory-run',request:body};
 });
 let tree=render();await hooks.callbacks.at(-1)();tree=render();
 component(tree,'CommandReadouts').props.onAnalyze('unsafe-water',12);tree=render();
 assert.equal(transport.calls.filter(c=>c.body).length,0);
 await component(tree,'ConfirmDialog').props.onConfirm();tree=render();
 assert.equal(current.runSnapshot.id,'captured-run');const before=JSON.stringify(current);
 component(tree,'CommandReadouts').props.onAnalyze('power-loss',24);tree=render();
 assert.equal(component(tree,'ConfirmDialog').props.confirmDisabled,false);
 await component(tree,'ConfirmDialog').props.onConfirm();tree=render();
 assert.equal(JSON.stringify(current),before);
 assert.equal(component(tree,'CommandReadouts').props.lastPlanningRun.id,'exploratory-run');
 assert.equal(component(tree,'CommandReadouts').props.selected.runSnapshot.id,'captured-run');
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(view) {
  hooks.clear();
  const navigations = [];
  const p = {
    mode: "analyst",
    data: bootstrap,
    view,
    selectedId: null,
    selectedEntityId: null,
    mapState: {},
    onSelect: (id) => {
      p.selectedId = id;
    },
    onCasesLoaded() {},
    onWorkflowLockChange() {},
    onAccessFailure() {},
    onNavigate: (v) => navigations.push(v),
    onOpenAnalyst() {},
    onEditDependency() {},
    onSelectEntity() {},
    onMapStateChange() {},
    onOpenTool() {},
  };
  const render = () => {
    hooks.reset();
    return Workspace(p);
  };
  return { p, render, navigations };
}
for (const view of ["command", "cyber"]) {
  for (const failure of ["unacknowledged", "accepted-refresh-failed"]) {
    test(`${view}: ${failure} exposes same-request recovery without casework`, async () => {
      const { render, navigations } = setup(view);
      let posts = 0,
        failedRead = false;
      transport.plan(async (url, body) => {
        if (body) {
          posts++;
          if (posts === 1 && failure === "unacknowledged")
            throw new Error("Controlled lost response");
          if (posts === 1) failedRead = true;
          return structuredClone(stored);
        }
        if (failedRead) {
          failedRead = false;
          throw new Error("Controlled refresh failure");
        }
        if (url === "/v1/command/records")
          return {
            statewideIncidents: [],
            responseTasks: [],
            teams: [],
            contacts: [],
            assessments: [],
            assetStatuses: [],
            hunts: [],
            decisions: [],
            partnerProducts: [],
            now: bootstrap.incidentOrigin,
          };
        if (url === "/v1/reference") return {};
        return { incidents: posts > 0 ? [structuredClone(stored)] : [] };
      });
      render();
      await hooks.callbacks[0]();
      let tree = render();
      component(tree, "CommandReadouts").props.onInvestigate(event);
      await tick();
      tree = render();
      assert.equal(component(tree, "CommandCasework"), undefined);
      assert.equal(
        component(tree, "CommandReadouts").props.workflowLocked,
        true,
      );
      const retry = button(tree, "Retry same saved request");
      assert.ok(retry, "Recovery must be reachable on the entry screen");
      assert.equal(retry.props.disabled, false);
      assert.equal(posts, 1, "No automatic replay");
      // A read alone cannot dismiss an uncertain retained write.
      button(tree, "Refresh casework").props.onClick();
      await tick();
      tree = render();
      assert.ok(button(tree, "Retry same saved request"));
      button(tree, "Retry same saved request").props.onClick();
      await tick();
      tree = render();
      assert.equal(posts, 2);
      assert.equal(
        navigations.at(-1),
        "case-file",
        "An explicitly reconciled case creation opens its Case File",
      );
      assert.equal(
        component(tree, "CommandReadouts").props.workflowLocked,
        false,
      );
      assert.equal(button(tree, "Retry same saved request"), undefined);
      const writes = transport.calls.filter((c) => c.body !== undefined);
      assert.deepEqual(
        writes[0],
        writes[1],
        "Explicit replay preserves exact path, key and full request",
      );
    });
  }
}
test("known rejection is not retained as an uncertain request", async () => {
  const { render } = setup("command");
  transport.plan(async (_url, body) => {
    if (body) throw new transport.ApiError("Controlled rejection", 409);
    if (_url === "/v1/command/records")
      return { statewideIncidents: [], responseTasks: [] };
    if (_url === "/v1/reference") return {};
    return { incidents: [] };
  });
  render();
  await hooks.callbacks[0]();
  let tree = render();
  component(tree, "CommandReadouts").props.onInvestigate(event);
  await tick();
  tree = render();
  assert.equal(button(tree, "Retry same saved request"), undefined);
  assert.equal(component(tree, "CommandReadouts").props.workflowLocked, false);
  assert.equal(transport.calls.filter((c) => c.body).length, 1);
});

import test from "node:test";
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
  if (spec === "react") target = hooksUrl;
  else if (spec === "./api") target = apiUrl;
  else if (
    [
      "./CommandCasework",
      "./CommandReadouts",
      "./CommandCenterViews",
      "./AnalystEntityProfile",
    ].includes(spec)
  )
    target = moduleData(
      `export default function ${spec.slice(2)}(){return null}`,
    );
  else if (spec.startsWith(".")) {
    const p = new URL(spec + ".ts", sourceUrl);
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
      const { render } = setup(view);
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

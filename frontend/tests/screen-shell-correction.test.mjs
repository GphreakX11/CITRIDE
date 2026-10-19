import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { transformWithOxc } from "vite";

const moduleData = (s) =>
  `data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
const hooksUrl = moduleData(
  `let values=[],cursor=0;export const callbacks=[],effects=[];export function clear(){values=[];cursor=0;callbacks.length=0;effects.length=0}export function reset(){cursor=0;callbacks.length=0;effects.length=0}export function setValue(i,v){values[i]=v}export function useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],v=>values[i]=typeof v==='function'?v(values[i]):v]}export function useRef(initial){const i=cursor++;return values[i]??(values[i]={current:initial})}export function useEffect(fn){effects.push(fn)}export function useCallback(fn){callbacks.push(fn);return fn}`,
);
const apiUrl = moduleData(
  `let handler;export function plan(fn){handler=fn}export class ApiError extends Error{}export async function api(url,body){return handler(url,body)}export const describe=String,humanize=String,windowLabel=String;`,
);
const portalUrl = moduleData(
  `import{createElement}from ${JSON.stringify(import.meta.resolve("react"))};export function createPortal(children,container){return createElement("portal",{container},children)}`,
);
const transport = await import(apiUrl);
const hooks = await import(hooksUrl);
async function load(file) {
  const source = new URL(`../src/${file}`, import.meta.url);
  let code = (
    await transformWithOxc(readFileSync(source, "utf8"), source.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  code = code.replace(/from\s+["']([^"']+)["']/g, (_match, spec) => {
    let target;
    if (spec === "react") target = hooksUrl;
    else if (spec === "react-dom") target = portalUrl;
    else if (spec === "./api") target = apiUrl;
    else if (spec.startsWith(".") && /[A-Z]/.test(spec[2])) {
      const name = spec.slice(2).replace(/\.tsx$/, "");
      target = moduleData(
        `function ${name}(){return null};export default ${name};export { ${name} as CaseCreateForm, ${name} as ConfirmDialog, ${name} as LateTasks };`,
      );
    } else if (spec.startsWith("."))
      target = new URL(spec.endsWith(".ts") ? spec : spec + ".ts", source).href;
    else target = import.meta.resolve(spec);
    return `from ${JSON.stringify(target)}`;
  });
  return (await import(moduleData(code))).default;
}
const App = await load("App.tsx"),
  Alerts = await load("AnalystAlerts.tsx"),
  Workspace = await load("CommandWorkspace.tsx");
const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
function nodes(x) {
  if (Array.isArray(x)) return x.flatMap(nodes);
  if (!isValidElement(x)) return [];
  return [x, ...nodes(x.props.children)];
}
function text(x) {
  if (Array.isArray(x)) return x.map(text).join("");
  if (isValidElement(x)) return text(x.props.children);
  return typeof x === "string" ? x : "";
}
const component = (tree, name) =>
  nodes(tree).find((n) => n.type?.name === name);
function setup(query = "") {
  hooks.clear();
  globalThis.window = {
    location: { href: `http://local.invalid/${query}` },
    history: { replaceState() {}, pushState() {} },
    scrollTo() {},
  };
  globalThis.localStorage = {
    getItem() {
      return null;
    },
  };
  const render = () => {
    hooks.reset();
    return App();
  };
  render();
  hooks.setValue(0, data);
  return { render };
}
const caseRecord = (
  id,
  provider = "utility-a",
  priority = "high",
  status = "open",
) => ({
  id,
  title: id,
  priority,
  status,
  eventId: data.events[0].id,
  contextSnapshot: {
    provider: { id: provider, label: provider },
    facility: null,
    physicalAsset: null,
    cyberAsset: null,
    downstreamDependencies: [],
  },
  decisions: [],
});

test("shared shell drops duplicate framing and incident picker, keeps real command heading", () => {
  const { render } = setup();
  const tree = render(),
    copy = text(tree);
  for (const old of [
    "WATERSHED 250 · INFRASTRUCTURE INTELLIGENCE",
    "Current incidents, modeled impacts and response activity.",
    "Water infrastructure workspace",
    "DECISION SUPPORT",
    "Watershed workspace",
    "Baseline r",
  ])
    assert.ok(!copy.includes(old), old);
  assert.equal(
    nodes(tree).filter((n) => n.props["aria-label"] === "Command incident")
      .length,
    0,
  );
  assert.ok(copy.includes("Command Overview"));
  assert.ok(
    nodes(tree).some((n) => n.props.id === "selected-incident-context"),
  );
});

test("static sample notice stays inside the one actual header portal mount in both modes and Advanced", () => {
  for (const query of [
    "",
    "?mode=analyst&view=command",
    "?mode=analyst&view=relationships",
  ]) {
    const { render } = setup(query);
    const tree = render();
    const header = nodes(tree).find((n) => n.type === "header");
    const mounts = nodes(header).filter(
      (n) => n.props.id === "workspace-header-context",
    );
    assert.equal(mounts.length, 1, query);
    const sample = nodes(mounts[0]).filter(
      (n) => n.props.className === "sample-data",
    );
    assert.equal(sample.length, 1, query);
    assert.equal(
      text(sample[0]),
      "Sample data · not connected to live systems",
    );
    assert.equal(
      nodes(tree).filter((n) => n.props.className === "sample-data").length,
      1,
    );
    assert.ok(!text(header).includes("Baseline r"));
  }
});

test("shared screen CSS keeps theme tokens and normal-size contrast treatment", () => {
  const css = readFileSync(
    new URL("../src/screen-shell.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  for (const size of css.matchAll(/font-size\s*:\s*([^;\n}]+)/g))
    assert.match(size[1], /^var\(--fs-[\w-]+\)$/);
  assert.match(css, /--fs-button:\s*var\(--fs-body\)/);
  assert.match(
    css,
    /color-mix\(in srgb, var\(--accent\) 78%, var\(--shadow\)\)/,
  );
});

test("configured featured case is selected on initial C2 visit; explicit clear survives refresh", () => {
  const { render } = setup("?view=cop");
  let tree = render();
  const records = [
    caseRecord("other", "other", "critical"),
    caseRecord("watershed"),
  ];
  const sourceRecords = {
    featuredIncidentId: "configured-incident",
    statewideIncidents: records.map(item => ({ id: item.id === "watershed" ? "configured-incident" : "other-incident", caseId: item.id, status: item.status, severity: item.priority })),
  };
  component(tree, "CommandWorkspace").props.onCasesLoaded(records, sourceRecords);
  tree = render();
  assert.equal(
    component(tree, "CommandWorkspace").props.selectedId,
    "watershed",
  );
  component(tree, "CommandWorkspace").props.onSelect(null);
  tree = render();
  component(tree, "CommandWorkspace").props.onCasesLoaded(records, sourceRecords);
  tree = render();
  assert.equal(
    component(tree, "CommandWorkspace").props.selectedId,
    null,
    "explicit clear survives refresh",
  );
});

test("default selection never falls back to a closed case", () => {
  const { render } = setup("?view=cop");
  let tree = render();
  const records = [
    caseRecord("closed", "utility-a", "critical", "closed"),
    caseRecord("monitor", "other", "medium", "monitoring"),
    caseRecord("open", "other", "low"),
  ];
  component(tree, "CommandWorkspace").props.onCasesLoaded(records, {
    featuredIncidentId: "closed",
    statewideIncidents: records.map(item => ({ id: item.id, caseId: item.id, status: item.status, severity: item.priority })),
  });
  tree = render();
  assert.equal(component(tree, "CommandWorkspace").props.selectedId, "monitor");
});

for (const query of [
  "?focus=1",
  "?case=chosen",
  "?entity=utility-a",
  "?case=",
  "?mode=analyst&view=command",
]) {
  test(`initial explicit selection/clear or analyst queue is preserved: ${query}`, () => {
    const { render } = setup(query);
    let tree = render();
    component(tree, "CommandWorkspace").props.onCasesLoaded([
      caseRecord("watershed"),
      caseRecord("chosen", "other"),
    ]);
    tree = render();
    assert.equal(
      component(tree, "CommandWorkspace").props.selectedId,
      query.includes("case=chosen") ? "chosen" : null,
    );
  });
}

test("investigation navigation is a compact A2-only row, retaining case/clear controls", () => {
  for (const view of [
    "command",
    "cop",
    "cyber",
    "consequence",
    "coordination",
    "uctf",
    "case-file",
  ]) {
    const { render } = setup(`?mode=analyst&view=${view}`);
    const tree = render();
    assert.equal(
      nodes(tree).filter((n) => n.props["aria-label"] === "Investigation steps")
        .length,
      view === "cop" ? 1 : 0,
      view,
    );
    assert.equal(component(tree, "InvestigationBar"), undefined, view);
    if (view === "cop") {
      assert.ok(
        nodes(tree).some((n) => n.props["aria-label"] === "Investigation case"),
      );
      assert.ok(text(tree).includes("Clear entity focus"));
    }
  }
});

test("baseline context remains in Advanced rather than the header", () => {
  const { render } = setup("?mode=analyst&view=relationships");
  const tree = render();
  assert.ok(text(tree).includes("Baseline r"));
  const header = nodes(tree).find((n) => n.type === "header");
  assert.ok(!text(header).includes("Baseline r"));
});

test("source alerts are oldest first without mutating records, all initially visible", () => {
  const original = data.events.map((e) => e.id);
  hooks.clear();
  let tree = Alerts({
    data,
    incidents: [],
    workflowLocked: false,
    onCreate() {},
    onOpenCase() {},
  });
  assert.equal(nodes(tree).filter((n) => n.props["data-alert-id"]).length, 7);
  assert.ok(!text(tree).includes("Show all"));
  assert.equal(
    nodes(tree).find((n) => n.props["data-alert-id"]).props["data-alert-id"],
    "event-vpn-a",
  );
  assert.deepEqual(
    data.events.map((e) => e.id),
    original,
  );
  hooks.clear();
  tree = Alerts({
    data: {
      ...data,
      events: [...data.events, { ...data.events.at(-1), id: "eighth" }],
    },
    incidents: [],
    workflowLocked: false,
    onCreate() {},
    onOpenCase() {},
  });
  assert.equal(nodes(tree).filter((n) => n.props["data-alert-id"]).length, 8);
  assert.ok(text(tree).includes("Show fewer"));
});

test("source alerts fall back to ascending relative time, unknown last", () => {
  hooks.clear();
  const tree = Alerts({
    data: {
      ...data,
      events: [
        { id: "unknown" },
        { id: "late", relativeTimeHours: 2 },
        { id: "early", relativeTimeHours: 0 },
      ],
    },
    incidents: [],
    workflowLocked: false,
    onCreate() {},
    onOpenCase() {},
  });
  assert.deepEqual(
    nodes(tree)
      .filter((n) => n.props["data-alert-id"])
      .map((n) => n.props["data-alert-id"]),
    ["early", "late", "unknown"],
  );
});

const workspaceProps = {
  data,
  view: "command",
  mode: "analyst",
  selectedId: "watershed",
  selectedEntityId: null,
  mapState: {},
  onSelect() {},
  onCasesLoaded() {},
  onWorkflowLockChange() {},
  onSelectEntity() {},
  onMapStateChange() {},
  onNavigate() {},
  onOpenTool() {},
  onOpenAnalyst() {},
  onEditDependency() {},
  onAccessFailure() {},
};
async function workspace(mode = "analyst", view = "command") {
  hooks.clear();
  const source = caseRecord("watershed");
  source.title = "Saved source case";
  transport.plan((url) => {
    if (url === "/v1/command/incidents") return { incidents: [source] };
    if (url === "/v1/command/records")
      return {
        now: "2026-11-17T09:12:00Z",
        operationsTimeZone: "America/Chicago",
        statewideIncidents: [
          { id: "TX-26-184", caseId: source.id, title: "Source incident" },
        ],
        notifications: [],
        taskBoard: [],
      };
    if (url === "/v1/reference") return {};
    throw new Error(`Unexpected request ${url}`);
  });
  const props = { ...workspaceProps, mode, view };
  props.onSelect = id => { props.selectedId = id; };
  const render = () => {
    hooks.reset();
    return Workspace(props);
  };
  render();
  await hooks.callbacks[0]();
  hooks.setValue(7, { resetEnabled: true });
  return { render };
}

test("casework controls move to header; refresh, download, reset and new-case callbacks survive", async () => {
  globalThis.document = { getElementById: (id) => ({ id }) };
  const { render } = await workspace();
  const tree = render();
  assert.ok(!text(tree).includes("CASEWORK"));
  assert.ok(
    !text(tree).includes("Track cases, review evidence and plan responses."),
  );
  const portal = nodes(tree).find(
    (n) =>
      n.type === "portal" &&
      n.props.container.id === "workspace-header-context",
  );
  assert.ok(portal);
  assert.ok(text(portal).includes("Open case from alert"));
  assert.ok(text(portal).includes("Download structured brief (JSON)"));
  assert.ok(
    nodes(portal).some(
      (n) =>
        n.props["aria-label"] === "Refresh casework" &&
        typeof n.props.onClick === "function",
    ),
  );
  const reset = component(portal, "ResetDemoControl");
  assert.ok(reset);
  assert.equal(typeof reset.props.onFailure, "function");
  assert.equal(typeof reset.props.onBusy, "function");
  assert.equal(
    typeof component(tree, "CommandReadouts").props.onCreate,
    "function",
  );
  delete globalThis.document;
});

test("command context uses the saved-case bar instead of the obsolete context portal", async () => {
  globalThis.document = { getElementById: (id) => ({ id }) };
  const { render } = await workspace("command", "cyber");
  const tree = render();
  const context = nodes(tree).find(
    (n) =>
      n.type === "portal" &&
      n.props.container.id === "selected-incident-context",
  );
  assert.equal(context, undefined, "no duplicate long context portal");
  const bar = component(tree, "IncidentContextBar");
  assert.ok(bar);
  assert.equal(bar.props.selected.id, "watershed");
  assert.equal(bar.props.selected.title, "Saved source case");
  assert.equal(bar.props.selected.priority, "high");
  assert.equal(bar.props.selected.status, "open");
  assert.equal(bar.props.selected.contextSnapshot.provider.label, "utility-a");
  assert.deepEqual(bar.props.incidents.map(item => item.id), ["watershed"]);
  assert.equal(bar.props.locked, false);
  assert.equal(typeof bar.props.onSelect, "function");
  const liveClock = nodes(tree).find((n) => n.type?.name === "OperationsClock");
  assert.ok(liveClock, "Command header mounts a ticking operations clock");
  assert.equal(liveClock.props.timeZone, "America/Chicago");
  delete globalThis.document;
});

for (const mode of ["command", "analyst"]) {
  test(`${mode}: explicit context change and clear discard stale statewide URL focus`, async () => {
    const originalWindow = globalThis.window;
    let current = new URL("http://local.invalid/?incidentId=old&incident=old&mode=" + mode + "#keep");
    globalThis.window = {
      get location() { return current; },
      history: { replaceState(_state, _title, next) { current = new URL(next, current); } },
    };
    try {
      const { render } = await workspace(mode, mode === "command" ? "cyber" : "consequence");
      let tree = render();
      const childName = mode === "command" ? "CommandCenterViews" : "CommandReadouts";
      const firstKey = component(tree, childName).key;
      component(tree, "IncidentContextBar").props.onSelect("watershed");
      assert.equal(current.searchParams.has("incidentId"), false);
      assert.equal(current.searchParams.has("incident"), false);
      assert.equal(current.hash, "#keep");
      assert.equal(current.searchParams.get("mode"), mode);
      tree = render();
      if (mode === "analyst") assert.notEqual(component(tree, childName).key, firstKey, "reset cached URL-owned focus even for the same saved case");
      current.searchParams.set("incidentId", "old-again");
      current.searchParams.set("incident", "old-again");
      component(tree, "IncidentContextBar").props.onSelect(null);
      assert.equal(current.searchParams.has("incidentId"), false);
      assert.equal(current.searchParams.has("incident"), false);
      tree = render();
      assert.equal(component(tree, "IncidentContextBar").props.selected, null);
      assert.equal(component(tree, childName).props.selected, null);
    } finally { globalThis.window = originalWindow; }
  });
}

test("C4 keeps its own projected record identity rather than an unrelated saved-case bar", async () => {
  const { render } = await workspace("command", "consequence");
  const tree = render();
  assert.equal(component(tree, "IncidentContextBar"), undefined);
  assert.ok(component(tree, "CommandCenterViews"));
});

test("C2 retains its own record selection without the shared saved-case bar", async () => {
  const { render } = await workspace("command", "cop");
  const tree = render();
  assert.equal(component(tree, "IncidentContextBar"), undefined);
  assert.equal(component(tree, "CommandCenterViews").key, "record-owned");
});

test("saved notifications use a short-lived toast, never the old full-width banner", async () => {
  const { render } = await workspace();
  hooks.setValue(8, "Saved case.");
  let tree = render();
  const toast = nodes(tree).find((n) => n.props.role === "status");
  assert.equal(toast.props.className, "screen-save-toast");
  assert.ok(!nodes(tree).some((n) => n.props.className === "command-notice"));
  let expire, cleared;
  globalThis.window.setTimeout = (fn, ms) => {
    assert.equal(ms, 4000);
    expire = fn;
    return 7;
  };
  globalThis.window.clearTimeout = (id) => {
    cleared = id;
  };
  const cleanup = hooks.effects[0]();
  assert.equal(typeof expire, "function");
  expire();
  tree = render();
  assert.ok(
    !nodes(tree).some((n) => n.props.className === "screen-save-toast"),
  );
  cleanup();
  assert.equal(cleared, 7);
});

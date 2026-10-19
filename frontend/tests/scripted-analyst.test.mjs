import "./configured-time-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
const source = new URL("../src/ScriptedAnalystViews.tsx", import.meta.url);
const read = (p) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const data = read("../../data/scenario.json"),
  raw = read("../../data/scripted/watershed_beta.json"),
  reference = read("../../data/reference.json");
const records = {
  ...raw,
  statewideIncidents: raw.incidents,
  responseTasks: raw.tasks,
  now: "2026-10-13T08:00:00Z",
  taskStatusLabels: {
    not_started: "Not started",
    in_progress: "In progress",
    waiting: "Waiting",
    done: "Done",
  },
  teamStatusLabels: {
    en_route: "En route",
    standby: "Standby",
    remote: "Remote",
    on_site: "On site",
  },
  assetStatusLabels: {
    confirmed: "Confirmed",
    suspected: "Suspected",
    at_risk: "At risk",
    normal: "Normal",
  },
};
const selected = {
  id: "case-a",
  version: 1,
  status: "open",
  createdAt: "2026-10-13T08:00:00Z",
  notes: [],
  eventId: "event-dosing",
};
async function load(hooks = false) {
  let code = (
    await transformWithOxc(
      readFileSync(source, "utf8"),
      "ScriptedAnalystViews.tsx",
      { jsx: { runtime: "automatic" } },
    )
  ).code;
  code = code
    .replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "")
    .replace(
      /from\s+["']([^"']+)["']/g,
      (_m, s) =>
        `from ${JSON.stringify(hooks && s === "react" ? new URL("data:text/javascript," + encodeURIComponent("export const useState=(...a)=>globalThis.__analystHooks.useState(...a);export const useRef=(...a)=>globalThis.__analystHooks.useRef(...a);export const useEffect=(...a)=>globalThis.__analystHooks.useEffect(...a);")).href : s.startsWith(".") ? new URL(s, source).href : import.meta.resolve(s))}`,
    );
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
}
const props = (view, extra = {}) => ({
  data,
  incidents: [selected],
  selected,
  view,
  records,
  reference,
  busy: false,
  uncertain: false,
  onMutate: async () => {},
  onRefresh: async () => {},
  ...extra,
});
function walk(x, predicate) {
  if (Array.isArray(x)) return x.flatMap((n) => walk(n, predicate));
  if (!x || typeof x !== "object") return [];
  return [
    ...(predicate(x) ? [x] : []),
    ...Object.values(x.props || {}).flatMap((v) =>
      (Array.isArray(v) ? v : [v]).flatMap((n) => walk(n, predicate)),
    ),
  ];
}
function harness(Component, initial) {
  let slots = [],
    i = 0,
    effects = [];
  globalThis.__analystHooks = {
    useState(v) {
      const n = i++;
      if (!(n in slots)) slots[n] = typeof v === "function" ? v() : v;
      return [
        slots[n],
        (v) => {
          slots[n] = typeof v === "function" ? v(slots[n]) : v;
        },
      ];
    },
    useRef(v) {
      const n = i++;
      return (slots[n] ??= { current: v });
    },
    useEffect(fn) {
      effects.push(fn);
    },
  };
  return {
    render(p = initial) {
      i = 0;
      effects = [];
      return Component(p);
    },
    effects: () => effects,
  };
}
test("A5 renders compact contact rows with collapsed editors without removing canonical forms", async () => {
  const { default: Component } = await load();
  const html = renderToStaticMarkup(createElement(Component, props("coordination")));
  assert.match(html, /class="sa-contacts-panel"/);
  assert.match(html, /<th>Partner<\/th><th>Group<\/th><th>Status<\/th><th>Last update<\/th>/);
  assert.match(html, /<summary>Update contact<\/summary>/);
  assert.match(html, /id="sa-decision-notes"/);
  assert.match(html, /class="sa-contact-roles">Contacts:/);
  assert.match(html, /Save note — not sent/);
  assert.match(html, /status-chip--red">effect observed<\/span>/);
  const workspace = readFileSync(new URL("../src/CommandWorkspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /view === "coordination" && <details[^>]*><summary>Case record tools<\/summary>\{casework\}<\/details>/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:=|>)/);
  for (const contact of records.contacts.filter((row) => row.incidentId === "TX-26-0412")) assert.ok(html.includes(contact.partnerRole));
});
test("A6 uses compact team task rows and human due times with unchanged record action forms", async () => {
  const { default: Component } = await load();
  const alternate = { ...records, responseTasks: records.responseTasks.map((task) => ({ ...task, dueAt: "2026-10-13T09:00:00Z" })) };
  const html = renderToStaticMarkup(createElement(Component, props("uctf", { records: alternate })));
  assert.match(html, /class="sa-task-groups"/);
  assert.match(html, /class="sa-task-counts"/);
  assert.match(html, /aria-label="Change status:/);
  assert.doesNotMatch(html, /Edit status|Update task status/);
  assert.match(html, /sa-threshold-amber" style="left:50%"/);
  assert.match(html, /sa-threshold-red" style="left:75%"/);
  const withClosure = renderToStaticMarkup(createElement(Component, props("uctf", { caseClosure: createElement("p", null, "Existing guarded closure") })));
  assert.match(withClosure, /class="sa-case-closure"><p>Existing guarded closure/);
  assert.ok(withClosure.indexOf('class="sa-add-task"') < withClosure.indexOf('class="sa-case-closure"'));
  assert.match(html, /Due 04:00 CDT/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ""), /2026-10-13T09:00:00Z/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:=|>)/);
});
test("actual SSR renders alternate authored assessment/hunts/contact/product/team records", async () => {
  const { default: Component } = await load();
  const alternate = structuredClone(records);
  alternate.assessments[0].actorLabel = "Alternate actor";
  alternate.hunts[0].label = "Alternate hunt";
  alternate.contacts[0].partnerRole = "Alternate partner";
  alternate.partnerProducts[0].label = "Alternate product";
  alternate.teams[0].name = "Alternate deployment";
  for (const [view, strings] of [
    ["cyber", ["Alternate actor", "Alternate hunt"]],
    [
      "coordination",
      [
        "Alternate partner",
        "Alternate product",
        "Who acts first",
        "Record decision note",
      ],
    ],
    ["uctf", ["Alternate deployment", "Add task", "Owner role"]],
  ]) {
    const html = renderToStaticMarkup(
      createElement(Component, props(view, { records: alternate })),
    );
    for (const s of strings) assert.ok(html.includes(s), s);
  }
});
test("all actual forms disabled for uncertain/busy/missing/closed case; LateTasks follows story clock", async () => {
  const { default: Component, LateTasks } = await load();
  for (const guard of [
    { uncertain: true },
    { busy: true },
    { selected: null },
    { selected: { ...selected, status: "closed" } },
  ])
    for (const view of ["cyber", "coordination", "uctf"]) {
      const html = renderToStaticMarkup(
        createElement(Component, props(view, guard)),
      );
      assert.ok(
        !/<(?:input|select|textarea)(?![^>]*disabled)[^>]*>/.test(html),
      );
    }
  const r = structuredClone(records);
  r.responseTasks = [
    {
      id: "late",
      label: "Clock task",
      status: "waiting",
      dueAt: "2026-10-13T07:59:00Z",
    },
    {
      id: "done",
      label: "Completed",
      status: "done",
      dueAt: "2026-10-13T07:00:00Z",
    },
  ];
  assert.match(
    renderToStaticMarkup(createElement(LateTasks, { records: r })),
    /Clock task/,
  );
  r.now = "2026-10-13T07:58:00Z";
  assert.doesNotMatch(
    renderToStaticMarkup(createElement(LateTasks, { records: r })),
    /Clock task/,
  );
});
test("actual record forms submit canonical actions; failed callback retains values; confirmation freezes input", async () => {
  const { default: Component } = await load(true);
  const calls = [];
  let reject = false;
  globalThis.window = { confirm: () => true };
  const p = props("cyber", {
    onMutate: async (action) => {
      calls.push(action);
      if (reject) throw new Error("Conflict retained");
    },
  });
  const h = harness(Component, p);
  let tree = h.render();
  let form = walk(
    tree,
    (x) => x.type === "form" && x.props["data-action"] === "record_assessment",
  )[0];
  assert.ok(form);
  const values = {
    subject: "attribution",
    cluster: "Revised cluster",
    actorLabel: "Revised actor",
    confidence: "medium",
    note: "Retain note",
  };
  const event = { preventDefault() {}, currentTarget: {} };
  globalThis.FormData = class {
    get(k) {
      return values[k] ?? "";
    }
  };
  reject = true;
  await form.props.onSubmit(event);
  assert.deepEqual(calls[0], { action: "record_assessment", ...values });
  assert.match(renderToStaticMarkup(h.render()), /Conflict retained/);
  // Submit rechecks guard even if an old handler is invoked after props changed.
  tree = h.render({ ...p, uncertain: true });
  form = walk(
    tree,
    (x) => x.type === "form" && x.props["data-action"] === "record_assessment",
  )[0];
  await form.props.onSubmit(event);
  assert.equal(calls.length, 1);
});
test("all eight record forms emit exact flat contract payloads without source mutation", async () => {
  const { default: Component } = await load(true);
  const calls = [];
  const before = JSON.stringify({ data, records, reference });
  globalThis.window = { confirm: () => true };
  const values = {
    subject: "attribution",
    cluster: "Authored cluster",
    actorLabel: "Authored actor",
    confidence: "medium",
    note: "Analyst note",
    status: "done",
    resultNote: "Authored results",
    decision: "standing_by",
    decidedBy: "Declared role",
    label: "Additional task",
    teamId: "utilities",
    ownerRole: "New owner",
    dueAt: "2026-10-13T10:00:00Z",
    onSite: "3",
    remote: "2",
    traveling: "1",
    standby: "0",
    locationLabel: "New location",
    updateText: "New update",
  };
  globalThis.FormData = class {
    get(k) {
      return values[k] ?? "";
    }
  };
  for (const [view, actions] of [
    ["cyber", ["record_assessment", "set_asset_status", "record_hunt"]],
    ["coordination", ["set_contact_status", "record_decision"]],
    ["uctf", ["set_team_status", "add_task", "set_task_status"]],
  ]) {
    const p = props(view, { onMutate: async (a) => calls.push(a) });
    const h = harness(Component, p);
    for (const action of actions) {
      const form = walk(
        h.render(),
        (x) => x.type === "form" && x.props["data-action"] === action,
      )[0];
      assert.ok(form, action);
      await form.props.onSubmit({ preventDefault() {}, currentTarget: {} });
    }
  }
  assert.deepEqual(
    calls.map((a) => a.action),
    [
      "record_assessment",
      "set_asset_status",
      "record_hunt",
      "set_contact_status",
      "record_decision",
      "set_team_status",
      "add_task",
      "set_task_status",
    ],
  );
  assert.deepEqual(calls.find((a) => a.action === "set_team_status").people, {
    onSite: 3,
    remote: 2,
    traveling: 1,
    standby: 0,
  });
  assert.equal(
    calls.find((a) => a.action === "add_task").dueAt,
    "2026-10-13T10:00:00.000Z",
  );
  assert.equal(
    calls.find((a) => a.action === "record_decision").decidedBy,
    "Declared role",
  );
  assert.equal(JSON.stringify({ data, records, reference }), before);
});
test("native confirmation freezes both estimate requests and cancellation never writes", async () => {
  const { default: Component } = await load(true);
  const input = structuredClone(data);
  for (const [suffix, provider] of [
    ["b", "utility-b"],
    ["c", "utility-c"],
  ])
    if (
      !input.scenarios.some((s) => s.id === `potential-unsafe-water-${suffix}`)
    )
      input.scenarios.push({
        id: `potential-unsafe-water-${suffix}`,
        label: `Authored ${suffix}`,
        seed: { provider, eventRefs: [] },
      });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push([url, options]);
    return {
      ok: true,
      json: async () =>
        options.method === "POST"
          ? {
              id: JSON.parse(options.body).scenarioId,
              scenarioId: JSON.parse(options.body).scenarioId,
              impacts: [],
              baselineSnapshot: { entities: [] },
            }
          : [],
    };
  };
  // The write coordinator is now a required parent-owned boundary. Keep this
  // test's real confirmation/frozen-input assertions; root lock/replay behavior
  // is tested independently in potential-recovery.test.mjs.
  const p = props("coordination", {
    data: input,
    onEstimatePotential: async (requests) => {
      const saved = [];
      for (const request of requests) {
        const response = await globalThis.fetch("/v1/runs", {
          method: "POST",
          body: JSON.stringify(request),
        });
        saved.push(await response.json());
      }
      return saved;
    },
  });
  const h = harness(Component, p);
  h.render();
  for (const effect of h.effects()) effect();
  await new Promise((r) => setTimeout(r, 5));
  let button = walk(
    h.render(),
    (x) =>
      x.type === "button" &&
      x.props.children === "Estimate potential impact for B and C",
  )[0];
  assert.equal(button.props.disabled, false);
  globalThis.window = { confirm: () => false };
  button.props.onClick();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.filter((c) => c[1].method === "POST").length, 0);
  const revision = input.baselineRevision;
  globalThis.window = {
    confirm: () => {
      input.baselineRevision = 999;
      input.scenarios[0].label = "Changed after confirmation";
      return true;
    },
  };
  button.props.onClick();
  await new Promise((r) => setTimeout(r, 5));
  const writes = calls
    .filter((c) => c[1].method === "POST")
    .map((c) => JSON.parse(c[1].body));
  assert.equal(writes.length, 2);
  assert.ok(writes.every((w) => w.expectedBaselineRevision === revision));
  assert.deepEqual(
    writes.map((w) => w.scenarioId),
    ["potential-unsafe-water-b", "potential-unsafe-water-c"],
  );
});
test("mount effect loads saved runs GET-only, resolves detail summaries, never creates runs", async () => {
  const { default: Component } = await load(true);
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push([url, options]);
    return {
      ok: true,
      json: async () =>
        url === "/v1/runs"
          ? [{ id: "saved", scenarioId: "potential-unsafe-water-b" }]
          : {
              id: "saved",
              scenarioId: "potential-unsafe-water-b",
              impacts: [],
              baselineSnapshot: { entities: [] },
            },
    };
  };
  const h = harness(Component, props("coordination"));
  h.render();
  for (const effect of h.effects()) effect();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(calls.some((x) => x[0] === "/v1/runs"));
  assert.ok(calls.every((x) => !x[1].method || x[1].method === "GET"));
  assert.ok(calls.some((x) => x[0] === "/v1/runs/saved"));
});

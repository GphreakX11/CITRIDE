import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { transformWithOxc } from "vite";
import { visibleRecords, networkStreams } from "../src/networkEvidence.ts";
const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url)),
);
const telemetry = {
  streams: networkStreams.map((s) => {
    const value = JSON.parse(
      readFileSync(
        new URL(`../../data/telemetry/${s.id}.json`, import.meta.url),
      ),
    );
    return Array.isArray(value) ? { ...s, records: value } : value;
  }),
};
const event = data.events.find((e) => e.id === "event-dosing");
const incident = {
  id: "case-a3",
  eventId: event.id,
  eventSnapshot: event,
  contextSnapshot: {
    provider: data.entities.find((e) => e.id === "utility-a"),
  },
  tasks: [],
  decisions: [],
  notes: [],
  activity: [],
};
const pure = () => import("../src/threatHunts.ts");
test("case timeline uses hosting utility plus actual sharedSourceIdentity links, CT order and annotations", async () => {
  const { caseTimeline } = await import("../src/caseTimeline.ts");
  const rows = caseTimeline(incident, data, telemetry);
  assert.deepEqual(
    rows.map((r) => r.event.id),
    data.events.map((e) => e.id),
  );
  assert.equal(rows[0].time, "01:30 CT");
  assert.equal(rows.at(-1).time, "02:45 CT");
  assert.equal(rows.find((r) => r.event.id === event.id).isCaseEvent, true);
  assert.equal(
    rows.find((r) => r.event.id === "event-sensor").observedEffect,
    true,
  );
  assert.equal(
    rows.find((r) => r.event.id === "event-probe-b").utility.id,
    "utility-b",
  );
  assert.ok(
    rows
      .find((r) => r.event.id === event.id)
      .techniques.some((t) => t.id === "T0836"),
  );
  const isolated = structuredClone(telemetry);
  for (const s of isolated.streams)
    for (const r of s.records)
      if (r.utilityId !== "utility-a") delete r.sharedSourceIdentity;
  assert.ok(
    !caseTimeline(incident, data, isolated).some(
      (r) => r.event.id === "event-probe-b",
    ),
  );
});
test("timeline remains cycle-safe and includes a captured case absent from current events", async () => {
  const { caseTimeline } = await import("../src/caseTimeline.ts");
  const archived = { ...event, id: "archived-event" };
  const rows = caseTimeline(
    { ...incident, eventId: archived.id, eventSnapshot: archived },
    { ...data, entities: [...data.entities, { id: "cycle", partOf: "cycle" }] },
    telemetry,
  );
  assert.equal(rows.filter((r) => r.isCaseEvent).length, 1);
  assert.ok(rows.some((r) => r.event.id === "archived-event"));
});
test("source hunts derive SF compromise / probes only / no findings from matching records, not background SF", async () => {
  const { huntBySource } = await pure();
  const result = huntBySource(telemetry, "203.0.113.250");
  assert.deepEqual(
    result.utilities.map((u) => [u.utilityId, u.verdict]),
    [
      ["utility-a", "COMPROMISE"],
      ["utility-b", "PROBING ONLY"],
      ["utility-c", "PROBING ONLY"],
    ],
  );
  assert.equal(result.utilities[1].completed, 0);
  assert.ok(
    result.results.some((r) => r.record["id.orig_h"] === "192.0.2.240"),
  );
  const none = huntBySource(telemetry, "198.51.100.254");
  assert.equal(none.results.length, 0);
  assert.ok(none.utilities.every((u) => u.verdict === "NO FINDINGS"));
});
test("account hunt evaluates accounts and correlated sessions without inheriting unrelated completed connections", async () => {
  const { huntByAccount } = await pure();
  const result = huntByAccount(telemetry, "vendor-v-support");
  assert.ok(result.results.some((r) => r.record.user === "vendor-v-support"));
  assert.equal(
    result.utilities.find((u) => u.utilityId === "utility-a").verdict,
    "COMPROMISE",
  );
  assert.equal(huntByAccount(telemetry, "absent-user").results.length, 0);
});
test("off-hours 00:00–05:00 America/Chicago includes 01:30 VPN and authentication, excludes daytime and process writes", async () => {
  const { huntOffHours } = await pure();
  const result = huntOffHours(telemetry, "00:00", "05:00");
  assert.ok(result.results.some((r) => r.record.id === "vpn-a-login-001"));
  assert.ok(result.results.some((r) => r.record.id === "controller-auth-001"));
  assert.ok(
    !result.results.some((r) => r.record.id === "controller-change-001"),
  );
  assert.ok(
    result.results.every((r) => !String(r.record.id).includes("baseline")),
  );
});
test("raw selected record beyond cap remains visible independently of event links", () => {
  const stream = {
    id: "corelight/conn",
    records: Array.from({ length: 240 }, (_, i) => ({ id: `r-${i}` })),
  };
  const rows = visibleRecords(stream, [], 200, "r-239");
  assert.equal(rows.length, 200);
  assert.ok(rows.some((r) => r.record.id === "r-239" && r.selected));
});

test("hunt scopes filter only supplied utilities and never claim unmonitored coverage", async () => {
  const { huntBySource, runHunt } = await pure();
  const other = {
    id: "enterprise",
    records: [
      { id: "outside", utilityId: "city-network", sourceIp: "203.0.113.250" },
    ],
  };
  const t = { streams: [...telemetry.streams, other] };
  assert.ok(
    huntBySource(t, "203.0.113.250", "all-monitored").results.some(
      (r) => r.record.id === "outside",
    ),
  );
  assert.ok(
    !huntBySource(t, "203.0.113.250", "watershed-250-utilities").results.some(
      (r) => r.record.id === "outside",
    ),
  );
  assert.deepEqual(
    runHunt(t, {
      kind: "source",
      value: "203.0.113.250",
      scope: "all-monitored",
    }),
    huntBySource(t, "203.0.113.250", "all-monitored"),
  );
});
test("VPN pool correlation cannot leak completed sessions across utilities", async () => {
  const { huntBySource } = await pure();
  const t = {
    streams: [
      {
        id: "corelight/vpn",
        records: [
          {
            id: "v",
            sourceIp: "203.0.113.250",
            assignedIp: "192.0.2.240",
            utilityId: "utility-a",
          },
        ],
      },
      {
        id: "corelight/conn",
        records: [
          {
            id: "unrelated",
            utilityId: "utility-b",
            "id.orig_h": "192.0.2.240",
            conn_state: "SF",
          },
        ],
      },
    ],
  };
  assert.equal(
    huntBySource(t).utilities.find((u) => u.utilityId === "utility-b").verdict,
    "NO FINDINGS",
  );
});

test("late case hydration follows default timeline but never overrides explicit URL choice", async () => {
  const s = await setup({ incident: null });
  assert.ok(button(s.render(), "Run search"));
  s.props.incident = incident;
  s.render();
  assert.ok(text(s.render()).includes("case event"));
  button(s.render(), "Threat hunt").props.onClick();
  s.props.incident = null;
  s.render();
  s.props.incident = incident;
  s.render();
  assert.ok(button(s.render(), "Run search"));
});
test("recorded queries use their exact stored kind/value/scope and closed cases cannot write", async () => {
  const records = {
    statewideIncidents: [],
    hunts: [
      {
        id: "stored",
        caseId: incident.id,
        label: "Stored query",
        status: "running",
        resultNote: "Keep note",
        query: {
          kind: "source",
          value: "198.51.100.254",
          scope: "watershed-250-utilities",
        },
      },
    ],
  };
  const calls = [];
  const s = await setup({
    initialTab: "hunt",
    records,
    onMutate: async (a) => calls.push(a),
  });
  button(s.render(), "Run recorded query").props.onClick();
  assert.ok(
    text(field(s.render(), "Hunt search results")).includes("NO FINDINGS"),
  );
  assert.equal(
    field(s.render(), "Across").props.value,
    "watershed-250-utilities",
  );
  s.props.incident = { ...incident, status: "closed" };
  const tree = s.render();
  assert.ok(button(tree, "Record a hunt result").props.disabled);
  await nodes(tree)
    .find((n) => n.type === "form")
    .props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 0);
});

const moduleData = (s) =>
  `data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
const hooksUrl = moduleData(
  `let values=[],cursor=0,effects=[];export function clear(){for(const v of values)v?.cleanup?.();values=[];cursor=0;effects=[]}export function reset(){cursor=0}export function flush(){for(const fn of effects.splice(0))fn()}export function useState(init){const i=cursor++;if(!(i in values))values[i]=typeof init==='function'?init():init;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]}export function useEffect(fn,deps){const i=cursor++,prev=values[i];if(!prev||!deps||deps.some((v,j)=>v!==prev.deps[j])){effects.push(()=>{prev?.cleanup?.();values[i]={deps,cleanup:fn()}})}}export function useRef(v){const i=cursor++;return values[i]??(values[i]={current:v})}`,
);
const hooks = await import(hooksUrl);
let component;
async function load() {
  if (component) return component;
  const url = new URL("../src/NetworkEvidence.tsx", import.meta.url);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code;
  code = code
    .replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "")
    .replace(
      /from\s+["']([^"']+)["']/g,
      (_m, s) =>
        `from ${JSON.stringify(s === "react" ? hooksUrl : s.startsWith(".") ? new URL(s, url).href : import.meta.resolve(s))}`,
    );
  component = (await import(moduleData(code))).default;
  return component;
}
function nodes(n) {
  if (Array.isArray(n)) return n.flatMap(nodes);
  if (!isValidElement(n)) return [];
  return [n, ...nodes(n.props.children)];
}
function text(n) {
  if (Array.isArray(n)) return n.map(text).join("");
  if (isValidElement(n)) return text(n.props.children);
  return n == null ? "" : String(n);
}
const button = (tree, label) =>
  nodes(tree).find((n) => n.type === "button" && text(n) === label);
const field = (tree, label) =>
  nodes(tree).find((n) => n.props["aria-label"] === label);
function browser(url) {
  const handlers = new Map();
  globalThis.window = {
    location: new URL(url),
    history: {
      pushState(_s, _t, u) {
        window.location = new URL(u, window.location);
      },
      replaceState(_s, _t, u) {
        window.location = new URL(u, window.location);
      },
    },
    addEventListener(t, fn) {
      handlers.set(t, fn);
    },
    removeEventListener(t) {
      handlers.delete(t);
    },
  };
  return (u) => {
    window.location = new URL(u, window.location);
    handlers.get("popstate")?.();
  };
}
async function setup(
  extra = {},
  url = "https://example.test/?mode=analyst&view=cyber&case=case-a3",
) {
  hooks.clear();
  const pop = browser(url);
  const Component = await load();
  const props = { data, telemetry, incident, ...extra };
  const render = () => {
    hooks.reset();
    const tree = Component(props);
    hooks.flush();
    return tree;
  };
  return { render, pop, props };
}
test("URL tab survives fresh mount and popstate; changing tabs preserves every unrelated parameter", async () => {
  let s = await setup(
    {},
    "https://example.test/?mode=analyst&view=cyber&case=case-a3&tab=raw&map=keep#anchor",
  );
  assert.ok(field(s.render(), "Log stream"));
  button(s.render(), "Threat hunt").props.onClick();
  assert.equal(window.location.search.includes("tab=hunt"), true);
  assert.equal(window.location.search.includes("map=keep"), true);
  assert.equal(window.location.hash, "#anchor");
  s = await setup({}, window.location.href);
  assert.ok(button(s.render(), "Run search"));
  s.pop("?mode=analyst&view=cyber&case=case-a3&tab=timeline");
  assert.ok(text(s.render()).includes("Dosing parameter changed"));
});
test("default timeline with case, hunt without case and explicit legacy initialTab compatibility", async () => {
  let s = await setup();
  assert.ok(text(s.render()).includes("case event"));
  s = await setup({ incident: null });
  assert.ok(button(s.render(), "Run search"));
  assert.ok(text(s.render()).includes("All recorded events."));
  s = await setup({ incident: null, initialTab: "timeline" });
  assert.ok(text(s.render()).includes("Dosing parameter changed"));
});
test("Raw record control selects stream AND record; selected JSON and highlighted matching row survive refresh", async () => {
  const s = await setup();
  let tree = s.render();
  const raw = nodes(tree).find(
    (n) =>
      n.type === "button" &&
      n.props["data-record-id"] === "modbus-detailed-a-write-001",
  );
  assert.ok(raw);
  raw.props.onClick();
  tree = s.render();
  assert.equal(
    field(tree, "Log stream").props.value,
    "corelight/modbus_detailed",
  );
  assert.ok(
    nodes(tree).some(
      (n) =>
        n.type === "tr" &&
        n.props["data-record-id"] === "modbus-detailed-a-write-001" &&
        n.props["data-selected"],
    ),
  );
  assert.ok(text(field(tree, "Selected raw record")).includes("40011"));
  const fresh = await setup({}, window.location.href);
  assert.ok(
    text(field(fresh.render(), "Selected raw record")).includes("40011"),
  );
});
test("search is explicit and scope controls filter actual telemetry, with bounded probe interpretation", async () => {
  const s = await setup({ initialTab: "hunt" });
  let tree = s.render();
  assert.ok(field(tree, "Hunt for"));
  assert.ok(field(tree, "Across"));
  field(tree, "Hunt for").props.onChange({ target: { value: "off-hours" } });
  tree = s.render();
  assert.equal(field(tree, "Off-hours start").props.value, "00:00");
  assert.equal(field(tree, "Off-hours end").props.value, "05:00");
  button(tree, "Run search").props.onClick();
  tree = s.render();
  assert.ok(text(tree).includes("01:30 CT"));
  field(tree, "Hunt for").props.onChange({
    target: { value: "shared-source" },
  });
  tree = s.render();
  button(tree, "Run search").props.onClick();
  tree = s.render();
  assert.ok(text(tree).includes("COMPROMISE"));
  assert.ok(text(tree).includes("PROBING ONLY"));
  assert.ok(
    text(tree).includes(
      "B/C campaign probes · no established compromise or service effect",
    ),
  );
});
test("case scoped hunt status + required note issues only the strict existing record_hunt action and retains failures", async () => {
  const calls = [];
  let fail = false;
  const records = {
    statewideIncidents: [],
    hunts: [
      {
        id: "hunt-own",
        caseId: incident.id,
        label: "Own hunt",
        status: "running",
        query: {
          kind: "source",
          value: "203.0.113.250",
          scope: "all_monitored_networks",
        },
      },
      { id: "hunt-other", caseId: "other", label: "Other hunt" },
    ],
  };
  const s = await setup({
    initialTab: "hunt",
    records,
    onMutate: async (a) => {
      calls.push(a);
      if (fail) throw Error("Save failed");
    },
  });
  let tree = s.render();
  assert.ok(text(tree).includes("Own hunt"));
  assert.ok(!text(tree).includes("Other hunt"));
  let form = nodes(tree).find((n) => n.type === "form");
  assert.ok(form);
  assert.ok(field(tree, "Hunt result note hunt-own").props.required);
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 0);
  field(tree, "Hunt result status hunt-own").props.onChange({
    target: { value: "findings" },
  });
  field(tree, "Hunt result note hunt-own").props.onChange({
    target: { value: "Observed source probes, no completed session at B." },
  });
  tree = s.render();
  await nodes(tree)
    .find((n) => n.type === "form")
    .props.onSubmit({ preventDefault() {} });
  assert.deepEqual(calls, [
    {
      action: "record_hunt",
      huntId: "hunt-own",
      status: "findings",
      resultNote: "Observed source probes, no completed session at B.",
    },
  ]);
  fail = true;
  tree = s.render();
  await nodes(tree)
    .find((n) => n.type === "form")
    .props.onSubmit({ preventDefault() {} });
  assert.ok(text(s.render()).includes("Save failed"));
  assert.ok(field(s.render(), "Hunt result note hunt-own").props.value);
  s.props.uncertain = true;
  tree = s.render();
  assert.ok(nodes(tree).find((n) => n.type === "form").props.children);
  assert.ok(button(tree, "Record a hunt result").props.disabled);
});

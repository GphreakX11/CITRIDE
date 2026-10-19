import "./configured-time-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import {
  alertsWithoutCases,
  openCaseForEvent,
  defaultAlertPriority,
  campaignCaseLink,
  alertTime,
  alertTechniques,
  orderedAlerts,
  alertLocation,
} from "../src/analystAlerts.ts";
import { resolveEventTimestamp, formatTime } from "../src/displayTime.ts";
import { AnalystIncidentProvider } from "../src/analystIncidentContext.ts";
const data = {
  ...JSON.parse(
    readFileSync(new URL("../../data/scenario.json", import.meta.url)),
  ),
  baselineRevision: 1,
};
const raw = JSON.parse(
  readFileSync(
    new URL("../../data/scripted/watershed_beta.json", import.meta.url),
  ),
);
const active = { id: "case-a", eventId: "event-dosing", status: "open" };
const records = { statewideIncidents: raw.incidents };
test("all alerts without open cases, newest first, including events with only a closed case", () => {
  const cases = [
    active,
    { id: "closed-c", eventId: "event-probe-c", status: "closed" },
  ];
  const rows = alertsWithoutCases(data.events, cases);
  assert.equal(rows.length, data.events.length - 1);
  assert.equal(rows[0].id, "event-probe-c");
  assert.ok(!rows.some((e) => e.id === active.eventId));
  assert.deepEqual(
    data.events.map((e) => e.id),
    [
      "event-vpn-a",
      "event-inbound-a",
      "event-auth-a",
      "event-dosing",
      "event-sensor",
      "event-probe-b",
      "event-probe-c",
    ],
  );
});
test("same-event open cases are reused, but related campaign events remain eligible for their own case", () => {
  assert.equal(openCaseForEvent("event-dosing", [active]).id, "case-a");
  assert.equal(openCaseForEvent("event-probe-b", [active]), null);
  assert.equal(
    openCaseForEvent("event-dosing", [{ ...active, status: "monitoring" }]).id,
    "case-a",
  );
  assert.equal(
    openCaseForEvent("event-dosing", [{ ...active, status: "closed" }]),
    null,
  );
});
test("campaign link requires explicit campaign membership and an open case, not a shared telemetry source", () => {
  assert.equal(
    campaignCaseLink(
      data.events.find((e) => e.id === "event-probe-b"),
      [active],
      records,
    ),
    "TX-26-0412",
  );
  assert.equal(
    campaignCaseLink(
      { id: "unrelated", sourceRefs: ["src-network"] },
      [active],
      records,
    ),
    null,
  );
  assert.equal(
    campaignCaseLink(
      data.events[0],
      [{ ...active, status: "closed" }],
      records,
    ),
    null,
  );
});
test("anomalous priority defaults high and ordinary or explicitly normal alerts default medium", () => {
  assert.equal(
    defaultAlertPriority(data.events.find((e) => e.id === "event-dosing")),
    "high",
  );
  assert.equal(
    defaultAlertPriority({ id: "routine", label: "Routine observation" }),
    "medium",
  );
  assert.equal(
    defaultAlertPriority({ ...data.events[0], anomalous: false }),
    "medium",
  );
  assert.equal(defaultAlertPriority({ id: "new", anomalous: true }), "high");
});
test("CT time and ATT&CK chips use source values, including legacy string techniques", () => {
  assert.equal(alertTime(data.events[0], { sampleDataAnchor: "2026-10-13T07:00:00Z" }), "01:30 CDT");
  assert.ok(alertTechniques(data.events[0]).some((t) => t.includes("T0822")));
  assert.deepEqual(alertTechniques({ id: "legacy", techniques: ["T1234"] }), [
    "T1234",
  ]);
  assert.equal(alertTime({ id: "undated" }), "Time unavailable");
});
const moduleUrl = (s) =>
  "data:text/javascript;base64," + Buffer.from(s).toString("base64");
const hookUrl = moduleUrl(
  `let values=[],cursor=0;export function clear(){values=[];cursor=0}export function reset(){cursor=0}export function useState(v){const i=cursor++;if(!(i in values))values[i]=typeof v==='function'?v():v;return [values[i],v=>values[i]=typeof v==='function'?v(values[i]):v]}export function useRef(v){const i=cursor++;return values[i]??(values[i]={current:v})}export function useEffect(){}`,
);
const hooks = await import(hookUrl);
async function load(name, fake = false) {
  const source = new URL("../src/" + name, import.meta.url);
  let code = (
    await transformWithOxc(readFileSync(source, "utf8"), name, {
      jsx: { runtime: "automatic" },
    })
  ).code;
  const matches = [...code.matchAll(/from\s+["']([^"']+)["']/g)];
  for (const m of matches) {
    let target;
    if (fake && m[1] === "./analystIncidentContext.ts") target = moduleUrl("export const useAnalystIncident = () => null;");
    else if (fake && m[1] === "react") target = hookUrl;
    else if (m[1].endsWith(".tsx")) target = await load(m[1].slice(2), fake);
    else
      target = m[1].startsWith(".")
        ? new URL(m[1], source).href
        : import.meta.resolve(m[1]);
    code = code.replace(m[0], "from " + JSON.stringify(target));
  }
  return moduleUrl(code);
}
const { CaseCreateForm } = await import(await load("CaseCreateForm.tsx", true));
const { default: Alerts } = await import(
  await load("AnalystAlerts.tsx", false)
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
const props = () => ({
  data,
  event: data.events[0],
  busy: false,
  uncertain: false,
  onCreate: async () => ({ id: "saved" }),
  onCreated() {},
  onCancel() {},
});
function setup(extra = {}) {
  hooks.clear();
  const p = { ...props(), ...extra };
  const render = () => {
    hooks.reset();
    return CaseCreateForm(p);
  };
  return { p, render };
}
const field = (tree, label) =>
  nodes(tree).find((n) => n.props["aria-label"] === label);
test("inline create form opens prefilled with alert label, editable title <=160 and anomalous priority", () => {
  const { render } = setup();
  const t = render();
  assert.equal(field(t, "Case title").props.value, data.events[0].label);
  assert.equal(field(t, "Case title").props.maxLength, 160);
  assert.equal(field(t, "Local triage priority").props.value, "high");
  assert.ok(nodes(t).some((n) => n.type === "button" && text(n) === "Cancel"));
  assert.ok(text(t).includes("Captured source baseline"));
});
test("edited title and priority save and select the returned case; frozen baseline is refreshed only explicitly", async () => {
  let saved, opened;
  const { p, render } = setup({
    onCreate: async (r) => {
      saved = structuredClone(r);
      return { id: "edited-case" };
    },
    onCreated: (c) => (opened = c.id),
  });
  let t = render();
  field(t, "Case title").props.onChange({
    target: { value: "My edited title" },
  });
  field(t, "Local triage priority").props.onChange({
    target: { value: "critical" },
  });
  p.data = { ...data, baselineRevision: data.baselineRevision + 1 };
  t = render();
  assert.ok(
    nodes(t).some(
      (n) => n.type === "button" && text(n) === "Use current source baseline",
    ),
  );
  await nodes(t)
    .find((n) => n.type === "form")
    .props.onSubmit({ preventDefault() {} });
  assert.equal(saved.title, "My edited title");
  assert.equal(saved.priority, "critical");
  assert.equal(saved.eventId, data.events[0].id);
  assert.equal(saved.expectedBaselineRevision, data.baselineRevision);
  assert.ok(saved.clientRequestId);
  assert.equal(opened, "edited-case");
});
test("failed save retains draft, stops duplicate submission and never auto-replays", async () => {
  let calls = 0,
    reject;
  const { p, render } = setup({
    onCreate: () => {
      calls++;
      return new Promise((_, r) => (reject = r));
    },
  });
  let t = render();
  field(t, "Case title").props.onChange({ target: { value: "Keep my draft" } });
  t = render();
  const submit = nodes(t).find((n) => n.type === "form").props.onSubmit;
  const first = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  assert.equal(calls, 1);
  reject(new Error("Save outcome unknown"));
  await first;
  p.uncertain = true;
  t = render();
  assert.equal(field(t, "Case title").props.value, "Keep my draft");
  assert.equal(field(t, "Case title").props.disabled, true);
  assert.ok(text(t).includes("Save outcome unknown"));
  assert.equal(calls, 1);
});
test("alerts render all missing-case events when expanded and provide an open-case-file button for existing cases", () => {
  const html = renderToStaticMarkup(
    createElement(Alerts, {
      data,
      incidents: [active],
      records,
      onOpenCase() {},
      onCreate: async () => ({}),
      workflowLocked: false,
      showAllInitially: true,
    }),
  );
  for (const e of data.events) assert.ok(html.includes(e.label));
  assert.ok(html.includes("Open case file"));
  assert.ok(html.includes("linked to TX-26-0412"));
  assert.ok(
    html.includes(
      "Alerts never become cases on their own; an analyst opens the case.",
    ),
  );
});

const port = JSON.parse(readFileSync(new URL("../../data/scripted/port_houston.json", import.meta.url)));
const allData = { ...data, events: [...data.events, ...port.events], entities: [...data.entities, ...port.entities] };
const clock = { sampleDataAnchor: "2026-10-19T18:00:00Z" };
const idsIn = html => [...html.matchAll(/data-alert-id="([^"]+)"/g)].map(match => match[1]);
function alertMarkup({ selected, cases = [], timing = clock, source = allData, provider = false } = {}) {
  const p = { data: source, incidents: cases, records: { ...timing, statewideIncidents: selected ? [selected] : [] }, workflowLocked: false, onCreate: async () => ({}), onOpenCase() {} };
  let element = createElement(Alerts, p);
  if (provider) element = createElement(AnalystIncidentProvider, {
    selection: { selectedIncidentId: selected?.id ?? null, selectedIncident: selected ?? null, openIncidents: selected ? [selected] : [], matchingOpenCases: cases, activeCase: null },
    mainStore: source, records: p.records, reference: null, telemetry: null, cases,
    selectIncident() {}, selectCase() {}, locked: false, enabled: false,
  }, element);
  return renderToStaticMarkup(element);
}
test("all 13 alerts render by default, newest first globally regardless of linked/pending cases", () => {
  assert.equal(allData.events.length, 13);
  const expected = orderedAlerts(allData.events, new Set(), event => resolveEventTimestamp(event, clock)).map(event => event.id);
  const cases = [ { id: "new-case", eventId: expected[0], status: "open" }, { id: "old-case", eventId: expected.at(-1), status: "monitoring" } ];
  const html = alertMarkup({ cases });
  assert.deepEqual(idsIn(html), expected);
  assert.equal((html.match(/Open case file/g) ?? []).length, 2);
  assert.ok(!html.includes("Utility unresolved"));
  assert.ok(!html.includes("Time unavailable"));
});
test("selected incident alerts come first without hiding others or separating linked cases", () => {
  const selected = { id: "arbitrary-selection", title: "Selected register row", linkedEventIds: port.events.map(event => event.id) };
  const expected = orderedAlerts(allData.events, new Set(selected.linkedEventIds), event => resolveEventTimestamp(event, clock)).map(event => event.id);
  const cases = [{ id: "selected-linked", eventId: expected[0], status: "open" }, { id: "other-linked", eventId: expected.at(-1), status: "open" }];
  const html = alertMarkup({ selected, cases, provider: true });
  assert.deepEqual(idsIn(html), expected);
  assert.equal(idsIn(html).length, 13);
  assert.deepEqual(idsIn(html).slice(0, 6).sort(), selected.linkedEventIds.toSorted());
  assert.ok(html.includes("Selected register row"));
});
test("sample card datetime and label share the persisted anchor; live aware timestamps survive", () => {
  const source = { ...data, events: [
    { id: "sample", relativeTimeHours: -0.5, timestamp: "2020-01-01T00:00:00Z" },
    { id: "live", timestamp: "2026-10-19T14:15:00-04:00" },
    { id: "event-time", eventTime: "2026-10-19T18:30:00Z" },
    { id: "unknown" },
  ] };
  for (const provider of [false, true]) {
    const html = alertMarkup({ source, provider });
    for (const event of source.events.slice(0, 3)) {
      const timestamp = resolveEventTimestamp(event, clock);
      assert.ok(html.includes(`<time dateTime="${timestamp}">${formatTime(timestamp)}</time>`));
    }
    assert.deepEqual(idsIn(html), ["event-time", "live", "sample", "unknown"]);
    assert.ok(html.includes("<time>Time unavailable</time>"));
    const noAnchor = alertMarkup({ source, provider, timing: { now: clock.sampleDataAnchor } });
    assert.ok(!noAnchor.includes("2020-01-01"));
    assert.ok(noAnchor.includes('data-alert-id="sample"'));
  }
});
test("location follows hosting/containment to nearest named facility and useful parent, never customer IDs", () => {
  const entity = (id, type, label, extra = {}) => ({ id, type, label, ...extra });
  const inventory = { entities: [
    entity("cyber", "CyberAsset", "Controller network identity", { hostedBy: "physical" }),
    entity("physical", "PhysicalOTAsset", "Controller", { partOf: "facility" }),
    entity("facility", "TreatmentPlant", "North Works", { partOf: "provider" }),
    entity("provider", "WaterServiceProvider", "Regional Operator"),
    entity("terminal", "PortFacility", "Cargo Terminal"),
    entity("it", "PhysicalITAsset", "Scheduling server", { partOf: "terminal" }),
    entity("blank", "Site", " ", { partOf: "terminal" }),
  ] };
  assert.equal(alertLocation({ id: "a", seenOn: "cyber" }, inventory), "Regional Operator · North Works");
  assert.equal(alertLocation({ id: "a", seenOn: "it" }, inventory), "Cargo Terminal");
  assert.equal(alertLocation({ id: "a", seenOn: "blank" }, inventory), "Cargo Terminal");
});
test("location cycles and missing parents terminate with a named asset or explicit fallback", () => {
  const inventory = { entities: [
    { id: "a", type: "CyberAsset", label: "Named sensor", hostedBy: "b" },
    { id: "b", type: "PhysicalOTAsset", label: "", partOf: "a" },
    { id: "site", type: "PortFacility", label: "Cyclic site", partOf: "site" },
  ] };
  assert.equal(alertLocation({ id: "event", seenOn: "a" }, inventory), "Named sensor");
  assert.equal(alertLocation({ id: "event", seenOn: "site" }, inventory), "Cyclic site");
  for (const event of [{ id: "missing" }, { id: "absent", seenOn: "unknown" }])
    assert.equal(alertLocation(event, inventory), "Location not recorded");
  assert.equal(alertLocation({ id: "blank", seenOn: "blank" }, { entities: [{ id: "blank", type: "PhysicalITAsset", label: "", partOf: "missing" }] }), "Location not recorded");
});
test("unknown sort times stay last within their incident group and equal times preserve source order", () => {
  const events = [{ id: "other" }, { id: "unknown-selected" }, { id: "first", timestamp: "2026-10-19T18:00:00Z" }, { id: "second", timestamp: "2026-10-19T18:00:00Z" }];
  assert.deepEqual(orderedAlerts(events, new Set(["unknown-selected", "first", "second"])).map(event => event.id), ["first", "second", "unknown-selected", "other"]);
});
const { default: InteractiveAlerts } = await import(await load("AnalystAlerts.tsx", true));
test("queue keeps existing-case action and opens/cancels inline create without creating a case automatically", () => {
  hooks.clear();
  const opened = [];
  const p = { data, incidents: [active], records: { ...clock, statewideIncidents: [] }, workflowLocked: false, onOpenCase: id => opened.push(id), onCreate: async () => { throw new Error("Not submitted"); } };
  const render = () => { hooks.reset(); return InteractiveAlerts(p); };
  let tree = render();
  const existing = nodes(tree).find(node => node.props["data-alert-id"] === active.eventId);
  nodes(existing).find(node => node.type === "button").props.onClick();
  assert.deepEqual(opened, [active.id]);
  const pending = nodes(tree).find(node => node.props["data-alert-id"] === data.events[0].id);
  nodes(pending).find(node => node.type === "button").props.onClick();
  tree = render();
  const form = nodes(tree).find(node => node.type === CaseCreateForm || (typeof node.type === "function" && node.type.name === "CaseCreateForm"));
  assert.ok(form);
  assert.equal(form.props.event.id, data.events[0].id);
  form.props.onCancel();
  tree = render();
  assert.ok(!nodes(tree).some(node => typeof node.type === "function" && node.type.name === "CaseCreateForm"));
});

test("case-linked newest alert precedes pending older alert in each priority group", () => {
  const source = { ...data, events: [
    { id: "other-old", timestamp: "2026-10-19T12:00:00Z" },
    { id: "selected-old", timestamp: "2026-10-19T10:00:00Z" },
    { id: "other-new", timestamp: "2026-10-19T14:00:00Z" },
    { id: "selected-new", timestamp: "2026-10-19T11:00:00Z" },
  ] };
  const cases = ["other-new", "selected-new"].map(eventId => ({ id: `case-${eventId}`, eventId, status: "open" }));
  assert.deepEqual(idsIn(alertMarkup({ source, cases })), ["other-new", "other-old", "selected-new", "selected-old"]);
  const selected = { id: "selection", title: "Priority", linkedEventIds: ["selected-old", "selected-new"] };
  assert.deepEqual(idsIn(alertMarkup({ source, cases, selected, provider: true })), ["selected-new", "selected-old", "other-new", "other-old"]);
});
test("changing persisted sample anchor moves rendered sample times, not live feed times", () => {
  const source = { ...data, events: [{ id: "sample", relativeTimeHours: -0.5 }, { id: "live", timestamp: "2026-10-19T18:15:00Z" }] };
  const html = alertMarkup({ source, timing: { sampleDataAnchor: "2026-10-20T18:00:00Z" }, provider: true });
  assert.ok(html.includes('<time dateTime="2026-10-20T17:30:00.000Z">12:30 CDT</time>'));
  assert.ok(html.includes('<time dateTime="2026-10-19T18:15:00Z">13:15 CDT</time>'));
  assert.deepEqual(idsIn(html), ["sample", "live"]);
});

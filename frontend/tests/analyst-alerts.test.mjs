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
} from "../src/analystAlerts.ts";
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
  assert.equal(alertTime(data.events[0]), "01:30 CDT");
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
    if (fake && m[1] === "react") target = hookUrl;
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

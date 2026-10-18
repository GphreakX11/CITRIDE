import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";
import { openIncidentChoices, initialIncidentChoice, searchIncidentChoices, readIncidentChoice, incidentChoiceLocation } from "../src/incidentSelection.ts";
import { incidentFocusLocation, readIncidentFocus } from "../src/incidentFocus.ts";
const data = { incidentOrigin: "2026-10-13T00:00:00Z", entities: [{ id: "utility", label: "Cedar Utility" }], scenarios: [{ id: "default", seed: { eventRefs: ["attack"] } }], defaultScenarioId: "default" };
const rows = [
  { id: "low", title: "Water incident", status: "open", severity: "low", linkedEventIds: ["attack"], nearEntityIds: ["utility"], sectors: ["12.1"], location: { label: "Austin", region: "Central" } },
  { id: "0409", title: "City ransomware", status: "monitoring", severity: "high", startedRelativeHours: 2 },
  { id: "high-old", title: "Older incident", status: "open", severity: "high", startedAt: "2026-10-13T01:00:00Z" },
  { id: "closed", status: "closed", severity: "critical" },
];
test("open choices are severity/newest sorted, deterministic and do not mutate records", () => {
  assert.deepEqual(openIncidentChoices(rows, data).map(r => r.id), ["0409", "high-old", "low"]);
  assert.equal(rows[0].id, "low");
  assert.doesNotThrow(() => openIncidentChoices([{ id: "bad", status: "open", startedRelativeHours: NaN }], { ...data, incidentOrigin: "bad" }));
});
test("explicit incident or saved-case choice wins; absent configuration defaults by severity, not scenario", () => {
  const cases = [{ id: "saved", title: "Renamed investigation", status: "open", eventId: "attack" }];
  assert.equal(initialIncidentChoice(rows, cases, "saved", "0409", data), "0409");
  assert.equal(initialIncidentChoice(rows, cases, null, null, data), "0409");
  assert.equal(initialIncidentChoice(rows, cases, "saved", null, data), "low");
  assert.equal(initialIncidentChoice(rows, [{ ...cases[0], status: "closed" }], null, "closed", data), "0409");
  assert.equal(initialIncidentChoice(rows, [{ id: "fake", title: "Watershed", status: "open", eventId: "unrelated" }], null, null, data), "0409");
  assert.equal(initialIncidentChoice([], cases, null, null, data), null);
});
test("search matches ID, title, linked utility, place, region and IDT sector labels", () => {
  for (const term of ["water", "Cedar", "Austin", "Central", "12.1"]) assert.equal(searchIncidentChoices(rows, ` ${term} `, data)[0].id, "low");
  assert.deepEqual(searchIncidentChoices(rows, "0409", data).map(r => r.id), ["0409"]);
  assert.deepEqual(searchIncidentChoices(rows, "missing", data), []);
  assert.equal(searchIncidentChoices(rows, "").length, rows.length);
});
test("URL API delegates canonical C1 identifier handling and preserves unrelated selection", () => {
  const url = "/prototype?view=cop&case=saved&entity=utility#panel";
  for (const id of ["0409", "bad id", "x".repeat(129)]) assert.equal(incidentChoiceLocation(url, id), incidentFocusLocation(url, id));
  const next = incidentChoiceLocation(url, "0409");
  assert.equal(readIncidentChoice(next), readIncidentFocus(next));
  assert.match(next, /case=saved/); assert.match(next, /#panel$/);
});

// Execute the real component and handlers with a tiny deterministic hooks/JSX
// host: no DOM package or app routing is needed for focus/state contracts.
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const hooks = moduleUrl(`export const useState=v=>globalThis.__incidentHarness.state(v); export const useRef=v=>globalThis.__incidentHarness.ref(v); export const useEffect=(f,d)=>globalThis.__incidentHarness.effect(f,d); export const useId=()=>"test";`);
const jsx = moduleUrl(`export const Fragment="fragment"; export const jsx=(type,props)=>({type,props}); export const jsxs=jsx;`);
async function selector() {
  const url = new URL("../src/IncidentSelector.tsx", import.meta.url);
  let { code } = await transformWithOxc(readFileSync(url, "utf8"), url.pathname, { jsx: { runtime: "automatic" } });
  code = code.replace(/from\s+["']([^"']+)["']/g, (_, spec) => `from ${JSON.stringify(spec === "react" ? hooks : spec === "react/jsx-runtime" ? jsx : spec.endsWith("visualPrimitives.ts") ? moduleUrl("export const StatusChip=()=>null") : new URL(spec, url).href)}`);
  return (await import(moduleUrl(code))).default;
}
function host(Component, props) {
  const slots = [], effects = [], listeners = new Map(); let cursor = 0;
  const focus = { name: null };
  const h = {
    state(v) { const n = cursor++; if (!(n in slots)) slots[n] = v; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value; }]; },
    ref(v) { const n = cursor++; return slots[n] ??= { current: v }; },
    effect(f, d) { const n = cursor++; if (!slots[n] || d.some((v, i) => v !== slots[n].d[i])) { effects.push(() => { slots[n]?.cleanup?.(); slots[n] = { d, cleanup: f() }; }); } },
  };
  globalThis.__incidentHarness = h;
  globalThis.document = { addEventListener: (k, f) => listeners.set(k, f), removeEventListener: k => listeners.delete(k), getElementById: () => ({ scrollIntoView() {} }) };
  const flatten = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
  let tree, nodes;
  const render = () => {
    cursor = 0; tree = Component(props); nodes = flatten(tree);
    for (const n of nodes) if (n.props.ref) n.props.ref.current = { focus: () => { focus.name = n.type; }, contains: value => value?.inside === true };
    effects.splice(0).forEach(f => f()); return nodes;
  };
  const get = role => nodes.find(n => n.props.role === role);
  const key = (key, target = get("combobox")?.props.ref.current) => tree.props.onKeyDown({ key, target, preventDefault() {}, stopPropagation() {} });
  render();
  return { render, get, key, focus, listeners, trigger: () => nodes.find(n => n.props.className === "iv-select-trigger"), nodes: () => nodes };
}
test("selector real hook state supports arrows, Enter, Escape, filtering, outside click and no option tab stops", async () => {
  const chosen = [];
  const h = host(await selector(), { rows, current: rows[1], data, now: "2026-10-13T03:00:00Z", recordsAsOf: "2026-10-13T03:00:00Z", onChoose: id => chosen.push(id) });
  h.key("ArrowDown"); h.render(); assert.equal(h.focus.name, "input");
  assert.equal(h.get("combobox").props["aria-activedescendant"], "test-0");
  assert.ok(h.nodes().filter(n => n.props.role === "option").every(n => n.props.tabIndex === -1));
  h.key("ArrowDown"); h.render(); h.key("Enter"); h.render();
  assert.deepEqual(chosen, ["high-old"]); assert.equal(h.focus.name, "button"); assert.equal(h.get("combobox"), undefined);
  h.trigger().props.onClick(); h.render();
  h.get("combobox").props.onChange({ target: { value: "missing" } }); h.render();
  assert.equal(h.get("combobox").props["aria-activedescendant"], undefined);
  assert.match(h.get("status").props.children, /No matching/);
  h.key("Enter"); assert.equal(chosen.length, 1);
  h.key("Escape"); h.render(); assert.equal(h.focus.name, "button");
  h.trigger().props.onClick(); h.render(); h.listeners.get("pointerdown")({ target: {} }); h.render();
  assert.equal(h.get("combobox"), undefined);
  assert.doesNotMatch(JSON.stringify(h.nodes()), /2026-10-13T/);
});

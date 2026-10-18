import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";

const url = new URL("../src/IncidentContextBar.tsx", import.meta.url);
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const hooks = moduleUrl(`export const useState=v=>globalThis.__contextHost.state(v); export const useId=()=>"context-test"; export const useRef=v=>useState({current:v})[0];`);
const jsx = moduleUrl(`export const Fragment="fragment"; export const jsx=(type,props)=>({type,props}); export const jsxs=jsx;`);
async function component() {
  let { code } = await transformWithOxc(readFileSync(url, "utf8"), url.pathname, { jsx: { runtime: "automatic" } });
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  code = code.replace(/from\s+["']([^"']+)["']/g, (_, spec) => `from ${JSON.stringify(spec === "react" ? hooks : spec === "react/jsx-runtime" ? jsx : new URL(spec, url).href)}`);
  return (await import(moduleUrl(code))).default;
}
function host(Component, props) {
  const slots = []; let cursor = 0, nodes;
  globalThis.__contextHost = { state(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = next; }]; } };
  const flatten = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
  const render = () => { cursor = 0; nodes = flatten(Component(props)); return nodes; };
  render();
  return { render, nodes: () => nodes, get: type => nodes.find(n => n.type === type), button: name => nodes.find(n => n.type === "button" && n.props.children === name) };
}
const incident = { id: "case-technical-123", title: "Water service disruption", priority: "high", status: "monitoring", contextSnapshot: { serviceArea: { label: "Travis County" } } };
const other = { ...incident, id: "case-other", title: "Power interruption" };
test("renders a human-readable case context, correct priority label and secondary technical ID", async () => {
  const h = host(await component(), { selected: incident, incidents: [incident], location: "Austin · Central", locked: false, onSelect() {} });
  const text = JSON.stringify(h.nodes());
  for (const term of [incident.title, "Austin · Central", "Priority", "high", "Status", "monitoring", "Change incident"]) assert.ok(text.includes(term), term);
  assert.ok(h.get("details")); assert.ok(JSON.stringify(h.get("details")).includes(incident.id));
  assert.ok(!text.includes("Severity"));
});
test("change and clear use the existing selection callback; refresh never selects a case", async () => {
  const chosen = [], props = { selected: incident, incidents: [incident, other], locked: false, onSelect: id => chosen.push(id) };
  const h = host(await component(), props);
  h.button("Change incident").props.onClick(); h.render();
  h.get("select").props.onChange({ target: { value: other.id } }); h.render();
  assert.deepEqual(chosen, [other.id]);
  h.button("Change incident").props.onClick(); h.render();
  h.get("select").props.onChange({ target: { value: "" } });
  props.selected = null; props.incidents = [other]; h.render(); h.render();
  assert.deepEqual(chosen, [other.id, null]);
  assert.ok(JSON.stringify(h.nodes()).includes("No incident selected"));
});
test("busy, uncertain and initial-loading locks disable and guard new selection controls", async () => {
  const chosen = [], props = { selected: incident, incidents: [incident, other], locked: false, onSelect: id => chosen.push(id) };
  const h = host(await component(), props);
  h.button("Change incident").props.onClick(); h.render();
  props.locked = true; h.render();
  assert.equal(h.button("Change incident").props.disabled, true);
  assert.equal(h.get("select").props.disabled, true);
  h.get("select").props.onChange({ target: { value: other.id } });
  assert.deepEqual(chosen, []);
});
test("copy reports success and denied/unavailable clipboard without an unhandled rejection", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    const copied = [];
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async id => copied.push(id) } } });
    const h = host(await component(), { selected: incident, incidents: [incident], locked: false, onSelect() {} });
    await h.button("Copy ID").props.onClick(); h.render();
    assert.deepEqual(copied, [incident.id]); assert.ok(JSON.stringify(h.nodes()).includes("ID copied"));
    navigator.clipboard.writeText = async () => { throw new Error("denied"); };
    await h.button("Copy ID").props.onClick(); h.render();
    assert.ok(JSON.stringify(h.nodes()).includes("Copy unavailable"));
    navigator.clipboard = undefined;
    await h.button("Copy ID").props.onClick(); h.render();
    assert.ok(JSON.stringify(h.nodes()).includes("Copy unavailable"));
  } finally { if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); else delete globalThis.navigator; }
});
test("workspace shares the bar, keeps C1/C2 owned headers, and uses navigation lock without auto-selection", () => {
  const source = readFileSync(new URL("../src/CommandWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /const showIncidentContextBar =/);
  assert.match(source, /view === "cop" \|\| view === "consequence"/);
  assert.match(source, /view === "consequence"\)\s*\? null/);
  assert.match(source, /locked=\{workspaceNavigationLocked\(loaded, loading, busy, uncertain\)\}/);
  assert.equal((source.match(/\{selectedIncidentContextBar\}/g) ?? []).length, 2);
  assert.match(source, /!showIncidentContextBar && incidentContext/);
  const read = source.slice(source.indexOf("function acceptRead"), source.indexOf("const loadCases"));
  assert.doesNotMatch(read, /onSelect\(/);
  const css = readFileSync(new URL("../src/incident-context-bar.css", import.meta.url), "utf8");
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  for (const size of css.matchAll(/font-size\s*:\s*([^;\n}]+)/g))
    assert.match(size[1], /^var\(--fs-[\w-]+\)$/);
});
test("real workspace navigation lock allows visible refresh but blocks initial loading and saves", async () => {
  const source = readFileSync(new URL("../src/CommandWorkspace.tsx", import.meta.url), "utf8");
  const functionSource = source.match(/export function workspaceNavigationLocked\([\s\S]*?\n\}/)[0];
  const { code } = await transformWithOxc(functionSource, "lock.ts");
  const { workspaceNavigationLocked: locked } = await import(moduleUrl(code));
  assert.equal(locked(false, true, false, false), true);
  assert.equal(locked(true, true, false, false), false);
  assert.equal(locked(true, false, true, false), true);
  assert.equal(locked(true, false, false, true), true);
  assert.equal(locked(true, false, false, false), false);
});

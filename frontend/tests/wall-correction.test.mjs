import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "./json-module-transform.mjs";

const root = new URL("../src/", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const data = read("../../data/scenario.json");
const supplied = read("../../data/scripted/watershed_beta.json");
const reference = read("../../data/reference.json");
const cache = new Map();
const hookUrl = `data:text/javascript;base64,${Buffer.from(`
  let values = [], cursor = 0;
  export function clear() { values = []; cursor = 0; }
  export function reset() { cursor = 0; }
  export function useState(initial) {
    const index = cursor++;
    if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
    return [values[index], value => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
  }
  export function useRef(initial) { const index = cursor++; return values[index] ??= { current: initial }; }
  export function useEffect() {}
`).toString("base64")}`;
const hooks = await import(hookUrl);
async function compile(url, mockHooks = false) {
  const key = `${url.href}:${mockHooks}`;
  if (cache.has(key)) return cache.get(key);
  let code = (await transformWithOxc(readFileSync(url, "utf8"), url.pathname, { jsx: { runtime: "automatic" } })).code
    .replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    let target;
    if (m[1].startsWith(".")) {
      let next = new URL(m[1], url);
      if (!existsSync(next)) next = new URL(`${m[1]}.ts`, url);
      target = await compile(next);
    } else target = mockHooks && m[1] === "react" ? hookUrl : import.meta.resolve(m[1]);
    imports.set(m[1], target);
  }
  code = code.replace(/from\s+["']([^"']+)["']/g, (_, s) => `from ${JSON.stringify(imports.get(s))}`);
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(key, result);
  return result;
}
const module = async (name) => import(await compile(new URL(name, root)));
const { consequenceModel } = await module("commandCenterModel.ts");
const { default: Network } = await module("components/DependencyNetwork.tsx");
const { default: Command } = await module("CommandCenterViews.tsx");
const { default: Scripted, Schematic } = await module("ScriptedCommandViews.tsx");
const { default: InteractiveOverview } = await import(await compile(new URL("C1Overview.tsx", root), true));
const html = (component, props) => renderToStaticMarkup(createElement(component, props));
const freeze = (value) => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function incident() {
  const run = {
    id: "wall-run", createdAt: "2026-10-13T08:09:00Z", scenarioId: "unsafe-water",
    request: { scenarioId: "unsafe-water", evaluationHour: 1, horizonHours: 12, overrides: [] },
    baselineRevision: data.baselineRevision, modelVersion: data.modelVersion,
    baselineSnapshot: structuredClone(data), seed: data.scenarios.find((s) => s.id === "unsafe-water").seed,
    impacts: [["nursing-z", "nursing-safe-water", [2, 5], "dep-a-z"], ["dialysis-x", "dialysis-treatment", [3, 7], "dep-a-x"], ["hospital-y", "hospital-sterilization", [5, 9], "dep-a-y"]].map(([entityId, functionId, windowHours, dep]) => ({
      id: entityId, entityId, functionId, windowHours, lossType: "unsafe_treated_water", state: "at_risk", lossOfFunction: 1,
      evidenceStatus: "modeled", timingStatus: "interval", paths: [[dep]], sourceRefs: ["src-inventory"], assumptions: ["Captured reserve"],
    })), excluded: [{ dependencyId: "dep-a-f", reason: "loss type is not applicable", path: ["dep-a-f"] }], warnings: [],
  };
  return { id: "case-wall", title: "Wall case", status: "open", priority: "high", version: 1,
    createdAt: "2026-10-13T08:00:00Z", updatedAt: "2026-10-13T08:10:00Z", eventId: data.events[0].id,
    eventSnapshot: data.events[0], contextSnapshot: { provider: data.entities.find((e) => e.id === "utility-a"), serviceArea: data.entities.find((e) => e.id === "area-a"), warnings: [], sourceRefs: [], scenarios: [] },
    runId: run.id, runSnapshot: run, decisions: [], tasks: [], notes: [], activity: [] };
}
function records() {
  const r = structuredClone(supplied);
  r.statewideIncidents = r.incidents;
  r.statewideIncidents[0].caseId = "case-wall";
  r.statewideIncidents[0].status = "open";
  r.responseTasks = r.tasks;
  r.now = "2026-10-13T08:30:00Z";
  return r;
}
function props(view, r = records(), saved = incident()) {
  return { data, records: r, reference, incidents: [saved], selected: saved, view, onSelect() {}, onOpenAnalyst() {}, onNavigate() {} };
}

test("C4 has four record-bound summary tiles, including reference boil-water state", () => {
  const out = html(Command, props("consequence"));
  assert.match(out, /People in affected water service/);
  assert.match(out, /Critical facilities at risk/);
  assert.match(out, /Boil-water notice/);
  assert.match(out, /Possible/);
  assert.doesNotMatch(out, /Captured result groups/);
});
test("C4 timeline bars use exact captured windowHours, never subtract evaluation hour", () => {
  const saved = freeze(incident());
  const out = html(Network, { model: consequenceModel(saved), mode: "display" });
  assert.match(out, /class="cc-planning-timeline"/);
  assert.match(out, /data-window-start="2" data-window-end="5"/);
  assert.match(out, /left:16\.666666666666664%;width:25%/);
  for (const tick of ["0 h", "3 h", "6 h", "9 h", "12 h"]) assert.ok(out.includes(tick));
  assert.match(out, /not countdowns/);
});
test("C4 sector table includes the source, affected healthcare and explicitly excluded emergency dependency", () => {
  const out = html(Network, { model: consequenceModel(freeze(incident())), mode: "display", boilWaterLabel: "Boil-water notice: possible" });
  const table = out.match(/<table[^>]*class="[^"]*cc-sector-rollup[\s\S]*?<\/table>/)?.[0];
  assert.ok(table);
  assert.match(table, /Water \(12\)/);
  assert.match(table, /Healthcare and Public Health \(10\)/);
  assert.match(table, /Emergency Services \(6\)/);
  assert.match(table, /0 of 1/);
  assert.match(table, /loss type is not applicable/);
  assert.doesNotMatch(table, /Energy/);
});
test("C4 table does not declare an unmodeled dependency unaffected without explicit exclusion proof", () => {
  const saved = incident(); saved.runSnapshot.excluded = [];
  const out = html(Network, { model: consequenceModel(freeze(saved)), mode: "display" });
  const table = out.match(/<table[^>]*class="[^"]*cc-sector-rollup[\s\S]*?<\/table>/)?.[0];
  assert.match(table, /unaffected not established/);
});
// C1 has a separate, selection-free map and collapsible incident cards. C2
// retains the footprint renderer; equality with its old map is no longer a contract.
const cardsIn = out => [...out.matchAll(/<details\b[^>]*data-incident-card="([^"]+)"[^>]*>/g)];
const totalsIn = out => out.match(/<section[^>]*aria-label="Statewide totals"[\s\S]*?<\/section>/)?.[0];
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return isValidElement(value) ? [value, ...nodes(value.props.children)] : [];
}
function label(value) {
  if (Array.isArray(value)) return value.map(label).join("");
  if (isValidElement(value)) return label(value.props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function overviewHarness(extra = {}) {
  hooks.clear();
  const input = { ...props("command"), ...extra };
  const render = () => { hooks.reset(); return InteractiveOverview(input); };
  return { input, render };
}
const incidentCard = (tree, id) => nodes(tree).find(node => node.props["data-incident-card"] === id);
const button = (tree, text) => nodes(tree).find(node => ["button", "a"].includes(node.type) && label(node) === text);
const clickCard = (tree, id) => nodes(incidentCard(tree, id)).find(node => node.type === "summary").props.onClick({ preventDefault() {} });

test("C1 opens with four statewide tiles and closed cards beside decisions and facilities", () => {
  const out = html(Scripted, props("command"));
  assert.match(out, /class="c1-columns"/);
  assert.match(out, /class="c1-sidebar"/);
  assert.match(out, /Statewide picture/);
  for (const title of ["Decisions waiting on the Chief", "Critical infrastructure at risk", "From the analysts"]) assert.ok(out.includes(title));
  const tiles = totalsIn(out);
  assert.ok(tiles);
  assert.equal((tiles.match(/<button\b/g) ?? []).length, 4);
  for (const title of ["Active incidents", "People on unsafe water", "Earliest window", "Decisions waiting"]) assert.ok(tiles.includes(title));
  const cards = cardsIn(out);
  assert.equal(cards.length, records().statewideIncidents.filter(row => row.status !== "closed").length);
  for (const [tag] of cards) assert.doesNotMatch(tag, /\sopen(?:=|\s|>)/);
  assert.doesNotMatch(out, /TX-26-0398|data-register="active"|No incident selected|Select an incident to see its consequences|Sectors affected/);
  assert.match(out, /Closed incidents are on C6/);
  assert.match(html(Scripted, props("leadership")), /TX-26-0398/);
});
test("C1 uses its richer statewide map and complete legend, not the obsolete C2 folds", () => {
  const input = freeze(props("command"));
  const before = JSON.stringify(input);
  const out = html(Scripted, input);
  assert.match(out, /class="c1-map"/);
  for (const entry of ["High", "Medium", "Low", "Same attacker probed", "Service area at risk", "Cascading impact (pulsing)", "Approximate positions · click an incident to select it"]) assert.ok(out.includes(entry));
  assert.doesNotMatch(out, /Active infrastructure incidents|Recorded service footprints|\d+ mapped|class="sc-safe-map"/);
  assert.match(html(Scripted, { ...input, view: "cop" }), /What it touches · by sector/);
  assert.match(html(Scripted, { ...input, view: "cop" }), /Every asset, and why: C4/);
  assert.doesNotMatch(html(Scripted, { ...input, view: "cop" }), /class="sf-state-map"/);
  assert.equal(JSON.stringify(input), before);
});
test("C1 and C2 never fabricate a pin for a record without a source position", () => {
  const r = records();
  r.statewideIncidents.push({ id: "no-location", title: "Unlocated water incident", status: "open", severity: "high" });
  for (const view of ["command"]) {
    const out = html(Scripted, props(view, freeze(r)));
    assert.doesNotMatch(out, /data-incident-pin="no-location"/);
    assert.match(out, /Unlocated water incident/);
    // SSR has no measured viewport, so C1 can use its safe list fallback.
    assert.match(out, /Location not recorded/);
  }
  const c2 = html(Scripted, props("cop", freeze(r)));
  assert.doesNotMatch(c2, /data-incident-pin="no-location"|data-state-boundary="texas"/);
  assert.match(c2, /What it touches · by sector/);
  assert.match(c2, /Every asset, and why: C4/);
  // C2 exposes other incidents only inside its searchable closed-by-default picker.
  assert.doesNotMatch(c2, /Unlocated water incident/);
});
test("C1 cards sort by severity then newest start, never by the selected case", () => {
  const r = records();
  r.statewideIncidents.push(
    { id: "older-high", title: "Older high severity", status: "open", severity: "high", startedAt: "2026-10-13T05:00:00Z" },
    { id: "newer-high", title: "Newer high severity", status: "open", severity: "high", startedAt: "2026-10-13T08:20:00Z" },
  );
  const ids = cardsIn(html(Scripted, props("command", freeze(r)))).map(match => match[1]);
  assert.deepEqual(ids.slice(0, 3), ["newer-high", "TX-26-0412", "older-high"]);
  assert.ok(ids.includes("TX-26-0411"), "monitoring incidents remain listed");
  assert.ok(ids.includes("TX-26-0404"), "recovering incidents remain listed without pulsing");
});
test("C1 never reports unmodeled people as zero or a captured population, and pending count stays computed", () => {
  const r = records(), saved = incident(); saved.runId = null; saved.runSnapshot = null;
  const before = html(Scripted, props("command", r, saved));
  const tiles = totalsIn(before);
  assert.doesNotMatch(tiles, /18,000|Not captured/);
  assert.match(tiles, /<strong>Not yet modeled<\/strong>[\s\S]*People on unsafe water/);
  assert.match(tiles, /<strong>Not yet modeled<\/strong>[\s\S]*Earliest window/);
  r.decisions = reference.responseOptions.map(option => ({ id: option.id, optionId: option.id, caseId: saved.id, decision: "approved" }));
  const after = html(Scripted, props("command", r, saved));
  assert.match(after, /data-pending-decisions="0"/);
  assert.match(totalsIn(after), /<strong>0<\/strong>[\s\S]*Decisions waiting/);
});
test("C1 captured population, earliest window and decision/facility panels remain statewide without selection", () => {
  const input = freeze(props("command"));
  const selected = html(Scripted, input);
  const none = html(Scripted, { ...input, selected: null });
  assert.equal(selected, none, "selection must not change any C1 totals or panels");
  assert.match(totalsIn(none), /18,000/);
  assert.match(totalsIn(none), /2–5 h/);
  assert.match(none, /Boil-water notice: possible/);
  for (const id of ["c1-decisions-heading", "c1-facilities-heading"]) {
    const panel = none.match(new RegExp(`<section[^>]*aria-labelledby="${id}"[\\s\\S]*?<\\/section>`))?.[0];
    assert.ok(panel?.includes("TX-26-0412"), `${id}: every panel identifies its incident`);
  }
  assert.doesNotMatch(none, /aria-selected="true"|reviews recorded/);
});
test("C1 cards toggle exclusively; map picks only open a card, without selecting a case", t => {
  const calls = [];
  const { render } = overviewHarness({ onSelect: id => calls.push(id) });
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  t.after(() => { if (original) globalThis.requestAnimationFrame = original; else delete globalThis.requestAnimationFrame; });
  let tree = render();
  assert.ok(nodes(tree).filter(node => node.props["data-incident-card"]).every(node => !node.props.open));
  clickCard(tree, "TX-26-0412"); tree = render();
  assert.equal(incidentCard(tree, "TX-26-0412").props.open, true);
  assert.match(label(incidentCard(tree, "TX-26-0412")), /18,000/);
  clickCard(tree, "TX-26-0409"); tree = render();
  assert.equal(incidentCard(tree, "TX-26-0412").props.open, false);
  assert.equal(incidentCard(tree, "TX-26-0409").props.open, true);
  assert.match(label(incidentCard(tree, "TX-26-0409")), /60% of priority servers restored/);
  clickCard(tree, "TX-26-0409"); tree = render();
  assert.equal(incidentCard(tree, "TX-26-0409").props.open, false);
  const map = nodes(tree).find(node => typeof node.props.onPick === "function");
  assert.ok(map, "the map exposes incident picking");
  map.props.onPick("TX-26-0411"); tree = render();
  assert.equal(incidentCard(tree, "TX-26-0411").props.open, true);
  assert.deepEqual(calls, [], "expansion is not per-incident Command Center selection");
});
test("C1 expanded cards keep sector names and IDT codes", () => {
  const { render } = overviewHarness();
  let tree = render(); clickCard(tree, "TX-26-0412"); tree = render();
  const sectors = nodes(incidentCard(tree, "TX-26-0412")).find(node => node.props.className === "c1-detail-facts");
  assert.match(label(sectors), /Water/);
  assert.match(label(sectors), /\b12\b/);
  assert.match(label(sectors), /\b10\b/);
});
test("C1 statewide tiles drill into C4 and C6 rather than changing their totals", () => {
  const calls = [];
  const { render } = overviewHarness({ onSelect: id => calls.push(["case", id]), onNavigate: view => calls.push(["view", view]) });
  const tree = render();
  const totals = nodes(tree).find(node => node.props["aria-label"] === "Statewide totals");
  const tiles = nodes(totals).filter(node => node.type === "button");
  for (const [title, view] of [["People on unsafe water", "consequence"], ["Earliest window", "consequence"], ["Decisions waiting", "leadership"]]) {
    const tile = tiles.find(node => nodes(node).some(child => child.type === "b" && label(child) === title));
    assert.ok(tile, title);
    tile.props.onClick();
    assert.deepEqual(calls.splice(0), [["case", "case-wall"], ["view", view]], title);
  }
});
test("C1 pending decisions include record-only incidents and the analyst strip shows the latest three updates", () => {
  const r = records();
  r.decisions = [{ id: "county-review", incidentId: "TX-26-0411", title: "County authorization", status: "pending", windowLabel: "Before alert service degrades" }];
  r.statewideIncidents[1].updates = [{ at: "2026-10-13T08:01:00Z", text: "Oldest update omitted" }, { at: "2026-10-13T08:28:00Z", text: "Latest restoration update" }];
  r.statewideIncidents[2].updates = [{ at: "2026-10-13T08:20:00Z", text: "Earlier county update" }, { at: "2026-10-13T08:29:00Z", text: "Newest county update" }];
  const out = html(Scripted, { ...props("command", freeze(r)), selected: null });
  const decisions = out.match(/<section[^>]*aria-labelledby="c1-decisions-heading"[\s\S]*?<\/section>/)?.[0];
  assert.match(decisions, /County authorization/);
  assert.match(decisions, /TX-26-0411/);
  assert.match(decisions, /Before alert service degrades/);
  const strip = out.match(/<section[^>]*aria-labelledby="c1-updates-heading"[\s\S]*?<\/section>/)?.[0];
  assert.ok(strip);
  assert.doesNotMatch(strip, /Oldest update omitted/);
  assert.ok(strip.indexOf("Newest county update") < strip.indexOf("Latest restoration update"));
  assert.ok(strip.indexOf("Latest restoration update") < strip.indexOf("Earlier county update"));
  assert.equal((strip.match(/<time\b/g) ?? []).length, 3);
  assert.match(strip, /All updates in Analyst ↗/);
});
test("C1 modeled card links dispatch C2/C3/C4 with its case and one contextual Analyst action", () => {
  const calls = [];
  const { render } = overviewHarness({ onSelect: id => calls.push(["case", id]), onNavigate: view => calls.push(["view", view]), onOpenAnalyst: (...args) => calls.push(["analyst", ...args]) });
  let tree = render(); clickCard(tree, "TX-26-0412"); tree = render();
  const card = incidentCard(tree, "TX-26-0412");
  for (const [text, view] of [["C2 Incident →", "cop"], ["C3 Attack →", "cyber"], ["C4 Impact →", "consequence"]]) {
    const action = button(card, text);
    assert.ok(action, text);
    action.props.onClick();
    assert.deepEqual(calls.splice(0), [["case", "case-wall"], ["view", view]]);
  }
  const analyst = button(card, "Case file in Analyst ↗");
  assert.ok(analyst);
  assert.doesNotMatch(analyst.props.className ?? "", /(?:^|\s)(?:primary|btn-primary)(?:\s|$)/);
  analyst.props.onClick();
  assert.deepEqual(calls.splice(0), [["analyst", "case-file", "case-wall", "utility-a"]]);
  clickCard(tree, "TX-26-0409"); tree = render();
  const unmodeled = incidentCard(tree, "TX-26-0409");
  assert.ok(button(unmodeled, "C2 Incident →"));
  assert.equal(button(unmodeled, "C3 Attack →"), undefined);
  assert.equal(button(unmodeled, "C4 Impact →"), undefined);
  const alert = button(unmodeled, "Alerts in Analyst ↗");
  assert.ok(alert);
  assert.doesNotMatch(alert.props.className ?? "", /(?:^|\s)(?:primary|btn-primary)(?:\s|$)/);
  alert.props.onClick();
  assert.equal(calls[0]?.[0], "analyst");
  assert.equal(calls[0]?.[1], "command");
  assert.equal(calls[0]?.[2], null);
});
test("C1 cascades appear only from a latest downstream run, independent of severity", () => {
  const r = records(), saved = incident();
  const card = (records, saved) => cardsIn(html(Scripted, props("command", records, saved))).find(match => match[1] === "TX-26-0412")?.[0];
  assert.match(card(r, saved), /data-cascading="true"/);
  r.statewideIncidents[0].severity = "medium";
  assert.match(card(r, saved), /data-cascading="true"/);
  saved.runSnapshot.impacts = [];
  assert.doesNotMatch(card(r, saved), /data-cascading/);
  saved.runSnapshot = null;
  assert.doesNotMatch(card(r, saved), /data-cascading/);
  for (const status of ["recovering", "closed"]) {
    const source = records(); source.statewideIncidents[0].status = status;
    const saved = incident(); saved.status = status;
    const out = html(Scripted, props("command", source, saved));
    assert.doesNotMatch(cardsIn(out).find(match => match[1] === "TX-26-0412")?.[0] ?? "", /data-cascading/);
  }
});
test("Schematic uses a deterministic safe label grid and never mutates authored coordinates", () => {
  const items = freeze(Array.from({ length: 12 }, (_, index) => ({ id: `pin-${index}`, title: `Long authored incident label ${index}`, schematic: { x: 52, y: 58 } })));
  const before = JSON.stringify(items);
  const out = html(Schematic, { items, active: "pin-1", label: "Safe labels", onSelect() {} });
  assert.match(out, /class="sc-safe-labels"/);
  assert.equal((out.match(/data-label-anchor=/g) ?? []).length, items.length);
  assert.equal(JSON.stringify(items), before);
  assert.equal(out, html(Schematic, { items, active: "pin-1", label: "Safe labels", onSelect() {} }));
});
test("overview map renders sector pictograms, matching icon legends and no illustrative-purpose note", () => {
  const items = freeze([
    { id: "water", title: "Water utility", sectors: ["12"], schematic: { x: 52, y: 58 } },
    { id: "power", title: "Electric power substation", schematic: { x: 50, y: 40 } },
    { id: "health", title: "Hospital network", sectors: ["10"], schematic: { x: 65, y: 65 } },
  ]);
  const out = html(Schematic, { items, active: "water", onSelect() {}, label: "Incident map" });
  for (const kind of ["water", "power", "health"]) {
    assert.match(out, new RegExp(`data-infrastructure-icon="${kind}"`));
    assert.match(out, new RegExp(`data-infrastructure-kind="${kind}"`));
  }
  assert.match(out, /aria-label="Infrastructure types"/);
  assert.doesNotMatch(out, /Illustrative positions|Not precise locations|<text/);
});
test("C5 team marker mode retains immutable coordinates, stable initials and separated anchors", () => {
  const r = records();
  const teams = freeze(r.teams.map((team) => ({ ...team, schematic: { x: 52, y: 58 } })));
  const before = JSON.stringify(teams);
  const input = { items: teams, active: teams[0].id, onSelect() {}, label: "Teams", mode: "teams", incidents: freeze(r.statewideIncidents.slice(0, 1)) };
  const out = html(Schematic, input);
  assert.equal(out, html(Schematic, input));
  assert.equal(JSON.stringify(teams), before);
  assert.match(out, /data-marker-mode="teams"/);
  assert.match(out, /data-team-status="en_route"/);
  assert.match(out, /data-team-status="on_site"/);
  assert.match(out, /data-team-status="standby"/);
  assert.match(out, />CA<\/text>/);
  assert.match(out, />CB<\/text>/);
  assert.match(out, /data-incident-id="TX-26-0412"/);
  const anchors = [...out.matchAll(/<g[^>]*class="sc-safe-anchor[^>]*>[\s\S]*?<circle cx="([^"]+)" cy="([^"]+)"/g)].map((match) => [Number(match[1]), Number(match[2])]);
  assert.equal(anchors.length, teams.length);
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) assert.ok(Math.hypot(anchors[i][0] - anchors[j][0], anchors[i][1] - anchors[j][1]) >= 28);
});
test("C5 shows incident, assignment, forensics and latest update outside disclosures", () => {
  const r = freeze(records());
  const out = html(Scripted, props("uctf", r));
  assert.match(out, /Incident: TX-26-0412/);
  assert.match(out, /<h4>Working on<\/h4>/);
  assert.match(out, /<h4>Forensics<\/h4>/);
  const table = out.match(/<table class="command-table sc-team-register">[\s\S]*?<\/table>/)?.[0];
  for (const team of r.teams) if (team.updates?.length === 1) assert.ok(table.includes(`<small class="sc-team-latest">${team.updates[0].text}`));
});
test("C5 visible response bar uses recorded time and supplied amber/red thresholds", () => {
  for (const [now, tone, elapsed] of [["2026-10-13T08:30:00Z", "normal", 30], ["2026-10-13T09:05:00Z", "amber", 65], ["2026-10-13T09:35:00Z", "red", 95]]) {
    const r = records(); r.now = now;
    const out = html(Scripted, props("uctf", freeze(r)));
    assert.match(out, new RegExp(`<div class="sc-clock-details" data-clock-tone="${tone}">`));
    assert.match(out, new RegExp(`role="progressbar" aria-label="Response clock" aria-valuemin="0" aria-valuemax="120" aria-valuenow="${elapsed}"`));
    assert.doesNotMatch(out, /<details class="sc-clock-details"/);
  }
  const custom = structuredClone(reference); custom.responseClock.amberMinutes = 10; custom.responseClock.redMinutes = 20;
  assert.match(html(Scripted, { ...props("uctf"), reference: freeze(custom) }), /<div class="sc-clock-details" data-clock-tone="red">/);
});
test("Leadership Brief retains archived summaries while exposing only its selected preview", () => {
  const source = freeze(records());
  const before = JSON.stringify(source);
  const out = html(Scripted, props("leadership", source));
  assert.match(out, /Credential phishing contained/);
  assert.match(out, /id="brief-summary-TX-26-0398"[^>]*hidden=""/);
  assert.match(out, /aria-controls="brief-summary-/);
  assert.match(out, /aria-pressed="true"/);
  assert.match(out, /Open full case file/);
  assert.equal(JSON.stringify(source), before);
});
test("C6 default story includes every linked event, including drift and both probes, from bound records", () => {
  const d = structuredClone(data);
  d.events.find((event) => event.id === "event-sensor").label = "Authored water drift observation";
  const saved = incident(); saved.eventSnapshot = d.events[0];
  const r = freeze(records());
  const before = JSON.stringify({ d, r, saved });
  const out = html(Scripted, { ...props("leadership", r, freeze(saved)), data: freeze(d) });
  const story = out.match(/<p class="sc-brief-story">[\s\S]*?<\/p>/)?.[0];
  assert.ok(story);
  for (const event of d.events) {
    assert.ok(story.includes(`data-story-event="${event.id}"`));
    assert.ok(story.includes(event.label));
  }
  assert.match(story, /Authored water drift observation/);
  assert.match(story, /Utility B/); assert.match(story, /Utility C/);
  assert.doesNotMatch(story, /<details/);
  assert.equal(JSON.stringify({ d, r, saved }), before);
});
test("C6 preserves all option records and puts basis before the final decision chip", () => {
  const r = freeze(records());
  const out = html(Scripted, props("leadership", r));
  const cards = [...out.matchAll(/<article class="sc-option"[^>]*>[\s\S]*?<\/article>/g)].map((match) => match[0]);
  assert.equal(cards.length, reference.responseOptions.length);
  for (const option of reference.responseOptions) {
    const card = cards.find((card) => card.includes(`data-option-id="${option.id}"`));
    assert.ok(card.includes(option.title));
    assert.ok(card.includes(option.basisText));
    assert.ok(card.indexOf("Basis:") < card.indexOf('class="sc-option-decision"'));
    assert.match(card, /class="sc-option-decision"><span class="status-chip[^>]*>[^<]+<\/span><\/div><\/article>$/);
  }
  assert.match(out, /data-decision="chosen"/);
  assert.match(out, /data-decision="standing_by"/);
  assert.match(out, /data-decision="none"/);
  const styles = readFileSync(new URL("scripted-command.css", root), "utf8");
  assert.match(styles, /\[data-decision="chosen"\][^{]*\{[^}]*background: var\(--green-bg\)/);
  assert.match(styles, /\[data-decision="none"\][^{]*\{[^}]*background: var\(--amber-bg\)/);
  assert.match(styles, /\[data-decision="standing_by"\][^{]*\{[^}]*background: var\(--blue-bg\)/);
});
test("C3 groups only probe presentation while retaining all seven event records and techniques", () => {
  const r = freeze(records());
  const before = JSON.stringify(r);
  const out = html(Scripted, props("cyber", r));
  assert.equal((out.match(/class="sc-stage-card"/g) ?? []).length, 6);
  for (const event of data.events) assert.ok(out.includes(`data-event-id="${event.id}"`));
  for (const technique of ["T0822", "T0859", "T0886", "T0836", "T0831", "T0846"]) assert.ok(out.includes(technique));
  assert.match(out, /Probes at Utility B and Utility C/);
  assert.equal(JSON.stringify(r), before);
});
test("Attack Picture keeps full evidence behind compact attribution and hunt details", () => {
  const out = html(Scripted, props("cyber"));
  assert.match(out, /class="sc-attribution-heading"/);
  assert.match(out, /class="sc-hunt-heading"/);
  assert.match(out, /class="sc-stage-evidence"/);
  assert.match(out, /Assessment detail/);
  assert.match(out, /Shared attacker source/);
  assert.match(out, /203\.0\.113\.250/);
  assert.match(out, /Vendor V account sweep/);
  assert.match(out, /Hunt details/);
});
test("C7 contact tiles count actual reached records, preserve consent and omit invented times", () => {
  const r = records();
  r.contacts.push({ id: "other-case-contact", incidentId: "unrelated", group: "act", status: "contacted", partnerRole: "Other case" });
  freeze(r);
  const before = JSON.stringify(r);
  const out = html(Scripted, props("federation", r));
  assert.match(out, /data-contact-group="act"><strong>1 of 4<\/strong>/);
  assert.match(out, /data-contact-group="know"><strong>1 of 5<\/strong>/);
  assert.match(out, /data-contact-group="helping"><strong>2 of 6<\/strong>/);
  assert.match(out, /<time>—<\/time>/);
  assert.doesNotMatch(out, /Other case|Time not recorded/);
  for (const name of ["TXCC (CTIC, UCTF)", "Water-sector partners", "TDEM and healthcare", "Federal partners", "Draft · not sent", "Not shared · no owner consent"])
    assert.ok(out.includes(name), name);
  assert.match(out, /CITRIDE does not send notifications/);
  assert.equal(JSON.stringify(r), before);
});
test("C7 contact metrics follow changed statuses and selected-case local scope", () => {
  const r = records();
  r.contacts[0].status = "not_yet";
  const out = html(Scripted, props("federation", freeze(r)));
  assert.match(out, /data-contact-group="act"><strong>0 of 4<\/strong>/);
  const empty = html(Scripted, props("federation", freeze(records()), { ...incident(), id: "case-no-contacts", eventId: "unrelated-event" }));
  assert.match(empty, /data-contact-group="act"><strong>0 of 0<\/strong>/);
  assert.doesNotMatch(empty, /class="sc-contact-row"/);
});

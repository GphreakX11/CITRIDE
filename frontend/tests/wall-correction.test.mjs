import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";

const root = new URL("../src/", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const data = read("../../data/scenario.json");
const supplied = read("../../data/scripted/watershed_beta.json");
const reference = read("../../data/reference.json");
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (await transformWithOxc(readFileSync(url, "utf8"), url.pathname, { jsx: { runtime: "automatic" } })).code
    .replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    let target;
    if (m[1].startsWith(".")) {
      let next = new URL(m[1], url);
      if (!existsSync(next)) next = new URL(`${m[1]}.ts`, url);
      target = await compile(next);
    } else target = import.meta.resolve(m[1]);
    imports.set(m[1], target);
  }
  code = code.replace(/from\s+["']([^"']+)["']/g, (_, s) => `from ${JSON.stringify(imports.get(s))}`);
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, result);
  return result;
}
const module = async (name) => import(await compile(new URL(name, root)));
const { consequenceModel } = await module("commandCenterModel.ts");
const { default: Network } = await module("components/DependencyNetwork.tsx");
const { default: Command } = await module("CommandCenterViews.tsx");
const { default: Scripted, Schematic } = await module("ScriptedCommandViews.tsx");
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
  r.storyNow = "2026-10-13T08:30:00Z";
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
test("C1 stacks map and active register beside decision support; closed records remain available on the brief only", () => {
  const out = html(Scripted, props("command"));
  assert.match(out, /class="sc-overview-layout"/);
  assert.match(out, /class="sc-overview-main"/);
  assert.match(out, /class="sc-overview-sidebar"/);
  assert.match(out, /Decisions waiting on the Chief/);
  assert.match(out, /Critical facilities at risk/);
  assert.match(out, /From the analysts/);
  const active = out.match(/<table[^>]*data-register="active"[\s\S]*?<\/table>/)?.[0];
  assert.ok(active);
  assert.doesNotMatch(active, /TX-26-0398/);
  assert.doesNotMatch(out, /TX-26-0398/);
  assert.match(html(Scripted, props("leadership")), /TX-26-0398/);
  assert.doesNotMatch(out, /\d+ minutes/);
});
test("C1 active register keeps the open Watershed case first, then severity and recorded start", () => {
  const r = records();
  r.statewideIncidents.push({ id: "early-high", title: "Earlier high severity", status: "open", severity: "high", startedAt: "2026-10-13T05:00:00Z", location: { label: "Authored" } });
  const out = html(Scripted, props("command", freeze(r)));
  const active = out.match(/<table[^>]*data-register="active"[\s\S]*?<\/table>/)?.[0];
  assert.ok(active.indexOf("Water utility cyber attack") < active.indexOf("Earlier high severity"));
  assert.equal((active.match(/<tr/g) ?? []).length, r.statewideIncidents.filter((row) => row.status !== "closed").length + 1);
});
test("C1 pending count remains computed and source population is shown before modeling", () => {
  const r = records(); const saved = incident(); saved.runId = null; saved.runSnapshot = null;
  const before = html(Scripted, props("command", r, saved));
  assert.match(before, /18,000/);
  assert.match(before, /Not yet modeled/);
  r.decisions = reference.responseOptions.map((option) => ({ id: option.id, optionId: option.id, caseId: saved.id, decision: "approved" }));
  const after = html(Scripted, props("command", r, saved));
  assert.match(after, /<strong>0<\/strong><span>Decisions waiting on the Chief/);
});
test("C1 shows captured earliest window, boil-water notice, selected row and review progress", () => {
  const saved = incident();
  saved.decisions = [{ id: "review-one", reviewed: true }, { id: "review-two", reviewed: false }];
  const out = html(Scripted, props("command", freeze(records()), saved));
  assert.match(out, /Earliest window: 2–5 h/);
  assert.match(out, /Boil-water notice: possible/);
  assert.match(out, /<tr class="selected" aria-selected="true"/);
  assert.match(out, /1 of 2 reviews recorded/);
  assert.match(out, /Linked probes at 2 utilities/);
  assert.match(out, /Containment/);
  assert.match(out, /Recovering/);
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
  for (const [storyNow, tone, elapsed] of [["2026-10-13T08:30:00Z", "normal", 30], ["2026-10-13T09:05:00Z", "amber", 65], ["2026-10-13T09:35:00Z", "red", 95]]) {
    const r = records(); r.storyNow = storyNow;
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

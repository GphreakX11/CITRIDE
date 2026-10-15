import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  audiencePreview, capturedClassification, consequenceModel, contextChain,
  eventTimeline, formattedBrief, leadershipDraft, originLabel, overviewModel,
  planningWindow, recordedActivity, recordedTasks, sourceLabels, timeLabel,
} from "../src/commandCenterModel.ts";

const baseline = JSON.parse(readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"));
function fixture(overrides = {}) {
  const context = {
    baselineRevision: baseline.baselineRevision, event: baseline.events[0],
    cyberAsset: baseline.entities.find((e) => e.id === "cyber-plc-a"),
    physicalAsset: baseline.entities.find((e) => e.id === "plc-a"),
    facility: baseline.entities.find((e) => e.id === "plant-a"),
    provider: baseline.entities.find((e) => e.id === "utility-a"),
    serviceArea: baseline.entities.find((e) => e.id === "area-a"),
    downstreamDependencies: [], scenarios: [], sourceRefs: ["src-network"], warnings: [],
  };
  const impact = { id: "fixture-impact", entityId: "dialysis-x", functionId: "fixture-function", lossType: "unsafe_treated_water", state: "at_risk", evidenceStatus: "modeled", windowHours: [2, 4], timingStatus: "interval", lossOfFunction: 1, paths: [["fixture-dependency"]], sourceRefs: ["src-dependencies"], assumptions: ["Fixture reserve assumption"] };
  const run = { id: "fixture-run", createdAt: "2026-10-14T12:01:00Z", scenarioId: "fixture-scenario", baselineRevision: baseline.baselineRevision, modelVersion: baseline.modelVersion, request: { scenarioId: "fixture-scenario", evaluationHour: 0, horizonHours: 12, overrides: [] }, seed: { provider: "utility-a", service: "treated_water", lossType: "unsafe_treated_water", windowHours: [0, 0], persistsThroughHour: 12, eventRefs: [baseline.events[0].id], sourceRefs: ["src-effects"] }, impacts: [impact], excluded: [], warnings: [], baselineSnapshot: { ...structuredClone(baseline), serviceFunctions: [{ id: "fixture-function", label: "Captured treatment function" }], dependencies: [{ id: "fixture-dependency", provider: "utility-a", dependent: "dialysis-x", requiredService: "treated_water", usableBackupMinHours: 2, usableBackupMaxHours: 4 }] } };
  return { id: "fixture-case", version: 1, title: "Captured fixture case", priority: "high", status: "open", createdAt: "2026-10-14T12:00:00Z", updatedAt: "2026-10-14T12:03:00Z", closedAt: null, closureNote: null, eventId: baseline.events[0].id, baselineRevision: baseline.baselineRevision, eventSnapshot: structuredClone(baseline.events[0]), contextSnapshot: context, tasks: [{ id: "task", label: "Preserve captured evidence", completed: false, completedAt: null }], decisions: [{ id: "review", title: "Advisory review", entityId: "dialysis-x", entityLabel: "Captured dialysis", functionId: "fixture-function", functionLabel: "Captured function", state: "at_risk", windowHours: [2, 4], sourceRefs: [], sourceSnapshots: [], assumptions: [], reviewed: false, reviewedAt: null, reviewNote: null, authorityBasis: "not_configured", gateStatus: "not_evaluated" }], notes: [], activity: [{ id: "activity", kind: "created", message: "Case opened from captured observation", createdAt: "2026-10-14T12:00:00Z" }], runId: run.id, runSnapshot: run, ...overrides };
}
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); for (const item of Object.values(value)) freeze(item); }
  return value;
}

test("empty cases never manufacture incidents, population, teams or actions", () => {
  const overview = overviewModel([]);
  assert.equal(overview.metrics.activeIncidents, 0);
  assert.equal(overview.people, null);
  assert.equal(overview.classifiedSectors, 0);
  assert.deepEqual(overview.activity, []);
  assert.deepEqual(recordedTasks([]), []);
  assert.equal(consequenceModel(null).run, null);
});

test("saved case counts and activity ignore alerts and retain closed register records", () => {
  const open = fixture();
  const closed = fixture({ id: "closed", status: "closed", activity: [{ id: "later", kind: "closed", message: "Tracking closed", createdAt: "2026-10-14T12:04:00Z" }] });
  const model = overviewModel(freeze([open, closed]));
  assert.equal(model.active.length, 1);
  assert.equal(model.metrics.closedIncidents, 1);
  assert.equal(model.pending.length, 1);
  assert.equal(model.activity[0].message, "Tracking closed");
  assert.equal(recordedTasks([open, closed]).length, 2);
  assert.equal(baseline.events.length > model.active.length, true);
});

test("captured labels, assumptions, paths and timing do not depend on current baseline", () => {
  const record = fixture();
  record.runSnapshot.baselineSnapshot.entities.find((e) => e.id === "dialysis-x").label = "Captured facility only";
  const before = structuredClone(record);
  const model = consequenceModel(freeze(record));
  assert.equal(model.rows[0].label, "Captured facility only");
  assert.equal(model.rows[0].functionLabel, "Captured treatment function");
  assert.match(model.rows[0].chains[0][0], /Captured facility only/);
  assert.deepEqual(model.rows[0].assumptions, ["Fixture reserve assumption"]);
  assert.deepEqual(record, before);
  assert.deepEqual(model.earliest, [2, 4]);
});

test("missing snapshot labels and IDT remain missing; no lookup by known seed ID", () => {
  const record = fixture();
  record.runSnapshot.baselineSnapshot = {};
  const model = consequenceModel(record);
  assert.equal(model.rows[0].label, "Captured facility label unavailable");
  assert.equal(model.rows[0].classification.classified, false);
  assert.equal(model.people, null);
  assert.equal(model.sourceLabel, "Source label not captured");
  assert.match(model.groups[0].label, /IDT unavailable/);
  assert.equal(capturedClassification({ id: "dialysis-x", type: "DialysisCenter" }).classified, false);
});

test("IDT rollups use only captured paths, unique entities and explicit unknown groups", () => {
  const record = fixture();
  const captured = record.runSnapshot.baselineSnapshot;
  captured.entities.find((e) => e.id === "dialysis-x").idt = { status: "coded", path: "10.1.2.4" };
  record.runSnapshot.impacts.push({ ...record.runSnapshot.impacts[0], id: "second-function", functionId: "other", windowHours: [4, 8] });
  const model = consequenceModel(record);
  assert.equal(model.groups[0].key, "idt:10");
  assert.equal(model.groups[0].count, 1);
  assert.equal(model.facilities, 1);
  assert.equal(model.groups[0].items.length, 2);
  assert.equal(model.rows[0].classification.lineage, "Captured IDT 10.1.2.4");
  assert.equal(capturedClassification({ type: "Facility", idt: { status: "coded", path: "bad" } }).classified, false);
});

test("service-area population is captured, deduplicated and never facility occupancy or probe exposure", () => {
  const a = fixture();
  const b = fixture({ id: "second" });
  assert.equal(consequenceModel(a).people, 18000);
  assert.equal(overviewModel([a, b]).people, 18000);
  b.runSnapshot.baselineSnapshot.entities.find((e) => e.id === "population-a").count = 17000;
  assert.equal(overviewModel([a, b]).people, null);
  assert.equal(consequenceModel(fixture({ runSnapshot: null, runId: null })).people, null);
  assert.equal(consequenceModel(a).rows.some((row) => /utility-[bc]/.test(row.entityId)), false);
});

test("event timeline shows all supplied sources but only marks the captured anchor", () => {
  const record = fixture();
  record.eventSnapshot.label = "Historical anchor";
  record.eventSnapshot.origin = "analyst";
  const timeline = eventTimeline(freeze(structuredClone(baseline)), freeze(record));
  assert.equal(timeline.length, baseline.events.length);
  assert.equal(timeline.filter((row) => row.captured).length, 1);
  assert.equal(timeline.find((row) => row.captured).label, "Historical anchor");
  assert.equal(timeline.find((row) => row.captured).origin, "analyst");
  assert.equal(timeline.find((row) => row.event.id === "event-probe-b").captured, false);
  assert.equal(timeline.every((row) => row.origin !== "Origin not recorded"), true);
  assert.equal(originLabel({}), "Origin not recorded");
});

test("briefs have formatted sections, captured provenance and never claim Chief decisions or dispatch", () => {
  const record = fixture();
  const text = formattedBrief(freeze(record), "SITREP for TDEM");
  for (const label of ["# SITREP for TDEM", "Draft — not sent", "## What happened", "## So what", "## Recorded next steps", "src-network", "Policy gates not evaluated", "not populated"]) assert.ok(text.includes(label), label);
  assert.equal(text.includes("people on unsafe water"), false);
  assert.equal(leadershipDraft(fixture({ runSnapshot: null })).impacts.length, 0);
  assert.match(text, /do not authorize dispatch/);
});

test("external audience projections omit every identifying or free-form input", () => {
  const record = fixture({ title: "PRIVATE CASE", notes: [{ id: "note", text: "PRIVATE NOTE" }] });
  record.runSnapshot.baselineSnapshot.entities.find((e) => e.id === "dialysis-x").label = "PRIVATE FACILITY";
  record.eventSnapshot.description = "PRIVATE ACCOUNT";
  for (const audience of ["water", "health", "federal"]) {
    const text = JSON.stringify(audiencePreview(audience, freeze(record)));
    for (const blocked of ["PRIVATE CASE", "PRIVATE NOTE", "PRIVATE FACILITY", "PRIVATE ACCOUNT", "src-network", "utility-a", "dialysis-x"]) assert.equal(text.includes(blocked), false, `${audience}: ${blocked}`);
    assert.match(text, /Draft — not sent/);
    assert.match(text, /not an access-control or release decision/);
  }
});

test("unknown source/time/window values are not silently given invented metadata", () => {
  assert.equal(timeLabel("bad"), "Time not recorded");
  assert.equal(planningWindow(null), "Timing unknown");
  assert.equal(sourceLabels(["missing"], [])[0].label, "Source label not captured");
  assert.deepEqual(recordedActivity([]), []);
  const record = fixture(); record.contextSnapshot.physicalAsset = record.contextSnapshot.cyberAsset;
  assert.equal(contextChain(record).length, 4);
});

import "./configured-time-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  incidentNodeState,
  groupIncidentNodeState,
  groupIncidentFacilities,
  incidentStack,
} from "../src/incidentStack.ts";

const entity = (id, extra = {}) => ({
  id,
  label: id.toUpperCase(),
  type: "Facility",
  sourceRefs: [],
  ...extra,
});
const dependency = (provider, dependent, extra = {}) => ({
  id: `${provider}-${dependent}`,
  revision: 1,
  provider,
  dependent,
  requiredService: "clean_supply",
  dependentFunction: "care",
  sourceRefs: [],
  ...extra,
});
const impact = (entityId, windowHours, extra = {}) => ({
  id: `impact-${entityId}`,
  entityId,
  functionId: "care",
  state: "at_risk",
  lossType: "unsafe_supply",
  evidenceStatus: "modeled",
  windowHours,
  timingStatus: windowHours ? "bounded" : "unknown",
  paths: [],
  sourceRefs: [],
  assumptions: [],
  ...extra,
});
function context(extra = {}) {
  return {
    sourceId: "provider",
    lossType: "unsafe_supply",
    serviceAreaIds: ["area"],
    entities: [
      entity("provider", { idt: { status: "coded", path: "12.6" } }),
      entity("facility"),
      entity("supplier", { idt: { status: "coded", path: "5.1.3" } }),
    ],
    dependencies: [
      dependency("provider", "facility"),
      dependency("supplier", "provider"),
    ],
    assetStatuses: [],
    events: [],
    run: { impacts: [], excluded: [] },
    ...extra,
  };
}
const state = (id, extra) => incidentNodeState(id, context(extra));
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test("rule 1: source wins all competing evidence and uses recorded loss type", () => {
  const s = state("provider", {
    run: null,
    assetStatuses: [{ entityId: "provider", status: "probed" }],
  });
  assert.deepEqual(s, {
    tone: "red",
    line: "solid",
    label: "IDT 12.6 · unsafe supply",
    doubleRing: true,
  });
});
test("rule 2: hosted and partOf manipulated controller makes its plant red with recorded change/time", () => {
  const c = context({
    entities: [
      entity("plant", {
        idt: { status: "coded", path: "12.4" },
        hostsCyberAsset: ["identity"],
      }),
      entity("plc", { partOf: "plant" }),
      entity("identity", { type: "CyberAsset", hostedBy: "plc" }),
    ],
    assetStatuses: [
      {
        entityId: "identity",
        status: "manipulated",
        detail: "dosing changed",
        at: "2026-10-13T07:00:00Z",
      },
    ],
    run: { impacts: [impact("plant", [8, 12])], excluded: [] },
  });
  const s = incidentNodeState("plant", freeze(c));
  assert.equal(s.tone, "red");
  assert.equal(s.line, "solid");
  assert.match(s.label, /IDT 12\.4 · dosing changed 02:00/);
});
test("rule 2: explicit confirmed attack event wins a window, even with no run", () => {
  const s = state("facility", {
    run: null,
    events: [
      {
        id: "attack",
        seenOn: "facility",
        type: "CyberEvent",
        status: "confirmed",
        label: "Setpoint changed",
        timestamp: "2026-10-13T07:00:00Z",
      },
    ],
  });
  assert.equal(s.tone, "red");
  assert.match(s.label, /Setpoint changed 02:00/);
});
for (const [window, tone] of [
  [[1, 4], "red"],
  [[2, 4], "red"],
  [[4, 8], "amber"],
]) {
  test(`rule 3: ${window} uses earliest-bound threshold (${tone})`, () => {
    assert.deepEqual(
      state("facility", {
        run: { impacts: [impact("facility", window)], excluded: [] },
      }),
      { tone, line: "solid", label: `${window[0]}–${window[1]} h` },
    );
  });
}
test("rule 3: earliest of multiple functions wins before probes/exclusions; all windows remain immutable", () => {
  const run = freeze({
    impacts: [
      impact("facility", [7, 10]),
      impact("facility", [2, 4]),
      impact("facility", [1, 9]),
    ],
    excluded: [{ entityId: "facility", reason: "old exclusion" }],
  });
  assert.deepEqual(
    state("facility", {
      run,
      assetStatuses: [{ entityId: "facility", status: "probed" }],
    }),
    { tone: "red", line: "solid", label: "1–9 h" },
  );
});
for (const window of [
  null,
  undefined,
  [-1, 4],
  [4, 1],
  [NaN, 4],
  [1, Infinity],
  ["1", 4],
  [],
  [1],
  [1, 2, 3],
]) {
  test(`invalid/negative/unknown window ${JSON.stringify(window)} never supplies a risk tone`, () => {
    const s = state("facility", {
      run: { impacts: [impact("facility", window)], excluded: [] },
    });
    assert.deepEqual(s, {
      tone: "grey",
      line: "solid",
      label: "No status recorded",
    });
  });
}
test("rule 4: probe-only event is amber, not confirmed harm; no run required", () => {
  const s = state("facility", {
    run: null,
    events: [
      {
        id: "probe",
        seenOn: "facility",
        observation: "probing_only",
        timestamp: "2026-10-13T07:30:00Z",
        description: "No compromise",
      },
    ],
  });
  assert.deepEqual(s, {
    tone: "amber",
    line: "solid",
    label: "Probed 02:30 CDT",
  });
  assert.equal(
    state("facility", {
      run: null,
      assetStatuses: [{ entityId: "facility", status: "suspected" }],
    }).label,
    "Suspected",
  );
});
test("rule 5: exclusion resolves through dependency ID and keeps exact reason", () => {
  const s = state("facility", {
    run: {
      impacts: [],
      excluded: [
        {
          dependencyId: "provider-facility",
          reason: "Pressure remains stable",
        },
      ],
    },
  });
  assert.deepEqual(s, {
    tone: "grey",
    line: "dashed",
    label: "not affected",
    reason: "Pressure remains stable",
  });
});
test("rule 5 needs an actual dependency on an affected node, not an orphan exclusion", () => {
  assert.deepEqual(
    state("facility", {
      dependencies: [],
      run: {
        impacts: [],
        excluded: [{ entityId: "facility", reason: "not applicable" }],
      },
    }),
    { tone: "grey", line: "solid", label: "No status recorded" },
  );
});
test("rule 6: in-area with no affected dependency is dotted, but a dependent unknown is not", () => {
  const entities = [entity("facility", { locatedIn: "area" })];
  assert.deepEqual(state("facility", { entities, dependencies: [] }), {
    tone: "grey",
    line: "dotted",
    label: "in area · no dependency",
  });
  assert.equal(state("facility", { entities }).line, "solid");
});
test("rule 7: record-backed upstream supplier is green, never a normal-status facility default", () => {
  assert.deepEqual(state("supplier"), {
    tone: "green",
    line: "solid",
    label: "IDT 5.1.3 · normal",
  });
  assert.equal(
    state("facility", {
      assetStatuses: [{ entityId: "facility", status: "normal" }],
    }).tone,
    "grey",
  );
});
for (const status of [
  "degraded",
  "failed",
  "unknown",
  "unavailable",
  "unrecognized",
])
  test(`rule 7 guard: supplier ${status} cannot be green`, () =>
    assert.equal(
      state("supplier", { assetStatuses: [{ entityId: "supplier", status }] })
        .tone,
      "grey",
    ));
test("rule 7 guard: adverse unconfirmed event blocks green without fabricating a red attack", () => {
  assert.equal(
    state("supplier", {
      events: [{ id: "outage", seenOn: "supplier", status: "degraded" }],
    }).tone,
    "grey",
  );
});
test("no run: only source, attacked and probed nodes get colors; all other facilities grey", () => {
  for (const id of ["supplier", "facility", "missing"])
    assert.deepEqual(state(id, { run: null }), {
      tone: "grey",
      line: "solid",
      label: "Not yet modeled",
    });
  assert.equal(
    state("facility", {
      run: null,
      entities: [entity("facility", { locatedIn: "area" })],
      dependencies: [],
    }).line,
    "solid",
  );
  assert.equal(state("provider", { run: null }).tone, "red");
});
test("missing records cannot acquire a window, area state or supplier green", () => {
  assert.deepEqual(
    state("missing", {
      run: { impacts: [impact("missing", [1, 4])], excluded: [] },
    }),
    { tone: "grey", line: "solid", label: "No status recorded" },
  );
});
test("group ranking is red, amber, grey-dashed, grey-dotted, green, grey-unknown", () => {
  const ranked = [
    { tone: "red", line: "solid", label: "risk" },
    { tone: "amber", line: "solid", label: "later" },
    { tone: "grey", line: "dashed", label: "not affected" },
    { tone: "grey", line: "dotted", label: "in area" },
    { tone: "green", line: "solid", label: "normal" },
    { tone: "grey", line: "solid", label: "unknown" },
  ];
  for (let i = 0; i < ranked.length; i++)
    assert.deepEqual(
      groupIncidentNodeState(freeze(ranked.slice(i).reverse())),
      ranked[i],
    );
  assert.deepEqual(groupIncidentNodeState([]), {
    tone: "grey",
    line: "solid",
    label: "No status recorded",
  });
});
test("pure state helper tolerates hosted/partOf and dependency cycles without mutating records", () => {
  const c = freeze(
    context({
      entities: [
        entity("facility", { partOf: "loop" }),
        entity("loop", { partOf: "facility" }),
      ],
      dependencies: [
        dependency("loop", "facility"),
        dependency("facility", "loop"),
      ],
    }),
  );
  const before = JSON.stringify(c);
  assert.equal(incidentNodeState("facility", c).tone, "grey");
  assert.equal(JSON.stringify(c), before);
});

const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const data = read("../../data/scenario.json");
const supplied = read("../../data/scripted/watershed_beta.json");
const reference = read("../../data/reference.json");
// Actual interval engine output, not handwritten impact approximations.
const engineRun = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      "import sys,json;sys.path.insert(0,'backend');from citride.engine import compute_run;d=json.load(open('data/scenario.json'));print(json.dumps(compute_run(d,{'scenarioId':'unsafe-water','evaluationHour':1,'horizonHours':12,'overrides':[]},'incident-stack-run')))",
    ],
    { cwd: new URL("../../", import.meta.url), encoding: "utf8" },
  ),
);
function props() {
  const records = structuredClone(supplied);
  records.statewideIncidents = records.incidents;
  records.responseTasks = records.tasks;
  records.now = "2026-10-13T08:42:00Z";
  records.statewideIncidents[0].caseId = "saved-case";
  records.statewideIncidents[0].status = "open";
  const selected = {
    id: "saved-case",
    title: "Saved case",
    status: "open",
    priority: "high",
    createdAt: "2026-10-13T08:00:00Z",
    eventId: "event-dosing",
    eventSnapshot: structuredClone(
      data.events.find((e) => e.id === "event-dosing"),
    ),
    contextSnapshot: {
      provider: structuredClone(
        data.entities.find((e) => e.id === "utility-a"),
      ),
      serviceArea: structuredClone(
        data.entities.find((e) => e.id === "area-a"),
      ),
      downstreamDependencies: [],
      scenarios: structuredClone(data.scenarios),
      sourceRefs: [],
    },
    runId: engineRun.id,
    runSnapshot: structuredClone(engineRun),
    tasks: [],
    decisions: [],
    activity: [],
  };
  return {
    data: structuredClone(data),
    records,
    reference: structuredClone(reference),
    incidents: [selected],
    selected,
    onOpenAnalyst() {},
  };
}
test("real recorded demo is exactly eight nodes, no related probe or cyber asset schematic nodes", () => {
  const m = incidentStack(props(), "TX-26-0412");
  assert.deepEqual(
    m.nodes.map((n) => n.entity.id).sort(),
    [
      "electric-e",
      "plant-a",
      "utility-a",
      "nursing-z",
      "dialysis-x",
      "hospital-y",
      "fire-f",
      "facility-q",
    ].sort(),
  );
  assert.equal(m.sourceId, "utility-a");
  assert.equal(m.sourceLabel, "Utility A");
  assert.equal(m.people, 18000);
  assert.match(m.serviceAreaLabel, /Service Area A/);
  assert.equal(m.captured, true);
  assert.equal(m.run.id, engineRun.id);
  assert.equal(m.groups.atRisk.length, 3);
  assert.equal(m.groups.supplyChain.length, 3);
  assert.equal(m.groups.notAffected.length, 2);
  assert.deepEqual(
    m.groups.atRisk.map((n) => [n.entity.id, n.state.label]),
    [
      ["nursing-z", "1–4 h"],
      ["dialysis-x", "2–4 h"],
      ["hospital-y", "4–8 h"],
    ],
  );
  for (const n of m.nodes)
    assert.deepEqual(n.state, incidentNodeState(n.entity.id, m.context));
  assert.equal(
    m.nodes.find((n) => n.entity.id === "plant-a").state.tone,
    "red",
  );
  assert.equal(
    m.nodes.find((n) => n.entity.id === "electric-e").state.tone,
    "green",
  );
});
test("recorded attack label prefers the selected controller event and its actual time over other hosted status rows", () => {
  const m = incidentStack(props());
  const plant = m.nodes.find((n) => n.entity.id === "plant-a");
  assert.match(plant.state.label, /IDT 12\.4 · .*changed.*02:00 CDT/);
});
test("a facility retains links to other explicitly associated saved cases without adding their schematic nodes", () => {
  const p = props();
  const other = structuredClone(p.selected);
  other.id = "related-care-case";
  other.contextSnapshot = { provider: entity("other-provider") };
  other.runSnapshot.seed.provider = "other-provider";
  other.runSnapshot.impacts = [impact("hospital-y", [5, 9])];
  p.incidents.push(other);
  const m = incidentStack(p);
  assert.deepEqual(m.nodes.find((n) => n.entity.id === "hospital-y").caseIds, [
    "saved-case",
    "related-care-case",
  ]);
  assert.ok(!m.nodes.some((n) => n.entity.id === "other-provider"));
});
test("all recorded arrows are labeled, target-driven, no dependency invented for in-area facility", () => {
  const m = incidentStack(props());
  assert.equal(m.edges.length, 6);
  for (const e of m.edges) {
    assert.ok(e.label.trim());
    assert.ok(m.nodes.some((n) => n.entity.id === e.source));
    assert.ok(m.nodes.some((n) => n.entity.id === e.target));
  }
  assert.equal(m.edges.find((e) => e.target === "fire-f").line, "dashed");
  assert.equal(
    m.nodes.find((n) => n.entity.id === "facility-q").state.line,
    "dotted",
  );
  assert.ok(!m.edges.some((e) => e.target === "facility-q"));
  assert.equal(m.edges.find((e) => e.target === "hospital-y").tone, "amber");
});
test("details retain all impacts, dependency records, sources, assumptions, affected assets and linked case IDs", () => {
  const m = incidentStack(props());
  const row = m.nodes.find((n) => n.entity.id === "hospital-y");
  assert.equal(row.impacts.length, 1);
  assert.deepEqual(row.windows, [[4, 8]]);
  assert.equal(row.dependsOn[0].dependency.id, "dep-a-y");
  assert.equal(row.dependsOn[0].captured, true);
  assert.ok(row.sourceRefs.length);
  assert.ok(row.assumptions.length);
  assert.equal(row.modelVersion, engineRun.modelVersion);
  assert.deepEqual(row.caseIds, ["saved-case"]);
  assert.ok(
    m.nodes
      .find((n) => n.entity.id === "plant-a")
      .affectedAssets.some((e) => e.id === "plc-a"),
  );
  assert.equal(
    m.nodes.find((n) => n.entity.id === "fire-f").state.reason,
    "loss type is not applicable",
  );
});
test("frozen captured truth is unaffected by changed current inventory, dependencies, events and other runs", () => {
  const p = props();
  const before = JSON.stringify(p);
  const a = incidentStack(freeze(p));
  assert.equal(JSON.stringify(p), before);
  const changed = props();
  changed.data.entities = [];
  changed.data.dependencies = [];
  changed.data.events = [];
  const b = incidentStack(changed);
  assert.deepEqual(b.nodes, a.nodes);
  assert.deepEqual(b.edges, a.edges);
  assert.equal(b.people, a.people);
  b.nodes[0].entity.label = "mutated output";
  assert.notEqual(
    p.selected.runSnapshot.baselineSnapshot.entities.find(
      (e) => e.id === b.nodes[0].entity.id,
    ).label,
    "mutated output",
  );
});
test("a captured impact still supplies a facility when dependency/area records are missing, without inventing an edge", () => {
  const p = props();
  const baseline = p.selected.runSnapshot.baselineSnapshot;
  baseline.dependencies = baseline.dependencies.filter(
    (d) => d.dependent !== "hospital-y",
  );
  baseline.entities.find((e) => e.id === "hospital-y").locatedIn = undefined;
  const m = incidentStack(p);
  assert.equal(
    m.nodes.find((n) => n.entity.id === "hospital-y").state.label,
    "4–8 h",
  );
  assert.ok(!m.edges.some((e) => e.target === "hospital-y"));
});
test("incomplete captured inventory is never repaired from current records; missing impacts are reported", () => {
  const p = props();
  p.selected.runSnapshot.baselineSnapshot.entities =
    p.selected.runSnapshot.baselineSnapshot.entities.filter(
      (e) => e.id !== "hospital-y",
    );
  const m = incidentStack(p);
  assert.ok(!m.nodes.some((n) => n.entity.id === "hospital-y"));
  assert.ok(m.missingRecords > 0);
});
test("no-run model still scopes the recorded stack but shows no invented windows or normal suppliers", () => {
  const p = props();
  p.selected.runSnapshot = null;
  p.selected.runId = null;
  const m = incidentStack(p);
  assert.equal(m.captured, false);
  assert.equal(m.nodes.length, 8);
  for (const n of m.nodes.filter(
    (n) => !["source", "plant"].includes(n.role),
  )) {
    assert.deepEqual(n.state, {
      tone: "grey",
      line: "solid",
      label: "Not yet modeled",
    });
    assert.deepEqual(n.windows, []);
  }
});
test("statewide register selection is independent of shared saved-case selection; unsupported incident has no leaked stack", () => {
  const p = props();
  const chosen = p.selected;
  const m = incidentStack(p, "TX-26-0409");
  assert.equal(m.footPrintModel.active.id, "TX-26-0409");
  assert.equal(m.incident, null);
  assert.equal(m.infrastructureAvailable, false);
  assert.deepEqual(m.nodes, []);
  assert.deepEqual(m.edges, []);
  assert.equal(p.selected, chosen);
});
test("generic source service and functions drive scope/labels without demo IDs or guessed dependencies", () => {
  const p = props();
  const inventory = [
    entity("grid"),
    entity("processor", { partOf: "agency" }),
    entity("agency", { serves: "zone" }),
    entity("ward", { locatedIn: "zone" }),
    entity("unlinked", { locatedIn: "zone" }),
    entity("zone", { type: "ServiceArea", peopleServed: 90 }),
  ];
  const dependencies = [
    dependency("grid", "processor", { requiredService: "electricity" }),
    dependency("processor", "agency", { requiredService: "processed_supply" }),
    dependency("agency", "ward"),
  ];
  Object.assign(p.selected.runSnapshot, {
    seed: { provider: "agency", lossType: "unsafe_supply" },
    impacts: [impact("ward", [3, 7])],
    excluded: [],
    baselineSnapshot: {
      entities: inventory,
      dependencies,
      serviceFunctions: [],
      sources: [],
    },
  });
  const m = incidentStack(p);
  assert.deepEqual(m.nodes.map((n) => n.entity.id).sort(), [
    "agency",
    "grid",
    "processor",
    "unlinked",
    "ward",
  ]);
  assert.equal(m.people, 90);
  assert.equal(
    m.edges.find((e) => e.target === "agency").label,
    "processed supply",
  );
});
test("incident-linked latest capture wins shared-event inference regardless of current selection/order", () => {
  const p = props();
  delete p.records.statewideIncidents[0].caseId;
  p.selected.runSnapshot.createdAt = "2026-10-13T08:00:00Z";
  const latest = structuredClone(p.selected);
  latest.id = "newer-linked-case";
  latest.runSnapshot.id = "newer-captured-run";
  latest.runSnapshot.createdAt = "2026-10-13T09:00:00Z";
  latest.runSnapshot.impacts = [impact("hospital-y", [6, 9])];
  p.incidents.push(latest);
  const m = incidentStack(p, "TX-26-0412");
  assert.equal(m.incident.id, latest.id);
  assert.equal(m.run.id, "newer-captured-run");
  assert.equal(m.nodes.find((n) => n.entity.id === "hospital-y").state.label, "6–9 h");
});
test("explicit case association beats a newer shared-event capture", () => {
  const p = props();
  const other = structuredClone(p.selected);
  other.id = "other-case";
  other.runSnapshot.createdAt = "2099-01-01T00:00:00Z";
  p.incidents.unshift(other);
  p.selected = other;
  assert.equal(incidentStack(p, "TX-26-0412").incident.id, "saved-case");
});
test("intrinsic entity adverse status blocks normal upstream and confirms hosted attacks", () => {
  assert.equal(state("supplier", {
    entities: [entity("supplier", { status: "degraded" })],
  }).tone, "grey");
  const c = context({
    run: null,
    entities: [entity("facility"), entity("controller", { hostedBy: "facility", status: "manipulated", detail: "setpoint changed" })],
  });
  assert.equal(incidentNodeState("facility", c).tone, "red");
});
test("service arrows preserve function semantics and capture/reference provenance", () => {
  const p = props();
  const m = incidentStack(p);
  const dialysis = m.edges.find((e) => e.target === "dialysis-x");
  assert.match(dialysis.label, /dialysis/i);
  assert.equal(dialysis.captured, true);
  assert.equal(dialysis.reference, false);
  assert.equal(dialysis.modeled, true);
  p.selected.runSnapshot = null;
  p.selected.runId = null;
  for (const e of incidentStack(p).edges) {
    assert.equal(e.captured, false);
    assert.equal(e.reference, true);
    assert.equal(e.modeled, false);
  }
});

test("more than 12 facility nodes aggregate per sector with worst-state and truthful counts, not by function count", () => {
  const p = props();
  const baseline = p.selected.runSnapshot.baselineSnapshot;
  baseline.entities = baseline.entities.filter(
    (e) =>
      ![
        "dialysis-x",
        "hospital-y",
        "nursing-z",
        "fire-f",
        "facility-q",
      ].includes(e.id),
  );
  baseline.dependencies = baseline.dependencies.filter((d) =>
    ["plant-a", "utility-a"].includes(d.dependent),
  );
  p.selected.runSnapshot.impacts = [];
  p.selected.runSnapshot.excluded = [];
  for (let i = 0; i < 30; i++) {
    const id = `care-${i}`;
    baseline.entities.push(
      entity(id, {
        locatedIn: "area-a",
        idt: { status: "coded", path: "10.1" },
      }),
    );
    baseline.dependencies.push(dependency("utility-a", id));
    if (i < 20)
      p.selected.runSnapshot.impacts.push(impact(id, [i < 5 ? 1 : 4, 8]));
  }
  const m = incidentStack(p);
  assert.equal(m.aggregateFacilities, true);
  assert.equal(m.facilityGroups.length, 1);
  assert.equal(m.facilityGroups[0].nodes.length, 30);
  assert.equal(m.facilityGroups[0].atRisk, 20);
  assert.equal(m.facilityGroups[0].state.tone, "red");
  assert.match(m.facilityGroups[0].label, /30 facilities · 20 at risk/);
  assert.deepEqual(groupIncidentFacilities(freeze(m.nodes)), m.facilityGroups);
});

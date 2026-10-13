import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveIncidentDecisions,
  reviewDisplayText,
} from "../src/incidentDecisions.ts";

function fixture() {
  return {
    id: "run-1",
    scenarioId: "linked",
    baselineRevision: 3,
    modelVersion: "interval-v1",
    request: {
      scenarioId: "linked",
      evaluationHour: 1,
      horizonHours: 12,
      overrides: [],
    },
    seed: { eventRefs: ["event-dosing"], sourceRefs: ["source-1"] },
    warnings: ["Timing is conditional"],
    excluded: [],
    baselineSnapshot: {
      baselineRevision: 3,
      entities: [
        { id: "utility", label: "Captured utility" },
        { id: "care", label: "Captured care facility" },
      ],
      serviceFunctions: [{ id: "function", label: "Captured treatment" }],
      dependencies: [
        {
          id: "dep-1",
          provider: "utility",
          dependent: "care",
          assumptionNote: "Captured reserve assumption",
        },
      ],
      sources: [
        {
          id: "source-1",
          label: "Captured source",
          description: "Captured evidence",
        },
      ],
      scenarios: [
        {
          id: "linked",
          label: "Captured scenario",
          seed: { eventRefs: ["event-dosing"] },
        },
      ],
    },
    impacts: [
      {
        id: "impact-1",
        entityId: "care",
        functionId: "function",
        state: "at_risk",
        evidenceStatus: "modeled",
        lossType: "unsafe_water",
        windowHours: [2, 4],
        timingStatus: "within_horizon",
        lossOfFunction: 1,
        paths: [["dep-1"]],
        sourceRefs: ["source-1"],
        assumptions: ["Actual conditional assumption"],
      },
    ],
  };
}
function derive(
  run = fixture(),
  eventId = "event-dosing",
  scenarios = ["linked"],
) {
  return deriveIncidentDecisions(run, eventId, scenarios);
}
function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test("review derives names, sources, paths and assumptions exclusively from captured run", () => {
  const run = fixture();
  const review = derive(run);
  assert.equal(review.status, "ready");
  assert.equal(review.baselineRevision, 3);
  assert.equal(review.scenarioLabel, "Captured scenario");
  const card = review.cards[0];
  assert.equal(card.title, "Review continuity: Captured care facility");
  assert.equal(card.functionLabel, "Captured treatment");
  assert.equal(card.sources[0].label, "Captured source");
  assert.equal(card.paths[0][0].id, "dep-1");
  assert.equal(
    card.paths[0][0].label,
    "Captured utility → Captured care facility",
  );
  assert.deepEqual(card.assumptions, run.impacts[0].assumptions);
  assert.deepEqual(card.windowHours, [2, 4]);
  assert.equal(card.state, "at_risk");
  assert.equal(card.authorityBasis, "Not configured");
  assert.equal(
    card.policyGates,
    "Not evaluated — approved policy definitions required",
  );
  assert.ok(card.warnings.includes("Timing is conditional"));
});

test("retained runs require both selected event and matching explicit scenario", () => {
  for (const [event, matches] of [
    ["event-probe-b", ["linked"]],
    ["event-probe-c", []],
    ["event-dosing", ["unrelated"]],
    ["event-dosing", []],
  ]) {
    const review = derive(fixture(), event, matches);
    assert.equal(review.status, "unrelated-run");
    assert.equal(review.cards.length, 0);
  }
  const run = fixture();
  run.request.scenarioId = "unrelated";
  assert.equal(derive(run).status, "unrelated-run");
  assert.equal(derive(null).status, "no-run");
});

test("captured scenario itself must explicitly link the event", () => {
  const run = fixture();
  run.baselineSnapshot.scenarios[0].seed.eventRefs = [];
  assert.equal(derive(run).status, "invalid-snapshot");
});

test("missing, mismatched or malformed snapshots and impacts fail closed", () => {
  for (const snapshot of [
    null,
    {},
    { ...fixture().baselineSnapshot, baselineRevision: 7 },
    { ...fixture().baselineSnapshot, entities: [null] },
    { ...fixture().baselineSnapshot, sources: [{ id: "x" }, { id: "x" }] },
  ]) {
    const run = fixture();
    run.baselineSnapshot = snapshot;
    assert.equal(derive(run).status, "invalid-snapshot");
  }
  for (const change of [
    { windowHours: [8, 2] },
    { windowHours: [NaN, 4] },
    { state: "healthy" },
    { paths: [null] },
    { sourceRefs: [null] },
    { evidenceStatus: "observed" },
  ]) {
    const run = fixture();
    Object.assign(run.impacts[0], change);
    assert.equal(derive(run).status, "invalid-snapshot");
  }
});

test("unknown references and timing remain unknown rather than borrowing current records", () => {
  const run = fixture();
  Object.assign(run.impacts[0], {
    entityId: "missing-entity",
    functionId: "missing-function",
    sourceRefs: ["missing-source"],
    paths: [["missing-dependency"]],
    windowHours: null,
    state: "unknown",
  });
  const card = derive(run).cards[0];
  assert.equal(card.windowHours, null);
  assert.match(card.entityLabel, /Unknown entity/);
  assert.match(card.functionLabel, /Unknown service function/);
  assert.equal(card.sources[0].known, false);
  assert.equal(card.paths[0][0].known, false);
  assert.equal(card.warnings.length, 5);
});

test("input and detached nested output are immutable, even for historical evidence", () => {
  const run = deepFreeze(fixture());
  const before = JSON.stringify(run);
  const review = derive(run);
  assert.equal(JSON.stringify(run), before);
  for (const value of [
    review,
    review.cards,
    review.cards[0],
    review.cards[0].paths,
    review.cards[0].paths[0],
    review.cards[0].paths[0][0],
    review.cards[0].sources,
    review.cards[0].sources[0],
    review.cards[0].windowHours,
    review.cards[0].assumptions,
    review.cards[0].options,
  ])
    assert.ok(Object.isFrozen(value));
  assert.notEqual(review.cards[0].windowHours, run.impacts[0].windowHours);
  assert.throws(() => {
    review.cards[0].windowHours[0] = 99;
  }, TypeError);
});

test("earliest onset is shown first without hiding unknown intervals or altering run ordering", () => {
  const run = fixture();
  run.impacts = [
    { ...run.impacts[0], id: "unknown", windowHours: null, state: "unknown" },
    { ...run.impacts[0], id: "late", windowHours: [5, 6] },
    { ...run.impacts[0], id: "early", windowHours: [1, 2] },
  ];
  assert.deepEqual(
    derive(run).cards.map((card) => card.id),
    ["early", "late", "unknown"],
  );
  assert.deepEqual(
    run.impacts.map((impact) => impact.id),
    ["unknown", "late", "early"],
  );
});

test("presentation aliases known engine copy without scrubbing custom assumptions", () => {
  assert.equal(
    reviewDisplayText(
      "SIMULATED physical-effect seed; no observed facility failure is asserted.",
    ),
    "Conditional physical-effect seed; no observed facility failure is asserted.",
  );
  assert.equal(
    reviewDisplayText(
      "Explicit simulated effect and persistence; not an observed operational effect.",
    ),
    "Explicit assumed effect and persistence; not an observed operational effect.",
  );
  assert.equal(
    reviewDisplayText("Customer synthetic fiber supplier"),
    "Customer synthetic fiber supplier",
  );
});

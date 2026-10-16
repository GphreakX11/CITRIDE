import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rankUtilities,
  peopleServed,
  potentialRequests,
} from "../src/whoActsFirst.ts";
const read = (p) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const data = read("../../data/scenario.json");
const reference = read("../../data/reference.json");
// Authored result fixtures, not a substitute for an engine/integration test.
const facility = (id, label, path) => ({
  id,
  label,
  type: "Facility",
  idt: { status: "coded", path },
});
const captured = structuredClone(data);
for (const f of [
  facility("hospital-w", "Hospital W", "10.1.1.1"),
  facility("dialysis-u", "Dialysis Center U", "10.1.2.4"),
])
  if (!captured.entities.some((e) => e.id === f.id)) captured.entities.push(f);
const run = (scenarioId, provider, entityId, windowHours) => ({
  id: scenarioId,
  createdAt: "2026-10-13T08:00:00Z",
  scenarioId,
  baselineSnapshot: captured,
  seed: {
    provider,
    lossType: "unsafe_water",
    windowHours: [0, 1],
    persistsThroughHour: 12,
  },
  impacts: [{ entityId, functionId: "test", windowHours }],
  request: { evaluationHour: 1, horizonHours: 12, overrides: [] },
});
const a = run("unsafe-water", "utility-a", "nursing-z", [1, 4]);
const b = run("potential-unsafe-water-b", "utility-b", "hospital-w", [4, 8]);
const c = run("potential-unsafe-water-c", "utility-c", "dialysis-u", [2, 4]);
const cases = [
  {
    id: "case-a",
    eventId: "event-dosing",
    eventSnapshot: data.events.find((e) => e.id === "event-dosing"),
    contextSnapshot: {
      provider: captured.entities.find((e) => e.id === "utility-a"),
    },
    runSnapshot: a,
  },
];
function freeze(x) {
  if (x && typeof x === "object") {
    Object.freeze(x);
    Object.values(x).forEach(freeze);
  }
  return x;
}
test("actual observations/populations rank A,B,C before estimates and A,C,B after", () => {
  const before = rankUtilities(data, cases, [], reference);
  assert.deepEqual(
    before.map((x) => x.utilityId),
    ["utility-a", "utility-b", "utility-c"],
  );
  assert.deepEqual(
    before.map((x) => x.peopleServed),
    [18000, 12000, 9000],
  );
  assert.equal(before[1].windowHours, null);
  const after = rankUtilities(
    freeze(structuredClone(data)),
    freeze(structuredClone(cases)),
    freeze([b, c]),
    freeze(structuredClone(reference)),
  );
  assert.deepEqual(
    after.map((x) => x.utilityId),
    ["utility-a", "utility-c", "utility-b"],
  );
  assert.equal(after[1].evidenceStatus, "probing_only");
  assert.equal(after[1].potential, true);
  assert.deepEqual(
    after.map((x) => x.windowHours),
    [
      [1, 4],
      [2, 4],
      [4, 8],
    ],
  );
  assert.equal(after[1].facilityLabel, "Dialysis Center U");
});
test("captured A cannot be repaired by newer live runs or current entity labels/codes", () => {
  const hostile = structuredClone(data);
  hostile.entities = hostile.entities.filter((x) => x.id !== "nursing-z");
  const newer = run("unsafe-water", "utility-a", "hospital-y", [0, 1]);
  newer.createdAt = "2099-01-01";
  assert.equal(
    rankUtilities(hostile, cases, [newer], reference)[0].facilityLabel,
    "Nursing Home Z",
  );
  const broken = structuredClone(cases);
  broken[0].runSnapshot.baselineSnapshot.entities =
    broken[0].runSnapshot.baselineSnapshot.entities.filter(
      (x) => x.id !== "nursing-z",
    );
  assert.equal(
    rankUtilities(data, broken, [], reference)[0].facilityLabel,
    null,
  );
});
test("healthcare outranks earlier nonhealth; unknown healthcare remains unknown; unrelated scenario excluded", () => {
  const health = structuredClone(c);
  health.impacts.unshift({ entityId: "fire-f", windowHours: [0, 1] });
  assert.deepEqual(
    rankUtilities(data, cases, [b, health], reference)[1].windowHours,
    [2, 4],
  );
  health.impacts[1].windowHours = null;
  assert.deepEqual(
    rankUtilities(data, cases, [b, health], reference).map((x) => x.utilityId),
    ["utility-a", "utility-b", "utility-c"],
  );
  const wrong = structuredClone(c);
  wrong.scenarioId = "low-pressure";
  assert.equal(
    rankUtilities(data, cases, [wrong], reference).find(
      (x) => x.utilityId === "utility-c",
    ).windowHours,
    null,
  );
});
test("first actions use actual observations and captured healthcare, authored templates/labels, legacy observation compatibility", () => {
  const ref = structuredClone(reference);
  ref.firstActionsLabel = "Alternate advisory label";
  ref.firstActions.push({
    id: "alt",
    when: { observation: "probing_only" },
    text: "Inspect {u}",
    contactRole: "Contact {u} / {facility}",
  });
  const rows = rankUtilities(data, cases, [b, c], ref);
  assert.ok(rows[0].firstActions.some((x) => x.id === "fa-vpn-disable"));
  assert.ok(!rows[1].firstActions.some((x) => x.id === "fa-dosing-manual"));
  assert.ok(
    rows[1].firstActions.some(
      (x) =>
        x.id === "fa-health-call" &&
        x.contactRole === "Dialysis Center U administrator",
    ),
  );
  assert.ok(
    rows[1].firstActions.some((x) => x.id === "alt" && x.text === "Inspect C"),
  );
  assert.equal(rows[1].firstActionsLabel, "Alternate advisory label");
  const current = structuredClone(data);
  current.events.find((x) => x.id === "event-vpn-a").observation =
    "vendor_vpn_login_off_hours";
  assert.ok(
    rankUtilities(current, cases, [], reference)[0].firstActions.some(
      (x) => x.id === "fa-vpn-disable",
    ),
  );
});
test("population counts dedupe areas and do not count colocated facilities; potential requests are frozen exact scenarios", () => {
  const input = structuredClone(data);
  input.entities.find((x) => x.id === "utility-a").serves = [
    "area-a",
    "area-a",
  ];
  assert.equal(peopleServed("utility-a", input), 18000);
  const seeded = structuredClone(data);
  seeded.scenarios.push(
    ...[b, c].map((r) => ({ id: r.scenarioId, seed: r.seed })),
  );
  const requests = potentialRequests(seeded);
  assert.deepEqual(
    requests.map((x) => x.scenarioId),
    ["potential-unsafe-water-b", "potential-unsafe-water-c"],
  );
  assert.ok(
    requests.every(
      (x) =>
        x.expectedBaselineRevision === data.baselineRevision &&
        x.overrides.length === 0,
    ),
  );
  seeded.baselineRevision = 999;
  assert.notEqual(requests[0].expectedBaselineRevision, 999);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  analystEntityModel,
  entityEvents,
  entityCaseRuns,
  eventEntityIds,
  recordedPeopleServed,
} from "../src/analystEntityModel.ts";

const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url)),
);
const byId = (id) => data.entities.find((entity) => entity.id === id);
const record = (extra = {}) => ({
  id: "case-a",
  status: "open",
  updatedAt: "2026-10-14T00:00:00Z",
  decisions: [],
  runSnapshot: null,
  contextSnapshot: {
    cyberAsset: byId("cyber-plc-a"),
    physicalAsset: byId("plc-a"),
    facility: byId("plant-a"),
    provider: byId("utility-a"),
    serviceArea: byId("area-a"),
    downstreamDependencies: [],
  },
  ...extra,
});
function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

test("actual inventory gives directed supply and explicit context, without mutation", () => {
  const frozen = freeze(structuredClone(data));
  const before = JSON.stringify(frozen);
  const model = analystEntityModel(frozen, [], "utility-a");
  assert.equal(model.entity.id, "utility-a");
  assert.deepEqual(
    model.suppliers.map((edge) => edge.source),
    ["plant-a"],
  );
  assert.deepEqual(model.supplies.map((edge) => edge.target).sort(), [
    "dialysis-x",
    "fire-f",
    "hospital-y",
    "nursing-z",
  ]);
  assert.ok(
    model.context.some(
      (edge) => edge.relation === "operatedBy" && edge.target === "org-a",
    ),
  );
  assert.ok(
    model.context.some(
      (edge) => edge.relation === "serves" && edge.target === "area-a",
    ),
  );
  assert.ok(model.assumptions.length > 0);
  assert.ok(model.sources.every((source) => source.record !== null));
  assert.equal(JSON.stringify(frozen), before);
});

test("captured case endpoints link; shared area/operator/current relationships do not", () => {
  const incident = record();
  assert.equal(
    analystEntityModel(data, [incident], "utility-a").cases.length,
    1,
  );
  for (const id of ["utility-b", "area-a", "org-a", "dialysis-x"]) {
    assert.equal(analystEntityModel(data, [incident], id).cases.length, 0, id);
  }
  incident.contextSnapshot.downstreamDependencies = [
    {
      dependency: {
        id: "captured",
        provider: "utility-a",
        dependent: "dialysis-x",
      },
      dependent: byId("dialysis-x"),
    },
  ];
  assert.equal(
    analystEntityModel(data, [incident], "dialysis-x").cases.length,
    1,
  );
  assert.deepEqual(
    analystEntityModel(
      data,
      [record({ id: "closed", status: "closed" }), incident],
      "utility-a",
    ).cases.map((item) => item.id),
    ["case-a", "closed"],
  );
});

test("events walk observed hosting/containment only, excluding related probes and shared provenance", () => {
  const ids = entityEvents(data, "utility-a").map((event) => event.id);
  for (const letter of ["a", "b", "c"])
    assert.equal(byId(`vpn-${letter}`).partOf, `plant-${letter}`);
  assert.deepEqual(ids, [
    "event-vpn-a",
    "event-inbound-a",
    "event-auth-a",
    "event-dosing",
    "event-sensor",
  ]);
  assert.deepEqual(
    entityEvents(data, "utility-b").map((event) => event.id),
    ["event-probe-b"],
  );
  assert.deepEqual(entityEvents(data, "dialysis-x"), []);
  assert.deepEqual(entityEvents(data, "area-a"), []);
  assert.deepEqual(entityEvents(data, "org-a"), []);
  assert.deepEqual(entityEvents(data, null), []);
});

test("array refs, inverse hosting, dangling parents, ambiguity and cycles remain bounded", () => {
  const entities = [
    { id: "identity", type: "CyberAsset" },
    { id: "host", hostsCyberAsset: ["identity"], partOf: "plant" },
    { id: "plant", partOf: "host" },
    { id: "co-located", locatedIn: "plant" },
  ];
  assert.deepEqual(
    [...eventEntityIds({ seenOn: ["identity", "missing"] }, entities)].sort(),
    ["host", "identity", "plant"],
  );
  assert.deepEqual(
    [
      ...eventEntityIds({ seenOn: "identity" }, [
        ...entities,
        { id: "other-host", hostsCyberAsset: "identity" },
      ]),
    ],
    ["identity"],
  );
  assert.deepEqual(
    [
      ...eventEntityIds({ entityId: "host" }, [
        { id: "host", partOf: "missing" },
      ]),
    ],
    ["host"],
  );
});

test("people served is not inferred from population, occupants, event count or a name", () => {
  assert.equal(analystEntityModel(data, [], "utility-a").peopleServed, null);
  assert.equal(
    recordedPeopleServed({
      id: "area",
      count: 18000,
      countUnit: "fictional_people",
    }),
    null,
  );
  for (const value of ["18000", -1, NaN, Infinity, null])
    assert.equal(recordedPeopleServed({ peopleServed: value }), null);
  assert.equal(recordedPeopleServed({ peopleServed: 0 }), 0);
  assert.equal(recordedPeopleServed({ peopleServed: 27 }), 27);
});

test("run paths resolve dependency IDs from the immutable snapshot, not current inventory", () => {
  const impact = {
    id: "impact",
    entityId: "hospital-y",
    paths: [["captured-link"]],
  };
  const run = {
    id: "run-one",
    seed: { provider: "seed" },
    impacts: [impact],
    baselineSnapshot: {
      dependencies: [
        {
          id: "captured-link",
          provider: "old-provider",
          dependent: "hospital-y",
        },
      ],
    },
  };
  const incidents = [
    record({ runSnapshot: run }),
    record({ id: "second", runSnapshot: run }),
  ];
  assert.equal(entityCaseRuns(incidents, "hospital-y").length, 1);
  assert.equal(entityCaseRuns(incidents, "old-provider").length, 1);
  assert.equal(entityCaseRuns(incidents, "seed").length, 1);
  assert.equal(entityCaseRuns(incidents, "captured-link").length, 0);
  assert.equal(entityCaseRuns(incidents, "utility-a").length, 0);
  assert.equal(
    entityCaseRuns(
      [record({ runSnapshot: { ...run, baselineSnapshot: null } })],
      "old-provider",
    ).length,
    0,
  );
  assert.equal(entityCaseRuns(incidents, null).length, 0);
});

test("unresolved sources remain explicit and missing entities have empty sections", () => {
  const changed = structuredClone(data);
  changed.entities
    .find((item) => item.id === "utility-a")
    .sourceRefs.push("unknown-source");
  const model = analystEntityModel(changed, [], "utility-a");
  assert.deepEqual(
    model.sources.find((item) => item.id === "unknown-source"),
    { id: "unknown-source", record: null },
  );
  for (const id of [null, "missing-entity"]) {
    const missing = analystEntityModel(data, [record()], id);
    assert.equal(missing.entity, null);
    assert.deepEqual(missing.cases, []);
    assert.deepEqual(missing.events, []);
    assert.deepEqual(missing.runs, []);
    assert.equal(missing.peopleServed, null);
  }
});

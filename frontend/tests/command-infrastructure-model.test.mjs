import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { commandInfrastructureModel } from "../src/commandInfrastructureModel.ts";
import { infrastructureIds, mapPositions } from "../src/texasGraph.ts";

const seed = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const entity = (id, extra = {}) => ({
  id,
  label: `Saved ${id}`,
  type: "Hospital",
  sourceRefs: ["saved-inventory"],
  ...extra,
});
const dependency = (id, provider, dependent, extra = {}) => ({
  ...structuredClone(seed.dependencies[0]),
  id,
  provider,
  dependent,
  requiredService: "treated_water",
  ...extra,
});
const bootstrap = (entities = [], dependencies = []) => ({
  ...structuredClone(seed),
  entities,
  dependencies,
  serviceFunctions: [],
});
const impact = (entityId, extra = {}) => ({
  id: `impact-${entityId}`,
  entityId,
  functionId: "saved-function",
  state: "at_risk",
  evidenceStatus: "modeled",
  lossType: "unsafe_treated_water",
  windowHours: [2, 5],
  timingStatus: "interval",
  lossOfFunction: 1,
  paths: [["saved-dep"]],
  sourceRefs: ["saved-impact-source"],
  assumptions: ["Saved reserve assumption"],
  ...extra,
});
function incident(id = "case-a", extra = {}) {
  const provider = entity("provider", { type: "WaterServiceProvider" });
  const facility = entity("facility");
  const captured = bootstrap(
    [provider, facility],
    [dependency("saved-dep", "provider", "facility")],
  );
  captured.serviceFunctions = [
    { id: "saved-function", label: "Historical treatment function" },
  ];
  const event = { id: "event", label: "Saved event", sourceRefs: [] };
  const run = {
    id: `run-${id}`,
    createdAt: "2026-10-14T10:00:00Z",
    modelVersion: "saved-model-v1",
    baselineRevision: 1,
    scenarioId: "scenario",
    request: {
      scenarioId: "scenario",
      evaluationHour: 0,
      horizonHours: 12,
      overrides: [],
    },
    seed: {
      provider: "provider",
      service: "treated_water",
      lossType: "unsafe_treated_water",
      windowHours: [0, 0],
      persistsThroughHour: 12,
      eventRefs: ["event"],
      sourceRefs: [],
    },
    baselineSnapshot: captured,
    impacts: [impact("facility")],
    excluded: [],
    warnings: [],
  };
  return {
    id,
    title: `Title ${id}`,
    version: 1,
    priority: "high",
    status: "open",
    createdAt: "2026-10-14T09:00:00Z",
    updatedAt: "2026-10-14T10:00:00Z",
    closedAt: null,
    closureNote: null,
    baselineRevision: 1,
    eventId: event.id,
    eventSnapshot: event,
    contextSnapshot: {
      baselineRevision: 1,
      event,
      cyberAsset: null,
      physicalAsset: null,
      facility: structuredClone(facility),
      provider: structuredClone(provider),
      serviceArea: null,
      downstreamDependencies: [],
      scenarios: [],
      sourceRefs: [],
      warnings: [],
    },
    tasks: [],
    decisions: [],
    notes: [],
    activity: [],
    runId: run.id,
    runSnapshot: run,
    ...extra,
  };
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const node = (model, id) => model.nodes.find((item) => item.entity.id === id);
const pairs = (model) =>
  model.edges.map((edge) => `${edge.source}->${edge.target}`).sort();
const forbidden = (type) =>
  /Cyber/i.test(type) || ["PhysicalITAsset", "PhysicalOTAsset"].includes(type);

function checked(data, cases = [], selected = null) {
  const before = structuredClone({ data, cases, selected });
  const model = commandInfrastructureModel(
    freeze(data),
    freeze(cases),
    freeze(selected),
  );
  assert.deepEqual(
    { data, cases, selected },
    before,
    "source input remains unchanged",
  );
  assert.deepEqual(Object.keys(model).sort(), [
    "captured",
    "edges",
    "missingRecords",
    "nodes",
    "positions",
    "scopeLabel",
  ]);
  assert.deepEqual(
    model.positions,
    mapPositions(model.nodes.map((item) => item.entity)),
  );
  assert.equal(
    new Set(model.nodes.map((item) => item.entity.id)).size,
    model.nodes.length,
  );
  assert.equal(
    new Set(model.edges.map((edge) => edge.id)).size,
    model.edges.length,
  );
  assert.ok(model.nodes.every((item) => !forbidden(item.entity.type)));
  for (const item of model.nodes)
    assert.deepEqual(Object.keys(item).sort(), [
      "capturedOnly",
      "caseIds",
      "context",
      "entity",
      "impacts",
      "renamed",
    ]);
  for (const edge of model.edges) {
    assert.deepEqual(Object.keys(edge).sort(), [
      "caseIds",
      "id",
      "label",
      "modeled",
      "reference",
      "source",
      "sourceRefs",
      "target",
    ]);
    assert.ok(node(model, edge.source) && node(model, edge.target));
  }
  return model;
}

test("empty inputs return the exact empty contract", () => {
  const model = checked(bootstrap());
  assert.deepEqual(model, {
    nodes: [],
    edges: [],
    positions: new Map(),
    missingRecords: 0,
    scopeLabel: "All active incidents",
    captured: false,
  });
});

test("fixture baseline retains infrastructure, six directed reference dependencies, no synthetic relationships", () => {
  const model = checked(structuredClone(seed));
  assert.deepEqual(
    model.nodes.map((item) => item.entity.id),
    infrastructureIds(seed).filter(
      (id) => !forbidden(seed.entities.find((e) => e.id === id).type),
    ),
  );
  assert.deepEqual(pairs(model), [
    "electric-e->plant-a",
    "plant-a->utility-a",
    "utility-a->dialysis-x",
    "utility-a->fire-f",
    "utility-a->hospital-y",
    "utility-a->nursing-z",
    "utility-b->hospital-w",
    "utility-c->dialysis-u",
  ]);
  assert.ok(
    model.nodes.every(
      (item) =>
        !item.context &&
        !item.capturedOnly &&
        !item.renamed &&
        !item.impacts.length &&
        !item.caseIds.length,
    ),
  );
  assert.ok(
    model.edges.every(
      (edge) => edge.reference && !edge.modeled && !edge.caseIds.length,
    ),
  );
  assert.equal(model.missingRecords, 0);
});

test("selected historical graph ignores today's renamed/deleted inventory and changed/new dependencies", () => {
  const saved = incident();
  saved.runSnapshot.baselineSnapshot.entities.push(
    entity("unrelated", { type: "WaterServiceProvider" }),
  );
  saved.contextSnapshot.facility.label =
    "Earlier context must not override run inventory";
  const today = bootstrap(
    [
      entity("provider", {
        label: "Current supplier",
        type: "ElectricUtility",
      }),
      entity("new"),
      entity("facility", { label: "Current facility", type: "DialysisCenter" }),
    ],
    [
      dependency("saved-dep", "new", "provider"),
      dependency("new-dep", "facility", "new"),
    ],
  );
  const model = checked(today, [], saved);
  assert.equal(model.scopeLabel, saved.title);
  assert.equal(model.captured, true);
  assert.deepEqual(pairs(model), ["provider->facility"]);
  assert.equal(node(model, "new"), undefined);
  assert.equal(node(model, "provider").entity.label, "Saved provider");
  assert.equal(node(model, "provider").entity.type, "WaterServiceProvider");
  assert.equal(node(model, "provider").renamed, true);
  assert.equal(node(model, "facility").renamed, true);
  assert.equal(node(model, "unrelated").capturedOnly, true);
  assert.deepEqual(node(model, "unrelated").caseIds, []);
  assert.ok(node(model, "provider").context && node(model, "facility").context);
  assert.deepEqual(node(model, "facility").impacts, [
    {
      caseId: saved.id,
      caseTitle: saved.title,
      modelVersion: "saved-model-v1",
      capturedAt: "2026-10-14T10:00:00Z",
      entityLabel: "Saved facility",
      functionLabel: "Historical treatment function",
      state: "at_risk",
      windowHours: [2, 5],
      sourceRefs: ["saved-impact-source"],
      assumptions: ["Saved reserve assumption"],
    },
  ]);
  assert.ok(model.edges[0].modeled && !model.edges[0].reference);
  assert.deepEqual(model.edges[0].caseIds, [saved.id]);
  const deleted = checked(bootstrap(), [saved], saved);
  assert.equal(node(deleted, "facility").capturedOnly, true);
  assert.deepEqual(pairs(deleted), ["provider->facility"]);
});

test("saved context fills missing run inventory only; current inventory never fills a captured gap", () => {
  const saved = incident();
  const captured = saved.runSnapshot.baselineSnapshot;
  captured.entities = captured.entities.filter(
    (item) => item.id !== "provider",
  );
  const contextOnly = entity("context-only");
  saved.contextSnapshot.facility = contextOnly;
  captured.entities = captured.entities.filter(
    (item) => item.id !== "facility",
  );
  const model = checked(
    bootstrap([entity("facility"), entity("provider")]),
    [saved],
    saved,
  );
  assert.equal(node(model, "provider").entity.label, "Saved provider");
  assert.equal(node(model, "context-only").context, true);
  assert.equal(node(model, "facility"), undefined);
  assert.deepEqual(model.edges, []);
  assert.equal(
    model.missingRecords,
    2,
    "one absent-endpoint dependency record plus one absent-entity impact record",
  );
});

test("no-run selection uses captured context and downstream dependency records, not today's inventory", () => {
  const saved = incident("no-run", { runId: null, runSnapshot: null });
  saved.contextSnapshot.downstreamDependencies = [
    {
      dependency: dependency("context-dep", "provider", "downstream"),
      dependent: entity("downstream"),
      function: { id: "function", label: "Saved context function" },
    },
    {
      dependency: dependency("missing-dep", "not-captured", "downstream"),
      dependent: entity("downstream"),
      function: { id: "function", label: "Saved context function" },
    },
  ];
  const model = checked(
    bootstrap(
      [entity("not-captured"), entity("today")],
      [dependency("today", "today", "not-captured")],
    ),
    [saved],
    saved,
  );
  assert.deepEqual(pairs(model), ["provider->downstream"]);
  assert.equal(node(model, "today"), undefined);
  assert.equal(node(model, "not-captured"), undefined);
  assert.ok(node(model, "facility").context);
  assert.equal(node(model, "downstream").context, false);
  assert.deepEqual(node(model, "downstream").caseIds, [saved.id]);
  assert.ok(model.nodes.every((item) => item.impacts.length === 0));
  assert.equal(model.missingRecords, 1);
  assert.equal(model.edges[0].modeled, false);
});

test("all active cases retain every impact and historical provenance without overwriting current names/types", () => {
  const a = incident();
  const b = incident("case-b", { status: "monitoring" });
  b.runSnapshot.baselineSnapshot.entities.find(
    (item) => item.id === "facility",
  ).label = "Second historical name";
  b.runSnapshot.baselineSnapshot.serviceFunctions[0].label =
    "Second historical function";
  b.runSnapshot.modelVersion = "saved-model-v2";
  b.runSnapshot.createdAt = "2026-10-14T11:00:00Z";
  b.runSnapshot.impacts[0].state = "failed";
  b.runSnapshot.baselineSnapshot.entities.push(entity("deleted-facility"));
  b.runSnapshot.impacts.push(
    impact("deleted-facility", { paths: [], windowHours: null }),
  );
  const closed = incident("closed", { status: "closed" });
  closed.contextSnapshot.facility = entity("closed-only");
  const today = bootstrap(
    [
      entity("provider", {
        label: "Today's provider",
        type: "WaterServiceProvider",
      }),
      entity("facility", { label: "Today's facility", type: "DialysisCenter" }),
    ],
    [structuredClone(a.runSnapshot.baselineSnapshot.dependencies[0])],
  );
  const model = checked(today, [a, b, closed]);
  assert.equal(node(model, "facility").entity.label, "Today's facility");
  assert.equal(node(model, "facility").entity.type, "DialysisCenter");
  assert.equal(node(model, "facility").capturedOnly, false);
  assert.equal(node(model, "facility").renamed, true);
  assert.deepEqual(
    node(model, "facility").impacts.map((item) => [
      item.entityLabel,
      item.functionLabel,
      item.modelVersion,
      item.capturedAt,
      item.state,
    ]),
    [
      [
        "Saved facility",
        "Historical treatment function",
        "saved-model-v1",
        "2026-10-14T10:00:00Z",
        "at_risk",
      ],
      [
        "Second historical name",
        "Second historical function",
        "saved-model-v2",
        "2026-10-14T11:00:00Z",
        "failed",
      ],
    ],
  );
  assert.deepEqual(node(model, "facility").caseIds, [a.id, b.id]);
  assert.equal(node(model, "deleted-facility").capturedOnly, true);
  assert.equal(
    node(model, "deleted-facility").impacts.length,
    1,
    "statewide impacts do not depend on a selected case",
  );
  assert.equal(node(model, "closed-only"), undefined);
  assert.ok(model.nodes.every((item) => !item.caseIds.includes("closed")));
  assert.equal(model.edges.length, 1);
  assert.ok(model.edges[0].reference && model.edges[0].modeled);
  assert.deepEqual(model.edges[0].caseIds, [a.id, b.id]);
});

test("canonical full-record dedup merges key-order differences only and retains historical versions", () => {
  const a = incident();
  const b = incident("case-b");
  const original = a.runSnapshot.baselineSnapshot.dependencies[0];
  original.metadata = { z: 1, a: { y: 2, b: 3 } };
  b.runSnapshot.baselineSnapshot.dependencies = [
    Object.fromEntries(
      Object.entries({
        ...original,
        metadata: { a: { b: 3, y: 2 }, z: 1 },
      }).reverse(),
    ),
  ];
  const today = bootstrap(
    structuredClone(a.runSnapshot.baselineSnapshot.entities),
    [
      {
        ...structuredClone(original),
        revision: original.revision + 1,
        requiredService: "electric_power",
        sourceRefs: ["current-source"],
      },
    ],
  );
  const version = {
    ...structuredClone(original),
    assumptionNote: "Distinct historical assumption",
    sourceRefs: ["different-source"],
  };
  b.runSnapshot.baselineSnapshot.dependencies.push(version);
  const model = checked(today, [a, b]);
  assert.equal(model.edges.length, 3);
  assert.deepEqual(pairs(model), [
    "provider->facility",
    "provider->facility",
    "provider->facility",
  ]);
  const shared = model.edges.find((edge) => edge.caseIds.length === 2);
  assert.equal(shared.reference, false);
  assert.deepEqual(shared.sourceRefs, original.sourceRefs);
  assert.equal(shared.modeled, true);
  assert.equal(
    model.edges.find((edge) => edge.reference).modeled,
    false,
    "same ID is not proof today's changed dependency was modeled",
  );
  assert.deepEqual(
    model.edges.find((edge) => edge.sourceRefs.includes("different-source"))
      .caseIds,
    [b.id],
  );
  assert.deepEqual(
    checked(today, [a, b]).edges.map((edge) => edge.id),
    model.edges.map((edge) => edge.id),
  );
});

test("case membership includes captured dependency endpoints, not unrelated inventory", () => {
  const saved = incident();
  saved.contextSnapshot.facility = null;
  saved.runSnapshot.impacts = [];
  saved.runSnapshot.baselineSnapshot.entities.push(
    entity("unrelated", { type: "WaterServiceProvider" }),
  );
  const model = checked(bootstrap(), [saved]);
  assert.equal(node(model, "facility").context, false);
  assert.deepEqual(node(model, "facility").caseIds, [saved.id]);
  assert.deepEqual(node(model, "unrelated").caseIds, []);
  assert.ok(model.edges.every((edge) => !edge.modeled));
});

test("missingRecords counts input records, not endpoint slots or display edges; no cross-layer repair", () => {
  // Convention: each dependency occurrence with >=1 absent entity endpoint counts once,
  // before exact-record edge dedup; each impact occurrence with an absent saved entity
  // counts once. Layers are checked independently. Known excluded types, self edges,
  // and missing path IDs/function labels are not missing infrastructure records.
  const saved = incident();
  saved.runSnapshot.baselineSnapshot.dependencies.push(
    dependency("missing-both", "absent-a", "absent-b"),
    dependency("missing-both", "absent-a", "absent-b"),
    dependency("self", "facility", "facility"),
  );
  saved.runSnapshot.impacts.push(
    impact("absent-a"),
    impact("absent-a", { id: "another-impact" }),
  );
  const today = bootstrap(
    [
      entity("absent-a", { type: "WaterServiceProvider" }),
      entity("absent-b"),
      entity("provider", { type: "WaterServiceProvider" }),
    ],
    [dependency("current-missing", "provider", "current-absent")],
  );
  const all = checked(today, [saved]);
  assert.equal(all.missingRecords, 5);
  assert.deepEqual(pairs(all), ["provider->facility"]);
  assert.deepEqual(
    node(all, "absent-a").impacts,
    [],
    "an eligible current node must not repair a historical impact record",
  );
  assert.deepEqual(node(all, "absent-a").caseIds, []);
  const selected = checked(today, [saved], saved);
  assert.equal(selected.missingRecords, 4);
  assert.equal(node(selected, "absent-a"), undefined);
});

test("isolated captured impacts/providers/context infrastructure survive, abstract and asset inventory do not", () => {
  const saved = incident();
  saved.runSnapshot.baselineSnapshot.dependencies = [];
  saved.runSnapshot.baselineSnapshot.entities.push(
    entity("impact-only"),
    entity("abstract", { type: "Organization" }),
    entity("asset-it", { type: "PhysicalITAsset" }),
    entity("asset-ot", { type: "PhysicalOTAsset" }),
    entity("cyber", { type: "CyberAsset" }),
  );
  saved.runSnapshot.impacts.push(impact("impact-only"), impact("asset-it"));
  saved.contextSnapshot.serviceArea = entity("area", { type: "ServiceArea" });
  saved.contextSnapshot.physicalAsset = entity("asset-context", {
    type: "PhysicalOTAsset",
  });
  const model = checked(bootstrap(), [saved], saved);
  assert.deepEqual(model.nodes.map((item) => item.entity.id).sort(), [
    "facility",
    "impact-only",
    "provider",
  ]);
  assert.deepEqual(model.edges, []);
  assert.equal(model.missingRecords, 0);
});

test("closed cases are excluded from all-active scope but explicit closed selection retains saved history", () => {
  const closed = incident("closed", { status: "closed" });
  assert.deepEqual(checked(bootstrap(), [closed]).nodes, []);
  assert.equal(checked(bootstrap(), [closed], closed).nodes.length, 2);
});

test("empty saved baseline never resolves against current seed; missing function names stay unknown", () => {
  const saved = incident();
  saved.contextSnapshot.provider = null;
  saved.contextSnapshot.facility = null;
  saved.runSnapshot.baselineSnapshot = {};
  saved.runSnapshot.seed.provider = "utility-a";
  assert.deepEqual(checked(structuredClone(seed), [saved], saved).nodes, []);
  assert.equal(
    checked(structuredClone(seed), [saved], saved).missingRecords,
    1,
  );
  const functionMissing = incident("missing-function");
  functionMissing.runSnapshot.baselineSnapshot.serviceFunctions = [];
  functionMissing.runSnapshot.createdAt = undefined;
  const card = node(
    checked(bootstrap(), [functionMissing], functionMissing),
    "facility",
  ).impacts[0];
  assert.equal(card.functionLabel, "Captured function label unavailable");
  assert.equal(card.capturedAt, null);
});

test("geography, partOf and recognizable dependency IDs never create operational edges", () => {
  const saved = incident();
  saved.runSnapshot.baselineSnapshot.dependencies = [];
  saved.runSnapshot.baselineSnapshot.entities[1].partOf = "provider";
  saved.runSnapshot.baselineSnapshot.entities[1].locatedIn = "provider";
  saved.runSnapshot.impacts[0].paths = [["dep-provider-facility", "saved-dep"]];
  const model = checked(bootstrap(), [saved], saved);
  assert.equal(model.edges.length, 0);
  assert.equal(model.missingRecords, 0);
});

test("all-active no-run context preserves current node provenance and captured-only downstream infrastructure", () => {
  const saved = incident("no-run", { runId: null, runSnapshot: null });
  saved.contextSnapshot.downstreamDependencies = [
    {
      dependency: dependency("context-dep", "provider", "downstream"),
      dependent: entity("downstream"),
      function: { id: "function", label: "Historical context function" },
    },
  ];
  const model = checked(
    bootstrap([
      entity("provider", {
        label: "Current provider",
        type: "WaterServiceProvider",
      }),
    ]),
    [saved],
  );
  assert.equal(node(model, "provider").entity.label, "Current provider");
  assert.equal(node(model, "provider").renamed, true);
  assert.equal(node(model, "facility").capturedOnly, true);
  assert.equal(node(model, "downstream").capturedOnly, true);
  assert.deepEqual(pairs(model), ["provider->downstream"]);
  assert.ok(model.edges.every((edge) => !edge.reference && !edge.modeled));
});

test("known cyber/physical-asset endpoints are excluded rather than counted as missing infrastructure", () => {
  const saved = incident();
  saved.runSnapshot.baselineSnapshot.entities.push(
    entity("ot", { type: "PhysicalOTAsset" }),
    entity("it", { type: "PhysicalITAsset" }),
    entity("cyber", { type: "CyberAsset" }),
  );
  saved.runSnapshot.baselineSnapshot.dependencies.push(
    dependency("ot-dep", "ot", "facility"),
    dependency("it-dep", "provider", "it"),
    dependency("cyber-dep", "cyber", "provider"),
  );
  const model = checked(bootstrap(), [saved], saved);
  assert.deepEqual(pairs(model), ["provider->facility"]);
  assert.equal(model.missingRecords, 0);
});

test("returned nested inventory and impact provenance are detached from frozen source records", () => {
  const saved = incident();
  saved.runSnapshot.baselineSnapshot.entities[0].metadata = {
    tags: ["historical"],
  };
  const today = bootstrap();
  const before = structuredClone(saved);
  const model = checked(today, [saved], saved);
  node(model, "provider").entity.metadata.tags.push("view-only");
  node(model, "provider").entity.sourceRefs.push("view-source");
  node(model, "facility").impacts[0].windowHours[0] = 99;
  node(model, "facility").impacts[0].sourceRefs.push("view-source");
  node(model, "facility").impacts[0].assumptions.push("view-assumption");
  model.edges[0].sourceRefs.push("view-edge-source");
  assert.deepEqual(saved, before);
  assert.deepEqual(
    checked(today, [saved], saved).nodes.find(
      (item) => item.entity.id === "provider",
    ).entity.metadata.tags,
    ["historical"],
  );
});

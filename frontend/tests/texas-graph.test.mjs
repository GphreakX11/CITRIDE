import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  connectedEdges,
  graphEdges,
  infrastructureIds,
  mapPositions,
} from "../src/texasGraph.ts";

const seed = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const entity = (id, extra = {}) => ({
  id,
  label: id,
  type: "PhysicalOTAsset",
  sourceRefs: ["inventory"],
  ...extra,
});
const data = (entities, dependencies = []) => ({
  ...seed,
  entities,
  dependencies,
});
const dependency = (id, provider, dependent) => ({
  ...seed.dependencies[0],
  id,
  provider,
  dependent,
});
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const pairs = (edges) =>
  edges.map(({ source, target }) => `${source}->${target}`).sort();
const point = (coordinates) => ({ type: "Point", coordinates });

test("seed retains exactly the six explicit directed dependencies, with provenance", () => {
  const edges = graphEdges(freeze(structuredClone(seed)));
  const dependencies = edges.filter((edge) => edge.kind === "dependency");
  assert.equal(dependencies.length, 8);
  assert.deepEqual(pairs(dependencies), [
    "electric-e->plant-a",
    "plant-a->utility-a",
    "utility-a->dialysis-x",
    "utility-a->fire-f",
    "utility-a->hospital-y",
    "utility-a->nursing-z",
    "utility-b->hospital-w",
    "utility-c->dialysis-u",
  ]);
  for (const edge of dependencies) {
    const record = seed.dependencies.find(
      (item) => item.id === edge.dependency.id,
    );
    assert.deepEqual(edge.dependency, record);
    assert.deepEqual(edge.sourceRefs, record.sourceRefs);
    assert.ok(edge.label.length > 0);
  }
  assert.equal(new Set(edges.map((edge) => edge.id)).size, edges.length);
  assert.equal(
    dependencies.some(
      (edge) => edge.source === "facility-q" || edge.target === "facility-q",
    ),
    false,
  );
  assert.deepEqual(
    connectedEdges(edges, "facility-q").map((edge) => [
      edge.kind,
      edge.relation,
      edge.target,
    ]),
    [["spatial", "locatedIn", "area-a"]],
  );
});

test("all explicit relationship fields support arrays, deduplicate, and exclude self/dangling refs", () => {
  const relations = [
    "partOf",
    "operatedBy",
    "hostsCyberAsset",
    "hostedBy",
    "serves",
    "locatedIn",
  ];
  const subject = entity(
    "subject",
    Object.fromEntries(
      relations.map((relation) => [
        relation,
        ["a", "b", "a", "subject", "missing", null, 3],
      ]),
    ),
  );
  const source = data([subject, entity("a"), entity("b")]);
  const edges = graphEdges(source);
  assert.equal(edges.length, 12);
  for (const relation of relations) {
    const links = edges.filter((edge) => edge.relation === relation);
    assert.deepEqual(pairs(links), ["subject->a", "subject->b"]);
    assert.ok(
      links.every(
        (edge) =>
          edge.kind ===
          (["serves", "locatedIn"].includes(relation)
            ? "spatial"
            : "structural"),
      ),
    );
    assert.ok(links.every((edge) => edge.dependency === undefined));
  }
  const reordered = data([...source.entities].reverse());
  assert.deepEqual(
    graphEdges(reordered)
      .map((edge) => edge.id)
      .sort(),
    edges.map((edge) => edge.id).sort(),
  );
});

test("duplicate dependency records are emitted once; distinct dependencies between the same endpoints survive", () => {
  const first = dependency("one", "a", "b");
  const source = data(
    [entity("a"), entity("b")],
    [
      first,
      structuredClone(first),
      dependency("two", "a", "b"),
      dependency("self", "a", "a"),
      dependency("dangling", "a", "missing"),
      dependency("missing-provider", "missing", "b"),
    ],
  );
  assert.deepEqual(
    graphEdges(source).map((edge) => edge.dependency.id),
    ["one", "two"],
  );
  assert.deepEqual(infrastructureIds(source), ["a", "b"]);
});

test("incident-edge traversal includes incoming and outgoing neighbors, never transitive links", () => {
  const edges = graphEdges(seed).filter((edge) => edge.kind === "dependency");
  assert.deepEqual(pairs(connectedEdges(edges, "plant-a")), [
    "electric-e->plant-a",
    "plant-a->utility-a",
  ]);
  assert.deepEqual(pairs(connectedEdges(edges, "utility-a")), [
    "plant-a->utility-a",
    "utility-a->dialysis-x",
    "utility-a->fire-f",
    "utility-a->hospital-y",
    "utility-a->nursing-z",
  ]);
  assert.deepEqual(connectedEdges(edges, "unknown"), []);
});

test("infrastructure includes source Points, water providers and dependency endpoints, not abstract context", () => {
  assert.deepEqual(infrastructureIds(seed).sort(), [
    "dialysis-u",
    "dialysis-x",
    "electric-e",
    "facility-q",
    "fire-f",
    "hospital-w",
    "hospital-y",
    "nursing-z",
    "plant-a",
    "plant-b",
    "plant-c",
    "utility-a",
    "utility-b",
    "utility-c",
  ]);
  const entities = [
    entity("physical", { geometry: point([0, 0]) }),
    entity("provider", { type: "WaterServiceProvider" }),
    entity("area", { type: "ServiceArea", geometry: point([-100, 30]) }),
    entity("org", { type: "Organization" }),
    entity("cyber", { type: "CyberAsset", geometry: point([-100, 30]) }),
    entity("bad", { geometry: point([Infinity, 0]) }),
    entity("bad-lat", { geometry: point([0, 91]) }),
    entity("polygon", { geometry: { type: "Polygon", coordinates: [] } }),
    entity("no-location"),
  ];
  const source = data(entities, [dependency("explicit", "org", "cyber")]);
  assert.deepEqual(infrastructureIds(source), [
    "physical",
    "provider",
    "org",
    "cyber",
  ]);
});

test("seed positions use the exact illustrative reference topology without modifying coordinates", () => {
  const source = freeze(structuredClone(seed.entities));
  const positions = mapPositions(source);
  const expected = {
    "electric-e": [220, 335],
    "plant-a": [395, 340],
    "utility-a": [510, 345],
    "dialysis-x": [575, 240],
    "hospital-y": [670, 345],
    "nursing-z": [420, 190],
    "fire-f": [590, 445],
    "facility-q": [740, 270],
    "plant-b": [450, 450],
    "utility-b": [535, 510],
    "plant-c": [695, 435],
    "utility-c": [770, 380],
  };
  assert.equal(positions.size, seed.entities.length);
  for (const [id, [x, y]] of Object.entries(expected))
    assert.deepEqual(positions.get(id), { x, y, placement: "illustrative" });
  assert.deepEqual(source, seed.entities);
  assert.deepEqual(mapPositions([...source].reverse()), positions);
  assert.equal(
    new Set([...positions.values()].map(({ x, y }) => `${x},${y}`)).size,
    positions.size,
  );
  const host = positions.get("plc-a"),
    cyber = positions.get("cyber-plc-a"),
    plant = positions.get("plant-a");
  assert.ok(Math.hypot(host.x - plant.x, host.y - plant.y) < 110);
  assert.ok(Math.hypot(cyber.x - host.x, cyber.y - host.y) < 110);
});

test("rings follow explicit parent/host/operator/provider refs and are stable with cycles or missing refs", () => {
  const entities = [
    entity("plant-a"),
    entity("utility-a", { serves: ["area"], operatedBy: "org" }),
    entity("area", { type: "ServiceArea" }),
    entity("org", { type: "Organization" }),
    entity("child-a", { partOf: ["missing", "plant-a"] }),
    entity("child-b", { partOf: "plant-a" }),
    entity("cyber", { hostedBy: "child-a" }),
    entity("hosted-inverse", { type: "CyberAsset" }),
    entity("host", { partOf: "plant-a", hostsCyberAsset: ["hosted-inverse"] }),
    entity("cycle-a", { partOf: "cycle-b" }),
    entity("cycle-b", { hostedBy: "cycle-a" }),
    entity("missing", { partOf: "absent" }),
    entity("alone"),
  ];
  const before = structuredClone(entities);
  const positions = mapPositions(freeze(entities));
  assert.deepEqual(mapPositions([...entities].reverse()), positions);
  assert.deepEqual(entities, before);
  assert.equal(positions.size, entities.length);
  assert.equal(
    new Set([...positions.values()].map(({ x, y }) => `${x},${y}`)).size,
    positions.size,
  );
  for (const position of positions.values()) {
    assert.equal(position.placement, "illustrative");
    assert.ok(
      Number.isFinite(position.x) && position.x >= 0 && position.x <= 960,
    );
    assert.ok(
      Number.isFinite(position.y) && position.y >= 0 && position.y <= 720,
    );
  }
  for (const [child, parent] of [
    ["child-a", "plant-a"],
    ["cyber", "child-a"],
    ["hosted-inverse", "host"],
    ["area", "utility-a"],
    ["org", "utility-a"],
  ]) {
    const a = positions.get(child),
      b = positions.get(parent);
    assert.ok(
      Math.hypot(a.x - b.x, a.y - b.y) < 110,
      `${child} near ${parent}`,
    );
  }
  assert.deepEqual(mapPositions([]), new Map());
});

test("real Texas Points project exactly; synthetic provenance and invalid geography stay illustrative", () => {
  const entities = [
    entity("real", { geometry: point([-100, 30]) }),
    entity("northwest", { geometry: point([-106.7, 36.6]) }),
    entity("southeast", { geometry: point([-93.4, 25.7]) }),
    entity("plant-a", { geometry: point([-100, 30]) }),
    entity("synthetic", {
      geometry: point([-100, 30]),
      geometryStatus: "synthetic_schematic",
    }),
    entity("simulated", {
      geometry: point([-100, 30]),
      handling: ["SIMULATED"],
    }),
    entity("nested", {
      geometry: point([-100, 30]),
      metadata: { geometryStatus: "synthetic_schematic" },
    }),
    entity("origin", { geometry: point([0.02, 0.02]) }),
    entity("outside", { geometry: point([-110, 35]) }),
    entity("invalid", { geometry: point([NaN, 30]) }),
  ];
  const positions = mapPositions(freeze(entities));
  const projected = {
    x: 90 + ((-100 + 106.7) / 13.3) * 780,
    y: 60 + ((36.6 - 30) / 10.9) * 600,
    placement: "source-coordinate",
  };
  assert.deepEqual(positions.get("real"), projected);
  assert.deepEqual(positions.get("plant-a"), projected);
  assert.deepEqual(positions.get("northwest"), {
    x: 90,
    y: 60,
    placement: "source-coordinate",
  });
  assert.ok(Math.abs(positions.get("southeast").x - 870) < 1e-10);
  assert.ok(Math.abs(positions.get("southeast").y - 660) < 1e-10);
  for (const id of [
    "synthetic",
    "simulated",
    "nested",
    "origin",
    "outside",
    "invalid",
  ])
    assert.equal(positions.get(id).placement, "illustrative");
});

test("relationship and position helpers preserve frozen input snapshots and detached source refs", () => {
  const source = freeze(structuredClone(seed));
  const edges = graphEdges(source);
  infrastructureIds(source);
  connectedEdges(edges, "plant-a");
  mapPositions(source.entities);
  edges[0].sourceRefs.push("local-only");
  assert.deepEqual(source, seed);
});

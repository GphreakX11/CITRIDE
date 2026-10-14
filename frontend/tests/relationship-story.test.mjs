import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { graphEdges } from "../src/texasGraph.ts";
import {
  relationshipStory,
  serviceConnections,
  serviceNeighborhood,
} from "../src/relationshipStory.ts";

const seed = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const edges = graphEdges(seed);

test("reference utility story contains actual direct suppliers and four distinct supported entities", () => {
  const story = relationshipStory(edges, "utility-a", seed.entities);
  assert.deepEqual(story.supplierIds, ["plant-a"]);
  assert.deepEqual(story.dependentIds.sort(), [
    "dialysis-x",
    "fire-f",
    "hospital-y",
    "nursing-z",
  ]);
  assert.match(story.summary, /1 recorded direct supplier/);
  assert.match(story.summary, /directly supports 4 entities/);
  assert.ok(
    story.suppliers.every((edge) => edge.dependency && edge.sourceRefs.length),
  );
});

test("distinct endpoint counts do not collapse separate service-function records", () => {
  const original = edges.find(
    (edge) => edge.source === "plant-a" && edge.target === "utility-a",
  );
  const extra = {
    ...original,
    id: "another-function",
    dependency: {
      ...original.dependency,
      id: "another-function",
      dependentFunction: "another-function",
    },
  };
  const story = relationshipStory(
    [...edges, extra],
    "utility-a",
    seed.entities,
  );
  assert.equal(story.suppliers.length, 2);
  assert.equal(story.supplierIds.length, 1);
  assert.equal(story.dependentIds.length, 4);
});

test("supplier/dependent direction excludes context, unrelated and transitive links", () => {
  assert.deepEqual(
    [...serviceNeighborhood(edges, "utility-a", "suppliers")].sort(),
    ["plant-a", "utility-a"],
  );
  assert.deepEqual(
    [...serviceNeighborhood(edges, "utility-a", "dependents")].sort(),
    ["dialysis-x", "fire-f", "hospital-y", "nursing-z", "utility-a"],
  );
  const both = serviceConnections(edges, "utility-a", "all");
  assert.equal(both.length, 5);
  assert.ok(both.every((edge) => edge.kind === "dependency"));
  assert.ok(!both.some((edge) => edge.source === "electric-e"));
});

test("location alone does not imply supply, impact or an outage", () => {
  const story = relationshipStory(edges, "facility-q", seed.entities);
  assert.equal(story.suppliers.length, 0);
  assert.equal(story.dependents.length, 0);
  assert.equal(story.context.length, 1);
  assert.deepEqual(
    [...serviceNeighborhood(edges, "facility-q", "suppliers")],
    ["facility-q"],
  );
  assert.match(story.summary, /0 recorded direct suppliers/);
  assert.doesNotMatch(story.summary, /outage|failed|water supply/i);
});

test("electrical supplier uses generic service wording, not invented water supply", () => {
  const story = relationshipStory(edges, "plant-a", seed.entities);
  assert.deepEqual(story.supplierIds, ["electric-e"]);
  assert.deepEqual(story.dependentIds, ["utility-a"]);
  assert.ok(
    story.summary.includes(
      seed.entities.find((entity) => entity.id === "electric-e").label,
    ),
  );
  assert.doesNotMatch(story.summary, /water supply|outage|prediction/i);
});

test("per-dependency evidence, service function, conditional timing and backup stay intact", () => {
  const story = relationshipStory(edges, "plant-a", seed.entities);
  for (const edge of [...story.suppliers, ...story.dependents]) {
    const original = seed.dependencies.find(
      (record) => record.id === edge.dependency.id,
    );
    assert.strictEqual(edge.dependency, original);
    assert.deepEqual(edge.sourceRefs, original.sourceRefs);
    assert.equal(edge.dependency.dependentFunction, original.dependentFunction);
    assert.equal(
      edge.dependency.propagationDelayMinHours,
      original.propagationDelayMinHours,
    );
    assert.equal(
      edge.dependency.propagationDelayMaxHours,
      original.propagationDelayMaxHours,
    );
    assert.equal(
      edge.dependency.usableBackupMinHours,
      original.usableBackupMinHours,
    );
    assert.equal(
      edge.dependency.usableBackupMaxHours,
      original.usableBackupMaxHours,
    );
    assert.equal(edge.dependency.assumptionNote, original.assumptionNote);
  }
});

test("invalid endpoints and self-links do not count; frozen input remains unchanged", () => {
  const entity = Object.freeze({
    id: "a",
    label: "A",
    type: "Facility",
    sourceRefs: [],
  });
  const invalid = Object.freeze([
    Object.freeze({ id: "self", source: "a", target: "a", kind: "dependency" }),
    Object.freeze({
      id: "missing",
      source: "missing",
      target: "a",
      kind: "dependency",
    }),
  ]);
  const story = relationshipStory(invalid, "a", Object.freeze([entity]));
  assert.deepEqual(story.supplierIds, []);
  assert.deepEqual(story.dependentIds, []);
  assert.equal(
    story.summary,
    "A has 0 recorded direct suppliers. It directly supports 0 entities.",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  caseEntityIds,
  linkedCases,
  linkedCaseId,
  caseFocusEntity,
  evidenceForContext,
  caseSelectionAfterRead,
} from "../src/investigationContext.ts";
import { initialMapView } from "../src/mapViewState.ts";
const record = (id, provider, extra = {}) => ({
  id,
  status: "open",
  updatedAt: "2026-10-14T00:00:00Z",
  decisions: [],
  eventSnapshot: { id: `event-${id}`, label: "Captured event" },
  contextSnapshot: {
    provider: { id: provider },
    facility: { id: `plant-${provider}` },
    physicalAsset: { id: `asset-${provider}` },
    cyberAsset: { id: `cyber-${provider}` },
    serviceArea: { id: "shared-area" },
    downstreamDependencies: [],
  },
  ...extra,
});
test("case linkage includes only captured assets and explicit endpoints, never shared geography", () => {
  const a = record("a", "utility-a", { decisions: [{ entityId: "hospital" }] });
  a.contextSnapshot.downstreamDependencies = [
    {
      dependency: { provider: "utility-a", dependent: "dialysis" },
      dependent: { id: "dialysis" },
    },
  ];
  assert.deepEqual([...caseEntityIds(a)].sort(), [
    "asset-utility-a",
    "cyber-utility-a",
    "dialysis",
    "hospital",
    "plant-utility-a",
    "utility-a",
  ]);
  assert.equal(linkedCaseId([a], "shared-area", null), null);
  assert.equal(linkedCaseId([a], "unlinked", a.id), null);
});
test("entity changes retain linked case or choose deterministically and clear unrelated case", () => {
  const a = record("a", "utility-a"),
    b = record("b", "utility-b"),
    newer = record("newer", "utility-a", { updatedAt: "2026-10-15T00:00:00Z" }),
    closed = record("closed", "utility-a", {
      status: "closed",
      updatedAt: "2026-10-16T00:00:00Z",
    });
  assert.deepEqual(
    linkedCases([closed, a, newer, b], "utility-a").map((x) => x.id),
    ["newer", "a", "closed"],
  );
  assert.equal(linkedCaseId([a, newer, b], "utility-a", "a"), "a");
  assert.equal(linkedCaseId([a, newer, b], "utility-a", "b"), "newer");
  assert.equal(linkedCaseId([a, b], "utility-b", "a"), "b");
  assert.equal(linkedCaseId([a, b], null, "a"), null);
});
test("case changes retain linked asset otherwise use captured provider", () => {
  const a = record("a", "utility-a");
  assert.equal(caseFocusEntity(a, "asset-utility-a"), "asset-utility-a");
  assert.equal(caseFocusEntity(a, "utility-b"), "utility-a");
  assert.equal(caseFocusEntity(a, null), "utility-a");
});
test("evidence prioritizes immutable captured event; no unrelated substitution", () => {
  const a = record("a", "utility-a");
  const data = {
    events: [
      { id: "other", seenOn: "cyber-b" },
      { id: "fresh", seenOn: ["cyber-a"] },
    ],
  };
  assert.deepEqual(evidenceForContext(data, a, "utility-a"), [a.eventSnapshot]);
  assert.deepEqual(evidenceForContext(data, null, "cyber-a"), [data.events[1]]);
  assert.deepEqual(evidenceForContext(data, null, "unknown"), []);
});
test("successful refresh preserves explicit cleared/new-case intent instead of reselecting a default", () => {
  const a = record("a", "utility-a"),
    b = record("b", "utility-b");
  assert.equal(caseSelectionAfterRead([a, b], null, null, false), null);
  assert.equal(
    caseSelectionAfterRead([a, b], null, "deleted-case", false),
    null,
  );
  assert.equal(caseSelectionAfterRead([a, b], "unlinked", null, true), null);
});
test("only initial loading defaults to an active case; refresh keeps captured context", () => {
  const closed = record("closed", "utility-a", { status: "closed" });
  const a = record("a", "utility-a"),
    b = record("b", "utility-b");
  assert.equal(caseSelectionAfterRead([closed, a, b], null, null, true), "a");
  // Browsing another entity is not a request to switch the selected case.
  assert.equal(caseSelectionAfterRead([a, b], "utility-b", "a", false), "a");
  assert.equal(caseSelectionAfterRead([a, b], null, "b", false), "b");
  assert.equal(caseSelectionAfterRead([], null, null, true), null);
});
test("map defaults are independent and keep context links secondary", () => {
  const a = initialMapView(),
    b = initialMapView();
  a.center.x = 12;
  assert.equal(b.center.x, 480);
  assert.equal(b.structural, false);
  assert.equal(b.direction, "all");
});

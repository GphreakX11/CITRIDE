import assert from "node:assert/strict";
import test from "node:test";
import { commandMetrics, orderIncidents, incidentBrief, referenceGeometries, geometryLayout } from "../src/commandMetrics.ts";
import { commandNavigation } from "../src/commandTypes.ts";

function fixture(overrides = {}) {
  return {
    id: "case-fixture", status: "open", priority: "medium", title: "Review fixture event",
    createdAt: "2026-10-13T12:00:00Z", updatedAt: "2026-10-13T12:00:00Z", baselineRevision: 1,
    tasks: [{ id: "evidence", completed: false }], notes: [], decisions: [],
    ...overrides,
  };
}
test("eight source-inspired roles retain useful nonoperational labels", () => {
  assert.equal(commandNavigation.length, 8);
  assert.equal(new Set(commandNavigation.map((item) => item.id)).size, 8);
  assert.deepEqual(commandNavigation.map((item) => item.code), ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);
});
test("empty casework does not invent operational performance", () => {
  assert.deepEqual(commandMetrics([]), { activeIncidents: 0, pendingDecisions: 0, pendingTasks: 0, modeledFunctions: 0, savedCoordinationNotes: 0, closedIncidents: 0, firstReviewMedianSeconds: null });
});
test("counts derive from active workflows and deduplicate modeled function IDs", () => {
  const a = fixture({ decisions: [{ functionId: "treatment", reviewed: false }, { functionId: "support", reviewed: true, reviewedAt: "2026-10-13T12:00:10Z" }], notes: [{ text: "Local note" }] });
  const b = fixture({ id: "case-closed", status: "closed", decisions: [{ functionId: "other", reviewed: false }], tasks: [{ completed: false }], notes: [{ text: "Historical note" }] });
  const c = fixture({ id: "case-monitor", status: "monitoring", tasks: [{ completed: true }], decisions: [{ functionId: "treatment", reviewed: false }] });
  const metrics = commandMetrics([a, b, c]);
  assert.equal(metrics.activeIncidents, 2);
  assert.equal(metrics.pendingTasks, 1);
  assert.equal(metrics.pendingDecisions, 2);
  assert.equal(metrics.modeledFunctions, 2);
  assert.equal(metrics.savedCoordinationNotes, 2);
  assert.equal(metrics.closedIncidents, 1);
  assert.equal(metrics.firstReviewMedianSeconds, 10);
});
test("review time measures recorded casework, not compromise/detection", () => {
  const a = fixture({ decisions: [{ reviewed: true, reviewedAt: "2026-10-13T12:00:10Z" }] });
  const b = fixture({ id: "case-b", decisions: [{ reviewed: true, reviewedAt: "2026-10-13T12:00:30Z" }] });
  assert.equal(commandMetrics([a, b]).firstReviewMedianSeconds, 20);
  assert.equal(commandMetrics([fixture({ decisions: [{ reviewed: true, reviewedAt: "2026-10-13T11:59:59Z" }] })]).firstReviewMedianSeconds, null);
  assert.equal(commandMetrics([fixture({ createdAt: "unknown", decisions: [{ reviewed: true, reviewedAt: "invalid" }] })]).firstReviewMedianSeconds, null);
});
test("priority ordering is deterministic and never mutates original inputs", () => {
  const records = [fixture({ id: "medium" }), fixture({ id: "urgent", priority: "critical" }), fixture({ id: "closed", status: "closed", priority: "critical" })];
  const before = structuredClone(records);
  assert.deepEqual(orderIncidents(records).map((item) => item.id), ["urgent", "medium", "closed"]);
  assert.deepEqual(records, before);
});
test("brief export preserves records and declares review-only / not sent", () => {
  const source = fixture({ decisions: [{ reviewed: true, authorityBasis: "not_configured", gateStatus: "not_evaluated" }] });
  const brief = incidentBrief(source);
  assert.equal(brief.externalDelivery, "not_sent");
  assert.equal(brief.authorityBasis, "not_configured");
  brief.incident.decisions[0].reviewed = false;
  assert.equal(source.decisions[0].reviewed, true);
});
test("geometry comes only from valid source records, not inferred Texas locations", () => {
  const sources = [
    { id: "p", geometry: { type: "Point", coordinates: [0.02, 0.03] } },
    { id: "a", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    { id: "missing" },
    { id: "bad", geometry: { type: "Point", coordinates: [Infinity, 100] } },
    { id: "open", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0.2, 0.2]]] } },
  ];
  const before = structuredClone(sources);
  const features = referenceGeometries(sources);
  assert.deepEqual(features.map((feature) => feature.entity.id), ["p", "a"]);
  assert.deepEqual(features[0].points, [[0.02, 0.03]]);
  assert.deepEqual(sources, before);
  const project = geometryLayout(features);
  assert.deepEqual(project([0, 0]), [40, 360]);
  assert.deepEqual(project([1, 1]), [760, 40]);
  assert.equal(geometryLayout([])([0, 0]).every(Number.isFinite), true);
});

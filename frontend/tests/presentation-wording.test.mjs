import "./configured-time-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  timeLabel,
  planningWindow,
  capturedClassification,
} from "../src/commandCenterModel.ts";
import { analysisLabel } from "../src/caseFilePresentation.ts";
test("clock and modeled interval wording use CT and an en-dash h label without changing numbers", () => {
  assert.equal(timeLabel("2026-10-13T03:09:00-05:00"), "03:09 CDT");
  assert.equal(planningWindow([1, 4]), "1–4 h");
  assert.equal(planningWindow([0.5, 1.25]), "0.5–1.25 h");
  assert.equal(
    analysisLabel({ createdAt: "2026-10-13T03:09:00-05:00" }),
    "analysis at 03:09 CDT",
  );
});
test("unassigned means genuinely absent, not an unresolved declared IDT code", () => {
  assert.match(
    capturedClassification({ type: "Hospital", idt: { status: "unassigned" } })
      .label,
    /IDT code not assigned/,
  );
  assert.doesNotMatch(
    capturedClassification({
      type: "Hospital",
      idt: { status: "coded", path: "999.1" },
    }).label,
    /not assigned/,
  );
});

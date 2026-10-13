import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { displayText } from "../src/presentation.ts";

const scenario = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const legacyWording = /\b(synthetic|demo|demonstration|simulated)\b/i;

test("reference titles and event descriptions use professional display copy", () => {
  for (const source of scenario.sources) {
    assert.equal(legacyWording.test(displayText(source.label)), false);
  }
  for (const event of scenario.events) {
    assert.equal(legacyWording.test(displayText(event.description)), false);
  }
  for (const seed of scenario.scenarios) {
    assert.equal(legacyWording.test(displayText(seed.description)), false);
  }
  assert.equal(displayText('["SIMULATED"]'), "Reference data");
  assert.equal(displayText("synthetic_index"), "Relative index");
  assert.equal(
    displayText("Simulated completed connection at A."),
    "Completed connection at A.",
  );
  assert.equal(displayText("synthetic-campaign-01"), "Campaign 01");
  assert.equal(displayText(scenario.modelVersion), "interval-v1");
});

test("entity aliases retain stable identities and do not mutate input records", () => {
  const original = JSON.stringify(scenario);
  for (const entity of scenario.entities) displayText(entity.label);
  for (const link of scenario.dependencies) {
    assert.equal(legacyWording.test(displayText(link.assumptionNote)), false);
  }
  assert.equal(JSON.stringify(scenario), original);
  assert.equal(scenario.demoMode, true);
  assert.deepEqual(scenario.handling, ["SIMULATED"]);
});

test("custom text, identifiers, and provenance are never blindly scrubbed", () => {
  for (const value of [
    "Customer synthetic fiber supplier",
    "demo-service-id",
    '["SIMULATED", "U"]',
    "__proto__",
    "toString",
    "constructor",
    "",
  ]) {
    assert.equal(displayText(value), value);
  }
});

test("the interface retains provenance and unmodified raw-record inspection", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.ok(app.includes("Data provenance & intended use"));
  assert.ok(app.replace(/\s+/g, " ").includes("not a live utility feed"));
  assert.ok(app.includes("JSON.stringify(event, null, 2)"));
  assert.ok(app.includes("JSON.stringify(source, null, 2)"));
  assert.equal(legacyWording.test(app), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (n) =>
  readFileSync(new URL("../src/" + n, import.meta.url), "utf8");
test("one shared header sample chip serves both modes, never repeated in casework status blocks", () => {
  const app = read("App.tsx"),
    workspace = read("CommandWorkspace.tsx");
  assert.equal(
    (app.match(/Sample data · not connected to live systems/g) || []).length,
    1,
  );
  assert.doesNotMatch(workspace, />Sample data</);
  assert.doesNotMatch(workspace, /className="prototype-status"/);
  assert.match(workspace, /records\?\.storyNow/);
  assert.match(workspace, /formatTimeCT\(records.storyNow\)/);
});
test("copy cleanup preserves explicit pending-write recovery and raw record export", () => {
  const source = read("CommandWorkspace.tsx");
  for (const text of [
    "Retry same saved request",
    "pending.current || pendingRun.current",
    "JSON.stringify(selected, null, 2)",
    "expectedVersion",
    "clientRequestId",
  ])
    assert.ok(source.includes(text), text);
});

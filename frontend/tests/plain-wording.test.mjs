import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { inspectCopy, paragraphStats } from "../../scripts/check_ui_copy.mjs";
test("copy guard ignores identifiers/comments but checks JSX and template text", () => {
  assert.equal(
    inspectCopy(
      'const workspaceCase = "ok"; const action = "review_decision"; // "workspace case"',
      "safe.ts",
    ).length,
    0,
  );
  assert.ok(inspectCopy("<p>Not supplied</p>", "bad.tsx").length > 0);
  assert.ok(
    inspectCopy("const x = `No ${kind} workspace case`;", "bad.ts").length > 0,
  );
  assert.equal(
    paragraphStats('f(`p`,{children:`First`});g("p",{children:"Second"});')
      .sites,
    2,
  );
});
const script = new URL("../../scripts/check_ui_copy.mjs", import.meta.url)
  .pathname;
test("source UI copy has no retired navigation or boundary phrases", () => {
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [script], { encoding: "utf8" }),
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const script = new URL("../../scripts/check_no_egress.py", import.meta.url)
  .pathname;
function check(extra = "") {
  const dir = mkdtempSync(join(tmpdir(), "citride-assets-"));
  try {
    mkdirSync(join(dir, "assets"));
    writeFileSync(
      join(dir, "index.html"),
      '<link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js"></script>' +
        extra,
    );
    writeFileSync(join(dir, "assets", "app.js"), "");
    writeFileSync(
      join(dir, "assets", "app.css"),
      '@font-face{font-family:"IBM Plex Sans";src:url("/assets/sans.woff2")}@font-face{font-family:"IBM Plex Mono";src:url("/assets/mono.woff2")}',
    );
    writeFileSync(join(dir, "assets", "sans.woff2"), "test fixture");
    writeFileSync(join(dir, "assets", "mono.woff2"), "test fixture");
    return spawnSync("python3", [script, "--dist", dir], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("static no-egress check accepts same-origin self-hosted assets", () => {
  const r = check();
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
test("static no-egress check rejects remote fonts and script resources", () => {
  for (const tag of [
    '<link rel="stylesheet" href="https://fonts.googleapis.com/font.css">',
    '<script src="https://example.test/lib.js"></script>',
  ]) {
    const r = check(tag);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /external|remote/i);
  }
});
test("static no-egress check rejects protocol-relative resource URLs", () => {
  assert.notEqual(check('<img src="//example.test/image.png">').status, 0);
});

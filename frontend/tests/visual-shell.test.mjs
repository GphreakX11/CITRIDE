import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const cssUrl = new URL("../src/visual-shell.css", import.meta.url);
const css = existsSync(cssUrl) ? readFileSync(cssUrl, "utf8") : "";
const header =
  app.match(
    /<header className="topbar shell-header">([\s\S]*?)<\/header>/,
  )?.[1] ?? "";

test("shell exposes mode and places the existing brand and mode switch in the global header", () => {
  assert.match(app, /data-mode=\{mode\}/);
  assert.match(header, /className="brand"/);
  assert.match(header, /CITRIDE/);
  assert.match(
    header,
    /className="workspace-mode-switch" aria-label="Workspace mode"/,
  );
  assert.match(header, /onClick=\{\(\) => switchMode\("command"\)\}/);
  assert.match(header, /onClick=\{\(\) => switchMode\("analyst"\)\}/);
  assert.equal((app.match(/aria-label="Workspace mode"/g) ?? []).length, 1);
});

test("existing navigation, Advanced preferences, and mobile callbacks are retained", () => {
  for (const text of [
    "workspaceNavigation.map(({ id, code, label, unit, color })",
    'aria-label={`${code} ${label}${unit ? ` ${unit}` : ""}`}',
    'aria-current={view === id ? "page" : undefined}',
    "onClick={() => changeView(id)}",
    '<details className="model-tools" open={advancedOpen}>',
    'localStorage.setItem("citride.advanced.open", String(open))',
    "Advanced tools",
    "onClick={() => setMobileMenu(true)}",
    "onClick={() => setMobileMenu(false)}",
    "onClick={() => void refresh()}",
  ])
    assert.ok(app.includes(text), text);
  assert.match(app, /className="shell-nav-heading"/);
  assert.match(header, /disabled=\{workflowLocked\}/);
});

test("header offers a context mount with static sample status, without inventing a clock or case action", () => {
  assert.match(header, /id="workspace-header-context"/);
  assert.doesNotMatch(header, /new Date|Date\.now|Open case from alert/);
  assert.match(header, /Sample data · not connected to live systems/);
  assert.doesNotMatch(header, /Baseline r/);
  assert.match(app, /Baseline r\{data\?\.baselineRevision/);
  assert.match(header, /aria-label="Reload model"/);
});

test("shell CSS uses semantic colors and tokenized type while containing the mobile shell", () => {
  assert.ok(css.length > 0, "visual-shell.css exists");
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|(?:rgb|hsl)a?\(/i);
  for (const size of css.matchAll(/font-size\s*:\s*([^;\n}]+)/g)) {
    assert.match(size[1], /^var\(--fs-[\w-]+\)$/);
  }
  assert.match(css, /grid-template-columns:\s*230px minmax\(0, 1fr\)/);
  assert.match(css, /font-size:\s*var\(--fs-brand\)/);
  assert.match(css, /font-size:\s*var\(--fs-nav-heading\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /\.sidebar\.open/);
  assert.doesNotMatch(
    css,
    /overflow-x:\s*(?:clip|hidden)/,
    "Do not hide page overflow instead of fixing its source",
  );
  assert.match(css, /min-width:\s*0/);
});

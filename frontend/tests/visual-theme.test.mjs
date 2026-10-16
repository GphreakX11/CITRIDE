import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
const root = new URL("../src/", import.meta.url),
  theme = new URL("theme.css", root);
const css = existsSync(theme) ? readFileSync(theme, "utf8") : "";
const palette = {
  bg: "#0A1120",
  "bg-header": "#0D1526",
  surface: "#111A2C",
  "surface-2": "#16233B",
  "nav-active": "#1A2842",
  border: "#22304A",
  "border-strong": "#2E4063",
  text: "#E8EEF7",
  "text-strong": "#FFFFFF",
  "text-2": "#C9D5E6",
  "text-muted": "#A3B1C6",
  link: "#9CC7FF",
  "link-hover": "#CFE3FF",
  accent: "#3B82F6",
  "accent-bg": "#13243F",
  "mode-active": "#1F3A66",
  red: "#F97066",
  "red-bg": "#3A1C1C",
  "red-text": "#FFB3AA",
  amber: "#F5A524",
  "amber-bg": "#2A2312",
  "amber-text": "#F5C76B",
  green: "#2F7A4F",
  "green-bg": "#12301F",
  "green-text": "#A7F3C5",
  "blue-bg": "#13243F",
  "blue-text": "#9CC7FF",
  grey: "#7C8BA3",
  "sample-border": "#5B4A1E",
  "sample-text": "#F5C76B",
};
test("one authoritative theme declares the exact mockup palette", () => {
  for (const [key, value] of Object.entries(palette))
    assert.match(css, new RegExp(`--${key}:\\s*${value}\\s*;`, "i"), key);
});
test("all stylesheets use tokens, never local hex colors or screen-specific type sizes", () => {
  for (const name of readdirSync(root).filter(
    (n) => n.endsWith(".css") && n !== "theme.css",
  )) {
    const source = readFileSync(new URL(name, root), "utf8");
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/i, name);
    for (const m of source.matchAll(/font-size\s*:\s*([^;}]+)/g))
      assert.match(m[1], /^(?:\s*var\(--|\s*inherit\s*$)/, `${name}: ${m[0]}`);
    assert.doesNotMatch(
      source,
      /Manrope|DM Sans|SFMono-Regular|Consolas/,
      name,
    );
  }
});
test("Plex fonts are self-hosted and theme is imported exactly once at entry", () => {
  const main = readFileSync(new URL("main.tsx", root), "utf8");
  assert.equal(
    (main.match(/import\s+["']\.\/theme\.css["']/g) || []).length,
    1,
  );
  for (const w of [400, 500, 600, 700])
    assert.ok(main.includes(`@fontsource/ibm-plex-sans/latin-${w}.css`));
  for (const w of [400, 500])
    assert.ok(main.includes(`@fontsource/ibm-plex-mono/latin-${w}.css`));
  for (const n of readdirSync(root).filter((n) => /\.(?:css|tsx)$/.test(n)))
    assert.doesNotMatch(
      readFileSync(new URL(n, root), "utf8"),
      /fonts\.googleapis\.com|fonts\.gstatic\.com/,
    );
});
const luminance = (hex) => {
  const c = hex
    .slice(1)
    .match(/../g)
    .map((n) => parseInt(n, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
const contrast = (a, b) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
test("body, links, status labels and sample labels meet WCAG AA", () => {
  for (const [fg, bg] of [
    ["text", "bg"],
    ["text", "surface"],
    ["text-strong", "surface"],
    ["text-2", "surface"],
    ["text-muted", "surface-2"],
    ["link", "surface-2"],
    ["link-hover", "surface"],
    ["red-text", "red-bg"],
    ["amber-text", "amber-bg"],
    ["green-text", "green-bg"],
    ["blue-text", "blue-bg"],
    ["grey", "surface"],
    ["sample-text", "bg-header"],
  ])
    assert.ok(
      contrast(palette[fg], palette[bg]) >= 4.5,
      `${fg}/${bg}: ${contrast(palette[fg], palette[bg]).toFixed(2)}`,
    );
  // Exact supplied accent + white is only AA for large type. The shared primary
  // control rule therefore uses 19px/700, not a false 4.5:1 assertion for small text.
  assert.ok(contrast(palette["text-strong"], palette.accent) >= 3);
  assert.match(css, /--fs-button:\s*19px/);
  assert.match(css, /font-weight:\s*700/);
});
test("per-mode scale and wall readability live only in theme tokens", () => {
  const command = css.slice(css.indexOf('[data-mode="command"]'));
  for (const [key, value] of Object.entries({
    "fs-body": 17,
    "fs-title": 32,
    "fs-subtitle": 17,
    "fs-card-title": 20,
    "fs-number": 34,
    "fs-tile-label": 15,
    "fs-small": 14,
    "fs-chip": 13,
    "fs-menu": 16,
  }))
    assert.match(command, new RegExp(`--${key}:\\s*${value}px`));
  for (const [key, value] of Object.entries({
    "fs-body": 15,
    "fs-title": 28,
    "fs-number": 26,
  }))
    assert.match(css, new RegExp(`--${key}:\\s*${value}px`));
});

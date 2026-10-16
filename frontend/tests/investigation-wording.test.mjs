import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
const url = new URL("../src/InvestigationBar.tsx", import.meta.url);
let code = (
  await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
    jsx: { runtime: "automatic" },
  })
).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
code = code.replace(
  /from\s+["']([^"']+)["']/g,
  (_m, s) =>
    `from ${JSON.stringify(s.startsWith(".") ? new URL(/\.[jt]sx?$/.test(s) ? s : s + ".ts", url).href : import.meta.resolve(s))}`,
);
const Bar = (
  await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  )
).default;
const nodes = (n) =>
  Array.isArray(n)
    ? n.flatMap(nodes)
    : isValidElement(n)
      ? [n, ...nodes(n.props.children)]
      : [];
const text = (n) =>
  Array.isArray(n)
    ? n.map(text).join("")
    : isValidElement(n)
      ? text(n.props.children)
      : typeof n === "string"
        ? n
        : "";
test("Analyst steps use A2/A3/A4/A5/A6 labels and original route callbacks, no Command brief", () => {
  const calls = [],
    p = {
      entity: {
        id: "utility-a",
        type: "WaterServiceProvider",
        label: "Utility A",
      },
      selectedCase: { id: "case-1" },
      cases: [],
      view: "cop",
      locked: false,
      onSelectCase() {},
      onClear() {},
      onNavigate: (v) => calls.push(v),
    };
  const tree = Bar(p),
    nav = nodes(tree).find(
      (n) => n.props["aria-label"] === "Investigation steps",
    );
  const buttons = nodes(nav)
    .filter((n) => n.type === "button")
    .slice(0, 5);
  assert.deepEqual(buttons.map(text), [
    "Map",
    "Evidence",
    "Consequences",
    "Who acts first",
    "Tasks",
  ]);
  buttons.forEach((b) => b.props.onClick());
  assert.deepEqual(calls, [
    "cop",
    "cyber",
    "consequence",
    "coordination",
    "uctf",
  ]);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Bar, p)), />Brief</);
});
test("summary names the actual utility, while navigation locks stay intact", () => {
  const props = {
    entity: { id: "a", type: "WaterServiceProvider", label: "Utility A" },
    selectedCase: null,
    cases: [],
    view: "cop",
    locked: true,
    onSelectCase() {},
    onClear() {},
    onNavigate() {},
  };
  const html = renderToStaticMarkup(createElement(Bar, props));
  assert.match(html, /No case is linked to this utility/);
  assert.ok(
    nodes(Bar(props))
      .filter((n) => n.type === "button")
      .every((n) => n.props.disabled),
  );
});

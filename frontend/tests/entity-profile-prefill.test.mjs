import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { isValidElement } from "react";
import { transformWithOxc } from "vite";
const root = new URL("../src/", import.meta.url);
const hooks = `data:text/javascript;base64,${Buffer.from(`export const useEffect=()=>{},useId=()=>"entity-prefill-test",useState=x=>[typeof x==='function'?x():x,()=>{}],useRef=x=>({current:x}),useMemo=f=>f();`).toString("base64")}`;
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const targets = new Map();
  for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = match[1];
    let target;
    if (spec === "react") target = hooks;
    else if (spec.startsWith(".")) {
      let next = new URL(spec, url);
      if (!existsSync(next))
        next =
          [".ts", ".tsx"]
            .map((ext) => new URL(spec + ext, url))
            .find(existsSync) ?? next;
      target = await compile(next);
    } else target = import.meta.resolve(spec);
    targets.set(spec, target);
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_, spec) => `from ${JSON.stringify(targets.get(spec))}`,
  );
  const compiled = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, compiled);
  return compiled;
}
function all(node) {
  if (Array.isArray(node)) return node.flatMap(all);
  return isValidElement(node) ? [node, ...all(node.props.children)] : [];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement(node)
    ? text(node.props.children)
    : typeof node === "string" || typeof node === "number"
      ? String(node)
      : "";
}
test("profile proposal opens the actual editor with that entity, not the first dependency endpoint", async () => {
  const data = JSON.parse(
    readFileSync(new URL("../../data/scenario.json", import.meta.url)),
  );
  const selected = "nursing-z";
  assert.notEqual(data.dependencies[0].dependent, selected);
  const { default: Profile } = await import(
    await compile(new URL("AnalystEntityProfile.tsx", root))
  );
  let captured = null;
  const noop = () => {};
  const tree = Profile({
    data,
    entityId: selected,
    incidents: [],
    locked: false,
    onSelectEntity: noop,
    onOpenCase: noop,
    onOpenTool: noop,
    onEditDependency: (...args) => (captured = args),
    onBack: noop,
  });
  const button = all(tree).find(
    (n) => n.type === "button" && text(n) === "Propose a new dependency",
  );
  assert.ok(button);
  button.props.onClick();
  assert.deepEqual(captured, [null, { entityId: selected, role: "dependent" }]);
  const { default: Editor } = await import(
    await compile(new URL("RelationshipEditor.tsx", root))
  );
  const editor = Editor({
    data,
    initial: captured[0],
    prefill: captured[1],
    onClose: noop,
    onPromoted: async () => {},
  });
  assert.ok(
    all(editor).some((n) => n.type === "select" && n.props.value === selected),
    "actual editor selects the profiled entity",
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transformWithOxc } from "vite";

// Run the real TSX event handlers without creating build artifacts or adding a
// DOM dependency. Effects/layout are intentionally excluded: parent owns browser QA.
const hooksUrl = `data:text/javascript,${encodeURIComponent(`
  export const useState = (...args) => globalThis.__billingtonHooks.useState(...args);
  export const useRef = (...args) => globalThis.__billingtonHooks.useRef(...args);
  export const useMemo = (fn) => fn();
  export const useEffect = () => {};
`)}`;
async function loadComponent(name) {
  const file = new URL(`../src/${name}.tsx`, import.meta.url);
  const source = await readFile(file, "utf8");
  const transformed = await transformWithOxc(source, file.pathname, {
    jsx: { runtime: "automatic" },
  });
  const code = transformed.code.replace(/from "([^"]+)"/g, (_, specifier) => {
    const url =
      specifier === "react"
        ? hooksUrl
        : specifier.startsWith(".")
          ? new URL(`${specifier}.ts`, file).href
          : import.meta.resolve(specifier);
    return `from ${JSON.stringify(url)}`;
  });
  return (
    await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    )
  ).default;
}
const Editor = await loadComponent("RelationshipEditor");
const Graph = await loadComponent("Graph");
const fixture = JSON.parse(
  await readFile(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);

function harness(Component, props) {
  const slots = [];
  let cursor;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === "function" ? initial() : initial;
      return [
        slots[index],
        (value) => {
          slots[index] =
            typeof value === "function" ? value(slots[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
  };
  return {
    render() {
      cursor = 0;
      globalThis.__billingtonHooks = hooks;
      return Component(props);
    },
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return text(tree.props?.children);
}
const button = (tree, label) =>
  nodes(tree).find((node) => node.type === "button" && text(node) === label);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function editor() {
  const data = structuredClone({ ...fixture, baselineRevision: 1 });
  return harness(Editor, {
    data,
    initial: data.dependencies[0],
    onClose() {},
    async onPromoted() {},
  });
}
async function submit(view) {
  nodes(view.render())
    .find((node) => node.type === "form")
    .props.onSubmit({ preventDefault() {} });
  await settle();
}
async function click(view, label) {
  const target = button(view.render(), label);
  assert.ok(target, `Missing button: ${label}`);
  assert.ok(!target.props.disabled, `Disabled button: ${label}`);
  target.props.onClick();
  await settle();
}

test("stale Stage offers reload and re-stage, preserving every draft field and requiring new validation", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let stageCount = 0;
  globalThis.fetch = async (path, options) => {
    const body = options?.body && JSON.parse(options.body);
    calls.push({ path, body });
    if (path === "/v1/bootstrap")
      return json({ ...fixture, baselineRevision: 2 });
    if (++stageCount === 1)
      return json(
        {
          detail:
            "Baseline revision changed; reload and re-stage against the current baseline",
        },
        409,
      );
    return json({ id: "fresh", status: "draft", ...body }, 201);
  };
  try {
    const view = editor();
    nodes(view.render())
      .find((node) => node.type === "textarea")
      .props.onChange({
        target: { value: "Keep my analyst draft and evidence" },
      });
    await submit(view);
    assert.ok(button(view.render(), "Reload and re-stage"));
    assert.equal(button(view.render(), "Stage proposal").props.disabled, true);
    assert.equal(button(view.render(), "Promote").props.disabled, true);
    await click(view, "Reload and re-stage");
    assert.deepEqual(
      calls.map(({ path }) => path),
      ["/v1/dependency-proposals", "/v1/bootstrap", "/v1/dependency-proposals"],
    );
    assert.equal(calls[0].body.expectedBaselineRevision, 1);
    assert.equal(calls[2].body.expectedBaselineRevision, 2);
    assert.deepEqual(calls[2].body.dependency, calls[0].body.dependency);
    assert.equal(
      calls[2].body.dependency.assumptionNote,
      "Keep my analyst draft and evidence",
    );
    assert.match(text(view.render()), /Baseline revision 2/);
    assert.equal(button(view.render(), "Reload and re-stage"), undefined);
    assert.equal(button(view.render(), "Validate").props.disabled, false);
    assert.equal(button(view.render(), "Promote").props.disabled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Promote baseline conflict discards old validation; failed reload preserves editable draft and retry", async () => {
  const originalFetch = globalThis.fetch;
  let reloads = 0;
  const bodies = [];
  globalThis.fetch = async (path, options) => {
    if (path.endsWith("/validate")) return json({ valid: true, errors: [] });
    if (path.endsWith("/promote"))
      return json(
        {
          detail:
            "Baseline revision changed; create a proposal against the current baseline",
        },
        409,
      );
    if (path === "/v1/bootstrap") {
      if (++reloads === 1)
        return json({ detail: "Temporary reload failure" }, 503);
      return json({ ...fixture, baselineRevision: 3 });
    }
    const body = JSON.parse(options.body);
    bodies.push(body);
    return json({ id: "staged", status: "draft", ...body }, 201);
  };
  try {
    const view = editor();
    await submit(view);
    await click(view, "Validate");
    await click(view, "Promote");
    assert.equal(button(view.render(), "Promote").props.disabled, true);
    await click(view, "Reload and re-stage");
    assert.match(text(view.render()), /Temporary reload failure/);
    const note = nodes(view.render()).find((node) => node.type === "textarea");
    note.props.onChange({ target: { value: "Retained after failed reload" } });
    await click(view, "Reload and re-stage");
    assert.equal(bodies.length, 2);
    assert.equal(
      bodies[1].dependency.assumptionNote,
      "Retained after failed reload",
    );
    assert.equal(bodies[1].expectedBaselineRevision, 3);
    assert.equal(button(view.render(), "Promote").props.disabled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-conflict authorization failure does not offer automatic re-stage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    json({ detail: "Authentication required" }, 401);
  try {
    const view = editor();
    await submit(view);
    assert.match(text(view.render()), /Authentication required/);
    assert.equal(button(view.render(), "Reload and re-stage"), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("graph legend explains orange as modeled impact rather than an observed outage", () => {
  const tree = harness(Graph, {
    data: fixture,
    selectedId: null,
    onSelect() {},
  }).render();
  assert.match(
    text(tree),
    /Orange: modeled impacted node, not an observed outage/,
  );
  assert.ok(
    nodes(tree).some(
      (node) =>
        node.type === "i" && node.props.style?.backgroundColor === "#d27832",
    ),
  );
});

test("incident scenario-lab entry explicitly warns that it clears what-if changes", async () => {
  const source = await readFile(
    new URL("../src/IncidentWorkspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /onClick=\{\(\) => onOpenLab\(scenario\.id\)\}/);
  assert.match(source, /Open in scenario lab \(clears what-if changes\)/);
  assert.doesNotMatch(source, />\s*Model consequences\s*</);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { transformWithOxc } from "vite";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const baseline = JSON.parse(read("../../data/scenario.json"));
const metadata = {
  id: "local",
  version: "v1",
  sha256: "current-hash",
  axioms: [],
  profile: "OWL 2 RL",
  engine: { name: "owlrl", version: "test" },
  idtClassCount: 1985,
  loadedIdtClassCount: 1985,
  idtLoadMode: "assigned_closure",
};
const entity = baseline.entities.find((e) => e.id === "dialysis-x");
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
function fact(id, object, status = "inferred", subject = entity.id) {
  return {
    id,
    subject: { id: subject, iri: `urn:citride:${subject}`, label: subject },
    predicate: { iri: rdfType, label: "type" },
    object: { id: object, iri: `urn:citride:${object}`, label: object },
    status,
    sourceRefs: [],
    axiomIds: [],
    premiseFactIds: [],
  };
}
function run(changes = {}) {
  return {
    id: "current-run",
    baselineRevision: baseline.baselineRevision,
    ontology: metadata,
    profile: metadata.profile,
    engine: metadata.engine,
    baselineSnapshot: structuredClone(baseline),
    assertedFacts: [fact("leaf", "IDT_10_1_2_4", "asserted")],
    inferredFacts: [
      fact("parent", "IDT_10_1_2"),
      fact("branch", "IDT_10_1"),
      fact("sector", "IDT_10"),
      fact("manual", "Facility"),
    ],
    warnings: [],
    diagnostics: [],
    statistics: {},
    ...changes,
  };
}

// In-memory hook/effect harness executes real component handlers and read-only API
// flows. It is not a browser/DOM/layout test and invents no production proof.
async function harness(file, responses) {
  const requests = [];
  const hooks = { values: [], cursor: 0, effects: [], dirty: true };
  const changed = (a, b) =>
    !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const context = {
    useState(initial) {
      const i = hooks.cursor++;
      if (!(i in hooks.values))
        hooks.values[i] = typeof initial === "function" ? initial() : initial;
      return [
        hooks.values[i],
        (value) => {
          const next =
            typeof value === "function" ? value(hooks.values[i]) : value;
          if (!Object.is(next, hooks.values[i])) {
            hooks.values[i] = next;
            hooks.dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      const i = hooks.cursor++;
      return (hooks.values[i] ??= { current: initial });
    },
    useMemo(fn) {
      hooks.cursor++;
      return fn();
    },
    useId() {
      hooks.cursor++;
      return "part2";
    },
    useEffect(fn, deps) {
      const i = hooks.cursor++;
      const prev = hooks.values[i];
      if (changed(prev?.deps, deps)) {
        prev?.cleanup?.();
        hooks.values[i] = { deps };
        hooks.effects.push(() => {
          hooks.values[i].cleanup = fn();
        });
      }
    },
    async api(path, body) {
      requests.push({ path, body });
      return responses(path, body);
    },
  };
  const key = `__idtPart2${Math.random().toString(36).slice(2)}`;
  globalThis[key] = context;
  const facade = `data:text/javascript;base64,${Buffer.from(`const c=globalThis[${JSON.stringify(key)}];export const {useState,useRef,useMemo,useId,useEffect,api}=c;export const humanize=v=>String(v);export const windowLabel=v=>JSON.stringify(v);export const describe=v=>JSON.stringify(v);`).toString("base64")}`;
  const cache = new Map();
  async function compile(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    let code = (
      await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
        jsx: { runtime: "automatic" },
      })
    ).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
    for (const spec of new Set(
      [...code.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(
        (m) => m[1],
      ),
    )) {
      let target;
      if (spec === "react" || spec === "./api") target = facade;
      else if (spec.startsWith(".")) {
        let dep = new URL(spec, url);
        if (!existsSync(dep))
          dep = [".tsx", ".ts"]
            .map((ext) => new URL(spec + ext, url))
            .find(existsSync);
        assert.ok(dep, spec);
        target = await compile(dep);
      } else target = import.meta.resolve(spec);
      code = code.replaceAll(JSON.stringify(spec), JSON.stringify(target));
    }
    const target = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
    cache.set(url.href, target);
    return target;
  }
  const Component = (
    await import(await compile(new URL(`../src/${file}`, import.meta.url)))
  ).default;
  let props, tree;
  return {
    requests,
    async render(next) {
      props = next ?? props;
      hooks.dirty = true;
      for (let i = 0; i < 30; i++) {
        if (hooks.dirty) {
          hooks.dirty = false;
          hooks.cursor = 0;
          tree = Component(props);
        }
        for (const effect of hooks.effects.splice(0)) effect();
        await new Promise(setImmediate);
        if (!hooks.dirty && !hooks.effects.length) return tree;
      }
      throw new Error("Component did not settle");
    },
    close() {
      hooks.values.forEach((v) => v?.cleanup?.());
      delete globalThis[key];
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
function button(tree, label) {
  return nodes(tree).find(
    (n) => n.type === "button" && text(n).includes(label),
  );
}
function endpoints(current, proof = null) {
  return async (path, body) => {
    assert.equal(
      body,
      undefined,
      "navigation/load must never create inference runs",
    );
    if (path === "/v1/ontology") return metadata;
    if (path === "/v1/reference/idt")
      return JSON.parse(read("../../data/reference/idt/idt_v4.json"));
    if (path === "/v1/inference-runs")
      return {
        runs: current
          ? [{ id: current.id, baselineRevision: current.baselineRevision }]
          : [],
      };
    if (path === `/v1/inference-runs/${current?.id}`) return current;
    if (path.includes("/facts/"))
      return (
        proof ?? {
          runId: current.id,
          fact:
            current.inferredFacts.find((f) => path.endsWith(f.id)) ??
            current.assertedFacts[0],
          proofFacts: [],
          axioms: [],
          sources: [],
          baselineRevision: current.baselineRevision,
        }
      );
    throw new Error(`Unexpected ${path}`);
  };
}
const profileProps = {
  data: baseline,
  entityId: entity.id,
  incidents: [],
  locked: false,
  onSelectEntity() {},
  onOpenCase() {},
  onEditDependency() {},
  onBack() {},
};

test("current-run detection requires current baseline AND current ontology, never just a run ID", async () => {
  const { isCurrentInferenceRun } = await import("../src/idtProof.ts");
  assert.equal(
    isCurrentInferenceRun(run(), baseline.baselineRevision, metadata),
    true,
  );
  for (const change of [
    { baselineRevision: -1 },
    { stale: true },
    { staleReasons: { baselineRevision: false, ontology: true } },
    { ontology: { ...metadata, sha256: "old" } },
  ])
    assert.equal(
      isCurrentInferenceRun(run(change), baseline.baselineRevision, metadata),
      false,
    );
  assert.equal(
    isCurrentInferenceRun(run(), baseline.baselineRevision, null),
    false,
  );
});

test("IDT conclusion selects actual entity sector type fact, not leaf/other entity/relation", async () => {
  const { idtConclusion } = await import("../src/idtProof.ts");
  assert.equal(idtConclusion(entity, run())?.id, "sector");
  assert.equal(
    idtConclusion(entity, run({ inferredFacts: [] })),
    null,
    "missing sector is not fabricated",
  );
  assert.equal(
    idtConclusion(
      entity,
      run({
        inferredFacts: [fact("wrong", "IDT_10", "inferred", "hospital-y")],
      }),
    ),
    null,
  );
  assert.equal(
    idtConclusion(
      entity,
      run({
        inferredFacts: [
          {
            ...fact("wrong", "IDT_10"),
            predicate: { iri: "urn:citride:partOf", label: "part of" },
          },
        ],
      }),
    ),
    null,
  );
  for (const idt of [
    undefined,
    { status: "not_asset" },
    { status: "below_idt_level", path: "10.1.2.4" },
    { status: "unknown", path: "10.1.2.4" },
  ])
    assert.equal(idtConclusion({ ...entity, idt }, run()), null);
});

test("profile opens actual current IDT proof and preserves entity; missing/stale never says See proof", async () => {
  for (const current of [
    run(),
    null,
    run({ stale: true }),
    run({ ontology: { ...metadata, sha256: "old" } }),
    run({ baselineRevision: -1 }),
    run({ inferredFacts: [] }),
  ]) {
    let opened;
    const h = await harness("AnalystEntityProfile.tsx", endpoints(current));
    try {
      const tree = await h.render({
        ...profileProps,
        onOpenTool: (...args) => {
          opened = args;
        },
      });
      const canProve =
        current?.id === "current-run" &&
        !current.stale &&
        current.ontology.sha256 === metadata.sha256 &&
        current.baselineRevision === baseline.baselineRevision &&
        current.inferredFacts.length;
      const action = button(
        tree,
        canProve ? "See the proof" : "Run reasoning to see the proof",
      );
      assert.ok(action, text(tree));
      assert.doesNotMatch(
        text(tree),
        /No IDT classification proof is supplied/,
      );
      action.props.onClick();
      assert.deepEqual(opened, ["reasoning", entity.id]);
      assert.ok(h.requests.every((r) => r.body === undefined));
    } finally {
      h.close();
    }
  }
});

test("reasoning auto-selects real sector proof once; manual choice stays selected", async () => {
  const current = run();
  const h = await harness("ReasoningView.tsx", endpoints(current));
  try {
    let tree = await h.render({ data: baseline, selectedEntityId: entity.id });
    assert.ok(
      h.requests.some((r) => r.path.endsWith("/facts/sector")),
      "real sector proof API must be read",
    );
    const selected = nodes(tree).find(
      (n) => n.type === "button" && n.props["aria-pressed"] === true,
    );
    assert.match(text(selected), /IDT_10$/);
    button(tree, "Facility").props.onClick();
    tree = await h.render();
    assert.match(
      text(
        nodes(tree).find(
          (n) => n.type === "button" && n.props["aria-pressed"] === true,
        ),
      ),
      /Facility$/,
    );
    assert.ok(h.requests.some((r) => r.path.endsWith("/facts/manual")));
    assert.ok(h.requests.every((r) => r.body === undefined));
  } finally {
    h.close();
  }
});

test("asserted sector conclusion changes filter, while no current run requires explicit inference", async () => {
  for (const current of [
    run({
      assertedFacts: [fact("asserted-sector", "IDT_10", "asserted")],
      inferredFacts: [],
    }),
    run({ stale: true }),
    null,
  ]) {
    const h = await harness("ReasoningView.tsx", endpoints(current));
    try {
      const tree = await h.render({
        data: baseline,
        selectedEntityId: entity.id,
      });
      if (current && !current.stale) {
        assert.ok(
          h.requests.some((r) => r.path.endsWith("/facts/asserted-sector")),
        );
        assert.ok(
          nodes(tree).some(
            (n) => n.type === "button" && n.props["aria-pressed"] === true,
          ),
        );
      } else assert.match(text(tree), /Run reasoning to see the proof/);
      assert.ok(h.requests.every((r) => r.body === undefined));
    } finally {
      h.close();
    }
  }
});

test("blueprint IDT card reflects real metadata counts and never assumes loaded when absent", async () => {
  const { idtRuntimeResource } = await import("../src/ontologyBlueprint.ts");
  const loaded = idtRuntimeResource(metadata);
  assert.equal(loaded.status, "Loaded in runtime");
  assert.match(loaded.description, /1985/);
  const pruned = idtRuntimeResource({ ...metadata, loadedIdtClassCount: 24 });
  assert.match(pruned.description, /24/);
  assert.match(pruned.description, /assigned_closure/);
  assert.equal(idtRuntimeResource(null).status, "Runtime status unknown");
  assert.equal(
    idtRuntimeResource({ ...metadata, idtClassCount: undefined }).status,
    "Runtime status unknown",
  );
  const h = await harness("OntologyBlueprint.tsx", endpoints(run()));
  try {
    const tree = await h.render({ onOpenReasoning() {} });
    const cards = nodes(tree).filter(
      (n) => typeof n.type === "function" && n.props.column,
    );
    const idt = cards
      .flatMap((n) => n.props.column.resources)
      .find((r) => r.id === "idt-owl");
    assert.equal(idt.status, "Loaded in runtime");
    assert.doesNotMatch(text(tree), /IDT and C3O are not imported/);
  } finally {
    h.close();
  }
});

test("current lookup reads details and skips mismatched ontology even when summary is not stale", async () => {
  const { currentInferenceRun } = await import("../src/idtProof.ts");
  const reads = [];
  const candidates = {
    old: run({ id: "old", ontology: { ...metadata, sha256: "old-hash" } }),
    current: run(),
  };
  const current = await currentInferenceRun(
    async (path) => {
      reads.push(path);
      return candidates[path.split("/").at(-1)];
    },
    baseline.baselineRevision,
    metadata,
    [
      { id: "wrong-baseline", baselineRevision: -1 },
      { id: "stale", baselineRevision: baseline.baselineRevision, stale: true },
      { id: "old", baselineRevision: baseline.baselineRevision },
      { id: "current", baselineRevision: baseline.baselineRevision },
    ],
  );
  assert.equal(current.id, "current-run");
  assert.deepEqual(reads, [
    "/v1/inference-runs/old",
    "/v1/inference-runs/current",
  ]);
});

test("missing, below-level and non-asset assignments never imply an IDT type proof", async () => {
  for (const idt of [
    undefined,
    { status: "below_idt_level", path: "10.1.2.4", parentEntity: "hospital-y" },
    { status: "not_asset" },
  ]) {
    const data = structuredClone(baseline);
    data.entities.find((e) => e.id === entity.id).idt = idt;
    const profile = await harness("AnalystEntityProfile.tsx", endpoints(run()));
    const reasoning = await harness("ReasoningView.tsx", endpoints(run()));
    try {
      const profileTree = await profile.render({
        ...profileProps,
        data,
        onOpenTool() {},
      });
      assert.match(text(profileTree), /no IDT type proof is implied/);
      assert.equal(button(profileTree, "See the proof"), undefined);
      assert.ok(!profile.requests.some((r) => r.path === "/v1/inference-runs"));
      const reasoningTree = await reasoning.render({
        data,
        selectedEntityId: entity.id,
      });
      assert.match(text(reasoningTree), /no IDT type proof is implied/);
      assert.ok(!reasoning.requests.some((r) => r.path.includes("/facts/")));
    } finally {
      profile.close();
      reasoning.close();
    }
  }
});

test("full IDT ancestry is displayed only from the proof API response; failed proof is not synthesized", async () => {
  const current = run();
  const proof = {
    runId: current.id,
    fact: current.inferredFacts.find((f) => f.id === "sector"),
    proofFacts: [
      current.assertedFacts[0],
      ...current.inferredFacts.filter((f) =>
        ["parent", "branch"].includes(f.id),
      ),
    ],
    axioms: [],
    sources: [],
    baselineRevision: current.baselineRevision,
  };
  const h = await harness("ReasoningView.tsx", endpoints(current, proof));
  try {
    const tree = await h.render({
      data: baseline,
      selectedEntityId: entity.id,
    });
    const trail = nodes(tree).find(
      (n) => n.props?.className === "reasoning-premises",
    );
    assert.match(text(trail), /IDT_10_1_2_4/);
    assert.match(text(trail), /IDT_10_1_2/);
    assert.match(text(trail), /IDT_10_1/);
    assert.equal(nodes(trail).filter((n) => n.type === "li").length, 3);
    assert.equal(proof.fact.object.id, "IDT_10");
  } finally {
    h.close();
  }
  const failed = await harness("ReasoningView.tsx", async (path, body) => {
    if (path.includes("/facts/"))
      throw new Error("Proof unavailable from saved run");
    return endpoints(current)(path, body);
  });
  try {
    const tree = await failed.render({
      data: baseline,
      selectedEntityId: entity.id,
    });
    assert.match(text(tree), /Proof unavailable from saved run/);
    assert.ok(
      !nodes(tree).some((n) => n.props?.className === "reasoning-premises"),
    );
  } finally {
    failed.close();
  }
});

test("only the explicit Run OWL inference handler creates a run and selects its real proof", async () => {
  let saved = null;
  const h = await harness("ReasoningView.tsx", async (path, body) => {
    if (body !== undefined) {
      assert.equal(path, "/v1/inference-runs");
      assert.deepEqual(body, {
        expectedBaselineRevision: baseline.baselineRevision,
      });
      saved = run();
      return saved;
    }
    return endpoints(saved)(path, body);
  });
  try {
    let tree = await h.render({ data: baseline, selectedEntityId: entity.id });
    assert.equal(h.requests.filter((r) => r.body !== undefined).length, 0);
    assert.match(text(tree), /Run reasoning to see the proof/);
    button(tree, "Run OWL inference").props.onClick();
    tree = await h.render();
    assert.equal(h.requests.filter((r) => r.body !== undefined).length, 1);
    assert.ok(h.requests.some((r) => r.path.endsWith("/facts/sector")));
    assert.ok(
      nodes(tree).some(
        (n) => n.type === "button" && n.props["aria-pressed"] === true,
      ),
    );
  } finally {
    h.close();
  }
});

test("blueprint cannot claim loading from inconsistent or negative metadata counts", async () => {
  const { idtRuntimeResource } = await import("../src/ontologyBlueprint.ts");
  for (const changes of [
    { idtClassCount: 0, loadedIdtClassCount: 24 },
    { loadedIdtClassCount: 1986 },
    { loadedIdtClassCount: -1 },
    { idtClassCount: 1.5 },
  ]) {
    assert.equal(
      idtRuntimeResource({ ...metadata, ...changes }).status,
      "Runtime status unknown",
    );
  }
  assert.equal(
    idtRuntimeResource({
      ...metadata,
      idtClassCount: 0,
      loadedIdtClassCount: 0,
    }).status,
    "Not loaded in runtime",
  );
});

test("generic chip is reference-only, not a false assertion that IDT is unloaded; App passes entity focus", () => {
  assert.doesNotMatch(
    read("../src/IdtChip.tsx"),
    /IDT is not loaded in runtime/,
  );
  assert.match(read("../src/IdtChip.tsx"), /not.*proof|not.*evidence/i);
  assert.match(
    read("../src/App.tsx"),
    /<ReasoningView[\s\S]*?selectedEntityId=\{selectedEntity\}/,
  );
});

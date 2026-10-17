import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import {
  consequenceModel,
  capturedClassification,
  overviewModel,
} from "../src/commandCenterModel.ts";
import {
  createIdtIndex,
  assignmentFor,
  lineage,
  idtSectorName,
} from "../src/idt.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const reference = JSON.parse(read("../../data/reference/idt/idt_v4.json"));
const index = createIdtIndex(reference);
const baseline = JSON.parse(read("../../data/scenario.json"));
const cache = new Map();
// Real TSX/React SSR, artifact-free. This does not claim browser or API coverage.
async function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  for (const spec of new Set(
    [...code.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(
      (m) => m[1],
    ),
  )) {
    let target;
    if (spec.startsWith(".")) {
      let dependency = new URL(spec, url);
      if (!existsSync(dependency))
        dependency = [".tsx", ".ts"]
          .map((ext) => new URL(spec + ext, url))
          .find(existsSync);
      assert.ok(dependency, `Missing ${spec}`);
      target = await moduleUrl(dependency);
    } else target = import.meta.resolve(spec);
    code = code.replaceAll(JSON.stringify(spec), JSON.stringify(target));
  }
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, result);
  return result;
}
const { default: CommandCenterViews } = await import(
  await moduleUrl(new URL("../src/CommandCenterViews.tsx", import.meta.url))
);
const casework = await import(
  await moduleUrl(new URL("../src/CommandCasework.tsx", import.meta.url))
);
const noAction = () => {
  throw new Error("SSR invoked an action");
};
function fixture() {
  const captured = structuredClone(baseline);
  const run = {
    id: "part1-run",
    modelVersion: baseline.modelVersion,
    baselineRevision: baseline.baselineRevision,
    createdAt: "2026-10-14T12:01:00Z",
    scenarioId: "unsafe-water-a",
    request: {
      scenarioId: "unsafe-water-a",
      evaluationHour: 0,
      horizonHours: 12,
      overrides: [],
    },
    seed: {
      provider: "utility-a",
      service: "treated_water",
      lossType: "unsafe_treated_water",
      windowHours: [0, 0],
      persistsThroughHour: 12,
      eventRefs: [],
      sourceRefs: [],
    },
    baselineSnapshot: captured,
    impacts: ["dialysis-x", "hospital-y", "nursing-z"].map((id, i) => ({
      id: `impact-${i}`,
      entityId: id,
      functionId: "captured-function",
      state: "at_risk",
      lossType: "unsafe_treated_water",
      windowHours: [2, 4],
      lossOfFunction: 1,
      paths: [],
      sourceRefs: [],
      assumptions: [],
      evidenceStatus: "modeled",
      timingStatus: "interval",
    })),
    warnings: [],
    excluded: [],
  };
  return {
    id: "part1-case",
    version: 1,
    title: "Captured Part1 case",
    status: "open",
    priority: "high",
    createdAt: run.createdAt,
    updatedAt: run.createdAt,
    eventId: baseline.events[0].id,
    eventSnapshot: structuredClone(baseline.events[0]),
    baselineRevision: baseline.baselineRevision,
    contextSnapshot: {
      baselineRevision: baseline.baselineRevision,
      cyberAsset: null,
      physicalAsset: null,
      facility: null,
      provider: null,
      serviceArea: null,
      downstreamDependencies: [],
      scenarios: [],
      sourceRefs: [],
      warnings: [],
    },
    tasks: [],
    decisions: [],
    notes: [],
    activity: [],
    runId: run.id,
    runSnapshot: run,
  };
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
function render(view, record) {
  // Deliberately hostile current data: historic display must use only the capture.
  const current = structuredClone(baseline);
  current.entities.forEach((e) => {
    e.label = "TODAY ONLY";
    e.idt = { status: "coded", path: "1.1" };
  });
  return renderToStaticMarkup(
    createElement(CommandCenterViews, {
      data: current,
      incidents: [record],
      selected: record,
      view,
      onSelect: noAction,
      onOpenAnalyst: noAction,
      onNavigate: noAction,
    }),
  );
}

test("all map/profile/readout IDT callsites are record-only, with no opt-in seed lookup", () => {
  for (const file of [
    "TexasInfrastructureMap.tsx",
    "AnalystEntityProfile.tsx",
    "CommandReadouts.tsx",
    "CommandCasework.tsx",
  ]) {
    assert.doesNotMatch(
      read(`../src/${file}`),
      /allowSeedLookup\s*(?:[\s/>]|=)/,
      file,
    );
  }
});

test("sector display labels match pinned canonical reference names without assigning entities", () => {
  for (const entry of reference.entries.filter((entry) => entry.level === 1)) {
    assert.equal(idtSectorName(entry.path), entry.name.trim());
  }
  for (const path of ["", "0", "19", "10.1", "__proto__"])
    assert.equal(idtSectorName(path), null);
});

test("fresh inline classification supplies exact healthcare lineage without advisory assignment repair", () => {
  const record = freeze(fixture());
  const entity = record.runSnapshot.baselineSnapshot.entities.find(
    (e) => e.id === "dialysis-x",
  );
  assert.deepEqual(entity.idt, reference.assignments[entity.id]);
  assert.equal(assignmentFor(entity, index).path, "10.1.2.4");
  assert.deepEqual(
    lineage(entity.idt.path, index).map((e) => e.path),
    ["10.1.2.4", "10.1.2", "10.1", "10"],
  );
  const model = consequenceModel(record);
  assert.equal(model.groups.length, 1);
  assert.match(model.groups[0].label, /Healthcare and Public Health/);
  assert.equal(model.groups[0].count, 3);
  assert.equal(overviewModel([record]).unclassifiedImpacts, 0);
  const html = render("command", record);
  assert.match(html, /Healthcare and Public Health/);
  assert.doesNotMatch(html, /lack (?:captured )?IDT|IDT lineage not captured/);
  assert.equal(
    capturedClassification(
      record.runSnapshot.baselineSnapshot.entities.find(
        (e) => e.id === "org-electric-e",
      ),
    ).classified,
    false,
  );
});

test("saved inventory has four correctly named physical-facility sectors, separate from modeled-only groups", () => {
  const record = fixture();
  const before = structuredClone(record);
  const model = consequenceModel(freeze(record));
  assert.ok(
    Array.isArray(model.inventorySectors),
    "separate inventorySectors contract",
  );
  const expected = new Map([
    ["12", "Water"],
    ["10", "Healthcare and Public Health"],
    ["6", "Emergency Services"],
    ["5", "Energy"],
  ]);
  assert.equal(model.inventorySectors.length, 4);
  for (const sector of model.inventorySectors) {
    assert.equal(
      sector.label,
      `${expected.get(sector.sector)} (${sector.sector})`,
    );
    assert.equal(sector.provenance, "captured_inventory");
    assert.ok(sector.nodes.length > 0);
    for (const node of sector.nodes) {
      assert.equal(node.classification.key, `idt:${sector.sector}`);
      assert.equal(
        node.modeled,
        record.runSnapshot.impacts.some((i) => i.entityId === node.id),
      );
      if (sector.sector !== "10") assert.equal(node.modeled, false);
      assert.doesNotMatch(
        node.type,
        /Organization|CyberAsset|PhysicalOTAsset|PhysicalITAsset|WaterServiceProvider|ServiceArea|PopulationGroup/,
      );
    }
  }
  assert.deepEqual(
    model.groups.map((g) => g.key),
    ["idt:10"],
  );
  assert.deepEqual(
    model.rows.map((r) => r.entityId),
    ["dialysis-x", "hospital-y", "nursing-z"],
  );
  assert.equal(model.facilities, 3);
  assert.deepEqual(record, before);
});

test("C4 explicitly labels saved context and colors only nodes with captured modeled results", () => {
  const html = render("consequence", freeze(fixture()));
  assert.match(html, /Saved inventory sector context/);
  assert.match(html, /Captured context; no modeled impact/);
  for (const label of [
    "Water (12)",
    "Healthcare and Public Health (10)",
    "Emergency Services (6)",
    "Energy (5)",
  ])
    assert.ok(html.includes(label), label);
  const nodes = [
    ...html.matchAll(
      /<g\b[^>]*data-captured-facility="([^"]+)"[^>]*>[\s\S]*?<\/g>/g,
    ),
  ];
  assert.equal(nodes.length, 11); // Two approved healthcare storyline facilities are context, not impacts.
  for (const [markup, id] of nodes) {
    const modeled = ["dialysis-x", "hospital-y", "nursing-z"].includes(id);
    assert.ok(markup.includes(`data-modeled-impact="${modeled}"`), id);
    if (!modeled) {
      assert.match(markup, /fill:#1e4368/);
      assert.doesNotMatch(markup, /#683c23|#ffb66f/);
      assert.match(markup, /Captured context; no modeled impact/);
    }
  }
});

test("legacy captures and missing endpoints stay unclassified, even for known seed IDs", () => {
  const legacy = fixture();
  legacy.runSnapshot.baselineSnapshot.entities.forEach((e) => {
    delete e.idt;
  });
  const model = consequenceModel(freeze(legacy));
  assert.equal(
    model.rows.every((row) => !row.classification.classified),
    true,
  );
  assert.deepEqual(model.inventorySectors, []);
  assert.equal(overviewModel([legacy]).unclassifiedImpacts, 3);
  assert.match(render("command", legacy), /lack (?:captured )?IDT/);
  assert.match(render("consequence", legacy), /IDT lineage not captured/);
  const missing = fixture();
  missing.runSnapshot.baselineSnapshot.entities = [];
  assert.deepEqual(consequenceModel(missing).inventorySectors, []);
  assert.deepEqual(consequenceModel(null).inventorySectors, []);
});

test("C4 leads with the linked sector dependency graph; the inventory chart is collapsed context", () => {
  const html = render("consequence", fixture());
  assert.ok(html.indexOf("Sector dependencies") > -1);
  assert.ok(html.indexOf("Sector dependencies") < html.indexOf("Saved inventory sector context"));
});

test("Case File impact rows render actual chips from captured entities, never today's inventory", () => {
  assert.equal(
    typeof casework.CapturedImpactRows,
    "function",
    "owned captured impact row component",
  );
  const record = fixture();
  record.runSnapshot.baselineSnapshot.entities.find(
    (e) => e.id === "dialysis-x",
  ).label = "Historical dialysis label";
  const html = renderToStaticMarkup(
    createElement(casework.CapturedImpactRows, {
      run: freeze(record.runSnapshot),
      index,
    }),
  );
  assert.match(html, /Historical dialysis label/);
  assert.match(html, /IDT 10\.1\.2\.4 · Kidney Dialysis Center/);
  assert.match(html, /Workbook ancestry/);
  assert.match(html, /Captured entity assignment/);
  assert.doesNotMatch(html, /Stakeholder design assignment lookup/);
  const legacy = fixture();
  legacy.runSnapshot.baselineSnapshot.entities.forEach((e) => {
    delete e.idt;
  });
  const legacyHtml = renderToStaticMarkup(
    createElement(casework.CapturedImpactRows, {
      run: legacy.runSnapshot,
      index,
    }),
  );
  assert.equal(
    (legacyHtml.match(/IDT code not assigned/g) ?? []).length >= 3,
    true,
  );
  assert.doesNotMatch(legacyHtml, /Kidney Dialysis Center/);
  const source = read("../src/CommandCasework.tsx");
  assert.match(
    source,
    /<CapturedImpactRows\s+run=\{run\}\s+index=\{idtIndex\}/,
  );
  assert.match(source, /\/v1\/reference\/idt/);
  assert.match(source, /<IdtChip\s+entity=/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import {
  IDT_VERSION,
  IDT_SOURCE_SHA256,
  createIdtIndex,
  idtEntry,
  lineage,
  assignmentForId,
  assignmentFor,
  sectorOf,
  idtChip,
  entryName,
} from "../src/idt.ts";

const raw = JSON.parse(
  readFileSync(
    new URL("../../data/reference/idt/idt_v4.json", import.meta.url),
  ),
);
const index = createIdtIndex(raw);
const current = { allowSeedLookup: true };
// Artifact-free TSX transformation: same component, genuine React static render.
const transformed = (
  await transformWithOxc(
    readFileSync(new URL("../src/IdtChip.tsx", import.meta.url), "utf8"),
    "IdtChip.tsx",
    { jsx: { runtime: "automatic" } },
  )
).code
  .replaceAll(
    'from "./idt"',
    `from ${JSON.stringify(new URL("../src/idt.ts", import.meta.url).href)}`,
  )
  .replaceAll(
    'from "react/jsx-runtime"',
    `from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`,
  );
const { IdtChip } = await import(
  `data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`
);

test("pinned version, full count and explicit reference-only semantics", () => {
  assert.equal(index.version, IDT_VERSION);
  assert.equal(index.sourceSha256, IDT_SOURCE_SHA256);
  assert.equal(Object.keys(index.entries).length, 1985);
  assert.equal(index.sectorCount, 18);
  assert.equal(index.runtimeOntologyLoaded, false);
  assert.equal(index.semanticStatus, "reference_only");
  assert.equal(raw.sourceDiagnostics.unnamedEntries, 0);
  assert.equal(raw.sourceDiagnostics.missingDescriptions, 26);
});

test("leaf-to-root lineage is exact workbook lookup", () => {
  assert.deepEqual(
    lineage("10.1.2.4", index).map((e) => e.path),
    ["10.1.2.4", "10.1.2", "10.1", "10"],
  );
  assert.deepEqual(
    lineage("6.2.2", index).map((e) => e.path),
    ["6.2.2", "6.2", "6"],
  );
  assert.deepEqual(
    lineage("5.1.3", index).map((e) => e.path),
    ["5.1.3", "5.1", "5"],
  );
  assert.equal(idtEntry("10.1.2.4", index).name, "Kidney Dialysis Center");
  assert.equal(idtEntry("10.1.2.4", index).idtId, "688");
  assert.equal(idtEntry("unknown", index), null);
  assert.deepEqual(lineage("unknown", index), []);
});

test("source nulls and duplicated IDs survive and fallbacks are display only", () => {
  assert.equal(
    Object.values(index.entries).filter((e) => e.description === null).length,
    26,
  );
  assert.deepEqual(
    Object.values(index.entries)
      .filter((e) => e.idtId === "4725")
      .map((e) => e.path),
    ["1.1.2.6.3", "1.2.12.2.1"],
  );
  const unnamed = { ...idtEntry("10", index), name: null };
  assert.equal(entryName(unnamed), "Unnamed IDT v4 entry 10");
  assert.equal(unnamed.name, null);
});

test("all exact existing58 and proposed9 IDs, no inferred wildcard IDs", () => {
  const seed = JSON.parse(
    readFileSync(new URL("../../data/scenario.json", import.meta.url)),
  );
  assert.equal(seed.entities.length, 58);
  assert.equal(Object.keys(index.assignments).length, 67);
  assert.equal(raw.proposedEntityIds.length, 9);
  assert.deepEqual(
    new Set(Object.keys(index.assignments)),
    new Set([...seed.entities.map((e) => e.id), ...raw.proposedEntityIds]),
  );
  for (const id of [
    "dialysis-a",
    "utility-water-a",
    "cyber-unverified-host",
    "constructor",
    "__proto__",
  ])
    assert.equal(assignmentForId(id, index), null);
  assert.equal(assignmentForId("org-electric-e", index).status, "unassigned");
  assert.equal(assignmentForId("vendor-v", index).status, "unassigned");
});

test("coded, below level, nonasset and unknown chips remain distinct", () => {
  assert.equal(
    idtChip({ id: "dialysis-x" }, index, current),
    "IDT 10.1.2.4 · Kidney Dialysis Center",
  );
  assert.equal(
    idtChip({ id: "plc-a" }, index, current),
    "Part of IDT 12.4 · Water Treatment Facility",
  );
  assert.equal(
    idtChip({ id: "cyber-plc-a" }, index, current),
    "Not an IDT asset · cyber identity",
  );
  assert.equal(
    idtChip({ id: "org-electric-e" }, index, current),
    "IDT code not assigned",
  );
  assert.equal(
    idtChip({ id: "unknown" }, index, current),
    "IDT code not assigned",
  );
  assert.equal(sectorOf({ id: "dialysis-x" }, index, current).path, "10");
  assert.equal(sectorOf({ id: "workstation-a" }, index, current).path, "12");
  assert.equal(sectorOf({ id: "cyber-plc-a" }, index, current), null);
  assert.equal(sectorOf({ id: "area-a" }, index, current), null);
});

test("history is unassigned by default; opt-in lookup never mutates snapshots", () => {
  const entity = Object.freeze({ id: "dialysis-x", label: "historical label" });
  assert.equal(assignmentFor(entity, index), null);
  assert.equal(sectorOf(entity, index), null);
  assert.equal(idtChip(entity, index), "IDT code not assigned");
  assert.equal(assignmentFor(entity, index, current).path, "10.1.2.4");
  assert.deepEqual(entity, { id: "dialysis-x", label: "historical label" });
  assert.equal(
    assignmentFor(
      { id: "dialysis-x", idt: { status: "coded", path: "12.4" } },
      index,
      current,
    ).path,
    "12.4",
  );
});

test("malformed explicit assignments cannot acquire fallback codes", () => {
  for (const idt of [
    null,
    {},
    "12.4",
    { status: "coded", path: "999" },
    { status: "coded", path: 12.4 },
    { status: "below_idt_level", parentPath: "12.4" },
    { status: "not_idt_asset", reason: "unknown" },
  ])
    assert.equal(
      assignmentFor({ id: "dialysis-x", idt }, index, current),
      null,
    );
  assert.equal(assignmentFor({ id: "dialysis-x" }, null, current), null);
});

test("index is detached and frozen, including assignments and source entries", () => {
  const copy = structuredClone(raw);
  const checked = createIdtIndex(copy);
  copy.entries.find((e) => e.path === "10").name = "changed";
  copy.assignments["dialysis-x"].path = "0";
  assert.equal(checked.entries["10"].name, "Healthcare and Public Health");
  assert.equal(checked.assignments["dialysis-x"].path, "10.1.2.4");
  assert.throws(() => {
    checked.entries["10"].name = "changed";
  }, TypeError);
  assert.throws(() => {
    checked.assignments["dialysis-x"].path = "0";
  }, TypeError);
});

test("malformed count, hash, version, parents and codes fail closed", () => {
  for (const mutate of [
    (r) => (r.version = "IDT v5"),
    (r) => (r.sourceSha256 = "0".repeat(64)),
    (r) => (r.runtimeOntologyLoaded = true),
    (r) => r.entries.pop(),
    (r) => (r.entries[0].parent = "10"),
    (r) => (r.entries[0].path = "0"),
    (r) => (r.entries[1].path = r.entries[0].path),
    (r) => (r.assignments["dialysis-x"].path = "0"),
    (r) => (r.entries[0].description = 42),
  ]) {
    const copy = structuredClone(raw);
    mutate(copy);
    assert.throws(() => createIdtIndex(copy));
  }
});

test("chip exposes tap/keyboard details and truthful reference lineage", () => {
  const html = renderToStaticMarkup(
    createElement(IdtChip, {
      entity: { id: "dialysis-x" },
      index,
      allowSeedLookup: true,
    }),
  );
  assert.ok(html.includes("<details"));
  assert.ok(html.includes("<summary"));
  assert.ok(html.includes("IDT 10.1.2.4"));
  assert.ok(html.includes("10.1.2 · Ambulatory Healthcare Facility"));
  assert.ok(html.includes("not persisted on this entity"));
  assert.ok(html.includes("not loaded in runtime OWL reasoning"));
  assert.ok(html.includes(IDT_VERSION));
});

test("chip preserves unknown history, below-level association and not-asset status", () => {
  const history = renderToStaticMarkup(
    createElement(IdtChip, { entity: { id: "dialysis-x" }, index }),
  );
  assert.ok(history.includes("IDT code not assigned"));
  assert.ok(!history.includes("IDT 10.1.2.4"));
  const below = renderToStaticMarkup(
    createElement(IdtChip, {
      entity: { id: "workstation-a" },
      index,
      allowSeedLookup: true,
    }),
  );
  assert.ok(below.includes("Part of IDT 12.10.2"));
  assert.ok(below.includes("physical-containment proof"));
  const unloaded = renderToStaticMarkup(
    createElement(IdtChip, { entity: { id: "dialysis-x" }, index: null }),
  );
  assert.ok(unloaded.includes("IDT reference not loaded"));
});

test("React escapes source description text rather than interpreting HTML", () => {
  const copy = structuredClone(raw);
  copy.entries.find((e) => e.path === "10.1.2.4").description =
    "<script>alert('x')</script>";
  const html = renderToStaticMarkup(
    createElement(IdtChip, {
      entity: { idt: { status: "coded", path: "10.1.2.4" } },
      index: createIdtIndex(copy),
    }),
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

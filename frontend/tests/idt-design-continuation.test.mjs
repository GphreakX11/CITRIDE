import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIdtIndex, lineage } from "../src/idt.ts";
import { idtRuntimeResource } from "../src/ontologyBlueprint.ts";
const ref = JSON.parse(
  readFileSync(
    new URL("../../data/reference/idt/idt_v4.json", import.meta.url),
    "utf8",
  ),
);
const index = createIdtIndex(ref);
test("all four supplied IDT lineage examples retain source paths and names", () => {
  for (const [path, expected] of [
    [
      "10.1.2.4",
      [
        ["10.1.2.4", "Kidney Dialysis Center"],
        ["10.1.2", "Ambulatory Healthcare Facility"],
        ["10.1", "Direct Patient Healthcare"],
        ["10", "Healthcare and Public Health"],
      ],
    ],
    [
      "12.7",
      [
        ["12.7", "Treated Water Monitoring System"],
        ["12", "Water"],
      ],
    ],
    [
      "6.2.2",
      [
        ["6.2.2", "Fire & Emergency Services Operational Facility"],
        ["6.2", "Fire and Emergency Services"],
        ["6", "Emergency Services"],
      ],
    ],
    [
      "5.1.3",
      [
        ["5.1.3", "Electricity Distribution"],
        ["5.1", "Electricity"],
        ["5", "Energy"],
      ],
    ],
  ])
    assert.deepEqual(
      lineage(path, index).map((e) => [e.path, e.name]),
      expected,
    );
});
test("IDT blueprint resource shows current service hash with explicit combined-source scope", () => {
  const hash = "a".repeat(64),
    metadata = {
      idtClassCount: 1985,
      loadedIdtClassCount: 1985,
      idtLoadMode: "full",
      sha256: hash,
    };
  const resource = idtRuntimeResource(metadata);
  assert.equal(resource.id, "idt-owl");
  assert.equal(resource.status, "Loaded in runtime");
  assert.match(resource.description, /1985/);
  assert.ok(resource.description.includes(hash));
  assert.match(resource.description, /Combined ontology SHA-256/);
  assert.ok(
    idtRuntimeResource({
      ...metadata,
      sha256: "b".repeat(64),
    }).description.includes("b".repeat(64)),
  );
  assert.equal(idtRuntimeResource(null).status, "Runtime status unknown");
  assert.ok(
    !idtRuntimeResource({
      ...metadata,
      sha256: "not-reported",
    }).description.includes("SHA-256: not-reported"),
  );
});

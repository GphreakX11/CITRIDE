import assert from "node:assert/strict";
import test from "node:test";
import {
  bridges,
  designReferences,
  domainColumns,
  exchangeFormats,
  foundations,
  graphRoles,
  policyBoundary,
  runtimeProfile,
  sourceCaveat,
  sourceDocuments,
  targetStandards,
  tooling,
} from "../src/ontologyBlueprint.ts";

const column = (id) => domainColumns.find((item) => item.id === id);
const resource = (id) => targetStandards.find((item) => item.id === id);

test("the foundations distinguish persistent entities from unfolding processes", () => {
  assert.deepEqual(
    foundations.map((item) => item.layer),
    ["Layer 0", "Layer 1"],
  );
  assert.equal(foundations[0].resource.name, "BFO 2020");
  assert.deepEqual(
    foundations[0].concepts.map((item) => item.name),
    ["Continuants", "Occurrents"],
  );
  assert.match(foundations[0].concepts[0].description, /facilities and assets/);
  assert.match(
    foundations[0].concepts[1].description,
    /Events, cascades and decisions/,
  );
  assert.deepEqual(
    foundations[1].concepts.map((item) => item.name),
    [
      "Agent & organization",
      "Artifact & facility",
      "Event & process",
      "Information entity",
      "Geospatial region",
      "Time",
      "Quality & disposition",
    ],
  );
});

test("the landscape matrix has four domains and explicit target ownership", () => {
  assert.deepEqual(
    domainColumns.map((item) => item.id),
    ["infrastructure", "cyber", "consequence", "decision"],
  );
  for (const id of ["infrastructure", "cyber"]) {
    assert.equal(column(id).ownership, "Imported / mapped target");
    assert.deepEqual(column(id).classes, []);
  }
  for (const id of ["consequence", "decision"]) {
    assert.equal(column(id).ownership, "Program-authored target");
    assert.ok(column(id).classes.length > 0);
  }
});

test("infrastructure standards retain source versions and mapping scope", () => {
  assert.deepEqual(
    column("infrastructure").resources.map((item) => item.id),
    [
      "idt-owl",
      "saref4watr",
      "uf-okn",
      "cisa-water-ot",
      "national-critical-functions",
      "geosparql",
    ],
  );
  assert.equal(resource("idt-owl").name, "IDT-OWL v0.1");
  assert.match(resource("idt-owl").description, /IDT v4/);
  assert.equal(resource("saref4watr").name, "SAREF4WATR 2.1.1");
  assert.equal(resource("uf-okn").name, "UF-OKN 2.1");
  assert.equal(resource("cisa-water-ot").role, "taxonomy");
  assert.match(
    resource("national-critical-functions").description,
    /55-function roll-up/,
  );
  assert.match(
    column("infrastructure").boundary,
    /not evidence of a service dependency/,
  );
});

test("cyber standards keep Grid-STIX energy and license restrictions and SEPSES optional", () => {
  assert.deepEqual(
    column("cyber").resources.map((item) => item.id),
    ["c3o", "oasis-tac", "attack-ics", "d3fend", "grid-stix", "sepses"],
  );
  assert.equal(resource("c3o").name, "C3O · CUBRC");
  assert.equal(resource("attack-ics").name, "ATT&CK for ICS");
  assert.match(resource("grid-stix").scope, /Energy only/);
  assert.match(resource("grid-stix").scope, /license review required/);
  assert.equal(resource("sepses").status, "Optional integration");
});

test("external semantic targets are planned or optional, never installed claims", () => {
  for (const item of targetStandards) {
    assert.ok(
      ["Planned integration", "Optional integration"].includes(item.status),
      item.id,
    );
    assert.ok(
      ["ontology", "taxonomy", "semantic mapping"].includes(item.role),
      item.id,
    );
  }
  for (const id of ["bfo-2020", "cco", "idt-owl", "c3o", "prov-o"]) {
    assert.equal(resource(id).status, "Planned integration");
  }
});

test("consequence classes are authored and models are design references only", () => {
  assert.deepEqual(column("consequence").classes, [
    "Cascade Process",
    "Sector Impact",
    "Time-to-Impact Window",
  ]);
  assert.match(column("consequence").boundary, /assumption-dependent interval/);
  assert.match(column("consequence").boundary, /not a clock/);
  assert.deepEqual(
    designReferences.map((item) => item.name),
    ["CISIApro 2.0", "CIPCast 5.0", "DIESIS"],
  );
  for (const item of designReferences) {
    assert.equal(item.role, "design reference");
    assert.equal(item.status, "Design reference");
    assert.match(item.description, /not an installed module/);
    assert.ok(!targetStandards.some((target) => target.id === item.id));
  }
});

test("decision vocabulary has intended provenance but no invented policy passes", () => {
  assert.deepEqual(column("decision").classes, [
    "Incident",
    "DecisionCard",
    "AuthorityBasis",
    "Option",
    "DecisionRecord",
    "AITrace",
  ]);
  assert.equal(resource("prov-o").name, "PROV-O via CASE / UCO");
  assert.match(resource("prov-o").description, /not implemented/);
  assert.equal(policyBoundary.analysisDefinitions, "AN01–04");
  assert.equal(policyBoundary.gateDefinitions, "G1–G5");
  assert.equal(policyBoundary.definitionsProvided, false);
  assert.equal(policyBoundary.gatePassesClaimed, false);
  assert.match(policyBoundary.decisionMode, /human review required/);
});

test("bridges form the physical → cyber → consequence → decision path with boundaries", () => {
  assert.deepEqual(
    bridges.map((item) => [item.from, item.to, item.mode]),
    [
      ["infrastructure", "cyber", "structural"],
      ["cyber", "consequence", "conditional"],
      ["consequence", "decision", "advisory"],
    ],
  );
  for (const item of bridges) {
    assert.ok(column(item.from));
    assert.ok(column(item.to));
  }
  assert.equal(bridges[0].relation, "Facility hosts cyber asset");
  assert.match(
    bridges[1].condition,
    /explicit dependency, loss and timing assumptions/,
  );
  assert.match(bridges[1].condition, /not automatic causal entailment/);
  assert.match(bridges[2].condition, /human review/);
  assert.match(bridges[2].condition, /does not authorize or execute/);
});

test("exchange formats and storage stay separate from ontology classes", () => {
  assert.deepEqual(
    exchangeFormats.map((item) => item.name),
    [
      "OCSF / UCO",
      "STIX 2.1",
      "RDF / JSON-LD",
      "Delta Lake / S3",
      "REST / JSON",
    ],
  );
  for (const item of exchangeFormats) {
    assert.ok(["exchange", "storage"].includes(item.role));
    assert.equal(item.status, "Planned integration");
    assert.ok(!targetStandards.some((target) => target.id === item.id));
    assert.ok(
      !domainColumns.some((domain) => domain.classes.includes(item.name)),
    );
  }
  assert.match(
    exchangeFormats.find((item) => item.id === "rest-json").description,
    /already exposes/,
  );
  assert.match(
    exchangeFormats.find((item) => item.id === "rdf-jsonld").description,
    /already used locally/,
  );
});

test("five graph roles are explicitly targets, not proof of connected Neptune", () => {
  assert.deepEqual(
    graphRoles.map((item) => item.id),
    ["ontology", "reference", "customer-instance", "staging", "scenario-runs"],
  );
  assert.equal(new Set(graphRoles.map((item) => item.id)).size, 5);
  assert.ok(graphRoles.every((item) => item.status === "Target graph role"));
  assert.equal(runtimeProfile.targetStore.name, "Amazon Neptune");
  assert.equal(runtimeProfile.targetStore.status, "Planned integration");
  assert.equal(runtimeProfile.targetStore.connected, false);
});

test("the current profile is local OWL 2 RL with no imported-alignment claim", () => {
  assert.equal(runtimeProfile.ownership, "Locally authored");
  assert.equal(runtimeProfile.namespace, "urn:citride:");
  assert.equal(runtimeProfile.ontology, "Watershed");
  assert.equal(runtimeProfile.profile, "OWL 2 RL");
  assert.equal(runtimeProfile.engine, "owlrl");
  assert.deepEqual(runtimeProfile.importedOntologies, []);
  assert.equal(runtimeProfile.importedAlignmentClaimed, false);
  assert.ok(
    runtimeProfile.evidence.some((item) =>
      /pySHACL proposal checks/.test(item),
    ),
  );
  assert.ok(
    runtimeProfile.evidence.some((item) =>
      /separate from OWL entailment/.test(item),
    ),
  );
  assert.ok(
    runtimeProfile.evidence.some((item) =>
      /Immutable scenario snapshots/.test(item),
    ),
  );
  assert.ok(runtimeProfile.evidence.some((item) => /Postgres/.test(item)));
});

test("tooling is a target build path and optional AI extraction remains advisory after beta", () => {
  assert.deepEqual(
    tooling.map((item) => item.id),
    [
      "protege",
      "robot-odk",
      "elk",
      "pyshacl",
      "linkml",
      "ontologx",
      "ontogpt-spires",
    ],
  );
  assert.ok(tooling.every((item) => item.role === "tool"));
  assert.ok(
    tooling.every((item) =>
      ["Planned integration", "Optional integration"].includes(item.status),
    ),
  );
  assert.match(
    tooling.find((item) => item.id === "pyshacl").description,
    /already performs pySHACL proposal checks/,
  );
  assert.equal(
    tooling.find((item) => item.id === "ontologx").status,
    "Optional integration",
  );
  const extraction = tooling.find((item) => item.id === "ontogpt-spires");
  assert.equal(extraction.status, "Optional integration");
  assert.match(extraction.scope, /After beta · advisory only/);
  assert.match(extraction.description, /validation and human review/);
});

test("source coverage records the full landscape matrix without treating the clipped portrait as complete", () => {
  assert.equal(
    sourceDocuments.find((item) => item.id === "docx").filename,
    "CITRIDE Ontology Standards and Open-Source Resources.docx",
  );
  assert.equal(
    sourceDocuments.find((item) => item.id === "portrait-pdf").filename,
    "CITRIDE_Ontology_Layer.pdf",
  );
  const pdf = sourceDocuments.find((item) => item.id === "landscape-pdf");
  assert.equal(pdf.filename, "CITRIDE_Ontology_Layer2.pdf");
  assert.match(pdf.coverage, /Full landscape matrix/);
  assert.match(pdf.coverage, /all four domain columns/);
  assert.match(sourceCaveat, /portrait diagram is clipped/);
  assert.match(sourceCaveat, /not treated as a complete domain matrix/);
  assert.match(sourceCaveat, /not installed integrations/);
});

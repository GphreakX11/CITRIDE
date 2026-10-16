"""Sourced IDT projection and independently replayed OWL lineage regressions."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import pytest
from owlrl import DeductiveClosure, OWLRL_Semantics
from rdflib import Graph, Literal, OWL, RDF, RDFS, URIRef

from citride import reasoning

NS = "urn:citride:"


def baseline():
    return {
        "baselineRevision": 1,
        "entities": [
            {"id": "dialysis", "type": "DialysisCenter", "sourceRefs": ["inventory"],
             "idt": {"status": "coded", "path": "10.1.2.4"}},
            {"id": "fire", "type": "FireService", "sourceRefs": ["inventory"],
             "idt": {"status": "coded", "path": "6.2.2"}},
            {"id": "below", "type": "PhysicalOTAsset", "sourceRefs": ["inventory"],
             "idt": {"status": "below_idt_level", "parentPath": "10.1.2.4", "parentEntity": "dialysis"}},
            {"id": "not-asset", "type": "CyberAsset", "sourceRefs": ["inventory"],
             "idt": {"status": "not_idt_asset", "reason": "cyber_identity", "path": "10.1.2.4"}},
            {"id": "unassigned", "type": "Organization", "sourceRefs": ["inventory"],
             "idt": {"status": "unassigned", "path": "10.1.2.4"}},
        ],
        "serviceFunctions": [{"id": "function", "sourceRefs": ["inventory"],
                              "idt": {"status": "coded", "path": "10.1.2.4"}}],
        "sources": [{"id": "inventory"}, {"id": "src-idt-v4"}],
    }


@pytest.fixture(scope="module")
def runs():
    # One full computation only; all full/closure comparisons reuse it.
    return {mode: reasoning.compute_inference(baseline(), "idt-" + mode, idt_load_mode=mode)
            for mode in ("full", "assigned_closure")}


def all_facts(run):
    return run["assertedFacts"] + run["inferredFacts"]


def triple(fact):
    return tuple(URIRef(fact[key]["iri"]) for key in ("subject", "predicate", "object"))


def idt_facts(run, entity):
    return {fact["object"]["id"]: fact for fact in all_facts(run)
            if fact["subject"]["id"] == entity and fact["object"]["id"].startswith("IDT_")}


def test_local_generated_artifact_and_combined_document():
    assert reasoning.IDT_ONTOLOGY_PATH.name == "idt_v4_owl.ttl"
    document = reasoning.ontology_document()
    assert reasoning.ONTOLOGY_PATH.read_text() in document
    assert reasoning.IDT_ONTOLOGY_PATH.read_text() in document
    graph = Graph().parse(data=document, format="turtle")
    assert len(set(graph.subjects(RDF.type, OWL.Ontology))) == 1
    classes = {c for c in graph.subjects(RDF.type, OWL.Class) if str(c).startswith(NS + "IDT_")}
    assert len(classes) == 1985
    missing = set(graph.subjects(URIRef(NS + "descriptionStatus"), Literal("absent_in_source")))
    assert len(missing) == 26
    reference = json.loads((Path(__file__).resolve().parents[2] / "data/reference/idt/idt_v4.json").read_text())
    for entry in reference["entries"]:
        term = URIRef(NS + "IDT_" + entry["path"].replace(".", "_"))
        assert term in classes
        name = entry["name"] or f"Unnamed IDT v4 entry {entry['path']}"
        assert str(graph.value(term, RDFS.label)) == f"IDT {entry['path']} {name}"
        if entry["description"] is None:
            assert term in missing
        else:
            assert term not in missing
            assert str(graph.value(term, RDFS.comment)) == entry["description"]
        if entry["parent"]:
            parent = URIRef(NS + "IDT_" + entry["parent"].replace(".", "_"))
            assert (term, RDFS.subClassOf, parent) in graph
    for term in missing:
        assert term in classes
        assert str(graph.value(term, RDFS.comment)).strip()
    metadata = reasoning.ontology_metadata()
    assert metadata["sha256"] == sha256(document.encode()).hexdigest()
    assert metadata["idtClassCount"] == 1985
    assert any(a["id"] == NS + "axiom-idt-10_1_2_4-parent" for a in metadata["axioms"])


def test_coded_projection_and_negative_statuses(runs):
    for run in runs.values():
        dialysis = idt_facts(run, "dialysis")
        assert set(dialysis) == {"IDT_10_1_2_4", "IDT_10_1_2", "IDT_10_1", "IDT_10"}
        assert dialysis["IDT_10_1_2_4"]["status"] == "asserted"
        assert all(f["status"] == "inferred" for key, f in dialysis.items() if key != "IDT_10_1_2_4")
        assert set(idt_facts(run, "fire")) == {"IDT_6_2_2", "IDT_6_2", "IDT_6"}
        for entity in ("below", "not-asset", "unassigned", "function"):
            assert idt_facts(run, entity) == {}
        for entity in ("dialysis", "fire"):
            assert all(f["sourceRefs"] == ["inventory", "src-idt-v4"] for f in idt_facts(run, entity).values())


def test_modes_publish_identical_facts_and_lineage(runs):
    full, reduced = runs["full"], runs["assigned_closure"]
    assert full["assertedFacts"] == reduced["assertedFacts"]
    assert full["inferredFacts"] == reduced["inferredFacts"]
    assert full["ontology"]["sha256"] == reduced["ontology"]["sha256"]
    for mode, run in runs.items():
        assert run["idtLoadMode"] == run["ontology"]["idtLoadMode"] == mode
        assert run["ontology"]["idtClassCount"] == 1985
    assert full["ontology"]["loadedIdtClassCount"] == 1985
    assert 7 < reduced["ontology"]["loadedIdtClassCount"] < 1985
    assert reduced["statistics"]["ontologyTriples"] < full["statistics"]["ontologyTriples"]


def assert_idt_witnesses_replay(run):
    index = {fact["id"]: fact for fact in all_facts(run)}
    axioms = {axiom["id"]: axiom for axiom in run["ontology"]["axioms"]}
    sourced_ontology = Graph().parse(data=reasoning.ontology_document(), format="turtle")
    for entity in ("dialysis", "fire"):
        for conclusion in idt_facts(run, entity).values():
            if conclusion["status"] == "asserted":
                continue
            replay, visited = Graph(), set()

            def visit(fact, stack):
                assert fact["id"] not in stack, "Witness must be acyclic"
                visited.add(fact["id"])
                if fact["status"] == "asserted":
                    assert not fact["premiseFactIds"]
                    replay.add(triple(fact))
                    return
                assert fact["premiseFactIds"] and fact["axiomIds"]
                for axiom_id in fact["axiomIds"]:
                    axiom = axioms[axiom_id]
                    assert axiom["rule"] == "subclass"
                    child, parent = map(URIRef, axiom["terms"])
                    named = URIRef(axiom_id)
                    assert (named, OWL.annotatedSource, child) in sourced_ontology
                    assert (named, OWL.annotatedProperty, RDFS.subClassOf) in sourced_ontology
                    assert (named, OWL.annotatedTarget, parent) in sourced_ontology
                    assert (child, RDFS.subClassOf, parent) in sourced_ontology
                    replay.add((child, RDFS.subClassOf, parent))
                for premise_id in fact["premiseFactIds"]:
                    visit(index[premise_id], stack | {fact["id"]})

            visit(conclusion, set())
            assert triple(conclusion) not in replay
            DeductiveClosure(OWLRL_Semantics).expand(replay)
            assert triple(conclusion) in replay


def test_each_idt_witness_replays_with_actual_owlrl(runs):
    assert_idt_witnesses_replay(runs["assigned_closure"])


def test_idt_edit_changes_metadata_hash_without_reasoning(tmp_path, monkeypatch, runs):
    old = deepcopy(runs["assigned_closure"])
    path = tmp_path / "idt.ttl"
    path.write_text(reasoning.IDT_ONTOLOGY_PATH.read_text() + "\n# revised source capture\n")
    monkeypatch.setattr(reasoning, "IDT_ONTOLOGY_PATH", path)
    monkeypatch.setattr(DeductiveClosure, "expand", lambda *a: pytest.fail("Metadata must not reason"))
    from citride.storage import Repository

    metadata = reasoning.ontology_metadata()
    assert metadata["sha256"] != old["ontology"]["sha256"]
    status = Repository._inference_status(old, old["baselineRevision"], metadata["sha256"])
    assert status["stale"] is True
    assert status["staleReasons"] == {"baselineRevision": False, "ontology": True}
    assert old == runs["assigned_closure"]


@pytest.mark.parametrize("suffix", [
    '<urn:citride:IDT_999> a <http://www.w3.org/2002/07/owl#Class> .',
    '<urn:citride:IDT_10> <urn:citride:descriptionStatus> "invented" .',
    '<urn:citride:IDT_10> <http://www.w3.org/2002/07/owl#imports> <https://example.invalid> .',
    '<urn:citride:IDT_999> <http://www.w3.org/2000/01/rdf-schema#subClassOf> <urn:citride:IDT_10> .',
])
def test_full_validation_precedes_closure_pruning(suffix, tmp_path, monkeypatch):
    path = tmp_path / "bad-idt.ttl"
    path.write_text(reasoning.IDT_ONTOLOGY_PATH.read_text() + "\n" + suffix)
    monkeypatch.setattr(reasoning, "IDT_ONTOLOGY_PATH", path)
    monkeypatch.setattr(DeductiveClosure, "expand", lambda *a: pytest.fail("Invalid ontology must fail before reasoning"))
    with pytest.raises(reasoning.OntologyConfigurationError):
        reasoning.compute_inference(baseline(), "invalid-idt", idt_load_mode="assigned_closure")


@pytest.mark.parametrize("path", ["unknown", "10_1_2_4", "010.1.2.4", "10.1.2.999", None, [], {}])
def test_unknown_or_noncanonical_codes_never_project(path):
    data = baseline()
    data["entities"][0]["idt"]["path"] = path
    run = reasoning.compute_inference(data, "unknown-idt", idt_load_mode="assigned_closure")
    assert not idt_facts(run, "dialysis")


def test_idt_projection_requires_captured_taxonomy_source():
    data = baseline()
    data["sources"] = [{"id": "inventory"}]
    with pytest.raises(reasoning.ReasoningError, match="src-idt-v4"):
        reasoning.compute_inference(data, "missing-source", idt_load_mode="assigned_closure")


@pytest.mark.parametrize("mode", ["", "closure", None, [], True])
def test_invalid_explicit_modes_fail_closed(mode):
    with pytest.raises(reasoning.OntologyConfigurationError, match="mode"):
        reasoning.compute_inference(baseline(), "bad-mode", idt_load_mode=mode)


def test_assigned_closure_exact_branch_selection_and_base_retention():
    graph, _, rules, vocabulary = reasoning._load_ontology(idt_load_mode="full")
    idt_classes = {term for term in vocabulary["classes"] if str(term).startswith(NS + "IDT_")}
    pruned, _, _, retained = reasoning._assigned_closure(
        graph, rules, vocabulary["classes"], idt_classes, baseline())
    assert URIRef(NS + "IDT_6_2_2_3") in retained  # assigned class's direct child
    assert URIRef(NS + "IDT_6_2_2_3_1") not in retained  # not its grandchildren
    assert URIRef(NS + "IDT_10_1_2") in retained  # ancestor
    assert URIRef(NS + "IDT_10_1_1") in retained  # ancestor's direct child
    taxonomy_axioms = {axiom for term in idt_classes for axiom in graph.subjects(OWL.annotatedSource, term)}
    base_triples = {triple for triple in graph if triple[0] not in idt_classes | taxonomy_axioms}
    assert base_triples <= set(pruned)


def test_persisted_document_and_staleness_use_full_idt_capture(tmp_path, monkeypatch):
    from citride.storage import Repository

    scenario = Path(__file__).resolve().parents[2] / "data/scenario.json"
    repository = Repository(tmp_path / "state", scenario)
    captured = reasoning.ontology_document()

    def compute(data, identifier):
        run = reasoning.compute_inference(data, identifier, idt_load_mode="assigned_closure")
        run["_ontologyTurtle"] = reasoning.ontology_document()
        return run

    saved = repository.create_inference_run(1, compute)
    assert not saved["stale"]
    assert saved["ontology"]["sha256"] == sha256(captured.encode()).hexdigest()
    dataset = repository._load()
    documents = [str(value) for graph in dataset.graphs()
                 for value in graph.objects(None, URIRef(NS + "ontologyDocument"))]
    assert documents == [captured]
    assert reasoning.IDT_ONTOLOGY_PATH.read_text() in documents[0]
    path = tmp_path / "changed-idt.ttl"
    path.write_text(reasoning.IDT_ONTOLOGY_PATH.read_text() + "\n# changed unused source branch\n")
    monkeypatch.setattr(reasoning, "IDT_ONTOLOGY_PATH", path)
    current_hash = reasoning.ontology_metadata()["sha256"]
    reloaded = Repository(tmp_path / "state", scenario).inference_run(saved["id"], current_hash)
    assert reloaded["stale"]
    assert reloaded["staleReasons"] == {"baselineRevision": False, "ontology": True}
    assert reloaded["ontology"] == saved["ontology"]
    assert reloaded["inferredFacts"] == saved["inferredFacts"]


def test_modes_and_sourced_lineage_with_tiny_local_fixture(monkeypatch):
    # Synthetic unit fixture, deliberately separate from the real-artifact gate.
    terms = [("10", None), ("10_1", "10"), ("10_1_2", "10_1"),
             ("10_1_2_4", "10_1_2"), ("6", None), ("6_2", "6"),
             ("6_2_2", "6_2"), ("6_2_2_3", "6_2_2"), ("99", None)]
    statements = []
    for suffix, parent in terms:
        child = "<" + NS + "IDT_" + suffix + ">"
        statements.append(f'{child} a owl:Class ; rdfs:label "Fixture {suffix}" ; rdfs:comment "Synthetic test class" .')
        if parent:
            target = "<" + NS + "IDT_" + parent + ">"
            statements.extend([
                f"{child} rdfs:subClassOf {target} .",
                f'<{NS}axiom-idt-{suffix}-parent> a owl:Axiom ; rdfs:label "Fixture axiom" ; '
                f'rdfs:comment "Synthetic test parent" ; owl:annotatedSource {child} ; '
                f'owl:annotatedProperty rdfs:subClassOf ; owl:annotatedTarget {target} .',
            ])
    document = reasoning.ONTOLOGY_PATH.read_text() + "\n" + "\n".join(statements)
    monkeypatch.setattr(reasoning, "ontology_document", lambda: document)
    monkeypatch.setenv("CITRIDE_IDT_LOAD_MODE", "assigned_closure")
    full = reasoning.compute_inference(baseline(), "fixture-full", idt_load_mode="full")
    reduced = reasoning.compute_inference(baseline(), "fixture-reduced")
    assert full["idtLoadMode"] == "full"
    assert reduced["idtLoadMode"] == "assigned_closure"
    assert full["assertedFacts"] == reduced["assertedFacts"]
    assert full["inferredFacts"] == reduced["inferredFacts"]
    assert full["ontology"]["sha256"] == sha256(document.encode()).hexdigest()
    assert full["ontology"]["loadedIdtClassCount"] == 9
    assert reduced["ontology"]["loadedIdtClassCount"] == 8
    assert set(idt_facts(reduced, "dialysis")) == {"IDT_10_1_2_4", "IDT_10_1_2", "IDT_10_1", "IDT_10"}
    assert set(idt_facts(reduced, "fire")) == {"IDT_6_2_2", "IDT_6_2", "IDT_6"}
    for entity in ("below", "not-asset", "unassigned", "function"):
        assert not idt_facts(reduced, entity)
    assert all(f["sourceRefs"] == ["inventory", "src-idt-v4"]
               for f in idt_facts(reduced, "dialysis").values())
    assert_idt_witnesses_replay(reduced)


def test_operator_environment_and_explicit_override(monkeypatch):
    # Stop before expensive closure; record mode selection on the actual path.
    modes = []
    original = reasoning._load_ontology

    def load(*args, **kwargs):
        result = original(*args, **kwargs)
        modes.append(result[1]["idtLoadMode"])
        raise RuntimeError("mode observed")

    monkeypatch.setattr(reasoning, "_load_ontology", load)
    monkeypatch.setenv("CITRIDE_IDT_LOAD_MODE", "assigned_closure")
    for kwargs in ({}, {"idt_load_mode": "full"}, {"idt_load_mode": "assigned_closure"}):
        with pytest.raises(RuntimeError, match="mode observed"):
            reasoning.compute_inference(baseline(), "mode-check", **kwargs)
    assert modes == ["assigned_closure", "full", "assigned_closure"]
    monkeypatch.setenv("CITRIDE_IDT_LOAD_MODE", "typo")
    with pytest.raises(reasoning.OntologyConfigurationError, match="mode"):
        reasoning.compute_inference(baseline(), "bad-env")

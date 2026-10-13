"""Independent entailment and witness checks for the actual OWL RL library."""

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import pytest
from owlrl import DeductiveClosure, OWLRL_Semantics
from rdflib import Graph, OWL, RDF, RDFS, URIRef

from citride import reasoning
from citride.reasoning import compute_inference, ontology_document, ontology_metadata


REPO = Path(__file__).resolve().parents[2]
NS = "urn:citride:"
RECORD = "urn:citride:record:"


@pytest.fixture(scope="module")
def baseline():
    data = json.loads((REPO / "data" / "scenario.json").read_text())
    data["baselineRevision"] = 1
    return data


@pytest.fixture(scope="module")
def inferred(baseline):
    return compute_inference(baseline, "inference-independent-test")


def facts(run):
    return run["assertedFacts"] + run["inferredFacts"]


def triple(fact):
    return tuple(URIRef(fact[key]["iri"]) for key in ("subject", "predicate", "object"))


def find(run, subject, predicate, object_iri, *, status="inferred"):
    wanted = (URIRef(RECORD + subject), URIRef(predicate), URIRef(object_iri))
    matching = [fact for fact in facts(run) if triple(fact) == wanted and fact["status"] == status]
    assert len(matching) == 1, (wanted, status)
    return matching[0]


def leaves(run, fact):
    index = {item["id"]: item for item in facts(run)}
    result = {}

    def visit(current, stack):
        assert current["id"] not in stack, "Explanation must not be circular"
        if current["status"] == "asserted":
            assert current["premiseFactIds"] == []
            result[current["id"]] = current
            return
        assert current["premiseFactIds"], "An inference needs source premises"
        assert current["axiomIds"], "An inference needs an ontology axiom"
        for identifier in current["premiseFactIds"]:
            assert identifier in index, "Witness references must resolve in this snapshot"
            visit(index[identifier], stack | {current["id"]})

    visit(fact, set())
    return list(result.values())


def test_version_profile_hash_and_actual_library(inferred):
    metadata = ontology_metadata()
    assert inferred["profile"] == "OWL 2 RL"
    assert inferred["engine"]["name"] == "owlrl"
    assert inferred["engine"]["version"]
    assert inferred["ontology"]["version"] == metadata["version"]
    assert inferred["ontology"]["sha256"] == sha256(ontology_document().encode()).hexdigest()
    assert inferred["ontology"]["axioms"]
    assert inferred["warnings"] == []
    assert inferred["limitations"]


def test_transitive_physical_containment(inferred):
    find(inferred, "plc-a", NS + "partOf", RECORD + "utility-a")
    find(inferred, "sensor-a", NS + "partOf", RECORD + "utility-a")
    find(inferred, "plc-a", NS + "partOf", RECORD + "plant-a", status="asserted")


def test_event_property_chain_uses_hosting_and_containment(inferred):
    target = find(inferred, "event-dosing", NS + "seenAtFacility", RECORD + "utility-a")
    leaf_subjects = {fact["subject"]["id"] for fact in leaves(inferred, target)}
    assert {"event-dosing", "plc-a", "plant-a"} <= leaf_subjects
    find(inferred, "cyber-plc-a", NS + "associatedWithFacility", RECORD + "utility-a")


def test_dependency_chain_and_inverse_from_qualified_records(inferred):
    relation = find(inferred, "dialysis-x", NS + "dependsOn", RECORD + "utility-a")
    witness = leaves(inferred, relation)
    assert all(fact["subject"]["id"] == "dep-a-x" for fact in witness)
    assert {fact["predicate"]["iri"] for fact in witness} == {NS + "provider", NS + "dependent"}
    find(inferred, "utility-a", NS + "providesTo", RECORD + "dialysis-x")


def test_new_class_entailment_and_existing_materialized_type(inferred):
    find(inferred, "plc-a", str(RDF.type), NS + "InfrastructureEntity")
    find(inferred, "plant-a", str(RDF.type), NS + "InfrastructureEntity")
    # The old repository already explicitly materializes this type. It must
    # not be relabeled as a newly inferred OWL fact to inflate the demo.
    find(inferred, "plant-a", str(RDF.type), NS + "PhysicalFacility", status="asserted")


def test_geography_is_not_an_operational_dependency(inferred):
    assert not any(
        fact["subject"]["id"] == "facility-q" and fact["predicate"]["iri"] == NS + "dependsOn"
        for fact in facts(inferred)
    )
    # Qualified dependencies are not transitive navigation shortcuts.
    assert not any(
        fact["subject"]["id"] == "dialysis-x" and fact["predicate"]["iri"] == NS + "dependsOn"
        and fact["object"]["id"] == "electric-e"
        for fact in facts(inferred)
    )


def test_probe_context_does_not_invent_loss(inferred):
    find(inferred, "event-probe-b", NS + "seenAtFacility", RECORD + "utility-b")
    find(inferred, "event-probe-c", NS + "seenAtFacility", RECORD + "utility-c")
    assert not any(
        fact["predicate"]["iri"] in {NS + "state", NS + "lossType", NS + "causesLoss", NS + "hasConsequence"}
        for fact in inferred["inferredFacts"]
    )


def test_every_displayed_inference_has_acyclic_sourced_witness(inferred):
    axioms = {item["id"] for item in inferred["ontology"]["axioms"]}
    sources = {item["id"] for item in inferred["baselineSnapshot"]["sources"]}
    for fact in inferred["inferredFacts"]:
        assert set(fact["axiomIds"]) <= axioms
        leaf_facts = leaves(inferred, fact)
        assert leaf_facts
        assert fact["sourceRefs"] and set(fact["sourceRefs"]) <= sources
        assert all(leaf["sourceRefs"] and set(leaf["sourceRefs"]) <= sources for leaf in leaf_facts)


@pytest.mark.parametrize("subject,predicate,object_iri", [
    ("plc-a", NS + "partOf", RECORD + "utility-a"),
    ("event-dosing", NS + "seenAtFacility", RECORD + "utility-a"),
    ("dialysis-x", NS + "dependsOn", RECORD + "utility-a"),
    ("plc-a", str(RDF.type), NS + "InfrastructureEntity"),
])
def test_library_replays_selected_conclusions_from_only_leaf_premises(inferred, subject, predicate, object_iri):
    conclusion = find(inferred, subject, predicate, object_iri)
    graph = Graph().parse(data=ontology_document(), format="turtle")
    for premise in leaves(inferred, conclusion):
        graph.add(triple(premise))
    assert triple(conclusion) not in graph
    DeductiveClosure(OWLRL_Semantics).expand(graph)
    assert triple(conclusion) in graph


def test_input_and_history_are_immutable(baseline):
    original = deepcopy(baseline)
    submitted = deepcopy(baseline)
    old = compute_inference(submitted, "inference-original")
    assert submitted == original
    submitted["entities"][0]["label"] = "Edited after inference capture"
    submitted["baselineRevision"] = 99
    assert old["baselineSnapshot"] == original
    assert old["baselineRevision"] == 1


def test_stable_facts_and_no_reflexive_identity_noise(baseline, inferred):
    another = compute_inference(baseline, "inference-repeat")
    assert another["assertedFacts"] == inferred["assertedFacts"]
    assert another["inferredFacts"] == inferred["inferredFacts"]
    assert len({fact["id"] for fact in facts(inferred)}) == len(facts(inferred))
    assert not any(fact["predicate"]["iri"] == "http://www.w3.org/2002/07/owl#sameAs" for fact in facts(inferred))


def test_actual_owl_closure_is_invoked(baseline, monkeypatch):
    called = []
    original = DeductiveClosure.expand

    def traced(self, graph, *args, **kwargs):
        called.append(len(graph))
        return original(self, graph, *args, **kwargs)

    monkeypatch.setattr(DeductiveClosure, "expand", traced)
    run = compute_inference(baseline, "inference-library-check")
    assert called and run["inferredFacts"]


def test_hosting_inverse_is_inferred_when_not_already_declared(baseline):
    submitted = deepcopy(baseline)
    cyber = next(record for record in submitted["entities"] if record["id"] == "cyber-plc-a")
    del cyber["hostedBy"]
    run = compute_inference(submitted, "inference-host-inverse")
    inverse = find(run, "cyber-plc-a", NS + "hostedBy", RECORD + "plc-a")
    assert leaves(run, inverse)[0]["subject"]["id"] == "plc-a"


@pytest.mark.parametrize("collection,identifier,field,target", [
    ("events", "event-dosing", "seenOn", "src-controller"),
    ("entities", "cyber-plc-a", "hostedBy", "org-a"),
    ("entities", "plc-a", "hostsCyberAsset", "plant-a"),
])
def test_typed_input_links_reject_existing_but_wrong_kind_targets(baseline, collection, identifier, field, target):
    submitted = deepcopy(baseline)
    record = next(item for item in submitted[collection] if item["id"] == identifier)
    record[field] = target
    with pytest.raises(ValueError):
        compute_inference(submitted, "inference-invalid-input")


def test_staged_record_cannot_be_an_inference_endpoint(baseline):
    submitted = deepcopy(baseline)
    submitted["dependencies"][0]["status"] = "draft"
    asset = next(item for item in submitted["entities"] if item["id"] == "plc-a")
    asset["partOf"] = "dep-a-x"
    with pytest.raises(ValueError):
        compute_inference(submitted, "inference-invalid-staged-endpoint")


def test_remote_import_is_rejected_without_running_reasoner(baseline, tmp_path, monkeypatch):
    path = tmp_path / "ontology.ttl"
    path.write_text(ontology_document() + '\n<urn:citride:WatershedOntology> <http://www.w3.org/2002/07/owl#imports> <https://example.invalid/ontology> .\n')
    monkeypatch.setattr(reasoning, "ONTOLOGY_PATH", path)
    called = []
    monkeypatch.setattr(DeductiveClosure, "expand", lambda *args: called.append(True))
    with pytest.raises(ValueError, match="imports"):
        compute_inference(baseline, "inference-import-rejected")
    assert called == []


def test_unsupported_semantic_construct_is_rejected(tmp_path, monkeypatch):
    path = tmp_path / "ontology.ttl"
    path.write_text(ontology_document() + '\n<urn:citride:partOf> a <http://www.w3.org/2002/07/owl#SymmetricProperty> .\n')
    monkeypatch.setattr(reasoning, "ONTOLOGY_PATH", path)
    with pytest.raises(ValueError):
        ontology_metadata()


def test_real_owl_disjoint_class_error_blocks_publishable_output(baseline, tmp_path, monkeypatch):
    graph = Graph().parse(data=ontology_document(), format="turtle")
    cyber, infrastructure, physical = [URIRef(NS + name) for name in ("CyberAsset", "InfrastructureEntity", "PhysicalAsset")]
    assert (cyber, RDFS.subClassOf, infrastructure) in graph
    graph.remove((cyber, RDFS.subClassOf, infrastructure))
    graph.add((cyber, RDFS.subClassOf, physical))
    for axiom in graph.subjects(OWL.annotatedSource, cyber):
        if (axiom, OWL.annotatedProperty, RDFS.subClassOf) in graph and (axiom, OWL.annotatedTarget, infrastructure) in graph:
            graph.remove((axiom, OWL.annotatedTarget, infrastructure))
            graph.add((axiom, OWL.annotatedTarget, physical))
    path = tmp_path / "contradictory-ontology.ttl"
    path.write_text(graph.serialize(format="turtle"))
    monkeypatch.setattr(reasoning, "ONTOLOGY_PATH", path)
    with pytest.raises(reasoning.SemanticInconsistencyError) as error:
        compute_inference(baseline, "inference-contradiction")
    assert error.value.diagnostics
    assert all(item["status"] == "failed" for item in error.value.diagnostics)

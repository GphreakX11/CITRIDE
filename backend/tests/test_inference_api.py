"""OWL inference stays separate from promoted model and immutable run history."""

from copy import deepcopy
import hashlib

from fastapi.testclient import TestClient
import pytest
from rdflib import Dataset, Literal, RDF, URIRef

from citride.api import REPO_ROOT, create_app
from citride.storage import BASELINE, NS, Repository


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "state")) as connection:
        yield connection


def run_inference(client, **request):
    response = client.post("/v1/inference-runs", json=request)
    assert response.status_code == 201, response.text
    return response.json()


def relation(run, subject, predicate, object_id):
    return next((fact for fact in run["inferredFacts"]
                 if fact["subject"]["id"] == subject
                 and fact["predicate"]["iri"] == str(NS[predicate])
                 and fact["object"]["id"] == object_id), None)


def snapshot_content(run):
    return {key: value for key, value in run.items()
            if key not in {"stale", "staleReasons", "currentBaselineRevision", "currentOntologySha256"}}


def test_ontology_run_and_resolved_witness_without_baseline_mutation(client):
    baseline = client.get("/v1/bootstrap").json()
    metadata = client.get("/v1/ontology").json()
    assert metadata["profile"] == "OWL 2 RL"
    assert metadata["engine"]["name"] == "owlrl"
    assert metadata["axioms"] and len(metadata["sha256"]) == 64
    run = run_inference(client, expectedBaselineRevision=1)
    assert run["baselineSnapshot"] == baseline
    assert run["ontology"]["sha256"] == metadata["sha256"]
    assert run["stale"] is False
    assert client.get("/v1/bootstrap").json() == baseline
    assert client.get("/v1/inference-runs").json()["runs"][0]["inferredCount"] == len(run["inferredFacts"])
    inferred = relation(run, "dialysis-x", "dependsOn", "utility-a")
    assert inferred is not None
    proof = client.get(f"/v1/inference-runs/{run['id']}/facts/{inferred['id']}")
    assert proof.status_code == 200, proof.text
    explanation = proof.json()
    assert explanation["fact"] == inferred
    assert explanation["proofFacts"] and explanation["axioms"] and explanation["sources"]
    resolved = {fact["id"] for fact in explanation["proofFacts"]}
    assert set(inferred["premiseFactIds"]).issubset(resolved)
    for fact in explanation["proofFacts"]:
        assert set(fact["premiseFactIds"]).issubset(resolved)
    assert set(inferred["sourceRefs"]).issubset({source["id"] for source in explanation["sources"]})
    assert all(fact["id"] != inferred["id"] for fact in explanation["proofFacts"])
    assert relation(run, "facility-q", "dependsOn", "utility-a") is None
    assert not any(fact["predicate"]["iri"] == str(NS["unsafe_water"]) for fact in run["inferredFacts"])


def test_draft_is_excluded_promoted_link_requires_new_run_and_old_proof_survives_restart(client, tmp_path):
    before = run_inference(client)
    baseline = client.get("/v1/bootstrap").json()
    dependency = deepcopy(baseline["dependencies"][0])
    dependency.update({
        "id": "dep-a-q", "revision": 1, "dependent": "facility-q", "dependentFunction": "q-safe-water",
        "lossTypes": ["unsafe_water"], "validForLossTypes": ["unsafe_water"],
        "usableBackupMinHours": 1, "usableBackupMaxHours": 1,
        "assumptionNote": "A fictional reviewed water dependency for Facility Q.",
    })
    dependency.pop("parameterAssertionRefs", None)
    proposal = client.post("/v1/dependency-proposals", json={"dependency": dependency, "expectedBaselineRevision": 1}).json()
    while_draft = run_inference(client)
    assert relation(while_draft, "facility-q", "dependsOn", "utility-a") is None
    assert client.post(f"/v1/dependency-proposals/{proposal['id']}/promote").status_code == 200
    conflict = client.post("/v1/inference-runs", json={"expectedBaselineRevision": 1})
    assert conflict.status_code == 409
    assert len(client.get("/v1/inference-runs").json()["runs"]) == 2
    after = run_inference(client, expectedBaselineRevision=2)
    new_q_fact = relation(after, "facility-q", "dependsOn", "utility-a")
    assert new_q_fact is not None
    assert client.get(f"/v1/inference-runs/{before['id']}/facts/{new_q_fact['id']}").status_code == 404
    q_proof = client.get(f"/v1/inference-runs/{after['id']}/facts/{new_q_fact['id']}").json()
    assert any(source["id"].startswith("src-model-") for source in q_proof["sources"])
    historical = client.get(f"/v1/inference-runs/{before['id']}").json()
    assert historical["staleReasons"] == {"baselineRevision": True, "ontology": False}
    assert snapshot_content(historical) == snapshot_content(before)
    old_fact = relation(before, "dialysis-x", "dependsOn", "utility-a")
    old_proof = client.get(f"/v1/inference-runs/{before['id']}/facts/{old_fact['id']}").json()
    with TestClient(create_app(tmp_path / "state")) as restarted:
        assert restarted.get(f"/v1/inference-runs/{before['id']}").json() == historical
        assert restarted.get(f"/v1/inference-runs/{before['id']}/facts/{old_fact['id']}").json() == old_proof
    assert old_proof["baselineRevision"] == 1
    assert not any(source["id"].startswith("src-model-") for source in old_proof["sources"])


def test_stale_ontology_is_dynamic_and_does_not_rewrite_captured_axioms(client, monkeypatch):
    from citride import reasoning

    before = run_inference(client)
    metadata = reasoning.ontology_metadata()
    monkeypatch.setattr(reasoning, "ontology_metadata", lambda: {**metadata, "sha256": "f" * 64})
    historical = client.get(f"/v1/inference-runs/{before['id']}").json()
    assert historical["stale"] is True
    assert historical["staleReasons"] == {"baselineRevision": False, "ontology": True}
    assert snapshot_content(historical) == snapshot_content(before)
    assert client.get("/v1/inference-runs").json()["runs"][0]["staleReasons"]["ontology"] is True


@pytest.mark.parametrize("payload", [
    {"expectedBaselineRevision": True}, {"expectedBaselineRevision": "1"},
    {"expectedBaselineRevision": 0}, {"ontology": "untrusted ontology"},
    {"triples": []}, {"query": "SELECT * WHERE {?s ?p ?o}"},
])
def test_invalid_inference_inputs_cannot_supply_graphs_or_queries(client, payload):
    assert client.post("/v1/inference-runs", json=payload).status_code == 422
    assert client.get("/v1/inference-runs").json()["runs"] == []


def test_optional_body_and_missing_or_invalid_identifiers(client):
    response = client.post("/v1/inference-runs")
    assert response.status_code == 201, response.text
    run_id = response.json()["id"]
    assert client.get("/v1/inference-runs/missing-run").status_code == 404
    assert client.get("/v1/inference-runs/bad%20id").status_code == 422
    assert client.get(f"/v1/inference-runs/{run_id}/facts/missing-fact").status_code == 404
    assert client.get(f"/v1/inference-runs/{run_id}/facts/bad%20id").status_code == 422


def test_failed_reasoning_has_no_persisted_valid_run(client, monkeypatch):
    from citride import reasoning

    baseline = client.get("/v1/bootstrap").json()

    def inconsistent(*args):
        raise reasoning.SemanticInconsistencyError([
            {"message": "Disjoint classes have a common instance", "kind": "owl_semantic_inconsistency"},
        ])

    monkeypatch.setattr(reasoning, "compute_inference", inconsistent)
    result = client.post("/v1/inference-runs", json={})
    assert result.status_code == 422
    assert "semantic inconsistency" in result.json()["detail"]
    assert result.json()["category"] == "semantic_inconsistency"
    assert result.json()["diagnostics"][0]["kind"] == "owl_semantic_inconsistency"
    assert client.get("/v1/inference-runs").json()["runs"] == []
    assert client.get("/v1/bootstrap").json() == baseline


def test_rdf_export_separates_ontology_assertions_conclusions_and_source_provenance(client):
    run = run_inference(client)
    dataset = Dataset().parse(data=client.get("/v1/graph/export").text, format="nquads")
    asserted = dataset.graph(URIRef("urn:citride:graph:inference-asserted:" + run["id"]))
    inferred = dataset.graph(URIRef("urn:citride:graph:inference-inferred:" + run["id"]))
    ontology = dataset.graph(URIRef("urn:citride:graph:ontology:" + run["ontology"]["sha256"]))
    metadata = dataset.graph(URIRef("urn:citride:graph:inference:" + run["id"]))
    conclusion = relation(run, "dialysis-x", "dependsOn", "utility-a")
    triple = (URIRef(conclusion["subject"]["iri"]), URIRef(conclusion["predicate"]["iri"]), URIRef(conclusion["object"]["iri"]))
    assert triple in inferred
    assert triple not in asserted
    assert triple not in dataset.graph(BASELINE)
    assert len(ontology) and len(asserted)
    assert list(metadata.triples((None, NS.premiseFact, None)))
    assert list(metadata.triples((None, NS.sourceRefs, None)))
    saved_document = next(metadata.objects(None, NS.ontologyDocument))
    assert hashlib.sha256(str(saved_document).encode()).hexdigest() == run["ontology"]["sha256"]
    assert not list(dataset.graph(BASELINE).triples((None, NS.dependsOn, None)))


def test_old_ontology_graph_is_preserved_after_a_new_version(tmp_path):
    from citride.reasoning import compute_inference, ontology_document

    store = Repository(tmp_path / "state", REPO_ROOT / "data" / "scenario.json")
    original = ontology_document()

    def capture_with_document(document, version):
        def compute(data, run_id):
            run = compute_inference(data, run_id)
            run["createdAt"] = "2026-10-13T12:00:00+00:00"
            run["ontology"] = {**run["ontology"], "version": version,
                               "sha256": hashlib.sha256(document.encode()).hexdigest()}
            run["_ontologyTurtle"] = document
            return run
        return compute

    first = store.create_inference_run(1, capture_with_document(original, "first"))
    changed = original + '\n<urn:citride:test-version> <http://www.w3.org/2000/01/rdf-schema#label> "Second fixture ontology" .\n'
    second = store.create_inference_run(1, capture_with_document(changed, "second"))
    exported = Dataset().parse(data=store.export(), format="nquads")
    old_graph = exported.graph(URIRef("urn:citride:graph:ontology:" + first["ontology"]["sha256"]))
    new_graph = exported.graph(URIRef("urn:citride:graph:ontology:" + second["ontology"]["sha256"]))
    assert len(old_graph) + 1 == len(new_graph)
    restarted = Repository(tmp_path / "state", REPO_ROOT / "data" / "scenario.json")
    historical = restarted.inference_run(first["id"], second["ontology"]["sha256"])
    assert historical["staleReasons"]["ontology"] is True
    assert historical["ontology"] == first["ontology"]


def test_existing_state_seen_on_index_migrates_without_model_or_history_changes(tmp_path):
    from citride.engine import compute_run

    store = Repository(tmp_path / "state", REPO_ROOT / "data" / "scenario.json")
    baseline = store.baseline()
    dependency = deepcopy(baseline["dependencies"][0])
    proposal = store.create_proposal(dependency, 1)
    old_run = store.create_run({"scenarioId": "unsafe-water", "evaluationHour": 1,
                                "horizonHours": 12, "overrides": []}, compute_run)
    dataset = Dataset().parse(data=store.export(), format="nquads")
    graph = dataset.graph(BASELINE)
    event = next(event for event in baseline["events"] if event.get("seenOn"))
    subject = URIRef("urn:citride:record:" + event["id"])
    references = event["seenOn"] if isinstance(event["seenOn"], list) else [event["seenOn"]]
    graph.remove((subject, NS.seenOn, None))
    for reference in references:
        graph.add((subject, NS.seenOn, Literal(reference)))
    store.path.write_text(dataset.serialize(format="nquads"))
    restarted = Repository(tmp_path / "state", REPO_ROOT / "data" / "scenario.json")
    assert restarted.baseline() == baseline
    assert restarted.proposal(proposal["id"]) == proposal
    assert restarted.run(old_run["id"]) == old_run
    exported = Dataset().parse(data=restarted.export(), format="nquads")
    assert set(exported.graph(BASELINE).objects(subject, NS.seenOn)) == {
        URIRef("urn:citride:record:" + reference) for reference in references
    }

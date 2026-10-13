"""Real Postgres guarantees across independent stateless repository instances.

Set TEST_DATABASE_URL to an isolated disposable Postgres database to run these
tests. Each case uses its own random state key and deletes only that row.
"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import os
from pathlib import Path
import threading
from uuid import uuid4

import psycopg
import pytest
from rdflib import Dataset, Literal, URIRef

from citride.engine import compute_run
from citride.postgres import PostgresRepository
from citride.reasoning import compute_inference, ontology_document, ontology_metadata
from citride.storage import BASELINE, ConflictError, NS, StorageUnavailableError

FIXTURE = Path(__file__).resolve().parents[2] / "data" / "scenario.json"


@pytest.fixture
def state():
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for real Postgres integration tests")
    key = "test-" + uuid4().hex
    try:
        yield database_url, key
    finally:
        with psycopg.connect(database_url) as connection:
            connection.execute("DELETE FROM citride_state WHERE state_key = %s", (key,))


def repository(state, fixture=FIXTURE):
    database_url, key = state
    return PostgresRepository(database_url, fixture, state_key=key)


def inference(data, run_id):
    run = compute_inference(data, run_id)
    run["createdAt"] = "2026-10-13T12:00:00+00:00"
    run["_ontologyTurtle"] = ontology_document()
    return run


def test_seed_once_and_cross_instance_visibility(state, tmp_path):
    fixture = tmp_path / "scenario.json"
    fixture.write_text(FIXTURE.read_text())
    first = repository(state, fixture)
    before = first.baseline()
    fixture.write_text("{}")  # A redeploy's fixture must not replace durable state.
    second = repository(state, fixture)
    assert second.baseline() == before
    proposal = first.create_proposal(deepcopy(before["dependencies"][0]), 1)
    assert second.proposal(proposal["id"]) == proposal
    second.promote(proposal["id"])
    assert first.baseline()["baselineRevision"] == 2
    assert first.proposal(proposal["id"])["status"] == "promoted"
    assert repository(state, fixture).baseline() == first.baseline()


def test_concurrent_first_instances_seed_one_durable_baseline(state):
    barrier = threading.Barrier(2)

    def initialize():
        barrier.wait(timeout=10)
        return repository(state).baseline()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(initialize), executor.submit(initialize)]
        baselines = [future.result(timeout=60) for future in futures]
    assert baselines[0] == baselines[1]
    assert baselines[0]["baselineRevision"] == 1
    assert repository(state).baseline() == baselines[0]


def test_history_captured_proofs_and_export_survive_fresh_instances(state):
    first = repository(state)
    before = first.baseline()
    cascade = first.create_run({"scenarioId": "unsafe-water", "evaluationHour": 1,
                                "horizonHours": 12, "overrides": []}, compute_run)
    run = first.create_inference_run(1, inference)
    fact = next(fact for fact in run["inferredFacts"]
                if fact["subject"]["id"] == "dialysis-x"
                and fact["predicate"]["iri"] == str(NS.dependsOn)
                and fact["object"]["id"] == "utility-a")
    proof = first.inference_fact(run["id"], fact["id"])
    assert proof["proofFacts"] and proof["sources"] and proof["axioms"]
    second = repository(state)
    assert second.run(cascade["id"]) == cascade
    assert second.inference_run(run["id"], ontology_metadata()["sha256"]) == run
    assert second.inference_fact(run["id"], fact["id"]) == proof
    assert second.baseline() == before
    exported = Dataset().parse(data=second.export(), format="nquads")
    inferred = exported.graph(URIRef("urn:citride:graph:inference-inferred:" + run["id"]))
    ontology = exported.graph(URIRef("urn:citride:graph:ontology:" + run["ontology"]["sha256"]))
    assert len(inferred) and len(ontology)
    proposal = second.create_proposal(deepcopy(before["dependencies"][0]), 1)
    second.promote(proposal["id"])
    third = repository(state)
    historical = third.inference_run(run["id"], ontology_metadata()["sha256"])
    assert historical["staleReasons"] == {"baselineRevision": True, "ontology": False}
    for field in ("baselineSnapshot", "assertedFacts", "inferredFacts", "ontology"):
        assert historical[field] == run[field]
    assert third.inference_fact(run["id"], fact["id"]) == proof
    assert third.run(cascade["id"]) == cascade


def test_error_after_sql_write_rolls_back_all_model_and_proposal_changes(state, monkeypatch):
    store = repository(state)
    before = store.baseline()
    proposal = store.create_proposal(deepcopy(before["dependencies"][0]), 1)
    save = store._save

    def fail_after_write(dataset):
        save(dataset)
        raise RuntimeError("Simulated interruption before transaction commit")

    monkeypatch.setattr(store, "_save", fail_after_write)
    with pytest.raises(RuntimeError, match="before transaction commit"):
        store.promote(proposal["id"])
    assert store.baseline() == before  # No modified graph survives in this worker.
    fresh = repository(state)
    assert fresh.baseline() == before
    assert fresh.proposal(proposal["id"]) == proposal


def test_concurrent_promotions_have_one_winner_across_repository_instances(state):
    first, second = repository(state), repository(state)
    baseline = first.baseline()
    one = first.create_proposal(deepcopy(baseline["dependencies"][0]), 1)
    two = second.create_proposal(deepcopy(baseline["dependencies"][1]), 1)
    barrier = threading.Barrier(2)

    def promote(store, proposal):
        barrier.wait(timeout=10)
        try:
            return store.promote(proposal["id"])["status"]
        except ConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(promote, first, one), executor.submit(promote, second, two)]
        assert sorted(future.result(timeout=60) for future in futures) == ["conflict", "promoted"]
    fresh = repository(state)
    assert fresh.baseline()["baselineRevision"] == 2
    assert sorted(fresh.proposal(proposal["id"])["status"] for proposal in (one, two)) == ["draft", "promoted"]


def test_legacy_event_index_repairs_without_replacing_baseline_or_history(state):
    store = repository(state)
    before = store.baseline()
    proposal = store.create_proposal(deepcopy(before["dependencies"][0]), 1)
    dataset = Dataset().parse(data=store.export(), format="nquads")
    event = next(event for event in before["events"] if event.get("seenOn"))
    references = event["seenOn"] if isinstance(event["seenOn"], list) else [event["seenOn"]]
    subject = URIRef("urn:citride:record:" + event["id"])
    graph = dataset.graph(BASELINE)
    graph.remove((subject, NS.seenOn, None))
    for reference in references:
        graph.add((subject, NS.seenOn, Literal(reference)))
    with psycopg.connect(state[0]) as connection:
        connection.execute("UPDATE citride_state SET nquads = %s WHERE state_key = %s",
                           (dataset.serialize(format="nquads"), state[1]))
    restarted = repository(state)
    assert restarted.baseline() == before
    assert restarted.proposal(proposal["id"]) == proposal
    exported = Dataset().parse(data=restarted.export(), format="nquads")
    assert set(exported.graph(BASELINE).objects(subject, NS.seenOn)) == {
        URIRef("urn:citride:record:" + reference) for reference in references
    }


def test_connection_failure_never_exposes_credentials(monkeypatch):
    def fail(*args, **kwargs):
        raise psycopg.OperationalError("postgres://private-user:secret-password@private-host/database")

    monkeypatch.setattr("citride.postgres.psycopg.connect", fail)
    with pytest.raises(StorageUnavailableError) as caught:
        PostgresRepository("postgres://private-user:secret-password@private-host/database", FIXTURE)
    assert str(caught.value) == "Durable storage is unavailable; retry later"
    assert caught.value.__suppress_context__ is True
    assert caught.value.__cause__ is None

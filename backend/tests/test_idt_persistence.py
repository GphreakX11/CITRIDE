"""Inline IDT survives real run/case capture and durable repository restarts.

The seed is copied unchanged: these regressions must not retrofit missing IDT in
fixtures or resolve classifications from the advisory reference at read time.
Postgres uses only TEST_DATABASE_URL and deletes only its UUID-owned state row.
"""

from copy import deepcopy
import json
import os
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
import psycopg
import pytest

from citride.api import create_app
from citride.engine import compute_run
from citride.postgres import PostgresRepository
from citride.storage import Repository

ROOT = Path(__file__).resolve().parents[2]
SCENARIO = ROOT / "data/scenario.json"
REFERENCE = ROOT / "data/reference/idt/idt_v4.json"
PREFIX = "/v1/command/incidents"
RUN_REQUEST = {
    "scenarioId": "unsafe-water",
    "evaluationHour": 1,
    "horizonHours": 12,
    "overrides": [],
}


@pytest.fixture(params=["file", "postgres"])
def persistence(request, tmp_path, monkeypatch):
    """Independent real repository/app constructors for the same isolated state."""
    for name in (
        "VERCEL",
        "VERCEL_ENV",
        "CITRIDE_DATABASE_URL",
        "DATABASE_URL",
        "CITRIDE_STATE_KEY",
        "CITRIDE_DATA_DIR",
        "CITRIDE_DEMO_USERNAME",
        "CITRIDE_DEMO_PASSWORD",
    ):
        monkeypatch.delenv(name, raising=False)
    scenario = tmp_path / "scenario.json"
    scenario.write_bytes(SCENARIO.read_bytes())
    state_dir = tmp_path / "state"
    if request.param == "file":
        yield (
            lambda: Repository(state_dir, scenario),
            lambda: create_app(state_dir, scenario_path=scenario),
        )
        return

    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for real Postgres IDT persistence")
    state_key = "idt-persistence-" + uuid4().hex
    monkeypatch.setenv("CITRIDE_DATABASE_URL", database_url)
    monkeypatch.setenv("CITRIDE_STATE_KEY", state_key)
    try:
        yield (
            lambda: PostgresRepository(database_url, scenario, state_key=state_key),
            lambda: create_app(scenario_path=scenario),
        )
    finally:
        # No reset, truncate, schema drop, default key or production URL fallback.
        # Seeding can fail before table creation, so check existence first.
        with psycopg.connect(database_url, connect_timeout=10) as connection:
            if connection.execute("SELECT to_regclass('citride_state')").fetchone()[0]:
                connection.execute(
                    "DELETE FROM citride_state WHERE state_key = %s", (state_key,)
                )


@pytest.fixture
def assignments():
    return json.loads(REFERENCE.read_text(encoding="utf-8"))["assignments"]


def assert_inline_inventory(baseline, assignments):
    entities = baseline["entities"]
    assert len(entities) == 97, "The 67 original entities plus 30 normalized source-model entities share the main store"
    assert len({entity["id"] for entity in entities}) == 97
    assert len([entity for entity in entities if entity['id'] in assignments]) == 67
    assert {"vendor-v", "hospital-w", "dialysis-u"}.issubset(entity["id"] for entity in entities)
    for entity in entities:
        if entity['id'] in assignments:
            assert entity.get("idt") == assignments[entity["id"]], entity["id"]
        else:
            assert entity.get('idt'), entity['id']
            assert 'SIMULATED' in entity['handling'] and entity['assumptionNote']
    assert {entity["idt"]["status"] for entity in entities} == {
        "coded", "below_idt_level", "not_idt_asset", "unassigned"
    }


def assert_inline_context(context, assignments):
    # All these records are present for the actual event-dosing structural chain.
    for field in ("provider", "facility", "cyberAsset", "physicalAsset", "serviceArea"):
        entity = context[field]
        assert entity is not None, field
        assert entity.get("idt") == assignments[entity["id"]], field
    for downstream in context["downstreamDependencies"]:
        entity = downstream["dependent"]
        assert entity.get("idt") == assignments[entity["id"]], entity["id"]


def change_current_classifications(store):
    """Persist valid, visibly different current classifications, not old graphs."""
    with store._locked():
        dataset = store._load()
        baseline = store._baseline(dataset)
        baseline["baselineRevision"] += 1
        for entity in baseline["entities"]:
            entity["idt"] = {"status": "unassigned"}
        store._write_baseline(dataset, baseline)
        store._save(dataset)
    return baseline


def test_run_inline_idt_is_detached_and_survives_real_repository_restart(
    persistence, assignments
):
    open_repository, _ = persistence
    store = open_repository()
    captured_inputs = []

    def capture_input(baseline, request, run_id):
        captured_inputs.append(baseline)
        return compute_run(baseline, request, run_id)

    run = store.create_run(deepcopy(RUN_REQUEST), capture_input)
    expected = deepcopy(run)
    assert_inline_inventory(run["baselineSnapshot"], assignments)
    assert_inline_inventory(store.baseline(), assignments)

    # Mutation of the exact baseline dict passed into compute_run cannot reach
    # either the returned snapshot or the saved run/baseline.
    for entity in captured_inputs[0]["entities"]:
        entity["idt"].clear()
    assert run == expected
    assert store.run(run["id"]) == expected
    assert_inline_inventory(store.baseline(), assignments)

    fresh = open_repository()
    assert fresh.run(run["id"]) == expected
    assert_inline_inventory(fresh.baseline(), assignments)
    changed = change_current_classifications(fresh)
    restarted = open_repository()
    assert restarted.baseline() == changed
    assert restarted.baseline() != expected["baselineSnapshot"]
    assert restarted.run(run["id"]) == expected
    assert_inline_inventory(restarted.run(run["id"])["baselineSnapshot"], assignments)


def test_case_api_captures_inline_idt_and_preserves_history_after_restart(
    persistence, assignments
):
    open_repository, open_app = persistence
    with TestClient(open_app()) as client:
        response = client.get("/v1/bootstrap")
        assert response.status_code == 200, response.text
        baseline = response.json()
        response = client.post(
            PREFIX,
            json={
                "eventId": "event-dosing",
                "title": "Inline classification capture regression",
                "priority": "high",
                "expectedBaselineRevision": baseline["baselineRevision"],
                "clientRequestId": str(uuid4()),
            },
        )
        assert response.status_code == 201, response.text
        created = response.json()
        assert created["eventSnapshot"]["id"] == "event-dosing"
        assert created["runSnapshot"] is None
        assert_inline_context(created["contextSnapshot"], assignments)
        path = f"{PREFIX}/{created['id']}"
        response = client.post(
            path + "/actions",
            json={
                "action": "analyze",
                "expectedVersion": created["version"],
                "clientRequestId": str(uuid4()),
                **{key: value for key, value in RUN_REQUEST.items() if key != "overrides"},
            },
        )
        assert response.status_code == 200, response.text
        captured = response.json()
        expected = deepcopy(captured)
        assert captured["contextSnapshot"] == created["contextSnapshot"]
        assert_inline_inventory(captured["runSnapshot"]["baselineSnapshot"], assignments)
        assert_inline_context(captured["contextSnapshot"], assignments)
        assert {item["entityId"] for item in captured["decisions"]} == {
            "dialysis-x", "hospital-y", "nursing-z"
        }
        # Mutating today's returned dictionary must not mutate saved capture.
        for entity in baseline["entities"]:
            entity["idt"].clear()
        assert captured == expected
        assert client.get(path).json() == expected

    # Test a real save/reopen, then durable baseline drift. Historical reads
    # must retain their own IDT, not re-resolve against today's unassigned data.
    fresh_store = open_repository()
    assert_inline_inventory(fresh_store.baseline(), assignments)
    assert fresh_store.run(expected["runId"]) == expected["runSnapshot"]
    changed = change_current_classifications(fresh_store)
    with TestClient(open_app()) as restarted:
        response = restarted.get(path)
        assert response.status_code == 200, response.text
        assert response.json() == expected
        assert_inline_context(response.json()["contextSnapshot"], assignments)
        assert_inline_inventory(
            response.json()["runSnapshot"]["baselineSnapshot"], assignments
        )
        response = restarted.get(f"/v1/cascade-runs/{expected['runId']}")
        assert response.status_code == 200, response.text
        assert response.json() == expected["runSnapshot"]
        response = restarted.get("/v1/bootstrap")
        assert response.status_code == 200, response.text
        assert response.json() == changed

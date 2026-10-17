"""Single-transaction workspace reads, using only disposable local repositories."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import shutil
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from rdflib import URIRef

from citride import api
from citride.command import CommandService, RETIRED_EVENT_TYPES
from citride.records import META_ID, META_KIND, RecordsService
from citride.storage import Repository, StorageUnavailableError

ROOT = Path(__file__).resolve().parents[2]
PASSWORD = "test-only-workspace-password"


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in (
        "VERCEL", "VERCEL_ENV", "DATABASE_URL", "CITRIDE_DATABASE_URL",
        "CITRIDE_STATE_KEY", "CITRIDE_DATA_DIR", "CITRIDE_DEMO_USERNAME",
        "CITRIDE_DEMO_PASSWORD", "CITRIDE_ALLOW_DEMO_RESET",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    # Copy every configurable input: neither state nor config mutations can
    # touch another test, a developer repository, or a hosted database.
    inputs = tmp_path / "inputs"
    for relative in ("scenario.json", "reference.json", "scripted/watershed_beta.json"):
        destination = inputs / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "data" / relative, destination)
    clock = [datetime(2030, 1, 1, tzinfo=timezone.utc)]
    monkeypatch.setattr(RecordsService, "_wall_now", lambda _self: clock[0])
    monkeypatch.setattr("citride.command._timestamp", lambda: clock[0].isoformat())
    store = Repository(tmp_path / "state", inputs / "scenario.json")
    monkeypatch.setattr(api, "Repository", lambda *_args, **_kwargs: store)
    with TestClient(api.create_app(store.data_dir, store.scenario_path)) as client:
        # Repository setup/upgrade is intentionally outside snapshot counters.
        assert client.get("/v1/bootstrap").status_code == 200
        yield SimpleNamespace(client=client, store=store, clock=clock, inputs=inputs)


def create_case(workspace):
    response = workspace.client.post("/v1/command/incidents", json={
        "eventId": "event-vpn-a", "title": "Workspace review", "priority": "high",
        "expectedBaselineRevision": 1, "clientRequestId": str(uuid4()),
    })
    assert response.status_code == 201, response.text
    return response.json()


def populate(workspace):
    case = create_case(workspace)
    scenarios = case["contextSnapshot"]["scenarios"]
    assert scenarios
    response = workspace.client.post(f"/v1/command/incidents/{case['id']}/actions", json={
        "action": "analyze", "scenarioId": scenarios[0]["id"],
        "evaluationHour": 1, "horizonHours": 12,
        "expectedVersion": case["version"], "clientRequestId": str(uuid4()),
    })
    assert response.status_code == 200, response.text
    assert response.json()["runSnapshot"] is not None
    response = workspace.client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"})
    assert response.status_code == 201, response.text
    return workspace.client.get(f"/v1/command/incidents/{case['id']}").json()


def snapshot(workspace):
    response = workspace.client.get("/v1/workspace")
    assert response.status_code == 200, response.text
    return response.json()


def test_workspace_matches_all_legacy_views(workspace):
    case = populate(workspace)
    payload = snapshot(workspace)
    assert set(payload) == {"bootstrap", "runs", "incidents", "records", "reference", "health"}
    assert payload["bootstrap"] == workspace.client.get("/v1/bootstrap").json()
    assert payload["runs"] == workspace.client.get("/v1/cascade-runs").json()["runs"]
    assert payload["incidents"] == workspace.client.get("/v1/command/incidents").json()["incidents"]
    assert payload["records"] == workspace.client.get("/v1/command/records").json()
    assert payload["reference"] == workspace.client.get("/v1/reference").json()
    assert payload["health"] == workspace.client.get("/health").json()
    assert set(payload["health"]) == {"status", "baselineRevision", "demoMode", "storyNow", "resetEnabled"}
    assert len(payload["runs"]) == 2
    assert all(set(run) == {"id", "createdAt", "scenarioId", "baselineRevision"} for run in payload["runs"])
    assert payload["incidents"] == [case]
    assert payload["records"]["contacts"]
    incident = next(row for row in payload["records"]["statewideIncidents"] if row.get("caseId") == case["id"])
    assert incident["reviews"] == case["decisions"]
    assert incident["progress"] == case["tasks"]
    assert incident["runId"] == case["runId"]


def test_empty_workspace_matches_legacy_views(workspace):
    payload = snapshot(workspace)
    assert payload["runs"] == payload["incidents"] == []
    assert payload["records"] == workspace.client.get("/v1/command/records").json()
    assert len(payload["records"]["statewideIncidents"]) == 4


def test_workspace_uses_one_lock_load_and_no_writes_or_nested_readers(workspace, monkeypatch):
    populate(workspace)
    store = workspace.store
    before = store.path.read_bytes()
    with store._locked():
        dataset = store._load()
        quads = set(dataset.quads())
    original_lock, original_load = store._locked, store._load
    counts = {"locks": 0, "loads": 0, "depth": 0}

    @contextmanager
    def locked():
        counts["locks"] += 1
        assert counts["depth"] == 0, "Nested local locks are not transaction-neutral"
        with original_lock():
            counts["depth"] += 1
            try:
                yield
            finally:
                counts["depth"] -= 1

    def load():
        assert counts["depth"] == 1
        counts["loads"] += 1
        return original_load()

    def forbidden(*_args, **_kwargs):
        pytest.fail("Snapshot must not initialize, write, or use locking view wrappers")

    monkeypatch.setattr(store, "_locked", locked)
    monkeypatch.setattr(store, "_load", load)
    for name in ("_save", "_record_graph", "_write_baseline", "baseline", "runs"):
        monkeypatch.setattr(store, name, forbidden)
    for name in ("initialize", "seed", "records", "story_now"):
        monkeypatch.setattr(RecordsService, name, forbidden)
    monkeypatch.setattr(CommandService, "list", forbidden)
    payload = snapshot(workspace)
    assert payload["incidents"] and payload["runs"]
    assert counts == {"locks": 1, "loads": 1, "depth": 0}
    assert store.path.read_bytes() == before
    assert set(dataset.quads()) == quads


def test_repeated_gets_preserve_state_bytes_and_metadata(workspace):
    populate(workspace)
    before = workspace.store.path.read_bytes()
    signature = workspace.store._signature()
    first = snapshot(workspace)
    for _ in range(3):
        assert snapshot(workspace) == first
    assert workspace.store.path.read_bytes() == before
    assert workspace.store._signature() == signature


def test_workspace_clock_and_late_records_are_fresh_without_writes(workspace):
    create_case(workspace)
    first = snapshot(workspace)
    task_id = "task-ciru-confirm-setpoint"
    task = lambda payload: next(row for row in payload["records"]["responseTasks"] if row["id"] == task_id)
    assert task(first)["late"] is False
    before = workspace.store.path.read_bytes()
    workspace.clock[0] += timedelta(hours=2)
    second = snapshot(workspace)
    assert task(second)["late"] is True
    assert datetime.fromisoformat(second["records"]["storyNow"]) - datetime.fromisoformat(first["records"]["storyNow"]) == timedelta(hours=2)
    assert second["health"]["storyNow"] == second["records"]["storyNow"]
    assert second["records"] == workspace.client.get("/v1/command/records").json()
    assert workspace.store.path.read_bytes() == before


@pytest.mark.parametrize("event_type", sorted(RETIRED_EVENT_TYPES))
def test_workspace_hides_retired_incidents_and_private_receipts(workspace, event_type):
    case = create_case(workspace)
    with workspace.store._locked():
        dataset = workspace.store._load()
        retired = workspace.store._record(dataset, "command-incident", case["id"])
        retired["id"] = "retired-case"
        event = {"id": "retired-event", "type": event_type, "label": "Retired"}
        retired.update(eventId=event["id"], eventSnapshot=event, tasks=[{"legacy": True}], _requests={"private-retired-receipt": "0" * 64})
        retired["contextSnapshot"]["event"] = deepcopy(event)
        workspace.store._record_graph(dataset, "command-incident", retired)
        workspace.store._save(dataset)
    before = workspace.store.path.read_bytes()
    payload = snapshot(workspace)
    assert payload["incidents"] == [case]
    assert payload["incidents"] == workspace.client.get("/v1/command/incidents").json()["incidents"]
    serialized = json.dumps(payload)
    assert "_requests" not in serialized
    assert "private-retired-receipt" not in serialized
    assert event_type not in serialized
    assert workspace.store.path.read_bytes() == before


@pytest.mark.parametrize("defect", ["incident-tasks", "incident-receipts", "missing-run", "records-meta", "story-time"])
def test_malformed_workspace_data_preserves_existing_error_semantics(workspace, defect):
    case = populate(workspace)
    store = workspace.store
    with store._locked():
        dataset = store._load()
        if defect.startswith("incident") or defect == "missing-run":
            legacy_path = "/v1/command/incidents"
            record = store._record(dataset, "command-incident", case["id"])
            if defect == "incident-tasks":
                record["tasks"] = []
            elif defect == "incident-receipts":
                record["_requests"] = []
            else:
                record["runId"] = "missing-run"
            store._record_graph(dataset, "command-incident", record)
        elif defect == "records-meta":
            legacy_path = "/v1/command/records"
            dataset.remove_graph(URIRef(f"urn:citride:graph:{META_KIND}:{META_ID}"))
        else:
            legacy_path = "/v1/command/records"
            meta = store._record(dataset, META_KIND, META_ID)
            meta["storyStartedAt"] = "not-an-iso-date"
            store._record_graph(dataset, META_KIND, meta)
        store._save(dataset)
    before = store.path.read_bytes()
    legacy = workspace.client.get(legacy_path)
    response = workspace.client.get("/v1/workspace")
    assert legacy.status_code == 422
    assert response.status_code == legacy.status_code
    assert response.json() == legacy.json()
    assert store.path.read_bytes() == before


def test_storage_unavailable_uses_existing_generic_error_boundary(workspace, monkeypatch):
    def unavailable():
        raise StorageUnavailableError("Private connection details must stay hidden")
    monkeypatch.setattr(workspace.store, "_load", unavailable)
    response = workspace.client.get("/v1/workspace")
    assert response.status_code == 503
    assert response.json() == {"detail": "Demo storage is temporarily unavailable."}


@pytest.mark.parametrize("authorization", [None, ("demo", "wrong")])
def test_workspace_authentication_precedes_repository_initialization(tmp_path, monkeypatch, authorization):
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", PASSWORD)
    state = tmp_path / "state"
    with TestClient(api.create_app(state)) as client:
        response = client.get("/v1/workspace", auth=authorization)
    assert response.status_code == 401
    assert response.json()["code"] == "login_required"
    assert response.headers["cache-control"] == "no-store"
    assert not state.exists()


def test_workspace_authenticated_response_is_private(workspace, monkeypatch):
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", PASSWORD)
    with TestClient(api.create_app(workspace.store.data_dir, workspace.store.scenario_path)) as client:
        response = client.get("/v1/workspace", auth=("demo", PASSWORD))
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert "Authorization" in response.headers["vary"]


def test_workspace_hosted_auth_missing_fails_closed(tmp_path, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    state = tmp_path / "state"
    with TestClient(api.create_app(state)) as client:
        response = client.get("/v1/workspace")
    assert response.status_code == 503
    assert response.json()["code"] == "auth_not_configured"
    assert not state.exists()


def test_workspace_outputs_are_detached_from_dataset_and_configuration(workspace):
    populate(workspace)
    from citride.workspace import workspace_snapshot
    before = workspace.store.path.read_bytes()
    expected = workspace_snapshot(workspace.store, reset_enabled=True)
    result = workspace_snapshot(workspace.store, reset_enabled=True)
    result["bootstrap"]["entities"].clear()
    result["runs"][0]["id"] = "changed"
    result["incidents"][0]["runSnapshot"]["baselineSnapshot"]["entities"].clear()
    result["records"]["contacts"][0]["sourceRefs"].clear()
    result["records"]["timing"]["storyClock"].clear()
    result["reference"]["responseOptions"].clear()
    result["health"]["status"] = "changed"
    assert workspace_snapshot(workspace.store, reset_enabled=True) == expected
    assert snapshot(workspace) == expected
    assert workspace.store.path.read_bytes() == before


def test_workspace_reload_observes_external_state_and_config_mutations(workspace):
    case = populate(workspace)
    first = snapshot(workspace)
    # Independent repository instance simulates another worker/process writing
    # the same disposable state file; the API instance must reload it.
    external = Repository(workspace.store.data_dir, workspace.store.scenario_path)
    CommandService(external).act(case["id"], {
        "action": "add_note", "note": "External worker update", "expectedVersion": case["version"],
        "clientRequestId": str(uuid4()),
    })
    with external._locked():
        dataset = external._load()
        baseline = external._baseline(dataset)
        baseline["baselineRevision"] += 1
        external._write_baseline(dataset, baseline)
        external._save(dataset)
    records = RecordsService(external)
    contact = deepcopy(first["records"]["contacts"][0])
    contact["note"] = "External record update"
    records.ingest_records({"contacts": [contact]}, "external-test-worker")
    reference_path = workspace.inputs / "reference.json"
    reference = json.loads(reference_path.read_text())
    reference["responseOptions"][0]["label"] = "Updated external reference label"
    reference_path.write_text(json.dumps(reference), encoding="utf-8")
    before = external.path.read_bytes()
    second = snapshot(workspace)
    assert second["bootstrap"]["baselineRevision"] == second["health"]["baselineRevision"] == 2
    assert second["incidents"][0]["version"] == case["version"] + 1
    assert second["incidents"][0]["notes"][-1]["text"] == "External worker update"
    updated = next(row for row in second["records"]["contacts"] if row["id"] == contact["id"])
    assert updated["note"] == "External record update"
    assert second["reference"]["responseOptions"][0]["label"] == "Updated external reference label"
    assert second["incidents"] == workspace.client.get("/v1/command/incidents").json()["incidents"]
    assert second["records"] == workspace.client.get("/v1/command/records").json()
    assert workspace.store.path.read_bytes() == before

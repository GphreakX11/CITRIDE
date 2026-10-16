"""Retirement is a read-time filter, not a destructive historical migration."""
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from citride.api import create_app
from citride.command import CommandService
from citride.storage import InvalidModelError, NotFoundError, Repository

ROOT = Path(__file__).resolve().parents[2]
RETIRED_TYPES = ("ReferenceInvestigation", "PacketCaptureInvestigation")


def create_request(event="event-dosing"):
    return {"eventId": event, "title": "Historical normal case", "priority": "high", "expectedBaselineRevision": 1, "clientRequestId": str(uuid4())}


def insert_retired(store, normal_id, kind):
    with store._locked():
        dataset = store._load()
        record = deepcopy(store._record(dataset, "command-incident", normal_id))
        record["id"] = str(uuid4())
        event = {"id": "retired-reference", "type": kind, "label": "Retired investigation"}
        record.update(eventId=event["id"], eventSnapshot=event, tasks=[{"legacy": True}], _requests={"legacy-receipt": "0" * 64})
        record["contextSnapshot"]["event"] = deepcopy(event)
        store._record_graph(dataset, "command-incident", record)
        store._save(dataset)
        return record["id"]


@pytest.mark.parametrize("kind", RETIRED_TYPES)
def test_retired_records_are_hidden_and_404_without_poisoning_normal_history(tmp_path, kind):
    store = Repository(tmp_path / "state", ROOT / "data/scenario.json")
    service = CommandService(store)
    request = create_request()
    normal = service.create(request)
    retired_id = insert_retired(store, normal["id"], kind)
    original = store.path.read_bytes()
    assert service.list() == [normal]
    assert service.get(normal["id"]) == normal
    assert service.create(request) == normal
    with pytest.raises(NotFoundError):
        service.get(retired_id)
    with pytest.raises(NotFoundError):
        service.act(retired_id, {"action": "add_note", "expectedVersion": 1, "clientRequestId": "retired-action", "note": "No revival"})
    assert store.path.read_bytes() == original
    with TestClient(create_app(store.data_dir, store.scenario_path)) as client:
        assert client.get("/v1/command/incidents").json() == {"incidents": [normal]}
        assert client.get(f"/v1/command/incidents/{retired_id}").status_code == 404
        assert client.post(f"/v1/command/incidents/{retired_id}/actions", json={"action": "add_note", "expectedVersion": 1, "clientRequestId": "retired-action", "note": "No revival"}).status_code == 404
    updated = service.act(normal["id"], {"action": "add_note", "expectedVersion": 1, "clientRequestId": "normal-action", "note": "Normal workflow still works"})
    assert updated["version"] == 2
    assert updated["eventSnapshot"] == normal["eventSnapshot"]
    assert updated["contextSnapshot"] == normal["contextSnapshot"]
    with store._locked():
        assert store._record(store._load(), "command-incident", retired_id)["eventSnapshot"]["type"] == kind
    assert len(CommandService(Repository(store.data_dir, store.scenario_path)).list()) == 1


def test_other_malformed_normal_records_still_fail_closed(tmp_path):
    store = Repository(tmp_path / "state", ROOT / "data/scenario.json")
    service = CommandService(store)
    normal = service.create(create_request())
    with store._locked():
        dataset = store._load()
        record = store._record(dataset, "command-incident", normal["id"])
        record["tasks"] = []
        store._record_graph(dataset, "command-incident", record)
        store._save(dataset)
    with pytest.raises(InvalidModelError):
        service.list()


def test_retired_types_cannot_be_created_even_if_present_in_old_baseline(tmp_path):
    store = Repository(tmp_path / "state", ROOT / "data/scenario.json")
    for kind in RETIRED_TYPES:
        with store._locked():
            dataset = store._load()
            baseline = store._baseline(dataset)
            baseline["events"].append({"id": kind, "type": kind, "label": "Old reference", "sourceRefs": ["src-network"]})
            store._write_baseline(dataset, baseline)
            store._save(dataset)
        with pytest.raises((InvalidModelError, NotFoundError)):
            CommandService(store).create(create_request(kind))
    assert CommandService(store).list() == []


def test_removed_route_and_telemetry_remain_protected_before_storage(tmp_path, monkeypatch):
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", "test-only-password")
    state = tmp_path / "state"
    with TestClient(create_app(state)) as client:
        for path in ("/v1/telemetry", "/v1/reference/pcap", "/v1/command/incidents"):
            assert client.get(path).status_code == 401
        assert not state.exists()
        client.auth = ("demo", "test-only-password")
        assert client.get("/v1/reference/pcap").status_code == 404
        assert "/v1/reference/pcap" not in client.get("/openapi.json").json()["paths"]
        assert client.get("/v1/telemetry").status_code == 200

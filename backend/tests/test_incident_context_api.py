"""Read-only incident context without asserting physical loss."""

from fastapi.testclient import TestClient
import pytest
from citride.api import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "state")) as connection:
        yield connection


def test_context_connects_explicit_records_and_is_read_only(client):
    before = client.get("/v1/bootstrap").json()
    response = client.get("/v1/incident-context", params={"eventId": "event-dosing"})
    assert response.status_code == 200, response.text
    context = response.json()
    assert context["baselineRevision"] == before["baselineRevision"]
    for field, expected in [("cyberAsset", "cyber-plc-a"), ("physicalAsset", "plc-a"), ("facility", "plant-a"), ("provider", "utility-a"), ("serviceArea", "area-a")]:
        assert context[field]["id"] == expected
    assert {item["dependent"]["id"] for item in context["downstreamDependencies"]} == {"dialysis-x", "hospital-y", "nursing-z", "fire-f"}
    assert [item["id"] for item in context["scenarios"]] == ["unsafe-water"]
    assert context["sourceRefs"]
    assert client.get("/v1/bootstrap").json() == before
    assert client.get("/v1/cascade-runs").json()["runs"] == []


@pytest.mark.parametrize("event_id,provider", [("event-probe-b", "utility-b"), ("event-probe-c", "utility-c")])
def test_probes_do_not_create_consequences(client, event_id, provider):
    response = client.get("/v1/incident-context", params={"eventId": event_id})
    assert response.status_code == 200
    context = response.json()
    assert context["provider"]["id"] == provider
    assert context["scenarios"] == []
    assert context["downstreamDependencies"] == []


def test_missing_event_and_invalid_identifier(client):
    assert client.get("/v1/incident-context", params={"eventId": "absent"}).status_code == 404
    for identifier in ["", "../event-dosing", "bad id"]:
        assert client.get("/v1/incident-context", params={"eventId": identifier}).status_code == 422

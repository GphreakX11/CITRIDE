from uuid import uuid4
from fastapi.testclient import TestClient
from citride.api import create_app
from citride.pcap_reference import PCAP_EVENT_ID, get_pcap


def test_capture_metadata_is_real_detached_and_redacted():
    evidence = get_pcap()
    assert evidence["capture"]["packet_count"] == 904
    assert evidence["tcpFlowCount"] == 96
    assert len(evidence["observations"]) == 33
    assert (
        evidence["source"]["sha256"]
        == "fc7211eb3d6c9e87267e79fd52d157bc003b3d44e9a95cd1f7e32c7d47537e45"
    )
    assert "Vendor VPN authentication" in evidence["notEstablished"]
    assert all(
        set(row)
        == {
            "id",
            "packet",
            "timeUtc",
            "kind",
            "source",
            "destination",
            "summary",
            "detail",
            "boundary",
        }
        for row in evidence["observations"]
    )
    evidence["facts"].append("mutation")
    assert "mutation" not in get_pcap()["facts"]


def test_capture_case_survives_restart_without_model_mutation(tmp_path):
    client = TestClient(create_app(tmp_path))
    baseline = client.get("/v1/bootstrap").json()
    request = {
        "eventId": PCAP_EVENT_ID,
        "title": "Packet-backed demo review",
        "priority": "high",
        "expectedBaselineRevision": baseline["baselineRevision"],
        "clientRequestId": str(uuid4()),
    }
    reply = client.post("/v1/command/incidents", json=request)
    assert reply.status_code == 201, reply.text
    record = reply.json()
    assert record["contextSnapshot"]["scenarios"] == []
    assert record["contextSnapshot"]["provider"] is None
    assert len(record["tasks"]) == 3
    assert record["runSnapshot"] is None
    assert all(not t["completed"] for t in record["tasks"])
    assert client.get("/v1/bootstrap").json() == baseline
    restart = TestClient(create_app(tmp_path))
    assert restart.get("/v1/command/incidents/" + record["id"]).json() == record
    duplicate = restart.post("/v1/command/incidents", json=request)
    assert duplicate.status_code in (200, 201)
    assert duplicate.json() == record
    assert restart.get("/v1/bootstrap").json() == baseline


def test_capture_routes_share_existing_hosted_auth(tmp_path, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", "test-only-fake-password")
    client = TestClient(create_app(tmp_path))
    assert client.get("/v1/reference/pcap").status_code == 401
    assert client.get("/v1/reference/idt").status_code == 401
    assert (
        client.get(
            "/v1/reference/pcap", auth=("demo", "test-only-fake-password")
        ).status_code
        == 200
    )

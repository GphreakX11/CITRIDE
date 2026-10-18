import uuid
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from citride.api import create_app
from citride.storage import Repository
from citride.command import CommandService

ROOT = Path(__file__).resolve().parents[2]


def open_case(client, event="event-vpn-a"):
    b = client.get("/v1/bootstrap").json()
    r = client.post(
        "/v1/command/incidents",
        json={
            "eventId": event,
            "title": "PM integration test",
            "priority": "high",
            "expectedBaselineRevision": b["baselineRevision"],
            "clientRequestId": str(uuid.uuid4()),
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_real_routes_seed_six_then_link_existing_and_reset(tmp_path):
    client = TestClient(create_app(data_dir=tmp_path))
    r = client.get("/v1/command/records")
    assert r.status_code == 200, r.text
    assert len(r.json()["statewideIncidents"]) == 6
    before_ids = {row["id"] for row in r.json()["statewideIncidents"]}
    assert "INC-2026-1002-POH" in before_ids
    preliminary = client.get("/v1/cascade-runs").json()["runs"]
    assert len(preliminary) == 2
    assert all(run["id"].startswith("preliminary-") for run in preliminary)
    assert "storyNow" in client.get("/health").json()
    ref = client.get("/v1/reference")
    assert ref.status_code == 200
    assert ref.json()["responseOptions"][0]["id"] == "opt-tdem-health-notice"
    case = open_case(client)
    state = client.get("/v1/command/records").json()
    assert {row["id"] for row in state["statewideIncidents"]} == before_ids
    assert client.get("/v1/cascade-runs").json()["runs"] == preliminary
    linked = next(r for r in state["statewideIncidents"] if r["id"] == "TX-26-0412")
    assert linked["caseId"] == case["id"] and linked["status"] == case["status"]
    task = next(t for t in state["responseTasks"] if t["id"] == "task-util-b-reset")
    assert task["late"] and task["status"] == "not_started"
    body = {
        "action": "set_task_status",
        "taskId": task["id"],
        "status": "done",
        "expectedVersion": case["version"],
        "clientRequestId": str(uuid.uuid4()),
    }
    a = client.post("/v1/command/incidents/" + case["id"] + "/actions", json=body)
    assert a.status_code == 200, a.text
    for replay in [body, body]:
        assert (
            client.post(
                "/v1/command/incidents/" + case["id"] + "/actions", json=replay
            ).status_code
            == 200
        )
    actual = next(
        t
        for t in client.get("/v1/command/records").json()["responseTasks"]
        if t["id"] == task["id"]
    )
    assert (
        actual["status"] == "done"
        and actual["history"]
        and actual["origin"] == "scripted"
    )
    reset = {
        "expectedBaselineRevision": client.get("/v1/bootstrap").json()[
            "baselineRevision"
        ],
        "clientRequestId": str(uuid.uuid4()),
        "confirm": "RESET DEMO",
    }
    assert client.post("/v1/demo/reset", json=reset).status_code == 200
    assert client.post("/v1/demo/reset", json=reset).status_code == 200
    assert {row["id"] for row in client.get("/v1/command/records").json()["statewideIncidents"]} == before_ids
    case = open_case(client)
    state = client.get("/v1/command/records").json()
    assert (
        next(t for t in state["responseTasks"] if t["id"] == task["id"])["status"]
        == "not_started"
    )
    assert all(t["origin"] == "scripted" for t in state["responseTasks"])


@pytest.mark.parametrize(
    "action,fields,collection,key",
    [
        (
            "record_assessment",
            {
                "subject": "attribution",
                "cluster": "Changed cluster",
                "actorLabel": "Changed placeholder",
                "confidence": "low",
                "note": "Recorded test assessment",
            },
            "assessments",
            "actorLabel",
        ),
        (
            "set_asset_status",
            {"entityId": "plc-a", "status": "suspected", "note": "Changed detail"},
            "assetStatuses",
            "detail",
        ),
        (
            "record_hunt",
            {
                "huntId": "hunt-1-vendor-account",
                "status": "done",
                "resultNote": "Changed result",
            },
            "hunts",
            "resultNote",
        ),
        (
            "set_contact_status",
            {
                "contactId": "contact-1",
                "status": "engaged",
                "note": "Changed contact note",
            },
            "contacts",
            "note",
        ),
        (
            "record_decision",
            {
                "optionId": "opt-isao-advisory",
                "decision": "deferred",
                "decidedBy": "Test role",
                "note": "Changed decision",
            },
            "decisions",
            "decision",
        ),
        (
            "set_team_status",
            {
                "teamId": "team-ciru-alpha",
                "status": "on_site",
                "people": {"onSite": 4, "remote": 0, "traveling": 0, "standby": 0},
                "locationLabel": "Updated location",
                "updateText": "Updated team text",
            },
            "teams",
            "locationLabel",
        ),
        (
            "add_task",
            {
                "label": "Added task",
                "teamId": "team-rsoc",
                "ownerRole": "Test role",
                "dueAt": "2026-10-13T10:00:00Z",
            },
            "responseTasks",
            "label",
        ),
    ],
)
def test_all_new_actions_write_through_and_append_history(
    tmp_path, action, fields, collection, key
):
    client = TestClient(create_app(data_dir=tmp_path))
    case = open_case(client)
    payload = {
        "action": action,
        **fields,
        "expectedVersion": case["version"],
        "clientRequestId": str(uuid.uuid4()),
    }
    r = client.post("/v1/command/incidents/" + case["id"] + "/actions", json=payload)
    assert r.status_code == 200, r.text
    records = client.get("/v1/command/records?incidentId=" + case["id"]).json()[
        collection
    ]
    expected = fields.get(key, fields.get("note"))
    changed = next(r for r in records if r.get(key) == expected)
    assert changed["history"][-1]["who"] and changed["history"][-1]["when"]
    assert r.json()["version"] == case["version"] + 1


def test_failed_save_rolls_back_case_and_record_changes(tmp_path, monkeypatch):
    from citride.records import RecordsService

    store = Repository(tmp_path, ROOT / "data/scenario.json")
    service = CommandService(store)
    case = service.create(
        {
            "eventId": "event-vpn-a",
            "title": "Rollback fixture",
            "priority": "high",
            "expectedBaselineRevision": 1,
            "clientRequestId": str(uuid.uuid4()),
        }
    )
    before = store.path.read_bytes()

    def fail(_dataset):
        raise OSError("Synthetic atomic save rejection")

    monkeypatch.setattr(store, "_save", fail)
    with pytest.raises(OSError):
        service.act(
            case["id"],
            {
                "action": "set_asset_status",
                "entityId": "plc-a",
                "status": "normal",
                "note": "Must not persist",
                "expectedVersion": 1,
                "clientRequestId": str(uuid.uuid4()),
            },
        )
    assert store.path.read_bytes() == before and service.get(case["id"])["version"] == 1
    assert (
        next(
            r
            for r in RecordsService(store).records()["assetStatuses"]
            if r["entityId"] == "plc-a"
        )["status"]
        == "confirmed"
    )

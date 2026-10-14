"""Command HTTP contracts, pre-parse access guards and durable local workflow."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from citride.api import create_app
from citride.storage import StorageUnavailableError

PREFIX = "/v1/command/incidents"
PASSWORD = (
    # Dummy HTTP fixture; never a real account credential.
    "test-only-command-password"
)


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in (
        "VERCEL",
        "VERCEL_ENV",
        "CITRIDE_DATABASE_URL",
        "DATABASE_URL",
        "CITRIDE_STATE_KEY",
        "CITRIDE_DEMO_USERNAME",
        "CITRIDE_DEMO_PASSWORD",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", PASSWORD)
    with TestClient(create_app(tmp_path / "state")) as connection:
        connection.auth = ("demo", PASSWORD)
        yield connection


def creation(**changes):
    return {
        "eventId": "event-dosing",
        "title": "Source review",
        "priority": "high",
        "expectedBaselineRevision": 1,
        "clientRequestId": str(uuid4()),
        **changes,
    }


def action(case, kind="add_note", **fields):
    return {
        "action": kind,
        "expectedVersion": case["version"],
        "clientRequestId": str(uuid4()),
        **fields,
    }


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", PREFIX),
        ("POST", PREFIX),
        ("GET", PREFIX + "/missing"),
        ("POST", PREFIX + "/missing/actions"),
    ],
)
def test_all_command_routes_authenticate_before_storage_or_body_parsing(
    tmp_path, monkeypatch, method, path
):
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", PASSWORD)
    state = tmp_path / "state"
    with TestClient(create_app(state)) as connection:
        response = connection.request(method, path, content="invalid-json")
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    assert not state.exists()


@pytest.mark.parametrize(
    "path", [PREFIX, PREFIX + "/missing", PREFIX + "/missing/actions"]
)
def test_hosted_missing_authentication_fails_closed_without_state(
    tmp_path, monkeypatch, path
):
    monkeypatch.setenv("VERCEL", "1")
    state = tmp_path / "state"
    with TestClient(create_app(state)) as connection:
        response = connection.post(path, json={})
    assert response.status_code == 503
    assert response.json()["code"] == "auth_not_configured"
    assert not state.exists()


@pytest.mark.parametrize("path", [PREFIX, PREFIX + "/missing/actions"])
@pytest.mark.parametrize(
    "origin", ["null", "https://outside.example", "http://testserver/path"]
)
def test_command_mutations_reject_cross_origin_before_parsing(
    tmp_path, monkeypatch, path, origin
):
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", PASSWORD)
    state = tmp_path / "state"
    with TestClient(create_app(state)) as connection:
        connection.auth = ("demo", PASSWORD)
        response = connection.post(
            path, content="invalid-json", headers={"Origin": origin}
        )
    assert response.status_code == 403
    assert not state.exists()


@pytest.mark.parametrize(
    "changes",
    [
        {"authorityBasis": "approved"},
        {"priority": "GO"},
        {"title": " "},
        {"expectedBaselineRevision": True},
        {"clientRequestId": "../unsafe"},
    ],
)
def test_create_strict_validation_does_not_persist(client, changes):
    assert client.post(PREFIX, json=creation(**changes)).status_code == 422
    assert client.get(PREFIX).json() == {"incidents": []}


@pytest.mark.parametrize(
    "kind,fields",
    [
        ("dispatch", {"note": "No authority"}),
        ("review_decision", {"decisionId": "missing", "note": " "}),
        ("set_task", {"taskId": "missing", "completed": 1}),
        ("analyze", {"scenarioId": "unsafe-water", "evaluationHour": True}),
        (
            "analyze",
            {"scenarioId": "unsafe-water", "evaluationHour": 13, "horizonHours": 12},
        ),
        ("add_note", {"note": "Private text", "actor": "operator"}),
    ],
)
def test_action_strict_validation_does_not_change_case(client, kind, fields):
    case = client.post(PREFIX, json=creation()).json()
    response = client.post(
        f"{PREFIX}/{case['id']}/actions", json=action(case, kind, **fields)
    )
    assert response.status_code == 422
    assert all(
        set(issue) <= {"type", "loc", "msg"} for issue in response.json()["detail"]
    )
    assert "Private text" not in response.text
    assert client.get(f"{PREFIX}/{case['id']}").json() == case
    assert client.get("/v1/cascade-runs").json() == {"runs": []}


def test_complete_http_workflow_replay_conflicts_and_restart(client, tmp_path):
    baseline = client.get("/v1/bootstrap").json()
    old = client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"}).json()
    request = creation()
    created = client.post(PREFIX, json=request, headers={"Origin": "http://testserver"})
    assert created.status_code == 201
    assert created.headers["cache-control"] == "private, no-store"
    assert "Authorization" in created.headers["vary"]
    case = created.json()
    assert "_requests" not in case
    path = f"{PREFIX}/{case['id']}"
    analysis = action(
        case, "analyze", scenarioId="unsafe-water"
    )  # HTTP defaults must be persisted.
    response = client.post(path + "/actions", json=analysis)
    assert response.status_code == 200, response.text
    case = response.json()
    assert {d["entityId"]: d["windowHours"] for d in case["decisions"]} == {
        "dialysis-x": [2, 4],
        "hospital-y": [4, 8],
        "nursing-z": [1, 4],
    }
    assert (
        client.post(
            path + "/actions",
            json=action(case, "set_status", status="closed", note="Tracking only"),
        ).status_code
        == 409
    )
    for task in case["tasks"]:
        response = client.post(
            path + "/actions",
            json=action(case, "set_task", taskId=task["id"], completed=True),
        )
        assert response.status_code == 200
        case = response.json()
    for decision in case["decisions"]:
        response = client.post(
            path + "/actions",
            json=action(
                case,
                "review_decision",
                decisionId=decision["id"],
                note="Local review; not authorization",
            ),
        )
        assert response.status_code == 200
        case = response.json()
    note = action(case, note="Coordination recorded locally; not sent")
    case = client.post(path + "/actions", json=note).json()
    assert (
        client.post(
            path + "/actions", json=action({**case, "version": 1}, note="Stale")
        ).status_code
        == 409
    )
    close = action(
        case,
        "set_status",
        status="closed",
        note="Tracking complete; no recovery asserted",
    )
    response = client.post(path + "/actions", json=close)
    assert response.status_code == 200
    closed = response.json()
    assert client.post(PREFIX, json=request).json() == closed
    assert client.post(path + "/actions", json=analysis).json() == closed
    assert (
        client.post(
            path + "/actions", json={**note, "note": "Changed payload"}
        ).status_code
        == 409
    )
    with TestClient(create_app(tmp_path / "state")) as fresh:
        fresh.auth = ("demo", PASSWORD)
        assert fresh.get(path).json() == closed
        assert fresh.post(path + "/actions", json=close).json() == closed
        reopened = fresh.post(
            path + "/actions",
            json=action(
                closed, "set_status", status="open", note="Explicit tracking reopen"
            ),
        )
        assert reopened.status_code == 200
        assert reopened.json()["closedAt"] is None
        assert fresh.get("/v1/bootstrap").json() == baseline
        assert fresh.get(f"/v1/cascade-runs/{old['id']}").json() == old
        assert len(fresh.get("/v1/cascade-runs").json()["runs"]) == 2


def test_not_found_invalid_id_and_probe_scope(client):
    assert client.get(PREFIX + "/missing").status_code == 404
    assert client.get(PREFIX + "/invalid!identifier").status_code == 422
    case = client.post(PREFIX, json=creation(eventId="event-probe-b")).json()
    path = f"{PREFIX}/{case['id']}"
    response = client.post(
        path + "/actions", json=action(case, "analyze", scenarioId="unsafe-water")
    )
    assert response.status_code == 422
    assert client.get(path).json() == case
    assert client.get("/v1/cascade-runs").json()["runs"] == []


def test_command_storage_outage_returns_only_safe_error(client, monkeypatch):
    def unavailable(_self):
        raise StorageUnavailableError("private database details")

    monkeypatch.setattr("citride.storage.Repository._load", unavailable)
    response = client.get(PREFIX)
    assert response.status_code == 503
    assert response.json() == {"detail": "Demo storage is temporarily unavailable."}
    assert "private database" not in response.text

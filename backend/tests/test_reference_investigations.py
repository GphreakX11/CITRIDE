"""Reference imports stay case-local and preserve existing durable casework."""

from copy import deepcopy
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from citride.api import create_app
from citride.command import CommandService
from citride.storage import Repository, ConflictError, InvalidModelError

ROOT = Path(__file__).resolve().parents[2]
EVENT = "reference:waterutil-fuel-v2"
PREFIX = "/v1/command/incidents"


def request(event=EVENT, **changes):
    return {
        "eventId": event,
        "title": "Water utility / fuel terminal compromise — source review",
        "priority": "high",
        "expectedBaselineRevision": 1,
        "clientRequestId": str(uuid4()),
        **changes,
    }


@pytest.fixture
def repo(tmp_path):
    return Repository(tmp_path / "state", ROOT / "data/scenario.json")


def test_reference_create_read_restart_preserves_baseline_runs_and_regular_cases(repo):
    svc = CommandService(repo)
    regular = svc.create(request("event-dosing"))
    before, runs = repo.baseline(), repo.runs()
    payload = request()
    case = svc.create(payload)
    assert svc.create(payload) == case
    assert svc.get(case["id"]) == case
    assert repo.baseline() == before and repo.runs() == runs
    assert svc.get(regular["id"]) == regular
    assert len(case["tasks"]) == 8 and all(not t["completed"] for t in case["tasks"])
    assert case["runId"] is None and case["decisions"] == []
    context = case["contextSnapshot"]
    assert context["scenarios"] == context["downstreamDependencies"] == []
    assert all(
        context[k] is None
        for k in ("cyberAsset", "physicalAsset", "facility", "provider", "serviceArea")
    )
    manifest = case["eventSnapshot"]["referenceInvestigation"]
    assert len(manifest["assets"]) == 16 and len(manifest["timeline"]) == 14
    assert manifest["source"]["pcapProvided"] is False
    assert manifest["capture"]["verified"] is False
    assert all(p["verification"] == "report_only" for p in manifest["timeline"])
    assert all(a["scope"] == "case_local_reference" for a in manifest["assets"])
    assert "sk_live_" not in json.dumps(manifest)
    task = case["tasks"][0]
    changed = svc.act(
        case["id"],
        {
            "action": "set_task",
            "taskId": task["id"],
            "completed": True,
            "expectedVersion": case["version"],
            "clientRequestId": str(uuid4()),
        },
    )
    restarted = CommandService(Repository(repo.data_dir, ROOT / "data/scenario.json"))
    assert restarted.get(case["id"]) == changed
    assert changed["tasks"][0]["completed"] and changed["tasks"][0]["completedAt"]
    assert restarted.get(regular["id"]) == regular
    assert repo.baseline() == before and repo.runs() == runs


def test_reference_uniqueness_revision_and_no_analysis(repo):
    svc = CommandService(repo)
    with pytest.raises(ConflictError):
        svc.create(request(expectedBaselineRevision=2))
    case = svc.create(request())
    with pytest.raises(ConflictError):
        svc.create(request())
    with pytest.raises(InvalidModelError):
        svc.act(
            case["id"],
            {
                "action": "analyze",
                "scenarioId": "unsafe-water",
                "evaluationHour": 1,
                "horizonHours": 12,
                "expectedVersion": 1,
                "clientRequestId": str(uuid4()),
            },
        )
    assert svc.get(case["id"]) == case and repo.runs() == []


@pytest.mark.parametrize("change", ["asset", "tasks", "context", "source", "run"])
def test_reference_corruption_is_rejected(repo, change):
    svc = CommandService(repo)
    case = svc.create(request())
    baseline = repo.baseline()
    with repo._locked():
        dataset = repo._load()
        row = repo._record(dataset, "command-incident", case["id"])
        if change == "asset":
            row["eventSnapshot"]["referenceInvestigation"]["assets"][0]["ip"] = (
                "10.9.9.9"
            )
        elif change == "tasks":
            row["tasks"][0]["label"] = "Dispatch containment"
        elif change == "context":
            row["contextSnapshot"]["provider"] = deepcopy(baseline["entities"][0])
        elif change == "source":
            row["eventSnapshot"]["referenceInvestigation"]["source"]["pcapProvided"] = (
                True
            )
        else:
            row["runId"] = "invented-run"
        if change in ("asset", "source"):
            row["contextSnapshot"]["event"] = deepcopy(row["eventSnapshot"])
        repo._record_graph(dataset, "command-incident", row)
        repo._save(dataset)
    with pytest.raises(InvalidModelError):
        svc.get(case["id"])


def test_reference_save_failure_rolls_back(repo, monkeypatch):
    svc = CommandService(repo)
    before = repo.baseline()

    def fail(_dataset):
        raise OSError("isolated save failure")

    monkeypatch.setattr(repo, "_save", fail)
    with pytest.raises(OSError):
        svc.create(request())
    assert svc.list() == [] and repo.baseline() == before


def test_reference_http_contract_no_new_write_endpoint(tmp_path, monkeypatch):
    for key in (
        "VERCEL",
        "DATABASE_URL",
        "CITRIDE_DATABASE_URL",
        "CITRIDE_DEMO_PASSWORD",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", "isolated-reference-password")
    with TestClient(create_app(tmp_path / "http-state")) as client:
        assert client.post(PREFIX, json=request()).status_code == 401
        client.auth = ("demo", "isolated-reference-password")
        before = client.get("/v1/bootstrap").json()
        payload = request()
        response = client.post(PREFIX, json=payload)
        assert response.status_code == 201
        assert "no-store" in response.headers["cache-control"]
        case = response.json()
        assert client.post(PREFIX, json=payload).json() == case
        assert client.get(PREFIX + "/" + case["id"]).json() == case
        assert client.get("/v1/bootstrap").json() == before
        assert client.post(PREFIX, json=request("reference:missing")).status_code == 422
        assert (
            client.post(PREFIX, json=request(referenceInvestigation={})).status_code
            == 422
        )

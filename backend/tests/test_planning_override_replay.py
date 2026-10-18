"""Submitted planning inputs, not derived run output, identify retries."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from rdflib import URIRef

from citride.api import create_app
from citride.engine import compute_run
from citride.storage import ConflictError, NS, Repository

SCENARIO = Path(__file__).resolve().parents[2] / "data" / "scenario.json"


def submitted_request():
    return {
        "scenarioId": "unsafe-water",
        "evaluationHour": 1,
        "horizonHours": 12,
        "expectedBaselineRevision": 1,
        "clientRequestId": "override-retry",
        "overrides": [{
            "dependencyId": "dep-a-x",
            "backupMinHours": 6,
            "backupMaxHours": 8,
            "note": "  Analyst assumes extra clean reserve.  ",
        }],
    }


def repository_request():
    body = submitted_request()
    body.pop("expectedBaselineRevision")
    return body


def history_entry(run):
    return {key: run[key] for key in ("id", "createdAt", "scenarioId", "baselineRevision")}


def assert_runs(actual, expected):
    """Retain every seeded analysis while checking exact retry cardinality/payload."""
    assert sorted(actual, key=lambda run: run['id']) == sorted(expected, key=lambda run: run['id'])


def test_override_replays_original_post_after_restart_and_baseline_change(tmp_path):
    state = tmp_path / "state"
    body = submitted_request()
    original = deepcopy(body)
    with TestClient(create_app(state)) as client:
        initial = client.get('/v1/runs').json()
        first = client.post("/v1/runs", json=body)
        assert first.status_code == 201, first.text
        saved = first.json()
        override = saved["request"]["overrides"][0]
        assert override["note"] == body["overrides"][0]["note"].strip()
        assert override["sourceRef"] == saved["overrideSources"][0]["id"]
        assert saved["request"]["clientRequestId"] == body["clientRequestId"]
        assert not any("fingerprint" in key.lower() for key in saved)
        assert client.post("/v1/runs", json=body).json() == saved
        # Replay must precede the current-baseline fence, even after restart.
        baseline = client.get("/v1/bootstrap").json()
        dependency = deepcopy(next(d for d in baseline["dependencies"] if d["id"] == "dep-a-x"))
        proposal = client.post("/v1/dependency-proposals", json={
            "dependency": dependency, "expectedBaselineRevision": 1,
        })
        assert proposal.status_code == 201, proposal.text
        promoted = client.post(f"/v1/dependency-proposals/{proposal.json()['id']}/promote")
        assert promoted.status_code == 200, promoted.text
        assert promoted.json()["baselineRevision"] == 2
    with TestClient(create_app(state)) as restarted:
        replay = restarted.post("/v1/runs", json=body)
        assert replay.status_code == 201, replay.text
        assert replay.json() == saved
        assert_runs(restarted.get("/v1/runs").json(), initial + [history_entry(saved)])
        assert restarted.get(f"/v1/runs/{saved['id']}").json() == saved
    assert body == original


@pytest.mark.parametrize("change", ["note", "whitespace", "reserve", "revision", "omitted-revision"])
def test_changed_override_input_conflicts_without_changing_capture(tmp_path, change):
    body = submitted_request()
    with TestClient(create_app(tmp_path / "state")) as client:
        initial = client.get('/v1/runs').json()
        first = client.post("/v1/runs", json=body)
        assert first.status_code == 201, first.text
        changed = deepcopy(body)
        if change == "note":
            changed["overrides"][0]["note"] = "A different analyst assumption."
        elif change == "whitespace":
            # Exact submitted strings matter, despite engine-side trimming.
            changed["overrides"][0]["note"] = changed["overrides"][0]["note"].strip()
        elif change == "reserve":
            changed["overrides"][0]["backupMaxHours"] = 9
        elif change == "revision":
            changed["expectedBaselineRevision"] = 2
        else:
            changed.pop("expectedBaselineRevision")
        conflict = client.post("/v1/runs", json=changed)
        assert conflict.status_code == 409, conflict.text
        replay = client.post("/v1/runs", json=body)
        assert replay.status_code == 201, replay.text
        assert replay.json() == first.json()
        assert_runs(client.get("/v1/runs").json(), initial + [history_entry(first.json())])


def test_concurrent_override_retries_across_repositories_save_one_run(tmp_path):
    state = tmp_path / "state"
    with TestClient(create_app(state)) as left, TestClient(create_app(state)) as right:
        assert left.get("/v1/bootstrap").status_code == 200
        assert right.get("/v1/bootstrap").status_code == 200
        initial = left.get('/v1/runs').json()
        body = submitted_request()
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(
                lambda client: client.post("/v1/runs", json=body),
                [left, right, left, right],
            ))
        assert all(r.status_code == 201 for r in responses), [r.text for r in responses]
        assert all(r.json() == responses[0].json() for r in responses)
        assert_runs(left.get("/v1/runs").json(), initial + [history_entry(responses[0].json())])


def test_input_is_not_mutated_and_internal_source_ref_remains_part_of_identity(tmp_path):
    repository = Repository(tmp_path / "state", SCENARIO)
    initial = repository.runs()
    request = repository_request()
    # HTTP forbids this field, but repository callers may supply it. Do not
    # erase it from request identity just because the engine derives its own.
    request["overrides"][0]["sourceRef"] = "urn:submitted:analyst-source"
    original = deepcopy(request)
    first = repository.create_run(request, compute_run, 1)
    assert request == original
    assert first["request"]["overrides"][0]["sourceRef"] != request["overrides"][0]["sourceRef"]
    no_compute = Mock(side_effect=AssertionError("replay must not recompute"))
    restarted = Repository(tmp_path / "state", SCENARIO)
    assert restarted.create_run(dict(reversed(list(request.items()))), no_compute, 1) == first
    changed = deepcopy(request)
    changed["overrides"][0]["sourceRef"] = "urn:submitted:different-source"
    with pytest.raises(ConflictError):
        restarted.create_run(changed, no_compute, 1)
    no_compute.assert_not_called()
    assert_runs(restarted.runs(), initial + [first])


def test_api_continues_to_reject_submitted_source_ref(tmp_path):
    body = submitted_request()
    body["overrides"][0]["sourceRef"] = "urn:submitted:analyst-source"
    with TestClient(create_app(tmp_path / "state")) as client:
        initial = client.get('/v1/runs').json()
        assert client.post("/v1/runs", json=body).status_code == 422
        assert_runs(client.get("/v1/runs").json(), initial)


@pytest.mark.parametrize("overrides", [True, False])
def test_legacy_records_are_not_recomputed_or_rewritten(tmp_path, overrides):
    repository = Repository(tmp_path / "state", SCENARIO)
    request = repository_request()
    if not overrides:
        request["overrides"] = []
    first = repository.create_run(request, compute_run, 1)
    # Reproduce the pre-fingerprint format, retaining its exact public payload.
    with repository._locked():
        dataset = repository._load()
        repository._record_graph(dataset, "run", first)
        repository._save(dataset)
    before = repository.path.read_bytes()
    restarted = Repository(tmp_path / "state", SCENARIO)
    no_compute = Mock(side_effect=AssertionError("legacy capture must not be recomputed"))
    if overrides:
        with pytest.raises(ConflictError, match="[Ll]egacy"):
            restarted.create_run(request, no_compute, 1)
    else:
        assert restarted.create_run(request, no_compute, 1) == first
    assert restarted.path.read_bytes() == before
    assert restarted.run(first["id"]) == first
    no_compute.assert_not_called()


def test_failed_save_rolls_back_run_and_receipt_then_allows_retry(tmp_path, monkeypatch):
    repository = Repository(tmp_path / "state", SCENARIO)
    initial = repository.runs()
    request = repository_request()
    before = repository.path.read_bytes()
    with monkeypatch.context() as patch:
        patch.setattr(repository, "_save", Mock(side_effect=OSError("failed atomic write")))
        with pytest.raises(OSError, match="failed atomic write"):
            repository.create_run(request, compute_run, 1)
    assert repository.path.read_bytes() == before
    assert_runs(repository.runs(), initial)
    assert not list(repository._load().quads((None, NS.submittedRequestFingerprint, None, None)))
    first = repository.create_run(request, compute_run, 1)
    assert repository.create_run(request, compute_run, 1) == first
    assert_runs(repository.runs(), initial + [first])
    # Receipt is graph metadata, never a public Run extra.
    graph = repository._load().graph(URIRef(f"urn:citride:graph:run:{first['id']}"))
    assert len(list(graph.triples((None, NS.submittedRequestFingerprint, None)))) == 1
    assert "submittedRequestFingerprint" not in first


def test_compute_failure_does_not_reserve_request_identity(tmp_path):
    repository = Repository(tmp_path / "state", SCENARIO)
    initial = repository.runs()
    request = repository_request()
    with pytest.raises(ValueError, match="failed computation"):
        repository.create_run(request, Mock(side_effect=ValueError("failed computation")), 1)
    assert_runs(repository.runs(), initial)
    first = repository.create_run(request, compute_run, 1)
    assert repository.create_run(request, compute_run, 1) == first

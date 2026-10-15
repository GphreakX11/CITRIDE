"""Stage checks the current baseline before creating or saving any draft."""

from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from citride.api import create_app
from citride.postgres import PostgresRepository
from citride.storage import ConflictError, InvalidModelError, Repository

FIXTURE = Path(__file__).resolve().parents[2] / "data" / "scenario.json"


@pytest.fixture(params=["local", "postgres-shared"])
def store(request, tmp_path, monkeypatch):
    local = Repository(tmp_path / "state", FIXTURE)
    if request.param == "local":
        return local
    # Exercise the actual inherited method and Postgres load/save/transaction
    # path against an isolated connection double, not a live database claim.
    row = {"nquads": local.path.read_text(), "writes": 0}

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        @contextmanager
        def transaction(self):
            yield

        def execute(self, sql, params=None):
            if sql.lstrip().startswith("SELECT nquads"):
                return SimpleNamespace(fetchone=lambda: (row["nquads"],))
            if sql.lstrip().startswith("UPDATE citride_state"):
                assert params is not None
                row["nquads"] = params[0]
                row["writes"] += 1
                return SimpleNamespace(rowcount=1)
            return SimpleNamespace(rowcount=0)

    monkeypatch.setattr("citride.postgres.psycopg.connect", lambda *a, **kw: Connection())
    repository = PostgresRepository("postgresql://unused", FIXTURE, "stage-test")
    assert PostgresRepository.create_proposal is Repository.create_proposal
    return repository


@pytest.mark.parametrize("revision", [0, 2])
def test_stale_or_future_stage_rejected_before_mutation(store, monkeypatch, revision):
    baseline = store.baseline()
    before = set(store.export().splitlines())
    durable_before = store.path.read_bytes() if hasattr(store, "path") else None
    save = Mock(side_effect=AssertionError("Rejected stage must not save"))
    record = Mock(side_effect=AssertionError("Rejected stage must not create a graph"))
    monkeypatch.setattr(store, "_save", save)
    monkeypatch.setattr(store, "_record_graph", record)

    with pytest.raises(ConflictError, match="Baseline revision changed"):
        store.create_proposal(deepcopy(baseline["dependencies"][0]), revision)

    save.assert_not_called()
    record.assert_not_called()
    assert store.proposals() == []
    assert store.baseline() == baseline
    assert set(store.export().splitlines()) == before
    if durable_before is not None:
        assert store.path.read_bytes() == durable_before


def test_fresh_stage_persists_detached_draft_without_changing_baseline(store):
    baseline = store.baseline()
    dependency = deepcopy(baseline["dependencies"][0])
    proposal = store.create_proposal(dependency, baseline["baselineRevision"])
    assert proposal["status"] == "draft"
    assert proposal["expectedBaselineRevision"] == baseline["baselineRevision"]
    dependency["assumptionNote"] = "Changed only in caller"
    assert store.proposal(proposal["id"]) == proposal
    assert store.baseline() == baseline
    assert len(store.proposals()) == 1


def test_stage_still_allows_invalid_domain_draft_for_validation(store):
    baseline = store.baseline()
    dependency = deepcopy(baseline["dependencies"][0])
    dependency["provider"] = "missing-provider"
    proposal = store.create_proposal(dependency, baseline["baselineRevision"])
    assert not store.validate_proposal(proposal["id"])["valid"]
    with pytest.raises(InvalidModelError, match="validation failed"):
        store.promote(proposal["id"])
    assert store.baseline() == baseline


def test_http_stale_stage_is_409_no_write_then_restage_succeeds(tmp_path):
    with TestClient(create_app(tmp_path / "http-state")) as client:
        baseline = client.get("/v1/bootstrap").json()
        dependency = deepcopy(baseline["dependencies"][0])
        body = {"dependency": dependency, "expectedBaselineRevision": 1}
        staged = client.post("/v1/dependency-proposals", json=body)
        assert staged.status_code == 201
        assert client.post(f"/v1/dependency-proposals/{staged.json()['id']}/promote").status_code == 200
        path = tmp_path / "http-state" / "citride.nq"
        before = path.read_bytes()
        proposals = client.get("/v1/dependency-proposals").json()
        rejected = client.post("/v1/dependency-proposals", json=body)
        assert rejected.status_code == 409
        assert "Baseline revision changed" in rejected.json()["detail"]
        assert path.read_bytes() == before
        assert client.get("/v1/dependency-proposals").json() == proposals
        current = client.get("/v1/bootstrap").json()
        body["expectedBaselineRevision"] = current["baselineRevision"]
        fresh = client.post("/v1/dependency-proposals", json=body)
        assert fresh.status_code == 201
        assert fresh.json()["dependency"] == dependency
        assert client.get("/v1/bootstrap").json() == current

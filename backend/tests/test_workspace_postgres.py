"""Verify the aggregated reader against the actual Postgres transaction backend."""
import json
import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest

from citride.command import CommandService
from citride.postgres import PostgresRepository
from citride.records import RecordsService
from citride.workspace import workspace_snapshot

URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="needs disposable test Postgres")
ROOT = Path(__file__).resolve().parents[2]

@pytest.fixture
def store():
    key = "workspace-read-test-" + uuid4().hex
    repository = PostgresRepository(URL, ROOT / "data/scenario.json", state_key=key)
    try:
        RecordsService(repository).initialize()
        yield repository
    finally:
        with psycopg.connect(URL) as connection:
            connection.execute("DELETE FROM citride_state WHERE state_key = %s", (key,))

def raw_state(store):
    with psycopg.connect(URL) as connection:
        return connection.execute("SELECT nquads, updated_at FROM citride_state WHERE state_key = %s", (store._state_key,)).fetchone()

def test_snapshot_uses_one_real_transaction_and_parse_without_writes(store, monkeypatch):
    from citride import nquads
    before = raw_state(store)
    counts = {"connections": 0, "parses": 0, "loads": 0}
    with monkeypatch.context() as patch:
        for owner, method, label in [(psycopg, "connect", "connections"), (nquads, "parse_nquads", "parses"), (store, "_load", "loads")]:
            original = getattr(owner, method)
            def counted(*args, _original=original, _label=label, **kwargs):
                counts[_label] += 1
                return _original(*args, **kwargs)
            patch.setattr(owner, method, counted)
        def forbidden(*args, **kwargs):
            pytest.fail("The workspace read attempted a write")
        patch.setattr(store, "_save", forbidden)
        result = workspace_snapshot(store, reset_enabled=False)
        assert counts == {"connections": 1, "parses": 1, "loads": 1}
        assert result["health"]["baselineRevision"] == result["bootstrap"]["baselineRevision"]
        assert result["records"]["now"] == result["health"]["now"]
    assert raw_state(store) == before

def test_snapshot_observes_another_repositorys_committed_write(store):
    command = CommandService(store)
    case = command.create({"eventId": "event-vpn-a", "title": "Transaction freshness", "priority": "high", "expectedBaselineRevision": 1, "clientRequestId": str(uuid4())})
    first = workspace_snapshot(store, reset_enabled=False)
    assert first["incidents"][0]["version"] == case["version"]
    other = PostgresRepository(URL, ROOT / "data/scenario.json", state_key=store._state_key)
    CommandService(other).act(case["id"], {"action": "add_note", "note": "Committed from the other connection", "expectedVersion": case["version"], "clientRequestId": str(uuid4())})
    second = workspace_snapshot(store, reset_enabled=False)
    assert second["incidents"][0]["version"] == case["version"] + 1
    assert second["incidents"][0]["notes"][-1]["text"] == "Committed from the other connection"
    assert "_requests" not in json.dumps(second)

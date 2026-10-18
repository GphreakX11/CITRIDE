"""Destructive operator guard tests run ONLY against UUID-scoped disposable state."""
import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from citride.postgres import PostgresRepository
from citride.storage import Repository

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("reset_demo_state", ROOT / "backend/scripts/reset_demo_state.py")
reset = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reset)


@pytest.fixture
def state():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for operator reset guards")
    key = "test-idt-reset-" + uuid4().hex
    repository = PostgresRepository(url, ROOT / "data/scenario.json", state_key=key)
    try:
        yield url, key, repository
    finally:
        with psycopg.connect(url) as connection:
            connection.execute("DELETE FROM citride_state WHERE state_key = %s", (key,))


def test_reset_fences_stale_fingerprint_and_does_not_seed_unknown_key(state):
    url, key, repository = state
    before = reset.inspect_state(url, key)
    with pytest.raises(ValueError, match="changed"):
        reset.reset_state(url, key, "0" * 64, ROOT / "data/scenario.json")
    assert reset.inspect_state(url, key) == before
    missing = "test-idt-missing-" + uuid4().hex
    with pytest.raises(ValueError, match="does not exist"):
        reset.reset_state(url, missing, "0" * 64, ROOT / "data/scenario.json")
    with psycopg.connect(url) as connection:
        assert connection.execute("SELECT 1 FROM citride_state WHERE state_key=%s", (missing,)).fetchone() is None


def test_reset_replaces_only_the_target_state_with_validated_inline_idt_seed(state, tmp_path):
    url, key, repository = state
    # Exercise actual real-storage mutation before the authorized reset.
    from citride.engine import compute_run
    authored = repository.create_run({"scenarioId":"unsafe-water","evaluationHour":1,"horizonHours":12,"overrides":[]}, compute_run)
    assert repository.runs()
    before = reset.inspect_state(url, key)
    outcome = reset.reset_state(url, key, before["sha256"], ROOT / "data/scenario.json")
    assert outcome["resetApplied"] is True
    seeded_runs = repository.runs()
    assert authored["id"] not in {run["id"] for run in seeded_runs}
    assert len(seeded_runs) == 2
    assert all(run["kind"] == "preliminary" for run in seeded_runs)
    assert {run["incidentId"] for run in seeded_runs} == {"TX-26-0412", "INC-2026-1002-POH"}
    assert all("idt" in entity for entity in repository.baseline()["entities"])
    expected = Repository(tmp_path / "expected", ROOT / "data/scenario.json").baseline()
    assert repository.baseline() == expected


def test_invalid_new_seed_never_overwrites_existing_state(state, tmp_path):
    url, key, repository = state
    before = reset.inspect_state(url, key)
    bad = tmp_path / "invalid.json"
    bad.write_text("{}")
    with pytest.raises(Exception, match="Invalid initial model"):
        reset.reset_state(url, key, before["sha256"], bad)
    assert reset.inspect_state(url, key) == before

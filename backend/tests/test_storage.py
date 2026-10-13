"""Persisted RDF state survives restarts and interrupted atomic replacement."""

from copy import deepcopy
import json

import pytest

from citride.api import REPO_ROOT
from citride.storage import Repository


def test_seed_file_is_not_a_second_mutable_baseline(tmp_path):
    fixture = tmp_path / "scenario.json"
    fixture.write_text((REPO_ROOT / "data" / "scenario.json").read_text())
    store = Repository(tmp_path / "state", fixture)
    initial = store.baseline()
    fixture.write_text("{}")
    restarted = Repository(tmp_path / "state", fixture)
    assert restarted.baseline() == initial


def test_empty_collections_and_metadata_roundtrip_in_rdf(tmp_path):
    seed = json.loads((REPO_ROOT / "data" / "scenario.json").read_text())
    seed["assessments"] = []
    seed["events"] = []
    for scenario in seed["scenarios"]:
        scenario["seed"]["eventRefs"] = []
    seed["optionalMetadata"] = []
    fixture = tmp_path / "scenario.json"
    fixture.write_text(json.dumps(seed))
    store = Repository(tmp_path / "state", fixture)
    assert store.baseline()["assessments"] == []
    assert store.baseline()["events"] == []
    assert store.baseline()["optionalMetadata"] == []


def test_rdf_cache_observes_another_repository_atomic_write(tmp_path):
    state = tmp_path / "state"
    fixture = REPO_ROOT / "data" / "scenario.json"
    first = Repository(state, fixture)
    second = Repository(state, fixture)
    assert first.baseline()["baselineRevision"] == second.baseline()["baselineRevision"] == 1
    dependency = deepcopy(first.baseline()["dependencies"][0])
    proposal = first.create_proposal(dependency, 1)
    assert second.proposal(proposal["id"])["status"] == "draft"
    second.promote(proposal["id"])
    assert first.baseline()["baselineRevision"] == 2
    assert first.proposal(proposal["id"])["status"] == "promoted"


def test_failed_atomic_write_leaves_baseline_and_proposal_unchanged(tmp_path, monkeypatch):
    store = Repository(tmp_path / "state", REPO_ROOT / "data" / "scenario.json")
    baseline = store.baseline()
    proposal = store.create_proposal(deepcopy(baseline["dependencies"][0]), 1)

    def fail_replace(*args):
        raise OSError("simulated disk interruption")

    monkeypatch.setattr("citride.storage.os.replace", fail_replace)
    with pytest.raises(OSError, match="disk interruption"):
        store.promote(proposal["id"])
    assert store.baseline() == baseline
    assert store.proposal(proposal["id"])["status"] == "draft"
    assert list((tmp_path / "state").glob("*.nq.tmp")) == []

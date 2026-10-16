"""Hostile-input regressions independent of mutable generator handoff timing."""
from copy import deepcopy

import pytest

from citride.records import RecordsService, validate_action
from citride.scripted_validation import validate_reference, validate_scripted
from citride.storage import InvalidModelError
from test_scripted_records import PAYLOADS, opened, apply, action
from test_scripted_records import inputs as inputs, service as service


@pytest.mark.parametrize("payload", PAYLOADS)
def test_invalid_status_rejected_by_public_action_validator(payload):
    field = "decision" if "decision" in payload else "confidence" if "confidence" in payload else "status"
    if field not in payload:
        return
    with pytest.raises(InvalidModelError):
        validate_action({**payload, field: "not-an-authored-value"})


@pytest.mark.parametrize("key,field", [("tasks", "teamId"), ("assetStatuses", "entityId"), ("hunts", "ownerTeamId"), ("decisions", "optionId")])
@pytest.mark.parametrize("bad", [None, [], {}, ["utility-a"]])
def test_required_singular_references_cannot_be_empty_or_arrays(inputs, key, field, bad):
    scripted, _, scenario = inputs
    scripted[key][0][field] = bad
    assert validate_scripted(scripted, scenario)


@pytest.mark.parametrize("key,field", [("tasks", "teamId"), ("assetStatuses", "entityId"), ("hunts", "ownerTeamId"), ("decisions", "optionId")])
def test_required_reference_field_must_exist(inputs, key, field):
    scripted, _, scenario = inputs
    del scripted[key][0][field]
    assert validate_scripted(scripted, scenario)


def test_bad_duplicate_source_references_and_cross_incident_teams(inputs):
    scripted, _, scenario = inputs
    scripted["tasks"][0]["sourceRefs"] *= 2
    assert validate_scripted(scripted, scenario)
    scripted["tasks"][0]["sourceRefs"] = ["src-scripted-beta"]
    scripted["tasks"][0]["teamId"] = "team-ciru-bravo"
    assert validate_scripted(scripted, scenario)


def test_startup_rejects_invalid_config_before_storage_write(service, inputs):
    _, store, _ = service
    scripted, reference, scenario = inputs
    before = store.path.read_bytes()
    reference["planningRates"][0]["functionId"] = "missing"
    with pytest.raises(InvalidModelError):
        RecordsService(store, scripted, reference, scenario)
    assert store.path.read_bytes() == before


def test_reference_validation_does_not_materialize_inherited_metadata(inputs):
    _, reference, scenario = inputs
    before = deepcopy(reference)
    assert not validate_reference(reference, scenario)
    assert before == reference
    assert "sourceRefs" not in reference["firstActions"][0]
    assert "origin" not in reference["responseOptions"][0]


def test_action_cannot_reference_other_incident_teams_or_invent_subject(service):
    core, store, clock = service
    case = opened(core, store, clock)
    for payload in (action("add_task", label="Invalid cross-incident task", teamId="team-ciru-bravo", ownerRole="IT lead", dueAt="2026-10-13T08:00:00Z"), {**PAYLOADS[0], "subject": "unrecognized-subject"}):
        before = store.path.read_bytes()
        with pytest.raises(InvalidModelError):
            apply(core, store, case, payload)
        assert store.path.read_bytes() == before


def test_dataset_invalid_ingest_is_nonmutating_even_without_outer_lock(service):
    core, store, clock = service
    opened(core, store, clock)
    ds = store._load()
    before = set(ds.quads())
    item = core.records()["contacts"][0]
    item["entityId"] = "not-an-entity"
    with pytest.raises(InvalidModelError):
        core._ingest_records(ds, {"contacts": [item]}, "external-feed")
    assert set(ds.quads()) == before


def test_clock_and_relative_timestamps_keep_seed_origin_after_restart(service, inputs):
    core, store, clock = service
    before = core.records()["statewideIncidents"]
    replacement = deepcopy(inputs[2])
    replacement["incidentOrigin"] = "2020-01-01T00:00:00Z"
    restarted = RecordsService(store, inputs[0], inputs[1], replacement, now=lambda: clock[0])
    restarted.initialize()
    assert restarted.records()["statewideIncidents"] == before
    assert restarted.story_now() == core.story_now()


def test_default_files_validate_after_final_generator_handoff():
    # This is not a polling loop: full seed acceptance is exercised at final run.
    import json
    from test_scripted_records import ROOT
    scenario = json.loads((ROOT / "data/scenario.json").read_text())
    if len(scenario["entities"]) != 67:
        pytest.skip("Parent-owned 67-entity generator handoff not present")
    scripted = json.loads((ROOT / "data/scripted/watershed_beta.json").read_text())
    reference = json.loads((ROOT / "data/reference.json").read_text())
    assert not validate_reference(reference, scenario)
    assert not validate_scripted(scripted, scenario)

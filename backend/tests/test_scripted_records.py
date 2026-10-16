"""Scripted records contract, exercised only against owned temporary RDF stores."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from rdflib import Dataset

from citride.records import ACTION_FIELDS, RecordsService, validate_action
from citride.scripted_validation import COLLECTIONS
from citride.storage import InvalidModelError, Repository
from citride.validation import validate_reference, validate_scripted

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def inputs():
    scripted = json.loads((ROOT / "data/scripted/watershed_beta.json").read_text())
    reference = json.loads((ROOT / "data/reference.json").read_text())
    scenario = json.loads((ROOT / "data/scenario.json").read_text())
    # Explicit independent scenario refs while the parent owns the generator.
    for identifier in ("vendor-v", "hospital-w", "dialysis-u"):
        if not any(r["id"] == identifier for r in scenario["entities"]):
            scenario["entities"].append({"id": identifier})
    for identifier in ("hospital-sterilization-w", "dialysis-treatment-u"):
        if not any(r["id"] == identifier for r in scenario["serviceFunctions"]):
            scenario["serviceFunctions"].append({"id": identifier})
    scenario["responseOptions"] = deepcopy(reference["responseOptions"])
    return scripted, reference, scenario


@pytest.fixture
def service(tmp_path, inputs):
    scripted, reference, scenario = inputs
    # Repository baseline is the actual seed (no schema-weakened persistence).
    store = Repository(tmp_path / "state", ROOT / "data/scenario.json")
    clock = [datetime(2030, 1, 1, tzinfo=timezone.utc)]
    core = RecordsService(store, scripted, reference, scenario, now=lambda: clock[0])
    # Production now seeds atomically in Repository.__init__; install the
    # controlled clock through that same seed callback in this owned fixture.
    with store._locked():
        dataset = store._load()
        core.seed(dataset)
        store._save(dataset)
    core.initialize()
    return core, store, clock


def opened(core, store, clock, case_id="case-one", event="event-vpn-a"):
    case = {"id": case_id, "eventId": event, "createdAt": clock[0].isoformat(),
            "status": "open", "tasks": [{"completed": False}],
            "decisions": [{"reviewed": False}], "runId": None}
    with store._locked():
        ds = store._load()
        core.on_case_opened(ds, case)
        store._record_graph(ds, "command-incident", case)
        store._save(ds)
    return case


def action(name, **fields):
    return {"action": name, "expectedVersion": 1, "clientRequestId": "request-one", **fields}


def apply(core, store, case, payload):
    with store._locked():
        ds = store._load()
        message = core.apply_action(ds, case, payload)
        store._save(ds)
    return message


def test_authoritative_inputs_are_valid_and_never_rewritten(inputs, service):
    before = [(ROOT / p).read_bytes() for p in ("data/reference.json", "data/scripted/watershed_beta.json")]
    scripted, reference, scenario = inputs
    assert validate_scripted(scripted, scenario) == []
    assert validate_reference(reference, scenario) == []
    core, store, clock = service
    opened(core, store, clock)
    core.initialize()
    assert before == [(ROOT / p).read_bytes() for p in ("data/reference.json", "data/scripted/watershed_beta.json")]


@pytest.mark.parametrize("collection", COLLECTIONS)
@pytest.mark.parametrize("defect", ["reference", "id", "duplicate", "metadata", "status"])
def test_each_collection_rejects_bad_records(inputs, collection, defect):
    scripted, _, scenario = inputs
    key = {"statewideIncidents": "incidents", "responseTasks": "tasks"}.get(collection, collection)
    item = scripted[key][0]
    if defect == "reference":
        item["entityId"] = "missing-entity"
    elif defect == "id":
        item["id"] = []
    elif defect == "duplicate":
        scripted[key].append(deepcopy(item))
    elif defect == "metadata":
        del item["sourceRefs"]
    else:
        item["decision" if key == "decisions" else "confidence" if key == "assessments" else "status"] = "impossible-status"
    assert validate_scripted(scripted, scenario)


@pytest.mark.parametrize("collection", ["responseOptions", "planningRates", "boilWaterRules", "firstActions"])
def test_reference_config_bad_refs_and_duplicate_ids(inputs, collection):
    _, reference, scenario = inputs
    reference[collection][0]["entityId"] = "unknown"
    assert validate_reference(reference, scenario)
    del reference[collection][0]["entityId"]
    reference[collection].append(deepcopy(reference[collection][0]))
    assert validate_reference(reference, scenario)


def test_reference_rates_task_groups_and_nested_references(inputs):
    scripted, reference, scenario = inputs
    reference["planningRates"][0]["functionId"] = "unknown"
    assert validate_reference(reference, scenario)
    scripted["tasks"][0]["teamId"] = "utilities"
    assert not validate_scripted(scripted, scenario)
    scripted["taskGroups"][0]["id"] = []
    assert validate_scripted(scripted, scenario)


def test_seed_clock_restart_init_reset_and_baseline_preservation(service, inputs):
    core, store, clock = service
    baseline = store.baseline()
    origin = datetime.fromisoformat(inputs[2]["incidentOrigin"].replace("Z", "+00:00"))
    assert datetime.fromisoformat(core.story_now()) == origin + timedelta(hours=1)
    initial_bytes = store.path.read_bytes()
    clock[0] += timedelta(minutes=10)
    core.initialize()
    assert store.path.read_bytes() == initial_bytes
    restarted = RecordsService(Repository(store.data_dir, store.scenario_path), *inputs, now=lambda: clock[0])
    restarted.initialize()
    assert datetime.fromisoformat(restarted.story_now()) == origin + timedelta(hours=1, minutes=10)
    case = opened(core, store, clock)
    apply(core, store, case, action("set_contact_status", contactId="contact-1", status="attempted", note="Operator note"))
    with store._locked():
        ds = store._load()
        core.seed(ds)
        store._save(ds)
    assert store.baseline() == baseline
    assert datetime.fromisoformat(core.story_now()) == origin + timedelta(hours=1)
    assert len(core.records()["statewideIncidents"]) == 4
    assert store._records(store._load(), "command-incident")  # seed doesn't delete cases


def test_link_scope_offsets_late_dynamic_live_case_and_detached_snapshots(service):
    core, store, clock = service
    assert len(core.records()["statewideIncidents"]) == 4
    assert not core.records()["contacts"]
    unrelated = opened(core, store, clock, "unrelated", "not-linked")
    assert len(core.records()["statewideIncidents"]) == 4
    case = opened(core, store, clock)
    snapshot = core.records(case["id"])
    assert len(snapshot["statewideIncidents"]) == 1
    assert snapshot == core.records("TX-26-0412")
    assert all(t["incidentId"] == "TX-26-0412" for t in snapshot["teams"])
    tasks = {t["id"]: t for t in snapshot["responseTasks"]}
    assert tasks["task-util-b-reset"]["late"] is True
    assert tasks["task-ciru-confirm-setpoint"]["late"] is False
    assert tasks["task-ciru-disable-vendor"]["status"] == "done"
    assert core.records(unrelated["id"])["contacts"] == []
    clock[0] += timedelta(hours=2)
    assert next(t for t in core.records()["responseTasks"] if t["id"] == "task-ciru-confirm-setpoint")["late"] is True
    assert next(t for t in core.records()["responseTasks"] if t["id"] == "task-ciru-disable-vendor")["late"] is False
    with store._locked():
        ds = store._load()
        case["status"] = "monitoring"
        case["tasks"][0]["completed"] = True
        case["decisions"][0]["reviewed"] = True
        store._record_graph(ds, "command-incident", case)
        store._save(ds)
    live = core.records(case["id"])["statewideIncidents"][0]
    assert live["status"] == "monitoring"
    assert live["reviews"] == case["decisions"]
    assert live["progress"] == case["tasks"]
    snapshot["timing"]["storyClock"]["startRelativeHours"] = 90
    snapshot["contacts"][0]["sourceRefs"].clear()
    assert core.records()["contacts"][0]["sourceRefs"]
    assert core.records()["timing"]["storyClock"]["startRelativeHours"] == 1


PAYLOADS = [
    action("record_assessment", subject="attribution", cluster="Updated cluster", actorLabel="Unknown actor", confidence="medium", note="Assessment note"),
    action("set_asset_status", entityId="vpn-a", status="suspected", note="Asset note"),
    action("record_hunt", huntId="hunt-1-vendor-account", status="findings", resultNote="Review findings"),
    action("set_contact_status", contactId="contact-1", status="attempted", note="Contact note"),
    action("record_decision", optionId="opt-isao-advisory", decision="deferred", decidedBy="Chief", note="Decision note"),
    action("set_team_status", teamId="team-ciru-alpha", status="remote", people={"onSite": 0, "remote": 2, "traveling": 0, "standby": 1}, locationLabel="Remote", updateText="Tracking update"),
    action("add_task", label="Follow up", teamId="utilities", ownerRole="IT lead", dueAt="2026-10-13T08:15:00+00:00"),
    action("set_task_status", taskId="task-util-b-reset", status="done"),
]


@pytest.mark.parametrize("payload", PAYLOADS)
def test_all_actions_tracking_history_origin_and_ingestion(service, payload):
    core, store, clock = service
    case = opened(core, store, clock)
    with patch.object(core, "_ingest_records", wraps=core._ingest_records) as ingest:
        message = apply(core, store, case, payload)
    assert ingest.called
    assert "record" in message.lower()
    modified = [r for key in COLLECTIONS for r in core.records()[key] if r["history"]]
    assert len(modified) == 1
    item = modified[0]
    assert item["origin"] in ("scripted", "analyst")
    assert item["history"][-1]["who"] == "Authenticated operator"
    assert item["history"][-1]["what"]["action"] == payload["action"]
    assert datetime.fromisoformat(item["history"][-1]["when"]).tzinfo
    if payload["action"] == "record_hunt":
        assert item["query"]["value"] == "vendor-v-support"


@pytest.mark.parametrize("payload", PAYLOADS)
def test_strict_flat_action_validation_and_case_scoping(service, payload):
    core, store, clock = service
    validate_action(payload)
    assert ACTION_FIELDS[payload["action"]] == set(payload) - {"action", "expectedVersion", "clientRequestId"}
    for bad in ({**payload, "unexpected": True}, {k: v for k, v in payload.items() if k != "expectedVersion"}, {**payload, "expectedVersion": True}):
        with pytest.raises(InvalidModelError):
            validate_action(bad)
    case = opened(core, store, clock)
    before = store.path.read_bytes()
    with pytest.raises(InvalidModelError):
        apply(core, store, {**case, "id": "other-case"}, payload)
    assert store.path.read_bytes() == before


def test_callbacks_never_save_or_lock_recursively_and_failed_outer_transaction(service):
    core, store, clock = service
    case = opened(core, store, clock)
    before = store.path.read_bytes()
    with pytest.raises(RuntimeError), store._locked():
        ds = store._load()
        with patch.object(store, "_locked", side_effect=AssertionError("recursive lock")), patch.object(store, "_save", side_effect=AssertionError("nested save")):
            core.seed(Dataset())
            core.on_case_opened(ds, case)
            core.apply_action(ds, case, PAYLOADS[3])
        raise RuntimeError("Outer case/receipt transaction failed")
    assert store.path.read_bytes() == before
    assert core.records(case["id"])["contacts"][0]["status"] == "contacted"


def test_future_ingest_preserves_origin_history_rejects_refs_and_detaches(service):
    core, store, clock = service
    opened(core, store, clock)
    item = deepcopy(core.records()["contacts"][0])
    item.pop("at", None)
    item["status"] = "attempted"
    core.ingest_records({"contacts": [item]}, "partner-feed")
    item["sourceRefs"].clear()
    saved = core.records()["contacts"][0]
    assert saved["origin"] == "scripted"
    assert saved["sourceRefs"]
    before = store.path.read_bytes()
    with pytest.raises(InvalidModelError):
        core.ingest_records({"contacts": [{**saved, "entityId": "unknown"}]}, "partner-feed")
    assert store.path.read_bytes() == before


@pytest.mark.parametrize("field,value", [("status", "late"), ("status", []), ("taskId", {})])
def test_malformed_action_types(field, value):
    with pytest.raises(InvalidModelError):
        validate_action({**PAYLOADS[-1], field: value})

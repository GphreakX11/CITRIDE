"""Donna overnight backend evidence; not browser or production acceptance.

Real intake/model/reasoner, exclusively tmp_path-owned stores and input copies.
Check 1's UI stale badge and check 7's empty-panel wording require frontend gates.
"""
from copy import deepcopy
import json
from pathlib import Path
import shutil
from time import perf_counter
from uuid import uuid4

import pytest
from rdflib import Graph, OWL, RDF, URIRef

from citride.command import CommandService
from citride.consequence_projection import ConsequenceService
from citride.incident_context import incident_context
from citride.records import RecordsService
from citride.source_install import _graph_id
from citride.source_model_install import install_source_model
from citride.storage import Repository

ROOT = Path(__file__).resolve().parents[2]
PORT = "INC-2026-1002-POH"
WATER = "TX-26-0412"


@pytest.fixture(autouse=True)
def no_remote_configuration(monkeypatch):
    import os
    for key in tuple(os.environ):
        if key in {"DATABASE_URL", "TEST_DATABASE_URL", "VERCEL", "VERCEL_ENV"} or key.startswith(("CITRIDE_", "PG")):
            monkeypatch.delenv(key, raising=False)


@pytest.fixture
def store(tmp_path):
    shutil.copytree(ROOT / "data", tmp_path / "inputs")
    return Repository(tmp_path / "state", tmp_path / "inputs/scenario.json")


def open_case(store, event="event-dosing"):
    return CommandService(store).create({
        "eventId": event, "title": "SIMULATED overnight regression", "priority": "high",
        "expectedBaselineRevision": store.baseline()["baselineRevision"], "clientRequestId": str(uuid4()),
    })


def reviewed(store, case):
    return CommandService(store).act(case["id"], {
        "action": "analyze", "scenarioId": "unsafe-water", "evaluationHour": 1,
        "horizonHours": 12, "expectedVersion": case["version"], "clientRequestId": str(uuid4()),
    })


@pytest.fixture
def legacy(store):
    # Reconstruct the documented earlier release: port incident/status/decision
    # records already exist, but its six model collections are not installed.
    old = json.loads(store.scenario_path.read_text())
    with store._locked():
        dataset = store._load()
        for run in store._records(dataset, "run"):
            dataset.remove_graph(_graph_id("run", run["id"]))
        store._write_baseline(dataset, old)
        store._save(dataset)
    core = RecordsService(store)
    with store._locked():
        dataset = store._load()
        core._automatic_analysis(dataset, {WATER})
        store._save(dataset)
    return store


def install(store):
    plan = install_source_model(store, PORT)
    assert not plan["noop"]
    assert all(value["update"] == 0 for value in plan["counts"].values())
    result = install_source_model(store, PORT, apply=True, expected_token=plan["token"])
    assert result["applied"]
    return result


def context_inputs(context):
    # Revision is a global identity, not incident-specific evidence.
    return {key: value for key, value in context.items() if key != "baselineRevision"}


def test_check1_port_revision_preserves_water_preliminary_case_and_reviewed_inputs(legacy):
    case = reviewed(legacy, open_case(legacy))
    original = deepcopy(legacy.runs())
    preliminary = next(r for r in original if r.get("incidentId") == WATER)
    captured = context_inputs(case["contextSnapshot"])
    assert captured == context_inputs(incident_context(legacy.baseline(), "event-dosing"))
    before = legacy.baseline()["baselineRevision"]
    install(legacy)
    assert legacy.baseline()["baselineRevision"] == before + 1
    assert CommandService(legacy).get(case["id"]) == case
    assert legacy.run(preliminary["id"]) == preliminary
    assert all(legacy.run(run["id"]) == run for run in original)
    assert context_inputs(incident_context(legacy.baseline(), "event-dosing")) == captured
    assert ConsequenceService(legacy).view(WATER)["analysis"]["kind"] == "reviewed"


def test_check1_incident_own_event_change_is_detectable_without_changing_other_incident(store):
    water = reviewed(store, open_case(store))
    old_water = context_inputs(water["contextSnapshot"])
    old_port = context_inputs(incident_context(store.baseline(), "poh-ev-cred"))
    with store._locked():
        dataset = store._load()
        model = store._baseline(dataset)
        event = next(e for e in model["events"] if e["id"] == "event-dosing")
        event["label"] += " (updated own-input evidence)"
        model["baselineRevision"] += 1
        store._write_baseline(dataset, model)
        store._save(dataset)
    assert context_inputs(incident_context(store.baseline(), "event-dosing")) != old_water
    assert context_inputs(incident_context(store.baseline(), "poh-ev-cred")) == old_port
    assert CommandService(store).get(water["id"]) == water  # immutable history, not silently refreshed


def people_inputs(store):
    """C1 central inputs, intentionally independent of command/case snapshots."""
    model = store.baseline()
    records = RecordsService(store).records(WATER)
    incident = records["statewideIncidents"][0]
    entities = {row["id"]: row for row in model["entities"]}
    utilities = set()
    for event in model["events"]:
        if event["id"] not in incident["linkedEventIds"] or event.get("observation") not in {"probed", "probing_only"}:
            continue
        current = event["seenOn"]
        visited = set()
        while current in entities and current not in visited:
            visited.add(current)
            row = entities[current]
            if row["type"] == "WaterServiceProvider":
                utilities.add(current)
                break
            current = row.get("hostedBy") or row.get("partOf")
    populations = {}
    for identifier in utilities:
        areas = entities[identifier].get("serves", [])
        areas = [areas] if isinstance(areas, str) else areas
        populations[identifier] = sum(row["count"] for row in entities.values()
            if row["type"] == "PopulationGroup" and row.get("locatedIn") in areas)
    return ConsequenceService(store).view(WATER)["people"], populations


def test_checks3_6_no_case_people_and_probed_totals_survive_open_capture_and_restart(store):
    assert CommandService(store).list() == []
    expected = (18000, {"utility-b": 12000, "utility-c": 9000})
    assert people_inputs(store) == expected
    assert sum(expected[1].values()) == 21000
    assert ConsequenceService(store).view(PORT)["people"] is None  # no invented port population
    case = open_case(store)
    assert people_inputs(store) == expected
    reviewed(store, case)
    assert people_inputs(store) == expected
    restarted = Repository(store.data_dir, store.scenario_path, existing_only=True)
    assert people_inputs(restarted) == expected


def test_check3_existing_records_not_duplicated_by_model_install_or_case(legacy):
    before = RecordsService(legacy).records()
    ids = {r["id"] for r in before["statewideIncidents"] if r["status"] != "closed"}
    assert len(ids) == 5  # supplied records include three other open non-modeled incidents
    old_statuses = deepcopy(before["assetStatuses"])
    assert people_inputs(legacy) == (18000, {"utility-b": 12000, "utility-c": 9000})
    install(legacy)
    after = RecordsService(legacy).records()
    assert {r["id"] for r in after["statewideIncidents"] if r["status"] != "closed"} == ids
    assert after["assetStatuses"] == old_statuses
    open_case(legacy, "poh-ev-cred")
    scoped = RecordsService(legacy).records(PORT)
    assert len(scoped["statewideIncidents"]) == 1
    pending = scoped["pendingDecisions"]
    assert [(r["id"], r["optionId"]) for r in pending] == [("decision-isao-poh", "opt-isao-energy-advisory")]
    assert scoped["statewideIncidents"][0]["consequenceSummary"]["infrastructureCount"] == 14
    view = ConsequenceService(legacy).view(PORT)
    union = {n["id"] for n in view["nodes"] if n.get("impactCount") and not n.get("source")} | {r["entityId"] for r in view["watchAssets"]}
    assert len(union) == view["infrastructureCount"] == 14
    assert (view["cascadeCount"], view["watchCount"], view["watchOnlyCount"]) == (11, 5, 3)
    assert people_inputs(legacy) == (18000, {"utility-b": 12000, "utility-c": 9000})


def test_check4_whole_store_reasoning_includes_port_classes_and_saved_readback(store):
    from citride.reasoning import compute_inference, ontology_document
    baseline = store.baseline()
    document = ontology_document()
    ontology = Graph().parse(data=document, format="turtle")
    types = {row["type"] for row in baseline["entities"]}
    missing = sorted(t for t in types if (URIRef("urn:citride:" + t), RDF.type, OWL.Class) not in ontology)
    assert not missing, f"Whole-store input classes absent from local ontology: {missing}"
    started = perf_counter()
    def compute(model, identifier):
        result = compute_inference(model, identifier)
        result["_ontologyTurtle"] = document
        return result
    run = store.create_inference_run(baseline["baselineRevision"], compute)
    elapsed = perf_counter() - started
    assert run["baselineSnapshot"] == baseline
    assert not [w for w in run["warnings"] if "outside this local ontology" in w]
    for identifier in ("poh-port", "sabine-lng", "colonial", "tankers-47", "utility-a"):
        assert any(f["subject"]["id"] == identifier for f in run["assertedFacts"])
    restarted = Repository(store.data_dir, store.scenario_path, existing_only=True)
    assert restarted.inference_run(run["id"], run["ontology"]["sha256"]) == run
    assert restarted.baseline() == baseline
    print(f"whole-store inference+save {elapsed:.3f}s; entities={len(baseline['entities'])}; warnings={run['warnings']}")


@pytest.mark.parametrize("collection", ["teams", "contacts", "decisions", "responseTasks"])
def test_check7_port_records_are_honestly_absent_and_never_water(store, collection):
    core = RecordsService(store)
    assert core.records(WATER)[collection], "Control must contain water records"
    before = store.path.read_bytes()
    scoped = core.records(PORT)
    assert scoped["statewideIncidents"][0]["id"] == PORT
    assert scoped[collection] == []  # frontend must render Not recorded, not water fallback
    assert "dosing setpoint" not in json.dumps(scoped).lower()
    assert store.path.read_bytes() == before
    open_case(store, "poh-ev-cred")
    assert RecordsService(store).records(PORT)[collection] == []


def test_legacy_pending_model_records_cannot_be_edited_before_intake(legacy):
    from citride.storage import InvalidModelError
    core = RecordsService(legacy)
    row = deepcopy(core.records(PORT)["assetStatuses"][0])
    row["detail"] = "Must not accept an edit referencing an uninstalled model"
    before = legacy.path.read_bytes()
    with pytest.raises(InvalidModelError, match="model intake"):
        core.ingest_records({"assetStatuses": [row]}, "overnight-test")
    assert legacy.path.read_bytes() == before


def test_check8_synthetic_copy_backup_dry_run_apply_preserves_protected_records(legacy, tmp_path):
    case = reviewed(legacy, open_case(legacy))
    records = RecordsService(legacy).records()
    original_runs = deepcopy(legacy.runs())
    backup = tmp_path / "synthetic-pre-intake-backup.nq"
    shutil.copy2(legacy.path, backup)
    before = backup.read_bytes()
    started = perf_counter()
    plan = install_source_model(legacy, PORT)
    dry_seconds = perf_counter() - started
    assert legacy.path.read_bytes() == before
    assert all(v["update"] == 0 for v in plan["counts"].values())
    started = perf_counter()
    result = install_source_model(legacy, PORT, apply=True, expected_token=plan["token"])
    apply_seconds = perf_counter() - started
    assert result["applied"]
    assert backup.read_bytes() == before
    assert CommandService(legacy).get(case["id"]) == case
    assert RecordsService(legacy).records()["decisions"] == records["decisions"]
    assert all(legacy.run(r["id"]) == r for r in original_runs)
    port = next(r for r in legacy.runs() if r.get("incidentId") == PORT)
    assert port["kind"] == "preliminary"
    installed = legacy.path.read_bytes()
    replay = install_source_model(legacy, PORT, apply=True, expected_token=plan["token"])
    assert replay["noop"] and legacy.path.read_bytes() == installed
    assert legacy.run(port["id"]) == port
    print(f"synthetic copy backup={backup.name}; dry-run={dry_seconds:.3f}s; apply={apply_seconds:.3f}s")

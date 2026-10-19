"""Analyst model intake contracts. Every store and edited input is tmp_path-owned."""
from copy import deepcopy
import json
from pathlib import Path
import shutil
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from citride.command import CommandService
from citride.incident_context import incident_context
from citride.storage import Repository


ROOT = Path(__file__).resolve().parents[2]
INCIDENT = "INC-2026-1002-POH"
SCENARIO = "port-terminal-down"
FIRST_ALERT = "poh-ev-cred"
PORT_EVENTS = (
    FIRST_ALERT, "poh-ev-lateral", "poh-ev-ot-pivot", "poh-ev-tos-offline",
    "poh-ev-ais", "poh-ev-sabine",
)
NO_TECHNIQUES = {"poh-ev-ot-pivot", "poh-ev-ais", "poh-ev-sabine"}
CASES = "/v1/command/incidents"


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in (
        "VERCEL", "VERCEL_ENV", "CITRIDE_DATABASE_URL", "DATABASE_URL",
        "CITRIDE_STATE_KEY", "CITRIDE_DATA_DIR", "CITRIDE_DEMO_USERNAME",
        "CITRIDE_DEMO_PASSWORD",
    ):
        monkeypatch.delenv(name, raising=False)


def local_app(state, scenario):
    # Import only after the fixture has removed hosted/storage configuration.
    from citride.api import create_app
    return create_app(state, scenario)


@pytest.fixture
def client(tmp_path):
    with TestClient(local_app(tmp_path / "state", ROOT / "data/scenario.json")) as connection:
        yield connection


def get(client, path, **params):
    response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def open_case(client, event_id):
    baseline = get(client, "/v1/bootstrap")
    response = client.post(CASES, json={
        "eventId": event_id, "title": "SIMULATED model-flow review", "priority": "high",
        "expectedBaselineRevision": baseline["baselineRevision"], "clientRequestId": str(uuid4()),
    })
    assert response.status_code == 201, response.text
    return response.json()


def capture(client, case, scenario_id, horizon=48):
    response = client.post(f"{CASES}/{case['id']}/actions", json={
        "action": "analyze", "scenarioId": scenario_id, "evaluationHour": 1,
        "horizonHours": horizon, "expectedVersion": case["version"],
        "clientRequestId": str(uuid4()),
    })
    assert response.status_code == 200, response.text
    return response.json()


def alert_ids(baseline, cases, incident=None):
    """The A1 input contract: stored alerts minus alerts with active cases."""
    opened = {case["eventId"] for case in cases if case["status"] != "closed"}
    linked = set(incident["linkedEventIds"]) if incident else None
    return {event["id"] for event in baseline["events"]
            if event.get("type") in {"Event", "CyberEvent"}
            and event["id"] not in opened
            and (linked is None or event["id"] in linked)}


def impact_windows(run):
    return {(impact["entityId"], impact["functionId"]): impact["windowHours"]
            for impact in run["impacts"]}


def node_windows(view):
    return {node["id"]: node["windowHours"] for node in view["nodes"]
            if node.get("impactCount")}


def test_fresh_queue_contains_thirteen_stored_alerts_and_six_filtered_alerts(client):
    baseline = get(client, "/v1/bootstrap")
    records = get(client, "/v1/command/records")
    incident = next(row for row in records["statewideIncidents"] if row["id"] == INCIDENT)
    cases = get(client, CASES)["incidents"]
    assert cases == []
    assert len(alert_ids(baseline, cases)) == 13
    assert alert_ids(baseline, cases, incident) == set(PORT_EVENTS)
    assert len(alert_ids(baseline, cases) - set(PORT_EVENTS)) == 7
    assert SCENARIO in {row["id"] for row in baseline["scenarios"]}


@pytest.mark.parametrize("event_id", PORT_EVENTS)
def test_every_source_alert_opens_a_durable_linked_case_with_an_offered_scenario(client, event_id):
    case = open_case(client, event_id)
    assert case["eventSnapshot"]["id"] == event_id
    assert case["contextSnapshot"]["cyberAsset"] is not None
    assert case["contextSnapshot"]["physicalAsset"] is not None
    offered = case["contextSnapshot"]["scenarios"]
    assert [row["id"] for row in offered] == [SCENARIO]
    assert offered[0]["label"] == next(row["label"] for row in get(client, "/v1/bootstrap")["scenarios"]
                                        if row["id"] == SCENARIO)
    assert event_id in offered[0]["seed"]["eventRefs"]
    assert get(client, f"{CASES}/{case['id']}") == case
    records = get(client, "/v1/command/records")
    incident = next(row for row in records["statewideIncidents"] if row["id"] == INCIDENT)
    assert incident["caseId"] == case["id"]
    assert event_id not in alert_ids(get(client, "/v1/bootstrap"), get(client, CASES)["incidents"], incident)


def test_first_alert_context_and_analysis_capture_match_preliminary_without_rewriting(client):
    baseline = get(client, "/v1/bootstrap")
    preliminary_view = get(client, "/v1/command/consequences", incidentId=INCIDENT)
    assert preliminary_view["analysis"]["kind"] == "preliminary"
    previous_runs = [get(client, f"/v1/cascade-runs/{row['id']}")
                     for row in get(client, "/v1/cascade-runs")["runs"]]
    preliminary = next(row for row in previous_runs
                       if row.get("kind") == "preliminary" and row.get("incidentId") == INCIDENT)
    assert preliminary["baselineSnapshot"] == baseline
    case = open_case(client, FIRST_ALERT)
    context = case["contextSnapshot"]
    assert context == get(client, "/v1/incident-context", eventId=FIRST_ALERT)
    assert context["provider"]["id"] == "poh-port"
    assert context["facility"]["id"] == "poh-port"
    assert context["physicalAsset"]["id"] == "poh-auth01"
    assert {item["dependent"]["id"] for item in context["downstreamDependencies"]} >= {
        "sabine-lng", "colonial", "tankers-47", "ship-channel-plants", "freeport",
    }
    # A2 / Entity Profile inputs are actual stored records, not an overlay.
    entities = {row["id"]: row for row in baseline["entities"]}
    for key in ("cyberAsset", "physicalAsset", "facility", "provider"):
        assert context[key] == entities[context[key]["id"]]
    assert case["tasks"] and all(not task["completed"] for task in case["tasks"])
    bundle = json.loads((ROOT / "data/scripted/port_houston.json").read_text())

    # Run analysis is a preview; capture is the separate durable case action.
    request = {"scenarioId": SCENARIO, "evaluationHour": 1, "horizonHours": 48, "overrides": []}
    response = client.post("/v1/cascade-runs", json={
        **request, "expectedBaselineRevision": baseline["baselineRevision"],
        "clientRequestId": str(uuid4()),
    })
    assert response.status_code == 201, response.text
    preview = response.json()
    assert impact_windows(preview) == impact_windows(preliminary)
    assert get(client, f"{CASES}/{case['id']}") == case
    assert get(client, "/v1/command/consequences", incidentId=INCIDENT)["analysis"]["kind"] == "preliminary"
    reviewed = capture(client, case, SCENARIO)
    assert reviewed["runSnapshot"]["kind"] == "reviewed"
    assert impact_windows(reviewed["runSnapshot"]) == impact_windows(preliminary)
    expected = {key: value for key, value in bundle["expectedWindows"].items() if isinstance(value, list)}
    assert {impact["entityId"]: impact["windowHours"] for impact in reviewed["runSnapshot"]["impacts"]} == expected
    assert {identifier: expected[identifier] for identifier in (
        "sabine-lng", "tankers-47", "ship-channel-plants", "houston-water-plants",
    )} == {"sabine-lng": [3, 6], "tankers-47": [6, 12],
           "ship-channel-plants": [12, 18], "houston-water-plants": [18, 24]}
    after = get(client, "/v1/command/consequences", incidentId=INCIDENT)
    assert after["analysis"]["kind"] == "reviewed"
    assert node_windows(after) == node_windows(preliminary_view) == expected
    for run in previous_runs:
        assert get(client, f"/v1/cascade-runs/{run['id']}") == run
    assert get(client, "/v1/bootstrap") == baseline
    assert get(client, f"{CASES}/{case['id']}") == reviewed


def test_response_owners_keep_authored_incident_roles(client):
    case = open_case(client, FIRST_ALERT)
    view = get(client, "/v1/command/consequences", incidentId=case["id"])
    bundle = json.loads((ROOT / "data/scripted/port_houston.json").read_text())
    assert view["responseOwners"]
    assert all(owner in view["responseOwners"] for owner in bundle["responseOwners"])


def test_three_unmapped_events_never_acquire_attack_techniques(client):
    baseline = get(client, "/v1/bootstrap")
    events = {row["id"]: row for row in baseline["events"] if row["id"] in PORT_EVENTS}
    assert set(events) == set(PORT_EVENTS)
    assert {identifier for identifier, row in events.items() if not row.get("attackTechniques")} == NO_TECHNIQUES
    for identifier in NO_TECHNIQUES:
        case = open_case(client, identifier)
        assert not case["eventSnapshot"].get("attackTechniques")
        assert not case["contextSnapshot"]["event"].get("attackTechniques")
        assert get(client, f"{CASES}/{case['id']}")["eventSnapshot"] == events[identifier]


def test_water_windows_and_saved_case_survive_restart(client, tmp_path):
    case = capture(client, open_case(client, "event-dosing"), "unsafe-water", horizon=12)
    assert {row["entityId"]: row["windowHours"] for row in case["decisions"]} == {
        "nursing-z": [1, 4], "dialysis-x": [2, 4], "hospital-y": [4, 8],
    }
    with TestClient(local_app(tmp_path / "state", ROOT / "data/scenario.json")) as restarted:
        assert get(restarted, f"{CASES}/{case['id']}") == case
        assert get(restarted, f"/v1/cascade-runs/{case['runId']}") == case["runSnapshot"]


def test_preexisting_water_case_and_runs_survive_add_only_model_install(tmp_path):
    from citride.source_model_install import install_source_model

    store = Repository(tmp_path / "legacy-state", ROOT / "data/scenario.json")
    # Build real saved water casework, then reconstruct its pre-intake model
    # snapshot in this disposable store. No model-dependent water facts change.
    old_baseline = json.loads((ROOT / "data/scenario.json").read_text())
    command = CommandService(store)
    case = command.create({"eventId": "event-dosing", "title": "Saved before model intake",
                           "priority": "high", "expectedBaselineRevision": old_baseline["baselineRevision"],
                           "clientRequestId": str(uuid4())})
    case = command.act(case["id"], {"action": "analyze", "scenarioId": "unsafe-water",
                                   "evaluationHour": 1, "horizonHours": 12,
                                   "expectedVersion": case["version"], "clientRequestId": str(uuid4())})
    assert incident_context(old_baseline, "event-dosing") == case["contextSnapshot"]
    assert case["runId"] is not None
    with store._locked():
        dataset = store._load()
        run = store._record(dataset, "run", case["runId"])
        run["baselineSnapshot"] = deepcopy(old_baseline)
        store._record_graph(dataset, "run", run)
        store._write_baseline(dataset, old_baseline)
        store._save(dataset)
    case = command.get(case["id"])
    runs = deepcopy(store.runs())
    before = store.path.read_bytes()
    plan = install_source_model(store, INCIDENT)
    assert store.path.read_bytes() == before
    assert not plan["applied"]
    assert all(count["update"] == 0 for count in plan["counts"].values())
    result = install_source_model(store, INCIDENT, apply=True, expected_token=plan["token"])
    assert result["applied"]
    installed = store.baseline()
    assert installed["baselineRevision"] == old_baseline["baselineRevision"] + 1
    for collection in ("sources", "entities", "events", "serviceFunctions", "dependencies", "scenarios"):
        assert all(row in installed[collection] for row in old_baseline[collection])
    with store._locked():
        snapshot = store._record(store._load(), "baseline-revision", plan["baselineSnapshotId"])
        assert snapshot["baselineSnapshot"] == old_baseline
    assert CommandService(Repository(store.data_dir, store.scenario_path, existing_only=True)).get(case["id"]) == case
    assert case["runSnapshot"] is not None
    assert case["runSnapshot"]["baselineSnapshot"] == old_baseline
    for run in runs:
        assert store.run(run["id"]) == run


def third_model(inputs):
    """Independent IDs and location, loaded through the configured model intake."""
    bundle = json.loads((inputs / "scripted/port_houston.json").read_text())
    identifiers = set()

    def collect(value):
        if isinstance(value, dict):
            if "id" in value and isinstance(value["id"], str):
                identifiers.add(value["id"])
            for item in value.values():
                collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)

    collect(bundle)
    identifiers.update(row["dependentFunction"] for row in bundle["dependencies"])

    def remap(value: Any) -> Any:
        if isinstance(value, str):
            return "third-" + value if value in identifiers else value
        if isinstance(value, dict):
            return {remap(key): remap(item) for key, item in value.items()}
        if isinstance(value, list):
            return [remap(item) for item in value]
        return value

    third = remap(bundle)
    assert isinstance(third, dict)
    third["incident"].update(title="SIMULATED third-model incident", customerId="third-customer")
    third["incident"]["location"] = {"label": "Fictional third site", "latitude": 44, "longitude": -70}
    for row in third["entities"]:
        row["label"] = "SIMULATED fixture " + row["id"]
        row["idt"] = {"status": "unassigned"}
    # A different facility class prevents success via a port-only type branch.
    provider = next(row for row in third["entities"] if row["id"] == third["scenario"]["seed"]["provider"])
    provider["type"] = "LNGFacility"
    third["scenario"]["seed"]["eventRefs"] = [row["id"] for row in third["events"]]
    (inputs / "scripted/third.json").write_text(json.dumps(third))
    manifest_path = inputs / "scripted/sources.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["models"].append("third.json")
    manifest_path.write_text(json.dumps(manifest))
    return third


def test_third_model_alert_queue_case_context_and_a4_are_data_driven(tmp_path):
    inputs = tmp_path / "inputs"
    shutil.copytree(ROOT / "data", inputs)
    third = third_model(inputs)
    with TestClient(local_app(tmp_path / "third-state", inputs / "scenario.json")) as client:
        baseline = get(client, "/v1/bootstrap")
        records = get(client, "/v1/command/records")
        incident = next(row for row in records["statewideIncidents"] if row["id"] == third["incident"]["id"])
        assert alert_ids(baseline, [], incident) == {row["id"] for row in third["events"]}
        case = open_case(client, third["events"][0]["id"])
        assert case["contextSnapshot"]["provider"]["id"] == third["scenario"]["seed"]["provider"]
        assert case["contextSnapshot"]["provider"]["type"] == "LNGFacility"
        assert [row["id"] for row in case["contextSnapshot"]["scenarios"]] == [third["scenario"]["id"]]
        assert case["contextSnapshot"]["downstreamDependencies"]
        reviewed = capture(client, case, third["scenario"]["id"])
        assert reviewed["runSnapshot"]["impacts"]
        assert all(impact["entityId"].startswith("third-") for impact in reviewed["runSnapshot"]["impacts"])
        assert get(client, f"{CASES}/{case['id']}") == reviewed


@pytest.fixture
def generic_context():
    """Small schema-shaped context, deliberately no place or incident name."""
    return {
        "baselineRevision": 1, "sources": [{"id": "s"}],
        "events": [{"id": "e", "seenOn": "c"}],
        "entities": [
            {"id": "c", "type": "CyberAsset", "hostedBy": "h"},
            {"id": "h", "type": "PhysicalITAsset", "partOf": "p"},
            {"id": "p", "type": "ElectricSupplyFacility"},
            {"id": "d", "type": "TreatmentPlant"},
        ],
        "serviceFunctions": [
            {"id": "supply", "facility": "p", "service": "electricity"},
            {"id": "consume", "facility": "d", "service": "water_treatment"},
        ],
        "dependencies": [{"id": "dep", "status": "promoted_seed", "provider": "p",
                          "dependent": "d", "dependentFunction": "consume", "requiredService": "electricity"}],
        "scenarios": [{"id": "scenario", "seed": {"provider": "p", "service": "electricity", "eventRefs": ["e"]}}],
    }


@pytest.mark.parametrize("basis", ["scenario", "dependency", "both"])
def test_generic_provider_requires_explicit_supply_relationships(generic_context, basis):
    if basis == "scenario":
        generic_context["dependencies"] = []
    if basis == "dependency":
        generic_context["scenarios"] = []
    original = deepcopy(generic_context)
    result = incident_context(generic_context, "e")
    assert result["provider"]["id"] == "p"
    assert result["facility"]["id"] == "p"
    assert result["serviceArea"] is None
    assert generic_context == original


@pytest.mark.parametrize("broken", ["owner", "service", "duplicate", "operator", "cycle", "parent", "unpromoted", "seed"])
def test_generic_provider_does_not_guess_through_malformed_or_ambiguous_links(generic_context, broken):
    if broken == "owner":
        generic_context["serviceFunctions"][0]["facility"] = "d"
    elif broken == "service":
        generic_context["serviceFunctions"][0]["service"] = "fuel_supply"
    elif broken == "duplicate":
        generic_context["entities"].append(deepcopy(generic_context["entities"][2]))
    elif broken == "operator":
        generic_context["entities"][1].pop("partOf")
        generic_context["entities"][1].update(operatedBy="p", locatedIn="p")
    elif broken == "cycle":
        generic_context["entities"][2]["partOf"] = "h"
    elif broken == "parent":
        generic_context["entities"][1]["partOf"] = ["p", "d"]
    elif broken == "unpromoted":
        generic_context["scenarios"] = []
        generic_context["dependencies"][0]["status"] = "proposed"
    elif broken == "seed":
        generic_context["scenarios"][0]["seed"]["provider"] = ["p", "d"]
    result = incident_context(generic_context, "e")
    assert result["provider"] is None
    assert result["downstreamDependencies"] == []


def test_generic_multiple_supply_ancestors_are_not_arbitrarily_selected(generic_context):
    generic_context["scenarios"] = []
    generic_context["entities"][2]["partOf"] = "q"
    generic_context["entities"].append({"id": "q", "type": "ElectricSupplyFacility"})
    generic_context["serviceFunctions"].append({"id": "q-supply", "facility": "q", "service": "electricity"})
    generic_context["dependencies"].append({**generic_context["dependencies"][0], "id": "q-dep", "provider": "q"})
    result = incident_context(generic_context, "e")
    assert result["provider"] is None
    assert any("ambiguous service-provider" in warning for warning in result["warnings"])

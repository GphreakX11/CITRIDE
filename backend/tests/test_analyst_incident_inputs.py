"""Analyst incident inputs, exercising real APIs on disposable file stores only."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import shutil
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from citride.command import CommandService
from citride.records import RecordsService
from citride.record_time import resolve_record_times
from citride.scripted_validation import COLLECTIONS, INPUT_KEYS
from citride.storage import Repository

ROOT = Path(__file__).resolve().parents[2]
WATER = "TX-26-0412"
PORT = "INC-2026-1002-POH"
OPEN = {"open", "monitoring", "active", "under_investigation", "containment", "recovering"}


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in ("DATABASE_URL", "CITRIDE_DATABASE_URL", "TEST_DATABASE_URL", "VERCEL",
                 "VERCEL_ENV", "CITRIDE_STATE_KEY", "CITRIDE_DATA_DIR",
                 "CITRIDE_DEMO_USERNAME", "CITRIDE_DEMO_PASSWORD"):
        monkeypatch.delenv(name, raising=False)


def app(store):
    from citride.api import create_app
    return create_app(store.data_dir, store.scenario_path)


def get(client, path, **params):
    response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def open_case(store, event):
    return CommandService(store).create({
        "eventId": event, "title": "SIMULATED incident selection review", "priority": "high",
        "expectedBaselineRevision": store.baseline()["baselineRevision"],
        "clientRequestId": str(uuid4()),
    })


def set_status(store, case, status):
    command = CommandService(store)
    if status == "closed":
        for task in case["tasks"]:
            if not task["completed"]:
                case = command.act(case["id"], {
                    "action": "set_task", "taskId": task["id"], "completed": True,
                    "expectedVersion": case["version"], "clientRequestId": str(uuid4()),
                })
    return command.act(case["id"], {
        "action": "set_status", "status": status, "note": "Local test tracking only",
        "expectedVersion": case["version"], "clientRequestId": str(uuid4()),
    })


def test_water_alert_sources_are_relative_only_and_generator_cannot_restore_fixed_times():
    spec = importlib.util.spec_from_file_location("analyst_sample_generator", ROOT / "scripts/generate_demo_data.py")
    assert spec is not None and spec.loader is not None
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    expected = {
        "event-vpn-a": -0.5, "event-inbound-a": -0.1, "event-auth-a": -0.05,
        "event-dosing": 0, "event-sensor": 0.25, "event-probe-b": 0.5, "event-probe-c": 0.75,
    }
    for model in (json.loads((ROOT / "data/scenario.json").read_text()),
                  generator.generate()["data/scenario.json"]):
        assert {event["id"]: event["relativeTimeHours"] for event in model["events"]} == expected
        assert all("timestamp" not in event for event in model["events"])


def test_sample_anchor_resolves_every_alert_but_absolute_live_feed_time_wins(tmp_path):
    store = Repository(tmp_path / "state", ROOT / "data/scenario.json")
    envelope = RecordsService(store).records()
    anchor = datetime.fromisoformat(envelope["sampleDataAnchor"])
    rows = {row["id"]: row for row in envelope["statewideIncidents"]}
    model = store.baseline()
    assert len(model["events"]) == 13
    for event in model["events"]:
        actual = resolve_record_times(event, envelope["sampleDataAnchor"])
        assert datetime.fromisoformat(actual["at"]) == anchor + timedelta(hours=event["relativeTimeHours"])
    first = resolve_record_times(next(e for e in model["events"] if e["id"] == "poh-ev-cred"), envelope["sampleDataAnchor"])
    # The authored offset is rounded to hours, so about forty minutes is expected.
    lead = datetime.fromisoformat(rows[PORT]["startedAt"]) - datetime.fromisoformat(first["at"])
    assert abs(lead.total_seconds() - timedelta(minutes=40).total_seconds()) < timedelta(minutes=5).total_seconds()
    live_time = "2026-10-19T18:17:16+00:00"
    live = {"id": "live-observation", "origin": "live-feed", "timestamp": live_time,
            "at": live_time, "relativeTimeHours": -30}
    resolved = resolve_record_times(live, envelope["sampleDataAnchor"])
    assert resolved["timestamp"] == resolved["at"] == live_time
    assert live == {"id": "live-observation", "origin": "live-feed", "timestamp": live_time,
                    "at": live_time, "relativeTimeHours": -30}


def test_fresh_workspace_exposes_all_open_incidents_and_caseless_preliminaries_without_get_writes(tmp_path, monkeypatch):
    store = Repository(tmp_path / "state", ROOT / "data/scenario.json")
    before = store.path.read_bytes()
    runs = deepcopy(store.runs())
    # Fail loudly if a read attempts automatic intake, not just if bytes differ.
    def forbidden(*args, **kwargs):
        pytest.fail("GET attempted automatic analysis intake")
    monkeypatch.setattr(RecordsService, "_automatic_analysis", forbidden)
    with TestClient(app(store)) as client:
        workspace = get(client, "/v1/workspace")
        assert workspace["incidents"] == []
        records = workspace["records"]
        assert records["featuredIncidentId"] == WATER
        rows = {row["id"]: row for row in records["statewideIncidents"]}
        assert {key for key, row in rows.items() if row["status"] in OPEN} == {
            WATER, PORT, "TX-26-0409", "TX-26-0411", "TX-26-0404",
        }
        assert rows["TX-26-0398"]["status"] == "closed"
        assert all(not row.get("caseId") for row in rows.values())
        assert get(client, "/v1/command/consequences")["incident"]["id"] == WATER
        for identifier in (WATER, PORT):
            scoped = get(client, "/v1/command/records", incidentId=identifier)
            assert [row["id"] for row in scoped["statewideIncidents"]] == [identifier]
            view = get(client, "/v1/command/consequences", incidentId=identifier)
            assert view["analysis"]["kind"] == "preliminary"
            assert view["analysisState"] == "ready"
            assert view["nodes"] and view["edges"]
            run_id = rows[identifier]["consequenceSummary"]["analysisId"]
            run = get(client, f"/v1/cascade-runs/{run_id}")
            assert run["kind"] == "preliminary" and run["incidentId"] == identifier
            assert run["baselineSnapshot"] == workspace["bootstrap"]
        # Main-store inventory, not a saved case snapshot, supplies entity profiles.
        assert next(entity for entity in workspace["bootstrap"]["entities"] if entity["id"] == "poh-port")
        get(client, "/v1/workspace")
    assert store.path.read_bytes() == before
    assert store.runs() == runs


def test_latest_open_sibling_keeps_register_open_without_rebinding_historical_records(tmp_path, monkeypatch):
    store = Repository(tmp_path / "state", ROOT / "data/scenario.json")
    instant = datetime(2026, 10, 19, 18, tzinfo=timezone.utc)
    monkeypatch.setattr("citride.command._timestamp", lambda: instant.isoformat())
    first = open_case(store, "poh-ev-cred")
    instant += timedelta(minutes=1)
    second = open_case(store, "poh-ev-lateral")
    instant += timedelta(minutes=1)
    third = open_case(store, "poh-ev-ot-pivot")
    third = set_status(store, third, "monitoring")
    first = set_status(store, first, "closed")
    runs = deepcopy(store.runs())
    before = store.path.read_bytes()
    with TestClient(app(store)) as client:
        workspace = get(client, "/v1/workspace")
        row = next(row for row in workspace["records"]["statewideIncidents"] if row["id"] == PORT)
        assert row["status"] == "monitoring"
        # caseId owns the authored records/actions; selection must use the case list.
        assert row["caseId"] == first["id"]
        linked = [case for case in workspace["incidents"]
                  if case["status"] != "closed" and case["eventId"] in row["linkedEventIds"]]
        assert max(linked, key=lambda case: (datetime.fromisoformat(case["createdAt"]), case["id"]))["id"] == third["id"]
        for case in (first, second, third):
            assert get(client, f"/v1/command/incidents/{case['id']}") == case
    assert store.path.read_bytes() == before
    assert store.runs() == runs
    second = set_status(store, second, "closed")
    third = set_status(store, third, "closed")
    assert next(row for row in RecordsService(store).records()["statewideIncidents"] if row["id"] == PORT)["status"] == "closed"


def customer_inputs(tmp_path):
    """A separate customer configuration; never append this fixture to TXCC."""
    from test_analyst_model_flow import third_model
    inputs = tmp_path / "customer-inputs"
    shutil.copytree(ROOT / "data", inputs)
    third = third_model(inputs)
    manifest_path = inputs / "scripted/sources.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["models"] = ["third.json"]
    manifest_path.write_text(json.dumps(manifest))
    # Retain vocabulary/configuration, but no TXCC incident or incident-owned record.
    records_path = inputs / "scripted/watershed_beta.json"
    records = json.loads(records_path.read_text())
    for kind in COLLECTIONS:
        records[INPUT_KEYS.get(kind, kind)] = []
    records_path.write_text(json.dumps(records))
    reference_path = inputs / "scripted/c4_reference.json"
    reference = json.loads(reference_path.read_text())
    reference["featuredIncidentId"] = third["incident"]["id"]
    reference["eventLossRules"].append({
        "providerTypes": ["LNGFacility"], "observations": ["service_offline", "degraded"],
        "lossType": third["scenario"]["seed"]["lossType"],
    })
    reference_path.write_text(json.dumps(reference))
    return inputs, third


def test_separate_customer_fixture_has_its_own_featured_preliminary_and_never_enters_txcc(tmp_path):
    inputs, third = customer_inputs(tmp_path)
    customer = Repository(tmp_path / "customer-state", inputs / "scenario.json")
    txcc = Repository(tmp_path / "txcc-state", ROOT / "data/scenario.json")
    identifier = third["incident"]["id"]
    before = txcc.path.read_bytes()
    with TestClient(app(customer)) as client:
        workspace = get(client, "/v1/workspace")
        rows = workspace["records"]["statewideIncidents"]
        assert len(rows) == 1 and rows[0]["id"] == identifier
        assert rows[0]["customerId"] == third["incident"]["customerId"]
        assert workspace["records"]["featuredIncidentId"] == identifier
        assert workspace["incidents"] == []
        view = get(client, "/v1/command/consequences")
        assert view["incident"]["id"] == identifier
        assert view["analysis"]["kind"] == "preliminary" and view["cascadeCount"] > 0
        assert view["source"]["type"] == "LNGFacility"
        assert all(node["id"].startswith("third-") for node in view["nodes"])
    case = open_case(customer, third["events"][0]["id"])
    assert case["contextSnapshot"]["provider"]["type"] == "LNGFacility"
    assert RecordsService(customer).records()["statewideIncidents"][0]["caseId"] == case["id"]
    with TestClient(app(txcc)) as client:
        assert identifier not in {row["id"] for row in get(client, "/v1/workspace")["records"]["statewideIncidents"]}
        assert client.get("/v1/command/consequences", params={"incidentId": identifier}).status_code == 404
        assert client.get("/v1/command/incidents/" + case["id"]).status_code == 404
    assert txcc.path.read_bytes() == before

"""Integrity checks for the fictional demo inputs, independent of cascade outputs."""

from __future__ import annotations

import importlib.util
import ipaddress
import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
GENERATOR_PATH = ROOT / "scripts" / "generate_demo_data.py"
spec = importlib.util.spec_from_file_location("citride_demo_generator", GENERATOR_PATH)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


@pytest.fixture(scope="module")
def dataset():
    return json.loads((ROOT / "data" / "scenario.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def streams():
    values = [json.loads(path.read_text(encoding="utf-8")) for path in sorted((ROOT / "data" / "telemetry").glob("*.json"))]
    from citride.zeek_logs import load_zeek_json
    values.extend({"id": f"corelight/{name}", "sourceRef": "src-network", "handling": ["SIMULATED"], "records": records}
                  for name, records in load_zeek_json(ROOT / "data/telemetry/corelight").items())
    return {stream["id"]: stream for stream in values}


def test_generation_is_reproducible_and_matches_committed_fixture(tmp_path):
    first = generator.generate()
    assert first == generator.generate()
    for relative_path, value in first.items():
        assert (ROOT / relative_path).read_text(encoding="utf-8") == generator.serialized(value)
    completed = subprocess.run([sys.executable, str(GENERATOR_PATH), "--output-dir", str(tmp_path)], capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr
    before = {path: (tmp_path / path).read_bytes() for path in first}
    checked = subprocess.run([sys.executable, str(GENERATOR_PATH), "--check", "--output-dir", str(tmp_path)], capture_output=True, text=True)
    assert checked.returncode == 0, checked.stdout + checked.stderr
    assert before == {path: (tmp_path / path).read_bytes() for path in first}
    (tmp_path / "data" / "scenario.json").write_text("{}\n", encoding="utf-8")
    mismatch = subprocess.run([sys.executable, str(GENERATOR_PATH), "--check", "--output-dir", str(tmp_path)], capture_output=True, text=True)
    assert mismatch.returncode == 1
    assert "data/scenario.json" in mismatch.stdout


def test_identifiers_and_structural_references_resolve(dataset):
    ids = [row["id"] for key in ("entities", "serviceFunctions", "dependencies", "sources", "assumptions", "events", "assessments", "scenarios") for row in dataset[key]]
    assert len(ids) == len(set(ids)), "Persistent graph identifiers must be unique."
    entities = {row["id"]: row for row in dataset["entities"]}
    for row in entities.values():
        for field in ("partOf", "operatedBy", "serves", "locatedIn", "hostsCyberAsset", "hostedBy"):
            if field in row:
                assert row[field] in entities, (row["id"], field)
        if "hostsCyberAsset" in row:
            assert entities[row["hostsCyberAsset"]]["hostedBy"] == row["id"]
        if "hostedBy" in row:
            assert entities[row["hostedBy"]]["hostsCyberAsset"] == row["id"]
    for function in dataset["serviceFunctions"]:
        assert function["facility"] in entities
    assert sum(row["type"] == "PhysicalOTAsset" for row in entities.values()) == 15
    assert {row["id"] for row in entities.values() if row["type"] == "WaterServiceProvider"} == {"utility-a", "utility-b", "utility-c"}


def test_source_and_assumption_references_resolve_with_simulation_labels(dataset, streams):
    source_ids = {row["id"] for row in dataset["sources"]}
    for key in ("entities", "serviceFunctions", "dependencies", "assumptions", "events", "assessments", "scenarios"):
        for row in dataset[key]:
            assert row["sourceRefs"]
            assert set(row["sourceRefs"]) <= source_ids
            assert row["classification"] == "U"
            assert row["handling"] == ["SIMULATED"]
    for source in dataset["sources"]:
        if source["id"] == "src-idt-v4":
            assert source["evidenceCategory"] == "reference"
            assert source["title"] == "Infrastructure Data Taxonomy v4, 22 Jun 2011"
        else:
            assert source["evidenceCategory"] == "simulated"
        assert source["handling"] == ["SIMULATED"]
    assumptions = {row["id"]: row for row in dataset["assumptions"]}
    for dep in dataset["dependencies"]:
        refs = dep["parameterAssertionRefs"]
        expected = {
            "delay": [dep["propagationDelayMinHours"], dep["propagationDelayMaxHours"]],
            "backup": [dep["usableBackupMinHours"], dep["usableBackupMaxHours"]],
            "lossFraction": dep["lossOfFunction"],
        }
        for parameter, reference in refs.items():
            assert reference in assumptions
            assert assumptions[reference]["dependencyId"] == dep["id"]
            assert assumptions[reference]["value"] == expected[parameter]
    for stream in streams.values():
        assert stream["sourceRef"] in source_ids
        assert stream["handling"] == ["SIMULATED"]
        for row in stream["records"]:
            assert row["handling"] == ["SIMULATED"]
            assert row["sourceRefs"] == [stream["sourceRef"]]


def test_dependencies_are_directed_compatible_and_numerically_bounded(dataset):
    entities = {row["id"]: row for row in dataset["entities"]}
    functions = {row["id"]: row for row in dataset["serviceFunctions"]}
    provider_services = {(row["facility"], row["service"]) for row in functions.values()}
    for dep in dataset["dependencies"]:
        assert dep["provider"] in entities and dep["dependent"] in entities
        assert dep["provider"] != dep["dependent"]
        assert (dep["provider"], dep["requiredService"]) in provider_services
        assert functions[dep["dependentFunction"]]["facility"] == dep["dependent"]
        assert 0 <= dep["propagationDelayMinHours"] <= dep["propagationDelayMaxHours"]
        assert 0 <= dep["usableBackupMinHours"] <= dep["usableBackupMaxHours"]
        assert 0 <= dep["lossOfFunction"] <= 1
        assert set(dep["validForLossTypes"]) <= set(dep["lossTypes"])
    deps = {dep["id"]: dep for dep in dataset["dependencies"]}
    assert deps["dep-e-plant"]["provider"] == "electric-e"
    assert deps["dep-e-plant"]["dependent"] == "plant-a"
    assert deps["dep-e-plant"]["outputLossType"] == "water_treatment_unavailable"
    assert deps["dep-plant-a"]["lossTypes"] == ["water_treatment_unavailable"]
    assert deps["dep-plant-a"]["outputLossType"] == "no_water"
    assert deps["dep-plant-a"]["dependent"] == "utility-a"


def test_curated_events_match_exact_raw_evidence_and_chronology(dataset, streams):
    entities = {row["id"] for row in dataset["entities"]}
    times = [event["relativeTimeHours"] for event in dataset["events"]]
    assert times == sorted(times)
    events = {row["id"]: row for row in dataset["events"]}
    epoch = datetime.fromisoformat(dataset["incidentOrigin"].replace("Z", "+00:00"))
    for event in events.values():
        reference = event["rawRef"]
        stream = streams[reference["streamId"]]
        records = {row["id"]: row for row in stream["records"]}
        raw = records[reference["recordId"]]
        assert reference["sourceRef"] == stream["sourceRef"]
        assert event["sourceRefs"] == raw["sourceRefs"]
        assert "timestamp" not in event, "Curated sample alerts must resolve from the sample-data anchor"
        assert datetime.fromisoformat(raw["timestamp"].replace("Z", "+00:00")) == epoch + timedelta(hours=event["relativeTimeHours"])
        assert event["relativeTimeHours"] == raw["relativeTimeHours"]
        assert event["seenOn"] in entities
    assert events["event-inbound-a"]["relativeTimeHours"] < events["event-auth-a"]["relativeTimeHours"] < events["event-dosing"]["relativeTimeHours"] < events["event-sensor"]["relativeTimeHours"]
    assert events["event-sensor"]["relativeTimeHours"] < events["event-probe-b"]["relativeTimeHours"] < events["event-probe-c"]["relativeTimeHours"]
    assessment = dataset["assessments"][0]
    assert assessment["relativeTimeHours"] < events["event-inbound-a"]["relativeTimeHours"]
    assert datetime.fromisoformat(assessment["timestamp"].replace("Z", "+00:00")) < epoch + timedelta(hours=events["event-inbound-a"]["relativeTimeHours"])


def test_sensor_baseline_quality_drift_and_stable_pressure(streams):
    rows = streams["sensors"]["records"]
    assert len(rows) == 183
    for letter in "abc":
        utility_rows = [row for row in rows if row["utilityId"] == f"utility-{letter}"]
        assert len(utility_rows) == 61
        assert [row["relativeTimeHours"] for row in utility_rows] == sorted(row["relativeTimeHours"] for row in utility_rows)
        baseline = [row for row in utility_rows if row["relativeTimeHours"] < 0]
        assert baseline and all(not row["qualityDriftFlag"] for row in baseline)
        assert max(row["chlorineResidualMgL"] for row in baseline) < 0.8
        pressures = [row["pressurePsi"] for row in utility_rows]
        assert max(pressures) - min(pressures) < 0.5
        assert not any(row["pressureLossFlag"] for row in utility_rows)
        if letter == "a":
            drift = [row for row in utility_rows if row["qualityDriftFlag"]]
            assert drift[0]["relativeTimeHours"] == 0.25
            assert drift[-1]["chlorineResidualMgL"] > 3.8
        else:
            assert not any(row["qualityDriftFlag"] for row in utility_rows)
            assert max(row["chlorineResidualMgL"] for row in utility_rows) < 0.8


def test_negative_controls_do_not_claim_compromise_or_operational_effect(dataset, streams):
    deps = {row["id"]: row for row in dataset["dependencies"]}
    assert "unsafe_water" not in deps["dep-a-f"]["lossTypes"]
    for dep_id in ("dep-a-x", "dep-a-y", "dep-a-z"):
        assert "low_pressure" not in deps[dep_id]["lossTypes"]
        assert "no_water" in deps[dep_id]["lossTypes"]
    assert not any(dep["dependent"] == "facility-q" for dep in deps.values())
    candidate_function = next(row for row in dataset["serviceFunctions"] if row["id"] == "q-safe-water")
    assert candidate_function["facility"] == "facility-q"
    assert candidate_function["service"] == "safe_water_support"
    assert candidate_function["sourceRefs"] == ["src-inventory"]
    potential = [row for row in dataset["scenarios"] if row["seed"]["provider"] in {"utility-b", "utility-c"}]
    assert {row["id"] for row in potential} == {"potential-unsafe-water-b", "potential-unsafe-water-c"}
    assert all(row["seed"]["eventRefs"] == [] for row in potential)
    probes = [row for row in streams["network"]["records"] if row["observation"] == "probing_only"]
    assert {row["utilityId"] for row in probes} == {"utility-b", "utility-c"}
    assert all(row["conn_state"] in {"S0", "REJ"} and row["resp_bytes"] == 0 for row in probes)
    assert len({row["id.orig_h"] for row in probes}) == 1
    assert not any(row["utilityId"] != "utility-a" and row["eventType"] in {"parameter_change", "authentication"} for row in streams["controller"]["records"])
    assert all(not row["anomalous"] for row in streams["enterprise"]["records"])


def test_scenario_seeds_are_explicit_independent_assumptions(dataset):
    events = {row["id"] for row in dataset["events"]}
    functions = {(row["facility"], row["service"]) for row in dataset["serviceFunctions"]}
    scenarios = {row["id"]: row for row in dataset["scenarios"]}
    assert set(scenarios) == {"unsafe-water", "low-pressure", "power-loss", "potential-unsafe-water-b", "potential-unsafe-water-c"}
    assert dataset["defaultScenarioId"] == "unsafe-water"
    for scenario in scenarios.values():
        seed = scenario["seed"]
        assert (seed["provider"], seed["service"]) in functions
        assert seed["windowHours"] == [0, 1]
        assert seed["persistsThroughHour"] == 12
        assert set(seed["eventRefs"]) <= events
        assert seed["sourceRefs"] == ["src-effects"]
        assert seed["handling"] == ["SIMULATED"]
    assert scenarios["unsafe-water"]["seed"]["eventRefs"] == ["event-vpn-a", "event-dosing", "event-sensor"]
    assert scenarios["low-pressure"]["seed"]["eventRefs"] == []
    assert scenarios["power-loss"]["seed"]["eventRefs"] == []


def test_network_identities_use_only_documentation_addresses(dataset, streams):
    allowed = [ipaddress.ip_network(network) for network in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24")]
    addresses = [row["ipAddress"] for row in dataset["entities"] if "ipAddress" in row]
    addresses.extend(row[field] for row in streams["network"]["records"] for field in ("id.orig_h", "id.resp_h"))
    addresses.extend(row["sourceIp"] for row in streams["controller"]["records"] if "sourceIp" in row)
    assert addresses
    assert all(any(ipaddress.ip_address(address) in network for network in allowed) for address in addresses)


def test_raw_telemetry_remains_outside_graph_inputs(dataset, streams):
    raw_ids = {row["id"] for stream in streams.values() for row in stream["records"]}
    graph_ids = {row["id"] for field in ("entities", "serviceFunctions", "dependencies", "events") for row in dataset[field]}
    assert not raw_ids & graph_ids
    assert "streams" not in dataset and "records" not in dataset
    for event in dataset["events"]:
        assert "rawRef" in event and "records" not in event


def test_service_area_geometry_is_schematic_and_spatial_only_candidate_is_inside(dataset):
    entities = {row["id"]: row for row in dataset["entities"]}
    ring = entities["area-a"]["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1]
    assert entities["area-a"]["geometryStatus"] == "synthetic_schematic"
    xs = [coordinate[0] for coordinate in ring]
    ys = [coordinate[1] for coordinate in ring]
    candidate = entities["facility-q"]
    x, y = candidate["geometry"]["coordinates"]
    assert min(xs) < x < max(xs) and min(ys) < y < max(ys)
    assert candidate["locatedIn"] == "area-a"
    assert candidate["operationalDependencyStatus"] == "not_established"

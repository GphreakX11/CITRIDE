#!/usr/bin/env python3
"""Generate the fictional Watershed fixture without external data or credentials.

All coordinates, identities, measurements, relationships, and timing assumptions
are invented. Documentation IPv4 ranges are used throughout. No regulatory or
clinical threshold is asserted by this fixture.
"""

from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = 250
EPOCH = datetime(2026, 10, 13, 7, 0, tzinfo=timezone.utc)


def metadata(source: str) -> dict:
    return {"sourceRefs": [source], "classification": "U", "handling": ["SIMULATED"]}


def instant(hours: float) -> dict:
    dt = EPOCH + timedelta(hours=hours)
    return {
        "relativeTimeHours": round(hours, 6),
        "timestamp": dt.isoformat().replace("+00:00", "Z"),
    }


def source(source_id: str, title: str, description: str) -> dict:
    return {
        "id": source_id, "title": title, "label": title, "description": description,
        "version": "1", "createdOn": "2026-10-13", "author": "CITRIDE fictional scenario generator",
        "evidenceCategory": "simulated", "classification": "U", "handling": ["SIMULATED"],
    }


def entity(entity_id: str, kind: str, label: str, **fields) -> dict:
    return {"id": entity_id, "type": kind, "label": label, **fields, **metadata("src-inventory")}


def generate() -> dict[str, dict]:
    """Return every generated relative path and its JSON object, deterministically."""
    rng = random.Random(SEED)
    sources = [
        source("src-inventory", "Synthetic infrastructure inventory", "Invented assets, operators, service polygons, facilities, and population groups; no real facility identifiers."),
        source("src-dependencies", "Synthetic dependency assumptions", "Illustrative service links, independent reserves, and timing parameters. Not measured or validated utility or clinical planning data."),
        source("src-effects", "Explicit scenario effects", "Authored loss-type conversion and 12-hour persistence assumptions. Telemetry alone does not establish an operational loss."),
        source("src-assessment", "Fictional prior OT assessment", "Invented historical exposure finding for Utility A; no actual assessment has been performed."),
        source("src-network", "Synthetic Zeek-shaped connection stream", "Documentation IP ranges and invented connection records; shared source supports a campaign hypothesis, not actor attribution."),
        source("src-controller", "Synthetic controller audit stream", "Invented authentication and dosing parameter changes, using fictional users and assets."),
        source("src-sensors", "Synthetic sensor time series", "Invented normal baseline, quality drift, stable pressure, and tank levels. Values assert no actual safety threshold."),
        source("src-enterprise", "Synthetic enterprise background stream", "Quiet IT baseline records; absence of evidence here is not proof that enterprise IT is safe."),
    ]

    entities = []
    for index, letter in enumerate("abc"):
        upper = letter.upper()
        offset = round(index * 0.12, 2)
        entities.extend([
            entity(f"org-{letter}", "Organization", f"Utility {upper} Operating Organization", fictionalName=f"Watershed Demo Operator {upper}"),
            entity(f"utility-{letter}", "WaterServiceProvider", f"Utility {upper}", operatedBy=f"org-{letter}", serves=f"area-{letter}"),
            entity(f"plant-{letter}", "TreatmentPlant", f"Treatment Plant {upper}", operatedBy=f"org-{letter}", partOf=f"utility-{letter}", locatedIn=f"area-{letter}", geometry={"type": "Point", "coordinates": [round(offset + 0.02, 3), 0.02]}),
            entity(f"area-{letter}", "ServiceArea", f"Fictional Service Area {upper}", geometry={"type": "Polygon", "coordinates": [[[offset, 0], [round(offset + 0.1, 2), 0], [round(offset + 0.1, 2), 0.1], [offset, 0.1], [offset, 0]]]}, geometryStatus="synthetic_schematic", coordinateNote="Invented geometry near the coordinate origin; does not represent an actual watershed or utility boundary."),
            entity(f"population-{letter}", "PopulationGroup", f"Service Area {upper} population", locatedIn=f"area-{letter}", count=[18000, 12000, 9000][index], countUnit="fictional_people", aggregationNote="Illustrative area total; facility occupants overlap and must not be added to this total."),
        ])
        ot_assets = [
            ("plc", "PLC", "Dosing PLC", "OT_SCADA", 11 + index),
            ("hmi", "HMI", "Operator HMI", "OT_SCADA", 21 + index),
            ("sensor", "water_quality_sensor", "Water-quality Sensor", "FIELD_SENSORS", 31 + index),
            ("pressure", "pressure_sensor", "Pressure Sensor", "FIELD_SENSORS", 51 + index),
            ("tank", "tank_level_sensor", "Tank-level Sensor", "FIELD_SENSORS", 61 + index),
        ]
        for prefix, asset_type, label, terrain, host in ot_assets:
            asset_id = f"{prefix}-{letter}"
            cyber_id = f"cyber-{prefix}-{letter}"
            entities.extend([
                entity(asset_id, "PhysicalOTAsset", f"{label} {upper}", partOf=f"plant-{letter}", operatedBy=f"org-{letter}", assetType=asset_type, terrain=terrain, hostsCyberAsset=cyber_id),
                entity(cyber_id, "CyberAsset", f"{label} {upper} network identity", hostedBy=asset_id, terrain=terrain, ipAddress=f"192.0.2.{host}", exposure="simulated_inbound_reachable" if prefix == "plc" else "simulated_internal", networkIdentityStatus="fictional_documentation_range"),
            ])
        entities.extend([
            entity(f"workstation-{letter}", "PhysicalITAsset", f"Enterprise Workstation {upper}", operatedBy=f"org-{letter}", terrain="ENTERPRISE_IT", hostsCyberAsset=f"cyber-workstation-{letter}"),
            entity(f"cyber-workstation-{letter}", "CyberAsset", f"Enterprise Workstation {upper} identity", hostedBy=f"workstation-{letter}", terrain="ENTERPRISE_IT", ipAddress=f"198.51.100.{41 + index}", networkIdentityStatus="fictional_documentation_range"),
        ])
    facilities = [
        ("dialysis-x", "DialysisCenter", "Dialysis Center X", [0.04, 0.03]),
        ("hospital-y", "Hospital", "Hospital Y", [0.065, 0.06]),
        ("nursing-z", "NursingHome", "Nursing Home Z", [0.03, 0.075]),
        ("fire-f", "FireService", "Fire Service F", [0.075, 0.025]),
        ("facility-q", "HealthcareFacility", "Facility Q", [0.08, 0.08]),
    ]
    for facility_id, kind, label, point in facilities:
        entities.append(entity(facility_id, kind, label, locatedIn="area-a", geometry={"type": "Point", "coordinates": point}, operationalDependencyStatus="not_established" if facility_id == "facility-q" else "synthetic_assumption"))
    entities.extend([
        entity("org-electric-e", "Organization", "Fictional Electricity Operator E"),
        entity("electric-e", "ElectricSupplyFacility", "Electric Supply E", operatedBy="org-electric-e", geometry={"type": "Point", "coordinates": [-0.02, 0.02]}),
    ])

    function_specs = [
        ("water-a", "utility-a", "treated_water", "Utility A treated-water supply"),
        ("water-b", "utility-b", "treated_water", "Utility B treated-water supply"),
        ("water-c", "utility-c", "treated_water", "Utility C treated-water supply"),
        ("plant-treatment", "plant-a", "water_treatment", "Plant A water treatment"),
        ("plant-treatment-b", "plant-b", "water_treatment", "Plant B water treatment"),
        ("plant-treatment-c", "plant-c", "water_treatment", "Plant C water treatment"),
        ("dialysis-treatment", "dialysis-x", "dialysis_treatment", "Dialysis treatment"),
        ("hospital-sterilization", "hospital-y", "sterilization_support", "Hospital sterilization support"),
        ("nursing-safe-water", "nursing-z", "safe_water_support", "Nursing safe-water support"),
        ("q-safe-water", "facility-q", "safe_water_support", "Facility Q safe-water support"),
        ("fire-flow", "fire-f", "fire_flow", "Fire-flow supply"),
        ("electric-supply", "electric-e", "electricity", "Electricity supply"),
    ]
    functions = [{"id": fid, "facility": facility, "service": service, "label": label, **metadata("src-inventory")} for fid, facility, service, label in function_specs]

    dependencies, assumptions = [], []
    specs = [
        ("dep-a-x", "utility-a", "dialysis-x", "treated_water", "dialysis-treatment", ["unsafe_water", "no_water"], [0, 1], [2, 2], 1.0, None),
        ("dep-a-y", "utility-a", "hospital-y", "treated_water", "hospital-sterilization", ["unsafe_water", "no_water"], [0, 1], [4, 6], 0.5, None),
        ("dep-a-z", "utility-a", "nursing-z", "treated_water", "nursing-safe-water", ["unsafe_water", "no_water"], [0, 1], [1, 2], 0.75, None),
        ("dep-a-f", "utility-a", "fire-f", "treated_water", "fire-flow", ["low_pressure", "no_water"], [0, 0.5], [0, 0], 1.0, None),
        ("dep-e-plant", "electric-e", "plant-a", "electricity", "plant-treatment", ["electricity_lost"], [0, 0.25], [1, 1], 1.0, "water_treatment_unavailable"),
        ("dep-plant-a", "plant-a", "utility-a", "water_treatment", "water-a", ["water_treatment_unavailable"], [1, 2], [0, 0], 1.0, "no_water"),
    ]
    for dep_id, provider, dependent, service, function, losses, delay, backup, fraction, output in specs:
        assertions = {}
        for parameter, value, unit in [("delay", delay, "hours"), ("backup", backup, "hours"), ("lossFraction", fraction, "fraction")]:
            assertion_id = f"asm-{dep_id}-{parameter}"
            assertions[parameter] = assertion_id
            assumptions.append({
                "id": assertion_id, "dependencyId": dep_id, "parameter": parameter, "value": value, "unit": unit,
                "ownerRole": "scenario_author", "reviewStatus": "synthetic_seed_only", "evidenceCategory": "simulated",
                "note": "Invented demonstration parameter, not a measured or clinical planning value.", **metadata("src-dependencies"),
            })
        dependencies.append({
            "id": dep_id, "revision": 1, "status": "promoted_seed", "provider": provider, "dependent": dependent,
            "requiredService": service, "dependentFunction": function, "dependencyType": "physical", "coupling": "tight",
            "lossTypes": losses, "propagationDelayMinHours": delay[0], "propagationDelayMaxHours": delay[1],
            "usableBackupMinHours": backup[0], "usableBackupMaxHours": backup[1], "backupService": service,
            "validForLossTypes": losses, "lossOfFunction": fraction, "outputLossType": output,
            "backupIndependenceAssumption": "Usable reserve is assumed independent of the affected supply. Zero explicitly means no usable reserve in this scenario.",
            "parameterAssertionRefs": assertions,
            "assumptionNote": "Synthetic link and parameters initialized in local baseline version 1. No real-world verification or authority approval is implied. Output loss conversion, where present, is an explicit scenario assumption.",
            "recovery": {"status": "unknown", "note": "Restoration requires separate service verification; no recovery sequence is modeled."},
            **metadata("src-dependencies"),
        })

    network_records = []
    for index, letter in enumerate("abc"):
        for number, hour in enumerate([-2, -1.5, -1, -0.75, -0.5, -0.25], start=1):
            network_records.append({
                "id": f"conn-{letter}-baseline-{number:03d}", "ts": (EPOCH + timedelta(hours=hour)).timestamp(),
                **instant(hour), "uid": f"SIM{letter.upper()}BASE{number:03d}",
                "id.orig_h": f"192.0.2.{21 + index}", "id.orig_p": 45000 + number,
                "id.resp_h": f"192.0.2.{11 + index}", "id.resp_p": 502, "proto": "tcp", "service": "modbus",
                "duration": 1.5, "orig_bytes": 64, "resp_bytes": 96, "conn_state": "SF",
                "utilityId": f"utility-{letter}", "targetAssetId": f"plc-{letter}", "observation": "normal_polling",
                "anomalous": False, **metadata("src-network"),
            })
    for letter, hour, state, observation in [("a", -0.1, "SF", "unusual_inbound_connection"), ("b", 0.5, "S0", "probing_only"), ("c", 0.75, "S0", "probing_only")]:
        index = "abc".index(letter)
        network_records.append({
            "id": f"conn-{letter}-unusual-001", "ts": (EPOCH + timedelta(hours=hour)).timestamp(),
            **instant(hour), "uid": f"SIM{letter.upper()}INBOUND001", "id.orig_h": "203.0.113.250", "id.orig_p": 49000 + index,
            "id.resp_h": f"192.0.2.{11 + index}", "id.resp_p": 502, "proto": "tcp", "service": "modbus",
            "duration": 3.0 if letter == "a" else 0.0, "orig_bytes": 128 if letter == "a" else 0,
            "resp_bytes": 96 if letter == "a" else 0, "conn_state": state,
            "utilityId": f"utility-{letter}", "targetAssetId": f"plc-{letter}", "observation": observation,
            "anomalous": True, "sharedSourceIdentity": "synthetic-campaign-01",
            "interpretation": "Simulated completed connection at A." if letter == "a" else "Probe attempt only; no authentication, control change, compromise, or physical effect is established.",
            **metadata("src-network"),
        })
    network_records.sort(key=lambda row: (row["relativeTimeHours"], row["id"]))

    controller_records = []
    for letter in "abc":
        controller_records.append({"id": f"controller-baseline-{letter}", **instant(-1.0), "assetId": f"plc-{letter}", "utilityId": f"utility-{letter}", "eventType": "status_read", "user": f"fictional-operator-{letter}", "outcome": "success", "parameter": "dosing_setpoint", "value": 1.0, "unit": "synthetic_index", "anomalous": False, **metadata("src-controller")})
    controller_records.extend([
        {"id": "controller-auth-001", **instant(-0.05), "assetId": "plc-a", "utilityId": "utility-a", "eventType": "authentication", "user": "fictional-maintenance-session", "sourceIp": "203.0.113.250", "outcome": "success", "anomalous": True, **metadata("src-controller")},
        {"id": "controller-change-001", **instant(0), "assetId": "plc-a", "utilityId": "utility-a", "eventType": "parameter_change", "user": "fictional-maintenance-session", "sourceIp": "203.0.113.250", "parameter": "dosing_setpoint", "before": 1.0, "after": 4.0, "unit": "synthetic_index", "outcome": "applied", "anomalous": True, "interpretation": "An invented parameter change. It does not by itself prove unsafe water.", **metadata("src-controller")},
    ])
    controller_records.sort(key=lambda row: (row["relativeTimeHours"], row["id"]))

    sensor_records = []
    for minute in range(-120, 181, 5):
        hour = minute / 60
        for index, letter in enumerate("abc"):
            drift = letter == "a" and minute >= 15
            residual = 0.75 + rng.uniform(-0.015, 0.015)
            if drift:
                residual += min((minute - 10) / 45, 3.2)
            sensor_records.append({
                "id": f"sensor-{letter}-{minute + 120:03d}", **instant(hour), "utilityId": f"utility-{letter}",
                "assetId": f"sensor-{letter}", "pressureAssetId": f"pressure-{letter}", "tankAssetId": f"tank-{letter}",
                "chlorineResidualMgL": round(residual, 3), "pressurePsi": round(58 + index * 2 + rng.uniform(-0.2, 0.2), 3),
                "tankLevelPercent": round(72 - minute / 600 + rng.uniform(-0.1, 0.1), 3),
                "qualityDriftFlag": drift, "pressureLossFlag": False,
                "interpretation": "Invented measurement. Quality drift is scenario evidence; no safety threshold or pressure loss is inferred.",
                **metadata("src-sensors"),
            })

    enterprise_records = []
    for letter in "abc":
        for number, hour in enumerate([-1, 0, 1, 2], start=1):
            enterprise_records.append({"id": f"enterprise-{letter}-{number:03d}", **instant(hour), "assetId": f"workstation-{letter}", "utilityId": f"utility-{letter}", "eventType": "scheduled_health_check", "user": f"fictional-service-account-{letter}", "outcome": "success", "anomalous": False, **metadata("src-enterprise")})
    enterprise_records.sort(key=lambda row: (row["relativeTimeHours"], row["id"]))

    streams = [
        {"id": "network", "label": "Zeek-shaped network connections", "sourceRef": "src-network", "format": "zeek_conn_shaped_json", "records": network_records, **metadata("src-network")},
        {"id": "controller", "label": "Controller authentication and changes", "sourceRef": "src-controller", "format": "synthetic_controller_audit_json", "records": controller_records, **metadata("src-controller")},
        {"id": "sensors", "label": "Water-quality, pressure, and tank series", "sourceRef": "src-sensors", "format": "synthetic_sensor_json", "records": sensor_records, **metadata("src-sensors")},
        {"id": "enterprise", "label": "Enterprise IT background activity", "sourceRef": "src-enterprise", "format": "synthetic_it_audit_json", "records": enterprise_records, **metadata("src-enterprise")},
    ]
    event_specs = [
        ("event-inbound-a", "Unusual inbound connection at Utility A", -0.1, "cyber-plc-a", "unusual_inbound_connection", "network", "conn-a-unusual-001", "src-network", "A completed simulated connection to the previously exposed controller."),
        ("event-auth-a", "Controller session at Utility A", -0.05, "cyber-plc-a", "controller_authentication", "controller", "controller-auth-001", "src-controller", "Simulated successful controller authentication from the unusual source."),
        ("event-dosing", "Dosing parameter changed", 0, "cyber-plc-a", "dosing_parameter_change", "controller", "controller-change-001", "src-controller", "A dosing-setpoint change is recorded; unsafe water requires a separate explicit scenario assumption."),
        ("event-sensor", "Water-quality readings drift", 0.25, "cyber-sensor-a", "water_quality_drift", "sensors", "sensor-a-135", "src-sensors", "Synthetic quality indicator drifts after the change while pressure remains stable."),
        ("event-probe-b", "Related source probes Utility B", 0.5, "cyber-plc-b", "probing_only", "network", "conn-b-unusual-001", "src-network", "Shared source supports linking the probe to the simulated campaign. No compromise or operational loss is established at B."),
        ("event-probe-c", "Related source probes Utility C", 0.75, "cyber-plc-c", "probing_only", "network", "conn-c-unusual-001", "src-network", "Shared source supports linking the probe to the simulated campaign. No compromise or operational loss is established at C."),
    ]
    events = [{
        "id": event_id, "type": "CyberEvent", "label": label, **instant(hour), "seenOn": seen_on,
        "observation": observation, "description": description, "evidenceCategory": "simulated",
        "rawRef": {"streamId": stream_id, "recordId": record_id, "sourceRef": src}, **metadata(src),
    } for event_id, label, hour, seen_on, observation, stream_id, record_id, src, description in event_specs]

    scenarios = []
    for scenario_id, label, description, provider, service, loss, event_refs in [
        ("unsafe-water", "Unsafe-water incident", "Illustrative unsafe treated-water effect at Utility A, supported by synthetic control-change and sensor events. Stable pressure means no fire-flow loss is inferred.", "utility-a", "treated_water", "unsafe_water", ["event-dosing", "event-sensor"]),
        ("low-pressure", "Alternate pressure-loss scenario", "An independent authored pressure-loss seed. This replaces the unsafe-water seed and is not claimed to have been observed in the default sensor stream.", "utility-a", "treated_water", "low_pressure", []),
        ("power-loss", "Alternate electricity-loss cascade", "Independent authored loss at Electric Supply E. Explicit dependency conversions model electricity loss to treatment loss to no water at Utility A; no reverse propagation is allowed.", "electric-e", "electricity", "electricity_lost", []),
    ]:
        scenarios.append({
            "id": scenario_id, "label": label, "description": description, "evidenceCategory": "simulated",
            "seed": {"provider": provider, "service": service, "lossType": loss, "windowHours": [0, 1], "persistsThroughHour": 12,
                     "eventRefs": event_refs, "assumptionNote": "Explicit simulated effect and persistence; not an observed operational effect.", **metadata("src-effects")},
            **metadata("src-effects"),
        })
        assumptions.append({
            "id": f"asm-{scenario_id}-effect", "scenarioId": scenario_id, "parameter": "seed_effect_and_persistence",
            "value": {"lossType": loss, "onsetWindowHours": [0, 1], "persistsThroughHour": 12}, "unit": "scenario_hours",
            "ownerRole": "scenario_author", "reviewStatus": "synthetic_seed_only", "evidenceCategory": "simulated",
            "note": description, **metadata("src-effects"),
        })

    scenario = {
        "modelVersion": "citride-demo-interval-v1", "baselineRevision": 1, "demoMode": True,
        "generatedWithSeed": SEED, "incidentOrigin": EPOCH.isoformat().replace("+00:00", "Z"),
        "incidentOriginTimezone": "UTC", "scenarioLocalTimezone": "America/Chicago",
        "defaultScenarioId": "unsafe-water", "defaultEvaluationHour": 1, "defaultHorizonHours": 12,
        "classification": "U", "handling": ["SIMULATED"],
        "notes": [
            "Fully fictional local development demonstration; no actual utilities, facilities, credentials, operational effects, or authority approval.",
            "Seed dependency records are initialized as a local promoted baseline; this is not evidence of real operational validation.",
            "Structural and geographic relationships provide context. Only compatible directed operational dependencies propagate effects.",
            "Facility Q starts without an operational dependency in the seed baseline. Utility B/C probes do not establish compromise or outages.",
            "Service-area populations overlap facility occupants and are not impact counts. No population ranking is supplied.",
            "Raw synthetic telemetry is stored outside the scenario graph and is referenced by curated events.",
            "Recovery, unresolved cycles, and parallel supply adequacy require additional review; no resilience conclusion is inferred.",
        ],
        "entities": entities, "serviceFunctions": functions, "dependencies": dependencies, "sources": sources,
        "assumptions": assumptions, "events": events,
        "assessments": [{
            "id": "assessment-a-exposure", "type": "AssessmentFinding", "label": "Previously identified controller exposure at A",
            **instant(-168), "assetId": "plc-a", "cyberAssetId": "cyber-plc-a", "utilityId": "utility-a",
            "finding": "simulated_exposed_controller", "status": "fictional_unresolved_finding", "evidenceCategory": "simulated",
            "description": "A fictional assessment one week earlier identified inbound controller exposure. This provides context, not proof of actual vulnerability or compromise.",
            **metadata("src-assessment"),
        }],
        "scenarios": scenarios,
    }
    outputs = {"data/scenario.json": scenario}
    outputs.update({f"data/telemetry/{stream['id']}.json": stream for stream in streams})
    return outputs


def serialized(value: dict) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify tracked fixture matches the generator without changing files.")
    parser.add_argument("--output-dir", type=Path, default=ROOT, help="Repository root where generated data/ files are written or checked.")
    args = parser.parse_args()
    mismatches = []
    outputs = generate()
    for relative_path, value in outputs.items():
        path = args.output_dir / relative_path
        expected = serialized(value)
        if args.check:
            if not path.is_file() or path.read_text(encoding="utf-8") != expected:
                mismatches.append(relative_path)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8")
    if mismatches:
        print("Generated fixture differs: " + ", ".join(mismatches))
        return 1
    print(f"{'Verified' if args.check else 'Generated'} {len(outputs)} deterministic synthetic data files (seed {SEED}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

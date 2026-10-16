from copy import deepcopy
import pytest
from citride.zeek_validation import validate_demo_logs


def row():
    return {
        "_path": "conn",
        "_system_name": "w250-sensor-a",
        "_write_ts": 1791874800.0,
        "ts": 1791874800.0,
        "uid": "C0123456789ABCDEFG",
        "id.orig_h": "192.0.2.21",
        "id.orig_p": 45000,
        "id.resp_h": "192.0.2.11",
        "id.resp_p": 502,
        "proto": "tcp",
        "service": "modbus",
        "duration": 1.5,
        "orig_bytes": 64,
        "resp_bytes": 96,
        "conn_state": "SF",
        "local_orig": True,
        "local_resp": True,
        "missed_bytes": 0,
        "history": "ShADadFf",
        "orig_pkts": 4,
        "orig_ip_bytes": 224,
        "resp_pkts": 4,
        "resp_ip_bytes": 256,
        "tunnel_parents": [],
        "community_id": "1:AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "id": "validation-conn",
        "relativeTimeHours": 0,
        "utilityId": "utility-a",
        "observation": "normal_polling",
        "anomalous": False,
        "origin": "simulated",
        "sourceRefs": ["src-network"],
        "classification": "U",
        "handling": ["SIMULATED"],
    }


def test_valid_documentation_range_record_and_unknown_fields_are_preserved():
    value = row()
    value["future_field"] = {"unchanged": True}
    original = deepcopy(value)
    assert validate_demo_logs({"conn": [value]}) == []
    assert value == original


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("_path", "ssl", "path"),
        ("origin", "observed", "origin"),
        ("id.orig_h", "10.0.0.1", "address"),
        ("uid", "SIMBASE1", "uid"),
        ("community_id", "fake", "community_id"),
        ("_system_name", "sensor-a", "sensor"),
        ("anomalous", True, "interpretation"),
    ],
)
def test_invalid_generated_fields_are_rejected_with_record_identity(field, value, code):
    value0 = row()
    value0[field] = value
    errors = validate_demo_logs({"conn": [value0]})
    assert any(e["code"] == code and e["recordId"] == "validation-conn" for e in errors)


def test_required_standard_fields_cannot_be_dropped():
    value = row()
    del value["conn_state"]
    assert any(
        e["code"] == "required" and e["field"] == "conn_state"
        for e in validate_demo_logs({"conn": [value]})
    )


def test_dns_names_and_answer_addresses_use_reserved_ranges():
    value = row()
    value.update(
        _path="dns",
        query="example.org",
        answers=["10.0.0.2"],
        TTLs=[60],
        qtype_name="A",
        rcode_name="NOERROR",
    )
    errors = validate_demo_logs({"dns": [value]})
    assert any(e["code"] == "name" for e in errors)
    assert any(e["code"] == "address" for e in errors)


def test_generated_baseline_and_exact_vendor_dns_write_contract():
    from pathlib import Path
    import json
    from citride.validation import validate_baseline

    root = Path(__file__).resolve().parents[2]
    baseline = json.loads((root / "data/scenario.json").read_text())
    assert validate_baseline(baseline) == []
    vpn = json.loads((root / "data/telemetry/corelight/vpn.json").read_text())
    assert len(vpn) == 3 and {r["utilityId"] for r in vpn} == {"utility-a"}
    assert all(r["result"] == "success" for r in vpn)
    dns = json.loads((root / "data/telemetry/corelight/dns.json").read_text())
    assert {r["id.resp_h"] for r in dns} == {"192.0.2.53"}
    detailed = json.loads(
        (root / "data/telemetry/corelight/modbus_detailed.json").read_text()
    )
    write = next(r for r in detailed if r["func"] == "WRITE_SINGLE_REGISTER")
    assert "dosing setpoint" in write["interpretation"].lower()


def test_actual_generated_streams_and_all_event_references_validate():
    from pathlib import Path
    import json
    from citride.zeek_logs import load_zeek_json

    root = Path(__file__).resolve().parents[2]
    logs = load_zeek_json(root / "data/telemetry/corelight")
    for name in ("controller", "sensors", "enterprise"):
        logs[name] = json.loads((root / f"data/telemetry/{name}.json").read_text())[
            "records"
        ]
    events = json.loads((root / "data/scenario.json").read_text())["events"]
    assert validate_demo_logs(logs, events, require_all=True) == []


def test_event_raw_and_supplemental_refs_must_resolve_in_exact_stream():
    logs = {"conn": [row()], "controller": [{"id": "controller-change-001"}]}
    event = {
        "id": "event-dosing",
        "rawRef": {"streamId": "controller", "recordId": "controller-change-001"},
        "networkEvidenceRefs": [
            {"streamId": "corelight/conn", "recordId": "validation-conn"}
        ],
    }
    assert validate_demo_logs(logs, [event]) == []
    event["networkEvidenceRefs"][0]["recordId"] = "missing"
    assert any(
        e["code"] == "raw_reference" and e["recordId"] == "event-dosing"
        for e in validate_demo_logs(logs, [event])
    )

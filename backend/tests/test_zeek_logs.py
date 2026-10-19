"""Metadata-free export-shaped inputs are fictional, not a partner capture."""
from collections import Counter
import importlib.util
import ipaddress
import json
from pathlib import Path
import shutil

from fastapi.testclient import TestClient
import pytest

from citride.api import create_app

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).parent / "fixtures/corelight-real-export.jsonl"
LOGS = ("conn", "ssl", "http", "dns", "modbus", "modbus_detailed", "notice", "vpn")
COUNTS = {"conn": 5, "ssl": 3, "http": 3, "dns": 3, "modbus": 2, "modbus_detailed": 2, "notice": 2}


def reader(directory):
    from citride.zeek_logs import load_zeek_json
    return load_zeek_json(directory)


def fixture_rows():
    return [json.loads(line) for line in FIXTURE.read_text().splitlines()]


def scenario_tree(tmp_path):
    root = tmp_path / "inputs"
    root.mkdir()
    shutil.copyfile(ROOT / "data/scenario.json", root / "scenario.json")
    (root / "telemetry/corelight").mkdir(parents=True)
    for name in ("network", "controller", "sensors", "enterprise"):
        shutil.copyfile(ROOT / f"data/telemetry/{name}.json", root / f"telemetry/{name}.json")
    return root


def test_twenty_export_rows_have_only_documentation_addresses_and_no_mapping():
    rows = fixture_rows()
    assert len(rows) == 20
    assert Counter(row["_path"] for row in rows) == COUNTS
    forbidden = {"id", "origin", "utilityId", "targetAssetId", "sharedSourceIdentity", "relativeTimeHours", "observation", "anomalous", "interpretation", "sourceRefs", "classification", "handling"}
    networks = [ipaddress.ip_network(value) for value in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24")]
    for row in rows:
        assert not forbidden.intersection(row)
        for key in ("id.orig_h", "id.resp_h", "src", "dst"):
            if key in row:
                assert any(ipaddress.ip_address(row[key]) in net for net in networks)


@pytest.mark.parametrize("array", [False, True])
def test_reader_preserves_all_twenty_records_grouping_and_unknown_fields(tmp_path, array):
    rows = fixture_rows()
    (tmp_path / ("export.json" if array else "export.jsonl")).write_text(json.dumps(rows) if array else FIXTURE.read_text())
    (tmp_path / "manifest.json").write_text('{"not":"a log"}')
    grouped = reader(tmp_path)
    assert {key: len(value) for key, value in grouped.items()} == COUNTS
    assert grouped == {name: [row for row in rows if row["_path"] == name] for name in COUNTS}
    grouped["conn"][0]["custom"]["preserved"] = False
    assert reader(tmp_path)["conn"][0]["custom"] == {"preserved": True}


def test_reader_filename_fallback_mixed_paths_and_blank_lines(tmp_path):
    (tmp_path / "conn.log.jsonl").write_text('\n{"uid":"one","extra":[1]}\n\n{"_path":"dns","query":"name.example"}\n')
    (tmp_path / "empty.json").write_text("[]")
    assert reader(tmp_path) == {"conn": [{"uid": "one", "extra": [1]}], "dns": [{"_path": "dns", "query": "name.example"}], "empty": []}
    assert reader(tmp_path / "missing") == {}


@pytest.mark.parametrize("content", ['[1]', '{"_path": []}', '{broken', '{"uid":1}\nnot-json'])
def test_reader_rejects_invalid_input_without_printing_records(tmp_path, content):
    (tmp_path / "conn.json").write_text(content)
    with pytest.raises(ValueError, match="conn.json"):
        reader(tmp_path)


def test_api_real_export_keeps_twenty_records_unmapped_without_simulated_origin(tmp_path):
    root = scenario_tree(tmp_path)
    shutil.copyfile(FIXTURE, root / "telemetry/corelight/export.jsonl")
    with TestClient(create_app(tmp_path / "state", root / "scenario.json")) as client:
        response = client.get("/v1/telemetry")
    assert response.status_code == 200, response.text
    streams = {stream["id"]: stream for stream in response.json()["streams"]}
    assert set(streams) == {f"corelight/{name}" for name in COUNTS} | {"controller", "sensors", "enterprise"}
    assert {name: len(streams[f"corelight/{name}"]["records"]) for name in COUNTS} == COUNTS
    for name in COUNTS:
        stream = streams[f"corelight/{name}"]
        assert stream["format"] == "corelight_zeek_json"
        assert stream["sourceRef"] == "src-network"
        assert "origin" not in stream and "simulated" not in stream["label"]
        assert stream["records"] == [row for row in fixture_rows() if row["_path"] == name]


def test_api_all_eight_generated_streams_and_legacy_compatibility(tmp_path):
    root = scenario_tree(tmp_path)
    with TestClient(create_app(tmp_path / "legacy-state", root / "scenario.json")) as client:
        assert "network" in {s["id"] for s in client.get("/v1/telemetry").json()["streams"]}
    for name in LOGS:
        (root / f"telemetry/corelight/{name}.json").write_text(json.dumps([{"_path": name, "origin": "simulated", "id": name, "extra": 7}]))
    (root / "telemetry/corelight/manifest.json").write_text('{"counts":{}}')
    with TestClient(create_app(tmp_path / "state", root / "scenario.json")) as client:
        streams = {s["id"]: s for s in client.get("/v1/telemetry").json()["streams"]}
    assert len(streams) == 11 and "network" not in streams
    for name in LOGS:
        stream = streams[f"corelight/{name}"]
        assert stream["origin"] == "simulated"
        assert stream["format"] == ("synthetic_vpn_auth_json" if name == "vpn" else "corelight_zeek_json")
        assert stream["label"] == ("VPN log (simulated)" if name == "vpn" else f"Network · Corelight format (simulated) · {name}")
        assert stream["records"] == [{"_path": name, "origin": "simulated", "id": name, "extra": 7}]


def test_real_and_simulated_mix_does_not_label_entire_stream_simulated(tmp_path):
    root = scenario_tree(tmp_path)
    rows = [{"_path": "conn", "origin": "simulated"}, {"_path": "conn", "uid": "unmapped"}]
    (root / "telemetry/corelight/conn.json").write_text(json.dumps(rows))
    with TestClient(create_app(tmp_path / "state", root / "scenario.json")) as client:
        stream = next(s for s in client.get("/v1/telemetry").json()["streams"] if s["id"] == "corelight/conn")
    assert "origin" not in stream and "simulated" not in stream["label"]
    assert stream["records"] == rows


def test_source_packaging_copies_all_logs_and_manifest_with_safe_counts(tmp_path, monkeypatch, capsys):
    spec = importlib.util.spec_from_file_location("prepare_vercel_test", ROOT / "backend/scripts/prepare_vercel.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source, target = tmp_path / "data", tmp_path / "bundle"
    for filename in module.FILES:
        path = source / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}")
    # Test manifest-driven source packaging with valid, independent fixtures.
    manifest = {"records": ["records.json"], "models": ["model.json"], "reference": "c4.json"}
    (source / "scripted/sources.json").write_text(json.dumps(manifest))
    for name in manifest["records"] + manifest["models"] + [manifest["reference"]]:
        (source / "scripted" / name).write_text(json.dumps({"fixture": name}))
    corelight = source / "telemetry/corelight"
    corelight.mkdir(parents=True, exist_ok=True)
    for name in LOGS:
        (corelight / f"{name}.json").write_text(json.dumps([{"_path": name, "origin": "simulated", "sentinel": "never-print-records"}]))
    (corelight / "manifest.json").write_text('{"counts":{}}')
    shutil.copyfile(FIXTURE, corelight / "extra.jsonl")
    monkeypatch.setattr(module, "DATA_ROOT", source)
    monkeypatch.setattr(module, "TARGET_ROOT", target)
    stale = target / "telemetry/corelight/stale.jsonl"
    stale.parent.mkdir(parents=True)
    stale.write_text('{"_path":"conn","sentinel":"stale"}')
    module.main()
    for name in manifest["records"] + manifest["models"] + [manifest["reference"]]:
        assert (target / "scripted" / name).read_bytes() == (source / "scripted" / name).read_bytes()
    assert sorted(p.name for p in (target / "telemetry/corelight").iterdir()) == sorted(p.name for p in corelight.iterdir())
    assert reader(target / "telemetry/corelight") == reader(corelight)
    output = capsys.readouterr().out
    assert "never-print-records" not in output and "192.0.2." not in output
    assert '"conn": 6' in output and '"vpn": 1' in output

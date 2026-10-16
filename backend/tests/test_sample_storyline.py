from pathlib import Path
from copy import deepcopy
import importlib.util
import json
import zipfile
import pytest
from citride.engine import compute_run

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "sample_generator", ROOT / "scripts/generate_demo_data.py"
)
assert spec is not None and spec.loader is not None
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def data():
    value = generator.generate()["data/scenario.json"]
    value["baselineRevision"] = 1
    return value


def test_all_nine_story_entities_use_exact_canonical_assignments():
    b = data()
    entities = {r["id"]: r for r in b["entities"]}
    ref = json.loads((ROOT / "data/reference/idt/idt_v4.json").read_text())
    assert len(entities) == 67
    for identifier in [
        "vpn-a",
        "vpn-b",
        "vpn-c",
        "cyber-vpn-a",
        "cyber-vpn-b",
        "cyber-vpn-c",
        "vendor-v",
        "hospital-w",
        "dialysis-u",
    ]:
        assert entities[identifier]["idt"] == ref["assignments"][identifier]
    assert entities["vendor-v"]["supportAccountAt"] == ["org-a", "org-b", "org-c"]
    assert (
        entities["hospital-w"]["locatedIn"] == "area-b"
        and entities["dialysis-u"]["locatedIn"] == "area-c"
    )


def test_added_dependencies_scenarios_have_no_event_link():
    b = data()
    assert len(b["dependencies"]) == 8
    assert {"hospital-sterilization-w", "dialysis-treatment-u"} <= {
        r["id"] for r in b["serviceFunctions"]
    }
    for suffix in "bc":
        s = next(
            r for r in b["scenarios"] if r["id"] == f"potential-unsafe-water-{suffix}"
        )
        assert (
            s["seed"]["provider"] == f"utility-{suffix}"
            and s["seed"]["eventRefs"] == []
        )
        assert s["evidenceCategory"] == "simulated"


def test_all_events_have_verified_technique_metadata_and_vpn_predicate():
    b = data()
    for event in b["events"]:
        assert event["attackTechniques"] and all(
            set(t) == {"id", "name", "tactic"} for t in event["attackTechniques"]
        )
    assert (
        next(e for e in b["events"] if e["id"] == "event-vpn-a")["observation"]
        == "vendor_vpn_login_off_hours"
    )
    for probe in ["event-probe-b", "event-probe-c"]:
        assert not any(probe in s["seed"]["eventRefs"] for s in b["scenarios"])


@pytest.mark.parametrize(
    "scenario,expected",
    [
        (
            "unsafe-water",
            {"dialysis-x": [2, 4], "hospital-y": [4, 8], "nursing-z": [1, 4]},
        ),
        ("potential-unsafe-water-b", {"hospital-w": [4, 8]}),
        ("potential-unsafe-water-c", {"dialysis-u": [2, 4]}),
    ],
)
def test_actual_engine_windows_and_potential_isolation(scenario, expected):
    b = data()
    run = compute_run(
        deepcopy(b),
        {
            "scenarioId": scenario,
            "evaluationHour": 1,
            "horizonHours": 12,
            "overrides": [],
        },
        "test-" + scenario,
    )
    assert {r["entityId"]: r["windowHours"] for r in run["impacts"]} == expected


@pytest.mark.parametrize(
    "bad",
    [
        None,
        True,
        {},
        [{}],
        [{"id": "", "name": "x", "tactic": "x"}],
        [{"id": "T0836", "name": [], "tactic": "x"}],
    ],
)
def test_invalid_technique_shapes_are_rejected(bad):
    from citride.validation import validate_baseline

    baseline = data()
    baseline["events"][0]["attackTechniques"] = bad
    assert any("attackTechniques" in error for error in validate_baseline(baseline))


def test_authoritative_files_are_byte_identical_to_uploaded_files():
    attachment = Path(
        "/home/gphreakx/.hermes/cache/documents/doc_5996119583db_Sample_Data_Fix.zip"
    )
    if not attachment.exists():
        pytest.skip("Original attachment comparison is an operator acceptance check")
    with zipfile.ZipFile(attachment) as z:
        assert (ROOT / "data/scripted/watershed_beta.json").read_bytes() == z.read(
            "data/scripted/watershed_beta.json"
        )
        assert (ROOT / "data/reference.json").read_bytes() == z.read(
            "data/scripted/reference.json"
        )

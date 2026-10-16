"""Contract regressions for canonical generated IDT and strict baseline records."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path

import pytest

from citride.validation import validate_baseline

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("idt_demo_generator", ROOT / "scripts/generate_demo_data.py")
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)
REFERENCE = json.loads((ROOT / "data/reference/idt/idt_v4.json").read_text(encoding="utf-8"))


@pytest.fixture
def baseline():
    data = generator.generate()["data/scenario.json"]
    # Isolate IDT validation from the independently covered dependency/SHACL gate.
    data["dependencies"] = []
    for entity in data["entities"]:
        entity["idt"] = deepcopy(REFERENCE["assignments"][entity["id"]])
    return data


def idt_errors(data):
    return [error for error in validate_baseline(data) if "idt" in error.lower()]


def test_all_generated_assignments_equal_canonical_reference_including_gateway_story():
    data = generator.generate()["data/scenario.json"]
    assert len(data["entities"]) == 67  # All explicitly authorized storyline records.
    assert len(REFERENCE["assignments"]) == 67
    assert set(REFERENCE["assignments"]) == {entity["id"] for entity in data["entities"]}
    for entity in data["entities"]:
        assert entity.get("idt") == REFERENCE["assignments"][entity["id"]], entity["id"]
    assert next(entity for entity in data["entities"] if entity["id"] == "org-electric-e")["idt"] == {"status": "unassigned"}
    assert validate_baseline(data) == []


def test_generated_assignments_are_detached_and_follow_reference_not_a_second_map(tmp_path, monkeypatch):
    reference = deepcopy(REFERENCE)
    reference["assignments"]["utility-a"] = {"status": "coded", "path": "12.4"}
    reference_path = tmp_path / "data/reference/idt/idt_v4.json"
    reference_path.parent.mkdir(parents=True)
    reference_path.write_text(json.dumps(reference), encoding="utf-8")
    monkeypatch.setattr(generator, "ROOT", tmp_path)
    data = generator.generate()["data/scenario.json"]
    utility = next(entity for entity in data["entities"] if entity["id"] == "utility-a")
    assert utility.get("idt") == reference["assignments"]["utility-a"]
    utility["idt"]["path"] = "1"
    assert next(entity for entity in generator.generate()["data/scenario.json"]["entities"] if entity["id"] == "utility-a")["idt"]["path"] == "12.4"
    assert reference["assignments"]["utility-a"]["path"] == "12.4"


def test_generator_registers_reference_source_without_replacing_inventory_provenance():
    data = generator.generate()["data/scenario.json"]
    sources = {source["id"]: source for source in data["sources"]}
    assert sources["src-idt-v4"]["title"] == "Infrastructure Data Taxonomy v4, 22 Jun 2011"
    assert sources["src-idt-v4"]["evidenceCategory"] == "reference"
    assert sources["src-inventory"]["evidenceCategory"] == "simulated"
    for entity in data["entities"]:
        assert entity["sourceRefs"] == ["src-inventory", "src-idt-v4"]
    assert data["dependencies"][0]["sourceRefs"] == ["src-dependencies"]


def test_valid_all_four_statuses_do_not_mutate_baseline(baseline):
    before = deepcopy(baseline)
    assert {entity["idt"]["status"] for entity in baseline["entities"]} == {"coded", "below_idt_level", "not_idt_asset", "unassigned"}
    assert validate_baseline(baseline) == []
    assert baseline == before


def test_idt_is_required_on_every_entity_including_invalid_identifier(baseline):
    for entity in baseline["entities"]:
        entity.pop("idt")
    baseline["entities"][0]["id"] = "invalid/id"
    errors = idt_errors(baseline)
    assert len(errors) == len(baseline["entities"])
    assert all("required" in error for error in errors)


@pytest.mark.parametrize("value", [None, [], "coded", 1, True, {}])
def test_idt_requires_an_object_with_a_status(baseline, value):
    baseline["entities"][0]["idt"] = value
    assert idt_errors(baseline)


@pytest.mark.parametrize("status", [None, [], {}, 1, True, "", "CODED", "unknown"])
def test_unknown_and_nonstring_statuses_are_rejected_without_crashing(baseline, status):
    baseline["entities"][0]["idt"] = {"status": status}
    assert idt_errors(baseline)


VALID_SHAPES = [
    {"status": "coded", "path": "12.4"},
    {"status": "below_idt_level", "parentEntity": "plant-a", "parentPath": "12.4"},
    {"status": "not_idt_asset", "reason": "cyber_identity"},
    {"status": "unassigned"},
]


@pytest.mark.parametrize("assignment", VALID_SHAPES)
def test_all_four_exact_structural_shapes_are_accepted(baseline, assignment):
    baseline["entities"][0]["idt"] = deepcopy(assignment)
    assert validate_baseline(baseline) == []


@pytest.mark.parametrize("assignment,field", [
    (assignment, field)
    for assignment in VALID_SHAPES
    for field in ("extra", "path", "parentEntity", "parentPath", "reason")
    if field not in assignment
])
def test_fields_not_in_the_selected_status_shape_are_rejected(baseline, assignment, field):
    baseline["entities"][0]["idt"] = {**assignment, field: "unexpected"}
    assert idt_errors(baseline)


@pytest.mark.parametrize("assignment,field", [
    ({"status": "coded", "path": "12.4"}, "path"),
    ({"status": "below_idt_level", "parentEntity": "plant-a", "parentPath": "12.4"}, "parentEntity"),
    ({"status": "below_idt_level", "parentEntity": "plant-a", "parentPath": "12.4"}, "parentPath"),
    ({"status": "not_idt_asset", "reason": "cyber_identity"}, "reason"),
])
def test_each_status_requires_its_structural_fields(baseline, assignment, field):
    assignment.pop(field)
    baseline["entities"][0]["idt"] = assignment
    assert idt_errors(baseline)


@pytest.mark.parametrize("path", [None, [], {}, True, 12.4, "", "12.9999", "99", "12.04", "12.4 ", "12..4", "12.4.0", "8.8000000000000007"])
@pytest.mark.parametrize("status,field", [("coded", "path"), ("below_idt_level", "parentPath")])
def test_paths_must_be_exact_canonical_reference_paths(baseline, status, field, path):
    assignment = {"status": status, field: path}
    if status == "below_idt_level":
        assignment["parentEntity"] = "plant-a"
    baseline["entities"][0]["idt"] = assignment
    assert idt_errors(baseline)


@pytest.mark.parametrize("parent", [None, [], {}, True, 1, "", "bad/id", "missing-parent", "org-a", "src-inventory"])
def test_below_level_parent_is_safe_existing_entity_and_not_self(baseline, parent):
    baseline["entities"][0]["idt"] = {"status": "below_idt_level", "parentEntity": parent, "parentPath": "12.4"}
    assert idt_errors(baseline)


@pytest.mark.parametrize("reason", ["cyber_identity", "service_area", "population_group"])
def test_supported_not_asset_reasons_are_accepted(baseline, reason):
    baseline["entities"][0]["idt"] = {"status": "not_idt_asset", "reason": reason}
    assert validate_baseline(baseline) == []


@pytest.mark.parametrize("reason", [None, [], {}, True, 1, "", "unknown", "Cyber_Identity", "cyber_identity "])
def test_not_asset_reason_is_a_constrained_string(baseline, reason):
    baseline["entities"][0]["idt"] = {"status": "not_idt_asset", "reason": reason}
    assert idt_errors(baseline)


def test_reference_evidence_category_is_accepted_without_weakening_unknown_category_checks(baseline):
    baseline["sources"][0]["evidenceCategory"] = "reference"
    assert validate_baseline(baseline) == []
    baseline["sources"][0]["evidenceCategory"] = "unsupported"
    assert any("evidenceCategory" in error for error in validate_baseline(baseline))

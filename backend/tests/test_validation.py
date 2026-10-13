from copy import deepcopy

import pytest
from pyshacl import validate as shacl_validate
from rdflib import RDF, URIRef

from citride.validation import NS, _SHAPE_GRAPH, dependency_graph, validate_baseline, validate_dependency


@pytest.fixture
def baseline():
    simulated = {"classification": "U", "handling": ["SIMULATED"]}
    sourced = {**simulated, "sourceRefs": ["src-assumptions"]}
    dependency = {
        "id": "dep-water-hospital", "revision": 1,
        "provider": "utility-a", "dependent": "hospital", "requiredService": "treated_water",
        "dependentFunction": "hospital-sterilization", "dependencyType": "physical", "coupling": "tight",
        "lossTypes": ["unsafe_water"], "propagationDelayMinHours": 0, "propagationDelayMaxHours": 1,
        "usableBackupMinHours": 4, "usableBackupMaxHours": 6, "validForLossTypes": ["unsafe_water"],
        "lossOfFunction": 1, "outputLossType": None,
        "assumptionNote": "Invented independent clean-water reserve for this demonstration.", **sourced,
    }
    return {
        "entities": [
            {"id": "utility-a", "type": "WaterServiceProvider", "label": "Utility A", **sourced},
            {"id": "hospital", "type": "Hospital", "label": "Hospital", **sourced},
            {"id": "plc-a", "type": "PLC", "label": "Controller", "partOf": "utility-a", **sourced},
        ],
        "serviceFunctions": [
            {"id": "water-a", "facility": "utility-a", "service": "treated_water", **sourced},
            {"id": "hospital-sterilization", "facility": "hospital", "service": "sterilization_support", **sourced},
        ],
        "dependencies": [dependency],
        "sources": [{"id": "src-assumptions", "title": "Synthetic assumptions", "evidenceCategory": "simulated", **simulated}],
        "assumptions": [], "events": [{"id": "evt-change", **sourced}], "assessments": [],
        "scenarios": [{"id": "unsafe-water", "label": "Unsafe water", **sourced,
            "seed": {"provider": "utility-a", "service": "treated_water", "lossType": "unsafe_water",
                     "windowHours": [0, 1], "persistsThroughHour": 12, "sourceRefs": ["src-assumptions"],
                     "eventRefs": ["evt-change"]}}],
        "defaultScenarioId": "unsafe-water",
    }


def test_valid_dependency_and_baseline(baseline):
    before = deepcopy(baseline)
    assert validate_dependency(baseline["dependencies"][0], baseline) == []
    assert validate_baseline(baseline) == []
    assert baseline == before


@pytest.mark.parametrize(("field", "value", "message"), [
    ("provider", ["utility-a", "hospital"], "exactly one"),
    ("dependent", "plc-a", "physical facility"),
    ("dependentFunction", "water-a", "belong to dependent"),
    ("requiredService", "electricity", "provider must offer"),
    ("lossTypes", ["electricity_lost"], "compatible with requiredService"),
    ("validForLossTypes", ["low_pressure"], "subset of lossTypes"),
    ("sourceRefs", ["missing-source"], "unknown or invalid source"),
    ("assumptionNote", "   ", "nonblank"),
    ("id", "unsafe/id", "safe, nonempty"),
    ("revision", True, "positive integer"),
    ("dependencyType", "geographic", "physical for consequence"),
    ("lossOfFunction", 1.1, "between 0 and 1"),
    ("lossOfFunction", True, "between 0 and 1"),
    ("propagationDelayMinHours", float("nan"), "finite numbers"),
    ("propagationDelayMaxHours", float("inf"), "finite numbers"),
    ("usableBackupMinHours", None, "two null values"),
    ("usableBackupMinHours", 7, "nonnegative and ordered"),
    ("handling", [], "include SIMULATED"),
    ("classification", "S", "classification must be U"),
])
def test_invalid_domain_records_return_errors(baseline, field, value, message):
    dependency = deepcopy(baseline["dependencies"][0])
    dependency[field] = value
    assert any(message in error for error in validate_dependency(dependency, baseline))


def test_unknown_backup_is_not_zero_and_optional_multi_supply_survives(baseline):
    dependency = baseline["dependencies"][0]
    dependency.update(usableBackupMinHours=None, usableBackupMaxHours=None, supplyGroup="hospital-water", multiSupply=True)
    before = deepcopy(dependency)
    assert validate_dependency(dependency, baseline) == []
    assert dependency == before


def test_terminal_functions_cannot_emit_unconfigured_service_loss(baseline):
    dependency = baseline["dependencies"][0]
    dependency["outputLossType"] = "electricity_lost"
    errors = validate_dependency(dependency, baseline)
    assert "outputLossType must be null for a terminal dependentFunction service" in errors


def test_explicit_dependency_can_be_authored_for_spatial_only_healthcare_candidate(baseline):
    sourced = {"sourceRefs": ["src-assumptions"], "classification": "U", "handling": ["SIMULATED"]}
    baseline["entities"].append({"id": "facility-q", "type": "HealthcareFacility", "label": "Facility Q", **sourced})
    baseline["serviceFunctions"].append({"id": "q-safe-water", "facility": "facility-q", "service": "safe_water_support", **sourced})
    # A function on a candidate facility does not itself assert an operational
    # dependency. An explicitly authored physical link is valid once added.
    assert all(link["dependent"] != "facility-q" for link in baseline["dependencies"])
    dependency = deepcopy(baseline["dependencies"][0])
    dependency.update(id="dep-a-q", dependent="facility-q", dependentFunction="q-safe-water")
    assert validate_dependency(dependency, baseline) == []
    baseline["dependencies"].append(dependency)
    assert validate_baseline(baseline) == []


def test_unknown_fields_and_missing_required_fields(baseline):
    dependency = baseline["dependencies"][0]
    dependency.pop("usableBackupMaxHours")
    dependency["providerOverride"] = "hospital"
    errors = validate_dependency(dependency, baseline)
    assert "usableBackupMaxHours is required" in errors
    assert "unsupported dependency field: providerOverride" in errors


def test_shacl_independently_rejects_multiple_providers(baseline):
    graph = dependency_graph(baseline["dependencies"][0], baseline)
    dependency_node = next(graph.subjects(RDF.type, NS.Dependency))
    hospital_node = URIRef("urn:citride:record:hospital")
    graph.add((dependency_node, NS.provider, hospital_node))
    conforms, _, _ = shacl_validate(graph, shacl_graph=_SHAPE_GRAPH)
    assert not conforms


def test_baseline_checks_source_identity_and_seed_evidence(baseline):
    baseline["entities"][0]["partOf"] = "missing-plant"
    baseline["scenarios"][0]["seed"]["eventRefs"] = ["missing-event"]
    baseline["scenarios"][0]["seed"]["persistsThroughHour"] = 0.5
    baseline["defaultScenarioId"] = "missing-scenario"
    errors = validate_baseline(baseline)
    assert any("unknown entity reference" in error for error in errors)
    assert any("existing events" in error for error in errors)
    assert any("persistence cannot precede" in error for error in errors)
    assert any("defaultScenarioId" in error for error in errors)


def test_baseline_checks_malformed_data_without_crashing(baseline):
    baseline["entities"][0]["type"] = []
    baseline["serviceFunctions"][0]["service"] = {}
    baseline["dependencies"].append([])
    assert validate_baseline(baseline)


def test_duplicate_baseline_ids_are_rejected(baseline):
    baseline["entities"].append(deepcopy(baseline["entities"][0]))
    assert any("duplicate id" in error for error in validate_baseline(baseline))

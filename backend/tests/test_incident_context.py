"""Read-only incident context and conservative document-bridge regression checks."""

from copy import deepcopy
import json
from pathlib import Path

import pytest

from citride.incident_context import incident_context


REPO = Path(__file__).resolve().parents[2]


@pytest.fixture
def baseline():
    return json.loads((REPO / "data" / "scenario.json").read_text())


def entity(data, identifier):
    return next(item for item in data["entities"] if item["id"] == identifier)


def ids(records):
    return [record["id"] for record in records]


def test_exact_a_context_and_original_record_metadata(baseline):
    result = incident_context(baseline, "event-dosing")
    assert set(result) == {
        "baselineRevision", "event", "cyberAsset", "physicalAsset", "facility",
        "provider", "serviceArea", "downstreamDependencies", "scenarios",
        "sourceRefs", "warnings",
    }
    assert result["baselineRevision"] == baseline["baselineRevision"]
    assert [result[key]["id"] for key in (
        "cyberAsset", "physicalAsset", "facility", "provider", "serviceArea",
    )] == ["cyber-plc-a", "plc-a", "plant-a", "utility-a", "area-a"]
    assert result["event"] == next(e for e in baseline["events"] if e["id"] == "event-dosing")
    for key in ("cyberAsset", "physicalAsset", "facility", "provider", "serviceArea"):
        assert result[key] == entity(baseline, result[key]["id"])
    assert ids(result["scenarios"]) == ["unsafe-water"]
    assert result["scenarios"][0] == baseline["scenarios"][0]
    assert {item["dependency"]["id"] for item in result["downstreamDependencies"]} == {
        "dep-a-x", "dep-a-y", "dep-a-z", "dep-a-f",
    }
    for item in result["downstreamDependencies"]:
        dep = item["dependency"]
        assert set(item) == {"dependency", "dependent", "function"}
        assert dep in baseline["dependencies"]
        assert item["dependent"] == entity(baseline, dep["dependent"])
        assert item["function"] in baseline["serviceFunctions"]
        assert item["function"]["facility"] == dep["dependent"]
    assert set(result["sourceRefs"]) == {"src-controller", "src-inventory", "src-dependencies", "src-effects"}
    assert len(result["sourceRefs"]) == len(set(result["sourceRefs"]))
    assert any("provisional" in warning.lower() for warning in result["warnings"])
    assert any("assumption" in warning.lower() and "outage" in warning.lower() for warning in result["warnings"])


@pytest.mark.parametrize("suffix", ["b", "c"])
def test_probe_context_is_isolated_and_does_not_inherit_a_scenarios(baseline, suffix):
    result = incident_context(baseline, f"event-probe-{suffix}")
    assert [result[key]["id"] for key in (
        "cyberAsset", "physicalAsset", "facility", "provider", "serviceArea",
    )] == [f"cyber-plc-{suffix}", f"plc-{suffix}", f"plant-{suffix}", f"utility-{suffix}", f"area-{suffix}"]
    assert result["scenarios"] == []
    assert result["downstreamDependencies"] == []
    assert "src-effects" not in result["sourceRefs"]
    assert any("No scenario" in warning for warning in result["warnings"])


def test_geography_and_shared_sources_do_not_create_dependency(baseline):
    q = entity(baseline, "facility-q")
    assert q["locatedIn"] == "area-a"
    result = incident_context(baseline, "event-dosing")
    assert "facility-q" not in {item["dependent"]["id"] for item in result["downstreamDependencies"]}
    baseline["dependencies"] = []
    assert incident_context(baseline, "event-dosing")["downstreamDependencies"] == []


@pytest.mark.parametrize("event_id", ["event-inbound-a", "event-auth-a"])
def test_same_asset_without_exact_event_association_has_no_consequence(baseline, event_id):
    result = incident_context(baseline, event_id)
    assert result["provider"]["id"] == "utility-a"
    assert result["scenarios"] == []


def test_event_refs_are_exact_not_substrings_or_shared_provenance(baseline):
    baseline["scenarios"][0]["seed"]["eventRefs"] = ["event-dosing-extra"]
    baseline["scenarios"][1]["seed"]["eventRefs"] = "event-dosing"
    result = incident_context(baseline, "event-dosing")
    assert result["scenarios"] == []
    assert any("eventRefs" in warning for warning in result["warnings"])


@pytest.mark.parametrize("mode", ["forward", "inverse", "both"])
def test_explicit_hosting_directions_are_supported(baseline, mode):
    if mode == "forward":
        entity(baseline, "plc-a").pop("hostsCyberAsset")
    elif mode == "inverse":
        entity(baseline, "cyber-plc-a").pop("hostedBy")
    result = incident_context(baseline, "event-dosing")
    assert result["physicalAsset"]["id"] == "plc-a"
    assert result["provider"]["id"] == "utility-a"


def test_conflicting_hosting_withholds_the_whole_structural_context(baseline):
    entity(baseline, "cyber-plc-a")["hostedBy"] = "plc-b"
    result = incident_context(baseline, "event-dosing")
    assert result["cyberAsset"]["id"] == "cyber-plc-a"
    assert all(result[key] is None for key in ("physicalAsset", "facility", "provider", "serviceArea"))
    assert result["downstreamDependencies"] == []
    assert any("hosting" in warning.lower() and "conflict" in warning.lower() for warning in result["warnings"])


def test_multiple_inverse_hosts_are_ambiguous(baseline):
    entity(baseline, "plc-b")["hostsCyberAsset"] = "cyber-plc-a"
    result = incident_context(baseline, "event-dosing")
    assert result["physicalAsset"] is None
    assert any("hosting" in warning.lower() for warning in result["warnings"])


@pytest.mark.parametrize("field,record_id,target,missing_keys", [
    ("seenOn", "event-dosing", "missing", ["cyberAsset", "physicalAsset", "facility", "provider", "serviceArea"]),
    ("hostedBy", "cyber-plc-a", "missing", ["physicalAsset", "facility", "provider", "serviceArea"]),
    ("partOf", "plc-a", "missing", ["facility", "provider", "serviceArea"]),
    ("serves", "utility-a", "missing", ["serviceArea"]),
])
def test_dangling_references_are_reported_without_fabricating(baseline, field, record_id, target, missing_keys):
    records = baseline["events"] if field == "seenOn" else baseline["entities"]
    next(item for item in records if item["id"] == record_id)[field] = target
    result = incident_context(baseline, "event-dosing")
    assert all(result[key] is None for key in missing_keys)
    assert any("unknown" in warning.lower() and field in warning for warning in result["warnings"])


@pytest.mark.parametrize("record_id,parent", [("plant-a", "plc-a"), ("utility-a", "plant-a"), ("plc-a", "plc-a")])
def test_containment_cycles_terminate_and_withhold_derived_context(baseline, record_id, parent):
    entity(baseline, record_id)["partOf"] = parent
    result = incident_context(baseline, "event-dosing")
    assert result["physicalAsset"]["id"] == "plc-a"
    assert result["facility"] is None
    assert result["provider"] is None
    assert result["downstreamDependencies"] == []
    assert any("cycle" in warning.lower() for warning in result["warnings"])


def test_ambiguous_structural_parents_are_not_arbitrarily_chosen(baseline):
    entity(baseline, "plc-a")["partOf"] = ["plant-a", "plant-b"]
    result = incident_context(baseline, "event-dosing")
    assert result["facility"] is None
    assert result["provider"] is None
    assert any("ambiguous" in warning.lower() for warning in result["warnings"])


def test_operator_is_not_a_service_provider_and_geography_is_not_containment(baseline):
    entity(baseline, "plant-a").pop("partOf")
    result = incident_context(baseline, "event-dosing")
    assert result["facility"]["id"] == "plant-a"
    assert result["provider"] is None
    assert result["serviceArea"] is None
    assert result["downstreamDependencies"] == []
    entity(baseline, "plc-a")["partOf"] = "area-a"
    assert incident_context(baseline, "event-dosing")["facility"] is None


def test_water_provider_can_be_the_hosting_facility(baseline):
    entity(baseline, "cyber-plc-a")["hostedBy"] = "utility-a"
    entity(baseline, "plc-a").pop("hostsCyberAsset")
    entity(baseline, "utility-a")["hostsCyberAsset"] = "cyber-plc-a"
    result = incident_context(baseline, "event-dosing")
    assert result["physicalAsset"]["id"] == "utility-a"
    assert result["facility"]["id"] == "utility-a"
    assert result["provider"]["id"] == "utility-a"


@pytest.mark.parametrize("relation,record_id,target", [
    ("seenOn", "event-dosing", "plc-a"),
    ("hostedBy", "cyber-plc-a", "org-a"),
    ("partOf", "plc-a", "org-a"),
    ("serves", "utility-a", "hospital-y"),
])
def test_wrong_typed_endpoints_are_not_claimed(baseline, relation, record_id, target):
    collection = baseline["events"] if relation == "seenOn" else baseline["entities"]
    next(item for item in collection if item["id"] == record_id)[relation] = target
    result = incident_context(baseline, "event-dosing")
    key = {"seenOn": "cyberAsset", "hostedBy": "physicalAsset", "partOf": "facility", "serves": "serviceArea"}[relation]
    assert result[key] is None
    assert any(relation in warning for warning in result["warnings"])


@pytest.mark.parametrize("status", ["proposed", "validated", "needs_review", None, "promotedness"])
def test_unpromoted_dependencies_are_excluded(baseline, status):
    baseline["dependencies"][0]["status"] = status
    result = incident_context(baseline, "event-dosing")
    assert "dep-a-x" not in {item["dependency"]["id"] for item in result["downstreamDependencies"]}


@pytest.mark.parametrize("status", ["promoted", "promoted_seed", "promoted_local_demo"])
def test_explicit_promoted_statuses_are_supported(baseline, status):
    baseline["dependencies"][0]["status"] = status
    result = incident_context(baseline, "event-dosing")
    assert "dep-a-x" in {item["dependency"]["id"] for item in result["downstreamDependencies"]}


@pytest.mark.parametrize("mode", ["missing_function", "wrong_owner", "missing_dependent", "wrong_dependent_type"])
def test_invalid_dependency_endpoints_or_function_ownership_are_excluded(baseline, mode):
    dep = baseline["dependencies"][0]
    if mode == "missing_function":
        dep["dependentFunction"] = "missing"
    elif mode == "wrong_owner":
        dep["dependentFunction"] = "hospital-sterilization"
    elif mode == "missing_dependent":
        dep["dependent"] = "missing"
    else:
        dep["dependent"] = "area-a"
    result = incident_context(baseline, "event-dosing")
    assert "dep-a-x" not in {item["dependency"]["id"] for item in result["downstreamDependencies"]}
    assert any("dep-a-x" in warning for warning in result["warnings"])


def test_provenance_gaps_are_marked_and_only_existing_sources_are_aggregated(baseline):
    original = deepcopy(baseline)
    entity(baseline, "plc-a")["sourceRefs"] = ["missing-source", "src-inventory"]
    entity(baseline, "plant-a").pop("sourceRefs")
    baseline["scenarios"][0]["seed"]["sourceRefs"] = ["missing-seed-source"]
    result = incident_context(baseline, "event-dosing")
    assert result["physicalAsset"]["sourceRefs"] == ["missing-source", "src-inventory"]
    assert "sourceRefs" not in result["facility"]
    assert set(result["sourceRefs"]) <= set(ids(original["sources"]))
    assert any("Provenance gap" in warning and "missing-source" in warning for warning in result["warnings"])
    assert any("Provenance gap" in warning and "plant-a" in warning for warning in result["warnings"])
    assert any("Provenance gap" in warning and "missing-seed-source" in warning for warning in result["warnings"])


def test_nested_provenance_is_included_without_rewriting_records(baseline):
    baseline["scenarios"][0]["seed"]["sourceRefs"] = ["src-enterprise"]
    baseline["events"][2]["rawRef"]["sourceRef"] = "src-network"
    result = incident_context(baseline, "event-dosing")
    assert {"src-enterprise", "src-network"} <= set(result["sourceRefs"])
    assert result["scenarios"][0] == baseline["scenarios"][0]


def test_duplicate_entity_ids_are_ambiguous_not_last_write_wins(baseline):
    baseline["entities"].append(deepcopy(entity(baseline, "cyber-plc-a")))
    result = incident_context(baseline, "event-dosing")
    assert result["cyberAsset"] is None
    assert any("ambiguous" in warning.lower() for warning in result["warnings"])


@pytest.mark.parametrize("value", [None, {}, 7, "not-a-record"])
def test_imperfect_records_do_not_crash(baseline, value):
    for collection in ("entities", "events", "dependencies", "serviceFunctions", "scenarios", "sources"):
        baseline[collection].append(value)
    result = incident_context(baseline, "event-dosing")
    assert result["provider"]["id"] == "utility-a"
    assert result["warnings"]


def test_malformed_optional_collections_are_reported(baseline):
    baseline["dependencies"] = None
    baseline["scenarios"] = {}
    baseline["sources"] = "unavailable"
    result = incident_context(baseline, "event-dosing")
    assert result["downstreamDependencies"] == []
    assert result["scenarios"] == []
    assert result["sourceRefs"] == []
    assert any("dependencies" in warning for warning in result["warnings"])


@pytest.mark.parametrize("field,record_id,key", [
    ("seenOn", "event-dosing", "cyberAsset"),
    ("hostedBy", "cyber-plc-a", "physicalAsset"),
    ("partOf", "plc-a", "facility"),
    ("serves", "utility-a", "serviceArea"),
])
@pytest.mark.parametrize("value", [{"id": "plant-a"}, [], 7])
def test_malformed_structural_references_are_withheld(baseline, field, record_id, key, value):
    records = baseline["events"] if field == "seenOn" else baseline["entities"]
    next(item for item in records if item["id"] == record_id)[field] = value
    result = incident_context(baseline, "event-dosing")
    assert result[key] is None
    assert any("malformed" in warning.lower() and field in warning for warning in result["warnings"])


def test_singleton_reference_lists_do_not_introduce_ambiguity(baseline):
    baseline["events"][2]["seenOn"] = ["cyber-plc-a"]
    entity(baseline, "cyber-plc-a")["hostedBy"] = ["plc-a"]
    entity(baseline, "plc-a")["hostsCyberAsset"] = ["cyber-plc-a"]
    entity(baseline, "plc-a")["partOf"] = ["plant-a"]
    entity(baseline, "utility-a")["serves"] = ["area-a"]
    result = incident_context(baseline, "event-dosing")
    assert result["provider"]["id"] == "utility-a"
    assert result["serviceArea"]["id"] == "area-a"


def test_multiple_provider_ancestors_are_ambiguous(baseline):
    entity(baseline, "utility-a")["partOf"] = "utility-b"
    result = incident_context(baseline, "event-dosing")
    assert result["facility"]["id"] == "plant-a"
    assert result["provider"] is None
    assert result["downstreamDependencies"] == []
    assert any("ambiguous WaterServiceProvider" in warning for warning in result["warnings"])


def test_dangling_ancestor_does_not_hide_behind_nearer_facility(baseline):
    entity(baseline, "plant-a")["partOf"] = "missing"
    result = incident_context(baseline, "event-dosing")
    assert result["physicalAsset"]["id"] == "plc-a"
    assert result["facility"] is None
    assert result["provider"] is None


def test_missing_revision_is_explicitly_unavailable(baseline):
    baseline.pop("baselineRevision")
    result = incident_context(baseline, "event-dosing")
    assert result["baselineRevision"] == 0
    assert any("revision" in warning.lower() and "unavailable" in warning.lower() for warning in result["warnings"])


def test_unknown_event_raises_value_error(baseline):
    with pytest.raises(ValueError, match="Unknown event"):
        incident_context(baseline, "missing-event")


def test_input_and_returned_snapshots_are_independent(baseline):
    before = deepcopy(baseline)
    result = incident_context(baseline, "event-dosing")
    assert baseline == before
    assert result == incident_context(baseline, "event-dosing")
    result["event"]["label"] = "Changed returned record"
    result["facility"]["sourceRefs"].append("new-source")
    result["scenarios"][0]["seed"]["eventRefs"].clear()
    result["downstreamDependencies"][0]["dependency"]["provider"] = "utility-b"
    assert baseline == before
    baseline["baselineRevision"] = 99
    entity(baseline, "utility-a")["label"] = "Changed input record"
    assert result["baselineRevision"] == before["baselineRevision"]
    assert result["provider"]["label"] == entity(before, "utility-a")["label"]

"""Behavioral tests for the synthetic, loss-specific cascade engine.

The fixture is intentionally independent of the bundled Watershed scenario so
changes to demo data cannot make propagation defects disappear from the tests.
"""

from copy import deepcopy
from math import inf, nan

import pytest
import citride.engine as engine

from citride.engine import compare_runs, compute_run


def entity(entity_id, entity_type="facility"):
    return {
        "id": entity_id,
        "type": entity_type,
        "label": entity_id.replace("-", " ").title(),
        "classification": "SIMULATED",
        "handling": "SIMULATED",
        "sourceRefs": ["source-fixture"],
    }


def function(function_id, facility, service="care"):
    return {
        "id": function_id,
        "facility": facility,
        "label": function_id.replace("-", " ").title(),
        "service": service,
        "classification": "SIMULATED",
        "handling": "SIMULATED",
        "sourceRefs": ["source-fixture"],
    }


def dependency(
    dependency_id,
    provider,
    dependent,
    dependent_function,
    *,
    service="potable_water",
    losses=None,
    delay=(0, 0),
    backup=(0, 0),
    backup_losses=None,
    fraction=1.0,
    output_loss=None,
):
    if losses is None:
        losses = ["unsafe_water"]
    if backup_losses is None:
        backup_losses = list(losses)
    return {
        "id": dependency_id,
        "revision": 1,
        "provider": provider,
        "dependent": dependent,
        "requiredService": service,
        "dependentFunction": dependent_function,
        "dependencyType": "operational",
        "coupling": "direct",
        "lossTypes": losses,
        "propagationDelayMinHours": delay[0],
        "propagationDelayMaxHours": delay[1],
        "usableBackupMinHours": backup[0],
        "usableBackupMaxHours": backup[1],
        "validForLossTypes": backup_losses,
        "lossOfFunction": fraction,
        "outputLossType": output_loss,
        "sourceRefs": ["source-fixture"],
        "assumptionNote": f"Fictional assumption for {dependency_id}.",
        "classification": "SIMULATED",
        "handling": "SIMULATED",
    }


def model(dependencies=None, extra_entities=None, extra_functions=None):
    entities = [
        entity("utility-a"),
        entity("utility-b"),
        entity("utility-c"),
        entity("dialysis"),
        entity("hospital"),
        entity("nursing"),
        entity("fire"),
        entity("spatial-only"),
        entity("grid"),
        entity("area-a", "service_area"),
    ]
    entities[0]["serves"] = ["area-a"]
    entities[7]["locatedIn"] = "area-a"
    functions = [
        function("dialysis-care", "dialysis"),
        function("hospital-sterilization", "hospital"),
        function("nursing-care", "nursing"),
        function("fire-flow", "fire", "fire_flow"),
        function("b-water", "utility-b", "potable_water"),
        function("c-water", "utility-c", "potable_water"),
        function("a-water", "utility-a", "potable_water"),
        function("spatial-care", "spatial-only"),
    ]
    if dependencies is None:
        dependencies = [
            dependency("d-dialysis", "utility-a", "dialysis", "dialysis-care", delay=(0, 2), backup=(2, 2)),
            dependency("d-hospital", "utility-a", "hospital", "hospital-sterilization", delay=(0, 4), backup=(4, 4), fraction=0.6),
            dependency("d-nursing", "utility-a", "nursing", "nursing-care", delay=(0, 3), backup=(1, 1), fraction=0.4),
            dependency("d-fire", "utility-a", "fire", "fire-flow", losses=["pressure_loss"]),
            dependency("d-b", "utility-b", "dialysis", "dialysis-care", service="electricity", losses=["power_loss"]),
            dependency("d-c", "utility-c", "hospital", "hospital-sterilization", service="electricity", losses=["power_loss"]),
        ]
    seed = {
        "provider": "utility-a",
        "service": "potable_water",
        "lossType": "unsafe_water",
        "windowHours": [0, 0],
        "persistsThroughHour": 24,
        "eventRefs": ["event-fictional-change"],
        "sourceRefs": ["source-fixture"],
    }
    return {
        "baselineRevision": 3,
        "modelVersion": "test-fixture-v1",
        "entities": entities + (extra_entities or []),
        "serviceFunctions": functions + (extra_functions or []),
        "dependencies": dependencies,
        "sources": [{"id": "source-fixture", "label": "Independent fictional test fixture", "handling": "SIMULATED"}],
        "assumptions": [],
        "events": [{"id": "event-fictional-change", "sourceRefs": ["source-fixture"], "handling": "SIMULATED"}],
        "assessments": [],
        "scenarios": [{"id": "unsafe-water", "label": "Fictional unsafe water", "description": "A modeled effect.", "seed": seed}],
        "defaultScenarioId": "unsafe-water",
    }


def request(**updates):
    result = {"scenarioId": "unsafe-water", "evaluationHour": 1, "horizonHours": 12, "overrides": []}
    result.update(updates)
    return result


def run(data=None, **updates):
    return compute_run(model() if data is None else data, request(**updates), "run-test")


def impact(result, function_id):
    matches = [item for item in result["impacts"] if item["functionId"] == function_id]
    assert len(matches) == 1, f"Expected one impact for {function_id}: {matches}"
    return matches[0]


def review_warnings(result):
    return [warning for warning in result["warnings"] if "requires_model_review" in warning]


def test_baseline_windows_and_negative_controls():
    result = run()
    assert impact(result, "dialysis-care")["windowHours"] == [2, 4]
    assert impact(result, "hospital-sterilization")["windowHours"] == [4, 8]
    assert impact(result, "nursing-care")["windowHours"] == [1, 4]
    assert {item["entityId"] for item in result["impacts"]} == {"dialysis", "hospital", "nursing"}
    assert all(item["lossType"] == "unsafe_water" for item in result["impacts"])
    assert all(item["evidenceStatus"] == "modeled" for item in result["impacts"])
    assert impact(result, "dialysis-care")["paths"] == [["d-dialysis"]]
    assert "source-fixture" in impact(result, "dialysis-care")["sourceRefs"]
    assert impact(result, "dialysis-care")["assumptions"]
    assert any(item["dependencyId"] == "d-fire" for item in result["excluded"])
    assert all({"dependencyId", "reason", "path"} <= item.keys() for item in result["excluded"])


def test_what_if_is_immutable_and_backup_six_shifts_window_to_six_eight():
    data = model()
    req = request(overrides=[{"dependencyId": "d-dialysis", "backupMinHours": 6, "backupMaxHours": 6, "note": "Fictional expanded clean-water reserve."}])
    data_before, request_before = deepcopy(data), deepcopy(req)
    result = compute_run(data, req, "run-reserve")
    assert impact(result, "dialysis-care")["windowHours"] == [6, 8]
    assert data == data_before
    assert req == request_before
    assert result["baselineSnapshot"] == data_before
    assert run(data)["baselineSnapshot"]["dependencies"][0]["usableBackupMinHours"] == 2
    saved_request, saved_snapshot = deepcopy(result["request"]), deepcopy(result["baselineSnapshot"])
    data["dependencies"][0]["usableBackupMinHours"] = 99
    req["overrides"][0]["backupMinHours"] = 99
    assert result["request"] == saved_request
    assert result["baselineSnapshot"] == saved_snapshot
    assert any("Fictional expanded clean-water reserve" in note for note in impact(result, "dialysis-care")["assumptions"])


def test_multihop_accumulates_windows_and_converts_service_and_loss():
    first = dependency("grid-to-a", "grid", "utility-a", "a-water", service="electricity", losses=["power_loss"], delay=(1, 3), backup=(0, 1), output_loss="unsafe_water")
    second = dependency("a-to-dialysis", "utility-a", "dialysis", "dialysis-care", delay=(0, 2), backup=(2, 2))
    data = model([first, second])
    first["sourceRefs"] = ["source-upstream"]
    second["sourceRefs"] = ["source-downstream"]
    data["sources"].extend([
        {"id": "source-upstream", "label": "Fictional upstream assumption", "handling": "SIMULATED"},
        {"id": "source-downstream", "label": "Fictional downstream assumption", "handling": "SIMULATED"},
    ])
    data["scenarios"][0]["seed"].update(provider="grid", service="electricity", lossType="power_loss", windowHours=[1, 2], persistsThroughHour=24)
    result = run(data)
    utility = impact(result, "a-water")
    care = impact(result, "dialysis-care")
    assert utility["windowHours"] == [2, 6]
    assert utility["lossType"] == "unsafe_water"
    assert care["windowHours"] == [4, 10]
    assert care["paths"] == [["grid-to-a", "a-to-dialysis"]]
    assert care["lossType"] == "unsafe_water"
    assert {"source-fixture", "source-upstream", "source-downstream"} <= set(care["sourceRefs"])


@pytest.mark.parametrize("field,value", [("evaluationHour", -1), ("evaluationHour", inf), ("evaluationHour", nan), ("evaluationHour", True), ("evaluationHour", "1"), ("horizonHours", -1), ("horizonHours", 0), ("horizonHours", inf), ("horizonHours", nan), ("horizonHours", 10**1000)])
def test_request_rejects_negative_or_nonfinite_hours(field, value):
    with pytest.raises(ValueError):
        run(**{field: value})


@pytest.mark.parametrize("override", [
    {"dependencyId": "missing", "backupMinHours": 1, "backupMaxHours": 2, "note": "Hypothetical."},
    {"dependencyId": "d-dialysis", "backupMinHours": -1, "backupMaxHours": 2, "note": "Hypothetical."},
    {"dependencyId": "d-dialysis", "backupMinHours": 3, "backupMaxHours": 2, "note": "Hypothetical."},
    {"dependencyId": "d-dialysis", "backupMinHours": nan, "backupMaxHours": 2, "note": "Hypothetical."},
    {"dependencyId": "d-dialysis", "backupMinHours": 1, "backupMaxHours": inf, "note": "Hypothetical."},
    {"dependencyId": "d-dialysis", "backupMinHours": 1, "backupMaxHours": 2, "note": "  "},
    {"dependencyId": "d-dialysis", "backupMinHours": True, "backupMaxHours": 2, "note": "Hypothetical."},
])
def test_request_rejects_invalid_override(override):
    with pytest.raises(ValueError):
        run(overrides=[override])


def test_request_rejects_unknown_scenario():
    with pytest.raises(ValueError):
        run(scenarioId="unconfigured-live-feed")


def test_request_rejects_duplicate_overrides_and_evaluation_outside_horizon():
    override = {"dependencyId": "d-dialysis", "backupMinHours": 2, "backupMaxHours": 2, "note": "Hypothetical."}
    with pytest.raises(ValueError):
        run(overrides=[override, deepcopy(override)])
    with pytest.raises(ValueError):
        run(evaluationHour=13, horizonHours=12)


@pytest.mark.parametrize("field,value", [
    ("propagationDelayMinHours", -1),
    ("propagationDelayMaxHours", nan),
    ("usableBackupMinHours", inf),
    ("usableBackupMaxHours", -1),
    ("lossOfFunction", -0.1),
    ("lossOfFunction", 1.1),
    ("lossOfFunction", nan),
])
def test_model_rejects_invalid_dependency_numeric_fields(field, value):
    data = model()
    data["dependencies"][0][field] = value
    with pytest.raises(ValueError):
        run(data)


@pytest.mark.parametrize("field,value", [
    ("windowHours", [2, 1]),
    ("windowHours", [-1, 1]),
    ("windowHours", [0, inf]),
    ("persistsThroughHour", nan),
    ("persistsThroughHour", -1),
])
def test_model_rejects_invalid_seed_timing(field, value):
    data = model()
    data["scenarios"][0]["seed"][field] = value
    with pytest.raises(ValueError):
        run(data)


def test_accumulated_float_overflow_is_rejected():
    data = model([dependency("huge-timing", "utility-a", "dialysis", "dialysis-care", delay=(1e308, 1e308), backup=(1e308, 1e308))])
    data["scenarios"][0]["seed"]["persistsThroughHour"] = 1e308
    with pytest.raises(ValueError):
        run(data, horizonHours=1e308)


@pytest.mark.parametrize("incompatible_backup", [(100, 100), (None, None)])
def test_missing_backup_is_unknown_but_incompatible_backup_gets_zero_credit(incompatible_backup):
    unknown = dependency("unknown-backup", "utility-a", "dialysis", "dialysis-care", delay=(1, 2), backup=(None, None))
    incompatible = dependency("incompatible-backup", "utility-a", "hospital", "hospital-sterilization", delay=(1, 2), backup=incompatible_backup, backup_losses=["pressure_loss"])
    result = run(model([unknown, incompatible]))
    dialysis = impact(result, "dialysis-care")
    assert dialysis["windowHours"] is None
    assert dialysis["timingStatus"] == "unknown"
    assert dialysis["state"] == "unknown"
    assert impact(result, "hospital-sterilization")["windowHours"] == [1, 2]


def test_cycles_warn_and_never_repeat_credit_or_dependency_in_paths():
    dependencies = [
        dependency("a-to-b", "utility-a", "utility-b", "b-water", backup=(1, 1), output_loss="unsafe_water"),
        dependency("b-to-a", "utility-b", "utility-a", "a-water", backup=(1, 1), output_loss="unsafe_water"),
        dependency("b-to-care", "utility-b", "dialysis", "dialysis-care", backup=(1, 1)),
    ]
    result = run(model(dependencies))
    assert review_warnings(result)
    assert any("cycl" in warning.lower() for warning in review_warnings(result))
    assert len(result["impacts"]) <= 3
    for item in result["impacts"]:
        for path in item["paths"]:
            assert len(path) <= len(dependencies)
            assert len(path) == len(set(path))
    care = impact(result, "dialysis-care")
    assert care["windowHours"] is None
    assert care["state"] == "unknown"


def test_same_required_service_multiple_providers_requires_review():
    dependencies = [
        dependency("a-to-care", "utility-a", "dialysis", "dialysis-care", backup=(2, 2)),
        dependency("b-to-care", "utility-b", "dialysis", "dialysis-care", backup=(2, 2)),
    ]
    result = run(model(dependencies), evaluationHour=10)
    assert review_warnings(result)
    assert impact(result, "dialysis-care")["state"] == "unknown"
    assert impact(result, "dialysis-care")["windowHours"] is None


@pytest.mark.parametrize("marker,value", [("supplyGroup", "alternate-water"), ("multiSupply", True)])
def test_explicit_unsupported_supply_markers_require_review_even_for_one_link(marker, value):
    link = dependency("marked-supply", "utility-a", "dialysis", "dialysis-care", backup=(2, 2))
    link[marker] = value
    result = run(model([link]), evaluationHour=10)
    assert review_warnings(result)
    care = impact(result, "dialysis-care")
    assert care["state"] == "unknown"
    assert care["timingStatus"] == "unknown"
    assert care["windowHours"] is None
    assert care["paths"] == [["marked-supply"]]


def test_false_multisupply_flag_preserves_single_supply_forecast():
    data = model()
    data["dependencies"][0]["multiSupply"] = False
    result = run(data)
    assert not review_warnings(result)
    assert impact(result, "dialysis-care")["windowHours"] == [2, 4]
    assert impact(result, "dialysis-care")["state"] == "at_risk"


def test_distinct_required_services_are_not_misidentified_as_redundant_supply():
    dependencies = [
        dependency("water-to-care", "utility-a", "dialysis", "dialysis-care", backup=(2, 2)),
        dependency("power-to-care", "grid", "dialysis", "dialysis-care", service="electricity", losses=["power_loss"], backup=(2, 2)),
    ]
    result = run(model(dependencies))
    assert not review_warnings(result)
    assert impact(result, "dialysis-care")["windowHours"] == [2, 2]


def test_matching_loss_type_does_not_activate_wrong_required_service():
    dependencies = [dependency("wrong-service", "utility-a", "dialysis", "dialysis-care", service="electricity")]
    result = run(model(dependencies))
    assert not result["impacts"]
    assert any(item["dependencyId"] == "wrong-service" and "service" in item["reason"] for item in result["excluded"])


def test_duplicate_impacts_retain_all_paths_without_duplicate_records():
    dependencies = [
        dependency("first-path", "utility-a", "dialysis", "dialysis-care", delay=(0, 1), backup=(2, 2)),
        dependency("second-path", "utility-a", "dialysis", "dialysis-care", delay=(1, 2), backup=(2, 2)),
    ]
    result = run(model(dependencies))
    item = impact(result, "dialysis-care")
    # Both links are required dependencies, so the first failing path governs.
    assert item["windowHours"] == [2, 3]
    assert sorted(item["paths"]) == [["first-path"], ["second-path"]]


def test_loss_ending_before_reserve_exhaustion_does_not_produce_impact():
    data = model([dependency("reserve", "utility-a", "dialysis", "dialysis-care", backup=(6, 6))])
    data["scenarios"][0]["seed"]["persistsThroughHour"] = 3
    result = run(data)
    assert not result["impacts"]
    assert any(item["dependencyId"] == "reserve" for item in result["excluded"])


def test_loss_ending_inside_onset_window_is_unknown():
    data = model([dependency("variable-reserve", "utility-a", "dialysis", "dialysis-care", backup=(2, 6))])
    data["scenarios"][0]["seed"]["persistsThroughHour"] = 4
    result = run(data, evaluationHour=8)
    item = impact(result, "dialysis-care")
    assert item["state"] == "unknown"
    assert item["timingStatus"] == "unknown"
    # Retain the conditional interval so the explanation can expose the reason
    # for uncertainty; never present it as a confirmed exhausted reserve.
    assert item["windowHours"] == [2, 6]


def test_unknown_intermediate_timing_remains_unknown_downstream_with_path_retained():
    dependencies = [
        dependency("unknown-upstream", "utility-a", "utility-b", "b-water", backup=(None, None), output_loss="unsafe_water"),
        dependency("known-downstream", "utility-b", "dialysis", "dialysis-care", delay=(1, 2), backup=(2, 2)),
    ]
    result = run(model(dependencies), evaluationHour=10)
    for function_id in ["b-water", "dialysis-care"]:
        item = impact(result, function_id)
        assert item["windowHours"] is None
        assert item["state"] == "unknown"
        assert item["timingStatus"] == "unknown"
    assert impact(result, "dialysis-care")["paths"] == [["unknown-upstream", "known-downstream"]]


def test_impact_retains_distinct_seed_event_dependency_and_parameter_sources():
    link = dependency("sourced-link", "utility-a", "dialysis", "dialysis-care", backup=(2, 2))
    link["sourceRefs"] = ["source-dependency"]
    link["parameterAssertionRefs"] = {"usableBackupMinHours": "assertion-reserve"}
    data = model([link])
    data["scenarios"][0]["seed"]["sourceRefs"] = ["source-seed"]
    data["events"][0]["sourceRefs"] = ["source-event"]
    data["assumptions"] = [
        {"id": "assertion-reserve", "sourceRefs": ["source-reserve"], "handling": "SIMULATED"},
        {"id": "assertion-unrelated", "sourceRefs": ["source-unrelated"], "handling": "SIMULATED"},
    ]
    data["sources"].extend([
        {"id": source_id, "label": source_id, "handling": "SIMULATED"}
        for source_id in ["source-seed", "source-event", "source-dependency", "source-reserve", "source-unrelated"]
    ])
    care = impact(run(data), "dialysis-care")
    assert set(care["sourceRefs"]) == {"source-seed", "source-event", "source-dependency", "source-reserve"}
    assert len(care["sourceRefs"]) == len(set(care["sourceRefs"]))


def test_evaluation_hour_changes_state_without_changing_modeled_window():
    before = run(evaluationHour=0)
    uncertain = run(evaluationHour=3)
    after = run(evaluationHour=10)
    assert impact(before, "dialysis-care")["state"] == "at_risk"
    assert impact(before, "dialysis-care")["timingStatus"] == "before_onset"
    assert impact(uncertain, "dialysis-care")["timingStatus"] == "onset_uncertain"
    assert impact(after, "dialysis-care")["state"] == "failed"
    assert impact(after, "hospital-sterilization")["state"] == "degraded"
    assert impact(after, "dialysis-care")["timingStatus"] == "past_latest_onset"
    assert impact(before, "dialysis-care")["windowHours"] == impact(after, "dialysis-care")["windowHours"]


def test_horizon_excludes_impacts_that_cannot_start_in_time():
    data = model([dependency("late-reserve", "utility-a", "dialysis", "dialysis-care", backup=(6, 6))])
    result = run(data, horizonHours=5)
    assert not result["impacts"]
    assert any(item["dependencyId"] == "late-reserve" for item in result["excluded"])


def test_zero_loss_fraction_is_excluded_and_cannot_propagate():
    dependencies = [
        dependency("zero-loss", "utility-a", "utility-b", "b-water", fraction=0, output_loss="unsafe_water"),
        dependency("b-to-care", "utility-b", "dialysis", "dialysis-care"),
    ]
    result = run(model(dependencies))
    assert not result["impacts"]
    assert any(item["dependencyId"] == "zero-loss" for item in result["excluded"])


def test_terminal_loss_does_not_propagate_or_create_false_cycle():
    dependencies = [
        dependency("terminal-a-to-b", "utility-a", "utility-b", "b-water"),
        dependency("b-to-a", "utility-b", "utility-a", "a-water", output_loss="unsafe_water"),
    ]
    result = run(model(dependencies))
    assert {item["functionId"] for item in result["impacts"]} == {"b-water"}
    assert not review_warnings(result)


def test_propagation_never_reverses_dependency_direction():
    data = model([dependency("a-to-b", "utility-a", "utility-b", "b-water", output_loss="unsafe_water")])
    data["scenarios"][0]["seed"]["provider"] = "utility-b"
    assert not run(data)["impacts"]


def test_path_limit_is_bounded_and_marks_incomplete_result_unknown(monkeypatch):
    monkeypatch.setattr(engine, "MAX_PATH_EVENTS", 2)
    result = run()
    assert len(result["impacts"]) <= 2
    assert any("path event limit" in warning for warning in review_warnings(result))
    assert all(item["state"] == "unknown" for item in result["impacts"])


def test_engine_is_repeatable_for_same_inputs():
    data, req = model(), request()
    assert compute_run(data, req, "stable-run") == compute_run(data, req, "stable-run")


def test_comparison_is_pure_and_only_reports_changed_impacts():
    left = compute_run(model(), request(), "run-baseline")
    right = compute_run(model(), request(overrides=[{"dependencyId": "d-dialysis", "backupMinHours": 6, "backupMaxHours": 6, "note": "Fictional added reserve."}]), "run-what-if")
    left_before, right_before = deepcopy(left), deepcopy(right)
    comparison = compare_runs(left, right)
    assert comparison["leftRunId"] == "run-baseline"
    assert comparison["rightRunId"] == "run-what-if"
    assert comparison["changes"] == [{
        "entityId": "dialysis",
        "functionId": "dialysis-care",
        "leftWindowHours": [2, 4],
        "rightWindowHours": [6, 8],
        "leftState": "at_risk",
        "rightState": "at_risk",
    }]
    assert left == left_before
    assert right == right_before
    assert compare_runs(left, left)["changes"] == []

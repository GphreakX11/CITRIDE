"""Durable casework tests against the real file repository and consequence engine."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest

from citride.command import CommandService, PUBLIC_FIELDS, TASK_LABELS
from citride.engine import compute_run
from citride.storage import ConflictError, InvalidModelError, NotFoundError, Repository

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def store(tmp_path):
    return Repository(tmp_path / "state", ROOT / "data/scenario.json")


@pytest.fixture
def service(store):
    return CommandService(store)


def create_request(event="event-dosing", **changes):
    return {"eventId": event, "title": "Review original dosing observation", "priority": "high",
            "expectedBaselineRevision": 1, "clientRequestId": str(uuid4()), **changes}


def action_request(case, action="add_note", **fields):
    return {"action": action, "expectedVersion": case["version"], "clientRequestId": str(uuid4()), **fields}


def act(service, case, action="add_note", **fields):
    return service.act(case["id"], action_request(case, action, **fields))


def analyze(service, case):
    return act(service, case, "analyze", scenarioId="unsafe-water", evaluationHour=1, horizonHours=12)


def mutate_record(store, identifier, mutation):
    with store._locked():
        dataset = store._load()
        record = store._record(dataset, "command-incident", identifier)
        mutation(record)
        store._record_graph(dataset, "command-incident", record)
        store._save(dataset)


def test_persistence_original_snapshots_private_receipts_and_immutability(store, service):
    baseline = store.baseline()
    old_run = store.create_run({"scenarioId": "unsafe-water", "evaluationHour": 1, "horizonHours": 12, "overrides": []}, compute_run)
    case = service.create(create_request())
    assert set(case) == PUBLIC_FIELDS
    assert case["version"] == 1 and case["status"] == "open"
    assert case["notes"] == case["activity"] == case["decisions"] == []
    assert case["runSnapshot"] is None
    assert [t["label"] for t in case["tasks"]] == list(TASK_LABELS)
    assert case["eventSnapshot"] == next(e for e in baseline["events"] if e["id"] == "event-dosing")
    result = analyze(service, case)
    run = deepcopy(result["runSnapshot"])
    assert run == store.run(result["runId"])
    assert run["request"]["overrides"] == []
    assert len(result["decisions"]) == len(run["impacts"]) == 3
    functions = {f["id"]: f for f in run["baselineSnapshot"]["serviceFunctions"]}
    assert all(functions[d["functionId"]]["service"] != "fire_flow" for d in result["decisions"])
    for decision, impact in zip(result["decisions"], run["impacts"]):
        assert decision["entityId"] == impact["entityId"]
        assert decision["state"] == impact["state"]
        assert decision["windowHours"] == impact["windowHours"]
        assert decision["assumptions"] == impact["assumptions"]
        assert decision["sourceRefs"] == impact["sourceRefs"]
        assert decision["authorityBasis"] == "not_configured"
        assert decision["gateStatus"] == "not_evaluated"
        assert decision["sourceSnapshots"] == [next(s for s in run["baselineSnapshot"]["sources"] if s["id"] == ref) for ref in decision["sourceRefs"]]
    fresh = CommandService(Repository(store.data_dir, store.scenario_path))
    assert fresh.get(case["id"]) == result
    assert fresh.list() == [result]
    result["runSnapshot"]["baselineSnapshot"]["entities"][0]["label"] = "tampered"
    assert fresh.get(case["id"])["runSnapshot"] == run
    assert store.baseline() == baseline
    assert store.run(old_run["id"]) == old_run


def test_create_and_action_replays_return_current_before_optimistic_checks(store, service):
    request = create_request()
    case = service.create(request)
    analysis = action_request(case, "analyze", scenarioId="unsafe-water", evaluationHour=1, horizonHours=12)
    analyzed = service.act(case["id"], analysis)
    updated = act(service, analyzed, note="Local coordination only")
    assert service.create(request) == updated
    assert service.act(case["id"], analysis) == updated
    assert len(store.runs()) == 1
    fresh = CommandService(Repository(store.data_dir, store.scenario_path))
    assert fresh.create(request) == updated
    assert fresh.act(case["id"], analysis) == updated
    with pytest.raises(ConflictError, match="clientRequestId"):
        service.create({**request, "title": "Different title"})
    with pytest.raises(ConflictError, match="clientRequestId"):
        service.act(case["id"], {**analysis, "horizonHours": 24})
    with pytest.raises(ConflictError, match="immutable run"):
        analyze(service, updated)


def test_duplicate_active_event_and_stale_versions(service):
    case = service.create(create_request())
    with pytest.raises(ConflictError, match=case["id"]):
        service.create(create_request())
    updated = act(service, case, note="Saved note")
    with pytest.raises(ConflictError, match="version"):
        act(service, case, note="Stale edit")
    assert service.get(case["id"]) == updated
    with pytest.raises(ConflictError, match="Baseline revision"):
        service.create(create_request("event-probe-b", expectedBaselineRevision=2))


def test_stale_baseline_analysis_and_immutable_historical_labels(store, service):
    case = service.create(create_request())
    baseline = store.baseline()
    with store._locked():
        dataset = store._load()
        baseline["baselineRevision"] += 1
        baseline["entities"][0]["label"] = "New baseline name"
        store._write_baseline(dataset, baseline)
        store._save(dataset)
    with pytest.raises(ConflictError, match="Baseline revision"):
        analyze(service, case)
    assert store.runs() == []
    assert service.get(case["id"]) == case


@pytest.mark.parametrize("event", ["event-probe-b", "event-probe-c", "event-inbound-a", "event-auth-a"])
def test_unlinked_probes_reject_analysis(store, service, event):
    case = service.create(create_request(event))
    assert case["contextSnapshot"]["scenarios"] == []
    with pytest.raises(InvalidModelError, match="explicitly linked"):
        analyze(service, case)
    assert service.get(case["id"]) == case and store.runs() == []


def test_reviews_notes_closure_closed_protection_and_reopening(store, service):
    case = analyze(service, service.create(create_request()))
    with pytest.raises(ConflictError, match="Complete all tasks"):
        act(service, case, "set_status", status="closed", note="Tracking review complete")
    with pytest.raises(InvalidModelError, match="decisionId"):
        act(service, case, "review_decision", decisionId="missing", note="Review")
    with pytest.raises(InvalidModelError, match="taskId"):
        act(service, case, "set_task", taskId="missing", completed=True)
    for task in case["tasks"]:
        case = act(service, case, "set_task", taskId=task["id"], completed=True)
    with pytest.raises(ConflictError, match="review all decisions"):
        act(service, case, "set_status", status="closed", note="Tracking review complete")
    for decision in case["decisions"]:
        case = act(service, case, "review_decision", decisionId=decision["id"], note="Assumptions reviewed; not an authorization")
    case = act(service, case, note="Call coordination recorded locally; not sent")
    assert "not sent" in case["activity"][-1]["message"]
    closed = act(service, case, "set_status", status="closed", note="Case tracking review complete")
    assert closed["closedAt"] and closed["closureNote"]
    assert "no recovery or dispatch" in closed["activity"][-1]["message"]
    assert all(d["reviewedAt"] and d["gateStatus"] == "not_evaluated" for d in closed["decisions"])
    for action, fields in [("add_note", {"note": "No edit"}), ("set_task", {"taskId": case["tasks"][0]["id"], "completed": False}),
                           ("analyze", {"scenarioId": "unsafe-water", "evaluationHour": 1, "horizonHours": 12}),
                           ("set_status", {"status": "closed", "note": "Close again"})]:
        with pytest.raises(ConflictError, match="Closed casework"):
            act(service, closed, action, **fields)
    fresh = CommandService(Repository(store.data_dir, store.scenario_path))
    assert fresh.get(case["id"]) == closed
    reopened = act(fresh, closed, "set_status", status="monitoring", note="Explicitly reopen tracking")
    assert reopened["closedAt"] is None and reopened["closureNote"] is None
    assert reopened["status"] == "monitoring"


def test_new_case_after_closure_blocks_old_reopen(service):
    case = service.create(create_request())
    for task in case["tasks"]:
        case = act(service, case, "set_task", taskId=task["id"], completed=True)
    closed = act(service, case, "set_status", status="closed", note="Review complete")
    new = service.create(create_request())
    with pytest.raises(ConflictError, match=new["id"]):
        act(service, closed, "set_status", status="open", note="Reopen")


@pytest.mark.parametrize("changes", [
    {"title": " "}, {"title": "x" * 161}, {"priority": "urgent"}, {"priority": []},
    {"expectedBaselineRevision": True}, {"expectedBaselineRevision": 0},
    {"clientRequestId": ""}, {"actor": "operator"}, {"eventId": "dangling"},
])
def test_malformed_creation(service, changes):
    with pytest.raises(InvalidModelError):
        service.create(create_request(**changes))
    assert service.list() == []


@pytest.mark.parametrize("action,fields", [
    ("add_note", {"note": " "}), ("add_note", {"note": "x" * 2001}),
    ("add_note", {"note": "a", "authorityBasis": "approved"}),
    ("set_status", {"status": "resolved", "note": "note"}),
    ("set_status", {"status": "closed", "note": ""}),
    ("set_task", {"taskId": "a", "completed": 1}),
    ("analyze", {"scenarioId": "unsafe-water", "evaluationHour": True, "horizonHours": 12}),
    ("analyze", {"scenarioId": "unsafe-water", "evaluationHour": float("nan"), "horizonHours": 12}),
    ("analyze", {"scenarioId": "unsafe-water", "evaluationHour": 1, "horizonHours": float("inf")}),
    ("analyze", {"scenarioId": "unsafe-water", "evaluationHour": -1, "horizonHours": 12}),
    ("analyze", {"scenarioId": "unsafe-water", "evaluationHour": 13, "horizonHours": 12}),
    ("analyze", {"scenarioId": "unsafe-water", "evaluationHour": 0, "horizonHours": 0}),
    ("analyze", {"scenarioId": "unsafe-water", "evaluationHour": 1, "horizonHours": 7201}),
])
def test_malformed_action(service, action, fields):
    case = service.create(create_request())
    with pytest.raises(InvalidModelError):
        act(service, case, action, **fields)
    assert service.get(case["id"]) == case


def test_compute_exception_saves_nothing(store, service, monkeypatch):
    case = service.create(create_request())
    original = store.path.read_bytes()
    def fail(*args):
        raise RuntimeError("injected compute interruption")
    monkeypatch.setattr("citride.command.compute_run", fail)
    with pytest.raises(RuntimeError, match="interruption"):
        analyze(service, case)
    assert store.path.read_bytes() == original
    assert service.get(case["id"]) == case
    assert Repository(store.data_dir, store.scenario_path).runs() == []


def test_save_exception_rolls_back_case_and_run(store, service, monkeypatch):
    case = service.create(create_request())
    def fail(*args):
        raise OSError("injected storage interruption")
    monkeypatch.setattr(store, "_save", fail)
    with pytest.raises(OSError):
        analyze(service, case)
    fresh = CommandService(Repository(store.data_dir, store.scenario_path))
    assert fresh.get(case["id"]) == case
    assert fresh.store.runs() == []


@pytest.mark.parametrize("mutation", [
    lambda r: r.update(version="wrong"), lambda r: r.update(runId="run-dangling"),
    lambda r: r["tasks"][0].update(completed=1),
    lambda r: r.update(eventSnapshot={"id": "another-event"}),
    lambda r: r.update(decisions=[{"id": "fake"}]), lambda r: r.update(_requests={}),
])
def test_invalid_and_dangling_records_fail_closed(store, service, mutation):
    case = service.create(create_request())
    mutate_record(store, case["id"], mutation)
    with pytest.raises(InvalidModelError):
        service.get(case["id"])
    with pytest.raises(InvalidModelError):
        service.list()
    with pytest.raises(InvalidModelError):
        act(service, case, note="Must not repair silently")


def test_same_version_race_one_winner_across_repository_instances(store, service):
    case = service.create(create_request())
    second = CommandService(Repository(store.data_dir, store.scenario_path))
    barrier = Barrier(2)
    def race(svc):
        barrier.wait()
        try:
            return act(svc, case, note="Concurrent review")
        except ConflictError:
            return "conflict"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(race, [service, second]))
    assert results.count("conflict") == 1
    updated = service.get(case["id"])
    assert updated["version"] == 2 and len(updated["notes"]) == 1


def test_single_save_for_atomic_analysis(store, service, monkeypatch):
    case = service.create(create_request())
    saves = []
    original = store._save
    def save(dataset):
        saves.append(1)
        return original(dataset)
    monkeypatch.setattr(store, "_save", save)
    analyze(service, case)
    assert saves == [1]


def test_action_capacity_preserves_old_receipts_and_replay(store, service):
    creation = create_request()
    case = service.create(creation)
    first_request = action_request(case, note="First local review")
    case = service.act(case["id"], first_request)
    def fill(record):
        template = record["activity"][0]
        for index in range(299):
            record["activity"].append({**template, "id": str(uuid4())})
            record["_requests"][f"capacity-{index}"] = "0" * 64
        record["version"] = 301
    mutate_record(store, case["id"], fill)
    current = service.get(case["id"])
    assert service.create(creation) == current
    assert service.act(case["id"], first_request) == current
    with pytest.raises(ConflictError, match="300"):
        act(service, current, note="One too many")
    assert len(service.get(case["id"])["activity"]) == 300


def test_incident_capacity_preserves_create_replay(store, service):
    request = create_request()
    case = service.create(request)
    with store._locked():
        dataset = store._load()
        template = store._record(dataset, "command-incident", case["id"])
        for index in range(199):
            closed = deepcopy(template)
            closed.update(id=str(uuid4()), status="closed", closedAt=closed["updatedAt"], closureNote="Tracking review complete")
            closed["_requests"] = {f"capacity-case-{index}": "0" * 64}
            for task in closed["tasks"]:
                task.update(completed=True, completedAt=closed["updatedAt"])
            store._record_graph(dataset, "command-incident", closed)
        store._save(dataset)
    assert service.create(request) == case
    with pytest.raises(ConflictError, match="200"):
        service.create(create_request("event-probe-b"))
    assert len(service.list()) == 200


def test_historical_run_labels_remain_captured_after_baseline_edit(store, service):
    case = analyze(service, service.create(create_request()))
    with store._locked():
        dataset = store._load()
        baseline = store._baseline(dataset)
        baseline["baselineRevision"] += 1
        for collection in ("entities", "serviceFunctions", "sources"):
            for item in baseline[collection]:
                item["label"] = "Changed current label"
        store._write_baseline(dataset, baseline)
        store._save(dataset)
    assert CommandService(Repository(store.data_dir, store.scenario_path)).get(case["id"]) == case


@pytest.mark.parametrize("payload", [None, [], {}, {"action": []}, {"action": "dispatch"}])
def test_non_object_or_incomplete_requests_are_invalid(service, payload):
    with pytest.raises(InvalidModelError):
        service.create(payload)
    with pytest.raises(InvalidModelError):
        service.act("missing", payload)


@pytest.mark.parametrize("mutation", [
    lambda r: r["contextSnapshot"]["facility"].update(label="Uncaptured facility label"),
    lambda r: r["contextSnapshot"]["scenarios"][0]["seed"].update(provider="hospital-y"),
])
def test_run_must_match_complete_captured_context(store, service, mutation):
    case = analyze(service, service.create(create_request()))
    mutate_record(store, case["id"], mutation)
    with pytest.raises(InvalidModelError):
        service.get(case["id"])
    with pytest.raises(InvalidModelError):
        service.list()


@pytest.mark.parametrize("mutation", [
    lambda run: run["seed"].update(provider="hospital-y"),
    lambda run: run["request"].update(scenarioId="unrelated"),
    lambda run: run["request"].update(evaluationHour=True),
    lambda run: run["request"].update(horizonHours=0),
])
def test_malformed_analysis_scope_fails_closed(store, service, mutation):
    case = analyze(service, service.create(create_request()))
    with store._locked():
        dataset = store._load()
        run = store._record(dataset, "run", case["runId"])
        mutation(run)
        store._record_graph(dataset, "run", run)
        store._save(dataset)
    with pytest.raises(InvalidModelError):
        service.get(case["id"])


def test_payload_identity_must_resolve_to_its_stored_graph(store, service):
    from rdflib import Literal, RDF
    from citride.storage import NS, _resource
    case = service.create(create_request())
    with store._locked():
        dataset = store._load()
        for graph in dataset.graphs():
            if "graph:command-incident:" in str(graph.identifier):
                record = store._record(dataset, "command-incident", case["id"])
                record["id"] = "spoofed-incident"
                graph.set((_resource(case["id"]), NS.payload, Literal(json.dumps(record), datatype=RDF.JSON)))
        store._save(dataset)
    with pytest.raises(InvalidModelError):
        service.list()
    with pytest.raises(InvalidModelError):
        service.act("spoofed-incident", action_request(case, note="Must not fork a record"))


def test_request_receipts_cannot_be_shared_between_incidents(store, service):
    first = service.create(create_request())
    second = service.create(create_request("event-probe-b"))
    with store._locked():
        receipts = store._record(store._load(), "command-incident", first["id"])["_requests"]
    mutate_record(store, second["id"], lambda r: r.update(_requests=deepcopy(receipts)))
    with pytest.raises(InvalidModelError):
        service.list()


def test_missing_case_is_not_found(service):
    with pytest.raises(NotFoundError):
        service.get("missing")
    with pytest.raises(NotFoundError):
        service.act("missing", {"action": "add_note", "note": "note", "expectedVersion": 1, "clientRequestId": "missing-request"})

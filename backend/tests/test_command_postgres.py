"""Real command persistence in a disposable schema, never the public state table.

Only TEST_DATABASE_URL is accepted. Each test owns a UUID schema and drops only
that schema; the repository's unqualified table cannot resolve into public.
"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import os
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
import pytest

from citride.command import CommandService
from citride.engine import compute_run
from citride.postgres import PostgresRepository
from citride.storage import ConflictError

FIXTURE = Path(__file__).resolve().parents[2] / "data/scenario.json"


@pytest.fixture
def isolated_state():
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip(
            "TEST_DATABASE_URL is required for isolated real Postgres command tests"
        )
    schema = "command_test_" + uuid4().hex
    with psycopg.connect(database_url, connect_timeout=10) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    scoped_url = make_conninfo(database_url, options=f"-csearch_path={schema}")
    try:
        key = "command-" + uuid4().hex
        sentinel = PostgresRepository(
            scoped_url, FIXTURE, state_key="unrelated-preserved-state"
        )
        sentinel.create_run(
            {
                "scenarioId": "unsafe-water",
                "evaluationHour": 1,
                "horizonHours": 12,
                "overrides": [],
            },
            compute_run,
        )
        with psycopg.connect(scoped_url) as connection:
            before = connection.execute(
                "SELECT nquads, updated_at FROM citride_state WHERE state_key = %s",
                (sentinel._state_key,),
            ).fetchone()
        yield scoped_url, key
        with psycopg.connect(scoped_url) as connection:
            after = connection.execute(
                "SELECT nquads, updated_at FROM citride_state WHERE state_key = %s",
                (sentinel._state_key,),
            ).fetchone()
        assert after == before, "Command writes altered an unrelated existing state row"
    finally:
        with psycopg.connect(database_url, connect_timeout=10) as connection:
            connection.execute(
                sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema))
            )


def repository(state):
    return PostgresRepository(state[0], FIXTURE, state_key=state[1])


def creation(event="event-dosing"):
    return {
        "eventId": event,
        "title": "Conditional source review",
        "priority": "high",
        "expectedBaselineRevision": 1,
        "clientRequestId": str(uuid4()),
    }


def action(case, kind="add_note", **fields):
    return {
        "action": kind,
        "expectedVersion": case["version"],
        "clientRequestId": str(uuid4()),
        **fields,
    }


def analyze_request(case):
    return action(
        case, "analyze", scenarioId="unsafe-water", evaluationHour=1, horizonHours=12
    )


def test_real_postgres_workflow_restart_replay_and_historical_preservation(
    isolated_state,
):
    store = repository(isolated_state)
    baseline = store.baseline()
    old_run = store.create_run(
        {
            "scenarioId": "unsafe-water",
            "evaluationHour": 1,
            "horizonHours": 12,
            "overrides": [],
        },
        compute_run,
    )
    service = CommandService(store)
    request = creation()
    case = service.create(request)
    analysis = analyze_request(case)
    case = service.act(case["id"], analysis)
    captured_run = deepcopy(case["runSnapshot"])
    assert {d["entityId"]: d["windowHours"] for d in case["decisions"]} == {
        "dialysis-x": [2, 4],
        "hospital-y": [4, 8],
        "nursing-z": [1, 4],
    }
    for task in case["tasks"]:
        case = service.act(
            case["id"], action(case, "set_task", taskId=task["id"], completed=True)
        )
    for decision in case["decisions"]:
        case = service.act(
            case["id"],
            action(
                case,
                "review_decision",
                decisionId=decision["id"],
                note="Local assumption review only",
            ),
        )
    case = service.act(case["id"], action(case, note="Local note; not delivered"))
    close = action(case, "set_status", status="closed", note="Close case tracking only")
    closed = service.act(case["id"], close)
    fresh = CommandService(repository(isolated_state))
    assert fresh.get(case["id"]) == closed
    assert fresh.create(request) == closed
    assert fresh.act(case["id"], analysis) == closed
    assert fresh.act(case["id"], close) == closed
    with pytest.raises(ConflictError, match="clientRequestId"):
        fresh.act(case["id"], {**analysis, "horizonHours": 24})
    reopened = fresh.act(
        case["id"], action(closed, "set_status", status="open", note="Explicit reopen")
    )
    assert CommandService(repository(isolated_state)).get(case["id"]) == reopened
    assert fresh.store.baseline() == baseline
    assert fresh.store.run(old_run["id"]) == old_run
    assert fresh.store.run(reopened["runId"]) == captured_run
    assert len(fresh.store.runs()) == 2


@pytest.mark.parametrize("failure", ["compute", "after_sql_save"])
def test_real_postgres_analysis_transaction_rolls_back_everything(
    isolated_state, monkeypatch, failure
):
    store = repository(isolated_state)
    service = CommandService(store)
    case = service.create(creation())
    before = store.export()

    def interrupted(*args):
        raise RuntimeError("Injected analysis interruption")

    if failure == "compute":
        monkeypatch.setattr("citride.command.compute_run", interrupted)
    else:
        save = store._save

        def fail_after_sql(dataset):
            save(dataset)
            interrupted()

        monkeypatch.setattr(store, "_save", fail_after_sql)
    with pytest.raises(RuntimeError, match="interruption"):
        service.act(case["id"], analyze_request(case))
    assert service.get(case["id"]) == case
    fresh = CommandService(repository(isolated_state))
    assert fresh.get(case["id"]) == case
    assert fresh.store.runs() == []
    assert set(fresh.store.export().splitlines()) == set(before.splitlines())


@pytest.mark.parametrize("operation", ["create", "analyze", "same_request"])
def test_real_postgres_concurrent_writers_across_independent_repositories(
    isolated_state, operation
):
    first, second = (
        CommandService(repository(isolated_state)),
        CommandService(repository(isolated_state)),
    )
    barrier = Barrier(2)
    if operation == "create":
        requests = [creation(), creation()]
        case = None
    else:
        case = first.create(creation())
        one = (
            analyze_request(case)
            if operation == "analyze"
            else action(case, note="Single idempotent note")
        )
        requests = [
            one,
            analyze_request(case) if operation == "analyze" else deepcopy(one),
        ]

    def mutate(service, request):
        barrier.wait(timeout=10)
        try:
            return (
                service.create(request)
                if case is None
                else service.act(case["id"], request)
            )
        except ConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(mutate, service, request)
            for service, request in zip((first, second), requests)
        ]
        results = [future.result(timeout=60) for future in futures]
    fresh = CommandService(repository(isolated_state))
    incidents = fresh.list()
    assert len(incidents) == 1
    if operation == "same_request":
        assert results[0] == results[1] == incidents[0]
        assert incidents[0]["version"] == 2 and len(incidents[0]["notes"]) == 1
    else:
        assert results.count("conflict") == 1
    assert len(fresh.store.runs()) == (1 if operation == "analyze" else 0)

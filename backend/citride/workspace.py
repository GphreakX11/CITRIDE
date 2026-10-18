"""Compose the workspace's existing public views from one locked dataset."""
from copy import deepcopy

from .command import CommandService
from .records import RecordsService
from .storage import Repository


def run_summaries(runs: list[dict]) -> list[dict]:
    """The same ordered summary projection used by the legacy run-list route."""
    keys = ("id", "createdAt", "scenarioId", "baselineRevision")
    return [{key: run[key] for key in keys} for run in runs]


def workspace_snapshot(store: Repository, *, reset_enabled: bool) -> dict:
    """Read fresh, detached views; repository initialization belongs to the API.

    Dataset readers are transaction-neutral so this one lock/load also owns the
    Postgres transaction. Never call the independently locking public wrappers.
    """
    with store._locked():
        dataset = store._load()
        service = RecordsService(store)
        baseline = store._baseline(dataset)
        incidents = CommandService(store).list_from_dataset(dataset)
        records = service.records_from_dataset(dataset)
        return deepcopy({
            "bootstrap": baseline,
            "runs": run_summaries(store._records(dataset, "run")),
            "incidents": incidents,
            "records": records,
            "reference": service.reference,
            "health": {
                "status": "ok",
                "baselineRevision": baseline["baselineRevision"],
                "demoMode": True,
                # One clock sample keeps the two workspace views consistent.
                "now": records["now"],
                "operationsTimeZone": records["operationsTimeZone"],
                "resetEnabled": reset_enabled,
            },
        })

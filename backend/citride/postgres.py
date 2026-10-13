"""Transactional RDF persistence for stateless, pooled Postgres deployments.

The complete dataset lives in one row per demo. Every repository operation
loads that row inside a transaction and holds a transaction-scoped lock through
the read/modify/write cycle. This intentionally favors correctness and simple
deployment over throughput for this small synthetic demo. No process-local
dataset or lock is the authority, and no session state survives a transaction.
"""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
from pathlib import Path
import threading

import psycopg
from rdflib import Dataset

from .storage import Repository, StorageUnavailableError


def _lock_id(value: str) -> int:
    return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big", signed=True)


class PostgresRepository(Repository):
    def __init__(self, database_url: str, scenario_path: Path, state_key: str = "default"):
        if not database_url:
            raise ValueError("A database connection is required for Postgres storage")
        if not state_key or len(state_key) > 128:
            raise ValueError("Database state key must contain 1 to 128 characters")
        self.scenario_path = Path(scenario_path)
        self._database_url = database_url
        self._state_key = state_key
        self._state = threading.local()
        self._state_lock_id = _lock_id("citride:state:" + state_key)
        # Serialize table creation as well as first seed creation. Different
        # state keys can otherwise race on CREATE TABLE's catalog entries.
        with self._locked(initialize=True):
            connection = self._state.connection
            row = connection.execute(
                "SELECT nquads FROM citride_state WHERE state_key = %s FOR UPDATE",
                (state_key,),
            ).fetchone()
            if row is None:
                dataset = self._seed_dataset()
                connection.execute(
                    "INSERT INTO citride_state (state_key, nquads) VALUES (%s, %s)",
                    (state_key, dataset.serialize(format="nquads")),
                )
                self._state.dataset = dataset
            else:
                dataset = self._load()
                if self._repair_seen_on(dataset):
                    self._save(dataset)

    @contextmanager
    def _locked(self, *, initialize: bool = False):
        # Nested operations share only their current thread's transaction.
        # They never share a live connection between concurrent HTTP requests.
        if getattr(self._state, "connection", None) is not None:
            yield
            return
        try:
            with psycopg.connect(self._database_url, connect_timeout=10,
                                 prepare_threshold=None) as connection:
                with connection.transaction():
                    # SET LOCAL is compatible with transaction poolers. Avoid
                    # indefinitely holding serverless workers behind an OWL run.
                    connection.execute("SET LOCAL lock_timeout = '30s'")
                    connection.execute("SET LOCAL statement_timeout = '60s'")
                    if initialize:
                        connection.execute("SELECT pg_advisory_xact_lock(%s)",
                                           (_lock_id("citride:schema:v1"),))
                        connection.execute("""
                            CREATE TABLE IF NOT EXISTS citride_state (
                                state_key TEXT PRIMARY KEY,
                                nquads TEXT NOT NULL,
                                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                            )
                        """)
                    connection.execute("SELECT pg_advisory_xact_lock(%s)", (self._state_lock_id,))
                    self._state.connection = connection
                    self._state.dataset = None
                    try:
                        yield
                    finally:
                        self._state.connection = None
                        self._state.dataset = None
        except psycopg.Error:
            # psycopg messages can include hostnames, usernames and DSNs.
            # The HTTP boundary should return only this safe generic message.
            raise StorageUnavailableError("Durable storage is unavailable; retry later") from None

    def _load(self) -> Dataset:
        connection = getattr(self._state, "connection", None)
        if connection is None:
            raise RuntimeError("Postgres access requires a repository transaction")
        if self._state.dataset is not None:
            return self._state.dataset
        row = connection.execute(
            "SELECT nquads FROM citride_state WHERE state_key = %s FOR UPDATE",
            (self._state_key,),
        ).fetchone()
        if row is None:
            raise StorageUnavailableError("Durable storage is unavailable; retry later")
        dataset = Dataset()
        dataset.parse(data=row[0], format="nquads")
        self._state.dataset = dataset
        return dataset

    def _save(self, dataset: Dataset) -> None:
        connection = getattr(self._state, "connection", None)
        if connection is None:
            raise RuntimeError("Postgres access requires a repository transaction")
        result = connection.execute(
            "UPDATE citride_state SET nquads = %s, updated_at = CURRENT_TIMESTAMP WHERE state_key = %s",
            (dataset.serialize(format="nquads"), self._state_key),
        )
        if result.rowcount != 1:
            raise StorageUnavailableError("Durable storage is unavailable; retry later")
        self._state.dataset = dataset

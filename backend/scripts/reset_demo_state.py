"""Explicit operator-only reset of ONE existing Postgres demo state; no HTTP route.

Secrets are read only from the process environment. --expected-sha256 and exact
state-key confirmation fence the irreversible replacement. Capture a private
rollback export before using this command. Never use against another app/key.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from citride.postgres import PostgresRepository  # noqa: E402


def inspect_state(database_url: str, state_key: str) -> dict:
    with psycopg.connect(database_url, connect_timeout=10) as connection:
        row = connection.execute("SELECT nquads FROM citride_state WHERE state_key = %s", (state_key,)).fetchone()
    if row is None:
        raise ValueError("The explicit target state does not exist; refusing to create or reset another key")
    return {"stateKey": state_key, "sha256": hashlib.sha256(row[0].encode()).hexdigest(), "bytes": len(row[0].encode())}


def reset_state(database_url: str, state_key: str, expected_sha256: str, scenario_path: Path) -> dict:
    inspect_state(database_url, state_key)  # No accidental seed of a nonexistent key.
    repository = PostgresRepository(database_url, scenario_path, state_key=state_key)
    with repository._locked():
        connection = repository._state.connection
        row = connection.execute("SELECT nquads FROM citride_state WHERE state_key = %s FOR UPDATE", (state_key,)).fetchone()
        if row is None or hashlib.sha256(row[0].encode()).hexdigest() != expected_sha256:
            raise ValueError("State changed since the approved preflight; reset was not applied")
        dataset = repository._seed_dataset()  # Validate the complete new seed before replacement.
        repository._save(dataset)             # Atomic under the same per-state transaction lock.
    return {"stateKey": state_key, "resetApplied": True, "baselineRevision": repository.baseline()["baselineRevision"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-key", required=True)
    parser.add_argument("--scenario", type=Path, default=Path(__file__).resolve().parents[2] / "data/scenario.json")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-state-key")
    parser.add_argument("--expected-sha256")
    args = parser.parse_args()
    url = os.environ.get("CITRIDE_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("A database URL is required in the process environment")
    if args.apply:
        if args.confirm_state_key != args.state_key or not args.expected_sha256:
            raise SystemExit("Apply requires an exact state-key confirmation and preflight SHA-256")
        result = reset_state(url, args.state_key, args.expected_sha256, args.scenario)
    else:
        result = inspect_state(url, args.state_key)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (psycopg.Error, OSError):
        raise SystemExit("Operator reset failed; private connection details are withheld") from None

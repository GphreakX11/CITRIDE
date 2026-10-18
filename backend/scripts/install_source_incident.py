"""Install one missing configured source incident; dry-run unless --apply.

Review the JSON plan and hold an operator backup before applying its token.
Only explicit existing stores are opened: no ambient database, seed or reset.
Existing incidents must use their separate adoption/refresh procedure instead.
"""
import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from citride.source_install import install_source
from citride.storage import ConflictError, InvalidModelError, Repository, StorageUnavailableError


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--data-dir', type=Path)
    target.add_argument('--database-url-env', help='Explicit URL environment variable name; its value is never printed')
    parser.add_argument('--state-key', help='Required explicitly for Postgres; no default state')
    parser.add_argument('--scenario', type=Path, required=True)
    parser.add_argument('--incident-id', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-token', help='Exact token returned by the reviewed dry-run')
    args = parser.parse_args(argv)
    if args.apply and not args.expected_token:
        parser.error('--apply requires the reviewed dry-run --expected-token')
    if args.database_url_env:
        if not args.state_key or not os.environ.get(args.database_url_env):
            parser.error('Postgres requires an explicit state key and nonempty selected URL variable')
    elif args.state_key:
        parser.error('--state-key is only valid for Postgres')
    try:
        if args.database_url_env:
            from citride.postgres import PostgresRepository
            store = PostgresRepository(os.environ[args.database_url_env], args.scenario,
                                       args.state_key, existing_only=True)
        else:
            store = Repository(args.data_dir, args.scenario, existing_only=True)
        result = install_source(store, args.incident_id, apply=args.apply,
                                expected_token=args.expected_token)
    except (ConflictError, InvalidModelError, StorageUnavailableError) as error:
        parser.exit(1, f'Installation refused: {error}\n')
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

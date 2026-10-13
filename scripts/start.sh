#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$repo_root/frontend/dist/index.html" ]]; then
  echo 'Run bash scripts/setup.sh before starting the demo.' >&2
  exit 1
fi
cd "$repo_root/backend"
UV_CACHE_DIR=/tmp/citride-uv-cache exec uv run --locked uvicorn citride.api:app --host 127.0.0.1 --port 8000

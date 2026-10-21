#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
command -v uv >/dev/null || { echo 'Install uv using its official instructions before running setup.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'Node.js 24 and npm are required.' >&2; exit 1; }
python scripts/generate_demo_data.py --check
python backend/scripts/harden_ca.py require-uv
(
  cd backend
  UV_CACHE_DIR="${TMPDIR:-/tmp}/citride-uv-cache" uv sync --locked
)
ca_bundle="$(uv run --no-sync --project backend python backend/scripts/harden_ca.py certifi-path)"
[[ -n "$ca_bundle" && -s "$ca_bundle" ]] || { echo 'A verified CA bundle is required before npm installation.' >&2; exit 1; }
npm ci --ignore-scripts --strict-ssl=true --cafile "$ca_bundle" --prefix frontend --cache "${TMPDIR:-/tmp}/citride-npm-cache"
npm run build --prefix frontend

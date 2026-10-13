#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
command -v uv >/dev/null || { echo 'Install uv using its official instructions before running setup.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'Node.js 24 and npm are required.' >&2; exit 1; }
python scripts/generate_demo_data.py --check
(
  cd backend
  UV_CACHE_DIR=/tmp/citride-uv-cache uv sync --locked
)
npm ci --prefix frontend --cache /tmp/citride-npm-cache
npm run build --prefix frontend

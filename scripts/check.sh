#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
python scripts/generate_demo_data.py --check
(
  cd backend
  UV_CACHE_DIR=/tmp/citride-uv-cache uv run --locked pytest
)
npm run build --prefix frontend

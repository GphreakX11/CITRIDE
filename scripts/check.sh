#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
# Every stylesheet consumes the authoritative theme, including advanced tools.
if grep -RInE --include='*.css' --exclude='theme.css' '#[[:xdigit:]]{3,8}\b' frontend/src; then
  printf 'Hex colors belong only in frontend/src/theme.css\n' >&2
  exit 1
fi
node scripts/check_ui_copy.mjs
python3 -B scripts/build_idt.py --check
python scripts/generate_demo_data.py --check
(
  cd backend
  UV_CACHE_DIR=/tmp/citride-uv-cache uv run --locked pytest
)
npm test --prefix frontend
npm run build --prefix frontend
python3 scripts/check_no_egress.py --dist frontend/dist

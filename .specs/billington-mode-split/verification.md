# Mode-split blocker verification

## Scope
Fix the three independently reproduced workflow/context regressions without replacing the app architecture, disturbing existing uncommitted work, publishing, or touching production data.

## Corrections
1. **Uncertain creation recovery:** retained requests now have an explicit workspace-level retry control on A1/A3, outside the conditional case-file renderer. A read alone does not discard the request or unlock new changes; explicit replay retains the exact original payload and idempotency key. Known 4xx rejections are not replayed.
2. **Brief routing:** the common mode resolver recognizes command-only destinations from the actual navigation lists. Analyst Brief and incompatible leadership/federation deep links normalize to Command Center, preserving view/case/entity and history.
3. **Summary correctness:** parent selection is authoritative. Case summaries and their full-record action cannot retain a separately pinned incident after the picker changes or clears. Dismissal applies to the current selection only.

## Reproduction and verification
- Before implementation: focused tests reproduced **8 failures**, covering all three findings.
- After implementation: focused gate **24 passed, 0 failed**.
- Full frontend `npm test`: **140 passed, 0 failed**.
- `npm run format:check`: passed.
- `npm run build`: TypeScript and production build passed. Existing large-bundle warning remains.
- Full backend `backend/.venv/bin/python -m pytest backend/tests -q`: **364 passed, 13 skipped**. Skips require a live `TEST_DATABASE_URL`; this run does not establish live PostgreSQL acceptance. Existing deprecation warnings remain.
- `ruff check backend`: passed.
- `git diff --check`: passed.

## Real browser proof
`~/.hermes/cache/citride-verification/mode-blockers/verify_blockers.py` completed **13 checks**, using fresh isolated FastAPI/RDF state per scenario, Chromium desktop 1480px and mobile emulation 393px:
- Before-send failure, server-accepted/lost response, and accepted-save/failed-refresh paths from A1/A3.
- Explicit retry remains reachable; no automatic replay; exact payload/key reused; independent storage readback shows one case, same accepted ID where applicable, and version 1 after replay.
- New changes remain locked until confirmed recovery. Successful recovery re-enables navigation and opens the saved case normally.
- Brief click, direct incompatible links, reload and Back/Forward lead to actual read-only screens without mutations.
- C1/C6 picker change, All incidents, close/reselect and full-record target stay synchronized.
- Baseline model fingerprint remains unchanged; no horizontal page overflow or uncaught JavaScript errors.

The existing `pm-feedback-oct15/verify_ui.py` was rerun against the rebuilt final app: **14 checks passed**, including all command and analyst screens, case creation, real consequence-engine capture, evidence export, focus preservation, stale-read recovery, and 393px layouts.

Controlled browser error interceptions are labeled test scenarios, not real infrastructure outages. Successful saves/retries and independent readbacks used real local APIs, not fabricated responses. Each targeted scenario's temporary server was terminated afterwards. Screenshots/results are in the owner-local verification cache. Phone checks are Chromium emulation, not physical iPhone/Safari acceptance.

## Publication and remaining scope
All three reported blockers are fixed and exercised locally. No commit, push or deployment was performed. This does not mark deferred PM-roadmap items in `requirements.md` complete or establish hosted/PM acceptance.

# TXCC-inspired command workspace — local verification

## Scope and publication boundary

Original design source: `CITRIDE_TXCC_Demo_v7_2.html`, uploaded to the Hermes document cache. This implementation uses the eight-view command-center structure, dark styling, pending-review summary and coordination workflow as the primary interface, while preserving model/evidence tools behind **Model & evidence tools**.

Local branch: `feat/txcc-command-workspace`. No commit, push, hosting change or production database write was performed for this continuation. The user must separately authorize publication.

Operational status, staffing, formal authority, live source connectivity and partner delivery are not established by local casework. UI states and exported briefs preserve that distinction. Case tracking does not modify source events or ontology data.

## Verified checks

- Backend full suite: **345 passed**, with `TEST_DATABASE_URL` pointing to isolated loopback PostgreSQL 16.15. No PostgreSQL tests skipped in this run. Covers concurrency, rollback, idempotent replay, saved snapshots, restart, existing-row preservation and auth/security contracts.
- Frontend: **32 passed** with `npm test`.
- `npm run build`: TypeScript and Vite successful.
- `npm run format:check`: successful.
- Deterministic source fixtures: `python3 scripts/generate_demo_data.py --check` verified all five generated files.
- Modified command backend paths: Ruff lint successful. The repository-wide lint probe found three unrelated existing unused imports in `tests/test_api.py` and `tests/test_inference_api.py`; these were not changed to expand scope.
- `git diff --check`: successful.

## Real browser acceptance

`python3 scripts/verify_command_ui.py` was exercised against an isolated localhost API with real local storage. Viewports: 1440×960 desktop and 390×844 phone emulation in Chromium.

Both sizes passed:

1. Create a case from the recorded dosing event.
2. Cancel analysis confirmation without a save.
3. Confirm analysis of its explicitly linked scenario; capture three modeled impacts and three advisory decisions.
4. Visit all eight views without document-width overflow and with one top-level heading.
5. Record all three human advisory review notes and complete the casework checklist.
6. Save a local coordination note (not sent externally).
7. Verify closure confirmation can be canceled, then close with a recorded note.
8. Download an actual JSON brief containing the saved records.
9. Reopen, reload, verify persistence, and close again.
10. Verify the evidence/model-tools navigation remains available.

No page exceptions or failed HTTP requests were recorded in normal-flow acceptance. Baseline revision and serialized telemetry fingerprints remained unchanged by casework.

## Fault injection

`python3 scripts/verify_command_faults.py` passed against the isolated API. Harness failures were deliberate, not actual production failures:

- Let case creation commit, then abort its response: exactly one case remained, and retry reused the identical request ID and payload.
- Navigate to model/evidence tools and back: uncertain-save recovery remained available; unrelated writes stayed blocked.
- Let note creation commit, then abort its response: same-request retry produced exactly one note.
- Write concurrently through a second request, then submit a stale UI version: HTTP 409 rejected the outdated write. Latest casework was fetched; the draft remained available for an explicit user resubmit. No silent overwrite occurred.

## Artifacts

Local evidence is under `~/.hermes/cache/citride-verification/txcc/`, outside Git source:

- `acceptance.json`: desktop/phone workflow results.
- `fault-acceptance.json`: recovery/conflict results.
- `desktop-consequence.png`, `phone-consequence.png`.
- `command-overview-desktop.png`, `command-overview-phone.png`: populated design previews from an isolated reference-data case with a real captured engine run, not production activity.
- Desktop/phone JSON brief downloads.

Earlier failed diagnostic screenshots are not acceptance evidence.

## Supplemental review timeout

The delegated backend review timed out without returning findings; it is not counted as a completed independent review. After receiving the timeout, the parent verified that all worker-owned backend files predated the final browser acceptance and independently reran the backend suite: 332 passed, with 13 PostgreSQL tests skipped because the isolated PostgreSQL server had already been shut down. This does not replace or invalidate the earlier real-PostgreSQL run of 345 passing tests. No late code changes or additional publication actions were detected.

## Remaining boundaries

- No physical iPhone/Safari claim: browser acceptance used Chromium phone emulation.
- Build succeeds with Vite's non-blocking large-chunk advisory (approximately 828 kB uncompressed JavaScript).
- Existing FastAPI/RDFLib deprecation warnings remain non-blocking.
- Production schema/runtime smoke tests and publication are not authorized or performed by this local continuation.
- Optional real integrations (staffing, live OT/SIEM feeds, partner notifications, authority/gate systems) remain separate work, not mocked as operational readiness.

# Implementation evidence

Implemented the versioned redacted reference manifest; canonical, case-local creation through the existing authenticated case endpoint; eight task labels with criteria; immutable captured evidence and source fingerprint; desktop/mobile evidence and endpoint cards; reference Evidence shortcut and local brief export. Baseline, ontology, services, entities, scenarios, runs, proposals and regular three-task cases are not modified.

## Verification
- Backend: 341 passed / 13 skipped (optional real PostgreSQL tests require an isolated TEST_DATABASE_URL).
- Frontend: 64 passed; TypeScript production build and Prettier check passed.
- Existing real-API desktop/mobile command journeys: navigation, analysis, three decisions/tasks, closure/reopening, reload and brief read-back passed.
- New isolated real-API desktop/393px mobile journeys: 16 endpoint cards, 14 phases, eight open tasks, captured source hash, expanded-phase overflow, evidence navigation, task toggle restored incomplete, saved-case read-back, reload/refresh, brief parity; no page errors.
- Protected-state fingerprints proved two prior local cases and all source/model/history APIs unchanged.
- Visual inspection caught legacy expert-view light styles; scoped dark colors and an actual computed IP foreground/background assertion were added and passed.
- Built wheel and verified inclusion of the canonical JSON manifest and resolver module. Build tools are isolated under the QA cache; Hermes interpreter packaging remained unchanged.
- Source payment-key literal absent from changed/untracked repository files and exported report.
- Local QA case: 7e5387fa-e387-493a-af46-d97644c903e9. All eight tasks remain open, no impact run or decisions. This is not a production receipt.

Artifacts: ~/.hermes/cache/citride-verification/reference-waterutil/. Reproducible bounded harness: scripts/verify_reference_investigation.py (loopback only; explicit --resume, no automatic reseed).

## Publication boundary
No commit, push, deployment or production write performed. Production publication and one bounded reference-case import require approval, then fresh production protected-state capture, idempotent POST, independent read-back and live desktop/mobile acceptance. Publishing permission is not proof of actual PCAP validation or operational authorization.

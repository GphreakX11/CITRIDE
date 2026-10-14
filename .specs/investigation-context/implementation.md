# Implementation and candidate verification

## Shared context
- App owns the selected entity/case and the complete map view state for in-app navigation. No private state is written to browser storage.
- Saved case links use captured provider/facility/physical/cyber assets and explicit downstream/decision endpoints. Geographic membership cannot attach an unrelated case.
- Case selection preserves an already-linked entity; otherwise it focuses an explicit captured asset. An unlinked entity clears the case and disables impact/task shortcuts.
- The context bar follows map, evidence, impacts, tasks, and expert tools. The evidence screen highlights the captured event while retaining access to the broader source records.
- Successful case responses are published to parent context before selecting the returned case. Workflow loading, pending writes and uncertain saves lock the new context controls.

## Relationships
- Plain-language story and unique supplier/dependent counts derive from actual directed service dependencies.
- Supplier/dependent modes fit and display only direct endpoints, excluding unrelated, transitive and organizational connections. The matching inspector section appears first and resets its scroll position.
- Ownership/cyber/location links are secondary and opt-in on the graph, and expandable in the inspector. Dependency sources, functions, timing and backup assumptions remain available.
- Conditional model impacts are explicitly not current outages or live countdowns. No operational action or external notification is introduced.

## Candidate gates exercised
- Frontend: all 58 unit tests, project formatting gate, new test formatting, TypeScript check, production build.
- Backend: 332 tests passed locally; 13 real-Postgres integration tests require TEST_DATABASE_URL and are exercised by the existing GitHub CI Postgres service. No backend/configuration/database changes are part of this release.
- Deterministic reference-data generation check passed; seed artifacts are unchanged.
- Chromium desktop (1440×1000) and phone (393×852), local production assets with real read-only production APIs: actual marker hit, directional endpoint isolation, shared entity/case across evidence/impacts/tasks, restoration of panned/zoomed viewport and nondefault area/focus/context filters, expert-graph round trip, different-utility isolation, no invented linkage for Facility Q, case-driven entity change, captured asset traversal, zero browser errors, no page horizontal overflow.
- Clearly isolated browser response fixtures (no real API writes): accepted create selection/callback ordering, task save preserves a selected downstream facility, uncertain save retains context and locks controls.
- Visual review corrected the selected-evidence card contrast and improved phone map-control label/touch sizing.

## Late-review corrections
- Reproduced two remaining edge cases against real read-only APIs: selecting a saved Scenario Lab impact changed the entity without synchronizing its case; refreshing a new-case/cleared selection silently defaulted back to an old case.
- All impact-row selections now use the common guarded entity-selection path. A session-only initialization marker distinguishes first loading from explicit new-case/cleared intent and resets on authorization loss.
- Added two pure refresh-selection regression tests, plus real-API desktop/phone tests using an existing saved run (no new analysis/write) and a locally typed unsaved draft. Those paths now pass alongside the full original candidate acceptance and isolated accepted/uncertain-write fixtures.
- The late reviewer also noted selector locking from an earlier snapshot; the initial deployed release already contained that correction, and current browser tests verify it remains intact.

## Release verification
Before release, capture production API/auth/state fingerprints. After the Git-backed deployment, require exact commit metadata, CI success including real Postgres tests, live desktop/phone acceptance, and unchanged protected baseline/case/telemetry/run fingerprints. Durable production evidence and screenshots are stored outside the repository in the local CITRIDE verification cache; no credentials or private case payloads are committed.

# Verification: interactive infrastructure map

## Delivery status
Implemented and verified locally against the rebuilt frontend and an isolated FastAPI/RDF repository. Not committed, pushed or deployed. The existing production release was not changed.

## Reproduced failures
- Existing C1 showed 11 SVG markers but **zero selectable/keyboard-operable map controls**, no detail panel, and no selection/URL change after a marker click.
- All-incidents used only `consequenceModel(null)` and therefore removed every modeled highlight.
- The old renderer merged historical entity snapshots with current inventory while resolving dependency lines from current Bootstrap, so selected saved-case topology could disagree with captured evidence.
- Added two failing C1/C2 integration regressions before implementation; both now pass.

## Implemented
- Shared C1/C2 infrastructure explorer with separate utility, water-treatment (plant + droplet), hospital, dialysis, nursing, power, fire and neutral facility icons.
- Actual clickable/tappable SVG markers with keyboard Enter/Space, Escape/clear, selected focus ring and parent entity/URL selection.
- Evidence-backed inspector: reference versus saved record basis, captured consequences and scenario windows, source/model details, directional dependency navigation and linked saved cases. Gray/reference is not an assertion of normal operation.
- All/Water/Healthcare/Power/Emergency display controls, zoom/reset, background drag and explicit pan controls. The facility directory supports precise touch/keyboard selection and closes after selection; narrow layouts offer a direct accessible jump to details.
- All-active view overlays every active case's captured impacts on reference inventory, retains captured labels in result cards and flags current/captured label or type differences. Selected-case view uses saved case/run layers, not current model links. Known cyber/physical assets remain out of the infrastructure-only map.
- Identical full dependency records deduplicate while changed historical records/versions retain their provenance. Missing endpoint/impact records remain explicit; geography or source membership never manufactures an edge.
- Inspector → Analyst preserves the selected entity and explicit case; in all-cases scope it prioritizes the actual modeled-impact case rather than an arbitrary linked, unmodeled case. A facility absent from current inventory opens its saved case instead of a broken current profile.
- Display numeric metrics with grouping (e.g. `18,000`). No inventory, history, classification or population records rewritten.

## Authenticated live-data review (GET only)
Metadata-only receipt: `~/.hermes/cache/citride-verification/interactive-map/production-data-audit.json`.

- Current model: `citride-interval-v1`, revision 1; 58 entity records, 6 recorded dependencies; no dangling provider/dependent references in those dependencies.
- 3 active saved cases, 1 with a captured consequence run, 3 modeled impact rows / facilities and 3 unreviewed advisories. These are not 3 confirmed outages or 3 approved operational actions.
- Captured service-area population is 18,000; it is inventory population for modeled scope, not observed outage exposure or facility occupancy. Added tests retain unknown values when saved populations conflict or are incomplete.
- IDT reference is available (1,985 entries), but none of the captured impacted entity records contains an inline IDT assignment. Preserved the historical classification gap rather than silently assigning today's taxonomy to old evidence.
- Positions remain illustrative/reference topology; no live OT/geocoding/tile connection added.
- No production writes and no secrets or raw production records saved in the receipt.

## Independent-audit follow-up
- Fixed and regression-tested two latent population defects: repeated `serves` references doubled selected-case totals; array-form `locatedIn` references failed scalar equality and became unknown. Normalize references and deduplicate service areas in derived display calculations only. Population groups spanning several areas remain unknown rather than being allocated or counted twice. Current live 18,000 is unchanged.
- **Open validation hardening:** `capturedClassification` accepts syntactically numeric codes without canonical IDT membership checks, and incomplete `below_idt_level` assertions can omit their parent entity. Audit probes reproduce `coded/path=999` and `below_idt_level/parentPath=12.4` with no parent entity being counted as classified. No current captured impacted record contains an IDT assignment, so these probes do not affect the reviewed live metrics. Before describing captured taxonomy as validated/verified, use canonical reference validation while preserving raw historical assertions; do not backfill history from today's advisory assignments. This hardening is not implemented in this map patch.

## Gates
| Gate | Result |
|---|---|
| Frontend full suite | 165 passed, 0 failed |
| Frontend format check | PASS |
| TypeScript + production build | PASS |
| Backend full suite | 364 passed, 13 PostgreSQL tests skipped; 742 warnings |
| Ruff | PASS |
| Git whitespace check | PASS |
| Actual Chromium browser acceptance | 22 checks passed; desktop 1440px and phone emulation 393px |
| Unexpected mutating browser requests | 0 |
| Uncaught browser application errors | 0 |
| Before/after isolated API state | All 7 fingerprinted endpoints unchanged |

The 13 database tests require `TEST_DATABASE_URL`; PostgreSQL was not exercised by this local run. The pre-existing Vite bundle-size warning remains non-blocking. Native phone tap was exercised in Chromium emulation, not a physical iPhone/Safari.

## Browser evidence
Runner: `~/.hermes/cache/citride-verification/interactive-map/verify_browser.py`.
Receipt: `browser-results.json`, with incremental `browser-checkpoints.json`.

- Real painted-icon clicks for every facility on both widths, not forced/JS-dispatched events.
- Enter/Space/Escape, highlight + URL + detail agreement; reversible categories and hidden-selection clearing.
- Zoom, reset, explicit pan, actual background pointer drag; selection retained.
- Facility-directory locate, modeled timing/details, native mobile touch and direct focused details jump.
- Exact modeled case/entity handoff to Analyst and browser Back; C2 interaction and captured case scope.
- Directed saved dependency lines; no horizontal page overflow.
- Explicit negative browser fixture removes a facility/current dependencies **only from the browser's current Bootstrap response**. Real backend/saved evidence is unchanged. Saved graph/selection still work and open captured case rather than a nonexistent current record. This is a controlled regression fixture, not a production-data finding.
- Before/after fingerprints for Bootstrap, cases, cascade runs, inference runs, telemetry, ontology and dependency proposals; GET/HEAD/OPTIONS-only guard recorded no attempted writes.

Screenshots: `before-map.png`, `after-map-1440.png`, `after-map-393.png` in the same private verification cache. Test setup created cases and ran the actual engine only in the isolated local QA repository.

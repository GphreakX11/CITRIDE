# Full Houston update — ordered review delivery

## Authority and source

- The latest explicit instruction authorizes finishing the full Houston update, fixing scoped blockers and production release. Earlier review-only/visual-approval release restrictions are superseded; evidence, safety and saved-state preservation gates still apply.
- Original package: `~/.hermes/cache/citride-houston-update/package/`.
- Read order: `CONTEXT.md`, `incidents-background.md`, `houston-update.md`.
- Baseline: `109028d` (featured-incident configuration and real operations clock).
- Review branch: `feature/houston-complete`.
- Older hardening changes remain isolated on their existing worktree/branch.
- Production data, saved cases, analyses, revisions and timestamps must not be reset, re-seeded or migrated by GET/startup.

## Delivery boundaries

1. **A — Donna:** supplied Port data; real validated central ingestion and persistent storage; generic scoped records/API; shared frontend helpers. Tests include customer/incident isolation, stable counts, missing/zero scores, third-customer scenario and 2,000 entities. Push tested A before starting B/C/D.
2. **B — Donna:** C4 sector dependency drawing, distinct watch relationships, scores, drill-downs, critical functions, and shared metric helpers. Retain Water behavior and no place-specific conditionals in screen code.
3. **C/D — actual ThunderCat:** C1/C2 only, from Donna's exact pushed A commit. Existing source/tools confirmed on Mac mini; a readiness acknowledgment is not completed implementation. Donna owns shared wiring, integration and release.
4. **Acceptance — Donna:** complete tests, build, read-only desktop/phone captures, interactions, source/API parity and independent review. Production publication is explicitly authorized, contingent on passing technical gates.

## Acceptance matrix

- C1: real incident-driven map/cards, Houston severity, sector scores, pulsing cascading assets, card-to-C2 navigation.
- C2 Houston: initiating source, data-linked dependencies and statuses; pull-down and URL selection; Energy/Water filters and return to all sectors.
- C2 Water: Healthcare filter and unchanged original Water incident behavior.
- C4 Houston: source and four sector groups; proper directional supply links; watch/campaign relationships remain visually distinct and are not service dependency evidence.
- C4 metrics: unique asset counts, separately stated cascade/watch categories, no fabricated count to match a mockup.
- C4 five supplied critical functions; Energy subsectors and all supplied inside-sector rows, including vessel status rows; zero and missing scores remain distinguishable.
- C4 Water/third customer: data-driven graph, name/location/labels and scores; missing authored metadata degrades honestly, never to invented values.
- Desktop 1440px and Chromium phone viewport 393px: no horizontal overflow, readable labels, useful first viewport, keyboard/click targets and no unexpected requests/errors. Phone viewport coverage is not physical iPhone/Safari certification.
- Mutating controls in captured Command views remain absent/locked. UI acceptance uses an isolated temporary API, never production writes.
- Customer identity/permissions/configuration must accurately reflect implemented boundaries. Do not claim database-level multitenancy or integrations from fixture separation.

## Evidence classes

- Original PNG/HTML mockups are design references, not app screenshots.
- Unit/SSR/API tests are not browser visual acceptance.
- `scripts/verify_houston_ui.py` captures actual local build + real isolated API, with revision and dirty status. Captures require subsequent original-reference comparison and interaction checks.
- Final evidence must identify exact candidate revision. Earlier passing checks do not certify later patches.

## Data consistency rule

Authoritative source inconsistencies are blockers, not permission to invent relationships or force engine output to an expected number. Expected-window fixtures are regression oracles only, never inputs to the engine. If supplied data cannot produce its promised timing/counts, preserve and report the observed values and stop the dependent phase until the discrepancy is resolved.

## Authorized synthetic-input reconciliation

The source author explicitly selected option 1: reconcile the synthetic input records to Carmen's specified timing and 14-asset total, documenting corrections. The author further confirmed: "stated timing windows govern."

- Original package remains unchanged; corrections are in working `data/scripted/port_houston.json`.
- `poh-dep-crude`: usable backup maximum 11 → 10 hours. With onset [0,1] and propagation [0,1], calculated window is [6,12].
- `poh-dep-barges` and `poh-dep-feedpipe`: usable backup maximum 16 → 15 hours. With onset [0,1] and propagation [1,2], calculated windows are [12,18].
- These are authorized synthetic scenario assumptions, not verified real-facility values. Each changed dependency documents its rationale. Expected-window oracles, seed onset, propagation delays, and engine calculation rules remain unchanged.
- Added an explicit `motiva-refinery` monitoring watch record, consistent with its existing entity and Energy sector details. It is watch-only, not an asserted operational outage or new service dependency.
- Verified counts: 11 cascade assets, 5 watch assets with 2 overlapping cascade assets, 3 watch-only assets, 14 unique assets.
- Reproduced timing and count failures before correcting inputs. After correction: **146 passed** across Houston Part A, C4 foundation, legacy preview, scripted records, and scripted validation tests. The actual records and consequences HTTP contracts also pass. Non-failing dependency deprecation warnings remain.
- Data timing/count discrepancy gate is cleared locally. This is not full Part A acceptance, completed screen integration, visual approval, a pushed handoff, or production release. Pending-decision contract and remaining full-package acceptance still need work.

## Current progress

C1/C2 source was delivered by named ThunderCat from the pushed Part A revision, reviewed as code, and integrated. Parent review repaired authored coordinate use, overlap-watch relationships, source-system evidence, selection styling, and the shared C1 count. C4 now has directed sector links and a compact phone representation. Source adoption preserves raw timing metadata and exact existing record history.

Final local evidence is under `remainder-evidence/`: desktop/393px Chromium interactions cover C1-to-C2 navigation, Energy/Water/Healthcare filtering, URL state, map/list selection, zoom/pan, watch selection, palette inheritance, source IT badge and C4 drill-down. No browser errors, writes, or page overflow were observed. Full backend/CI and exact-revision live preservation checks remain release gates; screenshots are not physical Safari certification.

# Priority, incident context, and phone review

Scope: recommendations 1, 2, and 4 only. Review branch; no production release.

## Changes

- C1 shows the top three open incidents before the map, with the ranking basis, evidence status, recorded owner/timing (or explicit unknowns), a relevant review action, and access to the remaining register. Saved requests, modeled planning windows, and provisional sample options remain distinct. On phones the queue precedes aggregate tiles so the first action fits on screen.
- Saved-case Command and Analyst screens share a human-readable incident bar, change/clear control, location, priority, status, and a collapsed technical-ID disclosure with clipboard fallback. Busy/uncertain-write guards remain intact. Selecting a saved case removes stale statewide URL focus.
- C1 stays statewide; C2 and C4 retain their record-owned selectors, including reference scenarios with no saved case. They do not display an unrelated saved-case banner.
- Phone consequences show modeled impact, earliest planning window, analysis provenance, and the next review action ahead of technical detail. The global header is compact; desktop detail remains available.

## Verified

- `cd frontend && npm test`: 651 passed, 0 failed.
- `cd frontend && npm run build`: passed TypeScript and Vite build. Vite retains the large-chunk advisory; code splitting is outside this slice.
- Browser acceptance used candidate build assets with an existing isolated loopback QA API. Desktop 1920×1080 and phone-sized Chromium viewports 393×852 and 375×812 passed.
- Checked C1 queue order/drilldown; saved context across Command/Analyst; change, reload, clear, technical ID; water and Port consequences; first phone action visible without scrolling; no horizontal page overflow.
- No browser page errors, no mutating API requests, and unchanged saved-state fingerprints after excluding per-request clock fields.
- Screenshots captured for overview, both consequences examples, and shared context at all three sizes; inspected representative desktop and phone images.

This is viewport emulation, not physical iPhone/Safari certification. Production was not modified. Local browser screenshots and harness are review evidence, not production data or committed application assets.

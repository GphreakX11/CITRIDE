# C1 Command Overview — review handoff

Branch: `fix/c1-command-overview-20261017`
Authority: Carmen's `c1-command-overview.md` and `C1_Command_Overview.html` attachment.

## Scope and release boundary

This is a **C1-only review implementation**, on top of the existing shared semantic-tone foundation. The original dirty repository and the unfinished C2 work were preserved. No production deployment, backend or inference-model changes, schema changes, data replacement, migrations, fixture changes, inference changes, or C4/A4 graph changes are included.

**Open prerequisite:** Carmen's specification puts C1 after the C2 Incident View replacement. That separate C2 replacement is not completed or certified by this branch. Its existing navigation label/layout remain unchanged. Do not treat this branch as a completed combined C1+C2 release.

## Implemented

- Selection-free statewide context and totals over the complete active incident register.
- Separate investigation and modeled-cascade counts; closed cases excluded; recovering incidents do not pulse.
- Record-driven Texas map using the canonical boundary, industry glyphs, severity outlines, source service-area context, related probes, and collision-aware labels.
- A labelled-list fallback when a viewport cannot safely accommodate map labels.
- Independent, deterministic CSS pulse phases, with reduced-motion stopping both marker rings and the cascading dot.
- Severity/newest-first incident cards, all initially closed, with a single open card and toggling behavior.
- Modeled-impact vs. unmodeled copy, IDT sector names/codes, latest analyst update, and C2/C3/C4/contextual Analyst drill-downs.
- Statewide pending decisions, grouped facility windows, boil-water copy, and three latest analyst updates.
- Record-only Analyst links explicitly clear any unrelated saved-case selection and filter A1 to the requested incident, without creating a case.
- Phone-specific summary-tile stacking and a safe map/list fallback.

The live records, not the mockup's literal names/order/timestamps, determine content. Existing application chrome and shared typography/palette tokens were retained. This is not a pixel-identical replacement of the whole application shell.

## Verification

| Check | Actual result |
| --- | --- |
| `scripts/check.sh` | Passed |
| Backend suite | 707 passed, 20 skipped |
| Full frontend suite, rerun after final frontend edits | 545 passed, 0 failed |
| Typecheck | Passed |
| Production build | Passed; existing large-chunk advisory remains non-fatal |
| Retired-copy check | Passed |
| IDT reference validation | 1,985 entries / 18 sectors validated |
| Deterministic synthetic data check | 15 files validated |

Unit coverage includes generic contained/cascading/multiple-cascade cases, closed/recovering states, known/unknown/invalid windows, multiple windows, source/controller exclusion, provider/probe provenance, cross-case aggregation, immutable captured baselines, safe URL focus, and dense-map fallback/inside-boundary geometry. Existing header/read-only/recovery coverage was retained and adjusted for the new C1 contract.

### Real browser acceptance

Executed against an isolated loopback instance with the previously prepared, accepted model snapshot. All non-GET/HEAD requests were blocked throughout these browser checks; no preparation was replayed. Durable data-file fingerprints remained unchanged.

- Fresh C1 is statewide and all cards are collapsed.
- A keyboard-activated map marker opens exactly its corresponding card; accordion toggles do not alter statewide context or totals.
- Pulse phases visibly change; reduced motion stops the ring and dot.
- Saved-case C2/C3/C4 and Analyst links preserve incident/case context.
- People/earliest/decision summary tiles navigate to contextual C4/C6; earliest includes the facility focus.
- A record-only link opens incident-filtered A1 with no invented case; browser Back restores statewide totals.
- A 390px phone viewport has no horizontal overflow and the summary labels remain compact and readable.
- No JavaScript page errors and no attempted backend writes.

See [`evidence/browser-acceptance.json`](evidence/browser-acceptance.json) for measured results. Context handoff checks do **not** certify the separate unfinished C2 visual replacement.

## Visual evidence

Desktop captures use a **1920×1080 viewport**, device scale 1, full-page screenshots. Comparison sheets preserve native image dimensions, are top-aligned with bottom padding, and are neither cropped nor resized. Both pulse phases and the phone capture were inspected. A phone label-squeezing defect discovered during visual QA was corrected and rechecked before handoff.

- [Target vs. implementation](evidence/C1-target-vs-after.png)
- [Before vs. after](evidence/C1-before-vs-after.png)
- [C1 collapsed](evidence/C1-after.png)
- [C1 expanded](evidence/C1-expanded.png)
- [Pulse phase 1](evidence/C1-pulse-1.png) / [phase 2](evidence/C1-pulse-2.png)
- [390px phone](evidence/C1-mobile.png)

Numbers and timestamps may differ across captures because they are sourced from the accepted records and application story clock, not hard-coded to the target HTML.

# Overnight integration and release contract

## Source and authorization

Jake authorized implementation end-to-end and release only after all required tests pass. The uploaded `Overnight_Package.zip` has SHA-256 `50ed090e5086e1c7f789139f60cfba4d089b6287fd151a4321be0da8cddfd39d`.

The complete supplied requirements are preserved in [C2/C4 source](overnight-c2-c4-source.md) and [follow-up source](overnight-checks-source.md). The four supplied PNGs are local acceptance references; they are not deployment evidence and are not committed as source binaries. Written cascade-path rules take precedence over any arrows drawn inaccurately in the original mockups.

## Baseline and preservation

Start from released port-fix commit `0c04b192f01bd0301e720911a612704f00f627cf`. Its main CI run `39259882042` passed. Production deployment `dpl_47q1EMiEC8qixsJVWAbbo6sXxmzH` is READY on `https://citride.vercel.app`.

Before-package production backup is held outside Git, mode 0600, with SHA-256 `ac3a54d2c6e40d1568a11372152f96e81dddd69c354811a6ba72691af39cdb60` and 12,370,799 bytes. Database state, saved cases, immutable runs, record clocks and metadata are protected. No live resets, sample rewrites or replacement seeds. Any required source refinement gets an exact ledger, validated add-only/explicit plan, dry run and fresh backup before application. Read-only verification must prove the resulting state unchanged.

## Ordered gates and file ownership

1. Donna Part A: server-derived and run-captured sector links, pure feature view models, module components/styles/tests, one shared URL-selection helper, incident-derived C2 facts, compose swapped C2/C4, remove replaced code; test and push exact reviewed SHA.
2. Actual ThunderCat on the Mac mini: branch `links-check-wip` from that exact SHA; link audit and Analyst-only fixes/tests. Donna resolves Command/backend findings, merges and verifies actual patch.
3. Follow-up only after merged swap: Donna owns checks 1, 3–8, 10, 11 plus Command/backend half of 2/9. ThunderCat branches `checks-analyst-wip` from the merged SHA for Analyst half of 2/9. Fixtures and destructive operations are confined to disposable local/copy stores.
4. Full regression gates, before-release state comparison, deployment of exact tested merged SHA, actual live authentication/assets/desktop/phone and unchanged-data verification.
5. One combined Carmen-ready report: old port acceptance plus both new phases, screenshot evidence, every link checked/fixed/removed, check matrix, timings, explicit data/ontology ledger and every `// PROTOTYPE:` shortcut. Limitations are disclosed, not relabeled as passes.

## Shared Part A server contract

`sectorLinks` entries: `id`, `from`, `fromKind` (`source` or `sector`), `to`, `service`, `step`, `dependencyIds`, `windowHours`. The source endpoint is `projection.source.id`; sectors are authored labels. Links come only from captured recorded dependency paths and service labels, never layout positions or name-based conditionals. Target windows determine colors. Watch edges are separate, dashed amber and expressly not physical dependencies. New runs capture this derived projection; legacy immutable runs stay byte-identical and are projected only from their own captured inputs.

## Required evidence

- Pure model tests on port, water, renamed third fixture and larger fixture.
- Source-direct and cross-sector link proofs, including absence of unsupported direct links.
- Actual C2/C4 screenshots for both authored incidents at 1440, 1920 and phone width, no horizontal overflow; counts/windows preserved.
- Full navigation walk across C1–C7 and A1–A6/Case File/Entity Profile, before/after opening one case in copies, history/reload and link styling; >=50 incidents/300 assets on fixture only.
- Customer boundary enforced by the configured backend as well as UI. No claim of multi-tenant authentication beyond what is actually implemented and tested.
- Separately identified preliminary/reviewed chronology and staleness based on captured revision/assumptions. Never turn read time into capture time.
- Counts, positive OWL entailment plus known probe and cross-customer negatives, backend reset guard/idempotency/revision protection on copies only.
- Hosted and locally served backup measurements before/after, identical method: three cold Chromium contexts, populated first-screen latency and workspace payload. The local receipt explicitly says WSL; it is not passed off as a physical laptop measurement.
- Full Python/frontend suites, TypeScript/build, applicable generator/ontology checks, CI on exact final SHA, real production receipt and database preservation proof.

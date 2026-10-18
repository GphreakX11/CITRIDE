# Configured incident defaults and real-time prerequisite repair

## Scope

This review branch repairs the two missing prerequisite contracts for the supplied update package. It is not the package's full Part A/B/C/D implementation or production approval. The storage design, authentication, analysis engine, existing cases and saved runs must remain intact.

## Acceptance contract

1. `data/scripted/c4_reference.json` owns `featuredIncidentId`. Application source must not embed a customer-specific default incident identifier.
2. The backend records envelope and consequence response expose this configured value. Explicit URL/incident selection wins; otherwise an available open featured incident wins; otherwise selection is deterministic by open-incident severity, then identifier, identically in backend and frontend. Reference-only records are not automatic defaults. A missing or closed configured incident cannot force a closed default. An empty open set stays empty.
3. The UI clock displays actual wall-clock time in the configured operations time zone (browser time zone when unset), shows its daylight-saving-aware short name, and advances every minute without a reload. Source timestamps remain timezone-qualified. Model evaluation-hour offsets remain model inputs, not a simulated application clock.
4. Current records/API consumers use `now`. Current response schemas do not expose the retired simulated-clock fields. Old persisted field names may be read only at the compatibility boundary; reading legacy state must not rewrite records or reset their timestamps.
5. `sampleDataAnchor` is stable across repeat reads and server restarts. Saved run snapshots, case timestamps, IDs and sample-record timestamps are preserved.
6. Both supplied consequence examples have persisted preliminary analysis in a new isolated seed, and the port incident is available from the backend register. Existing saved reviewed analysis still takes precedence.

## Verification

- Targeted regressions cover alternate configuration, explicit selections, missing/closed defaults, empty sets, live API fields and preserved legacy state.
- Full backend tests include an independently verified local disposable PostgreSQL cluster, not a production database.
- Frontend tests, type/build, generated-data and no-egress checks run on the integrated branch snapshot.
- Browser acceptance reads an isolated store created with the older backend: C2/C4 default and explicit selection, reload, header ticks, console errors and read-only persisted-state fingerprints.
- Existing hardening changes in other worktrees are excluded and preserved. All changes remain on a review branch; no deployment or merge to main is included.

## Existing prototype limitations

- This repair does not replace file/PostgreSQL snapshot storage or introduce normalized tables.
- Sample-record relative times still materialize from one stored anchor; they are sample data, not a simulated system clock.
- The broader package's intake generalization, cross-customer scaling and port presentation requirements remain separate acceptance work.

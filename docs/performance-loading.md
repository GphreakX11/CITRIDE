# Workspace loading and navigation performance

## Observed bottlenecks

Read-only Chromium measurements against `https://citride.vercel.app` at
1280 px and 393 px viewport widths found:

| Measurement | 1280 px | 393 px |
| --- | ---: | ---: |
| Initial usable workspace | 12.13 s | 8.60 s |
| Switch view during a focus-triggered refresh | 6.57 s | 7.11 s |

These are individual observed samples, not a percentile or a native-phone test.
Authentication was established through the request context before the single
page navigation. All application requests were real, read-only GETs. Request
payloads, application records, and credentials were not saved in the timing
report. Timings vary with serverless cold starts and database availability.

The application issued a bootstrap/history wave followed by a case/records
wave and a separate health request. Most data responses were small, but the
transactional RDF backend repeatedly loaded and parsed the same stored dataset
under its existing exclusive advisory lock. Increasing subscription limits does
not remove that repeated work. A separate UI condition froze the entire
navigation whenever the 15-second, focus, or visibility refresh read was active.

## Changes

- `GET /v1/workspace` builds bootstrap, run summaries, public cases, derived
  records, reference data, and health from one locked, loaded dataset. Existing
  routes reuse the same view builders. Authentication, durable state format,
  write logic, version checks, and database locking/isolation are unchanged.
- App startup requests the combined snapshot and telemetry concurrently. The
  already-loaded snapshot hydrates the case workspace without a second request
  wave or an additional health query.
- Background and explicit workspace refreshes use the same combined endpoint.
  A baseline revision change cannot silently restore the old multi-read path.
  Standalone component integrations without a startup snapshot retain their
  existing endpoint contract.
- Background reads no longer freeze view navigation once data is available.
  Initial loading, active writes, and uncertain write outcomes remain locked;
  local mutation controls still include their existing read/write guards.
- Concurrent identical GETs share an in-flight request. Only the three bundled
  reference/ontology routes have a 60-second, document-local JSON cache. Cases,
  records, evidence, runs, and workspace snapshots are not cached after a
  request finishes. Every write (including a failed/uncertain write) and every
  authentication failure invalidates cached/in-flight reads. A pre-write GET
  cannot resurrect an old cached result. Consumers receive detached JSON.

## Verification

New regression coverage verifies snapshot/legacy response parity, a single
repository load without nested local locks, no saved-state changes, fresh story
clock/late-task derivation, external-worker updates, incident filtering,
idempotency-receipt redaction, malformed-state error parity, authentication and
private/no-store headers, cache invalidation, hydration, baseline changes, and
the complete navigation-lock truth table.

Disposable Postgres integration tests additionally verify exactly one real
connection, N-Quads parse, and load per snapshot; unchanged N-Quads and row update
time; and visibility of another repository connection's committed changes.

The built application was tested with real local Postgres at both viewport
widths through Command and Analyst view switches, including a focus-triggered
refresh, without browser errors. Startup used exactly `/v1/workspace` plus
`/v1/telemetry`; repeated navigation downloaded the IDT reference once. This
local fixture run is functional verification, not a production before/after
speed claim. A release must separately verify the canonical production alias,
production authentication, saved-state fingerprints, and post-release timings.

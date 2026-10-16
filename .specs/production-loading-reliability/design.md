# Design

## Evidence
The production row is 7,789,437 bytes, with one saved inference and 67 baseline entities. Live reads took approximately 30–55s. A browser replay reached bootstrap at 12.736s and cascade history at 28.121s but still showed “Loading saved operating picture” at 30s. The photographed historical 503's exact PostgreSQL exception was not retained in available provider logs; do not claim to have recovered it.

Profiling attributes 6.6s of an 8.2s local parse to RDFLib's line-framing regex. The chunk reader repeatedly scans the growing buffer for a multi-megabyte JSON-literal line. Native framing parses the same data in 0.65–0.72s; all populated named graphs are isomorphic, with equal baseline/history JSON.

A deterministic regression reproduces four repository constructors on four concurrent initial requests. Another shows a repository published before records initialization succeeds, letting a retry incorrectly bypass the failed initialization.

## Minimal repair
- `citride.nquads.parse_nquads`: universal-newline StringIO framing and a narrow NQuadsParser.readline override. RDFLib still validates terms, escapes, blank nodes, datatypes and graph contexts. No global parser registration/monkeypatch, dependency or format/schema migration.
- PostgreSQL `_load` uses that parser; no write/locking/rollback changes or stale cache.
- An app-local lock builds a candidate and publishes it only after records initialize successfully. Failure remains retryable.
- PostgreSQL diagnostics log only phase, SQLSTATE, exception class and elapsed duration. Public errors remain generic.

## Map correction
Desktop browser bounding boxes independently reproduced overlapping incident targets. The Statewide Map now uses the same compact numbered 44px targets on desktop as on phone; the matching full incident names remain in the list and accessible labels. Authored schematic positions and selection callbacks remain unchanged. When incident anchors are close, a deterministic layout spaces display targets by 48 CSS pixels, leaves each stored percentage anchor intact, and draws a connector to that location. ResizeObserver remeasures the map at responsive breakpoints. Unknown locations remain in the full incident list rather than inventing map coordinates. The existing vendored Texas boundary is reused as the background, without external map requests or a claim that schematic incident locations are GPS coordinates.

## Verification boundary
The current production payload is copied read-only into a uniquely owned disposable local PostgreSQL database. Three fresh app instances each issue six parallel API requests, verify exact byte preservation, and remove only the owned clone. These are real captured data and real database responses. Separate live Vercel acceptance remains mandatory.

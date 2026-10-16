# Verification

## Tests first
- Concurrent initialization failed before repair: four constructors instead of one.
- Retry after failed initialization failed before repair: initialization invoked once rather than retried.
- Parser test collection failed before the new module existed.
- N-Quads coverage: LF/CR/CRLF, missing final newline, comments, default/named graphs, escapes, datatypes and blank nodes. Multi-megabyte literal regression structurally forbids the stock chunk-framing regex, avoiding fragile timing assertions.
- Real PostgreSQL fresh concurrent readers preserve a large captured JSON record and persisted bytes. Existing concurrency, rollback, history and proof tests remain intact.

## Candidate results
- Focused N-Quads/hosted suite: 29 passed.
- Real current production payload in disposable local PostgreSQL: three cold-app batches, six parallel startup requests each; all 18 HTTP 200, batches complete in 5.207s, 5.220s and 6.010s.
- Candidate parser: 0.720s. 67 baseline entities and the existing inference retained.
- Local clone and production row remain byte-identical; other state hashes unchanged. Owned clone removed.
- Frontend: 367 tests, production build, UI-copy and no-egress guards passed.
- Full backend suite against a newly owned disposable PostgreSQL database: 711 passed and 6 subtests passed (450.05s). Owned database removed.
- Desktop map regression first reproduced overlapping pairs 1/2 and 1/3. A new failing regression preceded the fix. The existing vendored Texas outline is rendered and numbered 44px markers retain authored positions, complete accessible labels and matching full incident names.
- Candidate map browser checks at 1600, 1050, 393 and 320 pixels: all markers in bounds/non-overlapping, all four selections work, source boundary visible, no horizontal overflow.

## Final gates
Full isolated-PostgreSQL backend suite, remaining repository checks, exact deployed revision, live browser acceptance, map inspection and post-deployment byte preservation are recorded in the owner-only release receipt after completion.

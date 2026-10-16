# Production loading reliability

User report: Command Center → C3 Attack Picture spins, then displays “Demo storage is temporarily unavailable” and “The model could not be loaded”. Freshly reset state did not represent a workspace with a saved reasoning result.

- Preserve current baseline, saved analysis/proofs, scripted records, cases, and other state keys. No reset or history deletion.
- Retain PostgreSQL/Vercel/authentication, API schemas, transaction locks, revision fences, rollback and existing features/tests.
- Cold parallel startup must work with current production-sized history, not just an empty seeded store.
- Fix demonstrated parsing and initialization bottlenecks with tests first. Preserve N-Quads validation, graph identities and blank-node semantics.
- Failure diagnostics must not log exception text, DSNs, credentials or saved records.
- Verify real desktop/phone browser startup to `data-casework-loaded=true`, reloads and map usability. A heading, shell render or network-idle event alone is insufficient.
- Verify exact deployed revision and database bytes before/after read-only checks. Any unexplained state change blocks a preservation claim.

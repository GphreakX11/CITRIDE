# IDT runtime verification

## Source fidelity and runtime separation

- Pinned workbook SHA-256: `ffeddc10b98cca1cd15abd53d70ba8a2bafd593760c8704e76834860fcf193a2`.
- Deterministic reference output has 1,985 unique paths across 18 sectors. All 67 seed entities have an explicit assignment/disposition, including unassigned operators/vendors.
- The workbook resolves names for every entry. The older design's 68-unnamed-entry assumption is not used. The 26 blank descriptions remain JSON `null`; display fallbacks do not rewrite source data.
- Lookup JSON/reference Turtle are not proof of runtime loading. Reasoning validates the separate `backend/citride/ontology/idt_v4_owl.ttl`, merged with the base ontology before strict validation. Both source texts participate in the captured ontology hash.
- Every IDT parent assertion has a named axiom. No additional ontology declaration/import is introduced, and the loader's restrictions remain enforced.

## Measured fallback gate

Measured using `compute_inference` over the complete generated 67-entity scenario, in separate processes for each mode. Wall time includes ontology loading, validation and inference, but not interpreter/import startup. Docker used the locked dependency verification image with networking disabled. These are local/container measurements, not an AWS benchmark or browser end-to-end timing claim.

| Platform | Full hierarchy | Assigned ancestor closure + direct children |
|---|---:|---:|
| Local Python | 10.7535 s | 1.8060 s |
| Docker Python | 12.9811 s | 2.0997 s |

Both modes reported 1,985 complete-source classes, 243 inferred facts, and combined ontology SHA-256 `2659ac8b8b194b583f2f284dfe84108344874c1d53bde67c2d0998398d3595a4`. Full mode loaded 1,985 IDT classes; assigned closure loaded 115. Equal counts alone are not an entailment-equivalence proof: the reasoning regression tests separately check hierarchy witnesses and retained semantics.

Because full mode exceeds five seconds, the default is now `assigned_closure`. Explicit `full` remains supported for diagnostics and full-mode tests; `CITRIDE_IDT_LOAD_MODE` may override the default. Inference runs record actual mode and loaded/source class counts. The complete reference JSON and complete-source ontology hash remain available in either mode, so pruning does not hide changes to unused taxonomy branches from stale-run detection.

## Packaging and access checks

The Docker runtime includes the complete `data/` inputs and uses `backend/uv.lock`. A clean container startup with no network access verified bootstrap (67 entities), all IDT assignments, the reference endpoint (1,985 entries), the records endpoint (four seeded incident rows), and 11 telemetry streams. Vercel fixture preparation bundled 18 files; authored reference/scripted bytes and IDT reference bytes matched their source inputs.

The blueprint resource uses service-reported status/counts and the clearly labeled combined ontology hash, not lookup availability. The reference endpoint is read-only and uses the existing authentication middleware. Historical case/run captures are not backfilled. Existing durable production baselines require an explicitly approved operator transition; deployment alone does not reseed them.

## Verification scope

Initial complete release gate: 687 backend tests and six subtests passed with a disposable PostgreSQL database, with no database skips; that owned database was removed afterward. Subsequent retry-recovery fixes require the final full gate before publication. Dependency audits reported no known vulnerabilities in frontend production dependencies or the 36 audited Python distributions. Unit/handler tests do not substitute for production smoke tests.

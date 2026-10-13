# Document-aligned ontology and incident workspace

## Reviewed sources

- `CITRIDE Ontology Standards and Open-Source Resources.docx`, dated Oct 13, 2026; SHA-256 `56a73627b9ed9b3c96c55b39d50744aecc049a6804699627c9457a9d615e4e61`.
- `CITRIDE_Ontology_Layer2.pdf` (complete landscape diagram, footer spills to page 2); SHA-256 `4175fd1c9e6a35aa0e090e08b1caf396f6271f22ea568c0fd35368f9add08c42`.
- `CITRIDE_Ontology_Layer.pdf` (portrait export clipped on the right); SHA-256 `f3d35c080088b83e613057c1c952bcc1975367e13b55f06aa6ae8e41979c1196`.

Both PDFs were text-extracted and visually inspected. The complete diagram and DOCX govern this increment. The original SVG was not available. No source binary is copied into this repository; resource versions and licensing claims are document requirements, not independently verified releases.

## Bounded implementation

1. Add an ontology blueprint showing BFO, selective CCO modules, four domain columns, three bridges, and exchange formats as separate layers.
2. Distinguish planned imports, program-authored components, optional enrichment, and design references. Surface the actual loaded local ontology's version/profile/hash. Never claim full imported-standard conformance.
3. Add read-only service context for a selected event: cyber identity, physical asset, plant, service provider, service area, and explicit promoted downstream dependencies with provenance.
4. Associate physical-effect scenarios only through explicit seed event references. A setpoint change does not itself prove unsafe water; probing B/C does not activate A's cascade.
5. Derive advisory decision review cards from captured cascade snapshots: evidence, dependencies, assumptions, modeled time windows, and human review. Authority and formal G1–G5 definitions remain unconfigured; no automatic approval or operational dispatch.
6. Finish presentation-copy cleanup while preserving original data, raw inspection, IDs, exports, login configuration, and timing semantics.

## Acceptance

- A's dosing event resolves through PLC A, Plant A, Utility A, Area A.
- Direct dependency results include dialysis, hospital, nursing, and fire-service dependencies, but not geography-only Facility Q. Only compatible loss types activate during a cascade.
- Probe B/C resolves structural context without physical-effect scenarios or A's downstream dependencies.
- Unknown, ambiguous, dangling, or cyclic relationships do not produce fabricated context.
- Read-only context retrieval changes neither baseline revision nor stored runs.
- Captured unsafe-water run yields X 2–4h, Y 4–8h, Z 1–4h and excludes fire-flow loss. Display these as scenario-relative planning windows, never live countdowns.
- Decision drafts retain snapshot labels/sources. Formal gates and authority do not show passed status; no approval control exists.
- Backend/Node tests, generator consistency, production build, and desktop/mobile acceptance pass. New service endpoint remains behind existing authentication.

## Explicitly outside this increment

No paid AWS resources, Neptune migration, remote ontology downloads, new authentication, schema migration, live ingestion, customer boundary, or operational action. IDT v4 conversion and architect-approved CCO/C3O anchors remain blockers. The target ROBOT/ODK/ELK pipeline, Grid-STIX licensing review, OntoLogX extraction/license review, GovCloud model choice, Lambda/Glue/MSK ingestion, and Delta Lake append-only decision record are not represented as completed. The current local OWL 2 RL slice and pySHACL dependency validation are retained rather than mislabeled as the target ELK/import pipeline.

## Verified results

- Backend: 253 tests passed with real Postgres integration enabled. Temporary UUID-scoped test state rows were removed, and fingerprints of all preexisting state rows were unchanged.
- Frontend: 25 Node tests passed; TypeScript/Vite production build and Prettier checks passed. Vite reports a nonblocking bundle-size warning.
- Browser: desktop (1440px) and phone (390px) completed all eight views, four telemetry streams, event-to-scenario-to-review flow, expanded assumptions, B/C no-consequence checks, and ontology metadata error recovery. No page exceptions or horizontal document overflow occurred in the final run.
- SPARQL acceptance queries over exported N-Quads verified explicit A event-to-plant/provider/area context and service dependencies distinct from geographic overlap.
- Fixture generator consistency passed. Login configuration, identifiers, raw evidence, and existing persisted state were not changed.
- Mobile cascade results now wrap their headings and constrain grid children instead of overflowing the viewport.

Verification reports and screenshots are retained outside the repository under `~/.hermes/cache/citride-verification/`; uploaded document binaries and credentials remain excluded.

## Publication

Publication was explicitly authorized by the project owner after local acceptance. Release metadata and authenticated production verification are retained separately from source under `~/.hermes/cache/citride-verification/`. No uploaded source-document binary or credential is included in the release.

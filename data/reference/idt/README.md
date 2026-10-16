# Infrastructure Data Taxonomy v4

## Three distinct contracts

1. **Reference lookup:** `idt_v4.json` preserves the pinned workbook and the single canonical 67-ID assignment table. `idt_v4.ttl` is a reference artifact; it intentionally omits source-missing descriptions and is **not** the file merged into reasoning. Its `semanticStatus: reference_only` and `runtimeOntologyLoaded: false` describe this lookup artifact, not the runtime service's separate capability.
2. **Recorded assignment:** `scripts/generate_demo_data.py` copies each of the existing 58 entities' `idt` values from `assignments`. New baselines require a valid assignment shape; `org-electric-e` remains explicitly unassigned. Nine proposed storyline IDs already have entries in that table; this change does not create their entities. Sources include `src-idt-v4` with evidence category `reference`.
3. **Runtime OWL:** `backend/citride/ontology/idt_v4_owl.ttl` is separately generated from the canonical JSON. It has 1,985 named classes and individually named parent axioms, with no additional ontology declaration or imports. Runtime enablement, actual selected load mode and timings are governed by `.specs/idt-records-and-proof/verification.md`; a workbook lookup alone is never an entailment proof.

Historical case/run snapshots remain immutable. A record without an `idt` field stays unassigned even when today's reference assignment table knows its entity ID. Current inventory map/profile callsites now use the recorded assignment, not seed lookup. The optional `allowSeedLookup` helper remains only for explicitly opt-in inventory records that lack a field; it is never used to backfill history.

## Source fidelity

- Version: **IDT v4 (22 Jun 2011)**; source workbook unchanged.
- Workbook SHA-256: `ffeddc10b98cca1cd15abd53d70ba8a2bafd593760c8704e76834860fcf193a2`.
- One `Main` sheet, 1,985 unique paths and 18 sector roots, sorted numerically.
- Zero actually unnamed entries: the older proposal's 68 manufacturing rows contain whitespace placeholders in other name columns alongside real names. Names remain source-faithful.
- Exactly 26 absent/whitespace-only descriptions remain JSON `null`. The runtime OWL uses the factual comment `No description in the IDT v4 workbook (path <path>).` and marks `c:descriptionStatus "absent_in_source"`. This is source-absence metadata, not an invented definition.
- Actual nonblank source text is not trimmed/reworded. IDs, NAICS and cross-sector references retain decoded cell text, not floating-point coercions. ID `4725` occurs at both `1.1.2.6.3` and `1.2.12.2.1`.
- Four explicit numeric XML path corrections are restricted to this exact pinned workbook. `sourcePath` retains raw value, coordinate and cell type. No global identifier rounding.
- Organizational parent associations for below-IDT-level records do not assert physical containment or a taxonomy type. Sensor monitoring-system assignments are stakeholder assertions, not independent facility verification.

## Artifacts

| Artifact | SHA-256 |
| --- | --- |
| `idt_v4.json` | `9f516ec7941ed037b9cf9f4b2616fdad28adb42dd0f959a254f95016541532c9` |
| Reference `idt_v4.ttl` | `8707c20db033b3a856944e60eae0b71f1026db579c9d9fb1eba45a8394bdecb1` |
| Runtime `backend/citride/ontology/idt_v4_owl.ttl` | `f23dfda154a8938fb74de43f81f0af537b2e255b888700c3b1340d4ccb94f824` |

`python3 -B scripts/build_idt.py --check` compares the reference artifacts and the separate runtime OWL without rewriting. `--owl-output` supports isolated artifact tests. `python3 scripts/generate_demo_data.py --check` independently verifies generated entity records.

## API and display

The existing authenticated app registers `GET /v1/reference/idt`; no mutation or public-auth bypass is added. It returns JSON plus a computed `jsonSha256`, and fails closed when local artifacts are absent/corrupt. Reference loading is process-cached; deploy/restart when artifacts change. `backend/scripts/prepare_vercel.py` bundles the JSON and reference TTL into the existing Python service; the runtime OWL ships with its ontology package.

```tsx
const index = createIdtIndex(await api<unknown>("/v1/reference/idt"));
<IdtChip entity={entity} index={index} />
<IdtChip entity={capturedEntity} index={index} />
```

Pure helpers take an explicit index. `assignmentFor` defaults to no seed fallback, and an explicit invalid/null `idt` can never acquire a fallback code. Chip ancestry is a source lookup; real proof actions use a current inference run, captured asserted facts, named hierarchy axioms and independently replayable witnesses.

## Performance and publication

The complete combined ontology text/hash is captured even when runtime reasoning uses an assigned-code closure. A changed taxonomy therefore marks older reasoning runs stale. Closure mode keeps assigned codes, all ancestors and their direct children; it does not weaken full-artifact validation. The final verified load mode and local/Docker timings are recorded in the feature verification receipt, not inferred from source-file presence.

User-approved production reset is a distinct operator action, not an automatic deployment migration. Old cases may legitimately show missing IDT until reset; they must never be silently rewritten.

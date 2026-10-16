# IDT on records and sourced reasoning

Authoritative requirements: Jake's IDT fix message and supplied design §10 excerpt. The newer fix overrides older optional-field/missing-description instructions. Base HEAD aa2a32e; preserve existing uncommitted interactive-map and population fixes.

## Part 1 (gate before Part 2)
- Tests before implementation. Every existing scenario entity has `idt` copied from the canonical reference assignments; no duplicate mappings. Keep the nine future-storyline assignments in that same table without inventing or adding their entities in this slice.
- Validate required field, four strict status shapes, canonical code/parent paths and existing parent entity. `org-electric-e` remains unassigned.
- New run and case-context snapshots retain inline IDT. Legacy captured history never receives seed fallback or backfill.
- Exercise actual file and disposable PostgreSQL persistence, not a mocked database.
- Remove inventory map/profile seed fallback calls, preserve the helper only for explicitly opt-in legacy inventory without a field.
- Reset isolated demo, create Utility A case and unsafe-water run, check C1/CaseFile chips. C4 shows named sectors 12/10/6/5; distinguish captured inventory context from actually modeled impacted facilities.

## Part 2 (conditional)
- Generate a separate runtime `idt_v4_owl.ttl` from canonical JSON. All 1,985 classes, exact source labels, parent links and named axioms; no second ontology declaration.
- Missing 26 descriptions get factual source-absence comments and `descriptionStatus=absent_in_source`, not invented definitions. Retain raw JSON nulls.
- Merge locally before strict ontology validation; hash and capture both documents; project only coded records with inventory + src-idt-v4 origins. Never assign below-level or not-asset records a taxonomy type.
- Run actual full inference locally and in Docker. If either exceeds 5s, use assigned ancestors + direct children and record assigned_closure; if closure exceeds 5s, skip Part 2 and report actual timings.
- Independently replay lineage witnesses for Dialysis and Fire; test stale detection when taxonomy changes. Do not modify existing reasoning tests.
- Profile proof action selects its actual conclusion, otherwise offers Run reasoning. No fabricated proof or conflation of reference lookup with entailment.

## Delivery
- Existing architecture/storage/auth/hosting retained. User authorized production publication after verification.
- Demo reset for screenshots/acceptance is isolated. Jake separately explicitly approved **resetting production to the new seed, deleting its existing cases and run history**. Capture an owner-only rollback export first; fence the exact production state key and preflight fingerprint. Do not reset any other state key/container/database. Existing historical snapshots are never backfilled; the production reset deliberately removes them under this explicit approval.
- Report all changed files, final counts, actual local/Docker timings and load mode, legacy-history note, and C4/Profile screenshots after isolated reset.

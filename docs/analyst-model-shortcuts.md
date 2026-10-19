# Analyst model: runtime prototype inventory

## Scope and method

Read-only inventory of the working tree relative to baseline `92468d3`. Scanned source files under `backend/citride`, `frontend/src`, and `scripts`, then searched repository source extensions `.py`, `.ts`, `.tsx`, `.js`, `.mjs`, `.css`, `.sh`, excluding dependency/build/Git/cache directories. Inspected the surrounding implementation for every `PROTOTYPE` occurrence. This is an inventory of explicit markers, not a claim that all implementation limitations have been annotated.

**Result at inspection: four runtime markers, all Python comments spelled `# PROTOTYPE:`. There were zero literal `// PROTOTYPE:` or `# // PROTOTYPE:` markers.** The four existing equivalent Python markers are included below rather than silently omitted. If acceptance requires the literal slash form, the runtime-source owner must change their spelling; this report's owner did not modify source.

## Complete marker inventory

| Source location | Exact marker text | Shortcut and implications |
|---|---|---|
| `backend/citride/storage.py:180`, `Repository._load` | `# PROTOTYPE: Whole graph stored as one N-Quads blob per environment.` | Local persistence loads the entire N-Quads file into one RDF Dataset, with a file-signature cache. The following two comments explicitly call for per-record tables/graph storage partitioned by customer, live-feed intake, and infrastructure-model storage in the database rather than `scenario.json`. Whole-environment parsing/storage remains a scalability and tenancy limitation. |
| `backend/citride/storage.py:197`, `Repository._save` | `# PROTOTYPE: Whole-graph rewrite; see _load for required per-customer storage replacement.` | Each local write serializes the complete Dataset. The actual implementation writes a temporary file, flushes/fsyncs it, atomically replaces the state file and fsyncs the directory; this is not an unprotected partial-record overwrite. Whole-graph serialization/write amplification remains, and the same per-customer/per-record replacement is required. |
| `backend/citride/postgres.py:119`, `_load` | `# PROTOTYPE: Whole graph stored as one N-Quads blob per environment.` | Database persistence fetches the environment's single `citride_state.nquads` value using `SELECT ... FOR UPDATE`, parses it into a Dataset, and caches it for the transaction. The following comments require the same per-record/customer-partitioned storage, live-feed intake and database model storage. PostgreSQL transactions do not remove the whole-environment storage/locking bottleneck. |
| `backend/citride/postgres.py:139`, `_save` | `# PROTOTYPE: Whole-graph rewrite; see _load for required per-customer storage replacement.` | Serializes the complete Dataset into the one environment row with `UPDATE citride_state SET nquads = ..., updated_at = CURRENT_TIMESTAMP WHERE state_key = ...`. Requires an active repository transaction and checks one row was updated. Whole-graph rewrite cost and coarse storage granularity remain. |

No explicit prototype markers were found in `consequence_model.py`, `source_model_install.py`, frontend runtime files or installation scripts at the audited snapshot. That absence is not evidence of production readiness. These four storage markers predate this model-intake work; their surrounding implementations are evidence of the limitations, not promises that the requested replacements were delivered.

## Related limitations disclosed without inventing source markers

These are review observations, **not additional tagged shortcuts**:

* Source models remain simulated, configured fixture inputs. Type/IDT/service/interval adaptation and generated cyber identities/functions are intake assumptions, documented in `docs/analyst-model-data-changes.md`; they are not live-feed observations.
* `consequence_model.py:195–197` retains the compatibility entry point for fixture/intake callers. Its presence alone does not prove a durable reader still uses a detached overlay; durable call-site behavior belongs to integration verification.
* `source_model_install.py:28–142` requires a previously initialized store with an existing incident, exact reviewed token, and unchanged/collision-free source model. It intentionally cannot reset, repair or replace a conflicting installed record. It computes a detached candidate even on dry run; saving occurs only on authorized apply.
* `display_catalog.json` externalizes existing presentation aliases, fixed schematic coordinates, cities and preferred reference IDs. Moving them into configuration does not turn fixed coordinates into geographically derived locations. The generic potential-provider fallback is explicitly distinguished from these unchanged values in the data ledger.
* `_mark` uses missing-value defaults rather than overwriting explicitly supplied handling/classification. Actual generated fixture records were verified to carry `SIMULATED` and nonblank assumption notes; this is not a universal assertion about arbitrary inputs.

## Verification boundary

No source files were edited to add, remove or rename markers. No production service or store was accessed, no commit/deployment was made, and no complete regression or visual acceptance run is claimed by this inventory. Line references describe the inspected working tree and may shift if another owner edits runtime files concurrently. The report was written only to this document and its companion data-change ledger.

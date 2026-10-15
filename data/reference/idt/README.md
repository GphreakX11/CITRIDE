# IDT v4 bounded reference delivery

## Semantic status

**Reference lookup only.** Full public taxonomy and generated OWL class/axiom
Turtle are local artifacts; neither file is imported by the runtime reasoner.
`reasoning.py`, generator, validation, RDF/storage and persisted entities/history
are unchanged by this delivery. Workbook ancestry is **not** an OWL witness.
No `src-idt-v4` evidence record is inserted into the baseline.

The strict runtime loader requires a nonempty definition on every class. The
source has 26 missing descriptions; this converter preserves them rather than
inventing definitions. Source-backed IDT projections would also require approved
baseline assignments, validated source records, combined ontology hashing, proof
replay and bounded inference timing. Those are not responsibly established by
this lookup-only change. The reference Turtle intentionally omits missing
comments and must **not** simply be concatenated into the strict loader.

## Source fidelity

- Version: **IDT v4 (22 Jun 2011)**; no later-version alignment claimed.
- Unchanged source workbook SHA-256:
  `ffeddc10b98cca1cd15abd53d70ba8a2bafd593760c8704e76834860fcf193a2`.
- One `Main` sheet, 1,985 entries, 18 sector roots; integer roots are included.
- Zero unnamed entries. The proposal's 68 unnamed manufacturing rows actually
  contain whitespace placeholders in other name columns, alongside real names.
- 26 absent/whitespace-only descriptions remain `null`; raw source fields remain
  available in `sourceValues`. Actual nonblank text is not trimmed/reworded.
- IDs/NAICS/cross-sector references retain decoded cell text, not floating-point
  coercions; ID `4725` occurs at both `1.1.2.6.3` and `1.2.12.2.1`.
- Four explicit numeric XML path corrections are restricted to this exact pinned
  workbook. `sourcePath` retains raw value, coordinate and cell type. There is no
  global identifier rounding. Paths are unique, parents complete, numerically
  sorted, and missing source values are never replaced with invented codes.
- JSON includes the 67 exact existing/proposed design IDs. `proposedEntityIds`
  explicitly identifies the nine proposed entities; no entities are created.
  Organizational parent associations do not prove physical containment. Sensor,
  pressure and tank monitoring-system assignments remain stakeholder assertions,
  not independently verified facility classifications.

Artifacts:

| Artifact | SHA-256 |
| --- | --- |
| `idt_v4.json` | `e14637bd6409742786b16d3e49135bd62e53f94fb7c2afbe500dab4056204d48` |
| `idt_v4.ttl` | `8707c20db033b3a856944e60eae0b71f1026db579c9d9fb1eba45a8394bdecb1` |

## Parent-owned integration

Register the reusable router **inside** existing `create_app` so the existing
`DemoAccessMiddleware` guards the route. No separate application/public bypass:

```python
from .billington_reference import idt_router
# Before the existing catch-all routes:
app.include_router(idt_router)
```

`GET /v1/reference/idt` returns full JSON plus `jsonSha256` computed over the
checked-in JSON bytes. It registers no mutation routes; missing/corrupt local
files produce a generic 503 with no network fallback. An isolated ASGI app tests
existing middleware's 401/authenticated-200/private-cache behavior and 405s for
mutations without instantiating any Repository or touching persisted state.
Reference loading is process-cached; changing deployed artifacts requires a
restart. Ship `data/reference/idt/idt_v4.json` **and** `idt_v4.ttl` at the repository
root alongside backend source. Wheel-only packaging is not wired in this slice;
missing assets fail closed. No deployment/migration is authorized or performed.

Use the existing same-origin API helper (retains its login/error handling):

```tsx
import { createIdtIndex } from "./idt";
import { IdtChip } from "./IdtChip";
const index = createIdtIndex(await api<unknown>("/v1/reference/idt"));
// Current inventory only: explicit stakeholder seed lookup allowed.
<IdtChip entity={entity} index={index} allowSeedLookup />
// Historical run/case snapshot: only a captured idt assignment is displayed.
<IdtChip entity={capturedEntity} index={index} />
```

Pure exports accept an explicit index, not a global cache:
`idtEntry(path, index)`, `lineage(path, index)` (leaf-to-sector),
`assignmentForId(id, index)`, `assignmentFor(entity, index, options)`,
`sectorOf(entity, index, options)` (sector entry or null),
`idtChip(entity, index, options)` (text). `options.allowSeedLookup` defaults false.
Captured/explicit `idt` always wins, including invalid/null fields that remain
unknown instead of being overwritten by a guessed fallback. Backend counterparts
are `idt_reference`, `idt_entry`, `lineage`, `assignment_for_id`, `assignment_for`
and `sector_of`; the latter two use keyword `allow_seed_lookup=False` by default.
Entity types and snapshot schema do not need to change.

Blueprint wording must distinguish **"IDT v4 reference loaded: 1,985 entries"**
from **"not imported into runtime OWL reasoning"**. Use the real response hashes
and version; do not change its status to an OWL-loaded conformance claim.

The parent may wire `python3 -B scripts/build_idt.py --check` into its owned
verification script. Conversion works with the Python standard library: no
openpyxl installation, macros, formula evaluation or external-link resolution.
The fixed-source OOXML reader bounds ZIP sizes/counts/ratios and constrains UTF-8
XML; this is not a general arbitrary-workbook import endpoint.

## Verification

From repo root:

```sh
python3 -B scripts/build_idt.py --check
```

From `backend/`:

```sh
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -B -m pytest -p no:cacheprovider tests/test_billington_reference.py -q
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -B -m pytest -p no:cacheprovider tests/test_reasoning.py -q
```

From `frontend/`:

```sh
node --test tests/idt.test.mjs
node --test tests/*.test.mjs
node_modules/.bin/tsc --noEmit --incremental false --pretty false
```

Owned tests independently compare **all** JSON source fields against workbook XML,
verify source/JSON/Turtle hashes and exact reference axioms, deterministic repeated
bytes and `--check` drift detection/nonrepair, detached lookup, exact assignments,
historical opt-in boundaries, inherited auth/read-only methods, fallback handling
and genuine React static rendering/escaping of the native-details chip. The TSX
test uses the installed Vite Oxc transform in memory; TypeScript 7 no longer
exposes the old `transpileModule` API. No package installs/build outputs are needed.
Browser placement and actual parent-app router integration remain parent-owned
acceptance gates, not claims made by these isolated tests.

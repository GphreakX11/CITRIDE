# Analyst model: sample-data change ledger

## Scope and evidence

Compared the working tree to Git baseline `92468d3`, specifically `data/scripted/port_houston.json`, `backend/citride/consequence_model.py`, new `backend/citride/source_model_install.py`, and new `data/reference/display_catalog.json`. This is a source/data audit, not a release report. No repository initialization, installation apply, production access, commit or deployment was performed for this report. Runtime references below use the inspected working-tree line numbers.

Read-only execution of the actual `normalize_source_model` function returned: **2 sources, 30 entities, 6 events, 15 service functions, 13 dependencies, 1 scenario**. These are normalized candidate counts, not unconditional additions to an arbitrary existing store: identical existing IDs are retained, unequal collisions fail. The current file has 1 source, 25 entities, 6 events, 13 dependencies, one singular scenario, and no authored service-function collection. No new authored alert or physical-asset record was added relative to the Git baseline.

## 1. Authored source edits (not runtime normalization)

The entire `port_houston.json` diff consists of the following fields. All other authored values, including event timestamps and expected windows, remain unchanged.

| Record / field | Before → after | Why |
|---|---|---|
| `entities[feedstock-pipelines].type` | `PipelineSystem` → `Pipeline` | Represent the dependency endpoint with a supported physical type. |
| Same, `suppliedType` | absent → `PipelineSystem` | Preserve the supplied type as metadata. |
| Same, `assumptionNote` | absent → `SIMULATED: Source pipeline system represented as the supported physical Pipeline type; timing and dependency ownership unchanged.` | Explicitly disclose the type adaptation. |
| `entities[galveston-refinery].type` | `Refinery` → `ChemicalPlant` | Supported physical endpoint; its authored Energy sector and IDT assignment are not rewritten. |
| Same, `suppliedType` | absent → `Refinery` | Preserve supplied type. |
| Same, `assumptionNote` | absent → `SIMULATED: Refining represented by the supported physical ChemicalPlant type; remains a connected, unaffected asset with other supply.` | Preserve the connected-but-unaffected story. |
| `dependencies[poh-dep-galveston].lossTypes` | `["electricity_lost"]` → `["terminal_operations_unavailable"]` | Match the actual provider's modeled loss. |
| Same, `validForLossTypes` | `["electricity_lost"]` → `["terminal_operations_unavailable"]` | Make the backup/loss compatibility declaration consistent. |
| Same, `lossOfFunction` | `1.0` → `0.0` | Explicitly encode other supply and no modeled loss, rather than relying on a mismatched loss token to suppress propagation. |
| Same, `assumptionNote` | Original text retained, appended ` SIMULATED intake correction: compatible terminal loss replaces the mismatched electricity loss; zero modeled loss explicitly represents the supplied other-supply assumption.` | Despite the wording, this is an authored JSON edit, not a transformation performed by the intake function. |
| `scenario.seed.eventRefs` | `[poh-ev-tos-offline, poh-ev-ais]` → `[poh-ev-cred, poh-ev-lateral, poh-ev-ot-pivot, poh-ev-tos-offline, poh-ev-ais, poh-ev-sabine]` | Permit all six observations to link to the conditional scenario. Four references are added; two existing references retain their relative order. |
| `scenario.seed.assumptionNote` | absent → `SIMULATED: All six linked observations may open an investigation of this conditional terminal-operations-loss scenario. An account sign-in, shared login pattern, or other observation alone does not establish an outage or causal attribution; the analyst must review the loss assumption.` | Distinguish investigation linkage from proof of compromise, loss or causation. |

Evidence: source diff around current lines 618–660, 1155–1171 and 1243–1254. The pre-existing backup-maximum reconciliations on `poh-dep-crude`, `poh-dep-barges`, and `poh-dep-feedpipe` are already in `92468d3`; they are **not new authored edits** in this change.

## 2. Intake normalization: complete field and record ledger

Evidence: `backend/citride/consequence_model.py:21–164`. Intake deep-copies input; it does not rewrite the authored JSON. These formerly detached model records now become candidates for the main baseline.

### Common defaults and sources

Define **N** as the exact note `Illustrative simulated source model; not verified operational evidence.` For any record passed to `_mark`, missing provenance is filled first; missing `classification` becomes `U`, missing `handling` becomes `["SIMULATED"]`, and missing `assumptionNote` becomes N. Existing values are preserved with `setdefault`; blank/non-string assumption notes are rejected. For non-source records the default `sourceRefs` is the list of bundle source IDs, here `["src-scripted-poh"]`. The implementation does not forcibly replace an explicitly supplied handling value; that is a generic-input limitation, not a change in this fixture.

* `sources[src-scripted-poh]`: add `evidenceCategory: "simulated"` and `assumptionNote: N`; retain all other source fields.
* New normalized source `src-c4-planning`: copied from `c4_reference.json.source`, with `label: "C4 Complete illustrative planning records"`, `evidenceCategory: "simulated"`, `classification: "U"`, `handling: ["SIMULATED"]`, plus `assumptionNote: N`. This reference source already existed as configuration/overlay input, not as a newly invented evidence source. It has no generated `sourceRefs` field.

### Existing entities

Every ID below is an authored entity carried into intake. Add `assumptionNote: N` to exactly:

`poh-org`, `poh-port`, `poh-tos`, `poh-tos-sched`, `poh-ais`, `poh-auth01`, `grid-houston`, `sabine-lng`, `colonial`, `tankers-47`, `beaumont`, `texas-city`, `ship-channel-plants`, `freeport`, `chlorine-loadout`, `houston-water-plants`, `w250-utilities`, `crude-tankers`, `chemical-barges`, `motiva-refinery`, `poh-shore-power`, `poh-cranes`, `poh-tos-02`.

`feedstock-pipelines` and `galveston-refinery` retain the authored notes above. Add `idt: {"status":"unassigned"}` to exactly `poh-tos`, `poh-auth01`, `ship-channel-plants`, `freeport`, `chlorine-loadout`, `feedstock-pipelines`, because no IDT was supplied. All supplied coded IDT paths in this fixture resolved during actual normalization: **no `suppliedIdt` additions or coded-to-unassigned changes occurred**. Generically, an unresolved coded path is preserved under `suppliedIdt` and replaced by unassigned `idt`; existing non-coded assignments are retained.

`poh-port` additionally receives exact deep copies of the bundle's `alternatives` (five entries), `thresholds` (seven entries), and `responseOwners` (six entries). Their nested fields, ordering and values are unchanged, including all incident references. This moves previously overlay-provided planning context onto the source-provider entity so Analyst and Command read the same stored owner/action data. No new alternative, threshold or owner is authored:

* Alternatives: Beaumont / Port Arthur; Manual gate and yard operations; Divert to Freeport, Galveston, Corpus Christi; Texas City terminal; Chlorine by truck (backup route). All `label`, `covers`, `status`, optional `note`, optional `providerId`, and `incidentId` fields are copied unchanged.
* Threshold hours: `2, 3, 6, 12, 18, 24, 48`; each `text` and `incidentId` is copied unchanged.
* Owner roles: Asset owner; Regulator; Sector leads; Emergency management; Cyber response; Federal and law enforcement. Each `who`, `does`, and `incidentId` is copied unchanged.

Evidence: normalization lines 70–86. The assignment intentionally copies bundle planning fields over fields of the same name on that detached source entity; there are no conflicting entity-level values in this fixture.

### New cyber identity records and all event changes

Exactly five normalized `CyberAsset` records are generated. Each has `id: cyber-<target>`, `label: <target> network identity`, `hostedBy: <target>`, `idt: {"status":"not_idt_asset","reason":"cyber_identity"}`, `sourceRefs: ["src-scripted-poh"]`, `classification: "U"`, `handling: ["SIMULATED"]`, and `assumptionNote: N`.

| New identity | Physical target / hostedBy | Events whose `seenOn` changes from target to identity |
|---|---|---|
| `cyber-poh-auth01` | `poh-auth01` | `poh-ev-cred`, `poh-ev-lateral` |
| `cyber-poh-tos` | `poh-tos` | `poh-ev-ot-pivot` |
| `cyber-poh-tos-sched` | `poh-tos-sched` | `poh-ev-tos-offline` |
| `cyber-poh-ais` | `poh-ais` | `poh-ev-ais` |
| `cyber-sabine-lng` | `sabine-lng` | `poh-ev-sabine` |

All six events gain `assumptionNote: N`. Missing `attackTechniques[*].tactic` becomes `Not supplied by source` for `poh-ev-cred` / `T1078`; `poh-ev-lateral` / `T1550.001` and `T1021.001`; `poh-ev-tos-offline` / `T1486`. No technique IDs/names are changed or invented. `poh-ev-ot-pivot`, `poh-ev-ais`, and `poh-ev-sabine` still have no technique collection.

No other event fields change. Relative event hours remain respectively `-0.67`, `-0.2`, `0.07`, `0.17`, `0.2`, `0.67` in the six-event source order. Generic normalization preserves already-authored CyberAsset endpoints and rejects unequal generated-ID collisions (lines 88–104).

### New service-function records and dependency ownership references

Exactly 15 functions are generated because this bundle authors none. Each row below fully defines its non-provenance fields: `id`, `facility`, `service`, with `label` equal to service with underscores replaced by spaces. Every row also has `sourceRefs: ["src-scripted-poh"]`, `classification: "U"`, `handling: ["SIMULATED"]`, `assumptionNote: N`.

| New function ID | facility | service | Dependency whose `dependentFunction` becomes this ID |
|---|---|---|---|
| `c4-poh-port-terminal_operations` | `poh-port` | `terminal_operations` | Seed/provider function; no dependent reference |
| `c4-grid-houston-electricity` | `grid-houston` | `electricity` | Upstream provider function; no dependent reference |
| `terminal-operations--poh-port` | `poh-port` | `electricity` | `poh-dep-grid` |
| `lng-export--sabine-lng` | `sabine-lng` | `terminal_operations` | `poh-dep-sabine` |
| `refined-product-flow--colonial` | `colonial` | `terminal_operations` | `poh-dep-colonial` |
| `cargo-by-sea--tankers-47` | `tankers-47` | `terminal_operations` | `poh-dep-tankers` |
| `chemical-production--ship-channel-plants` | `ship-channel-plants` | `chlorine_supply` | `poh-dep-scp` |
| `chemical-production--freeport` | `freeport` | `terminal_operations` | `poh-dep-freeport` |
| `chlorine-shipping--chlorine-loadout` | `chlorine-loadout` | `chlorine_supply` | `poh-dep-cl2` |
| `water-disinfection--houston-water-plants` | `houston-water-plants` | `chlorine_supply` | `poh-dep-water` |
| `water-disinfection--w250-utilities` | `w250-utilities` | `chlorine_supply` | `poh-dep-w250` |
| `cargo-by-sea--crude-tankers` | `crude-tankers` | `terminal_operations` | `poh-dep-crude` |
| `cargo-by-sea--chemical-barges` | `chemical-barges` | `terminal_operations` | `poh-dep-barges` |
| `chemical-production--feedstock-pipelines` | `feedstock-pipelines` | `terminal_operations` | `poh-dep-feedpipe` |
| `refining--galveston-refinery` | `galveston-refinery` | `terminal_operations` | `poh-dep-galveston` |

For all 13 dependencies the old `dependentFunction` is exactly the prefix before `--` in the table. The suffix makes ownership facility-specific, avoiding shared aliases across facilities. The apparently surprising `terminal-operations--poh-port` service is actually `electricity`, as the implemented output-service fallback dictates; this report does not silently reinterpret it.

Unlike the prior overlay, intake reuses an existing matching facility/service function instead of generating a redundant provider function. In particular it reuses `chemical-production--ship-channel-plants` and `chlorine-shipping--chlorine-loadout` rather than adding duplicate `c4-ship-channel-plants-chlorine_supply` and `c4-chlorine-loadout-chlorine_supply` records. Generically, authored service functions are retained/marked, their ownership is checked, and unresolved dependency aliases alone receive suffixes. Evidence: lines 106–121, 144–151.

### All other dependency changes

All 13 dependency IDs in the table gain `recovery.note: "Restoration not verified; planning estimates only."`; existing `recovery.status: "unknown"` is retained. If recovery is absent on another input, the normalizer creates that status. This does not assert a recovery time.

Both `requiredService` and `backupService` change to `terminal_operations` on these six records:

* `poh-dep-sabine`, `poh-dep-colonial`, `poh-dep-galveston`: from `petroleum_products`.
* `poh-dep-scp`, `poh-dep-freeport`, `poh-dep-feedpipe`: from `chemical_feedstock`.

Each of those six `assumptionNote` fields receives exactly ` Required input normalized through the configured source-service mapping.` These changes come from the existing `c4_reference.json.serviceNormalizations.terminal_operations` map and apply only to dependencies of the scenario seed provider. The `chlorine_unavailable` output maps to `chlorine_supply` through `outputServices`; no loss-token invention is involved.

For the six rows below, intake assigns the full four-value tuple `(propagationDelayMinHours, propagationDelayMaxHours, usableBackupMinHours, usableBackupMaxHours)` from existing reference configuration:

| Dependency | Authored tuple → stored tuple |
|---|---|
| `poh-dep-sabine` | `(0,1,3,5)` → `(0,0,3,5)` |
| `poh-dep-colonial` | `(0,1,3,5)` → `(0,0,3,5)` |
| `poh-dep-tankers` | `(0,1,6,11)` → `(0,0,6,11)` |
| `poh-dep-scp` | `(1,2,11,16)` → `(1,1,11,16)` |
| `poh-dep-freeport` | `(1,2,11,16)` → `(1,1,11,16)` |
| `poh-dep-cl2` | `(0,1,0,0)` → `(0,0,0,0)` |

Only `propagationDelayMaxHours` actually changes in each row. Each receives exactly ` Intake interval normalization: initial onset uncertainty counted once; explicit input parameters preserve the supplied expected windows without engine changes.` This replaces the prior overlay's equivalent note prefix `C4 interval normalization:`; the numerical corrections are not newly retuned. Aliasing text, where applicable, precedes the interval text.

All remaining dependencies keep all four interval values. In particular water/w250 remain `(0,0,6,6)`, crude `(0,1,6,10)`, barges/feedpipe `(1,2,11,15)`, grid/Galveston `(0,0,0,0)`. Apart from the complete field changes listed above and the authored edits in section 1, dependency revision, status, endpoints, coupling, loss fractions/tokens, and provenance are retained.

### Scenario

Singular authored `scenario` becomes the sole member of normalized `scenarios`, ID `port-terminal-down`. Add scenario-level `assumptionNote: N`. The seed retains its authored note from section 1; `_mark` supplies no additional seed fields for this fixture because provenance is already present. The prior overlay overwrote that note with `Explicit simulated terminal loss and 48-hour persistence; not an observed operational effect.`; intake now preserves the authored conditional-loss explanation. The generic path also accepts a `scenarios` list and rejects a missing scenario.

Seed `provider: poh-port`, `service: terminal_operations`, `lossType: terminal_operations_unavailable`, `windowHours: [0,1]`, `persistsThroughHour: 48`, and scenario `horizonHours: 48` remain unchanged. The expanded event linkage does not make an isolated sign-in proof of outage.

## 3. Timing contract retained

The source `expectedWindows` is unchanged and is not read as an instruction to tune the engine:

| Assets | Expected hours |
|---|---|
| `sabine-lng`, `colonial` | 3–6 |
| `tankers-47`, `crude-tankers` | 6–12 |
| `ship-channel-plants`, `freeport`, `feedstock-pipelines`, `chemical-barges`, `chlorine-loadout` | 12–18 |
| `houston-water-plants`, `w250-utilities` | 18–24 |
| `galveston-refinery` | connected, not affected |
| `grid-houston` | normal · upstream |

The intended Energy → Transportation → Chemical → Water sequence remains 3–6 → 6–12 → 12–18 → 18–24 hours. This audit executed normalization, not the consequence engine or UI; computed-window parity and water-case regression results must be supplied by the integration test owner. No claim of passing those tests is implied.

## 4. Add-only installation bookkeeping, not further normalization

`backend/citride/source_model_install.py:28–142` calls the same normalizer then `merge_model_records`; it contains no second data-retuning layer. Existing incident and metadata must already exist. Six-collection plans list only missing IDs under `add`, with empty `update` lists. Exact existing rows are retained; unequal or cross-collection collisions fail, then the merged baseline is validated (`consequence_model.py:167–191`).

On a genuinely changed candidate, the installer:

1. Increments `baselineRevision` by one; preserves the previous baseline as `baseline-revision` record with `id: baseline-<old revision>`, `baselineRevision`, and `baselineSnapshot`. Existing equal snapshots are reused; differing snapshots fail.
2. Preserves opaque baseline triples not materialized by the JSON adapter.
3. Invokes main-store automatic analysis for the selected incident, listing newly generated immutable run IDs under `changes.run.add` and `preliminaryRunIds`. Existing runs, including older preliminary runs, are retained. Actual run IDs/content depend on receiving state and were not generated in this audit.
4. Adds one `source-model-install` receipt with `id: source-model-<hash of incident ID>`, `incidentId`, `sourceFingerprint`, `token`, and deep-copied `plan`. These are operational bookkeeping records, not newly authored sample observations; they do not carry the sample-model SIMULATED/assumption fields.
5. Saves only for `apply=True` with the exact reviewed token. Dry run constructs a detached candidate and plan without saving. Successful receipt replay is a no-op with the original token; changed source/state or protected-graph mutations are rejected.

Exact receipt/token/revision/run values are **unknown without a particular receiving store**. No store was accessed. Fresh/no-change intake makes no receipt or revision write. Existing cases, incident metadata, historical runs and prior snapshots are not targets for editing.

## 5. New display reference catalog: relocation versus behavior change

`data/reference/display_catalog.json` is new reference configuration, **not a seventh model collection** and not an incident/entity/event record. Its data is moved from runtime literals, so adding SIMULATED fields to every string/coordinate would change its schema rather than mark new evidence. Existing labels/positions/IDs are retained:

* `copy` (lines 2–30): all exact key/value display aliases formerly in baseline `frontend/src/presentation.ts:3–46`, from `SIMULATED → Reference data` through the full dependency-parameter sentence. Every mapping is relocated unchanged; raw API text, identifiers, custom text, evidence and exports remain outside this aliasing function.
* `schematicPositions` (lines 32–37): all 12 ID/coordinate pairs previously in `frontend/src/texasGraph.ts`: `electric-e:[220,335]`, `plant-a:[395,340]`, `utility-a:[510,345]`, `dialysis-x:[575,240]`, `hospital-y:[670,345]`, `nursing-z:[420,190]`, `fire-f:[590,445]`, `facility-q:[740,270]`, `plant-b:[450,450]`, `utility-b:[535,510]`, `plant-c:[695,435]`, `utility-c:[770,380]`. No position is changed.
* `cities` (lines 38–47): all eight `{name,lon,lat}` records from `frontend/src/c1MapLayout.ts`: Dallas `(-96.797,32.777)`, Houston `(-95.370,29.760)`, Austin `(-97.743,30.267)`, San Antonio `(-98.494,29.425)`, El Paso `(-106.485,31.762)`, Lubbock `(-101.855,33.578)`, Amarillo `(-101.832,35.222)`, Corpus Christi `(-97.396,27.801)`. No coordinate is changed.
* `defaultCaseEventId: event-dosing` (line 48): same preferred event previously literal in `CaseCreateForm.tsx`; selected-event and first-event fallbacks remain.
* `potentialScenarioIds: [potential-unsafe-water-b, potential-unsafe-water-c]` (line 49): same ordered IDs previously literal in `whoActsFirst.ts` and `ScriptedAnalystViews.tsx`.
* `telemetrySensors` (lines 50–52): `utility-a:w250-sensor-a`, `utility-b:w250-sensor-b`, `utility-c:w250-sensor-c`. These preserve exactly the three accepted utility/sensor pairs formerly encoded in `backend/citride/zeek_validation.py:203–207` by an allowed-utility tuple and `"w250-sensor-" + str(utility)[-1:]`. Current validation loads the explicit mapping and uses membership plus lookup; this is not a timeline mapping and does not add accepted sensor identities.

**Behavioral exception, not a catalog-value edit:** `frontend/src/whoActsFirst.ts` changes the potential-provider fallback from constructing a scenario ID from a `utility-` name suffix to finding an allowed saved run whose `seed.provider` equals the provider ID. Scenario-based matching remains first. This is generic relationship matching, not a renamed ID or new potential scenario. Where neither authored scenario nor matching saved-run seed is available, the old name-derived guess no longer applies.

## Verification and limits

Actual normalization was executed read-only using the existing dependency-equipped Python at `/home/gphreakx/.hermes/cache/citride-c2-and-color/worktree/backend/.venv/bin/python`, with `PYTHONPATH=backend` pointing at this worktree and `PYTHONDONTWRITEBYTECODE=1`. Initial Python environments lacked `rdflib`; no packages were installed. The successful execution supplied the exact counts, identity/function records, IDT outcomes and field differences above. This report does not claim production installation, rendered screenshots, full regression completion or real-world accuracy of simulated assumptions. Changes made concurrently after inspection require rechecking line numbers and the Git diff.

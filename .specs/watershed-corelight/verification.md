# Watershed Corelight-format replacement — verification

## Delivery status
Implemented and exercised locally. No commit, push, external deployment, production reset, or live sensor ingestion performed. The prior IDT/map work remains in place. IDT Part 2's Docker speed/publication gate is a separate unfinished task.

## Record counts
| Log | Rows | Format |
|---|---:|---|
| conn | 358 | corelight_zeek_json |
| ssl | 36 | corelight_zeek_json |
| http | 905 | corelight_zeek_json |
| dns | 93 | corelight_zeek_json |
| modbus | 185 | corelight_zeek_json |
| modbus_detailed | 185 | corelight_zeek_json |
| notice | 4 | corelight_zeek_json |
| vpn | 3 | synthetic_vpn_auth_json |

All generated rows explicitly carry simulated provenance. Manifest contains per-log counts/ranges and the required format/content disclaimer. The incompatible volume estimates were reconciled by prioritizing the explicit 300–600 connection total; persistent HTTP sessions carry minute-by-minute requests. Prior-day vendor sessions exist only at Utility A. B/C attacker attempts remain S0/REJ, never completed sessions or writes. `network.json` is a generated conn compatibility view, omitted from the API's eleven-stream list to prevent double counting.

The six required VPN gateway/identity entities were added using existing canonical IDT assignments; other proposed storyline entities remain absent. Workstations and resolver follow the requested documentation addresses; quality/pressure identities use other documentation-range addresses to avoid historian/workstation aliasing. No location, service dependency or physical consequence is inferred from these network addresses.

## Final gates
- `python3 scripts/generate_demo_data.py --check`: 14 deterministic files verified.
- Full backend: **535 passed**, real disposable PostgreSQL enabled; no skipped tests. Tests use assigned-closure operator mode for the carried IDT implementation; its explicit-full tests still execute. Final log: `~/.hermes/cache/citride-verification/corelight/backend-final-reviewed.log`.
- Full frontend: **183 passed**, zero failures/skips. Final log: `~/.hermes/cache/citride-verification/corelight/frontend-final-reviewed.log`.
- Prettier, TypeScript/Vite build, Ruff, whitespace checks: PASS.
- Deterministic IDT reference/runtime artifact check: PASS.
- Service packaging: 16 fixture files bundled; actual Corelight counts read back with the shared reader.
- Case-insensitive retired-narrative repository regression and no-committed-capture regression: PASS. Only the security test contains its own denylist.
- Independent Community ID reference implementation (`communityid` 1.5.0, separate QA environment): all 358 5-tuples match.
- Metadata-free compatibility fixture: 20 fictional documentation-address JSONL rows, accepted losslessly without inventing CITRIDE mappings or simulation provenance. Arrays, unknown fields, mixed provenance and inherited authentication also tested.
- Nonblocking existing FastAPI/rdflib deprecation and frontend bundle-size warnings remain.

## Actual isolated-reset browser acceptance
Real local FastAPI/RDF API and built frontend, Chromium desktop and 393px mobile viewport. A single journaled QA case was created and analyzed; reruns reused its accepted ID, not duplicate writes. No production endpoints used.
- A3 seven-event CT chronology, all eleven selectors, conn and detailed-write highlighting, actual computed shared-source/vendor/off-hours hunts: PASS.
- Full detailed-stream JSONL download on both viewports: parsed records exactly equal all 185 API records, including unknown/raw fields.
- Register 40011 / values [4] at 02:00 CT visibly summarized from the linked row; contrasting raw cells verified with computed style. Normal read timestamps fall exactly on five-minute ticks.
- C3 required telemetry statement, C6 VPN/controller/network/sensor chips, A1 retired card absent: PASS.
- No page exceptions or document-wide horizontal overflow in tested populated views.
- Actual consequence windows unchanged: Dialysis X 2–4h, Hospital Y 4–8h, Nursing Z 1–4h; no fire-flow impact. B/C probe isolation remains covered by backend regressions.

Artifacts in `~/.hermes/cache/citride-verification/corelight/`:
- `a3-incident-timeline.png`
- `a3-raw-modbus-detailed.png`
- `c3-attack-picture.png`
- `browser-acceptance.json`
- `desktop-modbus-detailed.jsonl`, `mobile-modbus-detailed.jsonl`

## Added files
- `.specs/watershed-corelight/{requirements,design,tasks,verification}.md`
- `scripts/generate_corelight.py`
- `backend/citride/zeek_logs.py`
- `backend/citride/zeek_validation.py`
- `backend/tests/fixtures/corelight-real-export.jsonl`
- `backend/tests/test_corelight_generated.py`
- `backend/tests/test_corelight_security.py`
- `backend/tests/test_reference_retirement.py`
- `backend/tests/test_zeek_logs.py`
- `backend/tests/test_zeek_validation.py`
- `data/telemetry/corelight/conn.json`
- `data/telemetry/corelight/ssl.json`
- `data/telemetry/corelight/http.json`
- `data/telemetry/corelight/dns.json`
- `data/telemetry/corelight/modbus.json`
- `data/telemetry/corelight/modbus_detailed.json`
- `data/telemetry/corelight/notice.json`
- `data/telemetry/corelight/vpn.json`
- `data/telemetry/corelight/manifest.json`
- `frontend/src/NetworkEvidence.tsx`
- `frontend/src/networkEvidence.ts`
- `frontend/src/network-evidence.css`
- `frontend/tests/network-evidence.test.mjs`

## Removed files
- `backend/citride/pcap_reference.py`
- `backend/citride/reference_investigations.py`
- `backend/citride/reference_data/waterutil-fuel-v2.json`
- `backend/citride/reference_data/corelight-waterutil-v2.json`
- `backend/tests/test_pcap_reference.py`
- `backend/tests/test_reference_investigations.py`
- `frontend/src/ReferenceInvestigationEvidence.tsx`
- `frontend/src/PcapEvidencePanel.tsx`
- `frontend/src/pcapEvidence.ts`
- `frontend/src/referenceInvestigation.ts`
- `frontend/src/reference-investigation.css`
- `frontend/tests/pcap-evidence.test.mjs`
- `frontend/tests/reference-investigation.test.mjs`
- `scripts/analyze_demo_pcap.py`
- `scripts/build_demo_pcap.py`
- `scripts/verify_reference_investigation.py`
- `.specs/reference-waterutil-investigation/{requirements,design,tasks,implementation}.md`

Removed route/import/card/reference-case wiring from active application paths. Already persisted retired reference-case types are hidden/404, not rewritten into Watershed evidence or erased from production storage. The standalone source report was not a tracked file in this checkout; its retained repository references were removed with the retired specs/tools.

## Modified integration files
Generator/scenario and four legacy telemetry views; FastAPI routes, command-case integration and service packaging; App, CommandReadouts, CommandCasework, CommandWorkspace, CommandCenterViews, commandCenterModel, types and narrowly scoped presentation aliases. Existing test fixtures were updated for Corelight stream IDs, permitted REJ probes, network source provenance and six required gateway identities while retaining their assertions. Existing reasoning tests were not modified.

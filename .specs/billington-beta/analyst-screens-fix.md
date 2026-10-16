# Analyst screens fix — received scope and local verification

Base requested: `aa2a32e`. Existing dirty IDT/Corelight/sample-data work preserved; no reset of existing app data, commit, push or deployment. TestClient resets use disposable pytest directories only.

## Received requirements

The initial message contained A1/A2 and truncated at A3. The subsequent user message supplies the complete A3/A4/C2 scope and the after-reset browser acceptance sequence. All five screens are now in scope. Design sections 7, 12, 14 and 15 govern the derived models; captured snapshots are never rewritten.

The named `mockups/CITRIDE_Beta_Mockup.html` is absent from the repository and supplied archives. The original archive supplies individual screen boards, `design.md` and `feature-map.md`. A1/A2/A3/A4/C2 boards were opened in the browser; A2 was reached using the left navigation. These are design inspections, not acceptance of the implemented application.

## Implemented A1

- Shared `CaseCreateForm` used by the Case File and new inline alert forms.
- All events without an open/monitoring case, newest first; show five with Show all toggle.
- Existing same-event cases have Open case file links, separate from missing-case alerts.
- Source CT times, explicit utility attribution and ATT&CK chips.
- Campaign notes require explicit incident campaign membership and an actual open case; shared log-source IDs alone do not imply a campaign.
- Editable prefilled title, 160-character limit, anomalous/normal priority defaults, captured baseline and explicit baseline refresh.
- Existing request identity, frozen payload, no-auto-replay, uncertain-save reconciliation and duplicate-submit guards preserved.
- Saved/reconciled creations open the Case File.
- Analyst header Open case from alert navigation/scroll and Needs you next copy.

## Implemented A2

- Exported utility evidence classification reused by A5 ranking and A2 overlay.
- Under attack requires an open/monitoring case and effect/compromise evidence. Probe-only utilities remain Probed.
- Legend, utility markers, service-area status and case counts.
- Entity Profile links for named records; original full located-record listing preserved under Advanced rather than removed.
- Service-oriented supplier/dependent summaries, one upstream hop, Facility Q no-dependency message, fire-flow pressure caveat and reserve details.
- Original direct relationship counts and evidence remain available under Advanced.

## A3 supplied contract

- Three URL-persisted tabs: timeline, hunt, raw; default timeline with a case, hunt without one (All recorded events).
- Pure case timeline includes Utility A and campaign-source-linked B/C, CT time, title, utility, ATT&CK and origin chips, case-event and observed-effect marks. Raw record selects and highlights the referenced row on the raw tab.
- Pure source/account/off-hours hunts over telemetry, scope selector and explicit Run search. Verdicts distinguish completed sessions, probe-only and no findings. Off-hours is 00:00–05:00 America/Chicago and includes 01:30 VPN.
- Hunt records scoped to the case; required status/note records through record_hunt; parent refresh includes C3's records.
- Raw streams retain original fields/Zeek order, event highlights, selected JSON, capped count and full JSONL download.

## A4 supplied contract

- Extract one DependencyNetwork; C4 display behavior unchanged, A4 explore mode. Upstream expansion, optional unaffected/ownership/cyber links, evidence-backed node inspector and map/profile/proposal actions.
- Analysis scenario and 12/24-hour controls use the shared confirmation. Initial linked analysis may capture a case run; alternate scenarios and later exploratory analyses save separately, never replace the captured run.
- Required-note impact reviews retain existing review_decision semantics. Not affected and needs-model-review stay separate from modeled consequences.
- Quick what-if uses a captured impacted dependency and clean-water reserve, one override with What-if from case <title>, separate cascade run. Rates come from reference data with reference version and Planning estimate from scenario assumptions label.
- Dialysis reserve 2→6 hours must move its window 2–4→6–8 hours, avoiding 4 service-hours and $32,000–$60,000; no case-run mutation.
- Missing-dependency action opens the existing stage→validate→promote editor with a fresh proposal and selected provider/dependent prefill. No direct promotion.
- Full Scenario lab remains available. Separate planning requests get optional durable idempotency identities for explicit lost-response reconciliation; no database migration is required.

## C2 supplied contract

- Every statewide incident remains plotted at its recorded schematic location, with attacked/probed/modeled-facility/other legend and muted unselected incidents.
- Selected Watershed footprint shows recorded Utility A area/population, captured-run facility windows and explicitly excluded fire flow. B/C use A2 probe status and reference populations.
- Panel uses story clock, IDT sector names, current record severity/status, captured windows, reference-rule boil-water possibility and pending decisions; Analyst handoff is read-only.
- No inputs/search/filter; zoom allowed. No captured run means Not yet modeled and no inferred windows.

## Earlier A1/A2 verification (superseded by the final integrated report)

- New A1 test file initially failed for missing implementation, then passed.
- Retry-navigation regression reproduced before its source fix.
- A2 focused tests cover classification, summaries, immutable inputs and entity callbacks; the independent parent suite below verifies the integrated snapshot.
- Final frontend suite: 222 passed, zero failed/skipped.
- Production build: passed; existing bundle-size advisory remains.
- Backend regression: 648 passed, 18 skipped, 906 warnings; skipped tests require TEST_DATABASE_URL. This is not a new real-PostgreSQL acceptance claim.
- Deterministic generator: 15 synthetic data files verified, seed 250.
- IDT check: v4, 1,985 entries, 18 sectors; deterministic JSON/Turtle and separate runtime OWL verified.
- git diff --check: passed.
- Both supplied reference.json and watershed_beta.json verified byte-identical to the supplied Sample Data Fix archive.
- Direct execution reproduced exact requested Utility A / Facility Q summaries and A under attack, B/C probed, unrelated none.

## Open acceptance gates

An isolated QA app on port 8781, with a separate cache directory, was denied authorization during A1/A2. After the user supplied the remaining scope and browser acceptance sequence, a new launch was also denied. No further launch or workaround was attempted. Desktop/mobile after-reset application acceptance and the seven requested screenshots remain unexecuted, pending explicit runtime approval. Reference-board browser inspections and ASGI/TestClient integration are not substitutes for those screenshots.

The prior sample-data full reset restoration, dedicated PostgreSQL mutation readback and packaged-fixture proof were not resumed by this Analyst task and remain separate outstanding gates. The broad prerequisite implementation is present; this report does not promote incomplete release acceptance to complete.

Evidence logs: `/home/gphreakx/.hermes/cache/citride-analyst-reference/` (`a1-red.log`, `a1-retry-red.log`, `a2-integration-red.log`, `a1-final-tests.log`, `frontend-final.log`, `build-final.log`, `backend-regression.log`).

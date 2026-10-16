# Sample data fix: fill C1, C3, C5, C7 and A5

Base: commit `aa2a32e`. Order: do this after Part 1 of `idt-fix.md`, and together with the storyline data in design §12. Write tests before code, and keep every existing test passing.

## Decision (Carmen, Oct 15)

The beta needs the scripted sample data that was deferred. Carmen has supplied it, so do not invent or change values. Use these two files exactly as given:

- `data/scripted/watershed_beta.json`: the sample records.
  - Five statewide incidents: the Watershed attack plus four unrelated ones, one of them closed.
  - Five team deployments and 14 response tasks grouped by team.
  - Fifteen partner and stakeholder contact statuses.
  - The CTIC attribution assessment, with a placeholder actor.
  - Six asset compromise statuses, two threat hunts, two recorded Chief decisions and three draft partner products.
- `data/scripted/reference.json`: reference values that are currently typed into code. Move it to `data/reference.json`. It contains:
  - the four response options with their legal basis (chapter-level citation only; no "needs legal review" label, since this is a beta with mock data)
  - planning rates
  - the boil-water rule
  - first actions with contact roles
  - the response-clock target

The values match the mockups Carmen approved (`mockups/CITRIDE_Beta_Mockup.html`), screen by screen.

The rule from requirements R3 still applies: script the records, never the screens. Every number, name, status and time on screen must come from these records, from analyst actions, or from a calculation over them.

## 1. Prerequisite: storyline data (design §12)

A5's ranking and C3's attack stages need the storyline additions. Add them now, through the generator, with `idt` on each (see `idt-fix.md`):
- Entities: `vpn-a/b/c`, `cyber-vpn-a/b/c`, `vendor-v`, `hospital-w`, `dialysis-u`.
- `vendor-v` gets a `supportAccountAt: ["org-a","org-b","org-c"]` relationship. This is what C3's exposure check reads: "2 more utilities use Vendor V: B and C."
- Dependencies `dep-b-w` and `dep-c-u`, and the new service functions `hospital-sterilization-w` and `dialysis-treatment-u`.
- Potential scenarios `potential-unsafe-water-b` and `-c`, never linked to a case.
- Event `event-vpn-a` at −0.5 h, with the network records from `corelight-fix.md`.
- `attackTechniques` on all events.

## 2. Loading: one entry point, origin on every record

1. Validation (`backend/citride/validation.py`):
   - Add `validate_scripted(data, scenario)` and `validate_reference(data, scenario)`.
   - Every ID is unique, and every `entityId`, `optionId`, `teamId` and `incidentId` resolves. A record's `incidentId` resolves when it names an incident in `incidents`.
   - Status values are in the label maps.
   - Every record has `origin`, `sourceRefs`, `classification` and `handling`.
   - Every rate's `functionId` exists.
   - Fail at startup if either file is invalid.
2. `ingest_records(records, origin)` (design §16) is the only way records enter storage. The startup seed, **Reset demo**, and any future real feed all call it. No screen reads the JSON files directly.
3. Storage:
   - Keep the scripted collections in the same store as cases, file or PostgreSQL. Collections: `statewideIncidents`, `teams`, `responseTasks`, `contacts`, `assessments`, `assetStatuses`, `hunts`, `decisions`, `partnerProducts`.
   - Each record keeps `origin` and a `history` list of changes (who, when, what).
   - Expose them read-only at `GET /v1/command/records?incidentId=…`, behind the existing login.
4. Time:
   - Add a story clock: `GET /health` returns `storyNow`.
   - After Reset demo, it reads `incidentOrigin + timing.storyClock.startRelativeHours`, which is 03:00 CT, and advances with real time.
   - Records with `relativeTimeHours` display at that story time.
   - Watershed records with `offsetMinutes` appear when a case is opened from any event in `incidents[TX-26-0412].linkedEventIds`, at the case-open story time plus `offsetMinutes`. They attach to that case.
   - "Late" is calculated: due time is before `storyNow` and the task isn't done. Never store "late."
5. Linking the Watershed incident:
   - `TX-26-0412` is the display ID of the case opened from those events.
   - Its status, reviews and progress come from the live case. Its other fields come from the scripted record.
   - Before the case is opened, C1 shows only the four other incidents, and the alert waits in A1.

## 3. Analyst actions (same endpoint, `expectedVersion`, `clientRequestId`)

Add these action types to `POST /v1/command/incidents/{id}/actions` (design §16). Each one writes a change into the record's `history` with who and when, and the Command Center reflects it within one refresh.

| Action | Changes | Used on |
| --- | --- | --- |
| `record_assessment` | attribution cluster, actor label, confidence, note | A3 → C3 |
| `set_asset_status` | asset status and detail | A3 → C3 |
| `record_hunt` | hunt status and result note | A3 Threat hunt → C3 |
| `set_contact_status` | partner status and note | A5 coordination → C7 |
| `record_decision` | option decision (`chosen`, `deferred`, `not_chosen`, `standing_by`) and note | A5 "Record decision note" → C6 |
| `set_team_status` | team status, people, location, update text | A6 → C5 |
| `add_task` / `set_task_status` | task label, team, owner role, due, status | A6 → C5 |

Remove the unused "decisions" casework mode, or reuse it for `record_decision` (feature-map §6 item 4).

## 4. What each screen reads

The source for every value is listed below. Replace each "not supplied" paragraph with the real content; keep one status line in the header (R1.7).

| Screen | Reads | Shows |
| --- | --- | --- |
| **C1** | `statewideIncidents` + live cases, `decisions`, response options, latest run, case activity + incident `updates` | Totals (active incidents, sectors, people in affected water service, decisions waiting); schematic map using each incident's `location.schematic`; incident table (title, ID, where, sectors by IDT name, severity, status, elapsed from `storyNow`); decisions waiting = options with no decision record; critical facilities at risk; "From the analysts" |
| **C2** | same + entities | All incidents on the map; selected incident panel; Utility A footprint, B and C marked probed |
| **C3** | events + `attackTechniques`, `assessments`, `assetStatuses`, `hunts`, `vendor-v` relationships | Attack stages with times; time inside before reaching the plant and plant access to setpoint change (calculated from event times); attack path; "Who is behind it" with the "CTIC analyst assessment" label; indicators; exposure check; what's been hit with counts; active hunts |
| **C5** | `teams`, `responseTasks`, `reference.responseClock` | Totals (teams, analysts by status, en route with ETA, response clock with amber/red); deployment map using `schematic`; hover or tap a team for its details; all-teams table |
| **C6** | case, run, `responseOptions`, `decisions`, `partnerProducts` | Option cards ordered by the window each must beat, using `optionTimingLabels` when there is no impact window; decision status from records; decision trail; "Cases behind this brief" includes `TX-26-0398` (closed) as a read-only summary |
| **C7** | `contacts`, `contactStatusLabels` | Need to act / Need to know / Helping us, with counts; plain status labels; "CITRIDE does not send notifications"; keep the four audience previews |
| **A1** | cases, events without cases, tasks | Unchanged, except "Needs you next" includes late scripted tasks |
| **A3** | `hunts`, `assessments`, `assetStatuses` | Threat hunt tab lists the hunts and records results; analysts can edit the assessment and asset statuses |
| **A5** | see §5 | Ranking, first actions, contacts, Record decision note, partner products, coordination notes |
| **A6** | `responseTasks`, `taskGroups`, `teams`, response clock | Tasks grouped by team, with status chips and checkboxes; add task (label, team, owner role, due); response clock bar |

Remove the hard-coded values the review found:
- `planningRates` and the options in `prototypeViews.ts`
- the role-contact text in `PrototypeCaseViews.tsx`
- the audience titles in `commandCenterModel.ts`

Read them from `GET /v1/reference` instead.

## 5. A5 Who Acts First: ranking A, C, B

Implement `rankUtilities(data, cases, runs, reference)` in `frontend/src/whoActsFirst.ts` as design §12 describes:
1. **Evidence status** per utility, from its events:
   - `effect_observed` (A: dosing change and water-quality drift)
   - `compromise_suspected`
   - `probing_only` (B and C)
   - `none`
2. **Earliest critical window**:
   - For A: from the case's captured run.
   - For B and C: from the latest saved run of `potential-unsafe-water-b` / `-c`, counting healthcare facilities (IDT sector 10) first.
   - With no run, the window is "unknown" and the screen shows **Estimate potential impact for B and C**. That button runs both scenarios through the existing confirmation dialog.
3. **Sort** by evidence rank, then earliest window start (unknown last), then people served, highest first (`peopleServed`).
4. **Expected result** after estimating:
   - **A**: effect observed, 18,000 people, Nursing Home Z at 1–4 h.
   - **C**: probing only; Dialysis Center U could be affected within 2–4 h if compromised; 9,000 people.
   - **B**: probing only; Hospital W at 4–8 h; 12,000 people.

   Before estimating: A first, then B and C marked "unknown window."
5. **First actions and contacts** come from `reference.firstActions`, matched by each utility's event observations. `{u}` and `{facility}` are filled from data. Each block is labeled "Suggested — cyber SME to confirm."
6. **Potential results** are styled "Potential, not observed." They never appear in the map's impact overlay.
7. **Record decision note** writes `record_decision` for the chosen response option, not a plain note.

## 6. Tests and acceptance

- Validation tests for both files, including a bad reference in each collection.
- **No hard-coded values:**
  - Load an alternate scripted file with different team names, a sixth incident and changed contact statuses.
  - Render C1, C3, C5, C6 and C7; the alternate values appear and the originals don't.
  - A source search finds none of the scripted display strings in `frontend/src`.
- **Ranking:** `rankUtilities` returns A, then B and C as unknown before estimates, and A, C, B after.
- **Clock:** the late calculation follows the story clock. "Utility B: reset Vendor V credentials" is late from the start of the demo.
- **Write-through:** each new action type changes the record, adds history, and updates the matching Command Center screen.
- **Reset:** Reset demo restores the scripted state. Analyst changes made before the reset are gone; scripted records come back with `origin: "scripted"`.
- **Browser check after a reset:**
  1. Before opening the case, C1 shows four incidents.
  2. Open the case from the vendor VPN alert.
  3. C1 shows five incidents.
  4. C3, C5 and C7 show full content with no "not supplied" text.
  5. A5 ranks A, C, B after estimating.
  6. Record a decision on A5; C6 updates.
- Existing acceptance unchanged: X 2–4 h, Y 4–8 h, Z 1–4 h; no fire-flow loss from unsafe water; the B and C probes create no consequence for A.

## Report back

When done, list:
- the files changed
- the new action types
- test counts
- screenshots of C1, C3, C5, C7 and A5 after estimating B and C

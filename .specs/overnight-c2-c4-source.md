# C2 and C4: move the consequence views, and check every link

**For:** Donna. **From:** Carmen Zapata (GDIT). **Date:** October 18, 2026.

**Before you start:** finish `analyst-port-case.md` (the Port of Houston incident opening in Analyst). This instruction builds on it and doesn't repeat it.

**If that file's version had a C4 arrows task** ("C4 arrows show the cascade"), this instruction replaces it:
- The arrows are now worked out on the server and drawn by the sector view on C2 (Part A below).
- Move any arrow work you already did there; don't keep two versions.

Release once all the tests pass. You may refine the sample data if you need to; list every change in your report.

## Who does what

The work is split to save time and cost. Each agent edits only its own files.

| Who | Does | Starts |
|---|---|---|
| **Donna** | **All of Part A:** the server-side sector links in the consequence projection, the shared URL selection helper, the two view modules and their view models, C2's facts from the incident, putting C2 and C4 together, and removing the old code. Then merging, and the release. | Now, after the port fix |
| **ThunderCat** | **Part B:** the automated link check, and fixing links on the Analyst screens (A1–A6, Case File, Entity Profile). | Once Donna pushes Part A. Branch from that exact commit, as `links-check-wip`. |

How you work together:
- **Donna, when Part A is pushed:** post the commit ID for ThunderCat.
- **ThunderCat, Command Center links:** edit only Analyst files and the new link-check test. A broken link on a Command Center screen (C1–C7) goes to Donna as a list (screen, link, where it lands, where it should land). Don't edit her files.
- **Donna, fixes:** fix the Command Center links on that list, then merge ThunderCat's branch into hers.
- **Release:** Donna releases once the link check and every other test pass, on the merged branch.
- **Blocked:** if either of you is blocked by the other's files, stop that piece and tell Jake.

---

# Part A · Move the two consequence views between C2 and C4, as complete features


## Why

People move C1 → C2 → C4, and C2 already links "Full consequences: C4 →". Today it's upside down: C2 has the detailed asset view, and C4 has the summary sector view. Swap them, so C2 gives the incident at a glance and C4 has the full detail.

CITRIDE is a real application, so this is **not** a move of pictures. Each view moves with everything that makes it work:
- its data
- its logic
- its state
- its links
- its styles
- its tests

## What's there today (check your branch)

- **One data source.** Both views read `/v1/command/consequences`, the best available analysis for the incident.
- **C2's asset view lives inside `IncidentView.tsx`.** The screen code itself:
  - builds the node list and merges in watch sites
  - writes the "why it matters" text inline
  - owns the `sector` filter in the URL and the selected asset
  - links to Analyst
- **C2's summary facts come from the saved case.** Some, like "Also probed", come from the case, not the incident, so they read "None recorded" when no case is open.
- **C4's sector view keeps its choice in local state.** It's `C4SectorMap` (or `CascadeGraph` when there's no sector data) plus `C4Metadata`. It keeps its sector choice in local state, and draws its arrows from sector positions, not from the analysis's dependency paths.

## What to build

### 1. Two self-contained feature modules

Each module has its own folder, with:
- the view component
- a **pure view-model function** that turns the consequence projection into what the view shows
- its own CSS
- its own tests

Neither knows which screen it's on.

**Asset view** (`AssetConsequenceView`). Today's "What it touches" on C2:
- the asset drawing, with sector filters, zoom and pan
- the Infrastructure list, with each asset's "why it matters"
- links to Analyst (Entity Profile and the case)

Move the node building, the watch merging and the "why it matters" text out of `IncidentView.tsx` and into this module's view model. Nothing that decides what is shown stays in screen code.

**Sector view** (`SectorCascadeView`). Today's "Sector dependencies" on C4:
- the sector map when the incident has sector data
- otherwise the cascade graph (water today)
- the watch links

Its arrows come from the analysis's recorded dependency paths, not from screen positions:
- **Source → sector:** only when that sector has an asset that depends directly on the source (a 1st-step impact).
- **Sector → sector:** when a recorded dependency runs from an asset in one sector to an asset in another. Label it with the service it carries, from the data. For the port that's Chemical → Water "chlorine".
- **No direct source arrow** to a sector reached only through another sector.
- **Color** each arrow by the window of the sector it points to. Watch links stay dashed amber, "not a dependency".

**Work these sector links out on the server**, in the consequence projection (for example a `sectorLinks` list: from, to, service, step). Store them with the run like everything else. The view only draws them.

### 2. Shared selection, through the URL

- **One shared helper** reads and writes the incident, `sector` and `entity` in the URL. Both modules and both screens use it.
- **Deep links work.** A link to C4 with a sector or asset opens with it selected. Back and forward work. Reloading keeps the selection.
- **C2 → C4.** Clicking a sector or asset in the sector view on C2 opens C4 with that sector filter or asset selected.

### 3. Screens put the modules together

**C2 Incident View**
- the summary band
- `SectorCascadeView`
- a link "Every asset, and why: C4 →"
- the "More" section

Fit the drawing's panel to its content, with no empty space below it.

**C4 Consequences**
- the banner, asset strip, tiles and critical functions
- `AssetConsequenceView` in place of the sector drawing and its "Why it's at risk" panel
- then, as today: On watch, the timeline and thresholds, By sector, workarounds, owners and the footer

### 4. C2's facts come from the incident, not a saved case

C2's summary band reads only from the incident's records and the consequence projection: also probed, also watching, sectors and waiting on. "Also probed" then shows Utilities B and C as soon as the water incident loads. No Command Center view depends on an analyst having opened a case.

### 5. Remove what's replaced

Delete the old code, with no duplicate paths left behind:
- C4's separate "Why it's at risk" panel
- `C4SectorDetails` ("Inside each sector"); the asset view's sector filter replaces it
- the inline map, list and "why it matters" code in `IncidentView.tsx`

Each module's CSS moves with it. Nothing on C2 or C4 styles another module's parts.

### 6. Keep the application rules

- **No names in code.** Nothing names a customer, place, sector, asset or incident.
- **Command Center stays read-only.** The moved views get no editing controls.
- **Scale.**
  - Both views stay usable with the larger fixture (about 50 incidents and 300 assets).
  - The asset view's filters and the Infrastructure list search keep large incidents readable.
  - The sector view groups watch sites when there are many.
- **Phone width.** Both screens work at phone width, with no horizontal page scroll.

## Mockups (in this zip)

| File | Shows |
|---|---|
| `C2_new_port.png` | C2 for the port: summary band, then the sector view with the cascade arrows fixed |
| `C2_new_water.png` | C2 for water: summary band, then its cascade graph |
| `C4_new_port.png` | C4 for the port: the asset view in place of the sector drawing; "Inside each sector" removed |
| `C4_new_water.png` | C4 for water, the same way |

They were made from today's build by moving the existing parts, so the look of each view should stay as it is. Only where the views sit, and the arrows, change.

## Demo note for Carmen

In the water walkthrough, pointing to Nursing Home Z, Dialysis Center X and Hospital Y now happens on C4, not C2.

## Tests

1. **View models.** Pure tests for both view models, run on the port, water, the third fixture and the larger fixture.
2. **Server sector links.** The port projection has source → Energy, Transportation and Chemical, and Chemical → Water with its recorded service, and no source → Water. Water has only source → Healthcare. The third fixture includes one cross-sector 2nd-step dependency, and its link appears.
3. **C2 port and water.** The summary band, then the sector view, with no empty space under the drawing. "Also probed" shows Utilities B and C for water on a fresh reload, with no case open.
4. **C4 port and water.** The asset view shows every asset and window C2 showed before. Each asset opens its "why it matters", and the Analyst links work. There's no "Inside each sector" section.
5. **Navigation.** Clicking Healthcare on water C2 opens C4 with the Healthcare filter on. Clicking Water on port C2 opens C4 filtered to Water. A deep link with `entity=` opens that asset. Back, forward and reload keep the selection.
6. **No leftovers.** A search finds no remaining copy of the old inline C2 map or list code, `C4SectorDetails`, or C4's separate "Why it's at risk" panel.
7. **Layout.** Check C2 and C4 at 1440 and 1920 against the mockups, and at phone width.
8. **Regression checks.** `npm test`, the backend tests and the TypeScript build pass. Update tests that checked the old layout; don't delete coverage.

Add Part A's commits, the two module folders, pictures of C2 and C4 for both incidents, and any `// PROTOTYPE:` shortcuts to your report.

---

# Part B · Every link between screens works, Command Center and Analyst

Do this after Part A. The port fix and Part A change where things live, so every link that points into C2, C4 or Analyst must be checked and fixed: links on every screen, not only C2 and C4.

## The rules for links (unchanged)

- **Command Center links**
  - solid outline, ending in →
  - open a Command Center screen, on the same incident
- **Analyst links**
  - dashed, include "in Analyst", end in ↗
  - land on something specific: the incident's case, or a specific asset, alert or record
- **No link lands on an empty screen.** That means no "No incident selected", "Select a case", "Choose a saved case", blank panel or wrong incident.
  - If the incident has no case yet, an Analyst link lands on A1 filtered to that incident, with its alerts listed and "Open case" ready.
  - Once a case exists, the link opens that case on the right screen.
- **Selection carries over.** Every link carries the incident, and the sector and asset when there is one. Back, forward and reload keep them.

## Links to check

These are the ones we know about. Find and check every other link too.

| From | Link | Must land on |
|---|---|---|
| C1 card | Incident view · C2 → | C2 on that incident |
| C1 card | C3 →, C4 → | C3 or C4 on that incident |
| C2 | How it got in: C3 → | C3 on the same incident |
| C2 | Full consequences: C4 → · Every asset, and why: C4 → | C4 on the same incident |
| C2 sector view | a sector or asset | C4 filtered to that sector or with that asset selected |
| C2 | Waiting on … · C6 → | C6 on that decision |
| C4 | Review in Analyst ↗ | A4 on the incident's case, or A1 filtered to the incident when there's no case |
| C4 asset view | Inspect current record in Analyst ↗ | Entity Profile for that asset, within the incident's case |
| C4 asset view | Alerts in Analyst ↗ | A1 filtered to the incident |
| C4 | Partner coordination: C7 → | C7 on the same incident |
| C5, C6, C7 | every link to C2, C4 or Analyst | the right screen, incident and record |
| A1–A6, Case File, Entity Profile | every link back to Command Center (C2, C4 and so on) and between Analyst screens | the same incident or case, with the asset kept where one is selected |
| Entity Profile | ← Back to previous view | the screen you came from, with its selection |

## Automated link check

Add a browser test that runs on a fresh reload for the port, water and the third fixture:

1. Open every Command Center screen (C1–C7) and every Analyst screen (A1–A6, Case File, Entity Profile).
2. Follow every link and link-style button.
3. Check each landing:
   - right screen
   - right incident
   - the sector or asset kept
   - no empty-state text
   - no browser errors
4. Run it twice:
   - **no case open yet:** Analyst links must land on A1 filtered to the incident
   - **after opening a case:** Analyst links must land inside that case
5. Check link style: Command Center links are solid and end in →; Analyst links are dashed, say "in Analyst" and end in ↗.

The test must not edit data, except opening the one case in step 4.

## Tests

1. The automated link check passes for the port, water and the third fixture, before and after a case is opened.
2. No link anywhere still points to a removed part. That includes C4's old "Why it's at risk" panel, "Inside each sector", and C2's old asset list.
3. The C4 "Review in Analyst ↗" link on the port lands on the port's case, not on an empty A1.
4. `npm test`, the backend tests and the TypeScript build pass.

Add to your report the list of links checked, any you fixed, and any you removed because their target no longer exists.

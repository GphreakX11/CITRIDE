# Checks after the port fix and the C2/C4 move

**For:** Donna. **From:** Carmen Zapata (GDIT). **Date:** October 18, 2026.

This follows `analyst-port-case.md` and `c2-c4-swap.md`. Do it once both are done. These checks cover things the earlier parts can affect outside what those two files test. Fix what fails, then release once all the tests pass. You may refine the sample data if you need to; list every change in your report.

## Who does what

| Who | Checks |
|---|---|
| **ThunderCat** | 2 (customers stay separate: A1, the Analyst screens and the case lists), 9 (reload: the port's alerts reappear in A1 and no old cases remain) |
| **Donna** | 1, 3, 4, 5, 6, 7, 8, 10, 11, then the merge and the release |

How you work together:
- **Branches.** Both of you start from the merged branch after `c2-c4-swap.md`. ThunderCat works on `checks-analyst-wip` and edits only Analyst files and tests. Anything that needs a backend or Command Center change goes to Donna as a list.
- **Release.** Donna merges ThunderCat's branch and runs the production move (check 8) last, once everything else passes.
- **Report.** One combined report, from Donna.

## Checks

1. **Water analysis doesn't go stale because of the port.**
   - Adding the port creates a new version of the main store. Water's preliminary analysis, its saved cases and its reviewed runs must not be marked out of date for that reason.
   - Staleness is per incident: a run is out of date only when that incident's own inputs changed.
2. **Customers stay separate.**
   - The third fixture belongs to a different customer. Its alerts, cases, incidents and analyses never appear in TXCC's C1, C2 and C4 pull-downs, A1 or any count, and TXCC's never appear in its views.
3. **No double counting.**
   - The port's incident record, asset statuses and pending decisions were stored before the port fix. After it, every count stays right:
     - C1's open incidents and people totals
     - the port's 14 assets
     - one pending TX-ISAO advisory, not two
4. **The reasoning engine still works.**
   - The ontology reasoning runs over the whole store. Port asset types (port, LNG, pipeline, vessel and so on) must not make it fail or slow it down noticeably.
   - Saved reasoning runs stay readable.
   - If a type is missing from the ontology, add it the same way the existing types are defined, and list it in your report.
5. **C3 Attack Picture for the port.**
   - The port's events are now in the store, so C3 will try to draw them. It shows them properly, or keeps its "in development" note. It doesn't half-render or throw errors.
6. **C1 doesn't depend on a saved case.**
   - C1's people totals, including people on probed utilities, come from the incident's records and the consequence projection, not from saved cases. On a fresh reload with no case open, C1 shows the same totals as after a case is opened.
7. **C5, C6 and C7 for the port.**
   - Teams, the leadership brief and partner coordination show the port's own records, or an honest "Not recorded". No blank panels, and no water content under a port heading.
8. **Production move.**
   - Back up the production database first. Run the add-only dry run and review the plan, then apply.
   - Afterwards, confirm these are all still there:
     - existing cases
     - decisions
     - reviewed runs
     - the port's preliminary analysis
   - Record the backup name and both run times in your report.
9. **Reload of the sample data.**
   - After a guarded reset, both incidents come back, both preliminary analyses rerun, the port's six alerts reappear in A1, and no old cases remain.
10. **Load time.**
    - The store roughly doubled. Measure the time to first screen and the size of the first data download, on the hosted site and on the laptop backup, before and after the changes.
    - If either got noticeably worse, say how much and why.
11. **Wording on C2.**
    - The sector view's panel title matches C2's question: "What it touches · by sector".
    - The hint says where a click goes: "Select a sector or asset to see it on C4".

## Tests

- Each of checks 1–11 has an automated test, or for check 8 a recorded run of the procedure on a copy of production data.
- `npm test`, the backend tests, the TypeScript build, and the generator and IDT `--check` all pass.

## Report (one message to Jake, for Carmen)

- **Results:** pass or fail for each check, and what you fixed.
- **Data:** any sample-data changes, and any ontology types you added.
- **Load time:** before and after.
- **Production:** the backup name, the dry-run and apply times, and confirmation that saved records are intact.

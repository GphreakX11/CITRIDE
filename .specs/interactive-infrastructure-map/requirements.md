# Interactive infrastructure map

## Request and constraints
Jake's production screenshot showed static, identical facility dots with no selectable map. Restore real interaction and improve visual hierarchy with representative infrastructure icons. Review the data behind map overlays and dashboard metrics.

- Preserve current React/FastAPI/RDF/storage/hosting and existing saved evidence.
- No backend migrations, fixture rewrites, production writes, commit, push or deployment in this task.
- No external map/tile services, geocoding or invented facility coordinates.
- Read-only means no record mutations; selecting facilities, filtering display, pan/zoom and opening Analyst are permitted.

## Acceptance
1. Both Command Overview (C1) and Statewide Map (C2) offer actual clickable, keyboard-selectable infrastructure markers, not a flattened SVG image.
2. Distinct icons for water utility, treatment plant, hospital, dialysis, nursing facility, power and fire; unknown types use a neutral infrastructure icon, never guess from a label.
3. Selection highlights the facility and opens an evidence-backed detail panel; facility-list alternatives remain usable at phone width. Keyboard Enter/Space, clear, zoom/reset and pan work.
4. Dependency direction remains provider → dependent. Distinguish reference records, captured context and modeled consequences, not actual normal/down states.
5. All-incidents view includes captured modeled results from every active saved case, rather than resetting everything to gray.
6. Selected-case nodes/edges/labels come from that case's snapshots, not a silent merge with today's model. Missing evidence remains explicit. All-incidents mixed layers disclose historical label differences.
7. IDT gaps remain gaps unless classification is actually captured; do not backfill immutable history from today's reference taxonomy. Population conflicts/unknowns cannot silently become numeric totals.
8. Exercise source/data regressions, actual browser clicks/keyboard/navigation and 393px mobile; intercept unexpected mutating requests. Compare read-only API state before/after.
9. Capture before/after screenshots and verification receipt. Keep production status separate from local acceptance.

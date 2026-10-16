# Navigation and wording fix — cumulative current-app scope

## Baseline and boundaries

Apply to the current integrated content+visual working tree, not a reset to aa2a32e. Incoming feedback describes older states; preserve current working features and theme. Names, labels and generated UI copy only. Keep route IDs, request/action fields, data, calculations, event handlers, disabled/retry/confirmation guards and CSS/layout intact except the explicitly requested additional Case status navigation entry. Existing copy assertions may change; behavior invariants must not be weakened.

The complete follow-up supplies sections 4–7. Nothing remains unspecified in this wording request.

## Navigation

C1 Command Overview; C2 Statewide Map; C3 Attack Picture (CTIC); C4 Consequences; C5 Response Teams (UCTF); C6 Leadership Brief; C7 Partner and Stakeholder Coordination.

A1 Case Queue; A2 Investigation Map; A3 Cyber Evidence (CTIC); A4 Consequence Analysis; A5 Who Acts First; A6 Response Tasks (UCTF).

Page title: code, middle dot, name; unit a separate small suffix. Keep all internal IDs, colors and eight Advanced tool names. Menu headings COMMAND CENTER / ANALYST; mode labels Command Center / Analyst; supplied header subtitles already exist.

## Shared status/copy

One header chip on every view: Sample data · not connected to live systems. Existing Command story clock stays next to it and is HH:mm CT. Remove repeated body status/disclaimer blocks. Keep operational errors and uncertain-write recovery, not static policy prose.

Keep the explicitly allowed in-place labels only, once per card: Modeled · not observed outages; Potential, not observed; Planning estimate from scenario assumptions; Advisory, not approvals; Suggested -- cyber SME to confirm; Draft · not sent; CITRIDE does not send notifications; CTIC analyst assessment; Network · Corelight format (simulated); Alerts never become cases on their own; an analyst opens the case. C6 keeps the exact supplied duty-officer/Chief-decision sentence as an explicit longer exception.

Replace missing-data explanations with truthful one-line empty states, never invented normal/zero values. Preserve grounded fire-flow, no-dependency, source and assumption facts. Technical explanations may remain in Advanced/Sources, but retired phrases must not remain in UI literals.

## Case File

Keep all sections mounted and every control. Context; Cyber Evidence; Consequences; Reviews n/m; Tasks n/m; Notes; Activity; Case status; Advanced. Existing section/action IDs remain where possible; a new status nav alias targets the existing tracking section rather than changing its controls.

Use the explicit statewide-record case link for the public incident display ID; do not infer foreign case membership or fabricate TX numbers. Header: CASE FILE · display ID · version N · opened HH:mm CT from the source alert, monospaced. Internal case IDs stay in Advanced/raw evidence and unchanged request/URL fields, not ordinary visible case copy.

## Investigation bar

Analyst only: Map(cop), Evidence(cyber), Consequences(consequence), Who acts first(coordination), Tasks(uctf). Remove Brief from this bar; do not remove the Command brief screen. Existing lock/selection guards remain.

## Verification

- AST source-copy guard over string literals, template chunks and JSX text; comments, method names and action IDs are not UI copy.
- Rendered checks on all 25 views, header chip exactly once, menu/title mappings and relevant label deduplication. Raw evidence and authored notes are not rewritten to satisfy a UI-copy rule.
- Keep all data and CSS fingerprints unchanged.
- Freeze the pre-wording production bundle for a reproducible net paragraph-block count. Also report paragraph texts removed/reworded, distinguishing this from repeated runtime rows.
- Update verify_command_ui.py selectors/names. Do not run its mutating workflow against protected existing QA; use read-only browser checks for current evidence unless a fresh isolated target is approved.
- Deliver actual screenshots of both menus, C3, C5 and Case File, with tests, file list and explicit verification scope. No commit or deployment.

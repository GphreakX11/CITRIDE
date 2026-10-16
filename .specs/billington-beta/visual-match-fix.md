# Visual match fix — presentation-only contract

## Base and invariants

The working tree includes the prerequisite IDT, sample-data, Corelight and Analyst content fixes. Before this pass the integrated frontend had 264 passing tests and a passing production build; the completed backend regression logged 653 passed and 18 database-dependent skips. No commit or deployment is authorized by this visual task.

This pass changes presentation only: CSS, self-hosted fonts, shared rendering primitives, and comparison/verification tooling. Existing text, durable data, API semantics, routes, callbacks, case capture rules, editor staging and feature access stay unchanged. Existing behavior tests are not edited. The deleted reference-investigation stylesheet belongs to earlier prerequisite work and is not resurrected.

## Theme and typography

- One `frontend/src/theme.css` owns the supplied navy palette and mode scales, imported once by `main.tsx`.
- IBM Plex Sans 400/500/600/700 and IBM Plex Mono 400/500 are local Fontsource dependencies. No font CDN.
- Existing screen CSS uses semantic tokens; there are no hex colors outside the theme and no numeric per-screen font sizes.
- Mode attribute controls body/title/card/tile/menu/chip sizes. Command body is 17px and summary numbers 34px; Analyst body is 15px and summary numbers 26px.
- Card/control/chip shapes are shared. Advanced layouts and controls remain intact.
- Status semantics are centralized; uppercase is CSS presentation, never a rewrite of stored/tested labels.
- Existing heading/menu labels are preserved even where the mockup uses an older or newer name.

## Accessibility exception in the supplied palette

White on the exact `--accent` blue does not achieve 4.5:1 at small text size. Primary controls therefore use actual 19px/700 large text and the WCAG AA 3:1 large-text threshold, keeping the requested palette. Body text, muted text, links and status/sample labels are independently checked at 4.5:1. Palette tests do not pretend every raw marker/border swatch is a body-text color.

## Shell and shared components

- Preserve mode/navigation handlers and menu collapse, with shared header/menu styling.
- Render reusable cards, summary tiles, status, technique and IDT chips without altering their contents or behaviors.
- Dark graph/map canvases, status colors, selection outline, readable labels and legends. Recorded geometry and captured windows never change for visual matching.
- At 390px cards stack and tables scroll inside their cards, not the page.

## Proof and limitations

The specifically named unified `mockups/CITRIDE_Beta_Mockup.html` is absent from the repo, document cache and supplied ZIPs. Individual original `.dc.html` boards are available in the extracted archive cache. They reference `./support.js`, which is also absent from both supplied ZIPs, and some include unresolved dynamic placeholders. Do not fabricate a replacement reference runtime or label a partial board as complete mockup proof.

`visual_compare.py` must preserve reference provenance, fail/report incomplete boards, render each real app screen at 1920×1080 and 1440×900, and build a contact sheet. Images are local artifacts, not source-controlled files. Reset/preparation is explicitly opt-in and isolated; never reset existing case data as a fallback for a denied new-server launch.

An already-running isolated QA app on 127.0.0.1:8777 is reachable. Read-only visual/font/network checks there are permitted without starting any new server; these are NOT after-reset acceptance. Its existing case and captured run must remain unchanged. The fresh-instance startup approval barrier remains separate.

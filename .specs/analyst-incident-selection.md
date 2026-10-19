# Analyst works from incidents — accepted implementation scope

Authority: Jake supplied Carmen Zapata's `analyst-incident-selection.md` (October 19, 2026) and authorized normal tests then production release, without a separate visual approval gate. Original requirements remain in the attachment cache; do not treat the prior overnight release report as acceptance for this new work.

## Ordered work

1. Donna: fresh production backup, reviewed add-only port intake dry-run/token apply, confirm 13 alerts (7 water/6 port) and port case creation; preserve every preexisting case/decision/run. The installed source is already present; the new dry run/apply are verified no-op replays. Keep private production backup outside Git.
2. Donna: shared incident-first selection from customer open register/featured default, explicit URL carry-over, newest open case fallback and multiple-case choices; common relative sample clock and live feed timestamp handling; water source timestamp cleanup; C2 earliest asset sector window and C4 consistent time formatting.
3. Actual ThunderCat: only after Donna pushes the tested shared selection, start a new isolated `analyst-incidents-wip` from that exact commit. Own Analyst files/screens, incident chooser, generic alert location labels and ordering. Donna retains shared App/backend/Command/integration/release. No stand-in or production credentials/data transfers.
4. Donna: integrate and independently test, release the exact accepted revision, verify live behavior/auth/storage/history and deliver one combined report with requested A1 no-link-incident, chooser, and port A4 no-case pictures. No separate visual approval hold.

## Acceptance

- Analyst menu defaults to featured incident; chooser lists customer open incidents with ID/title/severity and Case open/No case yet; closed incidents stay C6.
- Port/water/third fixture before and after case: A1 contextual alerts first, A2 model assets/dependencies, A3 cyber evidence, A4 labeled preliminary with review/capture guidance; A5/A6/Case File truthful no-case messages/link to A1, Entity Profile main-store record. Saved case behavior preserved.
- Most recent open case by default; preserve valid explicit case and offer small chooser for multiple open cases.
- Selection round-trips Analyst/Command via shared helper, including reload/back/forward; generic application logic with no fixture IDs/names.
- All sample alerts resolve relative hours against persisted sample anchor; live feeds retain real timestamps; newest first globally, selected incident first; seenOn to nearest named site/facility, Location not recorded fallback.
- C2 water Healthcare earliest window1–4h consistent with C4 By sector; same generic rule for all incidents. C2/C4/Analyst time format HH:mm and configured zone.
- Complete click-based link matrix across every screen, water/port/third-customer, before/after case; new chooser included. Third customer never appears in TXCC. Tests/TypeScript/backend pass; no weakened/deleted purposes.
- No GET writes, destructive production reset, historical rewrites, secret output, unrelated agent/config changes, or fabricated acceptance. Every sample-data change, backup/dry/apply UTC times, commits and deployment identity reported.

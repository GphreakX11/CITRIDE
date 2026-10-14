# TXCC-inspired command workspace — requirements

## Source and scope

Reference: supplied `CITRIDE_TXCC_Demo_v7_2.html`. Its S1–S8 navigation appears at source lines 491–513; the dark palette is defined at lines 8–15. The HTML is a scripted exercise/mockup, not proof of operational services. Source binaries, scripted identities, locations, GO statuses and official performance values are not copied into app data.

The user authorizes an app implementation inspired by feasible features, not a new deployment, paid service, remote integration, or wholesale transplant. This increment remains local until publication is separately approved.

## Functional requirements

1. Make a dark command overview the entry point. Provide accessible eight-role navigation while retaining existing model, ontology, evidence and scenario tools under a discoverable tools group.
2. Track incidents created explicitly from existing event records. Persist title, user-assigned triage priority, captured event/context, model revision, workflow status, tasks, coordination notes and activity. Empty workflow queues are truly empty; seed alerts do not automatically become incidents.
3. Reuse existing durable RDF/file/Postgres adapters with single-transaction operations. No baseline edits or storage migrations are required. Create/action request IDs prevent duplicate records or analyses, and optimistic case/model revisions reject stale actions.
4. Run consequence analysis only after confirmation and only for an explicitly event-linked scenario. Atomically store immutable run evidence and derived advisory review records. Probes B/C cannot activate A's unsafe-water scenario; geography alone cannot create a consequence.
5. Record task completion, local coordination notes and advisory reviews. Reviews require a note. Formal authority and G1–G5 policy evaluation remain unconfigured; there is no approve, dispatch or send-notification operation.
6. Allow closure only after required tasks and reviews are complete, with a closure note. Closure changes case tracking only, not source-event disposition or observed physical recovery. Reopening is explicit and versioned.
7. Service-area COP and cyber screens use the actual model inventory/events. Reference coordinates must not be plotted as verified Texas geography. Leadership measures are derived from casework timestamps/counts, not fabricated compromise or notification metrics. Organization/handoff views expose inventory and local briefing export without pretending federation connections exist.
8. Preserve raw source metadata, IDs, captured historical evidence, authentication and original scenario behavior. Unavailable data remains unknown; professional aliases apply only to known reference/engine copy.

## Acceptance criteria

- Create A case → confirm conditional analysis → exactly three sourced review records with X 2–4h, Y 4–8h, Z 1–4h; no inferred fire-flow loss.
- Complete tasks, save coordination note, record all reviews, and close/reopen using actual persisted records. Reload and fresh repository instances retain changes.
- Repeated same request ID creates no duplicate case/run; changed payload reuse and stale versions conflict. Concurrent database writers do not overwrite each other.
- B/C case has no matching physical-effect scenario. Source baseline/revision and preexisting immutable runs stay unchanged.
- Network-uncertain writes block additional mutations; explicit recheck/retry uses the same saved request ID. Do not auto-replay a POST.
- Desktop and phone navigation, populated queues, confirmation/cancellation, task/review controls, export, error recovery and all retained expert tools work with no document overflow or page exceptions.
- Backend, real isolated Postgres, Node tests, TypeScript/build, formatting, generator consistency and diff/secret checks pass.

# Billington feedback: command/analyst split

## Source and scope
- PM package: `Billington_Beta_Spec (1).zip`; inspected HANDOFF, review notes, requirements, design, feature map, tasks, verification plan, and mockup catalog.
- Main request: two modes over one app/data model, not a replacement application.
- Preserve existing React/FastAPI, RDF/file/PostgreSQL adapters, engine, auth, history, offline PCAP and IDT reference work, and eight advanced tools.
- Keep existing architecture/hosting; AWS/public-access migration is deferred under Jake's standing direction. No push/deploy/production writes in this task.
- Existing uncommitted changes were backed up outside the repo before integration.

## Delivery slice
Priority is the handoff's first milestone: command/analyst separation and feedback behavior/discoverability fixes. This does not represent delivery of the entire four-week roadmap.

### Implemented
- Mode-specific C1-C7 and A1-A6 navigation, Command Center default, analyst-only remembered Advanced disclosure.
- URL includes mode/view/case/entity, browser Back/Forward and refresh; selection preserved between modes.
- Read-only command presentations and incident summary; all work explicitly opens Analyst mode.
- Shared saved cases drive both modes. No second case store and no invented incidents, team roster, official decisions or partner delivery.
- Analyst queue filters, evidence selection/search/source filters, dedicated Case File and Entity Profile.
- Case sections: Context, Cyber, Consequences, Decisions, Response, Coordination, History, Advanced; editable forms remain mounted while switching sections.
- Retain case focus when selecting/clearing entities; clearing the case preserves entity focus. URL persists explicit clears.
- Reference origin/CT last-update status, focus refresh, 15-second command refresh in reference mode, stale read error with retry.
- Stale Stage/Promote recoverable with preserved fields, reload/re-stage, fresh validation; no automatic promote.
- Model-impact orange legend, explicit destructive what-if warning/confirmation, full telemetry JSON download beside capped 200-row preview. Existing `.nq` RDF filename retained.

### Deferred / not represented as complete
- R3/R6: versioned scripted incident/team/partner/hunt/assessment fixtures and editable team-status workflow. Current views use existing real saved casework and explicitly show unknown/unavailable records.
- R4 roadmap expansion: genuine multi-sector statewide inventory and operational geography. Current map is illustrative reference topology.
- R7/R8: expanded Billington telecom/jail/brewery/kidney/sprinkler package and fully rehearsed narrative. Retain current supplied capture/reference case without asserting provenance it lacks.
- R9: dedicated persistent ontology proposal library/save/evaluate workflow beyond existing staged dependency proposals and retained reasoning/ontology screens.
- R10: public HTTPS/access/deployment decisions; no hosting or auth changes.
- Actor, campaign, intent, capability and official actions are not synthesized from packet observations.

## Acceptance
Run frontend test/type/build/format checks, full backend preservation tests, and real Chromium desktop/393px browser exercises against an isolated new QA state directory. Record exact results and screenshots in `.hermes/cache/citride-verification/pm-feedback-oct15` and add a verification receipt here after execution. Do not conflate local implementation with deployment or PM acceptance.

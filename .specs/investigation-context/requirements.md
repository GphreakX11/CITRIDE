# Shared investigation context and understandable relationships

## Scope
Implement recommendations 2 and 3: carry entity/linked saved case across map, evidence, impacts, tasks and expert tools; retain map viewport and filters; describe saved relationships in ordinary language with directional exploration.

## Requirements
- One parent-owned selected entity and selected case; never display an unrelated case as linked to the selected entity. Match only explicit captured case context, dependent endpoints, and decisions; location alone does not imply linkage.
- Persistent context bar with entity, linked-case selector, Map / Evidence / Service impacts / Tasks shortcuts and Back to map.
- Switching case keeps the entity when linked; otherwise select the captured provider or explicit case asset. Selecting an entity chooses a matching case deterministically or clears an unrelated selection. No matching case shows an honest empty state, not another investigation.
- Map selection, zoom, center, search, area, focus and direction survive screen navigation. Session state only; no secrets or private records in Web Storage.
- Evidence highlights the selected saved case event without hiding other source records. Impact and task screens use that same selected case, not arbitrary scenarios.
- Plain-language summary derived from actual explicit directed service dependencies; count unique endpoint entities, not edges. Direction controls separate direct suppliers/dependents from ownership, hosting and location links.
- Context links are secondary and opt-in. Preserve evidence references and conditional timing/backup details. No geography-inferred dependencies, invented outage, dispatch, approval or live OT connectivity.

## Non-goals
No navigation redesign, guided case workflow, database/model/API/auth/config changes, data seeding, or operational action.

## Acceptance
Unit tests cover explicit linkage/exclusions, deterministic selection, unique dependency counts and direction isolation. Read-only real-API desktop/393px phone QA proves map→evidence→impacts→tasks→map maintains entity/case/viewport, selecting another utility clears unrelated context, and no-case assets show no invented dependency. Full frontend/backend gates plus exact-SHA live deployment/auth/state fingerprint checks.

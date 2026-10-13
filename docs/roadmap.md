# Delivery roadmap

## First increment: relationships and modeled consequences

- Reproducible fictional inventory, operational dependencies, assessment findings, curated events, and raw synthetic telemetry.
- Analyst-created relationships with sources, typed endpoints, service/loss applicability, delay/backup ranges, and staged validation/promotion.
- RDF baseline, staging, and immutable scenario-run persistence.
- Interactive dependency view, source explanations, scenario selection, what-if overrides, and saved-run comparison.
- Deterministic loss-specific cascade logic and meaningful negative controls.

The local demonstration is distinct from the broader hosted Watershed beta. Cyclic and redundant supply systems that cannot be resolved by the current engine must remain visibly uncertain.

## Subsequent increments

1. **Formal graph alignment:** verify and pin ontology sources/licenses, IDT taxonomy version, CCO anchors and imported terms; load the agreed water/healthcare hierarchy and validate mappings. Provisional model terms must not be presented as completed official IDT-OWL.
2. **Decisions:** verify response-option and authority sources; draft sourced cards, enforce source/handling checks, require an authorized human action, and persist append-only records before considering the action complete. No authority citation is invented.
3. **Hosted environment:** confirm account, region, service access and identity; provision private networking, provisioned Neptune, ECS, S3/Delta audit, and logging through reviewed infrastructure code. Exercise the same API/storage contracts against Neptune before claiming portability.
4. **Ingestion:** normalize raw archive data into curated events, correlate configured evidence rules, and connect a typed event bus. Retain raw telemetry outside the graph.
5. **Public reference data:** import appropriately licensed public water boundaries and facility catalogs with snapshot provenance. Spatial matching proposes exposure and candidate links, not a verified operational connection.
6. **Narrative assistance:** add an approved model gateway after deterministic facts/options are usable. Treat model outputs as plain text, require source validation, and retain human decision control.

## Acceptance targets

The first workflow must demonstrate why unsafe water activates safe-water dependencies but not pressure-only fire flow; why B/C probing creates incident context without inventing outages; how a clean-reserve change shifts a modeled window; and how a baseline revision can be promoted without altering an earlier run's source trail. Missing assumptions, incompatible backup, unsupported supply groups, and cyclic uncertainty must be visible.

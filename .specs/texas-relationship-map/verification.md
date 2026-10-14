# Verification

## Release candidate
- `cd frontend && npm test`: 44 passed, 0 failed.
- `npm run format:check`: passed after final formatting.
- `npm run build`: TypeScript and production Vite build passed. Existing large-chunk advisory remains nonfatal; no dependency changes are included.
- Read-only staged local-assets + real production-API acceptance: passed at desktop 1600x1000 and phone viewport 393x852.
- Graph matches every persisted directed dependency; Facility Q has no invented service link.
- Actual SVG label/marker clicks and clicks after zoom, inspector upstream/PLC/cyber traversal, keyboard selection, search/no-match reset, area filter, neighborhood focus, context-link toggle, zoom, drag/pan and reset passed.
- Expert graph opens with the selected entity retained. All eight command views have one h1 and no document overflow.
- Zero attempted API writes, browser exceptions or HTTP failures. Canonical fingerprints match for bootstrap, telemetry, proposals, ontology, retained runs and incidents.
- Static boundary test confirms all reference infrastructure display centers are inside Texas. Actual source geography remains distinct from illustrative placements.

## Production publication gates
Jake authorized production publication after the candidate handoff. Use the existing GitHub-backed production branch and owner project; no credential, environment, database or model changes are part of this release.

After release, require exact-commit READY deployment/current production alias, GitHub CI, anonymous/wrong-login rejection, valid login and health, unchanged six protected-resource fingerprints and deployment environment. Rerun the same browser matrix with live assets and API (no local asset fulfillment). Keep metadata-only results and screenshots outside Git under the owner-controlled local verification cache; never commit login or database material.

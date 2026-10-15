# Design

Package one versioned canonical redacted manifest in `backend/citride/reference_data/`. `reference_investigations.py` supplies its event and detached case-local context. Existing `CommandService.create` resolves the reserved reference event without editing the baseline. Existing snapshots carry the immutable manifest in `eventSnapshot.referenceInvestigation`; no storage migration or new public case fields. Validation requires the canonical captured manifest and reference-only context, no run/decisions, and exactly the manifest's task labels. Regular cases retain the existing three-task contract.

A fixed reference-event summary supplies the source picker; the backend resolves it to the canonical versioned manifest. No extra API route or bootstrap mutation is needed. The UI uses typed manifest guards and a case-local evidence component shared by casework and the Evidence tool. It does not project report hosts into the Texas model.

Verification: schema/content tests; authenticated HTTP tests; save/restart/fingerprint tests; existing full gates; local real-API desktop/mobile Playwright acceptance. Keep artifacts local and gate publishing separately.

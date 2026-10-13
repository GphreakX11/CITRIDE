# OWL capability contract

Add formal OWL 2 RL entailment to the existing local synthetic demo. This is a small, versioned, locally authored ontology, not a claim of imported BFO/CCO/IDT conformance or complete OWL 2 DL reasoning. The existing consequence engine continues to calculate service losses and timing from approved Dependency records; OWL supplies structural and dependency context, not physical predictions.

## Ontology / engine interface

`backend/citride/ontology/watershed.ttl` ships with the Python package. Namespace remains `urn:citride:` and record IRIs follow `urn:citride:record:` + quote(id, safe='._-:') to match persisted RDF. Ontology labels/definitions and owl:versionInfo are required. Pin the ontology SHA-256 and owlrl engine version in each inference run.

Use the real `owlrl.DeductiveClosure(OWLRL_Semantics)` implementation. Suggested working axioms: transitive `partOf`; inverse `hostsCyberAsset`/`hostedBy`; explicit class hierarchy; dependency inverses `provider`/`providesThrough` and `dependent`/`receivesThrough`; `dependsOn` property chain (receivesThrough provider); `providesTo` inverse dependsOn; cyber `associatedWithFacility` chain (hostedBy partOf); event `seenAtFacility` chain (seenOn associatedWithFacility); operator context through associatedWithFacility/seenAtFacility + operatedBy. All inferred dependencies come only from approved Dependency records. Do not infer dependency from locatedIn, serves, probes or shared attacker infrastructure. Do not declare dependsOn transitive; service/loss qualifiers live on Dependency records.

Exact inference primitive: `compute_inference(data: dict, run_id: str) -> dict`. Input is an immutable baseline snapshot; do not mutate it. Build an explicit OWL input projection from promoted baseline entities, event seenOn relations, service functions, and dependency provider/dependent endpoints; omit raw telemetry, staging, numerical timing inputs, and old run graphs. Ontology loading has no remote imports/network fetch. Reject unsupported ontology imports or rule forms rather than claiming completeness. Use meaningful negative controls and report semantic inconsistencies separately from SHACL validation.

Return: `id`, `baselineRevision`, `createdAt` (API stamps), `profile: 'OWL 2 RL'`, `engine: {name:'owlrl',version}`, `ontology: {id,version,sha256,axioms:[{id,label,description}]}`, `baselineSnapshot`, `assertedFacts`, `inferredFacts`, `warnings`, `limitations`, `diagnostics`, `statistics`. Actual warnings and static scope limitations are separate. Every public fact has `id` (stable within snapshot), `subject: {id,iri,label}`, `predicate: {iri,label}`, `object: {id,iri,label}`, `status: 'asserted'|'inferred'`, `sourceRefs`, `axiomIds`, and `premiseFactIds`. Only publish useful triples over known record subjects/objects and model predicates/classes; filter reflexive sameAs, generic built-in/axiomatic/datatype closure noise. Statistics explain that displayed facts are a selected useful projection, not all OWL closure triples.

Facts backed by inference have an acyclic replayable witness using declared source facts and named ontology axioms. owlrl does not supply proofs; annotate the published inference with a separate witness builder for supported axiom forms, and say so. Do not fabricate a proof for a derived fact that the witness builder cannot substantiate; hide/report untraced conclusions. Premises and source IDs resolve within the captured run. At least partOf transitivity, inverse, class hierarchy and length-2 property chains need tested witnesses.

## API/storage

- `GET /v1/ontology`: ontology metadata, supported profile, axioms, engine version (no computation required).
- `POST /v1/inference-runs`: optional body `{expectedBaselineRevision: integer}` or `{}`; capture only promoted baseline, reject stale expected revision 409, perform inference, save immutable run in distinct inference named graph. No arbitrary triples/ontology/queries supplied by browser.
- `GET /v1/inference-runs`: `{runs:[{id,createdAt,baselineRevision,ontologyVersion,inferredCount}]}`.
- `GET /v1/inference-runs/{id}`: captured run, plus `stale` compared with current baseline revision AND current ontology hash (old run contents not rewritten).
- `GET /v1/inference-runs/{id}/facts/{factId}`: `{runId,fact,proofFacts:[...],axioms:[...],sources:[...],baselineRevision}` recursively resolve witness, only same immutable run. Unknown IDs 404, invalid IDs 422.
- RDF export includes ontology named graph and inference run's asserted/inferred triples in separate named graphs, plus JSON snapshot/provenance metadata. Preserve old runs/revisions across edits and restarts. Existing state files remain usable with no destructive reset.

Examples that must work: PLC A partOf Plant A plus Plant A partOf Utility A implies PLC A partOf Utility A; Cyber PLC A hostedBy PLC A implies inverse hostsCyberAsset if missing; event-dosing seenOn cyber-plc-a plus hosting/partOf implies event seenAtFacility Utility A; dependency dep-a-x provider Utility A and dependent Dialysis X implies Dialysis X dependsOn Utility A. Baseline Facility Q has no inferred dependsOn; promoted user link to Q enables it only in a new inference run. B/C probe events associate to their facilities without asserting unsafe water or any state.

## UI

Add an 'Ontology reasoning' view with Run OWL inference, profile/engine/ontology version, current captured revision and stale indicators, asserted/inferred fact filtering, readable relation rows and a selectable proof/source trail. Show that physical impact/timing still comes from the cascade model. Pending/error/loading states, keyboard-native controls, no HTML execution. API-inferred facts never silently mutate/promote baseline data.

## Ownership

Core agent: ontology + reasoning.py + pyproject/uv.lock. API agent: storage/api + API/storage inference tests. UI agent: frontend reasoning view integration and types. Root: independent reasoner tests, docs, integration, verification, commit/push. No agents commit or push.

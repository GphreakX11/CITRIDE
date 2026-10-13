# Formal OWL reasoning in the demo

The demo uses `owlrl` to compute OWL 2 RL entailments. It is a separate operation from SHACL validation and from service-consequence calculations.

## What the reasoner derives

| Declared premises | Ontology rule | Derived context |
| --- | --- | --- |
| PLC A partOf Plant A; Plant A partOf Utility A | Transitive property | PLC A partOf Utility A |
| Equipment hosts a cyber identity | Inverse object property | Cyber identity hostedBy equipment |
| Cyber identity hostedBy equipment; equipment partOf facility | Property chain | Cyber identity associatedWithFacility facility |
| Event seenOn cyber identity; identity associatedWithFacility facility | Property chain | Event seenAtFacility facility |
| Dependency has provider and dependent endpoints | Inverse/chain axioms | Dependent dependsOn provider; provider providesTo dependent |
| A record belongs to a specific local asset/facility class | Subclass axioms | Membership in more general infrastructure classes |

Property chains and transitivity can combine. For example, an event on a controller can be associated with both its treatment plant and its utility through the containment hierarchy. Qualified Dependency records remain the authoritative inputs to the impact engine; an inferred navigation edge does not replace their service, loss-mode, backup, or timing assumptions. `dependsOn` is deliberately not transitive.

## Evidence and history

An inference run captures the approved baseline revision and source records, the ontology text and SHA-256 hash, the reasoning profile and library version, asserted facts, useful inferred facts, and a proof witness. The reasoner processes only the structural/dependency projection, excluding raw telemetry and unpromoted proposals.

The library performs entailment. A separate witness annotator reconstructs an acyclic derivation for supported, named axiom forms and verifies that it corresponds to a library-derived fact. The API exposes those premises and axioms for inspection. Untraced useful conclusions are reported rather than given fabricated explanations. An inconsistency reported by the OWL RL engine blocks a successful inference run; this does not imply full OWL 2 DL consistency checking.

Inference is not promotion. Inferred outputs are persisted in their own named graphs and do not change the approved baseline. The selected run remains immutable across later relationship edits. The API marks it stale if the baseline revision or ontology hash has changed. Loading an old run explains its captured facts and ontology, rather than current facts.

## API

* `GET /v1/ontology`: profile, ontology metadata/axioms, and library version.
* `POST /v1/inference-runs`: create a run using the current baseline; optional `expectedBaselineRevision` rejects stale requests.
* `GET /v1/inference-runs`: saved-run summaries.
* `GET /v1/inference-runs/{id}`: the captured result and its current stale indicator.
* `GET /v1/inference-runs/{id}/facts/{factId}`: selected fact, recursive premises, ontology axioms, and captured sources.
* `GET /v1/graph/export`: baseline, captured ontology, asserted inputs, inferred conclusions, and proof metadata in RDF named graphs.

Clients cannot upload ontology code, arbitrary RDF, or SPARQL through these endpoints. Future ontology versions require code review and entailment tests. No remote imports are resolved during inference.

## Limits

The local ontology is a deliberately small infrastructure slice. Published ontologies and official taxonomy alignment remain separate integration work requiring verified sources, licenses, mappings, and tests. OWL follows an open-world model: absence of an inferred link means it was not established, not that the dependency is impossible. Class/domain/range inferences describe the configured model; they do not verify the real world.

There are no axioms that infer supply from geographic containment, cyber compromise from probing, or physical loss from a controller event. Effects and timings remain explicit scenario assumptions and deterministic consequence calculations. Formal classification does not turn a planning estimate into an observation.

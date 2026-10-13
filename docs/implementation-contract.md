# First-slice implementation contract

This is a local, single-customer, fully synthetic Watershed demonstration. No cloud deployment, real utility connection, identity boundary, official ontology conformance, or authority approval is implied.

## Data

`data/scenario.json` holds entities, serviceFunctions, dependencies, sources, assumptions, events, assessments, scenarios, defaultScenarioId. Entities use `id`, `type`, `label`, optional `partOf`, `operatedBy`, `serves`, `locatedIn`, `hostsCyberAsset`, `hostedBy`, `terrain`, `geometry`, and `sourceRefs`. All carry SIMULATED handling. Long-lived IDs are fixed and references must resolve.

Dependency fields: `id`, `revision`, `provider`, `dependent`, `requiredService`, `dependentFunction`, `dependencyType`, `coupling`, `lossTypes`, `propagationDelayMinHours`, `propagationDelayMaxHours`, nullable `usableBackupMinHours`/`usableBackupMaxHours`, `validForLossTypes`, `lossOfFunction`, nullable `outputLossType`, `sourceRefs`, `assumptionNote`, `classification`, `handling`. Required source and assumption text, ordered nonnegative windows, loss fraction [0,1], exactly one provider/dependent. Provider/dependent are physical facilities/service nodes. Function must belong to dependent.

Each configured scenario has `id`, `label`, `description`, `seed: {provider, service, lossType, windowHours, persistsThroughHour, eventRefs, sourceRefs}`. Initial scenarios: `unsafe-water`, `low-pressure`, `power-loss`. Defaults: evaluation hour 1; horizon 12. All effects are scenario assumptions, not observed operational effects. Telemetry files under `data/telemetry` carry raw synthetic input and are returned by an API; raw rows stay outside RDF.

## API

- `GET /health`: `{status: "ok", baselineRevision, demoMode: true}`.
- `GET /v1/bootstrap`: all data fields above plus baselineRevision (integer) and modelVersion.
- `GET /v1/telemetry`: `{streams: [{id, label, sourceRef, records: [...]}]}`.
- `POST /v1/dependency-proposals`: `{dependency: <full dependency>, expectedBaselineRevision: <integer>}`. Returns `{id, status: "draft", dependency, expectedBaselineRevision}`. For editing, preserve dependency id and derive next revision on promotion. New links use a distinct id.
- `GET /v1/dependency-proposals`: `{proposals: [...]}`; detail `/.../{id}`.
- `POST /v1/dependency-proposals/{id}/validate`: `{id, status: "validated" | "needs_review", valid, errors: [string]}`; domain errors are returned as validation outcomes, not hidden crashes.
- `POST /v1/dependency-proposals/{id}/promote`: checks validation, graph revision, and references again; returns `{id, status: "promoted", baselineRevision, dependency}`. Stale baseline returns HTTP 409. Model edits are local-demo only; authenticated RBAC is deferred.
- `POST /v1/cascade-runs`: `{scenarioId, evaluationHour: number = 1, horizonHours: number = 12, overrides: [{dependencyId, backupMinHours, backupMaxHours, note}] = []}`. Uses only configured scenario seeds, immutable baseline snapshot, finite numbers/ranges, and source-labeled what-if overrides.
- `GET /v1/cascade-runs`: `{runs: [{id, createdAt, scenarioId, baselineRevision}]}`; detail `/.../{id}` returns full run.
- `GET /v1/cascade-runs/{id}/compare?otherRunId=...`: `{leftRunId, rightRunId, changes:[{entityId,functionId,leftWindowHours,rightWindowHours,leftState,rightState}]}`.
- `GET /v1/explain?runId=...&impactId=...`: exact immutable impact plus seed, dependency snapshots, sources, assumptions, and event evidence.
- `GET /v1/graph/export`: RDF serialization with named graphs (N-Quads).

Error responses have FastAPI's `detail`. No arbitrary SPARQL endpoint. Frontend displays API validation errors, source/assumption context, SIMULATED badges and model limitations.

## Engine boundary and output

`citride.engine.compute_run(data: dict, request: dict, run_id: str) -> dict`. Data includes baselineRevision. The API stamps createdAt and saves the complete result in a run named graph.

Run: `id`, `scenarioId`, `baselineRevision`, `modelVersion`, `request`, `seed`, `impacts`, `excluded`, `warnings`, `baselineSnapshot`.

Impact: `id`, `entityId`, `functionId`, `lossType`, `state` (`at_risk`, `degraded`, `failed`, `unknown`), `evidenceStatus: "modeled"`, `windowHours` ([min,max] or null), `timingStatus` (`before_onset`, `onset_uncertain`, `past_latest_onset`, `unknown`), `lossOfFunction`, `paths` (arrays of dependency IDs), `sourceRefs`, `assumptions` (readable strings). Deduplicate entity/function/loss; retain all valid causal paths. Unknown timing does not mean zero.

Only compatible dependency requiredService and lossTypes activate. Independent backup is credited only when the loss is in validForLossTypes. Provider onset windows accumulate delay + backup across hops. Scenario persistence ends before a link's impact => do not predict an exhausted reserve after recovery. Current and future modeled states are separate from observed evidence. Facilities inside service polygons without dependencies are exposed candidates, not computed failures.

Cycles and multi-supply groups that this first engine cannot resolve return explicit warnings/requires-review; no invented complete solution. Propagation never reverses a directed dependency. Reserve credit cannot recur around a cycle. Return bounded results and identify unsupported input rather than silently treating it as single-supply.

## Boundaries

Engine agent owns engine.py and test_engine.py. API agent owns API/storage/validation and related tests, dependencies. Data agent owns data/ and generator/fixture tests. UI agent owns frontend/. Root owns docs, CI, scripts and integration. Agents must not commit or push; root integrates and pushes only after validation.

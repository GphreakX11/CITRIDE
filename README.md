# CITRIDE — Watershed 250 demo

An interactive, fully synthetic incident-to-impact demonstration. Connect a controller event to its water-service context, inspect operational dependencies, and compare downstream impacts under editable assumptions.

All utilities, facilities, operational links, telemetry, and effect assumptions in this repository are fictional. The application estimates service consequences for a scenario; it does not establish observed facility failures or connect to operational control systems.

## Run locally

Requirements: Python 3.12, Node.js 24, npm, and [uv](https://docs.astral.sh/uv/getting-started/installation/).

```bash
bash scripts/setup.sh
bash scripts/start.sh
```

The API serves the compiled application on port 8000, bound to the local machine. `/health` reports readiness and `/docs` contains the generated OpenAPI interface. No API keys, AWS account, Docker daemon, or commercial software license is required.

For Vercel, the proposed root `vercel.json` configures separate FastAPI and Vite services. Hosted persistence uses Postgres and backend access requires a shared demo password. See [deployment instructions](docs/vercel-deployment.md) for routing, environment settings, and checks; publishing requires a linked Vercel project.

For development, run the API from `backend` with `uv run --locked uvicorn citride.api:app --reload --host 127.0.0.1 --port 8000`. In a separate terminal run `npm run dev --prefix frontend`; Vite proxies API requests to the backend.

## Demonstrate the workflow

1. Inspect the three fictional utilities and the linked cyber incident. Utility A has controller-change and sensor evidence; Utilities B/C have probing evidence only.
2. Run the unsafe-water scenario. Dialysis Center X's treatment window is 2–4 hours; Hospital Y's sterilization-support window is 4–8 hours; Nursing Home Z's safe-water support window is 1–4 hours. These are simulation assumptions, not clinical predictions.
3. Select an impact and inspect its event, dependency path, source trail, and assumptions. Fire flow is not activated by unsafe water alone.
4. Increase X's usable clean reserve from 2 to 6 hours for a what-if run. Its window moves to 6–8 hours. The baseline remains unchanged.
5. Switch to the low-pressure scenario to activate the fire-flow dependency, or the power-loss scenario to demonstrate a multihop service cascade.
6. Create or revise a dependency, validate the proposal, and promote it. Stale baseline revisions are rejected. Earlier run snapshots remain readable.
7. Open **Ontology reasoning** and run **OWL inference**. Inspect the controller-to-utility and event-to-facility relationships derived from the declared facts, then select an inference to see its premises, ontology axioms, and sources. Earlier inference runs retain their captured revision.

## Data and model

`data/scenario.json` supplies the fictional inventory, facilities, service-area geometry, operational dependencies, source/assumption catalog, prior assessment finding, curated incident events, and configured physical-effect seeds. `data/telemetry/` holds raw synthetic network, controller/authentication, sensor, and enterprise records. IDs connect curated evidence back to raw records; raw rows are not loaded into the RDF graph.

The generator is deterministic:

```bash
python scripts/generate_demo_data.py --check  # verify checked-in data
python scripts/generate_demo_data.py          # regenerate the fictional inputs
```

RDF named graphs hold baseline records, staged proposals, and immutable cascade and inference runs. Local persistence defaults to an ignored `.local` directory; `CITRIDE_DATA_DIR` can select a separate local state directory. A configured `CITRIDE_DATABASE_URL` or `DATABASE_URL` selects transactional Postgres persistence, which is required on Vercel. Stop the local API before deliberately deleting its data directory to reset to the checked-in seed. Dependency revisions and graph revision checks protect edits; run comparisons use captured snapshots.

The deterministic engine propagates provider → dependent only through compatible service/loss relationships. It accumulates time windows and usable backup across hops. Missing timing remains unknown. Unsupported supply groups and cycles are surfaced for model review. A geographic overlap, ownership link, or shared attacker does not itself propagate a physical outage.

## OWL reasoning

Formal **OWL 2 RL** entailment runs through the `owlrl` library over a versioned local ontology and a projection of approved RDF facts. It derives transitive containment, inverse hosting, class membership, event-to-facility context, and dependency summaries from explicit dependency records. Declared facts and inferred facts are shown separately, with a replayable witness for each published inference.

The ontology lives in `backend/citride/ontology/watershed.ttl`. Every immutable inference run captures its ontology text/hash/version, engine version, baseline revision, asserted inputs, selected inferred outputs, and proof/source metadata. Baseline edits or ontology changes mark saved runs stale; they do not rewrite historical results. Raw telemetry, draft proposals, and old runs are excluded from reasoning input.

OWL inference supplies structural context. The cascade engine separately calculates modeled loss and timing from sourced service dependencies. A hospital inside a service polygon does not acquire an operational dependency through OWL. A probe event can be associated with a utility without implying compromise, unsafe water, or failure.

This is a locally authored OWL 2 RL slice with supported, explicitly checked axiom forms. It is not a full OWL 2 DL reasoner or verified BFO/CCO/IDT ontology alignment. The useful facts displayed in the UI are a filtered projection of the complete closure; built-in and reflexive identity noise is omitted. The witness annotator explains library-derived facts; `owlrl` itself does not return proof objects. See [reasoning details](docs/owl-reasoning.md).

## Validation

```bash
bash scripts/check.sh
```

Tests cover coherent synthetic inputs, loss-specific activation, interval arithmetic, what-ifs, persistence, unknowns, model limits, relationship validation/promotion, immutable runs, and API behavior. OWL checks exercise actual entailments, source witnesses, negative controls, revision history, and RDF export. The frontend build includes TypeScript checking. GitHub Actions repeats the automated checks.

## Scope of this first increment

This is a single-user synthetic demo. Hosted instances support a shared demo login, with no authenticated multi-customer boundary, operational response authority catalog, human decision/audit workflow, managed Neptune deployment, live ingest pipeline, or AI agent. Hosted backend access requires the configured password; this is not an operational service. Persisted RDF and API contracts are development foundations; they are not verified GovCloud, FedRAMP, IDT-OWL, or imported-ontology conformance.

Next increments are described in [the roadmap](docs/roadmap.md). See [the implementation contract](docs/implementation-contract.md) for data/API details.

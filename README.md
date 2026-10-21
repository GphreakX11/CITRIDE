# CITRIDE — Watershed 250 demo

An interactive, fully synthetic incident-to-impact demonstration. Connect a controller event to its water-service context, inspect operational dependencies, and compare downstream impacts under editable assumptions.

All utilities, facilities, operational links, telemetry, and effect assumptions in this repository are fictional. The application estimates service consequences for a scenario; it does not establish observed facility failures or connect to operational control systems.

## Run locally

Requirements: Python 3.12, Node.js 24, npm, and [uv](https://docs.astral.sh/uv/getting-started/installation/) 0.13.4 or newer.

```bash
bash scripts/setup.sh
bash scripts/start.sh
```

The API serves the compiled application on port 8000, bound to the local machine. `/health` reports readiness and `/docs` contains the generated OpenAPI interface. No API keys, AWS account, Docker daemon, or commercial software license is required.

For Vercel, the proposed root `vercel.json` configures separate FastAPI and Vite services. Hosted persistence uses Postgres and backend access requires a shared demo password. See [deployment instructions](docs/vercel-deployment.md) for routing, environment settings, and checks; publishing requires a linked Vercel project.

The demo username defaults to `demo`. Set `CITRIDE_DEMO_PASSWORD` in the existing Vercel project's backend environment, then redeploy. Your Google sign-in to the Vercel dashboard is separate from the demo login; no default password is committed to the repository.

For development, run the API from `backend` with `uv run --locked uvicorn citride.api:app --reload --host 127.0.0.1 --port 8000`. In a separate terminal run `npm run dev --prefix frontend`; Vite proxies API requests to the backend. Keep both listeners loopback-only. The existing Vite proxy preserves the browser's Host header: use the frontend's own relative `/v1` URLs, not cross-port direct API requests or `changeOrigin: true`.

### Dependency installation and CA trust

The October 2026 emSign CA incident affects older bundled certificate stores. Setup rejects uv older than 0.13.4 before dependency downloads, and the Python lockfile selects certifi 2026.10.19. CI pins uv 0.13.4. Recheck current maintainer advisories before rebuilding; version pins and a successful test run are not a vulnerability-free certification.

`scripts/setup.sh` obtains a fingerprint-checked CA bundle from the synchronized project certifi package and passes it explicitly to `npm ci` with strict TLS and dependency lifecycle scripts disabled. This replaces npm's default CA list for that command; merely adding an extra CA would not remove the compromised root. The explicit application build still runs. Node 24.19.0's bundled store was independently found to contain the affected root; this scoped npm mitigation does not repair other Node clients or the host trust store. Do not disable TLS verification or use an unreviewed CA override to bypass setup failures.

The Docker bootstrap removes only the compromised emSign ECC Root CA - G3 fingerprint from its own system and old-installer stores before its first package download, then installs pip 26.2.2 and uv 0.13.4 and verifies the updated installer store. The helper's mutating `bootstrap` mode and image `verify` mode require Linux root, an explicit container-build flag, and the image's `/app/backend/pyproject.toml` marker. Do not run those image modes against a host. No host/system/global CA settings are changed by this repository workflow; provider-managed build/runtime trust, custom overrides, and live deployment TLS require separate review.

### Access boundary

Passwordless development is only for a trusted local machine with loopback-only listeners; the application does not enforce the listener binding. Before exposing any backend through Docker, a LAN listener, or a reverse proxy, set `CITRIDE_REQUIRE_AUTH=1`, configure a unique nonblank `CITRIDE_DEMO_PASSWORD`, and provide HTTPS at a trusted ingress. The flag accepts only the exact values `1`/`true` (required) and `0`/`false` (optional); omission keeps the local optional default. Empty, padded, uppercase, or other values fail closed with HTTP 503 even if a password is set. Vercel always requires authentication and cannot be opted out with this flag. A configured nonblank password enables login even in optional mode; there is no built-in/fallback password. Whitespace-only passwords are unconfigured; nonblank username/password bytes are preserved, not trimmed. The username defaults to `demo`; an explicitly blank username or one containing `:` is invalid.

Unsafe browser requests must have a well-formed same-origin Origin, independently of whether login is enabled. Null, foreign, malformed, and duplicate origins are rejected before body parsing or state access; a `Sec-Fetch-Site: cross-site` signal also rejects browser writes with no Origin. Origin-less CLI calls remain supported. Origin, Host, Fetch Metadata, and forwarded headers are not authentication, and no wildcard CORS is enabled. Proxies must preserve a validated public Host and scheme (Vercel production requires HTTPS); arbitrary `X-Forwarded-*` headers do not override the application origin comparison. No trusted-host allowlist/DNS-rebinding defense is implemented: same-origin comparison alone does not establish hostname trust, and local processes or clients that omit/spoof browser headers are outside this defense. Do not expose passwordless mode through an untrusted hostname, tunnel, or network interface.

The shared Basic login has no per-person roles, tenant boundary, login rate limit, or expiring application session. Basic credentials require TLS outside trusted loopback. Rotate the shared password through backend deployment settings whenever access changes or exposure is suspected, redeploy/restart every serving instance, and have reviewers clear cached browser credentials and sign in again; do not place passwords in URLs, frontend variables, source, or reports. Old credentials remain valid on any instance not updated.

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

## Document-aligned views

**Ontology blueprint** translates the supplied standards guide and landscape diagram into foundation, domain, bridge, validation, and exchange layers. Runtime metadata identifies the actual local ontology; external standard imports and the AWS target remain explicitly planned.

**Incident → decision** retrieves explicit event/asset/facility/service-area/dependency context through `/v1/incident-context?eventId=...`. Matching scenarios are linked by seed evidence references, not inferred merely from alert presence. Advisory decision reviews use captured cascade snapshots and source trails. No authority approval or formal G1–G5 evaluation is claimed, and no operational action is dispatched.

See [the document-alignment contract](.specs/document-alignment.md) for reviewed sources, scope, and acceptance criteria. No source-document binary or credential is included in the repository.

## OWL reasoning

Formal **OWL 2 RL** entailment runs through the `owlrl` library over a versioned local ontology and a projection of approved RDF facts. It derives transitive containment, inverse hosting, class membership, event-to-facility context, and dependency summaries from explicit dependency records. Declared facts and inferred facts are shown separately, with a replayable witness for each published inference.

The ontology lives in `backend/citride/ontology/watershed.ttl`. Every immutable inference run captures its ontology text/hash/version, engine version, baseline revision, asserted inputs, selected inferred outputs, and proof/source metadata. Baseline edits or ontology changes mark saved runs stale; they do not rewrite historical results. Raw telemetry, draft proposals, and old runs are excluded from reasoning input.

OWL inference supplies structural context. The cascade engine separately calculates modeled loss and timing from sourced service dependencies. A hospital inside a service polygon does not acquire an operational dependency through OWL. A probe event can be associated with a utility without implying compromise, unsafe water, or failure.

This is a locally authored OWL 2 RL slice with supported, explicitly checked axiom forms. It is not a full OWL 2 DL reasoner or verified BFO/CCO/IDT ontology alignment. The useful facts displayed in the UI are a filtered projection of the complete closure; built-in and reflexive identity noise is omitted. The witness annotator explains library-derived facts; `owlrl` itself does not return proof objects. See [reasoning details](docs/owl-reasoning.md).

## Validation

```bash
bash scripts/check.sh
```

Tests cover coherent synthetic inputs, loss-specific activation, interval arithmetic, what-ifs, persistence, unknowns, model limits, relationship validation/promotion, immutable runs, and API behavior. OWL checks test actual entailments, source witnesses, negative controls, revision history, and RDF export. The frontend build includes TypeScript checking. GitHub Actions repeats the automated checks.

## Scope of this first increment

This is a single-user synthetic demo. Hosted instances support a shared demo login, with no authenticated multi-customer boundary, operational response authority catalog, human decision/audit workflow, managed Neptune deployment, live ingest pipeline, or AI agent. Hosted backend access requires the configured password; this is not an operational service. Persisted RDF and API contracts are development foundations; they are not verified GovCloud, FedRAMP, IDT-OWL, or imported-ontology conformance.

Resource budgets remain a product/deployment decision: drafts, proposals, and immutable cascade/inference history can grow cumulatively, and reasoning plus whole-graph persistence can consume shared compute/memory/storage. Authentication and origin checks do not supply retention, request-byte/depth, rate, concurrency, or compute budgets. No arbitrary quotas or silent history purges are introduced; agree retention/archival, backups, and safe admission/edge controls before broader exposure.

Next increments are described in [the roadmap](docs/roadmap.md). See [the implementation contract](docs/implementation-contract.md) for data/API details.

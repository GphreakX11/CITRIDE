# Vercel services deployment

The proposed project contains two services: `backend` (FastAPI, root `backend`) and `frontend` (Vite, root `frontend`). Configure the Vercel project at the repository root so that it reads the top-level `vercel.json`. Confirm the service names and public routes before publishing.

## Routing and bindings

The public `/v1` and `/v1/*` paths, `/health`, `/docs` and `/docs/*`, and `/openapi.json` route to the backend. All remaining paths route to the frontend. Preserve these paths when forwarding requests: the backend declares `/v1/*` routes and the browser uses relative `/v1/*` URLs. Mounting it at `/api/*` without changing both sides would break the application.

There are no service bindings. This frontend is a static React application, not a server function that calls another service. Its browser requests use the public, same-origin backend routes. An internal URL cannot be injected into browser runtime through a service binding, and it must not be baked into a `VITE_*` variable. A future frontend server function that calls an internal service would need a binding declared on that calling service.

The local Vite proxy to `127.0.0.1:8000` remains a development convenience. It is not the production backend address. Keep Vite and the API loopback-only. The checked-in string proxy preserves the frontend Host (including its port), so the frontend's relative `/v1` writes match its Origin without an extra-origin allowlist. Do not change it to rewrite Host with `changeOrigin: true`, use direct cross-port browser API URLs, or add wildcard CORS to work around origin failures.

## Backend environment settings

Set these in Vercel's environment settings; never commit their values:

| Variable | Purpose |
| --- | --- |
| `CITRIDE_DATABASE_URL` or `DATABASE_URL` | Postgres connection string; use the provider's pooled connection and required TLS settings. |
| `CITRIDE_DEMO_PASSWORD` | Shared demo password, required on Vercel. |
| `CITRIDE_DEMO_USERNAME` | Optional shared username; defaults to `demo`. |
| `CITRIDE_REQUIRE_AUTH` | Exact `1`/`true` requires login outside Vercel; `0`/`false` or omission keeps local auth optional. Invalid values fail closed even with a password configured. Vercel always requires login regardless of this flag. |
| `CITRIDE_STATE_KEY` | Optional durable state identity within this database. |
| `CITRIDE_IDT_LOAD_MODE` | Optional `assigned_closure` (default) or explicit `full` diagnostic mode. The measured five-second gate selects assigned closure; complete source validation/hash and lookup data are retained. |

The database role must be able to create and read/write the `citride_state` table. Each state occupies one row containing the RDF dataset. Transactions, transaction-scoped advisory locks, and row locks protect the complete read/modify/write operation across independent function instances. Prepared statements are disabled for compatibility with transaction poolers.

Seed initialization occurs once when the selected state is absent. Existing baselines, proposals, sources, and run history are retained on redeployment. The default hosted state key is `citride-production`, `citride-preview`, or `citride-development`, according to Vercel's `VERCEL_ENV`. Set an explicit key or use separate databases when individual preview branches need isolated state. Never run destructive or model-editing acceptance tests against an existing production state.

Vercel requests fail closed when the demo password or database connection is missing. They do not fall back to an ephemeral local file. Missing or whitespace-only passwords are unconfigured; preserve the exact bytes of nonblank credentials, including leading/trailing whitespace. An explicitly blank username or one containing `:` is invalid; omission defaults to `demo`. Local development retains file storage unless a database URL is explicitly configured; an explicit `data_dir` passed to the application factory selects local storage for tests, not a bypass for required authentication.

## Demo access

The frontend shell is publicly routable. Backend requests, including graph export, API documentation, and health, require the shared demo login. The UI shows **Sign in** when a model request receives HTTP 401. The link opens `/v1/login`, where the browser prompts for the username and password, then returns to the frontend. Credentials are not stored in JavaScript or bundled into frontend assets. Protected responses use `private, no-store` and vary by authorization. Browser model changes must come from the same origin.

This is a shared demo login, not a multi-customer authentication or audit system. It has no per-person roles, individual attribution, expiring application sessions, or application login rate limit. Basic credentials need HTTPS outside trusted loopback; verify the ingress/TLS and published ports independently. Vercel project-level deployment protection can additionally restrict the frontend shell where the account supports it. For any non-Vercel network-facing deployment require `CITRIDE_REQUIRE_AUTH=1` and a unique password; never use passwordless local mode behind a public proxy, tunnel, or LAN listener.

Origin checks apply to unsafe methods even with no configured password, before request bodies or storage are accessed. Foreign, null, malformed, and ambiguous Origin headers are denied. `Sec-Fetch-Site: cross-site` also denies Origin-less browser writes, while Origin-less CLI requests remain compatible. Fetch Metadata/Origin/Host are spoofable outside a browser and never replace authentication. The backend uses the request Host plus request scheme (forced to HTTPS on Vercel outside development), not arbitrary `X-Forwarded-Host` or `X-Forwarded-Proto` overrides. A trusted ingress must validate and preserve the public Host/scheme. There is no application trusted-host allowlist or DNS-rebinding protection: matching Origin to Host is not proof that the hostname is trustworthy. Binding local development to loopback is necessary but does not by itself solve DNS rebinding; keep untrusted browser/network contexts away from passwordless mode.

Rotate the shared password when reviewer access changes, after suspected disclosure, and according to the owner's rotation policy. Update backend environment settings and redeploy/restart all serving instances; verify old credentials are rejected and new credentials work. Reviewers should clear cached browser Basic credentials and sign in again. There is no separate server-side session revocation control, and instances still running old settings keep accepting the old password. Never put credentials in frontend variables, URLs, source, or acceptance reports.

### Set the initial login

Signing into the Vercel dashboard with Google manages the hosting account; it does not create a CITRIDE demo password. There is no built-in or published password. The default username is `demo`, and the password is the value the project owner sets for `CITRIDE_DEMO_PASSWORD`.

If the site shows **Finish setting up the demo login**, open the existing CITRIDE Vercel project, go to **Settings → Environment Variables**, and add `CITRIDE_DEMO_PASSWORD` using a password you choose. Set `CITRIDE_DEMO_USERNAME` if you want a username other than `demo`. Apply the variables to the deployment environment you are using (Production and/or Preview) and the backend service if the dashboard offers a service selector. Save, then redeploy the latest GitHub commit so the backend receives the new settings.

Reload the site and select **Sign in**. Enter the configured username and password in the browser prompt. Do not commit either a real password or a database connection string to GitHub. If the next screen asks for storage setup, configure `CITRIDE_DATABASE_URL` or `DATABASE_URL` with your Postgres connection and redeploy again.

The setup and sign-in screens distinguish a missing deployment setting from an incorrect login or a temporary API failure. These screens do not initialize or expose the model before authentication.

## Build and checks

Each service builds independently. The backend uses Python 3.12 and its locked Python dependencies. Its build helper packages the generated scenario, authored reference and scripted replay configuration, telemetry, and IDT reference artifacts into `citride/demo_data` (18 fixture files for the current seed). The wheel includes these data artifacts and both runtime ontology sources: `citride/ontology/watershed.ttl` and `citride/ontology/idt_v4_owl.ttl`. The backend build needs access to the repository's `data/` directory outside its service root. The frontend selects Node.js 24 through `package.json`, uses its npm lockfile, and builds with Vite.

Run `bash scripts/check.sh` for the existing checks and production frontend build. Set `TEST_DATABASE_URL` to an isolated disposable Postgres database to include real database tests. Those tests cover fresh-instance persistence, concurrent initialization and promotion conflicts, rollback, immutable inference history and captured source proofs. GitHub Actions starts a disposable Postgres service for these checks.

Before any build downloads, verify the build environment's certificate-authority stores and installer versions against current advisories. The October 2026 emSign incident requires uv 0.13.4 or newer and a corrected certifi bundle (this lockfile selects 2026.10.19). Repository CI pins uv 0.13.4; local setup checks the tool, then supplies the verified project CA bundle explicitly to npm with strict TLS. Docker additionally prunes the exact compromised root from its own system/old-installer stores before downloading pip 26.2.2 and uv 0.13.4. These source controls do not modify or certify Vercel's managed installers, platform/vendored trust stores, custom CA overrides, or the operator's host. Confirm provider remediation and live ingress independently before publishing; never disable certificate validation to get a build through. See the README's CA-trust boundary for the scoped Node/npm mitigation and image-only helper safeguards.

Use `vercel dev` to test the services together once the project is linked and its development environment is configured. A Python function reuses no process cache as the source of database truth. Whole-dataset storage is intentionally suited to this small demo; review current Vercel duration, response-size and package-size limits as run history grows. Cumulative retained draft/proposal/run size, request-byte/depth limits, rate/concurrency controls, and reasoning compute budgets remain explicit unresolved product/deployment policy. Provider per-request limits do not establish cumulative retention or application compute budgets. No automatic purge or arbitrary quota is implemented; approve archival/retention, backups, and admission controls without rewriting immutable history before expanding access.

Before promoting a deployment, verify anonymous API requests are rejected; sign-in works; controller, sensor, enterprise and configured Corelight telemetry load (11 streams for the current seed); dependency staging/validation/promotion work in an isolated acceptance state; unsafe-water results on a fresh seed remain dialysis 2–4 h, sterilization 4–8 h, and nursing support 1–4 h; OWL inference and captured proofs work; and saved data survives a fresh function instance. The generated 67-entity seed produces 243 useful inferred facts in both measured modes. Runtime/source fidelity and the measured fallback gate are documented in [IDT runtime verification](../.specs/idt-records-and-proof/verification.md). Existing durable baselines are not automatically upgraded to that seed: approve and verify a current-baseline migration or scoped reset separately, with an owner-controlled rollback export and explicit historical-data treatment.

Only synthetic repository inputs belong in the deployment. Private planning attachments and transcripts are not build inputs. Deploying the code does not import an existing local `.local` history into Postgres; any such migration is a separate, explicitly selected operation.

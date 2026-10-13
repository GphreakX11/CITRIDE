# Vercel services deployment

The proposed project contains two services: `backend` (FastAPI, root `backend`) and `frontend` (Vite, root `frontend`). Configure the Vercel project at the repository root so that it reads the top-level `vercel.json`. Confirm the service names and public routes before publishing.

## Routing and bindings

The public `/v1` and `/v1/*` paths, `/health`, `/docs` and `/docs/*`, and `/openapi.json` route to the backend. All remaining paths route to the frontend. Preserve these paths when forwarding requests: the backend declares `/v1/*` routes and the browser uses relative `/v1/*` URLs. Mounting it at `/api/*` without changing both sides would break the application.

There are no service bindings. This frontend is a static React application, not a server function that calls another service. Its browser requests use the public, same-origin backend routes. An internal URL cannot be injected into browser runtime through a service binding, and it must not be baked into a `VITE_*` variable. A future frontend server function that calls an internal service would need a binding declared on that calling service.

The local Vite proxy to `127.0.0.1:8000` remains a development convenience. It is not the production backend address.

## Backend environment settings

Set these in Vercel's environment settings; never commit their values:

| Variable | Purpose |
| --- | --- |
| `CITRIDE_DATABASE_URL` or `DATABASE_URL` | Postgres connection string; use the provider's pooled connection and required TLS settings. |
| `CITRIDE_DEMO_PASSWORD` | Shared demo password, required on Vercel. |
| `CITRIDE_DEMO_USERNAME` | Optional shared username; defaults to `demo`. |
| `CITRIDE_STATE_KEY` | Optional durable state identity within this database. |

The database role must be able to create and read/write the `citride_state` table. Each state occupies one row containing the RDF dataset. Transactions, transaction-scoped advisory locks, and row locks protect the complete read/modify/write operation across independent function instances. Prepared statements are disabled for compatibility with transaction poolers.

Seed initialization occurs once when the selected state is absent. Existing baselines, proposals, sources, and run history are retained on redeployment. The default hosted state key is `citride-production`, `citride-preview`, or `citride-development`, according to Vercel's `VERCEL_ENV`. Set an explicit key or use separate databases when individual preview branches need isolated state. Never run destructive or model-editing acceptance tests against an existing production state.

Vercel requests fail closed when the demo password or database connection is missing. They do not fall back to an ephemeral local file. Local development retains file storage unless a database URL is explicitly configured; an explicit `data_dir` passed to the application factory selects local storage for tests.

## Demo access

The frontend shell is publicly routable. Backend requests, including graph export, API documentation, and health, require the shared demo login. The UI shows **Sign in** when a model request receives HTTP 401. The link opens `/v1/login`, where the browser prompts for the username and password, then returns to the frontend. Credentials are not stored in JavaScript or bundled into frontend assets. Protected responses use `private, no-store` and vary by authorization. Browser model changes must come from the same origin.

This is a shared demo login, not a multi-customer authentication or audit system. Vercel project-level deployment protection can additionally restrict the frontend shell where the account supports it.

### Set the initial login

Signing into the Vercel dashboard with Google manages the hosting account; it does not create a CITRIDE demo password. There is no built-in or published password. The default username is `demo`, and the password is the value the project owner sets for `CITRIDE_DEMO_PASSWORD`.

If the site shows **Finish setting up the demo login**, open the existing CITRIDE Vercel project, go to **Settings → Environment Variables**, and add `CITRIDE_DEMO_PASSWORD` using a password you choose. Set `CITRIDE_DEMO_USERNAME` if you want a username other than `demo`. Apply the variables to the deployment environment you are using (Production and/or Preview) and the backend service if the dashboard offers a service selector. Save, then redeploy the latest GitHub commit so the backend receives the new settings.

Reload the site and select **Sign in**. Enter the configured username and password in the browser prompt. Do not commit either a real password or a database connection string to GitHub. If the next screen asks for storage setup, configure `CITRIDE_DATABASE_URL` or `DATABASE_URL` with your Postgres connection and redeploy again.

The setup and sign-in screens distinguish a missing deployment setting from an incorrect login or a temporary API failure. These screens do not initialize or expose the model before authentication.

## Build and checks

Each service builds independently. The backend uses Python 3.12 and its locked Python dependencies; its build helper packages the five fictional JSON inputs into `citride/demo_data`. The wheel includes these generated data artifacts and the ontology at `citride/ontology/watershed.ttl`. The backend build needs access to the repository's `data/` directory outside its service root. The frontend selects Node.js 24 through `package.json`, uses its npm lockfile, and builds with Vite.

Run `bash scripts/check.sh` for the existing checks and production frontend build. Set `TEST_DATABASE_URL` to an isolated disposable Postgres database to include real database tests. Those tests cover fresh-instance persistence, concurrent initialization and promotion conflicts, rollback, immutable inference history and captured source proofs. GitHub Actions starts a disposable Postgres service for these checks.

Use `vercel dev` to test the services together once the project is linked and its development environment is configured. A Python function reuses no process cache as the source of database truth. Whole-dataset storage is intentionally suited to this small demo; review current Vercel duration, response-size and package-size limits as run history grows.

Before promoting a deployment, verify anonymous API requests are rejected; sign-in works; all four telemetry streams load; dependency staging/validation/promotion work; unsafe-water results on a fresh seed remain dialysis 2–4 h, sterilization 4–8 h, and nursing support 1–4 h; OWL inference and captured proofs work; and saved data survives a fresh function instance. The local seed produces 177 useful inferred facts.

Only synthetic repository inputs belong in the deployment. Private planning attachments and transcripts are not build inputs. Deploying the code does not import an existing local `.local` history into Postgres; any such migration is a separate, explicitly selected operation.

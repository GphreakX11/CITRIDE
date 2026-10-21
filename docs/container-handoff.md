# Container handoff — controlled synthetic demonstration

This distribution includes the `citride-security-review` hardening revision
`7054f4d711b5b1b1c97a14893db510ab9ed9974c`, plus the frontend/container
packaging fix. Do not substitute an older `main` checkout: at preparation time
`main` was `8d5fc01ad7f218b1925f931780df33300af4fb5e` and did not contain
that security revision. The accompanying manifest identifies the exact source
files and verification report for this handoff. This does not merge or deploy it.

## Build and test

Run these commands at the extracted repository root. Docker with Linux containers
is required; Node and Python application dependencies are built inside the image.
An internet connection is required for the initial image/package downloads.

```bash
docker build -f backend/Dockerfile --target runtime -t citride:handoff .
# Python 3.10+ on the Docker host; standard library only, no pip install:
python3 scripts/check_container_ui.py --image citride:handoff
```

A plain build without `--target` also produces `runtime`, not the verification
test runner. The separate `verification` target remains available for development
checks. Its complete suite still needs the same optional database/browser/Git
facilities as the corresponding source tests; it is not the product image.

The runtime builds the screens with Node 24, `npm ci --ignore-scripts`, the
checked-in lockfile, strict TLS, and the backend's reviewed CA bundle. Only
`frontend/dist` is copied into the final Python image; Node, frontend source,
and `node_modules` are not required at runtime. Base-image tags are not immutable
digests, so rebuilding later is not a claim of bit-for-bit identical images or
an up-to-date vulnerability certification. Review current advisories before use.

The container smoke test starts uniquely named, disposable containers on random
**loopback-only** ports, never mounts host state, generates its own random test
password, and removes its containers on success or failure. It checks:

- Missing password fails closed; anonymous and incorrect logins are rejected.
- The real HTTP homepage has the React root and compiled JS/CSS.
- Referenced assets return actual JS/CSS MIME types, not fallback HTML.
- Command and Analyst entry URLs serve the application.
- The real backend initializes its packaged synthetic data.
- Unknown API routes remain 404 rather than silently becoming the SPA.
- Runtime UID remains 10001 and required authentication defaults to enabled.

This HTTP smoke is a packaging regression test, not a claim that it exercises
all rendered UI workflows, all security controls, or a real Postgres deployment.
The GitHub Actions workflow builds and runs this smoke against the runtime image.

## Start for a trusted reviewer

In Bash, choose a new, unique password at the hidden prompt. Do not put a real
password in a shell command, source file, URL, frontend variable, or chat message.
The username is `demo` unless explicitly configured otherwise.

```bash
read -r -s -p 'New CITRIDE demo password: ' CITRIDE_DEMO_PASSWORD
printf '\n'
export CITRIDE_DEMO_PASSWORD
docker run --detach --name citride \
  --publish 127.0.0.1:8000:8000 \
  --env CITRIDE_DEMO_PASSWORD \
  --mount type=volume,source=citride-demo-state,target=/app/.local \
  citride:handoff
unset CITRIDE_DEMO_PASSWORD
```

Open <http://127.0.0.1:8000/> and sign in. Select **Command** or **Analyst** in
the application. Deep links are query parameters, not separate frontend builds:

- Command: `http://127.0.0.1:8000/?mode=command&view=command`
- Analyst: `http://127.0.0.1:8000/?mode=analyst&view=overview`

The runtime defaults to `CITRIDE_REQUIRE_AUTH=1`. A missing or blank password
returns HTTP 503 instead of exposing data. Do not turn off required auth to work
around a startup failure. Docker administrators can inspect container environment
variables, so this shared password is not secret from the host administrator.

The named volume keeps local demo state across container replacement. It is not
an included backup or a multi-user database. Do not delete it to troubleshoot a
packaging problem. For deliberate shutdown, `docker stop citride`; removing only
the stopped container does not delete the named volume. Before replacement, plan
state backups and rotate credentials using the access-boundary instructions.

## External-sharing limits

This is a single-user, entirely synthetic demonstration intended for a controlled
reviewer. Do not import operational, customer, regulated, or classified data.
Shared Basic authentication is not per-person identity, RBAC, tenant isolation,
login throttling, expiring sessions, or a complete audit workflow.

Keep the example listener on loopback. For any access beyond trusted loopback,
configure a trusted HTTPS ingress, preserve and validate the public Host/scheme,
keep mandatory auth enabled, and establish deployment-specific controls first.
Never publish the example as unencrypted public/LAN HTTP with Basic credentials.

Real Postgres persistence, public/multi-user isolation, host/DNS-rebinding policy,
request/rate/concurrency/compute limits, retention, backups, and credential rotation
need separate acceptance before broader use. The container fix does not remove
those documented limitations or certify FedRAMP/GovCloud/production readiness.
See [README access boundaries](../README.md#access-boundary).

No credentials, local persisted state, build caches, or source-control internals
are needed in the source handoff. Preserve the manifest and verification report
when forwarding it so recipients know exactly what was checked and on which
architecture. Do not assume an ARM64 test proves an AMD64 image was executed.

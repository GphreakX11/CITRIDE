# TXCC-inspired command workspace — design

## Architecture and ownership

- `backend/citride/command.py`: composition-based CommandService uses existing Repository/File/Postgres `_locked` transaction and named records. No new database table or schema migration. Incident/analysis writes share one transaction; original baseline and historical runs remain unchanged.
- `backend/citride/command_requests.py`, `api.py`: strict creation and discriminated action schemas; existing authentication/CSRF/exception handling protects all routes.
- `frontend/src/commandTypes.ts`: canonical request/response contract and primary S1–S8 navigation.
- `CommandWorkspace.tsx`: orchestrates real case reads/mutations, optimistic versions, idempotency IDs, manual refresh/reconciliation and source-bound selection.
- `CommandCasework.tsx` / `command-casework.css`: delegated case creation, confirmation, tasks, notes, review and closure interface.
- `CommandReadouts.tsx`, `commandMetrics.ts`, `command-shell.css`: command overview, source-backed service-area/Cyber/Leadership/Organization views, actual counts/brief export and responsive dark shell.
- `App.tsx`: primary navigation/default command screen, retained expert-tools group and authentication-context clearing.

## API contracts

GET/POST `/v1/command/incidents`, GET `/v1/command/incidents/{id}`, POST `/v1/command/incidents/{id}/actions`. Requests carry `clientRequestId`; actions also carry `expectedVersion`. Create checks `expectedBaselineRevision`. Actions are limited to `set_status`, `set_task`, `review_decision`, `add_note`, `analyze`; there is no approve/dispatch/notify action.

Incidents capture original event and structural context. Advisory decisions use the immutable analysis snapshot's names, sources, assumptions and windows. A run is linked once rather than overwriting prior review history. Case tracking status is independent of external event status. App activity is versioned workflow history, not a certified append-only audit system.

## Safety and UI

No source mockup binary, TXCC staff identities, marking authority, phase-generated incidents or fabricated operational measures enter the repository. Use actual reference inventory and source handling metadata, with concise provenance. A COP reference-coordinate illustration is explicitly not verified Texas geography; spatial membership is not a service dependency.

Mutation confirmations freeze case ID/version and model settings. After ambiguous network/5xx outcome, disable subsequent writes and retain the exact request; explicit recheck/idempotent retry reconciles it. Never automatically replay a POST. Successful-write/failed-read outcomes also require reconciliation. A 401 clears private records; late/outdated reads cannot restore stale context.

Counts come from saved incidents and actual review/task states. Leadership timing measures only casework timestamps, not compromise/detection/mitigation. Handoff downloads are local exports, not partner delivery. The existing model and ontology tools remain available; native phone-sized controls replace the mockup's scaled desktop layout.

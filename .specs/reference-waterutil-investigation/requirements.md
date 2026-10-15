# Source-attributed water utility investigation

## Problem
The supplied `pcap-cyberav3ngers-waterutil-v2.md` must become a usable reference case with assets, evidence, and persisted review tasks, without falsely mapping its hosts to existing Texas reference facilities.

## Requirements
- Capture a credential-redacted, immutable document-derived investigation with original source SHA-256, reported capture window, packet indices, asset roles, and timeline.
- Every evidence entry is report-only until the actual PCAP/endpoint evidence is supplied. Record TLS visibility limitations, attribution limits, rejected-SSH uncertainty, port/filter/mapping inconsistencies, and missing physical-impact evidence.
- Create one reference case using the existing authenticated/idempotent case-create contract. Keep reference assets case-local, outside baseline inventory, geography, dependencies, telemetry, and consequence scenarios.
- Persist eight actionable review tasks using existing guarded task/note/status controls. No execution, dispatch, notification, recovered-state assertion, or automatic analysis.
- Preserve existing cases, runs, baseline, API contracts, and authentication.

## Non-goals
PCAP analysis without a PCAP; scanning IOC hosts; live OT remediation; publishing source credentials; assigning location; promoting service dependencies; production deployment without approval for this change.

## Acceptance criteria
- Real isolated API create/read/restart/task/note workflows work, including duplicate/idempotent requests and malformed-input rejection.
- Existing casework and protected baseline/run fingerprints remain unchanged.
- Desktop and phone-sized browsers display source provenance, complete assets, timeline and tasks with no document overflow or browser errors.
- Reference evidence is accessible from the shared Evidence shortcut, not merely a JSON export.

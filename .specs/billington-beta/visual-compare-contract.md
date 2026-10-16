# Visual comparison contract

## Scope and verified outcome

Owned implementation: `scripts/visual_compare.py`, new `backend/tests/test_visual_compare.py`, and this contract. No CSS/TSX/package edits, server startup, build, deployment, reset, or commit is part of this task.

The CLI has been exercised in **offline preflight only**, using the existing source tree and the explicit original-board cache. It did not contact or screenshot the existing port-8777 app. No authorized capture target/case was supplied, so browser execution and the isolated mutation workflow remain unexercised against a real application. The preparation tests use explicitly mocked API calls, not invented live results.

Actual preflight outcome:

- 25 requested views × two viewports = **50 pairs**.
- Default unified original `mockups/CITRIDE_Beta_Mockup.html` is absent: **50 reference-unavailable**, zero proof images.
- Explicit cached-original fallback finds 15 original files supporting 17 view/tab variants: **34 preflight-only** rows and **16 reference-unavailable** Advanced rows.
- All 34 available-reference rows identify missing local script dependencies; 18 rows additionally contain template bindings in the original source. These are source warnings, not a claim that a browser initialized them successfully.
- **Zero valid visual-proof pairs**, zero generated screenshot PNGs. Browser never started; no app state writes.
- Ten offline unit tests pass, including CLI safety, all mappings, fallback/provenance, unavailable coverage, no-egress/write policy, unresolved rendering, versioned preparation payloads, and exact left/right pixel composition. Tests were run red before implementation and green afterward.

Artifacts (generated, not committed):

- `artifacts/visual-compare/report.json`
- `artifacts/visual-compare/index.html`
- `artifacts/visual-compare/unified-preflight/report.json`
- `artifacts/visual-compare/unified-preflight/index.html`

## CLI and authorization

`--app-url` is always required; there is no default live target. The default mode, and explicit `--preflight`, inspect local reference/source files only. Local report files are written; app state is not. Preflight does not require a case ID and does not perform HTTP requests.

```sh
python3 scripts/visual_compare.py \
  --app-url http://127.0.0.1:8777 --preflight \
  --mockup-dir /home/gphreakx/.hermes/cache/citride-analyst-reference
```

`--mockup` defaults to the repository unified-original path above. It and `--mockup-dir` are mutually exclusive. Missing unified input never automatically selects the cache. `--mockup-dir` is an explicit original-reference fallback, carrying original absolute paths, SHA-256 hashes, and links to cached README, feature map, and design provenance. References always open as `file:///` originals. Files are not rewritten, interpolated, styled, or replaced with app screenshots. No unified original is fabricated.

For unified HTML, only board IDs actually discovered in that document are supported. The script accepts an exact original board name as its ID; unfamiliar formats fail unavailable rather than guessing a selector. A supplied unified document may need its actual board structure inspected before support is extended.

Read-only capture requires a separately authorized existing target and existing prepared case:

```sh
# Run only when the target and case are explicitly authorized.
python3 scripts/visual_compare.py \
  --app-url "$AUTHORIZED_EXISTING_APP_URL" --capture \
  --case-id "$EXISTING_PREPARED_CASE_ID" \
  --mockup-dir /home/gphreakx/.hermes/cache/citride-analyst-reference
```

There is deliberately no server-start/retry/workaround command here. `--capture` is explicit authorization to inspect that supplied existing target, not permission to launch one. It does not implicitly reset, create a case, analyze, infer, or save a what-if. Existing case state must include `event-vpn-a` and a saved `unsafe-water` analysis; missing state fails clearly. Entity comes from actual saved context/event data, or explicit `--entity-id`. Browser requests remain GET/HEAD even if preparation is enabled.

Only **`--capture --prepare-isolated --confirm-isolated EXACT_APP_URL`** authorizes versioned create/analyze API writes on that exact target. Reset additionally requires **`--reset-demo`**. Reset without preparation is rejected. Preparation and an existing `--case-id` are mutually exclusive. No flag is inferred from localhost or a port number.

Preparation sequence (not exercised on any server here):

1. Verify local source contract and original-reference availability; load Playwright and launch its Chromium browser, never an app server.
2. GET `/v1/bootstrap`; persist target scope and generated/provided `--request-id` before any write.
3. Only with reset flag: POST `/v1/demo/reset`, `confirm: "RESET DEMO"`, current `expectedBaselineRevision`, stable identity suffix `-reset`; GET the resulting bootstrap again.
4. POST `/v1/command/incidents`, `eventId: "event-vpn-a"`, title `Watershed visual comparison`, priority `high`, current `expectedBaselineRevision`, identity suffix `-create`.
5. POST the returned real incident ID's `/actions`, action `analyze`, existing `scenarioId: "unsafe-water"`, evaluation hour 1, horizon 12, returned `expectedVersion`, identity suffix `-analyze`.
6. Persist and use returned real case ID/version. An uncertain error is reported, never blindly retried. Reconcile using the saved request identity before rerunning any preparation.

No what-if mutation is implemented by this visual comparator; A4/lab captures show existing state only. Mutation demonstrations require separate explicit isolated authorization, not a read-only comparison flag.

## Mappings discovered from source

`frontend/src/commandTypes.ts`, `prototypeLocation.ts`, and `NetworkEvidence.tsx` define the actual route and control contract. Their hashes are recorded in the report; critical route/control tokens are checked before capture. Selection is `?mode=…&view=…&focus=1&case=<actual-id>&entity=<actual-id>`. Existing base-path is preserved; stale query parameters are discarded. Captured application URLs must retain actual case/mode/view or the row fails.

| Screen | Mode | View | Original |
|---|---|---|---|
| C1 | command | command | Main.dc.html |
| C2 | command | cop | C2.dc.html |
| C3 | command | cyber | C3.dc.html |
| C4 | command | consequence | C4.dc.html |
| C5 | command | uctf | C5.dc.html |
| C6 | command | leadership | Brief.dc.html |
| C7 | command | federation | C6.dc.html (legacy filename) |
| A1 | analyst | command | A1.dc.html |
| CaseFile | analyst | case-file | CaseFile.dc.html |
| A2 | analyst | cop | A2.dc.html |
| Entity | analyst | entity-profile | Entity.dc.html |
| A3-timeline | analyst | cyber, tab=timeline | A3.dc.html |
| A3-hunt | analyst | cyber, tab=hunt | A3.dc.html |
| A3-raw | analyst | cyber, tab=raw | A3.dc.html |
| A4 | analyst | consequence | A4.dc.html |
| A5 | analyst | coordination | A5.dc.html |
| A6 | analyst | uctf | A6.dc.html |
| Advanced-overview | analyst | overview | unavailable in cache |
| Advanced-incident | analyst | incident | unavailable in cache |
| Advanced-blueprint | analyst | blueprint | unavailable in cache |
| Advanced-relationships | analyst | relationships | unavailable in cache |
| Advanced-reasoning | analyst | reasoning | unavailable in cache |
| Advanced-lab | analyst | lab | unavailable in cache |
| Advanced-evidence | analyst | evidence | unavailable in cache |
| Advanced-sources | analyst | sources | unavailable in cache |

Advanced fallback files, if genuine originals are subsequently supplied, use `Advanced-<view>.dc.html`; they are never generated. A3 hunt explicitly clicks the actual `Run search` button (client-local search over supplied telemetry). Raw clicks an actual `Inspect record` button and waits for the actual `Selected raw record` panel, rather than fabricating a record ID. Reference A3 requires its real initialized ARIA tab; unavailable/uninitialized tabs invalidate proof. The script injects no reference runtime or sample values.

## Capture/report validity

- Fresh contexts per side and viewport; viewport sizes **1920×1080** and **1440×900**, device scale 1, reduced motion, no full-page stretching. Fonts must settle before screenshot.
- Original on the left, actual app on the right. Pixel-exact Pillow composition refuses unequal source sizes, with no resizing or image repair.
- Successful pair names: `artifacts/visual-compare/<screen>-<width>.png`. Composition sizes are 3840×1080 and 2880×900. Contact-sheet HTML links only real generated images.
- Default capture is no-egress except supplied app-origin GET/HEAD. Original file captures permit file/data/blob resources but no HTTP(S). External fonts/scripts are blocked and recorded, not fetched or silently replaced with network resources. Service workers and websockets are blocked; Playwright ≥1.48 is required for websocket interception. API clients reject redirects and environment proxies. No browser POST/PUT/PATCH/DELETE is permitted.
- Page exceptions, console errors, request failures, HTTP errors, blocked requests, blank render, unresolved `{{…}}` in rendered text/DOM attributes, uninitialized reference tabs, app unavailable/loading/access errors, and lost selected-case URLs prevent valid proof.
- `captured` means a technically valid pair, **not** automatic visual equality. `diagnostic-invalid` images, if generated, are visibly identified in the contact sheet/report and must never be described as a match. `capture-failed`, `capture-blocked`, `reference-unavailable`, and `preflight-only` remain explicit coverage gaps.
- The JSON report records requested/valid totals, per-row issues, provenance, actual captured URLs, browser-start status, target scope, and source hashes. Missing/unusable originals never become successful coverage.
- Exit code 0 requires all requested pairs to be valid captures. Incomplete or preflight-only coverage exits 2; argparse validation also exits 2. Preflight exit 2 is expected, not a successful visual-proof claim.

## Reproduction and limits

```sh
python3 -m unittest discover -s backend/tests -p test_visual_compare.py -v
```

Pillow and Playwright were already installed in the current Python environment; no install was performed. Pixel-composition tests use temporary fixture images only. No screenshot assets are committed. Chromium capture, live app readiness, real reset/create/analyze behavior, and visual equality are **not verified** in this task because no existing authorized capture target/prepared case was provided and server startup was forbidden. The parent theme/shell work must finish and authorize the correct target before using this as final-theme visual evidence.

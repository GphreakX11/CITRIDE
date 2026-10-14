"""Fault-injected command UI acceptance against an isolated localhost API."""

import argparse
import json
import uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8056")
parser.add_argument(
    "--output", default="/home/gphreakx/.hermes/cache/citride-verification/txcc"
)
args = parser.parse_args()
assert urlparse(args.url).hostname in ("127.0.0.1", "localhost")
report = {}
with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(
        viewport={"width": 393, "height": 852}, is_mobile=True, has_touch=True
    )
    page = context.new_page()
    page.goto(args.url)
    expect(
        page.get_by_role("button", name="Refresh casework", exact=True)
    ).to_be_enabled()

    def state():
        r = context.request.get(args.url + "/v1/command/incidents")
        assert r.ok
        return r.json()["incidents"]

    def nav(name, tool=False):
        page.get_by_role("button", name="Open navigation", exact=True).click()
        if (
            tool
            and not page.get_by_role(
                "navigation", name="Model and evidence tools"
            ).is_visible()
        ):
            page.get_by_text("Model & evidence tools", exact=True).click()
        page.get_by_role(
            "navigation",
            name="Model and evidence tools" if tool else "Main navigation",
            exact=True,
        ).get_by_role("button", name=name, exact=True).click()

    def commit_then_lose(route):
        response = route.fetch()
        assert response.ok, response.text()
        route.abort("failed")

    before = len(state())
    page.get_by_role("button", name="Start incident", exact=True).click()
    active = {case["eventId"] for case in state() if case["status"] != "closed"}
    events = context.request.get(args.url + "/v1/bootstrap").json()["events"]
    event_id = next(event["id"] for event in events if event["id"] not in active)
    title = "Lost-response recovery acceptance " + uuid.uuid4().hex[:8]
    page.get_by_label("Source event", exact=True).select_option(event_id)
    page.get_by_label("Case title", exact=True).fill(title)
    payloads = []
    page.on(
        "request",
        lambda req: (
            payloads.append(req.post_data_json)
            if req.method == "POST" and req.url.endswith("/v1/command/incidents")
            else None
        ),
    )
    page.route("**/v1/command/incidents", commit_then_lose, times=1)
    page.get_by_role("button", name="Create workspace case", exact=True).click()
    expect(
        page.get_by_role("heading", name="Save outcome is uncertain", exact=True)
    ).to_be_visible()
    assert len(state()) == before + 1
    case = next(i for i in state() if i["title"] == title)
    nav("Sources & assumptions", tool=True)
    nav("S6 Consequence")
    expect(
        page.get_by_role("heading", name="Save outcome is uncertain", exact=True)
    ).to_be_visible()
    expect(
        page.get_by_role("button", name="Create workspace case", exact=True)
    ).to_be_disabled()
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith("/v1/command/incidents")
    ) as retried:
        page.get_by_role("button", name="Retry same saved request", exact=True).click()
    assert retried.value.ok
    expect(
        page.get_by_role("heading", name="Save outcome is uncertain", exact=True)
    ).not_to_be_visible()
    assert len(state()) == before + 1
    assert payloads[0] == payloads[1], "Recovery request changed"
    report["lostCreate"] = {
        "onePersistedCase": True,
        "sameRequestIdAndPayload": True,
        "navigationPreservesRecovery": True,
    }
    nav("S4 Coordination")
    page.get_by_label("Coordination note", exact=True).fill(
        "Recover exactly once after committed response loss."
    )
    page.route(
        "**/v1/command/incidents/" + case["id"] + "/actions", commit_then_lose, times=1
    )
    page.get_by_role(
        "button", name="Save coordination note — not sent", exact=True
    ).click()
    expect(
        page.get_by_role("heading", name="Save outcome is uncertain", exact=True)
    ).to_be_visible()
    nav("Situation overview", tool=True)
    nav("S4 Coordination")
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith("/actions")
    ) as response:
        page.get_by_role("button", name="Retry same saved request", exact=True).click()
    assert response.value.ok
    expect(
        page.get_by_role("button", name="Refresh casework", exact=True)
    ).to_be_enabled()
    recovered = next(i for i in state() if i["id"] == case["id"])
    assert len(recovered["notes"]) == 1
    report["lostNote"] = {"onePersistedNote": True, "navigationPreservesRecovery": True}
    stale_version = recovered["version"]
    external = context.request.post(
        args.url + "/v1/command/incidents/" + case["id"] + "/actions",
        data={
            "clientRequestId": str(uuid.uuid4()),
            "expectedVersion": stale_version,
            "action": "add_note",
            "note": "Concurrent reviewer saved this note.",
        },
    )
    assert external.ok, external.text()
    draft = "Do not silently apply this outdated draft."
    page.get_by_label("Coordination note", exact=True).fill(draft)
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith("/actions")
    ) as rejected:
        page.get_by_role(
            "button", name="Save coordination note — not sent", exact=True
        ).click()
    assert rejected.value.status == 409
    expect(
        page.get_by_role("button", name="Refresh casework", exact=True)
    ).to_be_enabled()
    try:
        expect(page.get_by_label("Coordination note", exact=True)).to_have_value(draft)
    except AssertionError:
        print("STALE UI DIAGNOSTIC", page.locator("body").inner_text())
        page.screenshot(
            path=str(Path(args.output) / "stale-failure.png"), full_page=True
        )
        raise
    actual = next(i for i in state() if i["id"] == case["id"])
    assert actual["version"] == external.json()["version"]
    assert len(actual["notes"]) == 2
    assert not any(n["text"] == draft for n in actual["notes"])
    report["staleVersion"] = {
        "rejected409": True,
        "noSilentOverwrite": True,
        "draftRetainedForExplicitResubmit": True,
    }
    assert page.evaluate(
        "document.body.scrollWidth <= document.documentElement.clientWidth"
    )
    out = Path(args.output)
    page.screenshot(path=str(out / "phone-recovery.png"), full_page=True)
    (out / "fault-acceptance.json").write_text(json.dumps(report, indent=2))
    browser.close()
print(json.dumps(report, indent=2))

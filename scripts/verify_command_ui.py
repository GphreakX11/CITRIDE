"""Bounded real-API command workflow acceptance. Use only the isolated local QA server."""

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8056")
parser.add_argument(
    "--output", default="/home/gphreakx/.hermes/cache/citride-verification/txcc"
)
args = parser.parse_args()
assert urlparse(args.url).hostname in ("127.0.0.1", "localhost"), (
    "Local isolated QA only"
)
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
report = {
    "origin": args.url,
    "scope": "isolated local API, not production",
    "workflows": [],
}

with sync_playwright() as p:
    browser = p.chromium.launch()
    client = browser.new_context()

    def state():
        response = client.request.get(args.url + "/v1/command/incidents")
        assert response.ok, response.text()
        return response.json()["incidents"]

    def fingerprint():
        response = client.request.get(args.url + "/v1/bootstrap")
        assert response.ok
        return hashlib.sha256(
            json.dumps(response.json(), sort_keys=True).encode()
        ).hexdigest()

    before = fingerprint()
    names = [
        "S1 Command overview",
        "S2 Service-area COP",
        "S3 Cyber operations",
        "S4 Coordination",
        "S5 Task force workspace",
        "S6 Consequence",
        "S7 Leadership brief",
        "S8 Organizations & handoff",
    ]
    tools = [
        "Situation overview",
        "Incident → decision",
        "Relationship model",
        "Ontology blueprint",
        "Ontology reasoning",
        "Scenario lab",
        "Event evidence",
        "Sources & assumptions",
    ]
    for device, viewport in [
        ("desktop", {"width": 1440, "height": 1000}),
        ("phone", {"width": 393, "height": 852}),
    ]:
        context = browser.new_context(
            viewport={"width": viewport["width"], "height": viewport["height"]},
            is_mobile=device == "phone",
            has_touch=device == "phone",
            device_scale_factor=1,
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def ready():
            expect(
                page.get_by_role("button", name="Refresh casework", exact=True)
            ).to_be_enabled()

        def layout(label):
            widths = page.evaluate(
                "() => ({body:document.body.scrollWidth, viewport:document.documentElement.clientWidth})"
            )
            assert widths["body"] <= widths["viewport"], (label, widths)
            assert page.locator("h1:visible").count() == 1, label

        def nav(name, tool=False):
            if device == "phone":
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
            page.wait_for_timeout(250)
            layout(name)

        def change(button, **kwargs):
            with page.expect_response(
                lambda r: (
                    r.request.method == "POST" and "/v1/command/incidents" in r.url
                )
            ) as response:
                button.click(**kwargs)
            assert response.value.ok, response.value.text()
            ready()
            return response.value.json()

        page.goto(args.url)
        ready()
        layout("initial")
        for name in names:
            nav(name)
        for name in tools:
            nav(name, tool=True)
        nav(names[0])
        page.get_by_role("button", name="Start incident", exact=True).click()
        page.get_by_label("Source event", exact=True).select_option("event-dosing")
        title = f"{device} dosing observation acceptance"
        page.get_by_label("Case title", exact=True).fill(title)
        page.get_by_label("Local triage priority", exact=True).select_option("high")
        created = change(
            page.get_by_role("button", name="Create workspace case", exact=True)
        )
        case_id = created["id"]
        assert created["title"] == title
        expect(
            page.get_by_role("button", name="Close workspace case…", exact=True)
        ).to_be_disabled()
        nav(names[5])
        page.get_by_role("button", name="Analyze linked scenario…", exact=True).click()
        dialog = page.get_by_role("dialog")
        expect(dialog).to_be_visible()
        bounds = dialog.bounding_box()
        assert (
            bounds
            and bounds["y"] >= 0
            and bounds["y"] + bounds["height"] <= viewport["height"] + 1
        )
        dialog.get_by_role("button", name="Cancel", exact=True).click()
        assert not next(i for i in state() if i["id"] == case_id)["runId"]
        page.get_by_role("button", name="Analyze linked scenario…", exact=True).click()
        analyzed = change(
            page.get_by_role("dialog").get_by_role(
                "button", name="Analyze captured scenario", exact=True
            )
        )
        assert len(analyzed["decisions"]) == 3
        assert sorted(d["windowHours"] for d in analyzed["decisions"]) == [
            [1.0, 4.0],
            [2.0, 4.0],
            [4.0, 8.0],
        ]
        expect(page.locator(".cc-review")).to_have_count(3)
        layout("populated consequence")
        page.screenshot(path=str(out / f"{device}-consequence.png"), full_page=True)
        for index in range(3):
            card = page.locator(".cc-review").nth(index)
            card.get_by_label("Advisory review note", exact=True).fill(
                "Captured assumptions checked; advisory review only."
            )
            change(
                card.get_by_role("button", name="Record advisory review", exact=True)
            )
        nav(names[4])
        for index in range(page.locator(".cc-task input").count()):
            change(page.locator(".cc-task input").nth(index))
        nav(names[3])
        note = "Local handoff retained. No partner notification sent."
        page.get_by_label("Coordination note", exact=True).fill(note)
        change(
            page.get_by_role(
                "button", name="Save coordination note — not sent", exact=True
            )
        )
        page.get_by_label("Required tracking / closure note", exact=True).fill(
            "All app reviews and tasks complete; no physical recovery claim."
        )
        page.get_by_role("button", name="Close workspace case…", exact=True).click()
        page.get_by_role("dialog").get_by_role(
            "button", name="Cancel", exact=True
        ).click()
        assert next(i for i in state() if i["id"] == case_id)["status"] == "open"
        page.get_by_role("button", name="Close workspace case…", exact=True).click()
        closed = change(
            page.get_by_role("dialog").get_by_role(
                "button", name="Close workspace case", exact=True
            )
        )
        assert closed["status"] == "closed"
        page.get_by_label("Required tracking / closure note", exact=True).fill(
            "Explicitly reopen local tracking for recheck."
        )
        reopened = change(
            page.get_by_role("button", name="Reopen workspace case", exact=True)
        )
        assert reopened["status"] == "open"
        page.reload()
        ready()
        nav(names[3])
        expect(
            page.locator(".cc-timeline .cc-user-text").filter(has_text=note).first
        ).to_be_visible()
        assert (
            next(i for i in state() if i["id"] == case_id)["runId"] == analyzed["runId"]
        )
        page.get_by_label("Required tracking / closure note", exact=True).fill(
            "Close after verified reload; local tracking only."
        )
        page.get_by_role("button", name="Close workspace case…", exact=True).click()
        change(
            page.get_by_role("dialog").get_by_role(
                "button", name="Close workspace case", exact=True
            )
        )
        nav(names[7])
        with page.expect_download() as download:
            page.get_by_role(
                "button", name="Download selected brief", exact=True
            ).click()
        path = out / f"{device}-brief.json"
        download.value.save_as(path)
        brief = json.loads(path.read_text())
        assert brief["incident"]["id"] == case_id, brief.keys()
        for name in names:
            nav(name)
        nav(names[0])
        page.screenshot(path=str(out / f"{device}-overview.png"), full_page=True)
        assert not errors, errors
        report["workflows"].append(
            {
                "device": device,
                "caseId": case_id,
                "runId": analyzed["runId"],
                "navigation": 16,
                "reviews": 3,
                "savedTasks": len(closed["tasks"]),
                "closureReopeningReload": True,
                "downloadReadback": True,
                "pageErrors": errors,
            }
        )
        context.close()
    assert fingerprint() == before, "Source baseline changed"
    report["sourceBaselineUnchanged"] = True
    browser.close()
(out / "acceptance.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))

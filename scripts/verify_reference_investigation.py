"""Bounded reference-case acceptance against an isolated loopback real API.

Never run against production. Existing cases and model/history are fingerprinted;
only a new reference case is appended (QA toggles are explicitly restored).
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse
import httpx
from playwright.sync_api import sync_playwright, expect, ViewportSize

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8769")
parser.add_argument("--output", required=True)
parser.add_argument("--source", required=True)
parser.add_argument("--resume", action="store_true", help="Read saved QA baseline and reconcile an already-created reference; never duplicate")
args = parser.parse_args()
assert urlparse(args.url).hostname in ("127.0.0.1", "localhost"), "Isolated local API only"
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
source_hash = hashlib.sha256(Path(args.source).read_bytes()).hexdigest()
manifest = json.loads((Path(__file__).resolve().parents[1] / "backend/citride/reference_data/waterutil-fuel-v2.json").read_text())
assert manifest["source"]["sha256"] == source_hash
client = httpx.Client(base_url=args.url, timeout=30)

def get(path):
    response = client.get(path)
    response.raise_for_status()
    return response.json()

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

protected = {path: get(path) for path in ("/v1/bootstrap", "/v1/ontology", "/v1/cascade-runs", "/v1/dependency-proposals", "/v1/inference-runs")}
old_cases = {case["id"]: case for case in get("/v1/command/incidents")["incidents"]}
references = [case for case in old_cases.values() if case["eventId"] == "reference:waterutil-fuel-v2"]
journal = out / "reference-before.json"
if args.resume:
    assert len(references) == 1 and journal.is_file(), "Resume needs exactly one saved reference and its pre-import QA journal"
    prior = json.loads(journal.read_text())
    assert prior["origin"] == args.url
    protected, old_cases = prior["protected"], prior["cases"]
else:
    assert not references, "Reference already exists; use explicit --resume to reconcile without reseeding"
    journal.write_text(json.dumps({"origin": args.url, "protected": protected, "cases": old_cases}, indent=2)+"\n")
report = {"origin": args.url, "scope": "real isolated loopback API and durable filesystem storage; not production, not physical iPhone/Safari", "sourceSha256": source_hash, "workflows": []}
case_id = references[0]["id"] if args.resume else None

with sync_playwright() as p:
    browser = p.chromium.launch()
    for device, viewport in [("desktop", {"width": 1440, "height": 1000}), ("phone", {"width": 393, "height": 852})]:
        context = browser.new_context(viewport=ViewportSize(width=viewport["width"], height=viewport["height"]), is_mobile=device == "phone", has_touch=device == "phone", device_scale_factor=1)
        page = context.new_page()
        errors = []
        requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append({"method": request.method, "url": request.url}))
        page.goto(args.url)
        expect(page.get_by_role("button", name="Start incident", exact=True)).to_be_enabled()
        page.get_by_role("button", name="Start incident", exact=True).click()
        if case_id is None:
            page.get_by_role("combobox", name="Source event", exact=True).select_option("reference:waterutil-fuel-v2")
            page.get_by_role("textbox", name="Case title", exact=True).fill("CyberAv3ngers / IOCONTROL · water utility & fuel terminal reference")
            page.get_by_role("combobox", name="Local triage priority", exact=True).select_option("medium")
            page.get_by_role("button", name="Create workspace case", exact=True).click()
            expect(page.get_by_text("Saved to workspace. No operational action or external notification was sent.", exact=True)).to_be_visible()
            rows = get("/v1/command/incidents")["incidents"]
            added = [case for case in rows if case["id"] not in old_cases]
            assert len(added) == 1
            case_id = added[0]["id"]
            (out / "reference-import-receipt.json").write_text(json.dumps({"origin": args.url, "caseId": case_id, "sourceSha256": source_hash}, indent=2)+"\n")
        else:
            page.get_by_role("combobox", name="Workspace case", exact=True).select_option(case_id)
        expect(page.get_by_role("combobox", name="Workspace case", exact=True)).to_have_value(case_id)
        reference = page.get_by_role("region", name="Reference investigation evidence", exact=True)
        expect(reference).to_be_visible()
        expect(reference.locator("[data-reference-asset-id]")).to_have_count(16)
        expect(reference.locator("[data-reference-phase]")).to_have_count(14)
        expect(page.get_by_role("checkbox")).to_have_count(8)
        expect(reference.get_by_text(source_hash, exact=True)).to_be_visible()
        assert "sk_live_" not in page.locator("body").inner_text()

        def layout(label):
            values = page.evaluate("() => ({viewport:document.documentElement.clientWidth, body:document.body.scrollWidth})")
            assert values["body"] <= values["viewport"], {"label":label, "widths":values}
            assert page.locator("h1").count() == 1

        layout("reference full case")
        reference.locator("header").scroll_into_view_if_needed()
        page.screenshot(path=str(out / f"{device}-reference-case.png"))
        for phase in (4, 5, 7, 10, 11, 13):
            detail = reference.locator(f"[data-reference-phase='{phase}']")
            detail.locator("summary").click()
            expect(detail.locator("p").first).to_be_visible()
            layout(f"phase {phase} expanded")
            detail.locator("summary").click()

        if device == "desktop":
            # Test storage behavior, not evidence completion. Restore the toggle.
            checkbox = page.get_by_role("checkbox").first
            if not checkbox.is_checked():
                checkbox.click()
            expect(checkbox).to_be_checked()
            expect(page.get_by_role("button", name="Refresh casework", exact=True)).to_be_enabled()
            assert get(f"/v1/command/incidents/{case_id}")["tasks"][0]["completed"] is True
            checkbox.click()
            expect(checkbox).not_to_be_checked()
            expect(page.get_by_role("button", name="Refresh casework", exact=True)).to_be_enabled()
            assert all(not task["completed"] for task in get(f"/v1/command/incidents/{case_id}")["tasks"])

        with page.expect_download() as downloaded:
            page.get_by_role("button", name="Download brief", exact=True).click()
        artifact = out / f"{device}-reference-brief.json"
        downloaded.value.save_as(str(artifact))
        brief = json.loads(artifact.read_text())
        assert brief["externalDelivery"] == "not_sent"
        assert brief["incident"] == get(f"/v1/command/incidents/{case_id}")
        assert brief["incident"]["eventSnapshot"]["referenceInvestigation"] == manifest
        assert "sk_live_" not in artifact.read_text()
        page.get_by_role("button", name="Open source evidence", exact=True).click()
        expect(page.get_by_role("heading", level=1, name="Event evidence", exact=True)).to_be_visible()
        expect(page.get_by_role("region", name="Reference investigation evidence", exact=True)).to_be_visible()
        layout("Evidence shortcut")
        evidence = page.get_by_role("region", name="Reference investigation evidence", exact=True)
        evidence.locator("header").scroll_into_view_if_needed()
        colors = evidence.locator(".reference-asset h3 code").first.evaluate("el => ({fg:getComputedStyle(el).color,bg:getComputedStyle(el.closest(\".reference-asset\")).backgroundColor})")
        assert colors == {"fg":"rgb(226, 232, 240)", "bg":"rgb(13, 23, 38)"}, colors
        page.screenshot(path=str(out / f"{device}-reference-evidence.png"))

        page.reload()
        expect(page.get_by_role("button", name="Start incident", exact=True)).to_be_enabled()
        page.get_by_role("button", name="Start incident", exact=True).click()
        page.get_by_role("combobox", name="Workspace case", exact=True).select_option(case_id)
        expect(page.get_by_role("region", name="Reference investigation evidence", exact=True)).to_be_visible()
        assert all(not task["completed"] for task in get(f"/v1/command/incidents/{case_id}")["tasks"])
        page.get_by_role("button", name="Refresh casework", exact=True).click()
        expect(page.get_by_role("button", name="Refresh casework", exact=True)).to_be_enabled()
        expect(page.get_by_role("combobox", name="Workspace case", exact=True)).to_have_value(case_id)
        layout("reload and refresh")
        assert not errors, errors
        assert all(urlparse(request["url"]).hostname in ("127.0.0.1", "localhost") for request in requests)
        if device == "phone":
            assert not any(request["method"] == "POST" for request in requests), "Phone read-back must not write"
        report["workflows"].append({"device":device, "caseId":case_id, "assets":16, "phases":14, "tasks":8, "reloadAndRefresh":True, "downloadReadback":True, "expandedPhaseOverflowChecks":6, "pageErrors":errors})
        context.close()
    browser.close()

for path, before in protected.items():
    assert get(path) == before, f"Protected state changed: {path}"
rows = {case["id"]:case for case in get("/v1/command/incidents")["incidents"]}
assert len(rows) == len(old_cases) + 1
for identifier, before in old_cases.items():
    assert rows[identifier] == before, f"Prior case changed: {identifier}"
case = rows[case_id]
assert case["eventSnapshot"]["referenceInvestigation"] == manifest
assert all(not task["completed"] for task in case["tasks"])
assert case["runId"] is None and not case["decisions"]
assert all(case["contextSnapshot"][key] is None for key in ("cyberAsset", "physicalAsset", "facility", "provider", "serviceArea"))
report.update({"caseId":case_id, "priorCaseCount":len(old_cases), "protectedFingerprints":{path:digest(value) for path,value in protected.items()}, "originalCasesUnchanged":True, "modelOntologyRunsProposalsUnchanged":True, "allEightTasksRemainOpen":True, "sourceIntegrityAndRedaction":True})
(out / "reference-acceptance.json").write_text(json.dumps(report,indent=2)+"\n")
(out / "saved-reference-case.json").write_text(json.dumps(case,indent=2,ensure_ascii=False)+"\n")
print(json.dumps(report,indent=2))

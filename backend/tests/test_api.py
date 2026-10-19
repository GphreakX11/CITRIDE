"""Test persisted user workflows and failure boundaries through HTTP."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy


import pytest
from fastapi.testclient import TestClient
from rdflib import Dataset, URIRef
from pyshacl import validate as shacl_validate

from citride.api import create_app
from citride.storage import BASELINE, NS
from citride.validation import _SHAPE_GRAPH


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "state")) as connection:
        yield connection


def proposed_dependency(client, backup=6, expected_revision=None):
    baseline = client.get("/v1/bootstrap").json()
    dependency = deepcopy(
        next(item for item in baseline["dependencies"] if item["id"] == "dep-a-x")
    )
    dependency["usableBackupMinHours"] = backup
    dependency["usableBackupMaxHours"] = backup
    dependency["assumptionNote"] = (
        f"Local synthetic analyst assumes {backup} hours of usable clean reserve."
    )
    result = client.post(
        "/v1/dependency-proposals",
        json={
            "dependency": dependency,
            "expectedBaselineRevision": expected_revision
            or baseline["baselineRevision"],
        },
    )
    assert result.status_code == 201, result.text
    return result.json()


def run(client, **overrides):
    result = client.post(
        "/v1/cascade-runs", json={"scenarioId": "unsafe-water", **overrides}
    )
    assert result.status_code == 201, result.text
    return result.json()


def dialysis(run_record):
    return next(
        impact for impact in run_record["impacts"] if impact["entityId"] == "dialysis-x"
    )


def test_bootstrap_telemetry_and_rdf_export(client):
    health = client.get("/health").json()
    assert {key: health[key] for key in ("status", "baselineRevision", "demoMode")} == {
        "status": "ok",
        "baselineRevision": 1,
        "demoMode": True,
    }
    assert health["now"] and health["resetEnabled"] is True
    assert "storyNow" not in health
    model = client.get("/v1/bootstrap").json()
    assert model["dependencies"] and model["sources"]
    streams = client.get("/v1/telemetry").json()["streams"]
    assert len(streams) >= 4
    assert all(stream["records"] and stream["sourceRef"] for stream in streams)
    exported = client.get("/v1/graph/export")
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("application/n-quads")
    dataset = Dataset().parse(data=exported.text, format="nquads")
    graph = dataset.graph(BASELINE)
    assert (
        URIRef("urn:citride:record:dep-a-x"),
        NS.provider,
        URIRef("urn:citride:record:utility-a"),
    ) in graph
    conforms, _, _ = shacl_validate(graph, shacl_graph=_SHAPE_GRAPH)
    assert conforms


def test_promoted_revision_refreshes_assertions_and_retains_immutable_run(
    client, tmp_path
):
    old = run(client)
    assert dialysis(old)["windowHours"] == [2, 4]
    old_dependency = next(
        item
        for item in old["baselineSnapshot"]["dependencies"]
        if item["id"] == "dep-a-x"
    )
    proposal = proposed_dependency(client)
    validation = client.post(f"/v1/dependency-proposals/{proposal['id']}/validate")
    assert validation.json()["valid"] is True, validation.text
    promoted = client.post(f"/v1/dependency-proposals/{proposal['id']}/promote")
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["baselineRevision"] == 2
    dependency = promoted.json()["dependency"]
    assert dependency["revision"] == 2
    baseline = client.get("/v1/bootstrap").json()
    assertions = {item["id"]: item for item in baseline["assumptions"]}
    assert assertions[dependency["parameterAssertionRefs"]["backup"]]["value"] == [6, 6]
    assert assertions[old_dependency["parameterAssertionRefs"]["backup"]]["value"] == [
        2,
        2,
    ]
    new = run(client)
    assert dialysis(new)["windowHours"] == [6, 8]
    assert new["baselineRevision"] == 2
    saved_old = client.get(f"/v1/cascade-runs/{old['id']}").json()
    assert saved_old == old
    explanation = client.get(
        "/v1/explain", params={"runId": old["id"], "impactId": dialysis(old)["id"]}
    ).json()
    assert explanation["dependencies"][0]["usableBackupMinHours"] == 2
    assert explanation["sources"]
    comparison = client.get(
        f"/v1/cascade-runs/{old['id']}/compare", params={"otherRunId": new["id"]}
    )
    assert comparison.status_code == 200, comparison.text
    assert any(
        change["entityId"] == "dialysis-x" and change["rightWindowHours"] == [6, 8]
        for change in comparison.json()["changes"]
    )
    restarted = TestClient(create_app(tmp_path / "state"))
    assert restarted.get("/health").json()["baselineRevision"] == 2
    assert restarted.get(f"/v1/cascade-runs/{old['id']}").json() == old


def test_what_if_is_source_labeled_and_never_changes_baseline(client):
    baseline = client.get("/v1/bootstrap").json()
    what_if = run(
        client,
        overrides=[
            {
                "dependencyId": "dep-a-x",
                "backupMinHours": 6,
                "backupMaxHours": 6,
                "note": "Synthetic additional independent reserve for workshop comparison.",
            }
        ],
    )
    assert dialysis(what_if)["windowHours"] == [6, 8]
    assert client.get("/v1/bootstrap").json() == baseline
    explanation = client.get(
        "/v1/explain",
        params={"runId": what_if["id"], "impactId": dialysis(what_if)["id"]},
    )
    assert explanation.status_code == 200, explanation.text
    detail = explanation.json()
    dependency = next(
        item for item in detail["dependencies"] if item["id"] == "dep-a-x"
    )
    assert dependency["usableBackupMinHours"] == 6
    assert dependency["baselineBackupHours"] == [2, 2]
    assert any(
        source["id"] in dialysis(what_if)["sourceRefs"]
        and source["evidenceCategory"] == "analyst_assumed"
        for source in detail["sources"]
    )


def test_proposal_revalidation_and_revision_conflicts(client):
    first, second = proposed_dependency(client, 4), proposed_dependency(client, 8)
    assert (
        client.post(f"/v1/dependency-proposals/{first['id']}/promote").status_code
        == 200
    )
    assert (
        client.post(f"/v1/dependency-proposals/{first['id']}/promote").status_code
        == 409
    )
    stale = client.post(f"/v1/dependency-proposals/{second['id']}/promote")
    assert stale.status_code == 409
    assert "revision" in stale.json()["detail"]
    assert len(client.get("/v1/dependency-proposals").json()["proposals"]) == 2
    assert (
        client.get(f"/v1/dependency-proposals/{second['id']}").json()["status"]
        == "draft"
    )


def test_invalid_domain_draft_can_be_reviewed_but_cannot_promote(client):
    baseline = client.get("/v1/bootstrap").json()
    invalid = deepcopy(baseline["dependencies"][0])
    invalid["provider"] = "missing-provider"
    invalid["usableBackupMaxHours"] = -1
    result = client.post(
        "/v1/dependency-proposals",
        json={"dependency": invalid, "expectedBaselineRevision": 1},
    )
    assert result.status_code == 201
    identifier = result.json()["id"]
    review = client.post(f"/v1/dependency-proposals/{identifier}/validate").json()
    assert review["status"] == "needs_review"
    assert not review["valid"]
    assert any("provider" in message for message in review["errors"])
    assert (
        client.post(f"/v1/dependency-proposals/{identifier}/promote").status_code == 422
    )
    assert client.get("/v1/bootstrap").json() == baseline


@pytest.mark.parametrize(
    "payload",
    [
        {"scenarioId": "unsafe-water", "evaluationHour": -1},
        {"scenarioId": "unsafe-water", "horizonHours": 0},
        {"scenarioId": "unsafe-water", "evaluationHour": 13, "horizonHours": 12},
        {"scenarioId": "unsafe-water", "evaluationHour": True},
        {"scenarioId": "unsafe-water", "horizonHours": "12"},
        {"scenarioId": "unsafe-water", "seed": {"provider": "invented"}},
        {
            "scenarioId": "unsafe-water",
            "overrides": [
                {
                    "dependencyId": "dep-a-x",
                    "backupMinHours": 8,
                    "backupMaxHours": 6,
                    "note": "x",
                }
            ],
        },
        {
            "scenarioId": "unsafe-water",
            "overrides": [
                {
                    "dependencyId": "dep-a-x",
                    "backupMinHours": 6,
                    "backupMaxHours": 6,
                    "note": " ",
                }
            ],
        },
    ],
)
def test_reject_bad_run_requests(client, payload):
    before = client.get("/v1/cascade-runs").json()["runs"]
    assert len(before) == 2 and all(run["id"].startswith("preliminary-") for run in before)
    assert client.post("/v1/cascade-runs", json=payload).status_code == 422
    assert client.get("/v1/cascade-runs").json()["runs"] == before


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_reject_nonfinite_request_numbers(client, value):
    # Sending raw JSON tests nonstandard input accepted by Python's decoder.
    response = client.post(
        "/v1/cascade-runs",
        content='{"scenarioId":"unsafe-water","evaluationHour":' + value + "}",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_identifiers_and_missing_records_have_clear_errors(client):
    assert (
        client.post(
            "/v1/dependency-proposals",
            json={"dependency": {"id": "bad/id"}, "expectedBaselineRevision": 1},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/v1/dependency-proposals",
            json={"dependency": {"id": "safe"}, "expectedBaselineRevision": True},
        ).status_code
        == 422
    )
    assert client.get("/v1/cascade-runs/missing-run").status_code == 404
    assert client.get("/v1/dependency-proposals/missing-proposal").status_code == 404
    assert (
        client.post(
            "/v1/cascade-runs", json={"scenarioId": "not-configured"}
        ).status_code
        == 404
    )
    assert (
        client.get(
            "/v1/explain", params={"runId": "bad id", "impactId": "impact-x"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/v1/cascade-runs",
            json={
                "scenarioId": "unsafe-water",
                "overrides": [
                    {
                        "dependencyId": "not-a-dependency",
                        "backupMinHours": 1,
                        "backupMaxHours": 2,
                        "note": "demo",
                    }
                ],
            },
        ).status_code
        == 422
    )


def test_concurrent_promotions_do_not_lose_revision_checks(client):
    left, right = proposed_dependency(client, 4), proposed_dependency(client, 6)
    with ThreadPoolExecutor(max_workers=2) as workers:
        outcomes = list(
            workers.map(
                lambda item: (
                    client.post(
                        f"/v1/dependency-proposals/{item['id']}/promote"
                    ).status_code
                ),
                [left, right],
            )
        )
    assert sorted(outcomes) == [200, 409]
    assert client.get("/health").json()["baselineRevision"] == 2


def test_run_export_has_separate_snapshot_graph(client):
    saved = run(client)
    exported = Dataset().parse(
        data=client.get("/v1/graph/export").text, format="nquads"
    )
    named = exported.graph(URIRef("urn:citride:graph:run:" + saved["id"]))
    assert (
        URIRef("urn:citride:record:dep-a-x"),
        NS.provider,
        URIRef("urn:citride:record:utility-a"),
    ) in named


def test_confirmed_new_relationship_activates_spatial_candidate(client):
    before = run(client)
    assert not any(impact["entityId"] == "facility-q" for impact in before["impacts"])
    baseline = client.get("/v1/bootstrap").json()
    dependency = deepcopy(baseline["dependencies"][0])
    dependency.update(
        {
            "id": "dep-a-q",
            "revision": 1,
            "dependent": "facility-q",
            "dependentFunction": "q-safe-water",
            "lossTypes": ["unsafe_water"],
            "validForLossTypes": ["unsafe_water"],
            "usableBackupMinHours": 1,
            "usableBackupMaxHours": 1,
            "assumptionNote": "Local analyst confirms a wholly fictional water dependency for Facility Q.",
        }
    )
    dependency.pop("parameterAssertionRefs", None)
    proposal = client.post(
        "/v1/dependency-proposals",
        json={"dependency": dependency, "expectedBaselineRevision": 1},
    )
    assert proposal.status_code == 201, proposal.text
    identifier = proposal.json()["id"]
    review = client.post(f"/v1/dependency-proposals/{identifier}/validate")
    assert review.json()["valid"], review.text
    assert (
        client.post(f"/v1/dependency-proposals/{identifier}/promote").status_code == 200
    )
    after = run(client)
    assert any(impact["entityId"] == "facility-q" for impact in after["impacts"])
    assert client.get(f"/v1/cascade-runs/{before['id']}").json() == before

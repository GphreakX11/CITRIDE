"""Hosted requests require access control and durable storage."""

import base64
import os
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from citride.api import create_app
from citride.storage import StorageUnavailableError


@pytest.fixture(autouse=True)
def clean_hosted_environment(monkeypatch):
    for name in ("VERCEL", "VERCEL_ENV", "CITRIDE_DATABASE_URL", "DATABASE_URL", "CITRIDE_STATE_KEY", "CITRIDE_DEMO_PASSWORD", "CITRIDE_DEMO_USERNAME"):
        monkeypatch.delenv(name, raising=False)


def authorize(client, username="demo", password="test-only-demo-password"):
    client.headers["Authorization"] = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()


@pytest.mark.parametrize("path", ["/health", "/v1/bootstrap", "/v1/telemetry", "/v1/graph/export", "/v1/ontology", "/docs", "/openapi.json", "/v1/login"])
def test_protected_routes_do_not_initialize_or_expose_model_without_login(tmp_path, monkeypatch, path):
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", "test-only-demo-password")
    state = tmp_path / "state"
    with TestClient(create_app(state)) as client:
        response = client.get(path)
        assert response.status_code == 401
        assert response.headers["www-authenticate"].startswith("Basic ")
        assert response.headers["cache-control"] == "no-store"
        assert not state.exists()


@pytest.mark.parametrize("authorization", ["Basic broken!", "Bearer token", "Basic " + base64.b64encode(b"demo:wrong").decode(), "Basic " + base64.b64encode(b"other:test-only-demo-password").decode()])
def test_invalid_login_is_rejected_before_model_loading(tmp_path, monkeypatch, authorization):
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", "test-only-demo-password")
    with TestClient(create_app(tmp_path / "state")) as client:
        assert client.get("/health", headers={"Authorization": authorization}).status_code == 401


def test_signed_in_requests_are_private_and_login_redirects_to_frontend(tmp_path, monkeypatch):
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", "test-only-demo-password")
    with TestClient(create_app(tmp_path / "state")) as client:
        authorize(client)
        health = client.get("/health")
        assert health.status_code == 200
        assert health.headers["cache-control"] == "private, no-store"
        assert "Authorization" in health.headers["vary"]
        login = client.get("/v1/login", follow_redirects=False)
        assert login.status_code == 303 and login.headers["location"] == "/"
        assert client.get("/v1/bootstrap").json()["baselineRevision"] == 1


def test_browser_mutations_cannot_use_cross_site_or_null_origin(tmp_path, monkeypatch):
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", "test-only-demo-password")
    with TestClient(create_app(tmp_path / "state")) as client:
        authorize(client)
        for origin in ("https://other.example", "null", "http://testserver.other.example", "http://testserver/path"):
            response = client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"}, headers={"Origin": origin})
            assert response.status_code == 403
        assert client.get("/v1/cascade-runs").json()["runs"] == []
        response = client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"}, headers={"Origin": "http://testserver"})
        assert response.status_code == 201


def test_vercel_fails_closed_without_password_or_durable_connection(tmp_path, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    state = tmp_path / "state"
    with TestClient(create_app(state)) as client:
        response = client.get("/health")
        assert response.status_code == 503 and "CITRIDE_DEMO_PASSWORD" in response.text
        assert not state.exists()
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", "test-only-demo-password")
    with TestClient(create_app(state)) as client:
        authorize(client)
        response = client.get("/health")
        assert response.status_code == 503 and "DATABASE_URL" in response.text
        assert not state.exists()


def test_later_storage_failure_returns_generic_503_without_exception_details(tmp_path, monkeypatch):
    with TestClient(create_app(tmp_path / "state")) as client:
        assert client.get("/health").status_code == 200

        def unavailable(_self):
            raise StorageUnavailableError("internal connection details must not be returned")

        monkeypatch.setattr("citride.storage.Repository.baseline", unavailable)
        response = client.get("/v1/bootstrap")
        assert response.status_code == 503
        assert response.json() == {"detail": "Demo storage is temporarily unavailable."}
        assert "internal connection" not in response.text


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Set TEST_DATABASE_URL for real Postgres integration")
def test_hosted_api_survives_new_instances_and_preserves_owl_proofs(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", "test-only-demo-password")
    monkeypatch.setenv("CITRIDE_DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    key = "hosted-api-test-" + uuid4().hex
    monkeypatch.setenv("CITRIDE_STATE_KEY", key)
    try:
        with TestClient(create_app()) as first:
            authorize(first)
            baseline = first.get("/v1/bootstrap").json()
            cascade_response = first.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"})
            assert cascade_response.status_code == 201
            cascade = cascade_response.json()
            assert {impact["entityId"]: impact["windowHours"] for impact in cascade["impacts"]} == {
                "dialysis-x": [2, 4], "hospital-y": [4, 8], "nursing-z": [1, 4],
            }
            inference_response = first.post("/v1/inference-runs", json={"expectedBaselineRevision": 1})
            assert inference_response.status_code == 201
            inference = inference_response.json()
            fact = next(fact for fact in inference["inferredFacts"] if fact["subject"]["id"] == "event-dosing" and fact["predicate"]["iri"] == "urn:citride:seenAtFacility" and fact["object"]["id"] == "utility-a")
            proof_path = f"/v1/inference-runs/{inference['id']}/facts/{fact['id']}"
            proof = first.get(proof_path).json()
            assert proof["sources"] and proof["proofFacts"] and proof["axioms"]
        with TestClient(create_app()) as second:
            authorize(second)
            assert second.get("/v1/bootstrap").json() == baseline
            assert second.get(f"/v1/cascade-runs/{cascade['id']}").json() == cascade
            assert second.get(f"/v1/inference-runs/{inference['id']}").json() == inference
            assert second.get(proof_path).json() == proof
    finally:
        import psycopg

        with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as connection:
            connection.execute("DELETE FROM citride_state WHERE state_key = %s", (key,))

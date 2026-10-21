"""Offline regressions for deployment access and pre-body mutation guards."""

import asyncio
import base64
import os
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from citride.access import DemoAccessMiddleware
from citride.api import create_app


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in tuple(os.environ):
        if name.startswith(("CITRIDE_", "VERCEL")) or name in {"DATABASE_URL", "TEST_DATABASE_URL"}:
            monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize("hosted", [False, True])
@pytest.mark.parametrize("flag", [None, "0", "false", "1", "true", "", "TRUE", "yes", " 1", "2"])
@pytest.mark.parametrize("password", [None, "", " \t "])
def test_required_auth_configuration_matrix(tmp_path, monkeypatch, hosted, flag, password):
    if hosted:
        monkeypatch.setenv("VERCEL", "1")
    if flag is not None:
        monkeypatch.setenv("CITRIDE_REQUIRE_AUTH", flag)
    if password is not None:
        monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", password)
    invalid = flag not in {None, "0", "false", "1", "true"}
    denied = hosted or invalid or flag in {"1", "true"}
    state = tmp_path / "state"
    with TestClient(create_app(state)) as client:
        # This route needs no repository; denial must still precede routing.
        response = client.get("/v1/login", follow_redirects=False)
        assert response.status_code == (503 if denied else 303)
        if denied:
            assert response.json()["code"] == "auth_not_configured"
            response = client.post("/v1/inference-runs", content="not-json")
            assert response.status_code == 503
    assert not state.exists()


@pytest.mark.parametrize("flag", ["1", "true", "0", "false", "invalid"])
@pytest.mark.parametrize("hosted", [False, True])
def test_configured_password_never_bypasses_invalid_flag(tmp_path, monkeypatch, flag, hosted):
    monkeypatch.setenv("CITRIDE_REQUIRE_AUTH", flag)
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", " " + uuid4().hex + ": \t")
    if hosted:
        monkeypatch.setenv("VERCEL", "1")
    state = tmp_path / "state"
    with TestClient(create_app(state)) as client:
        response = client.get("/v1/login", follow_redirects=False)
        assert response.status_code == (503 if flag == "invalid" else 401)
    assert not state.exists()


@pytest.mark.parametrize("username", ["", " \t", "invalid:name"])
def test_invalid_configured_username_fails_closed(tmp_path, monkeypatch, username):
    monkeypatch.setenv("CITRIDE_REQUIRE_AUTH", "1")
    monkeypatch.setenv("CITRIDE_DEMO_USERNAME", username)
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", uuid4().hex)
    with TestClient(create_app(tmp_path / "state")) as client:
        assert client.get("/v1/login").status_code == 503
    assert not (tmp_path / "state").exists()


@pytest.mark.parametrize("username", ["demo", " reviewer é "])
def test_exact_nonblank_credentials_and_no_fallback(tmp_path, monkeypatch, username):
    password = " " + uuid4().hex + ": é \t"
    monkeypatch.setenv("CITRIDE_REQUIRE_AUTH", "1")
    monkeypatch.setenv("CITRIDE_DEMO_USERNAME", username)
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", password)
    state = tmp_path / "state"
    with TestClient(create_app(state)) as client:
        for pair in ((username, password.strip()), (username.strip(), "wrong")):
            token = base64.b64encode(":".join(pair).encode()).decode()
            assert client.get("/health", headers={"Authorization": "Basic " + token}).status_code == 401
        token = base64.b64encode(f"{username}:{password}".encode()).decode()
        response = client.get("/health", headers={"Authorization": "Basic " + token})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"


BAD_ORIGINS = [
    "https://outside.example", "null", "", "http://testserver/path", "http://testserver/",
    "http://testserver?x", "http://testserver#x", "http://user@testserver",
    "http://testserver:bad", "http://testserver:99999", "http://[broken",
    "http://testserver\\@outside.example", "http://testserver http://outside.example",
    "http://testserver\t", "http://testserver?", "http://testserver#",
    "https://testserver", "http://testserver.other.example",
]


@pytest.mark.parametrize("configured", [False, True])
@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize("origin", BAD_ORIGINS)
def test_origin_denial_precedes_body_and_state(tmp_path, monkeypatch, configured, method, origin):
    password = uuid4().hex
    if configured:
        monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", password)
    state = tmp_path / "state"
    with TestClient(create_app(state)) as client:
        if configured:
            client.auth = ("demo", password)
        response = client.request(method, "/v1/inference-runs", content="not-json", headers={"Origin": origin})
        assert response.status_code == 403
        assert response.headers["cache-control"] == "no-store"
        assert "access-control-allow-origin" not in response.headers
    assert not state.exists()


def test_denied_middleware_does_not_receive_body():
    async def fail(*_args):
        raise AssertionError("Downstream application or body was accessed")

    async def probe():
        messages = []
        async def send(message):
            messages.append(message)
        middleware = DemoAccessMiddleware(fail, "demo", None, False)
        await middleware({"type": "http", "method": "POST", "scheme": "http", "headers": [(b"host", b"localhost:8000"), (b"origin", b"null")]}, fail, send)
        assert messages[0]["status"] == 403
    asyncio.run(probe())


@pytest.mark.parametrize("configured", [False, True])
def test_missing_origin_fetch_metadata_and_cli(tmp_path, monkeypatch, configured):
    password = uuid4().hex
    if configured:
        monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", password)
    state = tmp_path / "state"
    with TestClient(create_app(state)) as client:
        if configured:
            client.auth = ("demo", password)
        denied = client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"}, headers={"Sec-Fetch-Site": "cross-site"})
        assert denied.status_code == 403
        assert not state.exists()
        # Missing metadata preserves nonbrowser CLI calls; it is not authentication.
        for headers in ({}, {"Origin": "http://testserver"}, {"Sec-Fetch-Site": "same-origin"}):
            assert client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"}, headers=headers).status_code == 201


@pytest.mark.parametrize("base_url", ["http://localhost:5173", "http://127.0.0.1:5174", "http://[::1]:5173"])
def test_documented_vite_preserved_host_workflow(tmp_path, base_url):
    with TestClient(create_app(tmp_path / "state"), base_url=base_url) as client:
        # Vite's existing proxy keeps the frontend Host, not the target port.
        assert client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"}, headers={"Origin": base_url}).status_code == 201
        assert client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"}, headers={"Origin": "http://localhost:9999"}).status_code == 403


def test_forwarded_headers_cannot_override_origin_or_auth(tmp_path, monkeypatch):
    state = tmp_path / "state"
    headers = {"Origin": "http://outside.example", "X-Forwarded-Host": "outside.example", "X-Forwarded-Proto": "http", "Sec-Fetch-Site": "same-origin"}
    with TestClient(create_app(state)) as client:
        assert client.post("/v1/inference-runs", headers=headers).status_code == 403
    monkeypatch.setenv("CITRIDE_REQUIRE_AUTH", "1")
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", uuid4().hex)
    with TestClient(create_app(state)) as client:
        assert client.post("/v1/inference-runs", headers={"Sec-Fetch-Site": "same-origin"}).status_code == 401
    assert not state.exists()


@pytest.mark.parametrize("configured", [False, True])
def test_real_local_form_promotion_cannot_mutate_cross_site(tmp_path, monkeypatch, configured):
    password = uuid4().hex
    if configured:
        monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", password)
    with TestClient(create_app(tmp_path / "state")) as client:
        if configured:
            client.auth = ("demo", password)
        before = client.get("/v1/bootstrap").json()
        dependency = deepcopy(next(item for item in before["dependencies"] if item["id"] == "dep-a-x"))
        dependency["usableBackupMinHours"] = dependency["usableBackupMaxHours"] = 6
        staged = client.post("/v1/dependency-proposals", json={"dependency": dependency, "expectedBaselineRevision": before["baselineRevision"]})
        assert staged.status_code == 201
        path = f"/v1/dependency-proposals/{staged.json()['id']}/promote"
        form = {"Content-Type": "application/x-www-form-urlencoded", "Origin": "https://outside.example", "Sec-Fetch-Site": "cross-site"}
        assert client.post(path, content=b"", headers=form).status_code == 403
        assert client.get("/v1/bootstrap").json() == before
        form.update({"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"})
        assert client.post(path, content=b"", headers=form).status_code == 200
        assert client.get("/v1/bootstrap").json()["baselineRevision"] == before["baselineRevision"] + 1


@pytest.mark.parametrize("kind", ["missing", "malformed"])
def test_initial_model_failure_is_generic(tmp_path, kind):
    fixture = tmp_path / "private-model.json"
    if kind == "malformed":
        fixture.write_text("invalid-model-marker", encoding="utf-8")
    with TestClient(create_app(tmp_path / "state", scenario_path=fixture)) as client:
        response = client.get("/v1/bootstrap")
        assert response.status_code == 503
        assert response.json() == {"detail": "Demo model is temporarily unavailable."}
        assert str(fixture) not in response.text


@pytest.mark.parametrize("headers", [
    {"Origin": "https://outside.example", "Content-Type": "application/x-www-form-urlencoded"},
    {"Sec-Fetch-Site": "cross-site", "Content-Type": "application/x-www-form-urlencoded"},
])
@pytest.mark.parametrize("configured", [False, True])
def test_empty_inference_form_cannot_create_any_state(tmp_path, monkeypatch, headers, configured):
    password = uuid4().hex
    if configured:
        monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", password)
    state = tmp_path / "state"
    with TestClient(create_app(state)) as client:
        if configured:
            client.auth = ("demo", password)
        assert client.post("/v1/inference-runs", content=b"", headers=headers).status_code == 403
        assert not state.exists()


@pytest.mark.parametrize("headers", [
    [("Origin", "http://testserver"), ("Origin", "http://testserver")],
    [("Origin", "http://testserver"), ("Host", "testserver"), ("Host", "testserver")],
    {"Origin": "http://testserver", "Sec-Fetch-Site": "cross-site"},
])
def test_ambiguous_or_inconsistent_origin_headers_are_denied(tmp_path, headers):
    with TestClient(create_app(tmp_path / "state")) as client:
        assert client.post("/v1/inference-runs", headers=headers).status_code == 403
    assert not (tmp_path / "state").exists()


@pytest.mark.parametrize("flag", ["0", "false", "1", "true"])
def test_vercel_authentication_and_https_origin_remain_mandatory(tmp_path, monkeypatch, flag):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("CITRIDE_REQUIRE_AUTH", flag)
    password = uuid4().hex
    monkeypatch.setenv("CITRIDE_DEMO_PASSWORD", password)
    with TestClient(create_app(tmp_path / "state")) as client:
        assert client.get("/v1/login").status_code == 401
        client.auth = ("demo", password)
        # Vercel's external HTTPS origin is enforced even over internal HTTP.
        assert client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"}, headers={"Origin": "http://testserver"}).status_code == 403
        # Middleware access succeeds, then hosted storage setup still denies.
        response = client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water"}, headers={"Origin": "https://testserver"})
        assert response.status_code == 503
        assert response.headers["x-citride-setup-required"] == "database_not_configured"


def test_unreadable_initial_model_is_generic(tmp_path, monkeypatch):
    from citride.storage import Repository

    def unreadable(_self):
        raise PermissionError("private-initialization-path-marker")

    monkeypatch.setattr(Repository, "_seed_dataset", unreadable)
    with TestClient(create_app(tmp_path / "state")) as client:
        response = client.get("/v1/bootstrap")
        assert response.status_code == 503
        assert response.json() == {"detail": "Demo model is temporarily unavailable."}


def test_malformed_stored_rdf_is_generic_and_not_overwritten(tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    stored = state / "citride.nq"
    original = b"private-malformed-rdf-marker"
    stored.write_bytes(original)
    with TestClient(create_app(state)) as client:
        response = client.get("/v1/bootstrap")
        assert response.status_code == 503
        assert response.json() == {"detail": "Demo model is temporarily unavailable."}
    assert stored.read_bytes() == original


def test_discriminator_diagnostics_do_not_reflect_submitted_tag(tmp_path):
    marker = "private-" + uuid4().hex
    with TestClient(create_app(tmp_path / "state")) as client:
        for payload, kind in (({"action": marker}, "union_tag_invalid"), ({}, "union_tag_not_found")):
            response = client.post("/v1/command/incidents/missing/actions", json=payload)
            assert response.status_code == 422
            assert marker not in response.text
            issue = response.json()["detail"][0]
            assert set(issue) == {"type", "loc", "msg"}
            assert issue["type"] == kind and issue["loc"] == ["body"]
        response = client.post("/v1/cascade-runs", json={"scenarioId": "unsafe-water", "evaluationHour": 13, "horizonHours": 12})
        assert response.status_code == 422
        assert "Evaluation hour must not exceed horizon" in response.text

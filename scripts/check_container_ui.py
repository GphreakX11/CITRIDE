#!/usr/bin/env python3
"""Exercise the actual runtime image over HTTP; no app/development imports required.

Build first: docker build -f backend/Dockerfile --target runtime -t citride:ci .
Then: python scripts/check_container_ui.py --image citride:ci
Only disposable, loopback-published containers are created. No host state is mounted.
Passwords are random, process-local, and never printed or put in command arguments.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
from html.parser import HTMLParser
import json
import os
import secrets
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.root = False
        self.scripts: list[str] = []
        self.styles: list[str] = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.root |= attrs.get("id") == "root"
        source = attrs.get("src")
        stylesheet = attrs.get("href")
        if tag == "script" and source:
            self.scripts.append(source)
        if tag == "link" and attrs.get("rel") == "stylesheet" and stylesheet:
            self.styles.append(stylesheet)


def docker(*args, env=None):
    result = subprocess.run(["docker", *args], env=env, capture_output=True, text=True, timeout=90)
    if result.returncode:
        # Do not dump inspect payloads, process environments, or container logs.
        raise RuntimeError(f"docker {args[0]} failed (exit {result.returncode})")
    return result.stdout.strip()


def get(base, path, credential=None):
    headers = {}
    if credential:
        headers["Authorization"] = "Basic " + base64.b64encode(credential.encode()).decode()
    request = Request(urljoin(base + "/", path), headers=headers)
    try:
        with urlopen(request, timeout=8) as response:
            return response.status, response.headers, response.read()
    except HTTPError as response:
        return response.code, response.headers, response.read()


def wait_ready(base, status, credential=None):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            observed, _, _ = get(base, "/health", credential)
            if observed == status:
                return
        except (URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(0.25)
    raise RuntimeError(f"Container never returned expected readiness HTTP {status}")


@contextmanager
def running(image, password=None):
    name = "citride-ui-smoke-" + uuid4().hex[:12]
    environment = os.environ.copy()
    # No inherited application settings or credentials are forwarded into Docker.
    options = []
    if password is not None:
        environment["CITRIDE_DEMO_PASSWORD"] = password
        options = ["--env", "CITRIDE_DEMO_PASSWORD"]
    try:
        docker(
            "run", "--detach", "--rm", "--name", name,
            "--label", "citride.container-ui-smoke=true",
            "--publish", "127.0.0.1::8000", "--memory", "768m", "--cpus", "1",
            "--pids-limit", "128", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges", *options, image,
            env=environment,
        )
        binding = docker("port", name, "8000/tcp").splitlines()[0]
        if not binding.startswith("127.0.0.1:"):
            raise RuntimeError("Smoke container was not bound to loopback")
        yield name, "http://" + binding
    finally:
        # Delete only this test's uniquely named container, including after failure.
        subprocess.run(["docker", "rm", "--force", name], capture_output=True, timeout=30)


def check(image):
    with running(image) as (_, base):
        wait_ready(base, 503)
        status, _, _ = get(base, "/")
        if status != 503:
            raise RuntimeError("Runtime did not fail closed without a password")
    print("PASS: default runtime refuses missing authentication configuration")

    password = secrets.token_urlsafe(32)
    credential = "demo:" + password
    with running(image, password) as (name, base):
        wait_ready(base, 200, credential)
        for route in ("/", "/v1/bootstrap"):
            if get(base, route)[0] != 401 or get(base, route, "demo:wrong")[0] != 401:
                raise RuntimeError("Runtime did not reject anonymous or incorrect login")
        print("PASS: anonymous and incorrect credentials denied for UI and API")
        status, headers, body = get(base, "/", credential)
        if status != 200 or "text/html" not in headers.get("Content-Type", ""):
            raise RuntimeError(f"Runtime homepage is not HTML (HTTP {status}); frontend/dist may be missing")
        page = PageAssets()
        page.feed(body.decode("utf-8"))
        if not page.root or not page.scripts or not page.styles:
            raise RuntimeError("Runtime homepage lacks the React root or built JS/CSS")
        print("PASS: authenticated homepage contains the built application")
        for assets, content_types in (
            (page.scripts, ("text/javascript", "application/javascript")),
            (page.styles, ("text/css",)),
        ):
            for path in assets:
                target = urljoin(base + "/", path)
                if urlsplit(target).netloc != urlsplit(base).netloc or urlsplit(target).scheme != "http":
                    raise RuntimeError("Application references an external script or stylesheet")
                status, headers, content = get(base, target, credential)
                if status != 200 or not content or not headers.get("Content-Type", "").startswith(content_types):
                    raise RuntimeError("A built application asset is missing or served as fallback HTML")
        print(f"PASS: {len(page.scripts)} JS and {len(page.styles)} CSS assets served with correct MIME types")
        for route in ("/?mode=command&view=command", "/?mode=analyst&view=overview"):
            status, headers, content = get(base, route, credential)
            if status != 200 or content != body:
                raise RuntimeError("Command/Analyst entry URL did not serve the application")
        print("PASS: Command and Analyst entry URLs serve the application shell")
        status, headers, content = get(base, "/v1/bootstrap", credential)
        if status != 200 or "baselineRevision" not in json.loads(content):
            raise RuntimeError("Packaged backend and seed data did not initialize")
        if get(base, "/v1/not-a-real-endpoint", credential)[0] != 404:
            raise RuntimeError("SPA fallback incorrectly swallowed an unknown API route")
        print("PASS: real backend bootstrap and API/fallback separation")
        identity = docker("exec", name, "python", "-c", "import os; print(os.getuid()); print(os.environ.get('CITRIDE_REQUIRE_AUTH', ''))").splitlines()
        if identity != ["10001", "1"]:
            raise RuntimeError("Runtime lost the non-root or mandatory-auth default")
        print("PASS: runtime UID 10001 and mandatory-auth default preserved")
    print("PASS: disposable containers removed; no host state mounted")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Already built runtime image, not the verification stage")
    args = parser.parse_args()
    try:
        check(args.image)
    except (RuntimeError, OSError, ValueError, TimeoutError, subprocess.SubprocessError) as error:
        parser.exit(1, f"FAIL: {error}\n")


if __name__ == "__main__":
    main()

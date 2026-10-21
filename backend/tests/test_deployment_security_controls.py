"""Deployment-template regression checks; no container or live service is started."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DeploymentSecurityControls(unittest.TestCase):
    def test_locked_certifi_uses_ca_incident_fixed_bundle(self):
        import tomllib

        lock = tomllib.loads((ROOT / "backend/uv.lock").read_text())
        certifi = next(package for package in lock["package"] if package["name"] == "certifi")
        self.assertEqual(certifi["version"], "2026.10.19")

    def test_docker_bootstrap_pins_patched_installer_before_uv(self):
        docker = (ROOT / "backend/Dockerfile").read_text()
        logical_lines = docker.replace("\\\n", " ").splitlines()
        bootstrap = next(line[4:] for line in logical_lines if line.startswith("RUN pip "))
        self.assertIn("pip==26.2.2", bootstrap)
        helper_copy = "COPY backend/scripts/harden_ca.py /app/backend/scripts/harden_ca.py"
        prune = "RUN CITRIDE_CONTAINER_CA_BUILD=1 python /app/backend/scripts/harden_ca.py bootstrap"
        self.assertIn(helper_copy, docker)
        self.assertIn(prune, docker)
        self.assertLess(docker.index(helper_copy), docker.index(prune))
        self.assertLess(docker.index(prune), docker.index("RUN pip "))
        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory)
            log = scratch / "calls.jsonl"
            stub = (
                f"#!{sys.executable}\n"
                "import json, os, sys\n"
                "from pathlib import Path\n"
                "with open(os.environ['DEPLOYMENT_TEST_LOG'], 'a') as stream:\n"
                " stream.write(json.dumps([Path(sys.argv[0]).name] + sys.argv[1:]) + '\\n')\n"
            )
            for name in ("pip", "uv", "python"):
                executable = scratch / name
                executable.write_text(stub)
                executable.chmod(0o755)
            result = subprocess.run(
                ["/bin/bash", "-c", bootstrap],
                env={"PATH": str(scratch) + os.pathsep + "/usr/bin:/bin", "DEPLOYMENT_TEST_LOG": str(log)},
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual(calls, [
                ["pip", "--disable-pip-version-check", "install", "--no-cache-dir", "--only-binary=:all:", "--upgrade", "pip==26.2.2"],
                ["python", "/app/backend/scripts/harden_ca.py", "verify"],
                ["pip", "--disable-pip-version-check", "install", "--no-cache-dir", "--only-binary=:all:", "uv==0.13.4"],
                ["uv", "sync", "--locked", "--no-dev", "--project", "/app/backend"],
            ])

    def test_ci_pins_ca_incident_fixed_uv(self):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertTrue(
            re.search(r"setup-uv@v6\s+with:\s+version: ['\"]0\.13\.4['\"]", workflow),
            "CI must explicitly pin the reviewed CA-incident-fixed uv release",
        )

    def test_setup_disables_dependency_hooks_and_still_builds(self):
        # Stub every setup executable: exercise shell argument flow without installs.
        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory)
            log = scratch / "calls.jsonl"
            ca_bundle = scratch / "reviewed-public-ca.pem"
            ca_bundle.write_text("public-CA argument fixture; no TLS client is executed")
            stub = (
                f"#!{sys.executable}\n"
                "import json, os, sys\n"
                "from pathlib import Path\n"
                "with open(os.environ['DEPLOYMENT_TEST_LOG'], 'a') as stream:\n"
                " stream.write(json.dumps([Path(sys.argv[0]).name] + sys.argv[1:]) + '\\n')\n"
                "if Path(sys.argv[0]).name == 'uv' and sys.argv[-1:] == ['certifi-path']:\n"
                " print(os.environ['DEPLOYMENT_TEST_CA_BUNDLE'])\n"
            )
            for name in ("npm", "uv", "python"):
                executable = scratch / name
                executable.write_text(stub)
                executable.chmod(0o755)
            environment = {
                "PATH": str(scratch) + os.pathsep + "/usr/bin:/bin",
                "DEPLOYMENT_TEST_LOG": str(log),
                "DEPLOYMENT_TEST_CA_BUNDLE": str(ca_bundle),
            }
            result = subprocess.run(
                ["/bin/bash", str(ROOT / "scripts/setup.sh")],
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            installs = [call for call in calls if call[:2] == ["npm", "ci"]]
            self.assertEqual(len(installs), 1)
            self.assertIn("--ignore-scripts", installs[0])
            self.assertIn("--strict-ssl=true", installs[0])
            self.assertIn("--cafile", installs[0])
            self.assertEqual(installs[0][installs[0].index("--cafile") + 1], str(ca_bundle))
            gate = ["python", "backend/scripts/harden_ca.py", "require-uv"]
            self.assertIn(gate, calls)
            sync = next(call for call in calls if call[:2] == ["uv", "sync"])
            self.assertLess(calls.index(gate), calls.index(sync))
            self.assertIn("--locked", sync)
            self.assertTrue(any(call[0] == "uv" and call[-1] == "certifi-path" for call in calls))
            self.assertEqual(calls[-1], ["npm", "run", "build", "--prefix", "frontend"])
            self.assertNotIn(["npm", "rebuild"], calls)

    def test_network_runtime_requires_auth_and_has_narrow_writable_state(self):
        docker = (ROOT / "backend/Dockerfile").read_text()
        self.assertIn("ENV CITRIDE_REQUIRE_AUTH=1", docker)
        self.assertRegex(docker, r"(?m)^RUN .*groupadd --gid 10001")
        self.assertIn("useradd --uid 10001 --gid 10001", docker)
        self.assertIn("mkdir -p /app/.local", docker)
        self.assertIn("chown 10001:10001 /app/.local", docker)
        self.assertNotRegex(docker, r"chown\s+(?:-R\s+)?10001:10001\s+/app(?:\s|$)")
        stages = re.split(r"(?m)^FROM ", docker)
        runtime = next(stage for stage in stages if stage.splitlines()[0].endswith(" AS runtime"))
        self.assertIn("ENV CITRIDE_REQUIRE_AUTH=1", runtime)
        dependencies = next(stage for stage in stages if stage.splitlines()[0].endswith(" AS dependencies"))
        self.assertNotIn("CITRIDE_REQUIRE_AUTH", dependencies)
        self.assertIn("USER 10001:10001", runtime)
        self.assertIn('"--host", "0.0.0.0"', runtime)
        self.assertLess(runtime.index("USER 10001:10001"), runtime.index("CMD "))

    def test_verification_installs_dev_dependencies_before_dropping_privilege(self):
        docker = (ROOT / "backend/Dockerfile").read_text()
        verification = docker.split("FROM dependencies AS verification", 1)[1]
        self.assertIn("COPY .github/workflows/ci.yml /app/.github/workflows/ci.yml", verification)
        self.assertLess(
            verification.index("RUN uv sync --locked --project /app/backend"),
            verification.index("USER 10001:10001"),
        )
        self.assertIn('"pytest", "backend/tests", "-q"', verification)

    def test_browser_headers_cover_every_route_without_untested_csp(self):
        config = json.loads((ROOT / "vercel.json").read_text())
        rules = [rule for rule in config["headers"] if rule["source"] == "/(.*)"]
        self.assertEqual(len(rules), 1)
        headers = {header["key"].lower(): header["value"] for header in rules[0]["headers"]}
        self.assertEqual(headers["x-content-type-options"], "nosniff")
        self.assertEqual(headers["referrer-policy"], "strict-origin-when-cross-origin")
        self.assertEqual(headers["x-frame-options"], "DENY")
        self.assertFalse(any("content-security-policy" in key for key in headers))
        routes = {rule["source"]: rule["destination"]["service"] for rule in config["rewrites"]}
        for route in ("/v1", "/v1/(.*)", "/health", "/docs", "/docs/(.*)", "/openapi.json"):
            self.assertEqual(routes[route], "backend")
        self.assertEqual(config["rewrites"][-1], {
            "source": "/(.*)", "destination": {"service": "frontend"}
        })


if __name__ == "__main__":
    unittest.main()

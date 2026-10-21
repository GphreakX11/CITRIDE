"""Locked development-image dependency security contracts; no network or installers."""
from pathlib import Path
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DependencySecurityTests(unittest.TestCase):
    def test_pillow_security_minimum_is_development_only(self):
        project = tomllib.loads((ROOT / "backend/pyproject.toml").read_text())
        self.assertIn("pillow>=13.0.0", project["dependency-groups"]["dev"])
        self.assertFalse(any(value.lower().startswith("pillow") for value in project["project"]["dependencies"]))
        self.assertEqual(project["project"]["requires-python"], ">=3.12,<3.14")

    def test_locked_pillow_and_existing_ca_fix_are_retained(self):
        lock = tomllib.loads((ROOT / "backend/uv.lock").read_text())
        packages = {package["name"]: package for package in lock["package"]}
        self.assertEqual(packages["pillow"]["version"], "13.0.0")
        self.assertEqual(packages["certifi"]["version"], "2026.10.19")
        self.assertTrue(packages["pillow"]["wheels"])
        for artifact in [packages["pillow"]["sdist"], *packages["pillow"]["wheels"]]:
            self.assertIn("13.0.0", artifact["url"])
            self.assertRegex(artifact["hash"], r"^sha256:[0-9a-f]{64}$")
            self.assertGreater(artifact["size"], 0)


if __name__ == "__main__":
    unittest.main()

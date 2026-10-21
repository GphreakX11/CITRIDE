"""Offline CA hardening tests: public certificates and temporary trees only."""
import base64
import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import subprocess
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

# Public CA certificates, not keys. Exact fixture provenance is in the report.
G1 = """-----BEGIN CERTIFICATE-----
MIIDlDCCAnygAwIBAgIKMfXkYgxsWO3W2DANBgkqhkiG9w0BAQsFADBnMQswCQYD
VQQGEwJJTjETMBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBU
ZWNobm9sb2dpZXMgTGltaXRlZDEcMBoGA1UEAxMTZW1TaWduIFJvb3QgQ0EgLSBH
MTAeFw0xODAyMTgxODMwMDBaFw00MzAyMTgxODMwMDBaMGcxCzAJBgNVBAYTAklO
MRMwEQYDVQQLEwplbVNpZ24gUEtJMSUwIwYDVQQKExxlTXVkaHJhIFRlY2hub2xv
Z2llcyBMaW1pdGVkMRwwGgYDVQQDExNlbVNpZ24gUm9vdCBDQSAtIEcxMIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAk0u76WaK7p1b1TST0Bsew+eeuGQz
f2N4aLTNLnF115sgxk0pvLZoYIr3IZpWNVrzdr3YzZr/k1ZLpVkGoZM0Kd0WNHVO
8oG0x5ZOrRkVUkr+PHB1cM2vK6sVmjM8qrOLqs1D/fXqcP/tzxE7lM5OMhbTI0Aq
d7OvPAEsbO2ZLIvZTmmYsvePQbAyeGHWDV/D+qJAkh1cF+ZwPjXnorfCYuKrpDhM
tTk1b+oDafo6VGiFbdbyL0NVHpENDtjVaqSW0RM8LHhQ6DqS0hdW5TUaQBw+jSzt
Od9C4INBdN+jzcKGYEho42kLVACL5HZpIQ15TjQIXhTCzLG3rdd8cIrHhQIDAQAB
o0IwQDAdBgNVHQ4EFgQU++8Nhp6w492pufEhF38+/PB3KxowDgYDVR0PAQH/BAQD
AgEGMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAFn/8oz1h31x
PaOfG1vR2vjTnGs2vZupYeveFix0PZ7mddrXuqe8QhfnPZHr5X3dPpzxz5KsbEjM
wiI/aTvFthUvozXGaCocV685743QNcMYDHsAVhzNixl03r4PEuDQqqE/AjSxcM6d
GNYIAwlG7mDgfrbESQRRfXBgvKqy/3lyeqYdPV8q+Mri/Tm3R7nrft8EI6/6nAYH
6ftjk4BAtcZsCjEozgyfz7MjNYBBjWzEN3uBL4ChQEKF6dk4jeihU80Bv2noWgby
RQuQ+q7hv53yrlc8pa6yVvSLZUDp/TGBLPQ5Cdjua6e0ph0VpZj3AYHYhX3zUVxx
iN66zB+Afko=
-----END CERTIFICATE-----
""".encode()
G3 = """-----BEGIN CERTIFICATE-----
MIICTjCCAdOgAwIBAgIKPPYHqWhwDtqLhDAKBggqhkjOPQQDAzBrMQswCQYDVQQG
EwJJTjETMBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBUZWNo
bm9sb2dpZXMgTGltaXRlZDEgMB4GA1UEAxMXZW1TaWduIEVDQyBSb290IENBIC0g
RzMwHhcNMTgwMjE4MTgzMDAwWhcNNDMwMjE4MTgzMDAwWjBrMQswCQYDVQQGEwJJ
TjETMBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBUZWNobm9s
b2dpZXMgTGltaXRlZDEgMB4GA1UEAxMXZW1TaWduIEVDQyBSb290IENBIC0gRzMw
djAQBgcqhkjOPQIBBgUrgQQAIgNiAAQjpQy4LRL1KPOxst3iAhKAnjlfSU2fySU0
WXTsuwYc58Byr+iuL+FBVIcUqEqy6HyC5ltqtdyzdc6LBtCGI79G1Y4PPwT01xyS
fvalY8L1X44uT6EYGQIrMgqCZH0Wk9GjQjBAMB0GA1UdDgQWBBR8XQKEE9TMipuB
zhccLikenEhjQjAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAKBggq
hkjOPQQDAwNpADBmAjEAvvNhzwIQHWSVB7gYboiFBS+DCBeQyh+KTOgNG3qxrdWB
CUfvO6wIBHxcmbHtRwfSAjEAnbpV/KlK6O3t5nYBQnvI+GDZjVGLVTv7jHvrZQnD
+JbNR6iC8hZVdyR+EhCVBCyj
-----END CERTIFICATE-----
""".encode()

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "harden_ca.py"
spec = importlib.util.spec_from_file_location("tested_harden_ca", SCRIPT)
assert spec is not None and spec.loader is not None
ca = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = ca
spec.loader.exec_module(ca)


class CATrustTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def layout(self):
        roots = (self.root / "share", self.root / "local")
        system = self.root / "ssl"
        pip_root = self.root / "pip"
        for directory in (*roots, system, pip_root):
            directory.mkdir(exist_ok=True)
        bundle = pip_root / "cacert.pem"
        bundle.write_bytes(G1)
        cafile = system / "ca-certificates.crt"
        cafile.write_bytes(G1)
        return ca.Layout(roots, cafile, system, bundle, pip_root, system)

    def test_public_fingerprint_and_only_exact_g3_removed(self):
        self.assertEqual(ca.BLOCKED_SHA256, "86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b")
        self.assertEqual(hashlib.sha256(base64.b64decode(b"".join(G3.splitlines()[1:-1]), validate=True)).hexdigest(), ca.BLOCKED_SHA256)
        self.assertEqual(hashlib.sha256(base64.b64decode(b"".join(G1.splitlines()[1:-1]), validate=True)).hexdigest(), "40f6af0346a99aa1cd1d555a4e9cce62c7f9634603ee406615833dc8c8d00367")
        original = b"# before\n" + G3 + b"# unrelated G1\n" + G1 + b"# tail\n"
        result, removed = ca.rewrite_pem(original)
        self.assertEqual(removed, 1)
        self.assertEqual(result, original.replace(G3.rstrip(b"\n"), b""))
        self.assertIn(G1, result)
        self.assertNotIn(G3.rstrip(b"\n"), result)

    def test_comments_false_text_crlf_and_idempotence(self):
        original = (b"# emSign ECC Root CA - G3 " + ca.BLOCKED_SHA256.encode() + b"\r\n" + G1.replace(b"\n", b"\r\n"))
        self.assertEqual(ca.rewrite_pem(original), (original, 0))
        clean, count = ca.rewrite_pem(G3 + G1)
        self.assertEqual(count, 1)
        self.assertEqual(ca.rewrite_pem(clean), (clean, 0))

    def test_malformed_pem_fails_closed(self):
        for data in (b"not a bundle", G1.replace(b"END CERTIFICATE", b"END WRONG"), G1 + b"-----BEGIN CERTIFICATE-----\n???", b"-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----\n", G1 + b"-----END CERTIFICATE-----", G1.replace(b"MIID", b"M!ID", 1)):
            with self.subTest(data_kind=len(data)), self.assertRaises(Exception):
                ca.rewrite_pem(data)

    def test_der_trailing_data_cannot_hide_the_blocked_root(self):
        der = base64.b64decode(b"".join(G3.splitlines()[1:-1]), validate=True)
        disguised = b"-----BEGIN CERTIFICATE-----\n" + base64.b64encode(der + b"extra") + b"\n-----END CERTIFICATE-----\n"
        with self.assertRaises(ca.TrustError):
            ca.rewrite_pem(disguised + G1)

    def test_uv_rejects_stderr_unknown_platform_and_failed_runner(self):
        for output, stderr, status in (("uv 0.13.4", "unexpected", 0), ("uv 0.13.4 (not-a-platform)", "", 0), ("uv 0.13.4", "", 1)):
            runner = lambda *a, **k: subprocess.CompletedProcess(a[0], status, stdout=output, stderr=stderr)
            with self.subTest(case=(bool(stderr), status)), self.assertRaises(Exception):
                ca.require_uv(runner=runner)

    def test_atomic_rewrite_and_no_target_no_write(self):
        file = self.root / "bundle.pem"
        original = G3 + G1
        file.write_bytes(original)
        replacement, _ = ca.rewrite_pem(original)
        ca.atomic_rewrite(file, original, replacement, (self.root,))
        self.assertEqual(file.read_bytes(), replacement)
        with patch.object(ca.os, "replace", side_effect=AssertionError("unexpected replacement")):
            ca.atomic_rewrite(file, replacement, replacement, (self.root,))

    def test_atomic_replace_failure_preserves_original_and_cleans_temp(self):
        file = self.root / "bundle.pem"
        file.write_bytes(G3 + G1)
        before = set(self.root.iterdir())
        with patch.object(ca.os, "replace", side_effect=OSError("synthetic replace failure")):
            with self.assertRaises(OSError):
                ca.atomic_rewrite(file, G3 + G1, G1, (self.root,))
        self.assertEqual(file.read_bytes(), G3 + G1)
        self.assertEqual(set(self.root.iterdir()), before)

    def test_atomic_write_failure_never_replaces_original(self):
        file = self.root / "bundle.pem"
        file.write_bytes(G3 + G1)
        with patch.object(ca.os, "fsync", side_effect=OSError("synthetic write failure")), patch.object(ca.os, "replace", side_effect=AssertionError("unexpected commit")):
            with self.assertRaises(OSError):
                ca.atomic_rewrite(file, G3 + G1, G1, (self.root,))
        self.assertEqual(file.read_bytes(), G3 + G1)
        self.assertEqual(list(self.root.iterdir()), [file])

    def test_repeated_target_and_comment_marker_are_not_name_matching(self):
        comment = b"# -----BEGIN CERTIFICATE----- emSign G3\n"
        original = comment + G1 + G3 + G3
        clean, removed = ca.rewrite_pem(original)
        self.assertEqual(removed, 2)
        self.assertEqual(clean, original.replace(G3.rstrip(b"\n"), b""))
        self.assertIn(comment + G1, clean)

    def test_atomic_rejects_invalid_replacement_or_changed_original(self):
        file = self.root / "bundle.pem"
        file.write_bytes(G1)
        for expected, new in ((G1, b"broken"), (G3 + G1, G1)):
            with self.assertRaises(Exception):
                ca.atomic_rewrite(file, expected, new, (self.root,))
            self.assertEqual(file.read_bytes(), G1)

    def test_escape_symlink_and_read_failure_are_errors(self):
        layout = self.layout()
        outside = self.root / "outside.pem"
        outside.write_bytes(G3)
        (layout.source_roots[0] / "escape.crt").symlink_to(outside)
        with self.assertRaises(Exception):
            ca._bootstrap_layout(layout, runner=lambda *a, **k: None)
        (layout.source_roots[0] / "escape.crt").unlink()
        real_open = ca.os.open
        def unreadable(path, *args, **kwargs):
            if str(path) in {str(layout.pip_bundle), layout.pip_bundle.name}:
                raise PermissionError("synthetic unreadable bundle")
            return real_open(path, *args, **kwargs)
        with patch.object(ca.os, "open", side_effect=unreadable), self.assertRaises(PermissionError):
            ca._bootstrap_layout(layout, runner=lambda *a, **k: None)

    def test_parent_link_swap_after_resolution_is_rejected(self):
        allowed = self.root / "allowed"
        parent = allowed / "nested"
        parent.mkdir(parents=True)
        (parent / "bundle.pem").write_bytes(G1)
        foreign = self.root / "foreign"
        foreign.mkdir()
        (foreign / "bundle.pem").write_bytes(G1)
        original_resolve = ca._resolve_allowed
        def swap(path, roots):
            result = original_resolve(path, roots)
            parent.rename(allowed / "saved")
            parent.symlink_to(foreign, target_is_directory=True)
            return result
        with patch.object(ca, "_resolve_allowed", swap), self.assertRaises(Exception):
            ca._read_checked(parent / "bundle.pem", (allowed,))
        self.assertEqual((foreign / "bundle.pem").read_bytes(), G1)

    def test_bootstrap_managed_source_delete_mixed_preserve_and_refresh(self):
        layout = self.layout()
        blocked = layout.source_roots[0] / "blocked.crt"
        blocked.write_bytes(G3)
        mixed = layout.source_roots[1] / "mixed.crt"
        mixed.write_bytes(b"# preserve\n" + G3 + G1)
        layout.pip_bundle.write_bytes(G3 + G1)
        calls = []
        def refresh(command, **kwargs):
            calls.append((command, kwargs))
            layout.cafile.write_bytes(G1)
        ca._bootstrap_layout(layout, runner=refresh)
        self.assertFalse(blocked.exists())
        self.assertIn(b"# preserve\n", mixed.read_bytes())
        self.assertIn(G1, mixed.read_bytes())
        self.assertNotIn(G3.rstrip(b"\n"), layout.pip_bundle.read_bytes())
        self.assertEqual(calls, [(["/usr/sbin/update-ca-certificates", "--fresh"], {"check": True, "capture_output": True})])
        before = mixed.read_bytes()
        ca._bootstrap_layout(layout, runner=refresh)
        self.assertEqual(mixed.read_bytes(), before)

    def test_preflight_malformed_later_input_does_not_change_any_file(self):
        layout = self.layout()
        source = layout.source_roots[0] / "blocked.crt"
        source.write_bytes(G3)
        layout.pip_bundle.write_bytes(b"bad PEM")
        with self.assertRaises(Exception):
            ca._bootstrap_layout(layout, runner=lambda *a, **k: self.fail("refresh before validation"))
        self.assertEqual(source.read_bytes(), G3)

    def test_refresh_failure_propagates(self):
        layout = self.layout()
        def fail(command, **kwargs):
            raise subprocess.CalledProcessError(17, command)
        with self.assertRaises(subprocess.CalledProcessError):
            ca._bootstrap_layout(layout, runner=fail)

    def test_refresh_success_without_clean_trust_still_fails(self):
        layout = self.layout()
        layout.cafile.write_bytes(G1 + G3)
        with self.assertRaises(ca.TrustError):
            ca._bootstrap_layout(layout, runner=lambda *a, **k: None)

    def test_single_blocked_source_with_comments_is_not_silently_destroyed(self):
        layout = self.layout()
        file = layout.source_roots[0] / "commented.crt"
        original = b"# preserve this comment\n" + G3
        file.write_bytes(original)
        with self.assertRaises(ca.TrustError):
            ca._bootstrap_layout(layout, runner=lambda *a, **k: self.fail("unsafe refresh"))
        self.assertEqual(file.read_bytes(), original)

    def test_directory_errors_propagate_before_mutation(self):
        layout = self.layout()
        def denied(*args, onerror=None, **kwargs):
            assert onerror is not None
            onerror(PermissionError("synthetic CA directory failure"))
            return iter(())
        with patch.object(ca.os, "walk", denied), self.assertRaises(PermissionError):
            ca._bootstrap_layout(layout, runner=lambda *a, **k: self.fail("unexpected refresh"))

    def test_verification_detects_cafile_capath_and_pip_and_is_read_only(self):
        layout = self.layout()
        source = layout.source_roots[0] / "unaffected.crt"
        source.write_bytes(G1)
        (layout.capath / "hash.0").symlink_to(source)
        before = layout.cafile.read_bytes()
        ca._verify_layout(layout)
        self.assertEqual(layout.cafile.read_bytes(), before)
        for file in (layout.cafile, layout.pip_bundle, source):
            original = file.read_bytes()
            file.write_bytes(G3 + G1)
            with self.assertRaises(Exception):
                ca._verify_layout(layout)
            file.write_bytes(original)
        (layout.capath / "escape.0").symlink_to(self.root / "outside")
        with self.assertRaises(Exception):
            ca._verify_layout(layout)

    def test_guard_rejects_platform_uid_env_before_marker_or_layout(self):
        for platform, uid, flag in (("darwin", 0, "1"), ("linux", 12, "1"), ("linux", 0, None), ("linux", 0, "true")):
            env = {} if flag is None else {"CITRIDE_CONTAINER_CA_BUILD": flag}
            with patch.object(ca.sys, "platform", platform), patch.object(ca.os, "geteuid", return_value=uid), patch.dict(ca.os.environ, env, clear=True), patch.object(ca.Path, "lstat", side_effect=AssertionError("marker touched early")):
                with self.assertRaises(ca.TrustError):
                    ca._guard_container()
        for mode in ("bootstrap", "verify"):
            with patch.object(ca, "_guard_container", side_effect=ca.TrustError("denied")), patch.object(ca, "_image_layout", side_effect=AssertionError("system touched")), contextlib.redirect_stderr(io.StringIO()):
                self.assertNotEqual(ca.main([mode]), 0)

    def test_marker_must_be_real_file(self):
        with patch.object(ca.sys, "platform", "linux"), patch.object(ca.os, "geteuid", return_value=0), patch.dict(ca.os.environ, {"CITRIDE_CONTAINER_CA_BUILD": "1"}, clear=True), patch.object(ca.Path, "lstat", side_effect=FileNotFoundError("missing marker")):
            with self.assertRaises(Exception):
                ca._guard_container()

    def test_guard_validates_all_three_marker_components_without_following_links(self):
        seen = []
        def marker_info(path):
            seen.append(str(path))
            mode = stat.S_IFREG if str(path).endswith("pyproject.toml") else stat.S_IFDIR
            return types.SimpleNamespace(st_mode=mode | 0o755)
        with patch.object(ca.sys, "platform", "linux"), patch.object(ca.os, "geteuid", return_value=0), patch.dict(ca.os.environ, {"CITRIDE_CONTAINER_CA_BUILD": "1"}, clear=True), patch.object(ca.Path, "lstat", marker_info):
            ca._guard_container()
        self.assertEqual(seen, ["/app", "/app/backend", "/app/backend/pyproject.toml"])
        with patch.object(ca.sys, "platform", "linux"), patch.object(ca.os, "geteuid", return_value=0), patch.dict(ca.os.environ, {"CITRIDE_CONTAINER_CA_BUILD": "1"}, clear=True), patch.object(ca.Path, "lstat", return_value=types.SimpleNamespace(st_mode=stat.S_IFLNK | 0o777)):
            with self.assertRaises(ca.TrustError):
                ca._guard_container()

    def test_image_layout_rejects_ssl_overrides_before_package_inspection(self):
        defaults = types.SimpleNamespace(openssl_cafile_env="SSL_CERT_FILE", openssl_capath_env="SSL_CERT_DIR")
        with patch.object(ca.ssl, "get_default_verify_paths", return_value=defaults), patch.dict(ca.os.environ, {"SSL_CERT_FILE": "untrusted"}, clear=True), patch.object(ca.sysconfig, "get_path", side_effect=AssertionError("unexpected site access")):
            with self.assertRaises(ca.TrustError):
                ca._image_layout()

    def test_uv_complete_version_gate_and_no_untrusted_echo(self):
        allowed = ["uv 0.13.4\n", "uv 0.13.4 (x86_64-unknown-linux-gnu)\n", "uv 0.14.0 (abcdef123 2026-10-20)\n", "uv 1.0.0"]
        denied = ["uv 0.13.3", "uv 0.13.4 trailing", "uv 0.13.4 (garbage)", "uv 0.13.4 (abcdef123 2026-99-99)", "uv 00.13.4", "uv 0.13.4\nextra", "unknown-private-marker", "uv 0.13.4rc1"]
        for text in allowed + denied:
            runner = lambda *a, **k: subprocess.CompletedProcess(a[0], 0, stdout=text, stderr="")
            if text in allowed:
                ca.require_uv(runner=runner)
            else:
                with self.assertRaises(Exception):
                    ca.require_uv(runner=runner)
        with patch.object(ca, "require_uv", side_effect=ValueError("unknown-private-marker")), contextlib.redirect_stderr(io.StringIO()) as stderr:
            self.assertNotEqual(ca.main(["require-uv"]), 0)
        self.assertNotIn("unknown-private-marker", stderr.getvalue())

    def test_certifi_path_version_blocked_root_and_stdout_only_path(self):
        package = self.root / "certifi"
        package.mkdir()
        file = package / "cacert.pem"
        file.write_bytes(G1)
        module = types.SimpleNamespace(__version__="2026.10.19", __file__=str(package / "__init__.py"), where=lambda: str(file))
        (package / "__init__.py").write_text("# controlled public fixture")
        with patch.object(ca.importlib, "import_module", return_value=module):
            self.assertEqual(ca.certifi_path(), str(file))
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(ca.main(["certifi-path"]), 0)
            self.assertEqual(stdout.getvalue(), str(file) + "\n")
            self.assertEqual(file.read_bytes(), G1)
            for version in ("2026.7.22", "2026.10.19bad", "2026.99.99"):
                module.__version__ = version
                with self.assertRaises(Exception):
                    ca.certifi_path()
            module.__version__ = "2026.10.19"
            file.write_bytes(G1 + G3)
            with self.assertRaises(Exception):
                ca.certifi_path()

    def test_certifi_bundle_cannot_escape_imported_package(self):
        package = self.root / "certifi"
        package.mkdir()
        (package / "__init__.py").write_text("# public test fixture")
        outside = self.root / "outside.pem"
        outside.write_bytes(G1)
        file = package / "cacert.pem"
        file.symlink_to(outside)
        module = types.SimpleNamespace(__version__="2026.10.19", __file__=str(package / "__init__.py"), where=lambda: str(file))
        with patch.object(ca.importlib, "import_module", return_value=module), self.assertRaises(ca.TrustError):
            ca.certifi_path()

    def test_import_has_no_project_or_trust_store_actions(self):
        source = SCRIPT.read_text()
        namespace = types.ModuleType("ca_import_side_effect_probe")
        with patch.dict(sys.modules, {namespace.__name__: namespace}), patch.object(ca.sysconfig, "get_path", side_effect=AssertionError("site inspection at import")), patch.object(ca.ssl, "get_default_verify_paths", side_effect=AssertionError("CA inspection at import")), patch.object(ca.importlib, "import_module", side_effect=AssertionError("project import at module load")):
            exec(compile(source, str(SCRIPT), "exec"), namespace.__dict__)


if __name__ == "__main__":
    unittest.main()

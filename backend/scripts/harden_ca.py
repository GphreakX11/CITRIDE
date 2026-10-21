#!/usr/bin/env python3
"""Exact-root CA hygiene; image mutation modes are guarded, host gates read only.

No work is performed at import. No mode downloads packages or modifies host trust.
Private layout interfaces exist for controlled temporary-tree tests, not CLI roots.
"""
from __future__ import annotations

import argparse
import base64
import binascii
from dataclasses import dataclass
from datetime import date
import hashlib
import importlib
import os
from pathlib import Path
import re
import secrets
import ssl
import stat
import subprocess
import sys
import sysconfig

BLOCKED_SHA256 = "86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b"
_BEGIN = b"-----BEGIN CERTIFICATE-----"
_END = b"-----END CERTIFICATE-----"


class TrustError(RuntimeError):
    """A trust input or prerequisite cannot be verified safely."""


@dataclass(frozen=True)
class Layout:
    source_roots: tuple[Path, ...]
    cafile: Path
    capath: Path
    pip_bundle: Path
    pip_root: Path
    system_root: Path


def _der_extent(der: bytes) -> None:
    # OpenSSL may accept trailing bytes after an otherwise valid X.509 object.
    # Reject them rather than hashing a disguised encoding as a different root.
    if len(der) < 2 or der[0] != 0x30:
        raise TrustError("Invalid X.509 DER envelope")
    length = der[1]
    header = 2
    if length & 0x80:
        size = length & 0x7F
        if not 1 <= size <= 8 or len(der) < 2 + size or der[2] == 0:
            raise TrustError("Invalid DER length")
        length = int.from_bytes(der[2:2 + size], "big")
        header += size
        if length < 128:
            raise TrustError("Noncanonical DER length")
    if header + length != len(der):
        raise TrustError("Trailing or truncated DER data")


def _blocks(data: bytes) -> list[tuple[int, int, str]]:
    if b"\0" in data:
        raise TrustError("Invalid PEM input")
    blocks = []
    start = None
    body = []
    offset = 0
    for raw_line in data.splitlines(keepends=True):
        line = raw_line.rstrip(b"\r\n")
        if start is None:
            if line == _BEGIN:
                start = offset
                body = []
            elif not line.lstrip().startswith(b"#") and (b"-----BEGIN" in line or b"-----END" in line):
                raise TrustError("Unrecognized PEM boundary")
        elif line == _END:
            encoded = re.sub(br"[ \t\r\n]", b"", b"".join(body))
            try:
                der = base64.b64decode(encoded, validate=True)
                if not der or base64.b64encode(der) != encoded:
                    raise TrustError("Invalid certificate encoding")
                _der_extent(der)
                # Parse X.509 in memory, without loading a default/system CA set.
                pem = ssl.DER_cert_to_PEM_cert(der)
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                context.load_verify_locations(cadata=pem)
                parsed = context.get_ca_certs(binary_form=True)
                if parsed and (len(parsed) != 1 or parsed[0] != der):
                    raise TrustError("Noncanonical CA certificate DER")
            except (ValueError, binascii.Error, ssl.SSLError) as error:
                raise TrustError("Invalid certificate PEM") from error
            blocks.append((start, offset + len(_END), hashlib.sha256(der).hexdigest()))
            start = None
        else:
            if b"-----BEGIN" in line or b"-----END" in line:
                raise TrustError("Malformed certificate boundaries")
            body.append(raw_line)
        offset += len(raw_line)
    if start is not None or not blocks:
        raise TrustError("Missing or incomplete certificate PEM")
    return blocks


def rewrite_pem(data: bytes) -> tuple[bytes, int]:
    """Validate all blocks, then remove only the exact DER fingerprint.

    Unrelated bytes, comments, wrapping and line endings are not normalized.
    A zero-certificate result is returned for source-file deletion planning only.
    """
    blocks = _blocks(data)
    result = []
    previous = 0
    removed = 0
    for start, end, fingerprint in blocks:
        if fingerprint == BLOCKED_SHA256:
            result.append(data[previous:start])
            previous = end
            removed += 1
    if not removed:
        return data, 0
    result.append(data[previous:])
    return b"".join(result), removed


def _clean(data: bytes) -> None:
    if any(fingerprint == BLOCKED_SHA256 for _, _, fingerprint in _blocks(data)):
        raise TrustError("Blocked certificate remains")


def _resolve_allowed(path: Path, roots: tuple[Path, ...]) -> Path:
    if not path.is_absolute() or not roots or any(not root.is_absolute() for root in roots):
        raise TrustError("Absolute approved paths required")
    resolved = path.resolve(strict=True)
    # Deliberately do not resolve roots into a newly escaped trust boundary.
    if not any(resolved == root or root in resolved.parents for root in roots):
        raise TrustError("Certificate path escapes approved roots")
    return resolved


def _open_parent(path: Path) -> int:
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise TrustError("Safe directory-relative access is unavailable")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open(path.anchor, flags)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def _read_at(parent: int, name: str) -> tuple[bytes, os.stat_result]:
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise TrustError("Certificate input is not a regular file")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            data = stream.read()
        current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino) or not stat.S_ISREG(current.st_mode):
            raise TrustError("Certificate input changed while reading")
        if (info.st_size, info.st_mtime_ns) != (current.st_size, current.st_mtime_ns):
            raise TrustError("Certificate bytes changed while reading")
        return data, info
    finally:
        os.close(descriptor)


def _read_checked(path: Path, roots: tuple[Path, ...]) -> tuple[Path, bytes, os.stat_result]:
    resolved = _resolve_allowed(path, roots)
    parent = _open_parent(resolved)
    try:
        data, info = _read_at(parent, resolved.name)
        return resolved, data, info
    finally:
        os.close(parent)


def atomic_rewrite(path: Path, original: bytes, replacement: bytes, roots: tuple[Path, ...]) -> None:
    """Validate before same-directory atomic replacement; never partially truncate."""
    resolved, current, info = _read_checked(path, roots)
    if current != original:
        raise TrustError("Certificate input changed before replacement")
    _clean(replacement)
    if replacement == original:
        return
    parent = _open_parent(resolved)
    temporary = ".ca-hardening-" + secrets.token_hex(16)
    created = False
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        created = True
        try:
            with os.fdopen(descriptor, "wb", closefd=False) as stream:
                os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
                stream.write(replacement)
                stream.flush()
                os.fsync(stream.fileno())
        finally:
            os.close(descriptor)
        latest, latest_info = _read_at(parent, resolved.name)
        if latest != original or (info.st_dev, info.st_ino) != (latest_info.st_dev, latest_info.st_ino):
            raise TrustError("Certificate input changed before commit")
        os.replace(temporary, resolved.name, src_dir_fd=parent, dst_dir_fd=parent)
        created = False
    finally:
        # Do not suppress cleanup failures or hide failed replacement.
        try:
            if created:
                os.unlink(temporary, dir_fd=parent)
        finally:
            os.close(parent)


def _remove_source(path: Path, original: bytes, roots: tuple[Path, ...]) -> None:
    resolved, current, info = _read_checked(path, roots)
    if current != original:
        raise TrustError("CA source changed before removal")
    parent = _open_parent(resolved)
    try:
        latest, latest_info = _read_at(parent, resolved.name)
        if latest != original or (info.st_dev, info.st_ino) != (latest_info.st_dev, latest_info.st_ino):
            raise TrustError("CA source changed before removal")
        os.unlink(resolved.name, dir_fd=parent)
    finally:
        os.close(parent)


def _walk_files(root: Path, roots: tuple[Path, ...], crt_only: bool) -> list[Path]:
    actual = _resolve_allowed(root, roots)
    if not actual.is_dir():
        raise TrustError("CA directory missing")
    def onerror(error):
        raise error
    result = []
    for directory, directories, files in os.walk(actual, followlinks=False, onerror=onerror):
        for name in directories:
            if (Path(directory) / name).is_symlink():
                raise TrustError("CA directory symlinks are unsupported")
        directories.sort()
        for name in sorted(files):
            path = Path(directory) / name
            if not crt_only or path.suffix.lower() == ".crt":
                result.append(path)
    return result


def _inputs(layout: Layout) -> tuple[list[Path], list[tuple[Path, tuple[Path, ...]]]]:
    sources = []
    for root in layout.source_roots:
        if not stat.S_ISDIR(root.lstat().st_mode):
            raise TrustError("Managed CA source must be a real directory")
        sources.extend(_walk_files(root, layout.source_roots, True))
    trust_roots = layout.source_roots + (layout.system_root,)
    if _resolve_allowed(layout.capath, (layout.system_root,)) != layout.system_root:
        raise TrustError("Unexpected system CA directory")
    capath_files = _walk_files(layout.capath, (layout.system_root,), False)
    if not capath_files:
        raise TrustError("Empty system CA directory")
    inputs = [(path, layout.source_roots) for path in sources]
    inputs.append((layout.cafile, (layout.system_root,)))
    inputs.extend((path, trust_roots) for path in capath_files)
    inputs.append((layout.pip_bundle, (layout.pip_root,)))
    return sources, inputs


def _verify_layout(layout: Layout) -> None:
    _, inputs = _inputs(layout)
    for path, roots in inputs:
        _, data, _ = _read_checked(path, roots)
        _clean(data)


def _bootstrap_layout(layout: Layout, *, runner=subprocess.run) -> None:
    sources, inputs = _inputs(layout)
    # Preflight every source, existing system cache/link and pip input before writes.
    for path, roots in inputs:
        _, data, _ = _read_checked(path, roots)
        _blocks(data)
    plans = []
    targets = [(path, layout.source_roots, True) for path in sources]
    targets.append((layout.pip_bundle, (layout.pip_root,), False))
    for path, roots, managed in targets:
        if path.is_symlink():
            raise TrustError("Managed rewrite target must not be a symlink")
        resolved, original, _ = _read_checked(path, roots)
        replacement, removed = rewrite_pem(original)
        if not removed:
            continue
        if removed == len(_blocks(original)):
            if not managed or replacement.strip():
                raise TrustError("Cannot safely empty bundle or discard source comments")
            replacement = None
        else:
            _clean(replacement)
        plans.append((resolved, roots, original, replacement))
    for path, roots, original, replacement in plans:
        if replacement is None:
            _remove_source(path, original, roots)
        else:
            atomic_rewrite(path, original, replacement, roots)
    runner(["/usr/sbin/update-ca-certificates", "--fresh"], check=True, capture_output=True)
    _verify_layout(layout)


def _guard_container() -> None:
    if sys.platform != "linux" or os.geteuid() != 0 or os.environ.get("CITRIDE_CONTAINER_CA_BUILD") != "1":
        raise TrustError("Container build authorization required")
    # Marker checks are the only filesystem access before authorization completes.
    for directory in (Path("/app"), Path("/app/backend")):
        if not stat.S_ISDIR(directory.lstat().st_mode):
            raise TrustError("Container application marker directory missing")
    if not stat.S_ISREG(Path("/app/backend/pyproject.toml").lstat().st_mode):
        raise TrustError("Container application marker missing")


def _image_layout() -> Layout:
    # No environment redirect may turn verification into checking an unrelated set.
    defaults = ssl.get_default_verify_paths()
    if defaults.openssl_cafile_env in os.environ or defaults.openssl_capath_env in os.environ:
        raise TrustError("System CA overrides are not supported during image hardening")
    if not defaults.cafile or not defaults.capath:
        raise TrustError("System CA paths unavailable")
    candidates = []
    for key in ("purelib", "platlib"):
        site = sysconfig.get_path(key)
        if not isinstance(site, str) or not Path(site).is_absolute():
            raise TrustError("Interpreter package path unavailable")
        root = Path(site) / "pip/_vendor/certifi"
        candidate = root / "cacert.pem"
        if candidate.exists() and candidate not in [c[0] for c in candidates]:
            candidates.append((candidate, root))
    if len(candidates) != 1:
        raise TrustError("Pip vendored CA bundle is missing or ambiguous")
    pip_bundle, pip_root = candidates[0]
    return Layout(
        (Path("/usr/share/ca-certificates"), Path("/usr/local/share/ca-certificates")),
        Path(defaults.cafile), Path(defaults.capath), pip_bundle, pip_root, Path("/etc/ssl/certs"),
    )


def require_uv(*, runner=subprocess.run) -> None:
    result = runner(["uv", "--version"], check=True, capture_output=True, text=True, timeout=15)
    if result.returncode != 0 or result.stderr:
        raise TrustError("uv version command failed")
    match = re.fullmatch(r"uv (0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?: \(([^()\r\n]+)\))?\n?", result.stdout)
    if match is None:
        raise TrustError("Unsupported uv version output")
    suffix = match.group(4)
    if suffix:
        build = re.fullmatch(r"[0-9a-f]{7,40} ([0-9]{4}-[0-9]{2}-[0-9]{2})", suffix)
        platform = re.fullmatch(
            r"(?:x86_64|aarch64|i686|armv7|armv6|s390x|powerpc64le|riscv64gc|loongarch64)"
            r"-(?:unknown-linux-(?:gnu|musl)(?:eabihf)?|apple-darwin|pc-windows-msvc)", suffix,
        )
        if build:
            date.fromisoformat(build.group(1))
        elif not platform:
            raise TrustError("Unsupported uv build suffix")
    if tuple(int(match.group(i)) for i in (1, 2, 3)) < (0, 13, 4):
        raise TrustError("A fixed uv version is required")


def certifi_path() -> str:
    certifi = importlib.import_module("certifi")
    version = re.fullmatch(r"([0-9]{4})\.([0-9]{1,2})\.([0-9]{1,2})", certifi.__version__)
    if not version or date(*(int(version.group(i)) for i in (1, 2, 3))) < date(2026, 10, 19):
        raise TrustError("A fixed project certifi version is required")
    package = Path(certifi.__file__).resolve(strict=True).parent
    supplied = certifi.where()
    if not isinstance(supplied, str) or any(ord(c) < 32 or ord(c) == 127 for c in supplied):
        raise TrustError("Invalid certifi bundle path")
    path, data, _ = _read_checked(Path(supplied), (package,))
    _clean(data)
    return str(path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("bootstrap", "verify", "require-uv", "certifi-path"))
    args = parser.parse_args(argv)
    try:
        if args.mode in {"bootstrap", "verify"}:
            _guard_container()
            layout = _image_layout()
            if args.mode == "bootstrap":
                _bootstrap_layout(layout)
            else:
                _verify_layout(layout)
        elif args.mode == "require-uv":
            require_uv()
        else:
            print(certifi_path())
    except Exception:
        # Preserve a failing status without echoing untrusted tool/exception data.
        print(f"{args.mode}: CA trust validation failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

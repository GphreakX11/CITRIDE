"""Repository-wide regression: retired external narrative exists only in this denylist."""

import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
DENYLIST = (
    "cyberav3ngers",
    "iocontrol",
    "unitronics",
    "gasboy",
    "hikvision",
    "irgc",
    "45.137.65.120",
    "159.100.6.69",
    "tylarion",
)


def _source_files(root, *, include_untracked):
    """Keep checkout Git failures visible; inspect first-party packaged inputs without Git."""
    metadata = root / ".git"
    if metadata.exists() or metadata.is_symlink():
        command = ["git", "ls-files", "-z"]
        if include_untracked:
            command.extend(["--cached", "--others", "--exclude-standard"])
        result = subprocess.run(command, cwd=root, capture_output=True, check=True)
        return [name for name in result.stdout.decode().split("\0") if name]

    # These generated trees are excluded from the Docker context or created by
    # dependency installation/runtime. They are not first-party source inputs.
    generated = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache", ".local"}
    names = []

    def inventory_error(error):
        raise error

    for directory, directories, files in os.walk(root, followlinks=False, onerror=inventory_error):
        directories[:] = sorted(
            name for name in directories
            if name not in generated and Path(directory) / name != root / "frontend" / "dist"
        )
        names.extend((Path(directory) / name).relative_to(root).as_posix() for name in sorted(files))
    return names


def test_retired_external_narrative_is_absent_from_repository():
    failures = []
    own = Path(__file__).resolve()
    for relative in _source_files(ROOT, include_untracked=True):
        path = ROOT / relative
        if not relative or not path.is_file() or path.resolve() == own:
            continue
        try:
            text = path.read_text(encoding="utf-8").casefold()
        except UnicodeError:
            continue
        if any(term in text or term in relative.casefold() for term in DENYLIST):
            failures.append(relative)
    assert not failures, "Retired external narrative remains in: " + ", ".join(failures)


def test_no_packet_capture_is_committed():
    assert not [
        name
        for name in _source_files(ROOT, include_untracked=False)
        if name.lower().endswith((".pcap", ".pcapng"))
    ]


def test_source_artifact_inventory_does_not_require_git(tmp_path, monkeypatch):
    source = tmp_path / "backend" / "citride"
    source.mkdir(parents=True)
    (source / "sample.py").write_text("# Synthetic packaged source\n", encoding="utf-8")
    for generated in ("backend/.venv", "frontend/node_modules", ".local", "backend/__pycache__"):
        directory = tmp_path / generated
        directory.mkdir(parents=True)
        (directory / "generated.txt").write_text(DENYLIST[0], encoding="utf-8")

    def unavailable_git(*args, **kwargs):
        raise FileNotFoundError("Git is intentionally absent from this source artifact")

    monkeypatch.setitem(globals(), "ROOT", tmp_path)
    monkeypatch.setattr(subprocess, "run", unavailable_git)
    test_retired_external_narrative_is_absent_from_repository()
    test_no_packet_capture_is_committed()


def test_source_artifact_directory_errors_are_not_silently_ignored(tmp_path, monkeypatch):
    def denied_walk(root, *, onerror=None, **kwargs):
        if onerror is not None:
            onerror(PermissionError("Synthetic source-directory access denied"))
        return iter(())

    monkeypatch.setitem(globals(), "ROOT", tmp_path)
    monkeypatch.setattr(os, "walk", denied_walk)
    with pytest.raises(PermissionError, match="source-directory access denied"):
        test_retired_external_narrative_is_absent_from_repository()


@pytest.mark.parametrize("include_untracked", [False, True])
def test_checkout_inventory_preserves_git_modes(tmp_path, monkeypatch, include_untracked):
    (tmp_path / ".git").write_text("Synthetic Git metadata marker", encoding="utf-8")
    calls = []

    def git_inventory(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, stdout=b"source.txt\0")

    monkeypatch.setattr(subprocess, "run", git_inventory)
    assert _source_files(tmp_path, include_untracked=include_untracked) == ["source.txt"]
    assert len(calls) == 1
    command, options = calls[0]
    assert command[:3] == ["git", "ls-files", "-z"]
    assert ("--others" in command) == include_untracked
    assert ("--exclude-standard" in command) == include_untracked
    assert options == {"cwd": tmp_path, "capture_output": True, "check": True}


@pytest.mark.parametrize("include_untracked", [False, True])
def test_checkout_git_errors_do_not_fall_back_to_an_artifact_scan(tmp_path, monkeypatch, include_untracked):
    (tmp_path / ".git").write_text("Synthetic broken Git metadata", encoding="utf-8")

    def failing_git(command, **kwargs):
        raise subprocess.CalledProcessError(128, command)

    monkeypatch.setattr(subprocess, "run", failing_git)
    with pytest.raises(subprocess.CalledProcessError):
        _source_files(tmp_path, include_untracked=include_untracked)


@pytest.mark.parametrize("extension", [".pcap", ".pcapng", ".PCAP"])
def test_source_artifact_packet_capture_is_rejected(tmp_path, monkeypatch, extension):
    directory = tmp_path / "data" / "evidence"
    directory.mkdir(parents=True)
    (directory / ("synthetic" + extension)).write_bytes(b"")
    monkeypatch.setitem(globals(), "ROOT", tmp_path)
    with pytest.raises(AssertionError):
        test_no_packet_capture_is_committed()


@pytest.mark.parametrize("in_filename", [False, True])
def test_source_artifact_retired_narrative_is_rejected(tmp_path, monkeypatch, in_filename):
    directory = tmp_path / "backend" / "citride" / "first_party"
    directory.mkdir(parents=True)
    filename = DENYLIST[0] + ".txt" if in_filename else "synthetic.txt"
    content = "Synthetic source" if in_filename else DENYLIST[0]
    (directory / filename).write_text(content, encoding="utf-8")
    monkeypatch.setitem(globals(), "ROOT", tmp_path)
    with pytest.raises(AssertionError, match="Retired external narrative remains"):
        test_retired_external_narrative_is_absent_from_repository()

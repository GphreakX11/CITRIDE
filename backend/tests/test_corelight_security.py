"""Repository-wide regression: retired external narrative exists only in this denylist."""

from pathlib import Path
import subprocess

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


def test_retired_external_narrative_is_absent_from_repository():
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    )
    failures = []
    own = Path(__file__).resolve()
    for relative in result.stdout.decode().split("\0"):
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
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    )
    assert not [
        name
        for name in result.stdout.decode().split("\0")
        if name.lower().endswith((".pcap", ".pcapng"))
    ]

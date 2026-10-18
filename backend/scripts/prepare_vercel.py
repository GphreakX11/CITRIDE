"""Bundle only the checked-in fictional demo inputs inside the Python service.

Run from any directory. Source files stay in the repository's data directory;
the copied package files are ignored build artifacts.
"""

from pathlib import Path
import json
import shutil
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = BACKEND_ROOT.parent / "data"
TARGET_ROOT = BACKEND_ROOT / "citride" / "demo_data"
CORELIGHT_FILES = tuple(
    f"telemetry/corelight/{name}.json"
    for name in ("conn", "ssl", "http", "dns", "modbus", "modbus_detailed", "notice", "vpn", "manifest")
)
FILES = (
    "scripted/watershed_beta.json",
    "scripted/c4_reference.json",
    "scripted/port_houston.json",
    "reference.json",
    "scenario.json",
    "telemetry/controller.json",
    "telemetry/enterprise.json",
    "telemetry/network.json",
    "telemetry/sensors.json",
    "reference/idt/idt_v4.json",
    "reference/idt/idt_v4.ttl",
)


def main() -> None:
    # Use the exact API reader; manifest counts are not evidence of row counts.
    sys.path.insert(0, str(BACKEND_ROOT))
    from citride.zeek_logs import load_zeek_json

    extras = tuple(
        str(path.relative_to(DATA_ROOT))
        for path in sorted((DATA_ROOT / "telemetry/corelight").glob("*"))
        if path.is_file() and path.suffix.lower() in {".json", ".jsonl"}
    )
    files = tuple(dict.fromkeys(FILES + CORELIGHT_FILES + extras))
    for filename in files:
        source = DATA_ROOT / filename
        if not source.is_file():
            raise SystemExit(f"Missing checked-in synthetic fixture: data/{filename}")
    source_logs = load_zeek_json(DATA_ROOT / "telemetry/corelight")
    # This is an ignored build directory only, never durable application state.
    # Remove stale exports so repeated packaging cannot duplicate source rows.
    target_corelight = TARGET_ROOT / "telemetry/corelight"
    if target_corelight.exists():
        shutil.rmtree(target_corelight)
    for filename in files:
        target = TARGET_ROOT / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(DATA_ROOT / filename, target)
    if load_zeek_json(target_corelight) != source_logs:
        raise SystemExit("Bundled Corelight records differ from source inputs")
    print(f"Bundled {len(files)} fixture files for the FastAPI service.")
    print("Corelight record counts: " + json.dumps({name: len(rows) for name, rows in source_logs.items()}, sort_keys=True))


if __name__ == "__main__":
    main()

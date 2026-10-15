"""Bundle only the checked-in fictional demo inputs inside the Python service.

Run from any directory. Source files stay in the repository's data directory;
the copied package files are ignored build artifacts.
"""

from pathlib import Path
import shutil


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = BACKEND_ROOT.parent / "data"
TARGET_ROOT = BACKEND_ROOT / "citride" / "demo_data"
FILES = (
    "scenario.json",
    "telemetry/controller.json",
    "telemetry/enterprise.json",
    "telemetry/network.json",
    "telemetry/sensors.json",
    "reference/idt/idt_v4.json",
    "reference/idt/idt_v4.ttl",
)


def main() -> None:
    for filename in FILES:
        source = DATA_ROOT / filename
        if not source.is_file():
            raise SystemExit(f"Missing checked-in synthetic fixture: data/{filename}")
    for filename in FILES:
        target = TARGET_ROOT / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(DATA_ROOT / filename, target)
    print(f"Bundled {len(FILES)} synthetic fixture files for the FastAPI service.")


if __name__ == "__main__":
    main()

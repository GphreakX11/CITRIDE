"""Read JSON/JSONL Zeek exports without enriching or interpreting source rows.

Grouping uses each record's ``_path`` (or its filename when absent). No asset
mapping, provenance, identifiers, or simulated metadata is inferred. Empty
arrays retain their filename group; manifest.json is packaging metadata only.
"""
from pathlib import Path
import json


def load_zeek_json(directory: Path | str) -> dict[str, list[dict]]:
    """Load immediate .json/.jsonl files, preserving order and unknown fields.

    Accept JSON arrays, single objects, and newline-delimited objects (including
    blank lines). Invalid records raise ValueError with a filename, not payload
    contents. Missing directories return an empty mapping.
    """
    directory = Path(directory)
    groups: dict[str, list[dict]] = {}
    if not directory.exists():
        return groups
    for path in sorted(directory.iterdir()):
        if not path.is_file() or path.suffix.lower() not in {".json", ".jsonl"}:
            continue
        if path.stem.lower() == "manifest":
            continue
        fallback = path.stem.removesuffix(".log")
        try:
            text = path.read_text(encoding="utf-8-sig")
            if not text.strip():
                rows = []
            else:
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    rows = [json.loads(line) for line in text.splitlines() if line.strip()]
                else:
                    rows = payload if isinstance(payload, list) else [payload]
            if not rows:
                groups.setdefault(fallback, [])
            for row in rows:
                if not isinstance(row, dict):
                    raise ValueError("Expected a log object")
                name = row.get("_path", fallback)
                if not isinstance(name, str) or not name.strip():
                    raise ValueError("Expected a nonempty _path")
                groups.setdefault(name, []).append(row)
        except (ValueError, UnicodeError) as error:
            raise ValueError(f"Invalid Zeek JSON in {path.name}") from error
    return groups

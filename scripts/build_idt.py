#!/usr/bin/env python3
"""Deterministic, offline conversion of the *pinned* public IDT v4 workbook.

This intentionally narrow OOXML reader never extracts ZIP members, follows
worksheet hyperlinks, evaluates formulas or downloads external resources.
Missing source values remain null; presentation fallbacks are not source data.
The generated Turtle is a reference artifact, NOT a runtime ontology import.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/reference/idt"
SOURCE_NAME = "Taxonomy_V4_Final_All_Sectors_22Jun2011.xlsx"
SOURCE_SHA256 = "ffeddc10b98cca1cd15abd53d70ba8a2bafd593760c8704e76834860fcf193a2"
VERSION = "IDT v4 (22 Jun 2011)"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PATH_PATTERN = re.compile(r"[1-9][0-9]*(?:\.[1-9][0-9]*)*")
# Source-specific corrections, not general floating-point rounding of identifiers.
NUMERIC_CORRECTIONS = {
    "A1176": ("8.8000000000000007", "8.8"),
    "A1825": ("16.399999999999999", "16.4"),
    "A1936": ("18.399999999999999", "18.4"),
    "A2001": ("18.170000000000002", "18.17"),
}


def seed_assignments() -> dict:
    """Exact IDs from supplied design §10; advisory, never baseline mutations."""
    result = {}
    for suffix in "abc":
        for prefix, path in {"utility": "12.6", "plant": "12.4", "sensor": "12.7",
                             "pressure": "12.7", "tank": "12.7", "org": "12.10.2"}.items():
            result[f"{prefix}-{suffix}"] = {"status": "coded", "path": path}
        for prefix in ("plc", "hmi", "workstation", "vpn"):
            parent = "plant" if prefix in ("plc", "hmi") else "org"
            result[f"{prefix}-{suffix}"] = {
                "status": "below_idt_level", "parentEntity": f"{parent}-{suffix}",
                "parentPath": "12.4" if parent == "plant" else "12.10.2",
            }
        for prefix in ("plc", "hmi", "sensor", "pressure", "tank", "workstation", "vpn"):
            result[f"cyber-{prefix}-{suffix}"] = {"status": "not_idt_asset", "reason": "cyber_identity"}
        for prefix, reason in (("area", "service_area"), ("population", "population_group")):
            result[f"{prefix}-{suffix}"] = {"status": "not_idt_asset", "reason": reason}
    for identifier, path in {"dialysis-x": "10.1.2.4", "hospital-y": "10.1.1.1",
                             "nursing-z": "10.1.3.1", "facility-q": "10.1",
                             "fire-f": "6.2.2", "electric-e": "5.1.3",
                             "hospital-w": "10.1.1.1", "dialysis-u": "10.1.2.4"}.items():
        result[identifier] = {"status": "coded", "path": path}
    for identifier in ("org-electric-e", "vendor-v"):
        result[identifier] = {"status": "unassigned"}
    return dict(sorted(result.items()))


def _xml(archive: ZipFile, name: str):
    data = archive.read(name)
    # UTF-8-only policy before parsing; rejects encoded DTD bypasses.
    if b"\x00" in data or b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("Unsupported XML encoding or declaration")
    text = data.decode("utf-8-sig")
    declaration = re.match(r"\s*<\?xml[^?]*encoding=['\"]([^'\"]+)", text)
    if declaration and declaration.group(1).upper() not in ("UTF-8", "UTF8"):
        raise ValueError("Only UTF-8 OOXML is supported")
    return ET.fromstring(text)


def _text(element) -> str:
    # Direct text and rich-text runs only, deliberately excluding phonetic nodes.
    return "".join(node.text or "" for node in element.findall(f"{S}t") +
                   element.findall(f"{S}r/{S}t"))


def read_entries(source: Path) -> list[dict]:
    if source.stat().st_size > 8 * 1024 * 1024:
        raise ValueError("Workbook exceeds bounded source budget")
    if sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError("Workbook SHA-256 does not match the approved IDT v4 source")
    with ZipFile(source) as archive:
        members = archive.infolist()
        if len(members) > 64 or len({m.filename for m in members}) != len(members):
            raise ValueError("Unbounded or ambiguous ZIP members")
        if sum(m.file_size for m in members) > 16 * 1024 * 1024:
            raise ValueError("Workbook exceeds decompressed budget")
        for member in members:
            path = PurePosixPath(member.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in member.filename:
                raise ValueError("Unsafe ZIP member path")
            if member.file_size > 8 * 1024 * 1024 or member.file_size / max(1, member.compress_size) > 500:
                raise ValueError("ZIP member exceeds parsing budget")
        workbook = _xml(archive, "xl/workbook.xml")
        sheets = workbook.findall(f"{S}sheets/{S}sheet")
        if len(sheets) != 1 or sheets[0].get("name") != "Main":
            raise ValueError("Expected exactly the Main sheet")
        relations = _xml(archive, "xl/_rels/workbook.xml.rels")
        ids = [rel.get("Id") for rel in relations]
        if len(set(ids)) != len(ids):
            raise ValueError("Ambiguous workbook relationships")
        sheet_rel = [rel for rel in relations if rel.get("Id") == sheets[0].get(f"{R}id")]
        if len(sheet_rel) != 1 or sheet_rel[0].get("TargetMode") == "External" or sheet_rel[0].get("Target") != "worksheets/sheet1.xml":
            raise ValueError("Unexpected worksheet relationship")
        strings_rel = [rel for rel in relations if (rel.get("Type") or "").endswith("/sharedStrings")]
        if len(strings_rel) != 1 or strings_rel[0].get("TargetMode") == "External" or strings_rel[0].get("Target") != "sharedStrings.xml":
            raise ValueError("Unexpected shared-string relationship")
        strings = [_text(item) for item in _xml(archive, "xl/sharedStrings.xml").findall(f"{S}si")]
        sheet = _xml(archive, "xl/worksheets/sheet1.xml")
        entries, corrections = [], set()
        for row in sheet.findall(f"{S}sheetData/{S}row"):
            values, cells = {}, {}
            for cell in row.findall(f"{S}c"):
                coordinate = cell.get("r", "")
                match = re.fullmatch(r"([A-Z]+)([0-9]+)", coordinate)
                if not match or match.group(2) != row.get("r") or match.group(1) in cells:
                    raise ValueError("Invalid or duplicate cell coordinate")
                column = match.group(1)
                cells[column] = cell
                if cell.find(f"{S}f") is not None:
                    raise ValueError("Formulas are unsupported in this pinned conversion")
                raw = cell.findtext(f"{S}v")
                if cell.get("t") == "s" and raw is not None:
                    position = int(raw)
                    if not 0 <= position < len(strings):
                        raise ValueError("Invalid shared-string index")
                    value = strings[position]
                elif cell.get("t") == "inlineStr":
                    value = _text(cell.find(f"{S}is"))
                elif cell.get("t") in (None, "n", "str"):
                    value = raw
                else:
                    raise ValueError("Unsupported cell type")
                values[column] = value if value not in (None, "") else None
            raw_path = values.get("A")
            if raw_path is None:
                continue
            path = raw_path
            path_cell = cells["A"]
            coordinate = path_cell.get("r")
            if coordinate in NUMERIC_CORRECTIONS:
                expected, path = NUMERIC_CORRECTIONS[coordinate]
                if raw_path != expected or path_cell.get("t") not in (None, "n"):
                    raise ValueError("Source numeric correction no longer matches")
                corrections.add(coordinate)
            if not PATH_PATTERN.fullmatch(path):
                continue  # repeated sector headers; integer sector roots ARE entries
            # Manufacturing rows contain whitespace-only placeholders in other
            # name columns. Ignore those for occupancy, preserve them as evidence.
            names = [(col, values[col]) for col in "BCDEF" if values.get(col) is not None and values[col].strip()]
            if len(names) > 1:
                raise ValueError("Ambiguous source name columns")
            parent = path.rsplit(".", 1)[0] if "." in path else None
            def source_value(column):
                value = values.get(column)
                return value if value is not None and value.strip() else None
            entries.append({"path": path, "idtId": source_value("I"),
                            "name": names[0][1] if names else None,
                            "level": len(path.split(".")), "description": source_value("H"),
                            "crossReference": source_value("J"), "naics": source_value("K"),
                            "sourceValues": {col: values.get(col) for col in "HIJK"},
                            "parent": parent, "sourceRow": int(row.attrib["r"]),
                            "sourceNameCells": {col: values.get(col) for col in "BCDEF"},
                            "sourcePath": {"cell": coordinate, "type": path_cell.get("t", "n"), "raw": raw_path},
                            "nameColumn": names[0][0] if names else None})
    paths = {entry["path"] for entry in entries}
    if len(entries) != 1985 or len(paths) != 1985 or corrections != set(NUMERIC_CORRECTIONS):
        raise ValueError("Pinned source entry/path/correction counts differ")
    if len([entry for entry in entries if entry["parent"] is None]) != 18:
        raise ValueError("Expected 18 source sectors")
    if any(entry["parent"] is not None and entry["parent"] not in paths for entry in entries):
        raise ValueError("Source hierarchy contains missing parents")
    return sorted(entries, key=lambda entry: tuple(int(token) for token in entry["path"].split(".")))


def _literal(value: str) -> str:
    # JSON escaping is compatible with Turtle short string literals here.
    return json.dumps(value, ensure_ascii=False)


def render_turtle(entries: list[dict]) -> bytes:
    lines = [f"# {VERSION}; source SHA-256 {SOURCE_SHA256}",
             "# Reference artifact only: not imported by the runtime OWL loader.",
             "# Missing descriptions are omitted, not fabricated definitions.",
             "@prefix c: <urn:citride:> .", "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
             "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .", ""]
    for entry in entries:
        suffix = entry["path"].replace(".", "_")
        subject = f"c:IDT_{suffix}"
        target = "c:IDT_" + entry["parent"].replace(".", "_") if entry["parent"] else "c:InfrastructureEntity"
        name = entry["name"] if entry["name"] is not None else f"Unnamed IDT v4 entry {entry['path']}"
        lines.extend([f"{subject} a owl:Class ;", f"  rdfs:label {_literal('IDT ' + entry['path'] + ' ' + name)} ;"])
        if entry["description"] is not None:
            lines.append(f"  rdfs:comment {_literal(entry['description'])} ;")
        lines.extend([f"  rdfs:subClassOf {target} .", f"c:axiom-idt-{suffix}-parent a owl:Axiom ;",
                      f"  rdfs:label {_literal('IDT v4 hierarchy: ' + entry['path'])} ;",
                      '  rdfs:comment "IDT v4 hierarchy; sector roots connect to the local InfrastructureEntity class." ;',
                      f"  owl:annotatedSource {subject} ;", "  owl:annotatedProperty rdfs:subClassOf ;",
                      f"  owl:annotatedTarget {target} .", ""])
    return ("\n".join(lines).rstrip("\n") + "\n").encode("utf-8")


def render_runtime_turtle(reference: dict) -> bytes:
    """OWL hierarchy from canonical JSON; source absence is not a definition."""
    lines = [f"# {reference['version']}; source SHA-256 {reference['sourceSha256']}",
             "# Local runtime hierarchy. No ontology declaration or external imports.",
             "@prefix c: <urn:citride:> .", "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
             "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .", ""]
    for entry in sorted(reference["entries"], key=lambda item: tuple(map(int, item["path"].split(".")))):
        path = entry["path"]
        suffix = path.replace(".", "_")
        subject = f"c:IDT_{suffix}"
        parent = "c:IDT_" + entry["parent"].replace(".", "_") if entry["parent"] else "c:InfrastructureEntity"
        name = entry["name"] or f"Unnamed IDT v4 entry {path}"
        description = entry["description"] or f"No description in the IDT v4 workbook (path {path})."
        lines.extend([f"{subject} a owl:Class ;", f"  rdfs:label {_literal('IDT ' + path + ' ' + name)} ;",
                      f"  rdfs:comment {_literal(description)} ;"])
        if not entry["description"]:
            lines.append('  c:descriptionStatus "absent_in_source" ;')
        lines.extend([f"  rdfs:subClassOf {parent} .", f"c:axiom-idt-{suffix}-parent a owl:Axiom ;",
                      '  rdfs:label "IDT v4 hierarchy" ;', '  rdfs:comment "IDT v4 hierarchy" ;',
                      f"  owl:annotatedSource {subject} ;", "  owl:annotatedProperty rdfs:subClassOf ;",
                      f"  owl:annotatedTarget {parent} .", ""])
    return ("\n".join(lines).rstrip("\n") + "\n").encode("utf-8")


def build(source: Path) -> dict[str, bytes]:
    entries = read_entries(source)
    assignments = seed_assignments()
    paths = {entry["path"] for entry in entries}
    for assignment in assignments.values():
        if assignment.get("path", assignment.get("parentPath")) not in paths | {None}:
            raise ValueError("Design assignment contains an unknown source code")
    turtle = render_turtle(entries)
    reference = {
        "version": VERSION, "sourceSha256": SOURCE_SHA256, "sourceFile": SOURCE_NAME,
        "entryCount": len(entries), "sectorCount": 18,
        "ttlSha256": sha256(turtle).hexdigest(), "semanticStatus": "reference_only",
        "runtimeOntologyLoaded": False,
        "conversionPolicy": "Pinned source only; four explicit numeric XML path corrections; strings verbatim; missing cells null; numeric identifiers retained as XML text.",
        "sourceDiagnostics": {"unnamedEntries": sum(entry["name"] is None for entry in entries),
                              "missingDescriptions": sum(entry["description"] is None for entry in entries),
                              "numericPathCorrections": [{"cell": cell, "raw": raw, "path": path} for cell, (raw, path) in NUMERIC_CORRECTIONS.items()]},
        "assignmentProvenance": "Stakeholder-supplied Billington beta design §10; canonical assignments for the existing 58 and proposed 9 IDs, copied onto newly generated entity records. Historical snapshots remain as captured.",
        "assignmentLimitations": [
            "Sensor/pressure/tank component codes reflect the supplied design's monitoring-system classification, not independently verified facility status.",
            "Organization parent codes for workstations/VPN gateways are reference associations, not asserted physical containment.",
            "Historical snapshots without captured IDT remain unassigned; do not apply seed fallback to history.",
            "Reference lookup is not an entailment proof; runtime OWL hierarchy and sourced witnesses are generated and recorded separately.",
        ],
        "proposedEntityIds": sorted([f"{prefix}-{suffix}" for suffix in "abc" for prefix in ("vpn", "cyber-vpn")] + ["vendor-v", "hospital-w", "dialysis-u"]),
        "assignments": assignments, "entries": entries,
    }
    return {"idt_v4.json": (json.dumps(reference, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
            "idt_v4.ttl": turtle}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=OUTPUT / SOURCE_NAME)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    parser.add_argument("--owl-output", type=Path, default=ROOT / "backend/citride/ontology/idt_v4_owl.ttl")
    parser.add_argument("--check", action="store_true", help="Compare bytes only; never rewrite artifacts")
    args = parser.parse_args()
    artifacts = build(args.source)
    for name, contents in artifacts.items():
        destination = args.output_dir / name
        if args.check:
            if not destination.is_file() or destination.read_bytes() != contents:
                print(f"IDT artifact differs: {destination}")
                return 1
        else:
            args.output_dir.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(contents)
    runtime = render_runtime_turtle(json.loads(artifacts["idt_v4.json"]))
    if args.check:
        if not args.owl_output.is_file() or args.owl_output.read_bytes() != runtime:
            print(f"IDT runtime artifact differs: {args.owl_output}")
            return 1
    else:
        args.owl_output.parent.mkdir(parents=True, exist_ok=True)
        args.owl_output.write_bytes(runtime)
    print(f"IDT v4: 1985 entries, 18 sectors; {'verified' if args.check else 'generated'} deterministic reference JSON/Turtle and separate runtime OWL")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

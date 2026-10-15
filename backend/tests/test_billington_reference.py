"""Owned, state-free verification of source conversion, reference lookup and router."""
from copy import deepcopy
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from rdflib import Graph, Namespace, OWL, RDF, RDFS

from citride import billington_reference as reference
from citride.access import DemoAccessMiddleware

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("build_idt_owned", ROOT / "scripts/build_idt.py")
converter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(converter)
SOURCE = ROOT / "data/reference/idt" / converter.SOURCE_NAME


@pytest.fixture(autouse=True)
def fresh_cache():
    reference._reference.cache_clear()
    yield
    reference._reference.cache_clear()


def test_pinned_counts_missing_values_and_source_ids():
    data = reference.idt_reference()
    turtle = (ROOT / "data/reference/idt/idt_v4.ttl").read_bytes()
    assert turtle.endswith(b"\n") and not turtle.endswith(b"\n\n")
    assert sha256(SOURCE.read_bytes()).hexdigest() == converter.SOURCE_SHA256
    assert data["version"] == "IDT v4 (22 Jun 2011)"
    assert len(data["entries"]) == len({entry["path"] for entry in data["entries"]}) == 1985
    assert len([entry for entry in data["entries"] if entry["parent"] is None]) == 18
    assert data["sourceDiagnostics"]["unnamedEntries"] == 0
    assert data["sourceDiagnostics"]["missingDescriptions"] == 26
    assert sum(entry["description"] is None for entry in data["entries"]) == 26
    assert [entry["path"] for entry in data["entries"] if entry["idtId"] == "4725"] == ["1.1.2.6.3", "1.2.12.2.1"]
    assert reference.idt_entry("10.1.2.4")["idtId"] == "688"
    assert reference.idt_entry("18.1")["name"] == "Critical Manufacturing"
    assert reference.idt_entry("18.1")["sourceNameCells"]["B"] == " "
    assert data["jsonSha256"] == sha256((SOURCE.parent / "idt_v4.json").read_bytes()).hexdigest()


def test_source_fields_independently_match_shared_strings_and_cell_xml():
    # Independent row/cell decoding verifies the complete source, not samples.
    namespace = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with ZipFile(SOURCE) as archive:
        string_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        strings = ["".join(node.text or "" for node in item.findall("s:t", namespace) + item.findall("s:r/s:t", namespace))
                   for item in string_root.findall("s:si", namespace)]
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    rows = {int(row.attrib["r"]): row for row in sheet.findall("s:sheetData/s:row", namespace)}
    for entry in reference.idt_reference()["entries"]:
        raw_values = {}
        for cell in rows[entry["sourceRow"]].findall("s:c", namespace):
            column = cell.attrib["r"].rstrip("0123456789")
            raw = cell.findtext("s:v", namespaces=namespace)
            raw_values[column] = strings[int(raw)] if cell.get("t") == "s" and raw is not None else raw
        assert entry["sourcePath"]["raw"] == raw_values["A"]
        names = [(col, raw_values.get(col)) for col in "BCDEF" if raw_values.get(col) and raw_values[col].strip()]
        assert len(names) == 1
        assert entry["nameColumn"] == names[0][0]
        assert entry["name"] == names[0][1]
        for field, column in (("description", "H"), ("idtId", "I"), ("crossReference", "J"), ("naics", "K")):
            value = raw_values.get(column)
            assert entry[field] == (value if value is not None and value.strip() else None)
            assert entry["sourceValues"][column] == (value if value != "" else None)


def test_explicit_numeric_corrections_parent_completeness_and_order():
    entries = reference.idt_reference()["entries"]
    by_cell = {entry["sourcePath"]["cell"]: entry for entry in entries}
    by_path = {entry["path"]: entry for entry in entries}
    for cell, (raw, path) in converter.NUMERIC_CORRECTIONS.items():
        assert by_cell[cell]["path"] == path
        assert by_cell[cell]["sourcePath"]["raw"] == raw
        assert by_cell[cell]["sourcePath"]["type"] == "n"
    assert all(entry["parent"] is None or entry["parent"] in by_path for entry in entries)
    assert entries == sorted(entries, key=lambda entry: tuple(map(int, entry["path"].split("."))))


def test_deterministic_conversion_check_and_drift_exit_status(tmp_path):
    first, second = converter.build(SOURCE), converter.build(SOURCE)
    assert first == second
    for name, contents in first.items():
        assert contents == (SOURCE.parent / name).read_bytes()
        (tmp_path / name).write_bytes(contents)
    command = [sys.executable, "-B", str(ROOT / "scripts/build_idt.py"), "--check", "--output-dir", str(tmp_path)]
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    (tmp_path / "idt_v4.json").write_bytes(first["idt_v4.json"] + b" ")
    assert subprocess.run(command, capture_output=True).returncode == 1
    assert (tmp_path / "idt_v4.json").read_bytes() == first["idt_v4.json"] + b" "  # check never repairs


def test_wrong_source_rejected_before_xml(tmp_path):
    unknown = tmp_path / "unknown.xlsx"
    unknown.write_bytes(b"unapproved-source")
    with pytest.raises(ValueError, match="SHA-256"):
        converter.build(unknown)


def test_turtle_reference_axioms_no_import_no_fabricated_missing_definition():
    data = reference.idt_reference()
    graph = Graph().parse(data=(SOURCE.parent / "idt_v4.ttl").read_text(), format="turtle")
    ns = Namespace("urn:citride:")
    assert len(list(graph.subjects(RDF.type, OWL.Class))) == 1985
    assert len(list(graph.subjects(RDF.type, OWL.Axiom))) == 1985
    assert not list(graph.triples((None, OWL.imports, None)))
    assert not list(graph.subjects(RDF.type, OWL.Ontology))
    for entry in data["entries"]:
        subject = ns["IDT_" + entry["path"].replace(".", "_")]
        target = ns["IDT_" + entry["parent"].replace(".", "_")] if entry["parent"] else ns.InfrastructureEntity
        assert (subject, RDFS.subClassOf, target) in graph
        axioms = list(graph.subjects(OWL.annotatedSource, subject))
        assert len(axioms) == 1
        assert (axioms[0], OWL.annotatedProperty, RDFS.subClassOf) in graph
        assert (axioms[0], OWL.annotatedTarget, target) in graph
        comments = list(graph.objects(subject, RDFS.comment))
        assert [str(value) for value in comments] == ([] if entry["description"] is None else [entry["description"]])
    assert data["runtimeOntologyLoaded"] is False
    assert data["semanticStatus"] == "reference_only"
    unnamed = deepcopy(data["entries"][0])
    unnamed["name"] = None
    unnamed["description"] = None
    assert b"Unnamed IDT v4 entry" in converter.render_turtle([unnamed])
    assert unnamed["name"] is None  # fallback never changes source data


def test_lookup_lineage_detached_and_unknowns():
    assert [entry["path"] for entry in reference.lineage("10.1.2.4")] == ["10.1.2.4", "10.1.2", "10.1", "10"]
    for path, expected in (("12.7", ["12.7", "12"]), ("6.2.2", ["6.2.2", "6.2", "6"]), ("5.1.3", ["5.1.3", "5.1", "5"])):
        assert [entry["path"] for entry in reference.lineage(path)] == expected
    assert reference.idt_entry("0") is None
    assert reference.lineage("0") == []
    entry = reference.idt_entry("10")
    entry["name"] = "changed"
    reference.lineage("10")[0]["name"] = "changed"
    reference.idt_reference()["assignments"]["dialysis-x"]["path"] = "0"
    assert reference.idt_entry("10")["name"] == "Healthcare and Public Health"
    assert reference.assignment_for_id("dialysis-x")["path"] == "10.1.2.4"


def test_exact_58_existing_plus_9_proposed_and_semantic_boundaries():
    data = reference.idt_reference()
    scenario = json.loads((ROOT / "data/scenario.json").read_text())
    ids = {entity["id"] for entity in scenario["entities"]}
    assert len(ids) == 58
    assert set(data["assignments"]) == ids | set(data["proposedEntityIds"])
    assert len(data["proposedEntityIds"]) == 9
    assert reference.assignment_for_id("dialysis-a") is None  # shorthand must not invent IDs
    assert reference.assignment_for_id("cyber-unverified-host") is None
    assert reference.assignment_for_id("org-electric-e") == {"status": "unassigned"}
    assert reference.assignment_for_id("vendor-v") == {"status": "unassigned"}
    assert reference.assignment_for_id("vpn-a") == {"status": "below_idt_level", "parentEntity": "org-a", "parentPath": "12.10.2"}
    assert reference.assignment_for_id("cyber-vpn-a") == {"status": "not_idt_asset", "reason": "cyber_identity"}
    assert reference.sector_of({"id": "plc-a"}, allow_seed_lookup=True)["path"] == "12"
    assert reference.sector_of({"id": "cyber-plc-a"}, allow_seed_lookup=True) is None


def test_history_never_gains_seed_assignment_without_explicit_opt_in():
    snapshot = {"id": "dialysis-x", "label": "historic name"}
    before = deepcopy(snapshot)
    assert reference.assignment_for(snapshot) is None
    assert reference.assignment_for(snapshot, allow_seed_lookup=True)["path"] == "10.1.2.4"
    assert snapshot == before
    for value in (None, {}, {"status": "coded", "path": "999"}, {"status": "below_idt_level", "parentPath": "12.4"}):
        assert reference.assignment_for({"id": "dialysis-x", "idt": value}, allow_seed_lookup=True) is None
    entity = {"id": "dialysis-x", "idt": {"status": "coded", "path": "12.4"}}
    assert reference.assignment_for(entity, allow_seed_lookup=True)["path"] == "12.4"


def test_router_is_read_only_and_inherits_existing_auth():
    app = FastAPI()
    app.add_middleware(DemoAccessMiddleware, username="reviewer", password="local-test-only", required=True)
    app.include_router(reference.idt_router)
    with TestClient(app) as client:
        assert client.get("/v1/reference/idt").status_code == 401
        assert client.get("/v1/reference/idt", auth=("reviewer", "incorrect")).status_code == 401
        response = client.get("/v1/reference/idt", auth=("reviewer", "local-test-only"))
        assert response.status_code == 200
        assert response.json()["entryCount"] == 1985
        assert response.headers["cache-control"] == "private, no-store"
        assert "Authorization" in response.headers["vary"]
        for method in ("post", "put", "patch", "delete"):
            assert getattr(client, method)("/v1/reference/idt", auth=("reviewer", "local-test-only")).status_code == 405
    assert [route.path for route in reference.idt_router.routes] == ["/v1/reference/idt"]


def test_missing_or_corrupt_artifact_returns_503_without_network(tmp_path, monkeypatch):
    monkeypatch.setattr(reference, "REFERENCE_DIR", tmp_path)
    app = FastAPI()
    app.include_router(reference.idt_router)
    with TestClient(app) as client:
        assert client.get("/v1/reference/idt").status_code == 503
        data = json.loads((SOURCE.parent / "idt_v4.json").read_text())
        data["entries"][0]["parent"] = "0"
        (tmp_path / "idt_v4.json").write_text(json.dumps(data))
        (tmp_path / "idt_v4.ttl").write_bytes((SOURCE.parent / "idt_v4.ttl").read_bytes())
        response = client.get("/v1/reference/idt")
        assert response.status_code == 503
        assert response.json() == {"detail": "IDT v4 reference is unavailable."}

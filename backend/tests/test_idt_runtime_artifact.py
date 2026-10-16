"""Generated runtime taxonomy is a separate sourced OWL artifact, never invented definitions."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

from rdflib import Graph, Literal, Namespace, OWL, RDF, RDFS

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("runtime_idt_builder", ROOT / "scripts/build_idt.py")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)
C = Namespace("urn:citride:")
REFERENCE = json.loads((ROOT / "data/reference/idt/idt_v4.json").read_text())


def test_runtime_owl_has_all_sourced_classes_exact_absence_comments_and_named_parent_axioms():
    raw = builder.render_runtime_turtle(REFERENCE)
    assert raw == builder.render_runtime_turtle(REFERENCE)
    graph = Graph().parse(data=raw, format="turtle")
    assert len(set(graph.subjects(RDF.type, OWL.Class))) == 1985
    assert list(graph.subjects(RDF.type, OWL.Ontology)) == []
    missing = []
    for entry in REFERENCE["entries"]:
        suffix = entry["path"].replace(".", "_")
        subject = C["IDT_" + suffix]
        parent = C["IDT_" + entry["parent"].replace(".", "_")] if entry["parent"] else C.InfrastructureEntity
        assert set(graph.objects(subject, RDFS.subClassOf)) == {parent}
        assert set(graph.objects(subject, RDFS.comment)) == {Literal(entry["description"] or f"No description in the IDT v4 workbook (path {entry['path']}).")}
        if not entry["description"]:
            missing.append(subject)
            assert (subject, C.descriptionStatus, Literal("absent_in_source")) in graph
        else:
            assert list(graph.objects(subject, C.descriptionStatus)) == []
        axiom = C["axiom-idt-" + suffix + "-parent"]
        assert (axiom, RDF.type, OWL.Axiom) in graph
        assert (axiom, OWL.annotatedSource, subject) in graph
        assert (axiom, OWL.annotatedProperty, RDFS.subClassOf) in graph
        assert (axiom, OWL.annotatedTarget, parent) in graph
        assert "IDT v4 hierarchy" in str(graph.value(axiom, RDFS.label))
        assert "IDT v4 hierarchy" in str(graph.value(axiom, RDFS.comment))
    assert len(missing) == 26
    assert str(graph.value(C.IDT_10_1_2_4, RDFS.label)) == "IDT 10.1.2.4 Kidney Dialysis Center"


def test_exact_user_required_source_absence_comment_is_accepted_by_strict_loader():
    from citride.reasoning import ontology_metadata
    metadata = ontology_metadata()
    assert len(metadata["axioms"]) >= 1985


def test_runtime_artifact_is_checked_and_never_repaired_by_check(tmp_path):
    output = tmp_path / "reference"
    owl = tmp_path / "idt_v4_owl.ttl"
    command = [sys.executable,"-B",str(ROOT / "scripts/build_idt.py"),"--output-dir",str(output),"--owl-output",str(owl)]
    result = subprocess.run(command,capture_output=True,text=True)
    assert result.returncode == 0, result.stderr
    expected = builder.render_runtime_turtle(json.loads((output / "idt_v4.json").read_text()))
    assert owl.read_bytes() == expected
    assert subprocess.run(command+["--check"],capture_output=True).returncode == 0
    owl.write_bytes(expected+b"# changed\n")
    assert subprocess.run(command+["--check"],capture_output=True).returncode == 1
    assert owl.read_bytes() == expected+b"# changed\n"

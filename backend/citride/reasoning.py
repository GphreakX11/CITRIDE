"""Real OWL 2 RL entailment with a small, independently replayable witness layer.

``owlrl`` computes the closure. It does not emit derivation proofs, so the
witness builder below only annotates conclusions already present in that
closure, using named local axioms and previously witnessed facts. Unsupported
ontology forms fail closed; no arbitrary ontology or RDF arrives from the UI.
Physical losses and timing remain the separate consequence engine's job.
"""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path
from urllib.parse import quote

from owlrl import DeductiveClosure, OWLRL_Semantics
from owlrl.Namespaces import ERRNS
from rdflib import BNode, Graph, Literal, Namespace, OWL, RDF, RDFS, URIRef

from .validation import FACILITY_TYPES, SAFE_ID

NS = Namespace("urn:citride:")
RECORD_PREFIX = "urn:citride:record:"
ONTOLOGY_PATH = Path(__file__).parent / "ontology" / "watershed.ttl"
PROFILE = "OWL 2 RL"
ENGINE_VERSION = "7.6.2"
LIMITATIONS = [
    "Locally authored, versioned ontology slice; no imported BFO, CCO, or IDT conformance is claimed.",
    "OWL 2 RL rule entailment is supported; this is not complete OWL 2 DL reasoning or a physical consequence model.",
    "Proofs are separate replayable witnesses for supported axioms; owlrl itself does not provide proofs.",
    "Dependency context comes only from promoted Dependency records, never geography, probing, or shared attacker infrastructure.",
]


class ReasoningError(ValueError):
    """An inference operation cannot safely produce a publishable run."""


class OntologyConfigurationError(ReasoningError):
    """The local ontology or installed engine exceeds the supported contract."""


class SemanticInconsistencyError(ReasoningError):
    """OWL RL reported a contradiction; callers must not persist the run."""

    def __init__(self, diagnostics: list[dict]):
        self.diagnostics = diagnostics
        super().__init__("OWL semantic inconsistency: " + "; ".join(item["message"] for item in diagnostics))


@dataclass(frozen=True)
class _Rule:
    kind: str
    axiom_id: str
    terms: tuple[URIRef, ...]


def ontology_document() -> str:
    """Read the bundled ontology verbatim; never resolve imports or fetch URLs."""
    try:
        return ONTOLOGY_PATH.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise OntologyConfigurationError("The bundled local ontology could not be read") from error


def _one(graph: Graph, subject, predicate):
    values = list(graph.objects(subject, predicate))
    if len(values) != 1:
        raise OntologyConfigurationError(f"Ontology {subject} must have exactly one {predicate}")
    return values[0]


def _local_uri(term) -> bool:
    return isinstance(term, URIRef) and str(term).startswith(str(NS)) and not str(term).startswith(RECORD_PREFIX)


def _chain(graph: Graph, head) -> tuple[URIRef, URIRef]:
    """Accept exactly two local object properties in a finite RDF list."""
    seen, items = set(), []
    while head != RDF.nil:
        if head in seen or len(items) >= 2 or not isinstance(head, (BNode, URIRef)):
            raise OntologyConfigurationError("Only finite length-2 property chains are supported")
        seen.add(head)
        items.append(_one(graph, head, RDF.first))
        head = _one(graph, head, RDF.rest)
    if len(items) != 2 or not all(_local_uri(item) for item in items):
        raise OntologyConfigurationError("Only length-2 chains of local object properties are supported")
    return tuple(items)


def _load_ontology() -> tuple[Graph, dict, list[_Rule], dict]:
    document = ontology_document()
    graph = Graph()
    try:
        graph.parse(data=document, format="turtle")
    except Exception as error:
        raise OntologyConfigurationError("The bundled local ontology is not valid Turtle") from error
    if any(graph.triples((None, OWL.imports, None))):
        raise OntologyConfigurationError("Ontology imports are unsupported; inference never fetches external ontologies")
    if version("owlrl") != ENGINE_VERSION:
        raise OntologyConfigurationError(f"This ontology requires owlrl {ENGINE_VERSION}")
    ontology_ids = list(graph.subjects(RDF.type, OWL.Ontology))
    if len(ontology_ids) != 1 or not _local_uri(ontology_ids[0]):
        raise OntologyConfigurationError("Exactly one local named owl:Ontology is required")
    ontology_id = ontology_ids[0]
    ontology_version = _one(graph, ontology_id, OWL.versionInfo)
    if not isinstance(ontology_version, Literal) or not str(ontology_version).strip():
        raise OntologyConfigurationError("A nonempty literal ontology version is required")
    classes = set(graph.subjects(RDF.type, OWL.Class))
    properties = set(graph.subjects(RDF.type, OWL.ObjectProperty))
    if not all(_local_uri(term) for term in classes | properties):
        raise OntologyConfigurationError("The supported ontology uses only locally declared classes and object properties")
    labels = {}
    for term in classes | properties | {ontology_id}:
        label, description = _one(graph, term, RDFS.label), _one(graph, term, RDFS.comment)
        if not all(isinstance(item, Literal) and str(item).strip() for item in (label, description)):
            raise OntologyConfigurationError("Every ontology term requires a label and definition")
        labels[term] = str(label)

    # This allowlist concerns the unexpanded authored ontology, not owlrl's
    # built-in closure. Reject new semantic constructs until witnesses exist.
    allowed_predicates = {
        RDF.type, RDF.first, RDF.rest, RDFS.label, RDFS.comment,
        RDFS.subClassOf, OWL.inverseOf, OWL.propertyChainAxiom, OWL.disjointWith,
        OWL.versionInfo, OWL.versionIRI, OWL.annotatedSource,
        OWL.annotatedProperty, OWL.annotatedTarget,
    }
    allowed_types = {OWL.Ontology, OWL.Class, OWL.ObjectProperty, OWL.Axiom, OWL.TransitiveProperty}
    for subject, predicate, obj in graph:
        if predicate not in allowed_predicates or (predicate == RDF.type and obj not in allowed_types):
            raise OntologyConfigurationError(f"Unsupported ontology rule or declaration: {predicate} {obj}")
        if predicate == RDF.type and obj == OWL.TransitiveProperty and subject not in properties:
            raise OntologyConfigurationError("Transitivity requires a declared local object property")

    annotations = defaultdict(list)
    for axiom in graph.subjects(RDF.type, OWL.Axiom):
        if not _local_uri(axiom):
            raise OntologyConfigurationError("Every supported axiom must have a stable local IRI")
        triple = tuple(_one(graph, axiom, field) for field in (
            OWL.annotatedSource, OWL.annotatedProperty, OWL.annotatedTarget,
        ))
        if triple not in graph:
            raise OntologyConfigurationError(f"Named axiom {axiom} must annotate an existing ontology statement")
        annotations[triple].append(axiom)

    rules, axioms = [], []
    semantic_triples = sorted((triple for triple in graph if (
        triple[1] in {RDFS.subClassOf, OWL.inverseOf, OWL.propertyChainAxiom, OWL.disjointWith}
        or (triple[1] == RDF.type and triple[2] == OWL.TransitiveProperty)
    )), key=lambda triple: tuple(str(term) for term in triple))
    for subject, predicate, obj in semantic_triples:
        named = annotations[(subject, predicate, obj)]
        if len(named) != 1:
            raise OntologyConfigurationError("Every supported semantic statement requires exactly one named axiom")
        axiom = named[0]
        label, description = _one(graph, axiom, RDFS.label), _one(graph, axiom, RDFS.comment)
        if not all(isinstance(item, Literal) and str(item).strip() for item in (label, description)):
            raise OntologyConfigurationError("Every named axiom requires a readable label and definition")
        if predicate in {RDFS.subClassOf, OWL.disjointWith}:
            if subject not in classes or obj not in classes:
                raise OntologyConfigurationError("Class axioms must connect declared local classes")
            kind = "subclass" if predicate == RDFS.subClassOf else "disjoint"
            terms = (subject, obj)
        elif predicate == OWL.inverseOf:
            if subject not in properties or obj not in properties:
                raise OntologyConfigurationError("Inverse axioms must connect declared local properties")
            kind, terms = "inverse", (subject, obj)
        elif predicate == OWL.propertyChainAxiom:
            chain = _chain(graph, obj)
            if subject not in properties or not all(leg in properties for leg in chain):
                raise OntologyConfigurationError("Property chains must use declared local properties")
            kind, terms = "chain", (subject, *chain)
        else:
            kind, terms = "transitive", (subject,)
        rules.append(_Rule(kind, str(axiom), terms))
        # Terms are replayable rule arguments. RDF-list blank node identifiers
        # are intentionally absent from the public axiom catalog.
        axioms.append({"id": str(axiom), "label": str(label), "description": str(description),
                       "rule": kind, "terms": [str(term) for term in terms]})
    if set(annotations) != set(semantic_triples):
        raise OntologyConfigurationError("Named axiom annotations must describe only supported semantic statements")
    metadata = {
        "id": str(ontology_id), "version": str(ontology_version),
        "sha256": sha256(document.encode("utf-8")).hexdigest(),
        "profile": PROFILE, "engine": {"name": "owlrl", "version": ENGINE_VERSION},
        "axioms": sorted(axioms, key=lambda item: item["id"]), "limitations": list(LIMITATIONS),
    }
    return graph, metadata, sorted(rules, key=lambda rule: rule.axiom_id), {
        "classes": classes, "properties": properties, "labels": labels,
    }


def ontology_metadata() -> dict:
    """Describe the current pinned local ontology without computing a closure."""
    return _load_ontology()[1]


def _resource(identifier: str) -> URIRef:
    return URIRef(RECORD_PREFIX + quote(identifier, safe="._-:"))


def _project(data: dict, vocabulary: dict) -> tuple[Graph, dict, dict, list[str]]:
    """Project promoted baseline records, deliberately omitting timing/telemetry.

    PhysicalFacility is an asserted input because the existing RDF writer
    materializes it. Curated event ``seenOn`` IDs become explicit IRI links in
    this projection, including legacy state files that stored the field as a
    JSON/string value. No existing inference graph contributes input facts.
    """
    graph, record_index, origins, warnings = Graph(), {}, defaultdict(set), []
    default_types = {"serviceFunctions": "ServiceFunction", "dependencies": "Dependency", "events": "Event", "sources": "Source"}
    record_types, record_collections, seen_ids = {}, {}, set()
    collections = ("entities", "serviceFunctions", "dependencies", "events", "sources")
    for field in collections:
        records = data.get(field, [])
        if not isinstance(records, list):
            raise ReasoningError(f"Baseline {field} must be a record list")
        for record in records:
            identifier = record.get("id") if isinstance(record, dict) else None
            if not isinstance(identifier, str) or not SAFE_ID.fullmatch(identifier):
                raise ReasoningError(f"Baseline {field} contains an invalid record identifier")
            resource = _resource(identifier)
            if resource in seen_ids:
                raise ReasoningError(f"Baseline record identifier {identifier} is duplicated")
            seen_ids.add(resource)
            if field == "dependencies":
                status = record.get("status", "promoted")
                if not isinstance(status, str):
                    raise ReasoningError(f"Dependency {identifier} status must be a string")
                if not status.startswith("promoted"):
                    warnings.append(f"Unpromoted dependency {identifier} was excluded from the promoted input projection.")
                    continue
            record_index[resource] = record
            record_type = record.get("type", default_types.get(field))
            if not isinstance(record_type, str) or not record_type:
                raise ReasoningError(f"Record {identifier} requires a class name")
            record_types[resource] = record_type
            record_collections[resource] = field
    source_ids = {item["id"] for item in data.get("sources", [])}
    projected_collections = ("entities", "serviceFunctions", "dependencies", "events")
    facility_types = set(FACILITY_TYPES) | {"PhysicalFacility"}
    physical_infrastructure_types = facility_types | {"PhysicalAsset", "PhysicalOTAsset", "PhysicalITAsset"}
    # These are data-shape checks on the explicit baseline, not new OWL
    # domain/range axioms. Keeping them separate avoids presenting a malformed
    # input relation as either an inferred type or a detected OWL contradiction.
    relation_types = {
        "seenOn": ({"Event", "CyberEvent"}, {"CyberAsset"}),
        "hostsCyberAsset": (physical_infrastructure_types, {"CyberAsset"}),
        "hostedBy": ({"CyberAsset"}, physical_infrastructure_types),
        "partOf": (physical_infrastructure_types, facility_types),
        "operatedBy": (physical_infrastructure_types, {"Organization"}),
        "locatedIn": (facility_types | {"PopulationGroup"}, {"ServiceArea"}),
        "serves": ({"WaterServiceProvider"}, {"ServiceArea"}),
        "facility": ({"ServiceFunction"}, facility_types),
        "provider": ({"Dependency"}, facility_types),
        "dependent": ({"Dependency"}, facility_types),
        "dependentFunction": ({"Dependency"}, {"ServiceFunction"}),
    }
    fields = {
        "entities": {"partOf", "operatedBy", "hostsCyberAsset", "hostedBy", "serves", "locatedIn"},
        "serviceFunctions": {"facility"},
        "dependencies": {"provider", "dependent", "dependentFunction"},
        "events": {"seenOn"},
    }
    for collection in projected_collections:
        for record in data.get(collection, []):
            subject = _resource(record["id"])
            if subject not in record_index:
                continue
            refs = record.get("sourceRefs")
            if not isinstance(refs, list) or not refs or any(not isinstance(ref, str) or ref not in source_ids for ref in refs):
                raise ReasoningError(f"Record {record['id']} must reference existing captured source records")
            record_type = record_types[subject]
            if not isinstance(record_type, str) or not record_type:
                raise ReasoningError(f"Record {record['id']} requires a class name")
            if NS[record_type] not in vocabulary["classes"]:
                warnings.append(f"Class {record_type} on {record['id']} is outside this local ontology slice; its class assertion was omitted.")
            else:
                triple = (subject, RDF.type, NS[record_type])
                graph.add(triple)
                origins[triple].update(refs)
            if record_type in FACILITY_TYPES:
                triple = (subject, RDF.type, NS.PhysicalFacility)
                graph.add(triple)
                origins[triple].update(refs)
            for field in sorted(fields[collection]):
                value = record.get(field)
                if value is None:
                    continue
                references = value if isinstance(value, list) else [value]
                for reference in references:
                    if not isinstance(reference, str) or _resource(reference) not in record_index:
                        raise ReasoningError(f"Record {record['id']} has an unknown {field} endpoint")
                    allowed_source_types, allowed_target_types = relation_types[field]
                    target = _resource(reference)
                    target_type = record_types[target]
                    expected_collection = "serviceFunctions" if field == "dependentFunction" else "entities"
                    if (
                        record_type not in allowed_source_types or target_type not in allowed_target_types
                        or record_collections[target] != expected_collection
                    ):
                        raise ReasoningError(
                            f"Record {record['id']} has invalid {field} endpoint types: {record_type} to {target_type}"
                        )
                    if field == "dependentFunction" and record_index[target].get("facility") != record.get("dependent"):
                        raise ReasoningError(f"Dependency {record['id']} dependentFunction must belong to its dependent facility")
                    triple = (subject, NS[field], _resource(reference))
                    graph.add(triple)
                    origins[triple].update(refs)
    return graph, record_index, origins, warnings


def _useful(triple, record_index: dict, vocabulary: dict) -> bool:
    subject, predicate, obj = triple
    if subject not in record_index:
        return False
    if predicate == RDF.type:
        return obj in vocabulary["classes"]
    return predicate in vocabulary["properties"] and obj in record_index


def _triple_key(triple) -> tuple[str, str, str]:
    return tuple(str(term) for term in triple)


def _fact_id(triple) -> str:
    # N3 term encoding preserves term boundaries without depending on parser
    # blank-node IDs, traversal order, or a particular run identifier.
    canonical = " ".join(term.n3() for term in triple)
    return "fact-" + sha256(canonical.encode("utf-8")).hexdigest()[:24]


def _witnesses(asserted: set, delta: set, rules: list[_Rule]) -> dict:
    """Annotate only real owlrl delta, using an acyclic witnessed fact frontier.

    This is not the reasoner. Membership in owlrl's closure delta is mandatory
    for every conclusion. A wave may depend only on earlier waves, making its
    proof replayable from declared input facts, even for cyclic containment.
    """
    witnesses = {triple: ((), ()) for triple in asserted}
    while True:
        by_property, by_type = defaultdict(list), defaultdict(list)
        for triple in sorted(witnesses, key=_triple_key):
            by_property[triple[1]].append(triple)
            if triple[1] == RDF.type:
                by_type[triple[2]].append(triple)
        candidates = {}

        def consider(conclusion, rule, premises):
            if conclusion in delta and conclusion not in witnesses and conclusion not in candidates:
                candidates[conclusion] = ((rule.axiom_id,), tuple(premises))

        for rule in rules:
            if rule.kind == "subclass":
                child, parent = rule.terms
                for premise in by_type[child]:
                    consider((premise[0], RDF.type, parent), rule, (premise,))
            elif rule.kind == "inverse":
                left, right = rule.terms
                for original, inverse in ((left, right), (right, left)):
                    for premise in by_property[original]:
                        consider((premise[2], inverse, premise[0]), rule, (premise,))
            elif rule.kind in {"chain", "transitive"}:
                if rule.kind == "transitive":
                    result = first = second = rule.terms[0]
                else:
                    result, first, second = rule.terms
                seconds_by_subject = defaultdict(list)
                for premise in by_property[second]:
                    seconds_by_subject[premise[0]].append(premise)
                for left in by_property[first]:
                    for right in seconds_by_subject[left[2]]:
                        consider((left[0], result, right[2]), rule, (left, right))
        if not candidates:
            return witnesses
        witnesses.update(candidates)


def compute_inference(data: dict, run_id: str) -> dict:
    """Capture a baseline and compute OWL inference; API stamps createdAt.

    No mutation of the input or baseline occurs. A contradiction or unsupported
    ontology raises a typed ValueError before any inference run is publishable.
    """
    if not isinstance(data, dict):
        raise ReasoningError("Inference baseline must be an object")
    if not isinstance(run_id, str) or not SAFE_ID.fullmatch(run_id):
        raise ReasoningError("Inference run_id must be a safe identifier")
    revision = data.get("baselineRevision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ReasoningError("Inference requires a positive promoted baseline revision")
    snapshot = deepcopy(data)
    ontology_graph, metadata, rules, vocabulary = _load_ontology()
    input_graph, records, origins, warnings = _project(snapshot, vocabulary)
    asserted_all = set(input_graph)
    closure = Graph()
    for triple in asserted_all | set(ontology_graph):
        closure.add(triple)
    before_closure = set(closure)
    # The actual standards-based library, not the witness annotator, performs
    # all entailment. No network or remote import resolution occurs here.
    DeductiveClosure(OWLRL_Semantics, axiomatic_triples=False, datatype_axioms=False).expand(closure)
    errors = sorted({str(message) for message in closure.objects(None, ERRNS.error)})
    if errors:
        raise SemanticInconsistencyError([
            {"kind": "semantic_consistency", "status": "failed", "message": error} for error in errors
        ])
    asserted = {triple for triple in asserted_all if _useful(triple, records, vocabulary)}
    closure_delta = set(closure) - before_closure
    useful_delta = {triple for triple in closure_delta if _useful(triple, records, vocabulary)}
    witnesses = _witnesses(asserted, useful_delta, rules)
    traced_delta = useful_delta & witnesses.keys()
    untraced_count = len(useful_delta - traced_delta)
    if untraced_count:
        warnings.append(f"{untraced_count} useful OWL conclusions were withheld because no supported replayable witness was found.")

    def node(term):
        if term in records:
            record = records[term]
            return {"id": record["id"], "iri": str(term), "label": record.get("label", record["id"])}
        return {"id": str(term).removeprefix(str(NS)), "iri": str(term), "label": vocabulary["labels"][term]}

    source_sets = {triple: set(origins[triple]) for triple in asserted}
    # Witness dict insertion order is topological: asserted inputs first, then
    # each breadth-first wave. Source inheritance follows that exact order.
    for triple, (_, premises) in witnesses.items():
        if premises:
            source_sets[triple] = set().union(*(source_sets[premise] for premise in premises))

    def fact(triple):
        subject, predicate, obj = triple
        axiom_ids, premises = witnesses[triple]
        return {
            "id": _fact_id(triple), "subject": node(subject),
            "predicate": {"iri": str(predicate), "label": "is a" if predicate == RDF.type else vocabulary["labels"][predicate]},
            "object": node(obj), "status": "asserted" if triple in asserted else "inferred",
            "sourceRefs": sorted(source_sets[triple]), "axiomIds": list(axiom_ids),
            "premiseFactIds": [_fact_id(premise) for premise in premises],
        }

    return {
        "id": run_id, "baselineRevision": revision, "profile": PROFILE,
        "engine": metadata["engine"],
        "ontology": {key: metadata[key] for key in ("id", "version", "sha256", "axioms")},
        "baselineSnapshot": snapshot,
        "assertedFacts": [fact(triple) for triple in sorted(asserted, key=_triple_key)],
        "inferredFacts": [fact(triple) for triple in sorted(traced_delta, key=_triple_key)],
        "warnings": warnings,
        "limitations": list(LIMITATIONS),
        "diagnostics": [
            {"kind": "semantic_consistency", "status": "passed", "message": "owlrl reported no semantic contradictions in this supported OWL 2 RL slice; SHACL validation is separate."},
            {"kind": "witness", "status": "warning" if untraced_count else "passed", "message": "Published inferred facts have acyclic witnesses built separately from owlrl using named axioms and captured facts."},
        ],
        "statistics": {
            "inputTriples": len(input_graph), "ontologyTriples": len(ontology_graph),
            "closureTriples": len(closure), "closureDeltaTriples": len(closure_delta),
            "displayedAssertedFacts": len(asserted), "displayedInferredFacts": len(traced_delta),
            "untracedUsefulFacts": untraced_count,
            "selectionDescription": "Displayed facts are a selected useful record/class/relation projection, not every OWL closure triple; built-in axioms, datatype/reflexive sameAs noise and RDF-list blank nodes are omitted.",
        },
    }

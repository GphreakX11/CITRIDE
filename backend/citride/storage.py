"""RDF-backed local repository with atomic writes and process-safe mutations.

The named baseline graph is the sole mutable baseline. Draft proposals have their
own graphs, and run graphs retain complete immutable snapshots. JSON literals
retain structured records; typed relational triples permit graph interchange.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import tempfile
import threading
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from typing import Callable
from urllib.parse import quote
from uuid import uuid4

from rdflib import Dataset, Literal, Namespace, RDF, RDFS, URIRef, XSD

from . import MODEL_VERSION
from .validation import FACILITY_TYPES, validate_baseline, validate_dependency

NS = Namespace("urn:citride:")
BASELINE = URIRef("urn:citride:graph:baseline")
ROOT = URIRef("urn:citride:baseline")
REFERENCE_FIELDS = {
    "provider", "dependent", "dependentFunction", "partOf", "operatedBy",
    "serves", "locatedIn", "hostsCyberAsset", "hostedBy", "facility", "sourceRefs", "seenOn", "supportAccountAt",
}


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class InvalidModelError(Exception):
    pass


class StorageUnavailableError(Exception):
    """Safe public error without connection details or credentials."""


def _json(value: object) -> str:
    return json.dumps(value, allow_nan=False, separators=(",", ":"), sort_keys=True)


def _resource(identifier: str) -> URIRef:
    return URIRef("urn:citride:record:" + quote(identifier, safe="._-:"))


class Repository:
    def __init__(self, data_dir: Path, scenario_path: Path, *, existing_only=False):
        self.data_dir = Path(data_dir)
        self.scenario_path = Path(scenario_path)
        self.path = self.data_dir / "citride.nq"
        self.lock_path = self.data_dir / "citride.lock"
        self._thread_lock = threading.RLock()
        self._cached_dataset: Dataset | None = None
        self._cached_signature: tuple[int, int, int] | None = None
        if existing_only:
            if not self.path.is_file():
                raise InvalidModelError('Explicit intake requires an existing store')
            return  # Operator intake must never seed or repair at construction.
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with self._locked():
            if not self.path.exists():
                self._save(self._seed_dataset())
            else:
                # Earlier releases indexed event seenOn references as literals.
                # Repair that RDF index from the unchanged authoritative JSON
                # payload; preserve the revision and every historical graph.
                dataset = self._load()
                if self._repair_seen_on(dataset):
                    self._save(dataset)

    def _seed_dataset(self) -> Dataset:
        """Build a new seed only when the selected durable state is absent."""
        with self.scenario_path.open(encoding="utf-8") as source:
            data = json.load(source)
        # Model intake precedes record seeding and automatic analysis. Generic
        # event-free RDF fixtures intentionally do not load application feeds.
        if data.get("events"):
            from .scripted_sources import load_sources
            from .consequence_model import intake_source_models
            _, bundles, reference = load_sources(self.scenario_path)
            data = intake_source_models(data, reference, bundles)
        errors = validate_baseline(data)
        if errors:
            raise InvalidModelError("Invalid initial model: " + "; ".join(errors))
        data["baselineRevision"] = 1
        data["modelVersion"] = MODEL_VERSION
        dataset = Dataset()
        self._write_baseline(dataset, data)
        from .records import RecordsService
        # An event-free generic RDF fixture is not the scripted application.
        # Actual app startup independently validates its record configuration.
        if data.get("events"):
            RecordsService(self, scenario=data).seed(dataset)
        return dataset

    def reset_demo(self, expected_revision: int, client_request_id: str) -> dict:
        """Explicit, revision-fenced, replay-safe replacement of this one store."""
        with self._locked():
            dataset = self._load()
            try:
                prior = self._record(dataset, "demo-reset", client_request_id)
            except NotFoundError:
                prior = None
            if prior is not None:
                if prior["expectedBaselineRevision"] != expected_revision:
                    raise ConflictError("Reset request identifier was already used differently")
                return deepcopy(prior)
            baseline = self._baseline(dataset)
            if baseline["baselineRevision"] != expected_revision:
                raise ConflictError("Baseline changed; reload before resetting the demo")
            receipts = self._records(dataset, "demo-reset")
            replacement = self._seed_dataset()
            fresh = self._baseline(replacement)
            fresh["baselineRevision"] = expected_revision + 1
            self._write_baseline(replacement, fresh)
            receipt = {"id": client_request_id, "expectedBaselineRevision": expected_revision, "baselineRevision": fresh["baselineRevision"]}
            for item in receipts + [receipt]:
                self._record_graph(replacement, "demo-reset", item)
            self._save(replacement)
            return deepcopy(receipt)

    def _repair_seen_on(self, dataset: Dataset) -> bool:
        graph = dataset.graph(BASELINE)
        changed = False
        for event in self._baseline(dataset).get("events", []):
            references = event.get("seenOn", [])
            if isinstance(references, str):
                references = [references]
            if not references:
                continue
            subject = _resource(event["id"])
            expected = {_resource(reference) for reference in references if isinstance(reference, str)}
            if set(graph.objects(subject, NS.seenOn)) != expected:
                graph.remove((subject, NS.seenOn, None))
                for reference in expected:
                    graph.add((subject, NS.seenOn, reference))
                changed = True
        return changed

    @contextmanager
    def _locked(self):
        with self._thread_lock:
            # Nested repository reads share this thread's existing file lock,
            # just as Postgres reads share the outer transaction. A second
            # independently opened flock would deadlock the same thread.
            if getattr(self, '_lock_depth', 0):
                yield
                return
            with self.lock_path.open("a", encoding="utf-8") as lock_file:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                self._lock_depth = 1
                try:
                    yield
                except BaseException:
                    # Mutations work under the same lock as reads. If a write
                    # fails, discard any modified in-memory graph immediately.
                    self._cached_dataset = None
                    self._cached_signature = None
                    raise
                finally:
                    self._lock_depth = 0
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _load(self) -> Dataset:
        # PROTOTYPE: Whole graph stored as one N-Quads blob per environment.
        # Real version needs per-record tables/graph storage partitioned by customer,
        # live-feed intake, and the infrastructure model in the database, not scenario.json.
        signature = self._signature()
        if self._cached_dataset is not None and signature == self._cached_signature:
            return self._cached_dataset
        dataset = Dataset()
        dataset.parse(self.path, format="nquads")
        self._cached_dataset = dataset
        self._cached_signature = signature
        return dataset

    def _signature(self) -> tuple[int, int, int]:
        stat = self.path.stat()
        return stat.st_ino, stat.st_mtime_ns, stat.st_size

    def _save(self, dataset: Dataset) -> None:
        # PROTOTYPE: Whole-graph rewrite; see _load for required per-customer storage replacement.
        serialized = dataset.serialize(format="nquads", encoding="utf-8")
        temporary_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.data_dir, suffix=".nq.tmp", delete=False) as output:
                temporary_path = output.name
                output.write(serialized)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary_path, self.path)
            temporary_path = None
            directory_fd = os.open(self.data_dir, os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            self._cached_dataset = dataset
            self._cached_signature = self._signature()
        finally:
            if temporary_path is not None:
                os.unlink(temporary_path)

    def _write_baseline(self, dataset: Dataset, data: dict) -> None:
        graph = dataset.graph(BASELINE)
        graph.remove((None, None, None))
        for field, value in data.items():
            # Collection records remain RDF literals as well as materialized
            # relationships. Reading and writing one graph prevents split truth.
            if isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
                for index, item in enumerate(value):
                    resource = _resource(item.get("id", f"{field}-{index}"))
                    graph.add((ROOT, NS[field], resource))
                    graph.add((resource, NS.collection, Literal(field)))
                    graph.add((resource, NS.position, Literal(index, datatype=XSD.integer)))
                    graph.add((resource, NS.payload, Literal(_json(item), datatype=RDF.JSON)))
                    record_type = item.get("type", {
                        "dependencies": "Dependency", "serviceFunctions": "ServiceFunction",
                        "sources": "Source", "assumptions": "ParameterAssertion",
                        "events": "Event", "assessments": "Assessment", "scenarios": "Scenario",
                    }.get(field, field))
                    graph.add((resource, RDF.type, NS[record_type]))
                    if record_type in FACILITY_TYPES:
                        graph.add((resource, RDF.type, NS.PhysicalFacility))
                    if "label" in item:
                        graph.add((resource, RDFS.label, Literal(item["label"])))
                    for key, item_value in item.items():
                        if key in REFERENCE_FIELDS:
                            references = item_value if isinstance(item_value, list) else [item_value]
                            for reference in references:
                                if isinstance(reference, str):
                                    graph.add((resource, NS[key], _resource(reference)))
                        elif key == "requiredService" and isinstance(item_value, str):
                            graph.add((resource, NS[key], Literal(item_value, datatype=XSD.string)))
                        elif field == "dependencies" and key in {
                            "propagationDelayMinHours", "propagationDelayMaxHours",
                            "usableBackupMinHours", "usableBackupMaxHours", "lossOfFunction",
                        } and isinstance(item_value, (int, float)):
                            graph.add((resource, NS[key], Literal(float(item_value), datatype=XSD.double)))
                        elif isinstance(item_value, (str, int, float, bool)):
                            graph.add((resource, NS[key], Literal(item_value)))
                        elif isinstance(item_value, list) and all(isinstance(v, str) for v in item_value):
                            for member in item_value:
                                graph.add((resource, NS[key], Literal(member)))
            else:
                graph.add((ROOT, NS[field], Literal(_json(value), datatype=RDF.JSON)))

    def _baseline(self, dataset: Dataset) -> dict:
        graph = dataset.graph(BASELINE)
        data = {}
        for predicate in set(graph.predicates(ROOT)):
            field = str(predicate).removeprefix(str(NS))
            objects = list(graph.objects(ROOT, predicate))
            if objects and isinstance(objects[0], URIRef):
                ordered = sorted(objects, key=lambda record: int(graph.value(record, NS.position)))
                data[field] = [json.loads(str(graph.value(record, NS.payload))) for record in ordered]
            elif objects:
                data[field] = json.loads(str(objects[0]))
        return data

    def baseline(self) -> dict:
        with self._locked():
            return self._baseline(self._load())

    def _record_graph(self, dataset: Dataset, kind: str, record: dict) -> None:
        identifier = record["id"]
        graph = dataset.graph(URIRef(f"urn:citride:graph:{kind}:{quote(identifier, safe='')}"))
        graph.remove((None, None, None))
        resource = _resource(identifier)
        graph.add((resource, RDF.type, NS[kind]))
        graph.add((resource, NS.payload, Literal(_json(record), datatype=RDF.JSON)))
        if kind == "proposal":
            dependency = record["dependency"]
            snapshot = URIRef(str(resource) + ":dependency")
            graph.add((resource, NS.dependencySnapshot, snapshot))
            self._dependency_triples(graph, snapshot, dependency)
        if kind == "run":
            graph.add((resource, NS.baselineRevision, Literal(record["baselineRevision"], datatype=XSD.integer)))
            graph.add((resource, NS.scenarioId, Literal(record["scenarioId"])))
            for dependency in record.get("baselineSnapshot", {}).get("dependencies", []):
                snapshot = _resource(dependency["id"])
                graph.add((resource, NS.dependencySnapshot, snapshot))
                self._dependency_triples(graph, snapshot, dependency)

    def _dependency_triples(self, graph, resource: URIRef, dependency: dict) -> None:
        graph.add((resource, RDF.type, NS.Dependency))
        for field, value in dependency.items():
            if field in REFERENCE_FIELDS:
                for item in value if isinstance(value, list) else [value]:
                    if isinstance(item, str):
                        graph.add((resource, NS[field], _resource(item)))
            elif field == "requiredService" and isinstance(value, str):
                graph.add((resource, NS[field], Literal(value, datatype=XSD.string)))
            elif field in {
                "propagationDelayMinHours", "propagationDelayMaxHours",
                "usableBackupMinHours", "usableBackupMaxHours", "lossOfFunction",
            } and isinstance(value, (int, float)):
                graph.add((resource, NS[field], Literal(float(value), datatype=XSD.double)))
            elif isinstance(value, (str, int, float, bool)):
                graph.add((resource, NS[field], Literal(value)))
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        graph.add((resource, NS[field], Literal(item)))

    def _records(self, dataset: Dataset, kind: str) -> list[dict]:
        prefix = f"urn:citride:graph:{kind}:"
        records = []
        for graph in dataset.graphs():
            if str(graph.identifier).startswith(prefix):
                resource = next(graph.subjects(RDF.type, NS[kind]), None)
                payload = graph.value(resource, NS.payload) if resource is not None else None
                if payload is not None:
                    records.append(json.loads(str(payload)))
        return sorted(records, key=lambda item: (item.get("createdAt", ""), item["id"]))

    def _record(self, dataset: Dataset, kind: str, identifier: str) -> dict:
        graph = dataset.graph(URIRef(f"urn:citride:graph:{kind}:{quote(identifier, safe='')}"))
        payload = graph.value(_resource(identifier), NS.payload)
        if payload is None:
            raise NotFoundError(f"{kind.title()} {identifier} was not found")
        return json.loads(str(payload))

    def create_proposal(self, dependency: dict, expected_revision: int) -> dict:
        with self._locked():
            dataset = self._load()
            if expected_revision != self._baseline(dataset)["baselineRevision"]:
                raise ConflictError("Baseline revision changed; reload and re-stage against the current baseline")
            proposal = {
                "id": "proposal-" + uuid4().hex,
                "status": "draft",
                "dependency": deepcopy(dependency),
                "expectedBaselineRevision": expected_revision,
            }
            self._record_graph(dataset, "proposal", proposal)
            self._save(dataset)
            return proposal

    def proposals(self) -> list[dict]:
        with self._locked():
            return self._records(self._load(), "proposal")

    def proposal(self, identifier: str) -> dict:
        with self._locked():
            return self._record(self._load(), "proposal", identifier)

    def validate_proposal(self, identifier: str) -> dict:
        with self._locked():
            dataset = self._load()
            proposal = self._record(dataset, "proposal", identifier)
            errors = validate_dependency(proposal["dependency"], self._baseline(dataset))
            valid = not errors
            if proposal["status"] != "promoted":
                proposal["status"] = "validated" if valid else "needs_review"
                self._record_graph(dataset, "proposal", proposal)
                self._save(dataset)
            return {"id": identifier, "status": "validated" if valid else "needs_review", "valid": valid, "errors": errors}

    def promote(self, identifier: str) -> dict:
        with self._locked():
            dataset = self._load()
            proposal = self._record(dataset, "proposal", identifier)
            if proposal["status"] == "promoted":
                raise ConflictError("Proposal has already been promoted")
            baseline = self._baseline(dataset)
            if proposal["expectedBaselineRevision"] != baseline["baselineRevision"]:
                raise ConflictError("Baseline revision changed; create a proposal against the current baseline")
            errors = validate_dependency(proposal["dependency"], baseline)
            if errors:
                raise InvalidModelError("Dependency validation failed: " + "; ".join(errors))
            dependency = deepcopy(proposal["dependency"])
            existing = next((item for item in baseline["dependencies"] if item["id"] == dependency["id"]), None)
            dependency["revision"] = existing["revision"] + 1 if existing else 1
            for field, records in baseline.items():
                if field != "dependencies" and isinstance(records, list) and any(
                    isinstance(item, dict) and item.get("id") == dependency["id"] for item in records
                ):
                    raise InvalidModelError("Dependency id is already used by another model record")
            source_id = f"src-model-{uuid4().hex}"
            baseline["sources"].append({
                "id": source_id,
                "label": f"Local simulated model edit: {dependency['id']} revision {dependency['revision']}",
                "note": dependency["assumptionNote"],
                "evidenceCategory": "analyst_assumed",
                "classification": "U",
                "handling": ["SIMULATED"],
            })
            dependency["sourceRefs"] = list(dict.fromkeys(dependency["sourceRefs"] + [source_id]))
            dependency["status"] = "promoted_local_demo"
            assertions = {
                "delay": [dependency["propagationDelayMinHours"], dependency["propagationDelayMaxHours"]],
                "backup": [dependency["usableBackupMinHours"], dependency["usableBackupMaxHours"]],
                "lossFraction": dependency["lossOfFunction"],
            }
            dependency["parameterAssertionRefs"] = {}
            for parameter, value in assertions.items():
                assertion_id = f"asm-{uuid4().hex}"
                dependency["parameterAssertionRefs"][parameter] = assertion_id
                baseline.setdefault("assumptions", []).append({
                    "id": assertion_id,
                    "dependencyId": dependency["id"],
                    "parameter": parameter,
                    "value": value,
                    "unit": "fraction" if parameter == "lossFraction" else "hours",
                    "ownerRole": "local_demo_author",
                    "reviewStatus": "local_demo_promoted",
                    "evidenceCategory": "analyst_assumed",
                    "note": dependency["assumptionNote"],
                    "sourceRefs": [source_id],
                    "classification": "U",
                    "handling": ["SIMULATED"],
                })
            if existing:
                baseline["dependencies"] = [dependency if item["id"] == dependency["id"] else item for item in baseline["dependencies"]]
            else:
                baseline["dependencies"].append(dependency)
            baseline["baselineRevision"] += 1
            model_errors = validate_baseline(baseline)
            if model_errors:
                raise InvalidModelError("Promoted model validation failed: " + "; ".join(model_errors))
            self._write_baseline(dataset, baseline)
            proposal.update({"status": "promoted", "baselineRevision": baseline["baselineRevision"], "dependency": dependency})
            self._record_graph(dataset, "proposal", proposal)
            self._save(dataset)
            return {key: proposal[key] for key in ("id", "status", "baselineRevision", "dependency")}

    def create_run(self, request: dict, compute: Callable, expected_revision: int | None = None) -> dict:
        with self._locked():
            dataset = self._load()
            # Capture submitted parameters before the engine derives sourceRef
            # and trims notes. Canonical JSON ignores object key order, not any
            # input fields or string whitespace. The submitted revision fence
            # (including None) is part of identity, not today's baseline state.
            fingerprint = "sha256-v1:" + hashlib.sha256(_json({
                "request": request, "expectedBaselineRevision": expected_revision,
            }).encode("utf-8")).hexdigest()
            # Reconcile an accepted-but-lost response before checking today's
            # baseline, under the same file lock / SQL transaction as the save.
            request_id = request.get("clientRequestId")
            if request_id:
                for saved in self._records(dataset, "run"):
                    if saved.get("request", {}).get("clientRequestId") != request_id:
                        continue
                    graph = dataset.graph(URIRef(f"urn:citride:graph:run:{quote(saved['id'], safe='')}"))
                    captured = graph.value(_resource(saved["id"]), NS.submittedRequestFingerprint)
                    if captured is None:
                        # Legacy output cannot recover the original override
                        # note or distinguish supplied and derived sourceRef.
                        # Retain exact-capture replay only; never strip fields,
                        # recompute, backfill a guessed receipt, or rewrite it.
                        if saved["request"] != request or (
                            expected_revision is not None and saved["baselineRevision"] != expected_revision
                        ):
                            raise ConflictError("Legacy request identity has no submitted-request fingerprint; planning parameters must match the captured request exactly")
                    elif str(captured) != fingerprint:
                        raise ConflictError("Request identity was already used for different planning parameters")
                    return saved
            baseline = self._baseline(dataset)
            if expected_revision is not None and expected_revision != baseline["baselineRevision"]:
                raise ConflictError("Baseline changed; confirm the potential estimate again")
            if not any(scenario["id"] == request["scenarioId"] for scenario in baseline["scenarios"]):
                raise NotFoundError(f"Scenario {request['scenarioId']} was not found")
            run_id = "run-" + uuid4().hex
            run = compute(deepcopy(baseline), deepcopy(request), run_id)
            from .sector_links import capture_for_store
            capture_for_store(run, self, baseline)
            self._record_graph(dataset, "run", run)
            if request_id:
                # Internal metadata is committed atomically with the immutable
                # run, outside its public payload and history DTOs.
                graph = dataset.graph(URIRef(f"urn:citride:graph:run:{quote(run_id, safe='')}"))
                graph.add((_resource(run_id), NS.submittedRequestFingerprint, Literal(fingerprint)))
            self._save(dataset)
            return run

    def runs(self) -> list[dict]:
        with self._locked():
            return self._records(self._load(), "run")

    def run(self, identifier: str) -> dict:
        with self._locked():
            return self._record(self._load(), "run", identifier)

    def _write_inference(self, dataset: Dataset, run: dict, ontology_turtle: str) -> None:
        """Add an immutable reasoning snapshot without touching the baseline.

        Hash-addressed ontology graphs preserve the axioms that each historical
        run used, even after the packaged ontology changes. Fact graphs contain
        the selected public projection; JSON retains provenance and premises.
        """
        digest = hashlib.sha256(ontology_turtle.encode("utf-8")).hexdigest()
        if digest != run["ontology"]["sha256"]:
            raise InvalidModelError("Ontology changed during inference; retry against its current version")
        graph_iri = URIRef("urn:citride:graph:ontology:" + digest)
        ontology_graph = dataset.graph(graph_iri)
        if not len(ontology_graph):
            ontology_graph.parse(data=ontology_turtle, format="turtle")
        self._record_graph(dataset, "inference", run)
        metadata = dataset.graph(URIRef("urn:citride:graph:inference:" + quote(run["id"], safe="")))
        resource = _resource(run["id"])
        metadata.add((resource, NS.ontologyGraph, graph_iri))
        metadata.add((resource, NS.ontologyDocument, Literal(ontology_turtle)))
        metadata.add((resource, NS.baselineRevision, Literal(run["baselineRevision"], datatype=XSD.integer)))
        for status, collection in (("asserted", "assertedFacts"), ("inferred", "inferredFacts")):
            fact_graph_iri = URIRef(f"urn:citride:graph:inference-{status}:" + quote(run["id"], safe=""))
            fact_graph = dataset.graph(fact_graph_iri)
            metadata.add((resource, NS[status + "Graph"], fact_graph_iri))
            for fact in run[collection]:
                fact_graph.add((URIRef(fact["subject"]["iri"]), URIRef(fact["predicate"]["iri"]), URIRef(fact["object"]["iri"])))
                fact_resource = URIRef(str(resource) + ":fact:" + quote(fact["id"], safe=""))
                metadata.add((resource, NS.fact, fact_resource))
                metadata.add((fact_resource, NS.payload, Literal(_json(fact), datatype=RDF.JSON)))
                for source_id in fact.get("sourceRefs", []):
                    metadata.add((fact_resource, NS.sourceRefs, _resource(source_id)))
                for premise_id in fact.get("premiseFactIds", []):
                    premise_resource = URIRef(str(resource) + ":fact:" + quote(premise_id, safe=""))
                    metadata.add((fact_resource, NS.premiseFact, premise_resource))
                for axiom_id in fact.get("axiomIds", []):
                    metadata.add((fact_resource, NS.axiomId, Literal(axiom_id)))
        for source in run.get("baselineSnapshot", {}).get("sources", []):
            metadata.add((_resource(source["id"]), NS.payload, Literal(_json(source), datatype=RDF.JSON)))

    def create_inference_run(self, expected_revision: int | None, compute: Callable) -> dict:
        with self._locked():
            dataset = self._load()
            baseline = self._baseline(dataset)
            if expected_revision is not None and expected_revision != baseline["baselineRevision"]:
                raise ConflictError("Baseline revision changed; run inference against the current baseline")
            run_id = "inference-" + uuid4().hex
            run = compute(deepcopy(baseline), run_id)
            # Configuration/inconsistency failures raised by the reasoner leave
            # the file untouched. Nothing is automatically promoted here.
            ontology_turtle = run.pop("_ontologyTurtle")
            self._write_inference(dataset, run, ontology_turtle)
            self._save(dataset)
            return self._inference_status(run, baseline["baselineRevision"], run["ontology"]["sha256"])

    @staticmethod
    def _inference_status(run: dict, current_revision: int, current_ontology_hash: str) -> dict:
        reasons = {
            "baselineRevision": run["baselineRevision"] != current_revision,
            "ontology": run["ontology"]["sha256"] != current_ontology_hash,
        }
        return {**run, "stale": any(reasons.values()), "staleReasons": reasons,
                "currentBaselineRevision": current_revision, "currentOntologySha256": current_ontology_hash}

    def inference_runs(self, current_ontology_hash: str) -> list[dict]:
        with self._locked():
            dataset = self._load()
            revision = self._baseline(dataset)["baselineRevision"]
            return [self._inference_status(run, revision, current_ontology_hash)
                    for run in self._records(dataset, "inference")]

    def inference_run(self, identifier: str, current_ontology_hash: str) -> dict:
        with self._locked():
            dataset = self._load()
            return self._inference_status(self._record(dataset, "inference", identifier),
                                          self._baseline(dataset)["baselineRevision"], current_ontology_hash)

    def inference_fact(self, identifier: str, fact_id: str) -> dict:
        """Resolve only captured facts, axioms and sources from this run."""
        with self._locked():
            run = self._record(self._load(), "inference", identifier)
            facts = {fact["id"]: fact for fact in run["assertedFacts"] + run["inferredFacts"]}
            if fact_id not in facts:
                raise NotFoundError(f"Fact {fact_id} was not found in inference run {identifier}")
            visited, visiting, ordered = set(), set(), []

            def visit(current_id):
                if current_id in visited:
                    return
                if current_id in visiting:
                    raise InvalidModelError("Captured inference proof contains a cycle")
                if current_id not in facts:
                    raise InvalidModelError("Captured inference proof refers to a missing fact")
                visiting.add(current_id)
                fact = facts[current_id]
                for premise_id in fact.get("premiseFactIds", []):
                    visit(premise_id)
                visiting.remove(current_id)
                visited.add(current_id)
                ordered.append(fact)

            visit(fact_id)
            source_ids = {source for fact in ordered for source in fact.get("sourceRefs", [])}
            axiom_ids = {axiom for fact in ordered for axiom in fact.get("axiomIds", [])}
            sources = run.get("baselineSnapshot", {}).get("sources", [])
            axioms = run["ontology"]["axioms"]
            if not source_ids.issubset({source["id"] for source in sources}):
                raise InvalidModelError("Captured inference proof refers to a missing source")
            if not axiom_ids.issubset({axiom["id"] for axiom in axioms}):
                raise InvalidModelError("Captured inference proof refers to a missing ontology axiom")
            return {
                "runId": identifier, "fact": facts[fact_id],
                "proofFacts": [fact for fact in ordered if fact["id"] != fact_id],
                "axioms": [axiom for axiom in axioms if axiom["id"] in axiom_ids],
                "sources": [source for source in sources if source["id"] in source_ids],
                "baselineRevision": run["baselineRevision"],
            }

    def export(self) -> str:
        with self._locked():
            return self._load().serialize(format="nquads")

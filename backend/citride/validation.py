"""Domain and SHACL validation for the synthetic, directed dependency model.

SHACL guards the graph shape; domain checks additionally enforce finite values,
reference ownership, and service/loss compatibility before records are promoted.
"""

from __future__ import annotations

import math
import re
from typing import Any
from urllib.parse import quote

from pyshacl import validate as shacl_validate
from rdflib import Graph, Literal, Namespace, RDF, URIRef, XSD


NS = Namespace("urn:citride:")
SAFE_ID = re.compile(r"^[A-Za-z][A-Za-z0-9._:-]{0,255}$")
FACILITY_TYPES = frozenset({
    "WaterServiceProvider", "TreatmentPlant", "DialysisCenter", "Hospital",
    "NursingHome", "FireService", "ElectricSupplyFacility", "HealthcareFacility",
})
SERVICES = frozenset({
    "treated_water", "water_treatment", "electricity", "dialysis_treatment",
    "sterilization_support", "safe_water_support", "fire_flow",
})
LOSS_TYPES = frozenset({
    "unsafe_water", "no_water", "low_pressure", "electricity_lost",
    "water_treatment_unavailable",
})
SERVICE_LOSSES = {
    "treated_water": {"unsafe_water", "no_water", "low_pressure"},
    "water_treatment": {"water_treatment_unavailable"},
    "electricity": {"electricity_lost"},
}
DEPENDENCY_FIELDS = frozenset({
    "id", "revision", "provider", "dependent", "requiredService",
    "dependentFunction", "dependencyType", "coupling", "lossTypes",
    "propagationDelayMinHours", "propagationDelayMaxHours",
    "usableBackupMinHours", "usableBackupMaxHours", "validForLossTypes",
    "lossOfFunction", "outputLossType", "sourceRefs", "assumptionNote",
    "classification", "handling",
})
OPTIONAL_DEPENDENCY_FIELDS = frozenset({
    "supplyGroup", "multiSupply", "status", "backupService",
    "backupIndependenceAssumption", "parameterAssertionRefs", "recovery",
})

SHAPES = """
@prefix c: <urn:citride:> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
c:DependencyShape a sh:NodeShape ; sh:targetClass c:Dependency ;
  sh:property [ sh:path c:provider ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:nodeKind sh:IRI ; sh:class c:PhysicalFacility ] ;
  sh:property [ sh:path c:dependent ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:nodeKind sh:IRI ; sh:class c:PhysicalFacility ] ;
  sh:property [ sh:path c:dependentFunction ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:nodeKind sh:IRI ; sh:class c:ServiceFunction ] ;
  sh:property [ sh:path c:requiredService ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:datatype xsd:string ;
                sh:in ("treated_water"^^xsd:string "water_treatment"^^xsd:string "electricity"^^xsd:string
                       "dialysis_treatment"^^xsd:string "sterilization_support"^^xsd:string
                       "safe_water_support"^^xsd:string "fire_flow"^^xsd:string) ] ;
  sh:property [ sh:path c:sourceRefs ; sh:minCount 1 ; sh:nodeKind sh:IRI ;
                sh:class c:Source ] ;
  sh:property [ sh:path c:assumptionNote ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:datatype xsd:string ; sh:pattern "\\\\S" ] ;
  sh:property [ sh:path c:revision ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:datatype xsd:integer ; sh:minInclusive 1 ] ;
  sh:property [ sh:path c:propagationDelayMinHours ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:datatype xsd:double ; sh:minInclusive 0 ;
                sh:lessThanOrEquals c:propagationDelayMaxHours ] ;
  sh:property [ sh:path c:propagationDelayMaxHours ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:datatype xsd:double ; sh:minInclusive 0 ] ;
  sh:property [ sh:path c:usableBackupMinHours ; sh:maxCount 1 ;
                sh:datatype xsd:double ; sh:minInclusive 0 ;
                sh:lessThanOrEquals c:usableBackupMaxHours ] ;
  sh:property [ sh:path c:usableBackupMaxHours ; sh:maxCount 1 ;
                sh:datatype xsd:double ; sh:minInclusive 0 ] ;
  sh:property [ sh:path c:lossOfFunction ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:datatype xsd:double ; sh:minInclusive 0 ; sh:maxInclusive 1 ] .
"""
_SHAPE_GRAPH = Graph().parse(data=SHAPES, format="turtle")


def _id(value: Any) -> bool:
    return isinstance(value, str) and SAFE_ID.fullmatch(value) is not None


def _number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _enum(value: Any, options: Any) -> bool:
    return isinstance(value, str) and value in options


def _records(data: dict, key: str) -> list[dict]:
    value = data.get(key, [])
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _index(data: dict, key: str) -> dict[str, dict]:
    return {item["id"]: item for item in _records(data, key) if _id(item.get("id"))}


def _source_refs(record: dict, sources: dict, errors: list[str], prefix: str = "") -> None:
    refs = record.get("sourceRefs")
    if not isinstance(refs, list) or not refs:
        errors.append(f"{prefix}sourceRefs must contain at least one source ID")
        return
    seen: set[str] = set()
    for ref in refs:
        if not _id(ref) or ref not in sources:
            errors.append(f"{prefix}sourceRefs contains an unknown or invalid source ID")
        elif ref in seen:
            errors.append(f"{prefix}sourceRefs must not contain duplicate IDs")
        else:
            seen.add(ref)


def _handling(record: dict, errors: list[str], prefix: str = "") -> None:
    if record.get("classification") != "U":
        errors.append(f"{prefix}classification must be U for the synthetic demo")
    handling = record.get("handling")
    if not isinstance(handling, list) or "SIMULATED" not in handling or any(
        not isinstance(item, str) for item in handling
    ):
        errors.append(f"{prefix}handling must include SIMULATED")


def _range(low: Any, high: Any, label: str, errors: list[str], nullable: bool = False) -> None:
    if nullable and low is None and high is None:
        return
    if not _number(low) or not _number(high):
        errors.append(f"{label} must contain two finite numbers" + (" or two null values" if nullable else ""))
    elif low < 0 or high < low:
        errors.append(f"{label} must be nonnegative and ordered (minimum <= maximum)")


def _uri(identifier: str) -> URIRef:
    return URIRef("urn:citride:record:" + quote(identifier, safe="._-:"))


def dependency_graph(dependency: dict, data: dict | None = None) -> Graph:
    """Build a small validation graph. Reference classes come from the baseline."""
    graph = Graph()
    graph.bind("c", NS)
    if data is not None:
        for entity in _records(data, "entities"):
            if _id(entity.get("id")) and _enum(entity.get("type"), FACILITY_TYPES):
                graph.add((_uri(entity["id"]), RDF.type, NS.PhysicalFacility))
        for item in _records(data, "serviceFunctions"):
            if _id(item.get("id")):
                graph.add((_uri(item["id"]), RDF.type, NS.ServiceFunction))
        for item in _records(data, "sources"):
            if _id(item.get("id")):
                graph.add((_uri(item["id"]), RDF.type, NS.Source))
    node = _uri(dependency.get("id", "invalid") if _id(dependency.get("id")) else "invalid")
    graph.add((node, RDF.type, NS.Dependency))
    for key in ("provider", "dependent", "dependentFunction"):
        value = dependency.get(key)
        values = value if isinstance(value, list) else [value]
        for item in values:
            if _id(item):
                graph.add((node, NS[key], _uri(item)))
    for item in dependency.get("sourceRefs", []) if isinstance(dependency.get("sourceRefs"), list) else []:
        if _id(item):
            graph.add((node, NS.sourceRefs, _uri(item)))
    for key in ("requiredService", "assumptionNote"):
        if isinstance(dependency.get(key), str):
            graph.add((node, NS[key], Literal(dependency[key], datatype=XSD.string)))
    revision = dependency.get("revision")
    if isinstance(revision, int) and not isinstance(revision, bool):
        graph.add((node, NS.revision, Literal(revision, datatype=XSD.integer)))
    for key in ("propagationDelayMinHours", "propagationDelayMaxHours", "usableBackupMinHours", "usableBackupMaxHours", "lossOfFunction"):
        if _number(dependency.get(key)):
            graph.add((node, NS[key], Literal(float(dependency[key]), datatype=XSD.double)))
    return graph


def validate_dependency(dependency: dict, data: dict) -> list[str]:
    """Return readable validation errors without mutating the proposal or baseline."""
    errors: list[str] = []
    if not isinstance(dependency, dict):
        return ["dependency must be an object"]
    if not isinstance(data, dict):
        return ["baseline must be an object"]
    for field in sorted(DEPENDENCY_FIELDS - dependency.keys()):
        errors.append(f"{field} is required")
    for field in sorted(dependency.keys() - DEPENDENCY_FIELDS - OPTIONAL_DEPENDENCY_FIELDS):
        errors.append(f"unsupported dependency field: {field}")
    if not _id(dependency.get("id")):
        errors.append("id must be a safe, nonempty identifier")
    revision = dependency.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        errors.append("revision must be a positive integer")
    entities = _index(data, "entities")
    functions = _index(data, "serviceFunctions")
    sources = _index(data, "sources")
    for field in ("provider", "dependent"):
        ref = dependency.get(field)
        if not _id(ref) or ref not in entities:
            errors.append(f"{field} must identify exactly one existing entity")
        elif not _enum(entities[ref].get("type"), FACILITY_TYPES):
            errors.append(f"{field} must be a physical facility or service node")
    function_id = dependency.get("dependentFunction")
    function = functions.get(function_id) if _id(function_id) else None
    if function is None:
        errors.append("dependentFunction must reference an existing service function")
    elif function.get("facility") != dependency.get("dependent"):
        errors.append("dependentFunction must belong to dependent")
    service = dependency.get("requiredService")
    if not isinstance(service, str) or service not in SERVICES:
        errors.append("requiredService must be a supported service code")
    elif not any(item.get("facility") == dependency.get("provider") and item.get("service") == service for item in functions.values()):
        errors.append("provider must offer requiredService through a service function")
    if dependency.get("dependencyType") != "physical":
        errors.append("dependencyType must be physical for consequence calculation")
    if dependency.get("coupling") not in ("tight", "loose", "unknown"):
        errors.append("coupling must be tight, loose, or unknown")
    losses = dependency.get("lossTypes")
    if not isinstance(losses, list) or not losses or any(not isinstance(loss, str) or loss not in LOSS_TYPES for loss in losses):
        errors.append("lossTypes must contain supported loss codes")
    else:
        if len(losses) != len(set(losses)):
            errors.append("lossTypes must not contain duplicate codes")
        if isinstance(service, str) and service in SERVICE_LOSSES and not set(losses).issubset(SERVICE_LOSSES[service]):
            errors.append("lossTypes must be compatible with requiredService")
    valid_losses = dependency.get("validForLossTypes")
    if not isinstance(valid_losses, list) or any(not isinstance(loss, str) or loss not in LOSS_TYPES for loss in valid_losses):
        errors.append("validForLossTypes must be a list of supported loss codes")
    elif isinstance(losses, list) and all(isinstance(loss, str) for loss in losses):
        if not set(valid_losses).issubset(losses):
            errors.append("validForLossTypes must be a subset of lossTypes")
        if len(valid_losses) != len(set(valid_losses)):
            errors.append("validForLossTypes must not contain duplicate codes")
    _range(dependency.get("propagationDelayMinHours"), dependency.get("propagationDelayMaxHours"), "propagation delay window", errors)
    _range(dependency.get("usableBackupMinHours"), dependency.get("usableBackupMaxHours"), "usable backup window", errors, nullable=True)
    fraction = dependency.get("lossOfFunction")
    if not _number(fraction) or not 0 <= fraction <= 1:
        errors.append("lossOfFunction must be a finite number between 0 and 1")
    output = dependency.get("outputLossType")
    if output is not None and (not isinstance(output, str) or output not in LOSS_TYPES):
        errors.append("outputLossType must be null or a supported loss code")
    elif output is not None and function is not None:
        if not _enum(function.get("service"), SERVICE_LOSSES):
            errors.append("outputLossType must be null for a terminal dependentFunction service")
        elif output not in SERVICE_LOSSES[function["service"]]:
            errors.append("outputLossType must be compatible with dependentFunction service")
    _source_refs(dependency, sources, errors)
    note = dependency.get("assumptionNote")
    if not isinstance(note, str) or not note.strip():
        errors.append("assumptionNote must be nonblank")
    _handling(dependency, errors)
    if "supplyGroup" in dependency and not _id(dependency["supplyGroup"]):
        errors.append("supplyGroup must be a safe identifier when provided")
    if "multiSupply" in dependency and not isinstance(dependency["multiSupply"], bool):
        errors.append("multiSupply must be a boolean when provided")
    if "status" in dependency and (not isinstance(dependency["status"], str) or not dependency["status"].strip()):
        errors.append("status must be nonblank when provided")
    if "backupService" in dependency and dependency["backupService"] != service:
        errors.append("backupService must match requiredService")
    if "backupIndependenceAssumption" in dependency and (not isinstance(dependency["backupIndependenceAssumption"], str) or not dependency["backupIndependenceAssumption"].strip()):
        errors.append("backupIndependenceAssumption must be nonblank when provided")
    if "parameterAssertionRefs" in dependency:
        refs = dependency["parameterAssertionRefs"]
        assumptions = _index(data, "assumptions")
        if not isinstance(refs, dict) or not refs:
            errors.append("parameterAssertionRefs must be a nonempty mapping when provided")
        else:
            for parameter, ref in refs.items():
                if parameter not in ("delay", "backup", "lossFraction") or not _id(ref) or ref not in assumptions:
                    errors.append("parameterAssertionRefs must reference existing parameter assumptions")
                elif assumptions[ref].get("dependencyId") != dependency.get("id") or assumptions[ref].get("parameter") != parameter:
                    errors.append("parameterAssertionRefs must belong to this dependency and parameter")
    if "recovery" in dependency:
        recovery = dependency["recovery"]
        if not isinstance(recovery, dict) or not isinstance(recovery.get("status"), str) or not isinstance(recovery.get("note"), str):
            errors.append("recovery must contain a status and note when provided")
    # Always run SHACL: the graph is an independent cardinality/range check.
    conforms, report, _ = shacl_validate(dependency_graph(dependency, data), shacl_graph=_SHAPE_GRAPH, inference="none", abort_on_first=False)
    if not conforms:
        sh = Namespace("http://www.w3.org/ns/shacl#")
        messages = sorted({str(message) for message in report.objects(None, sh.resultMessage)})
        errors.extend(f"SHACL: {message}" for message in messages)
    return errors


def validate_baseline(data: dict) -> list[str]:
    """Validate initial referential integrity and configured synthetic scenarios."""
    if not isinstance(data, dict):
        return ["baseline must be an object"]
    errors: list[str] = []
    collections = ("entities", "serviceFunctions", "dependencies", "sources", "assumptions", "events", "assessments", "scenarios")
    all_ids: set[str] = set()
    for key in collections:
        values = data.get(key)
        if not isinstance(values, list):
            errors.append(f"{key} must be a list")
            continue
        seen: set[str] = set()
        for position, value in enumerate(values):
            if not isinstance(value, dict):
                errors.append(f"{key}[{position}] must be an object")
                continue
            identifier = value.get("id")
            if not _id(identifier):
                errors.append(f"{key}[{position}].id must be a safe identifier")
            elif identifier in seen:
                errors.append(f"{key} contains duplicate id {identifier}")
            else:
                seen.add(identifier)
                if identifier in all_ids:
                    errors.append(f"{key} reuses id {identifier} from another collection")
                all_ids.add(identifier)
    sources, entities, functions = (_index(data, key) for key in ("sources", "entities", "serviceFunctions"))
    for key in collections:
        for item in _records(data, key):
            prefix = f"{key} {item.get('id', '?')}: "
            _handling(item, errors, prefix)
            if key != "sources":
                _source_refs(item, sources, errors, prefix)
    for entity in entities.values():
        for field in ("partOf", "operatedBy", "serves", "locatedIn", "hostsCyberAsset", "hostedBy"):
            value = entity.get(field)
            if value is None:
                continue
            values = value if isinstance(value, list) else [value]
            if any(not _id(ref) or ref not in entities for ref in values):
                errors.append(f"entity {entity['id']}: {field} contains an unknown entity reference")
    for source in sources.values():
        if source.get("evidenceCategory") not in ("simulated", "analyst_assumed"):
            errors.append(f"source {source['id']}: evidenceCategory must be simulated or analyst_assumed")
    for key in ("events", "assessments"):
        for record in _records(data, key):
            for field in ("seenOn", "assetId", "cyberAssetId", "utilityId"):
                if field in record and (not _id(record[field]) or record[field] not in entities):
                    errors.append(f"{key} {record.get('id', '?')}: {field} must reference an existing entity")
    for function in functions.values():
        owner = function.get("facility")
        if not _id(owner) or owner not in entities or not _enum(entities[owner].get("type"), FACILITY_TYPES):
            errors.append(f"function {function['id']}: facility must reference a physical facility or service node")
        if not _enum(function.get("service"), SERVICES):
            errors.append(f"function {function['id']}: service must be a supported service code")
    for dependency in _records(data, "dependencies"):
        errors.extend(f"dependency {dependency.get('id', '?')}: {message}" for message in validate_dependency(dependency, data))
    events = _index(data, "events")
    scenarios = _index(data, "scenarios")
    if not _id(data.get("defaultScenarioId")) or data.get("defaultScenarioId") not in scenarios:
        errors.append("defaultScenarioId must reference a configured scenario")
    for scenario in scenarios.values():
        prefix = f"scenario {scenario['id']}: "
        seed = scenario.get("seed")
        if not isinstance(seed, dict):
            errors.append(prefix + "seed must be an object")
            continue
        provider, service, loss = seed.get("provider"), seed.get("service"), seed.get("lossType")
        if not _id(provider) or provider not in entities or not _enum(entities[provider].get("type"), FACILITY_TYPES):
            errors.append(prefix + "seed provider must be a physical facility or service node")
        if not isinstance(service, str) or service not in SERVICES:
            errors.append(prefix + "seed service must be a supported service code")
        elif not any(fn.get("facility") == provider and fn.get("service") == service for fn in functions.values()):
            errors.append(prefix + "seed provider must offer seed service")
        if not isinstance(loss, str) or loss not in LOSS_TYPES:
            errors.append(prefix + "seed lossType must be a supported loss code")
        elif isinstance(service, str) and service in SERVICE_LOSSES and loss not in SERVICE_LOSSES[service]:
            errors.append(prefix + "seed lossType must be compatible with service")
        window = seed.get("windowHours")
        if not isinstance(window, list) or len(window) != 2:
            errors.append(prefix + "seed windowHours must contain minimum and maximum hours")
        else:
            _range(window[0], window[1], prefix + "seed windowHours", errors)
        persistence = seed.get("persistsThroughHour")
        if not _number(persistence) or persistence < 0:
            errors.append(prefix + "seed persistsThroughHour must be finite and nonnegative")
        elif isinstance(window, list) and len(window) == 2 and _number(window[1]) and persistence < window[1]:
            errors.append(prefix + "seed persistence cannot precede latest onset")
        _source_refs(seed, sources, errors, prefix + "seed ")
        refs = seed.get("eventRefs")
        if not isinstance(refs, list) or any(not _id(ref) or ref not in events for ref in refs):
            errors.append(prefix + "seed eventRefs must reference existing events")
    return errors

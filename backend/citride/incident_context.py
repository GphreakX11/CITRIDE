"""Pure, read-only incident context from an explicit baseline snapshot.

Hosting and containment supply infrastructure context, not physical effects.
Only exact scenario seed event references supply consequence-assumption context;
only explicitly promoted, directed Dependency records supply downstream context.
No ontology imports, queries, I/O, propagation, or baseline updates occur here.
Returned records are detached copies with their original metadata intact.
"""

from __future__ import annotations

from copy import deepcopy

from .validation import FACILITY_TYPES


_FACILITIES = FACILITY_TYPES | {"PhysicalFacility"}
_PHYSICAL = _FACILITIES | {"PhysicalAsset", "PhysicalOTAsset", "PhysicalITAsset"}
_PROVISIONAL = (
    "Context is provisional: hosting and containment identify infrastructure, "
    "and serves identifies geography only. Scenario consequences are explicit "
    "assumptions, not inferred from an alert; neither an observation nor a "
    "dependency establishes an actual outage."
)


def _typed(record: dict, allowed: set | frozenset, default: str | None = None) -> bool:
    value = record.get("type", default)
    return isinstance(value, str) and value in allowed


class _Lookup:
    """Bounded, deterministic lookups which never choose a duplicate ID."""

    def __init__(self, data: dict):
        self.warnings: list[str] = []
        self.rows: dict[str, list[dict]] = {}
        self.indices: dict[str, dict[str, dict]] = {}
        for collection in ("events", "entities", "dependencies", "serviceFunctions", "scenarios", "sources"):
            records = data.get(collection, [])
            self.rows[collection] = []
            self.indices[collection] = {}
            if not isinstance(records, list):
                self.warn(f"Baseline {collection} is not a record list; its context was withheld.")
                continue
            duplicates = set()
            for record in records:
                identifier = record.get("id") if isinstance(record, dict) else None
                if not isinstance(identifier, str) or not identifier.strip():
                    self.warn(f"Baseline {collection} contains a malformed record or identifier; it was excluded.")
                    continue
                self.rows[collection].append(record)
                if identifier in self.indices[collection]:
                    duplicates.add(identifier)
                self.indices[collection][identifier] = record
            for identifier in sorted(duplicates):
                del self.indices[collection][identifier]
                self.warn(f"Baseline {collection} identifier {identifier} is ambiguous because it is duplicated; its context was withheld.")

    def warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)

    def reference(self, record: dict, field: str, *, required: bool = True) -> tuple[str | None, bool]:
        """Accept a scalar ID or a list with exactly one distinct explicit ID."""
        value = record.get(field)
        label = record.get("id", "record")
        if value is None:
            if required:
                self.warn(f"Record {label} has no {field} reference; its context was withheld.")
            return None, not required
        if isinstance(value, str) and value.strip():
            return value, True
        if isinstance(value, list) and value and all(isinstance(item, str) and item.strip() for item in value):
            candidates = set(value)
            if len(candidates) == 1:
                return value[0], True
            self.warn(f"Record {label} has ambiguous {field} references; its context was withheld.")
        else:
            self.warn(f"Record {label} has a malformed {field} reference; its context was withheld.")
        return None, False

    def endpoint(self, record: dict, field: str, collection: str, allowed: set | frozenset,
                 *, default: str | None = None) -> dict | None:
        identifier, valid = self.reference(record, field)
        if not valid or identifier is None:
            return None
        target = self.indices[collection].get(identifier)
        if target is None:
            self.warn(f"Record {record.get('id', 'record')} has an unknown or ambiguous {field} endpoint {identifier}; its context was withheld.")
        elif not _typed(target, allowed, default):
            self.warn(f"Record {record.get('id', 'record')} has an invalid type at {field} endpoint {identifier}; its context was withheld.")
            return None
        return target


def _physical_host(lookup: _Lookup, cyber: dict) -> dict | None:
    candidates: dict[str, dict] = {}
    valid = True
    forward, well_formed = lookup.reference(cyber, "hostedBy", required=False)
    if not well_formed:
        valid = False
    elif forward is not None:
        host = lookup.endpoint(cyber, "hostedBy", "entities", _PHYSICAL)
        if host is None:
            valid = False
        else:
            candidates[host["id"]] = host
    for record in lookup.rows["entities"]:
        inverse = record.get("hostsCyberAsset")
        mentions = inverse == cyber["id"] or (
            isinstance(inverse, list) and cyber["id"] in inverse
        )
        if not mentions:
            continue
        target, well_formed = lookup.reference(record, "hostsCyberAsset")
        if (not well_formed or target != cyber["id"] or not _typed(record, _PHYSICAL)
                or record["id"] not in lookup.indices["entities"]):
            lookup.warn(f"Record {record['id']} has invalid or ambiguous hostsCyberAsset hosting; physical context was withheld.")
            valid = False
        else:
            candidates[record["id"]] = record
    if not valid:
        return None
    if len(candidates) != 1:
        reason = "conflicting or ambiguous" if candidates else "missing"
        lookup.warn(f"Cyber asset {cyber['id']} has {reason} hosting; physical context was withheld.")
        return None
    host = next(iter(candidates.values()))
    # A forward host may explicitly host another cyber identity. Never silently
    # accept that contradiction as agreement between the two directions.
    if forward is not None and host.get("hostsCyberAsset") is not None:
        inverse, well_formed = lookup.reference(host, "hostsCyberAsset")
        if not well_formed or inverse != cyber["id"]:
            lookup.warn(f"Cyber asset {cyber['id']} has conflicting hosting with {host['id']}; physical context was withheld.")
            return None
    return host


def _generic_providers(lookup: _Lookup, chain: list[dict], event_id: str) -> list[dict]:
    """Resolve supply roles, not names, sectors, operators or geography.

    A facility must own the service explicitly supplied by a scenario seed or
    promoted outgoing dependency. An exact event seed constrains the provider;
    it never repairs missing containment or makes a remote provider an ancestor.
    """
    candidates = {}
    event_providers = set()
    constrained = False
    for scenario in lookup.indices["scenarios"].values():
        seed = scenario.get("seed")
        if not isinstance(seed, dict):
            continue
        refs = seed.get("eventRefs")
        if isinstance(refs, list) and event_id in refs:
            constrained = True
            provider_id, valid = lookup.reference(seed, "provider")
            if valid:
                event_providers.add(provider_id)
    for facility in chain:
        if not _typed(facility, _FACILITIES):
            continue
        identifier = facility["id"]
        if constrained and identifier not in event_providers:
            continue
        services = set()
        for function in lookup.indices["serviceFunctions"].values():
            owner, valid = lookup.reference(function, "facility")
            service = function.get("service")
            if (valid and owner == identifier and _typed(function, {"ServiceFunction"}, "ServiceFunction")
                    and isinstance(service, str) and service.strip()):
                services.add(service)
        if not services:
            continue
        for scenario in lookup.indices["scenarios"].values():
            seed = scenario.get("seed")
            if not isinstance(seed, dict):
                continue
            provider_id, valid = lookup.reference(seed, "provider")
            service = seed.get("service")
            if valid and provider_id == identifier and isinstance(service, str) and service in services:
                candidates[identifier] = facility
        for item in _downstream(lookup, facility):
            service = item["dependency"].get("requiredService")
            if isinstance(service, str) and service in services:
                candidates[identifier] = facility
    return list(candidates.values())


def _structural_context(lookup: _Lookup, host: dict, event_id: str) -> tuple[dict | None, dict | None, list[dict]]:
    chain: list[dict] = []
    seen = set()
    current = host
    while True:
        if current["id"] in seen:
            lookup.warn(f"Structural partOf cycle at {current['id']}; facility and provider context was withheld.")
            return None, None, chain
        seen.add(current["id"])
        chain.append(current)
        parent_id, valid = lookup.reference(current, "partOf", required=False)
        if not valid:
            return None, None, chain
        if parent_id is None:
            break
        parent = lookup.endpoint(current, "partOf", "entities", _PHYSICAL)
        if parent is None:
            return None, None, chain
        current = parent
    facility = next((item for item in chain if _typed(item, _FACILITIES)), None)
    providers = [item for item in chain if _typed(item, {"WaterServiceProvider"})]
    if facility is None:
        lookup.warn(f"Physical asset {host['id']} has no explicit physical facility in its partOf chain.")
    provider = providers[0] if len(providers) == 1 else None
    if not providers:
        generic = _generic_providers(lookup, chain, event_id)
        if len(generic) == 1:
            return facility, generic[0], chain
        if len(generic) > 1:
            lookup.warn(f"Physical asset {host['id']} has ambiguous service-provider ancestors; provider context was withheld.")
            return facility, None, chain
        # Keep the legacy warning stable: historical reviewed cases compare
        # their complete captured context (including warnings) on reopen.
        lookup.warn(f"Physical asset {host['id']} has no explicit WaterServiceProvider in its partOf chain; operatedBy and locatedIn do not supply a provider.")
    elif len(providers) > 1:
        lookup.warn(f"Physical asset {host['id']} has ambiguous WaterServiceProvider ancestors; provider context was withheld.")
    return facility, provider, chain


def _downstream(lookup: _Lookup, provider: dict | None) -> list[dict]:
    result = []
    if provider is None:
        return result
    for dep in lookup.rows["dependencies"]:
        provider_id, valid = lookup.reference(dep, "provider")
        if not valid or provider_id != provider["id"]:
            continue
        if dep["id"] not in lookup.indices["dependencies"]:
            continue
        status = dep.get("status")
        if not isinstance(status, str) or not (status == "promoted" or status.startswith("promoted_")):
            lookup.warn(f"Unpromoted dependency {dep['id']} was excluded from downstream context.")
            continue
        if not _typed(dep, {"Dependency"}, "Dependency"):
            lookup.warn(f"Record {dep['id']} has an invalid Dependency type; downstream context was withheld.")
            continue
        dependent = lookup.endpoint(dep, "dependent", "entities", _FACILITIES)
        function = lookup.endpoint(dep, "dependentFunction", "serviceFunctions", {"ServiceFunction"}, default="ServiceFunction")
        if dependent is None or function is None:
            continue
        owner_id, valid = lookup.reference(function, "facility")
        if not valid or owner_id != dependent["id"]:
            lookup.warn(f"Dependency {dep['id']} dependentFunction does not unambiguously belong to its dependent; downstream context was withheld.")
            continue
        result.append({"dependency": dep, "dependent": dependent, "function": function})
    return result


def _scenarios(lookup: _Lookup, event_id: str) -> list[dict]:
    result = []
    for scenario in lookup.rows["scenarios"]:
        if scenario["id"] not in lookup.indices["scenarios"]:
            continue
        seed = scenario.get("seed")
        if not isinstance(seed, dict):
            lookup.warn(f"Scenario {scenario['id']} has a malformed or missing seed; its event association was withheld.")
            continue
        refs = seed.get("eventRefs")
        if not isinstance(refs, list) or any(not isinstance(ref, str) or not ref.strip() for ref in refs):
            lookup.warn(f"Scenario {scenario['id']} has malformed or missing seed.eventRefs; its event association was withheld.")
            continue
        if event_id not in refs:
            continue
        result.append(scenario)
        assumption = seed.get("assumptionNote")
        if not isinstance(assumption, str) or not assumption.strip():
            lookup.warn(f"Scenario {scenario['id']} references this event but lacks an explicit consequence assumption note; no observed physical effect is established.")
    if not result:
        lookup.warn(f"No scenario seed explicitly references event {event_id}; no physical consequence is associated with this observation.")
    return result


def _provenance(lookup: _Lookup, records: list[dict]) -> list[str]:
    """Collect existing IDs, retaining record metadata and flagging all gaps."""
    sources = lookup.indices["sources"]
    result: list[str] = []
    seen_objects = set()

    def include(reference, label):
        if not isinstance(reference, str) or reference not in sources:
            lookup.warn(f"Provenance gap: {label} references an unknown or invalid source {reference!r}; it is not a verified source citation.")
        elif reference not in result:
            result.append(reference)

    def walk(value, label):
        if not isinstance(value, (dict, list)) or id(value) in seen_objects:
            return
        seen_objects.add(id(value))
        if isinstance(value, list):
            for item in value:
                walk(item, label)
            return
        if "sourceRefs" in value:
            refs = value["sourceRefs"]
            if not isinstance(refs, list) or not refs:
                lookup.warn(f"Provenance gap: {label} has missing or malformed sourceRefs.")
            else:
                for reference in refs:
                    include(reference, label)
        if "sourceRef" in value:
            include(value["sourceRef"], label)
        for key, nested in value.items():
            if key in {"sourceRefs", "sourceRef"}:
                continue
            if key == "seed" and isinstance(nested, dict) and "sourceRefs" not in nested:
                lookup.warn(f"Provenance gap: {label}.seed has no sourceRefs.")
            walk(nested, f"{label}.{key}")

    for record in records:
        label = str(record.get("id", "record"))
        if "sourceRefs" not in record:
            lookup.warn(f"Provenance gap: {label} has no sourceRefs.")
        walk(record, label)
    return result


def incident_context(data: dict, event_id: str, *, freshness=False) -> dict:
    """Return detached, typed incident context without altering the baseline.

    Unknown or duplicate event IDs raise ``ValueError('Unknown event: ...')``.
    Unsupported links are null/excluded with warnings rather than guessed.
    Provenance gaps retain the original records but are explicitly warned;
    only existing, unambiguous source IDs appear in the aggregate sourceRefs.
    An unavailable baseline revision uses integer 0 with a warning, never an
    invented positive revision. No baseline validation or persistence occurs.
    """
    if not isinstance(data, dict):
        raise ValueError(f"Unknown event: {event_id}")
    lookup = _Lookup(data)
    event = lookup.indices["events"].get(event_id) if isinstance(event_id, str) else None
    if event is None:
        raise ValueError(f"Unknown event: {event_id}")
    lookup.warn(_PROVISIONAL)
    revision = data.get("baselineRevision")
    if type(revision) is not int or revision < 1:
        revision = 0
        lookup.warn("Baseline revision is missing or invalid; baselineRevision 0 denotes unavailable revision information.")
    cyber = physical = facility = provider = area = None
    supporting_chain = []
    if _typed(event, {"Event", "CyberEvent"}, "Event"):
        cyber = lookup.endpoint(event, "seenOn", "entities", {"CyberAsset"})
    else:
        lookup.warn(f"Event {event['id']} has an invalid event type; cyber and structural context was withheld.")
    if cyber is not None:
        physical = _physical_host(lookup, cyber)
    if physical is not None:
        facility, provider, supporting_chain = _structural_context(lookup, physical, event_id)
    if provider is not None and ("serves" in provider or _typed(provider, {"WaterServiceProvider"})):
        area = lookup.endpoint(provider, "serves", "entities", {"ServiceArea"})
    downstream = _downstream(lookup, provider)
    scenarios = _scenarios(lookup, event_id)
    records = [record for record in (event, cyber, physical, facility, provider, area) if record is not None]
    records.extend(record for item in downstream for record in item.values())
    records.extend(scenarios)
    # Intermediate structural records support traversal even when absent from
    # the response. Flag their gaps but do not add their IDs to the aggregate.
    _provenance(lookup, supporting_chain)
    source_refs = _provenance(lookup, records)
    from .incident_freshness import incident_inputs
    return deepcopy({
        **({"freshnessInputs": incident_inputs(data, event_id)} if freshness else {}),
        "baselineRevision": revision,
        "event": event,
        "cyberAsset": cyber,
        "physicalAsset": physical,
        "facility": facility,
        "provider": provider,
        "serviceArea": area,
        "downstreamDependencies": downstream,
        "scenarios": scenarios,
        "sourceRefs": source_refs,
        "warnings": lookup.warnings,
    })

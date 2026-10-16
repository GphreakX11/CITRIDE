"""Deterministic, loss-specific interval propagation for the synthetic demo.

The intervals describe conditional planning assumptions, not observations or
probabilities. This deliberately small engine does not solve cyclic capacity
networks or redundant supply groups: those results stay explicitly unknown.
"""

from collections import defaultdict, deque
from copy import deepcopy
from hashlib import sha256
from math import isfinite

from . import MODEL_VERSION

MAX_PATH_EVENTS = 10_000


def _number(value, name, *, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite nonnegative number")
    try:
        finite = isfinite(value)
    except OverflowError:
        finite = False
    if not finite or value < 0:
        raise ValueError(f"{name} must be a finite nonnegative number")
    return value


def _interval(low, high, name, *, nullable=False):
    low = _number(low, f"{name} minimum", nullable=nullable)
    high = _number(high, f"{name} maximum", nullable=nullable)
    if low is not None and high is not None and low > high:
        raise ValueError(f"{name} minimum must not exceed maximum")
    return None if low is None or high is None else [low, high]


def _unique(items):
    return list(dict.fromkeys(items))


def _cycle_nodes(graph):
    """Iterative Kosaraju: no recursive stack or numerical reserve loops."""
    seen, order = set(), []
    for start in graph:
        if start in seen:
            continue
        seen.add(start)
        stack = [(start, iter(graph[start]))]
        while stack:
            node, neighbors = stack[-1]
            neighbor = next(neighbors, None)
            if neighbor is None:
                order.append(node)
                stack.pop()
            elif neighbor not in seen:
                seen.add(neighbor)
                stack.append((neighbor, iter(graph[neighbor])))
    reverse = {node: [] for node in graph}
    for node, neighbors in graph.items():
        for neighbor in neighbors:
            reverse[neighbor].append(node)
    seen, cyclic = set(), set()
    for start in reversed(order):
        if start in seen:
            continue
        component, stack = [], [start]
        seen.add(start)
        while stack:
            node = stack.pop()
            component.append(node)
            for neighbor in reverse[node]:
                if neighbor not in seen:
                    seen.add(neighbor)
                    stack.append(neighbor)
        if len(component) > 1 or start in graph[start]:
            cyclic.update(component)
    return cyclic


def _state(window, evaluation_hour, fraction, uncertain=False):
    if window is None or uncertain:
        return "unknown", "unknown"
    if evaluation_hour < window[0]:
        return "at_risk", "before_onset"
    if evaluation_hour < window[1]:
        return "at_risk", "onset_uncertain"
    return ("failed" if fraction == 1 else "degraded"), "past_latest_onset"


def compute_run(data: dict, request: dict, run_id: str) -> dict:
    """Compute from copied inputs; caller stamps createdAt and persists the run.

    Path traversal retains distinct causal paths, while impacts aggregate by
    entity/function/output loss. Bounds, review flags, and a hard event limit
    prevent unsupported topology from becoming a fabricated precise forecast.
    """
    if not isinstance(data, dict) or not isinstance(request, dict):
        raise ValueError("Run data and request must be objects")
    if not isinstance(run_id, str) or not run_id.strip():
        raise ValueError("run_id must be a nonempty string")
    scenario_id = request.get("scenarioId")
    scenarios = {s["id"]: s for s in data.get("scenarios", [])}
    if not isinstance(scenario_id, str) or scenario_id not in scenarios:
        raise ValueError("scenarioId must name a configured scenario")
    evaluation_hour = _number(request.get("evaluationHour", 1), "evaluationHour")
    horizon = _number(request.get("horizonHours", 12), "horizonHours")
    if horizon == 0 or evaluation_hour > horizon:
        raise ValueError("horizonHours must be positive and include evaluationHour")
    seed = deepcopy(scenarios[scenario_id].get("seed"))
    if not isinstance(seed, dict):
        raise ValueError("Configured scenario must contain a seed object")
    entities = {e["id"]: e for e in data.get("entities", [])}
    functions = {f["id"]: f for f in data.get("serviceFunctions", [])}
    if seed.get("provider") not in entities:
        raise ValueError("Scenario seed provider must resolve to an entity")
    if not isinstance(seed.get("service"), str) or not seed["service"]:
        raise ValueError("Scenario seed service must be a nonempty string")
    if not isinstance(seed.get("lossType"), str) or not seed["lossType"]:
        raise ValueError("Scenario seed lossType must be a nonempty string")
    onset = seed.get("windowHours")
    if not isinstance(onset, (list, tuple)) or len(onset) != 2:
        raise ValueError("Scenario seed windowHours must contain minimum and maximum")
    seed_window = _interval(*onset, "Scenario onset")
    persists = _number(seed.get("persistsThroughHour"), "Scenario persistsThroughHour")
    if persists < seed_window[0]:
        raise ValueError("Scenario persistence cannot end before earliest seed onset")

    baseline = deepcopy(data)
    assumption_records = {item["id"]: item for item in data.get("assumptions", [])}
    event_records = {item["id"]: item for item in data.get("events", [])}
    dependencies = deepcopy(data.get("dependencies", []))
    dependency_by_id = {d["id"]: d for d in dependencies}
    if len(dependency_by_id) != len(dependencies):
        raise ValueError("Dependency IDs must be unique")
    raw_overrides = request.get("overrides", [])
    if not isinstance(raw_overrides, list):
        raise ValueError("overrides must be an array")
    overrides, override_sources, override_refs = [], [], {}
    for override in raw_overrides:
        if not isinstance(override, dict):
            raise ValueError("Each override must be an object")
        dependency_id = override.get("dependencyId")
        if not isinstance(dependency_id, str) or dependency_id not in dependency_by_id:
            raise ValueError("Override dependencyId must resolve to a dependency")
        if dependency_id in override_refs:
            raise ValueError("A dependency may have only one override per run")
        backup = _interval(override.get("backupMinHours"), override.get("backupMaxHours"),
                           f"Override {dependency_id} backup")
        note = override.get("note")
        if not isinstance(note, str) or not note.strip():
            raise ValueError("Each override must include a nonempty assumption note")
        source_ref = f"urn:citride:run:{run_id}:override:{dependency_id}"
        overrides.append({"dependencyId": dependency_id, "backupMinHours": backup[0],
                          "backupMaxHours": backup[1], "note": note.strip(), "sourceRef": source_ref})
        override_sources.append({"id": source_ref, "label": f"What-if reserve for {dependency_id}",
                                 "note": note.strip(), "classification": "U", "handling": ["SIMULATED"],
                                 "evidenceCategory": "analyst_assumed"})
        override_refs[dependency_id] = source_ref
        dependency_by_id[dependency_id]["usableBackupMinHours"] = backup[0]
        dependency_by_id[dependency_id]["usableBackupMaxHours"] = backup[1]

    outgoing, supply_groups = defaultdict(list), defaultdict(list)
    for dependency in dependencies:
        dependency_id = dependency["id"]
        if dependency.get("provider") not in entities or dependency.get("dependent") not in entities:
            raise ValueError(f"Dependency {dependency_id} endpoints must resolve")
        function_id = dependency.get("dependentFunction")
        if function_id not in functions or functions[function_id].get("facility") != dependency["dependent"]:
            raise ValueError(f"Dependency {dependency_id} function must belong to its dependent")
        if not functions[function_id].get("service"):
            raise ValueError(f"Dependency {dependency_id} output function must declare a service")
        _interval(dependency.get("propagationDelayMinHours"), dependency.get("propagationDelayMaxHours"),
                  f"Dependency {dependency_id} delay", nullable=True)
        _interval(dependency.get("usableBackupMinHours"), dependency.get("usableBackupMaxHours"),
                  f"Dependency {dependency_id} backup", nullable=True)
        fraction = _number(dependency.get("lossOfFunction"), f"Dependency {dependency_id} lossOfFunction")
        if fraction > 1:
            raise ValueError(f"Dependency {dependency_id} lossOfFunction must be in [0,1]")
        outgoing[dependency["provider"]].append(dependency)
        supply_groups[(dependency["dependent"], function_id, dependency.get("requiredService"))].append(dependency)
    unsupported = set()
    for group in supply_groups.values():
        if len({d["provider"] for d in group}) > 1:
            unsupported.update(d["id"] for d in group)
    for dependency in dependencies:
        if dependency.get("multiSupply") is True or any(dependency.get(field) is not None for field in
               ("supplyGroup", "supplyGroupId", "activationRule", "requiredCapacity")):
            unsupported.add(dependency["id"])

    warnings, excluded = [], []
    def warn(message):
        if message not in warnings:
            warnings.append(message)

    def exclude(dependency_id, reason, path):
        entry = {"dependencyId": dependency_id, "reason": reason, "path": list(path)}
        if entry not in excluded:
            excluded.append(entry)

    def compatible(node, dependency):
        return (dependency.get("requiredService") == node[1]
                and node[2] in dependency.get("lossTypes", [])
                and dependency["lossOfFunction"] > 0)

    def target(node, dependency):
        function = functions[dependency["dependentFunction"]]
        return (dependency["dependent"], function["service"], dependency.get("outputLossType") or node[2])

    # Build the service/loss-specific reachable graph before evaluating reserves.
    start = (seed["provider"], seed["service"], seed["lossType"])
    graph, frontier = {start: []}, deque([start])
    discovered = {start}
    while frontier:
        node = frontier.popleft()
        graph[node] = []
        for dependency in outgoing[node[0]]:
            if compatible(node, dependency):
                next_node = target(node, dependency)
                graph[node].append(next_node)
                graph.setdefault(next_node, [])
                # A terminal impact is not itself an asserted output-service
                # loss. Only an explicit conversion may continue propagation.
                if dependency.get("outputLossType") and next_node not in discovered:
                    discovered.add(next_node)
                    frontier.append(next_node)
    cyclic = _cycle_nodes(graph)
    if cyclic:
        labels = ", ".join(sorted({node[0] for node in cyclic}))
        warn(f"requires_model_review: cyclic service/loss component ({labels}); timing unresolved and reserve credit cannot recur")

    impacts = {}
    # State, window, path, visited states, sources, assumptions, review flag.
    seed_sources = list(seed.get("sourceRefs", []))
    for event_ref in seed.get("eventRefs", []):
        seed_sources.extend(event_records.get(event_ref, {}).get("sourceRefs", []))
    seed_assumptions = ["SIMULATED physical-effect seed; no observed facility failure is asserted.",
                        f"Upstream loss is assumed to persist through hour {persists}; dependent recovery is not modeled."]
    if seed.get("assumptionNote"):
        seed_assumptions.append(seed["assumptionNote"])
    queue = deque([(start, seed_window, (), (start,), _unique(seed_sources), seed_assumptions, False)])
    events_processed = 0
    while queue:
        node, provider_window, path, visited, source_refs, assumptions, provider_uncertain = queue.popleft()
        for dependency in sorted(outgoing[node[0]], key=lambda item: item["id"]):
            dependency_id = dependency["id"]
            next_path = path + (dependency_id,)
            if not compatible(node, dependency):
                reason = ("required service does not match provider loss service"
                          if dependency.get("requiredService") != node[1]
                          else "loss type is not applicable" if node[2] not in dependency.get("lossTypes", [])
                          else "modeled loss fraction is zero")
                exclude(dependency_id, reason, next_path)
                continue
            next_node = target(node, dependency)
            if next_node in visited:
                exclude(dependency_id, "requires_model_review: cyclic path stopped before repeated backup credit", next_path)
                continue
            events_processed += 1
            if events_processed > MAX_PATH_EVENTS:
                warn(f"requires_model_review: path event limit {MAX_PATH_EVENTS} reached; remaining paths unresolved")
                for prior_impact in impacts.values():
                    prior_impact["_uncertain"] = True
                    prior_impact["assumptions"].append("requires_model_review: path enumeration limit prevents a complete forecast.")
                queue.clear()
                break
            delay = _interval(dependency.get("propagationDelayMinHours"), dependency.get("propagationDelayMaxHours"),
                              f"Dependency {dependency_id} delay", nullable=True)
            valid_backup = node[2] in dependency.get("validForLossTypes", [])
            backup = (_interval(dependency.get("usableBackupMinHours"), dependency.get("usableBackupMaxHours"),
                                f"Dependency {dependency_id} backup", nullable=True) if valid_backup else [0, 0])
            next_assumptions = list(assumptions)
            next_assumptions.append(f"{dependency_id} revision {dependency.get('revision', 1)}: {dependency.get('assumptionNote', 'No link assumption supplied')}")
            if dependency.get("backupIndependenceAssumption"):
                next_assumptions.append(dependency["backupIndependenceAssumption"])
            if not valid_backup:
                next_assumptions.append(f"{dependency_id}: reserve is not valid for {node[2]}; no backup hours credited.")
            next_sources = _unique(source_refs + list(dependency.get("sourceRefs", [])))
            for assertion_ref in dependency.get("parameterAssertionRefs", {}).values():
                if isinstance(assertion_ref, str):
                    next_sources.extend(assumption_records.get(assertion_ref, {}).get("sourceRefs", []))
            next_sources = _unique(next_sources)
            if dependency.get("outputLossType"):
                next_assumptions.append(f"{dependency_id}: {node[1]}/{node[2]} becomes {next_node[1]}/{next_node[2]} under an explicit simulated service-loss conversion.")
            if dependency_id in override_refs:
                override = next(item for item in overrides if item["dependencyId"] == dependency_id)
                next_sources.append(override["sourceRef"])
                next_assumptions.append(f"SIMULATED what-if reserve {backup}: {override['note']} (source {override['sourceRef']})")
            uncertain = provider_uncertain
            if delay is None or backup is None or provider_window is None:
                window = None
                next_assumptions.append(f"{dependency_id}: timing unknown because provider onset, delay, or applicable usable reserve is missing.")
            else:
                window = [provider_window[0] + delay[0] + backup[0],
                          provider_window[1] + delay[1] + backup[1]]
                try:
                    for bound in window:
                        _number(bound, "accumulated onset")
                except ValueError as error:
                    raise ValueError(f"Dependency {dependency_id} accumulated onset exceeds finite numeric range") from error
                next_assumptions.append(f"{dependency_id}: provider onset {provider_window} + delay {delay} + applicable usable reserve {backup} = {window} hours.")
            if next_node in cyclic:
                window, uncertain = None, True
                next_assumptions.append("requires_model_review: cyclic service dependency cannot be resolved by this engine.")
            if dependency_id in unsupported:
                window, uncertain = None, True
                warn(f"requires_model_review: {dependency_id} participates in an unsupported multi-supply/capacity group; no single-supply failure is assumed")
                next_assumptions.append("requires_model_review: alternate supply capacity and activation are not resolved.")
            if window is not None:
                if window[0] > persists:
                    exclude(dependency_id, "upstream loss ends before earliest reserve exhaustion/impact", next_path)
                    continue
                if window[0] > horizon:
                    exclude(dependency_id, "earliest modeled impact is beyond evaluation horizon", next_path)
                    continue
                if window[1] > persists:
                    uncertain = True
                    next_assumptions.append("Loss persistence ends inside the onset interval; actual reserve exhaustion is unresolved.")
                if evaluation_hour > persists:
                    uncertain = True
                    next_assumptions.append("Scenario loss has ended; dependent recovery prerequisites are unknown.")
            function_id = dependency["dependentFunction"]
            key = (next_node[0], function_id, next_node[2])
            fraction = dependency["lossOfFunction"]
            if key not in impacts:
                impact_hash = sha256("|".join(key).encode()).hexdigest()[:16]
                impacts[key] = {"id": f"{run_id}:impact:{impact_hash}", "entityId": key[0],
                                "functionId": key[1], "lossType": key[2], "evidenceStatus": "modeled",
                                "windowHours": window, "lossOfFunction": fraction, "paths": [],
                                "sourceRefs": [], "assumptions": [], "_uncertain": uncertain}
            impact = impacts[key]
            if list(next_path) not in impact["paths"]:
                impact["paths"].append(list(next_path))
            # Any unknown required path can produce earlier onset than a known
            # path. Do not make that uncertainty disappear through aggregation.
            if impact["windowHours"] is None or window is None:
                impact["windowHours"] = None
            else:
                impact["windowHours"] = [min(impact["windowHours"][0], window[0]),
                                         min(impact["windowHours"][1], window[1])]
            if impact["lossOfFunction"] != fraction:
                uncertain = True
                warn(f"requires_model_review: competing loss fractions for {key[0]}/{key[1]}/{key[2]}; threshold aggregation is unsupported")
            impact["lossOfFunction"] = max(impact["lossOfFunction"], fraction)
            impact["_uncertain"] |= uncertain
            impact["sourceRefs"] = _unique(impact["sourceRefs"] + next_sources)
            impact["assumptions"] = _unique(impact["assumptions"] + next_assumptions)
            if dependency.get("outputLossType"):
                propagated_window = None if uncertain else window
                queue.append((next_node, propagated_window, next_path, visited + (next_node,),
                              next_sources, next_assumptions, uncertain))

    results = []
    for key, impact in sorted(impacts.items()):
        impact["state"], impact["timingStatus"] = _state(impact["windowHours"], evaluation_hour,
                                                       impact["lossOfFunction"], impact.pop("_uncertain"))
        results.append(impact)
    normalized_request = {"scenarioId": scenario_id, "evaluationHour": evaluation_hour,
                          "horizonHours": horizon, "overrides": overrides}
    if request.get("clientRequestId") is not None:
        normalized_request["clientRequestId"] = request["clientRequestId"]
    return {"id": run_id, "scenarioId": scenario_id, "baselineRevision": data.get("baselineRevision", 1),
            "modelVersion": MODEL_VERSION, "request": normalized_request, "seed": seed,
            "impacts": results, "excluded": excluded, "warnings": warnings,
            "baselineSnapshot": baseline, "overrideSources": override_sources}


def compare_runs(left: dict, right: dict) -> dict:
    """Compare deduplicated immutable facility-function outputs, including adds/removals."""
    def indexed(run):
        grouped = defaultdict(list)
        for impact in run.get("impacts", []):
            grouped[(impact["entityId"], impact["functionId"])].append(impact)
        result = {}
        for key, values in grouped.items():
            windows = [value["windowHours"] for value in values]
            window = (None if any(item is None for item in windows) else
                      [min(item[0] for item in windows), min(item[1] for item in windows)])
            states = [value["state"] for value in values]
            severity = {"at_risk": 0, "degraded": 1, "failed": 2, "unknown": 3}
            result[key] = (window, max(states, key=lambda state: severity[state]))
        return result
    left_index, right_index = indexed(left), indexed(right)
    changes = []
    for entity_id, function_id in sorted(left_index.keys() | right_index.keys()):
        before = left_index.get((entity_id, function_id), (None, None))
        after = right_index.get((entity_id, function_id), (None, None))
        if before != after:
            changes.append({"entityId": entity_id, "functionId": function_id,
                            "leftWindowHours": before[0], "rightWindowHours": after[0],
                            "leftState": before[1], "rightState": after[1]})
    return {"leftRunId": left["id"], "rightRunId": right["id"], "changes": changes}

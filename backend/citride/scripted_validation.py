"""Validation for supplied record data and source-inheriting reference config.

These checks never repair or mutate authoritative inputs. Reference configuration
is deliberately not treated as a feed of fully instantiated mutable records.
"""
from __future__ import annotations

from datetime import datetime
import json
import math
from pathlib import Path
import re

COLLECTIONS = (
    "statewideIncidents", "teams", "responseTasks", "contacts", "assessments",
    "assetStatuses", "hunts", "decisions", "partnerProducts",
)
INPUT_KEYS = {"statewideIncidents": "incidents", "responseTasks": "tasks"}
STATUS_LABELS = {
    "incidentStatusLabels": {"from_case": "From case", "open": "Open", "containment": "Containment", "monitoring": "Monitoring", "recovering": "Recovering", "closed": "Closed"},
    "taskStatusLabels": {"not_started": "Not started", "in_progress": "In progress", "waiting": "Waiting", "done": "Done"},
    "teamStatusLabels": {"en_route": "En route", "standby": "Standby", "remote": "Remote", "on_site": "On site"},
    "assetStatusLabels": {"confirmed": "Confirmed", "suspected": "Suspected", "at_risk": "At risk", "normal": "Normal"},
    "productStatusLabels": {"draft": "Draft"},
    "confidenceLabels": {"low": "Low", "medium": "Medium", "high": "High"},
}
STATUS_MAPS = {
    "statewideIncidents": "incidentStatusLabels", "teams": "teamStatusLabels",
    "responseTasks": "taskStatusLabels", "contacts": "contactStatusLabels",
    "assetStatuses": "assetStatusLabels", "hunts": "huntStatusLabels",
    "partnerProducts": "productStatusLabels",
}
SAFE_ID = re.compile(r"^[A-Za-z][A-Za-z0-9._:-]{0,255}$")


def valid_id(value):
    return isinstance(value, str) and SAFE_ID.fullmatch(value) is not None


def finite(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def aware_time(value):
    if not isinstance(value, str):
        return False
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).utcoffset() is not None
    except ValueError:
        return False


def _items(data, key):
    value = data.get(key, [])
    return [r for r in value if isinstance(r, dict)] if isinstance(value, list) else []


def _ids(data, key):
    return {r["id"] for r in _items(data, key) if valid_id(r.get("id"))}


def _collection(data, key, errors, seen, required=True):
    values = data.get(key, [] if not required else None)
    if not isinstance(values, list):
        errors.append(f"{key} must be a list")
        return []
    result = []
    for position, item in enumerate(values):
        prefix = f"{key}[{position}]"
        if not isinstance(item, dict):
            errors.append(prefix + " must be an object")
            continue
        identifier = item.get("id")
        if not valid_id(identifier):
            errors.append(prefix + ".id must be a safe identifier")
        elif identifier in seen:
            errors.append(prefix + ".id must be unique")
        else:
            seen.add(identifier)
        result.append(item)
    return result


def _sources(data, scenario, errors, seen):
    own = _collection(data, "sources", errors, seen)
    for source in own:
        if source.get("classification") != "U" or not isinstance(source.get("handling"), list) or "SIMULATED" not in source["handling"]:
            errors.append("source classification/handling must be U/SIMULATED")
        if source.get("evidenceCategory") not in ("simulated", "reference", "analyst_assumed"):
            errors.append("source evidenceCategory is invalid")
    return _ids(data, "sources") | _ids(scenario, "sources")


def _refs(record, refs, errors, prefix):
    """Check known reference paths at any depth, including option triggers."""
    for key, value in record.items():
        if key == 'timeOrigins':
            # Timestamp provenance describes fields; its keys are not instants.
            continue
        target = refs.get(key)
        if target is not None:
            if key not in ("sourceRefs", "linkedEventIds", "impactFunctions") and not valid_id(value):
                errors.append(prefix + key + " must identify exactly one record")
            if key in ("sourceRefs", "linkedEventIds", "impactFunctions") and not isinstance(value, list):
                errors.append(prefix + key + " must be a list of references")
            values = value if isinstance(value, list) else [value]
            if any(not valid_id(v) or v not in target for v in values):
                errors.append(prefix + key + " contains an unknown or invalid reference")
            elif len(values) != len(set(values)):
                errors.append(prefix + key + " contains duplicate references")
        if isinstance(value, dict) and key not in ("history",):
            _refs(value, refs, errors, prefix + key + ".")
        elif isinstance(value, list) and key not in ("history",):
            for member in value:
                if isinstance(member, dict):
                    _refs(member, refs, errors, prefix + key + ".")
        if key.endswith(("OffsetMinutes", "RelativeHours")) or key in ("offsetMinutes", "relativeTimeHours"):
            if not finite(value):
                errors.append(prefix + key + " must be finite")
        if key in ("at", "dueAt", "etaAt", "openedStoryAt") and not aware_time(value):
            errors.append(prefix + key + " must be an aware timestamp")


def _default_options():
    for path in (Path(__file__).resolve().parents[2] / "data/reference.json", Path(__file__).parent / "data/reference.json"):
        if path.exists():
            try:
                return _ids(json.loads(path.read_text(encoding="utf-8")), "responseOptions")
            except (ValueError, OSError):
                break
    return set()


def validate_scripted(data, scenario):
    if not isinstance(data, dict) or not isinstance(scenario, dict):
        return ["scripted data and scenario must be objects"]
    errors, seen = [], set()
    sources = _sources(data, scenario, errors, seen)
    groups = _collection(data, "taskGroups", errors, set())
    group_ids = {r["id"] for r in groups if valid_id(r.get("id"))}
    for group in groups:
        if not isinstance(group.get("label"), str) or not group["label"].strip():
            errors.append("taskGroup label must be nonempty text")
    values = {name: _collection(data, INPUT_KEYS.get(name, name), errors, seen) for name in COLLECTIONS}
    incident_ids = {r["id"] for r in values["statewideIncidents"] if valid_id(r.get("id"))}
    team_ids = {r["id"] for r in values["teams"] if valid_id(r.get("id"))}
    entities = _ids(scenario, "entities")
    refs = {"entityId": entities, "nearEntityId": entities,
            "optionId": _ids(scenario, "responseOptions") if "responseOptions" in scenario else _default_options(),
            "teamId": team_ids | group_ids, "ownerTeamId": team_ids | group_ids,
            "incidentId": incident_ids, "linkedEventIds": _ids(scenario, "events"),
            "sourceRefs": sources, "functionId": _ids(scenario, "serviceFunctions")}
    labels = {**STATUS_LABELS}
    for key in ("contactStatusLabels", "huntStatusLabels", "decisionLabels"):
        mapping = data.get(key)
        if not isinstance(mapping, dict) or not mapping or any(not isinstance(k, str) or not isinstance(v, str) or not v.strip() for k, v in mapping.items()):
            errors.append(key + " must be a nonempty label map")
            mapping = {}
        labels[key] = mapping
    for name, records in values.items():
        for record in records:
            prefix = f"{name} {record.get('id', '?')}: "
            if not isinstance(record.get("origin"), str) or not record["origin"].strip():
                errors.append(prefix + "origin is required")
            if not isinstance(record.get("sourceRefs"), list) or not record["sourceRefs"]:
                errors.append(prefix + "sourceRefs must be a nonempty list")
            if record.get("classification") != "U":
                errors.append(prefix + "classification must be U")
            handling = record.get("handling")
            if not isinstance(handling, list) or "SIMULATED" not in handling or any(not isinstance(v, str) for v in handling):
                errors.append(prefix + "handling must include SIMULATED")
            _refs(record, refs, errors, prefix)
            if name != "statewideIncidents" and "incidentId" not in record:
                errors.append(prefix + "incidentId is required")
            required_refs = {"responseTasks": "teamId", "assetStatuses": "entityId", "hunts": "ownerTeamId", "decisions": "optionId"}
            required = required_refs.get(name)
            if required is not None and required not in record:
                errors.append(prefix + required + " is required")
            if name in ("responseTasks", "hunts"):
                team_field = "teamId" if name == "responseTasks" else "ownerTeamId"
                team = next((t for t in values["teams"] if t.get("id") == record.get(team_field)), None)
                if team is not None and team.get("incidentId") != record.get("incidentId"):
                    errors.append(prefix + team_field + " belongs to a different incident")
            if name in STATUS_MAPS:
                status = record.get("status")
                if not isinstance(status, str) or status not in labels[STATUS_MAPS[name]]:
                    errors.append(prefix + "status is not in its label map")
            elif name == "decisions":
                if not isinstance(record.get("decision"), str) or record["decision"] not in labels["decisionLabels"] or record["decision"] == "none":
                    errors.append(prefix + "decision is not a recorded decision label")
                if "status" in record:
                    errors.append(prefix + "status is not a decision field")
            elif name == "assessments":
                if not isinstance(record.get("confidence"), str) or record["confidence"] not in STATUS_LABELS["confidenceLabels"]:
                    errors.append(prefix + "confidence is invalid")
                if "status" in record:
                    errors.append(prefix + "status is not an assessment field")
            if name == "teams":
                _people(record.get("people"), errors, prefix)
            history = record.get("history", [])
            if not isinstance(history, list) or any(not isinstance(h, dict) or not isinstance(h.get("who"), str) or not aware_time(h.get("when")) or "what" not in h for h in history):
                errors.append(prefix + "history must contain who/when/what changes")
    timing = data.get("timing")
    clock = timing.get("storyClock") if isinstance(timing, dict) else None
    if not isinstance(timing, dict) or (clock is None and not isinstance(timing.get('note'), str)):
        errors.append('timing must describe the sample-data anchor')
    if clock is not None and (not isinstance(clock, dict) or not finite(clock.get('startRelativeHours')) or type(clock.get('advancesWithWallClock')) is not bool):
        errors.append('Legacy timing configuration is malformed')
    if not aware_time(scenario.get("incidentOrigin")):
        errors.append("scenario.incidentOrigin must be an aware timestamp")
    return errors


def _people(value, errors, prefix=""):
    if not isinstance(value, dict) or set(value) != {"onSite", "remote", "traveling", "standby"} or any(type(v) is not int or v < 0 for v in value.values()):
        errors.append(prefix + "people must contain four nonnegative integer counts")


def validate_reference(data, scenario):
    if not isinstance(data, dict) or not isinstance(scenario, dict):
        return ["reference data and scenario must be objects"]
    errors, seen = [], set()
    sources = _sources(data, scenario, errors, seen)
    groups = {key: _collection(data, key, errors, seen) for key in ("responseOptions", "planningRates", "boilWaterRules", "firstActions")}
    refs = {"sourceRefs": sources, "functionId": _ids(scenario, "serviceFunctions"),
            "impactFunctions": _ids(scenario, "serviceFunctions"),
            "entityId": _ids(scenario, "entities"), "optionId": _ids(data, "responseOptions"),
            "boilWaterRule": _ids(data, "boilWaterRules")}
    for key, records in groups.items():
        for record in records:
            prefix = f"{key} {record.get('id', '?')}: "
            _refs(record, refs, errors, prefix)
            # firstActions inherit their containing config's source provenance.
            if key != "firstActions" and (not isinstance(record.get("sourceRefs"), list) or not record["sourceRefs"]):
                errors.append(prefix + "sourceRefs must be a nonempty list")
            if "status" in record:
                errors.append(prefix + "status is not a supported config field")
            if key == "planningRates":
                low, high = record.get("low"), record.get("high")
                if not finite(low) or not finite(high) or low < 0 or high < low:
                    errors.append(prefix + "rate bounds must be finite, nonnegative and ordered")
                if "functionId" not in record:
                    errors.append(prefix + "functionId is required")
    timing = data.get("optionTimingLabels")
    if not isinstance(timing, dict) or any(not valid_id(k) or k not in refs["optionId"] or not isinstance(v, str) or not v.strip() for k, v in timing.items()):
        errors.append("optionTimingLabels must reference configured options")
    clock = data.get("responseClock")
    if not isinstance(clock, dict) or clock.get("startsAt") != "case_opened":
        errors.append("responseClock must start at case_opened")
    else:
        limits = [clock.get(k) for k in ("amberMinutes", "redMinutes", "targetMinutes")]
        if not all(finite(v) for v in limits) or not 0 <= limits[0] <= limits[1] <= limits[2] or limits[2] <= 0:
            errors.append("responseClock limits must be positive and ordered")
    return errors

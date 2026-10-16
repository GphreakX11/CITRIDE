"""Durable scripted/analyst records on the repository's existing RDF dataset.

Dataset callbacks are deliberately transaction-neutral: callers own locks,
case/version receipts, rollback and the single final save.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from uuid import uuid4

from .scripted_validation import (
    COLLECTIONS, INPUT_KEYS, STATUS_LABELS, _people, aware_time,
    validate_reference, validate_scripted, valid_id,
)
from .storage import ConflictError, InvalidModelError, NotFoundError

ACTION_FIELDS = {
    "record_assessment": {"subject", "cluster", "actorLabel", "confidence", "note"},
    "set_asset_status": {"entityId", "status", "note"},
    "record_hunt": {"huntId", "status", "resultNote"},
    "set_contact_status": {"contactId", "status", "note"},
    "record_decision": {"optionId", "decision", "decidedBy", "note"},
    "set_team_status": {"teamId", "status", "people", "locationLabel", "updateText"},
    "add_task": {"label", "teamId", "ownerRole", "dueAt"},
    "set_task_status": {"taskId", "status"},
}
META_KIND, META_ID = "scripted-meta", "records-meta"
CASE_KIND = "command-incident"


def _parse(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _text(value, name, limit=2000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise InvalidModelError(f"{name} must be nonblank text of at most {limit} characters")


def validate_action(request):
    """Validate the entire canonical flat request, including the parent envelope."""
    if not isinstance(request, dict):
        raise InvalidModelError("Record action must be an object")
    name = request.get("action")
    if not isinstance(name, str) or name not in ACTION_FIELDS:
        raise InvalidModelError("Unknown record action")
    if set(request) != ACTION_FIELDS[name] | {"action", "expectedVersion", "clientRequestId"}:
        raise InvalidModelError("Record action has missing or unsupported fields")
    if type(request["expectedVersion"]) is not int or request["expectedVersion"] < 1:
        raise InvalidModelError("expectedVersion must be a positive integer")
    _text(request["clientRequestId"], "clientRequestId", 256)
    for field in ACTION_FIELDS[name] - {"people", "dueAt"}:
        _text(request[field], field, 256 if field.endswith("Id") else 2000)
        if field.endswith("Id") and not valid_id(request[field]):
            raise InvalidModelError(field + " must be a safe identifier")
    if "people" in request:
        errors = []
        _people(request["people"], errors)
        if errors:
            raise InvalidModelError("; ".join(errors))
    if "dueAt" in request and not aware_time(request["dueAt"]):
        raise InvalidModelError("dueAt must be an aware ISO timestamp")
    if name == "record_assessment" and request["confidence"] not in STATUS_LABELS["confidenceLabels"]:
        raise InvalidModelError("Invalid assessment confidence")
    maps = {"set_asset_status": "assetStatusLabels", "set_team_status": "teamStatusLabels", "set_task_status": "taskStatusLabels"}
    if name in maps and request["status"] not in STATUS_LABELS[maps[name]]:
        raise InvalidModelError("Invalid record status")
    authored_values = {
        "record_hunt": {"running", "queued", "done", "no_findings", "findings"},
        "set_contact_status": {"contacted", "attempted", "not_yet", "engaged", "on_standby", "waiting_on_chief", "not_shared_no_consent"},
        "record_decision": {"chosen", "deferred", "not_chosen", "standing_by"},
    }
    if name in authored_values and request["decision" if name == "record_decision" else "status"] not in authored_values[name]:
        raise InvalidModelError("Invalid authored status/decision")
    # apply_action independently checks the actual configured label map.


def load_inputs(scenario_path):
    """Return (scripted, reference, scenario) from source or packaged data."""
    scenario_path = Path(scenario_path)
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    candidates = (scenario_path.parent, Path(__file__).resolve().parents[2] / "data", Path(__file__).parent / "data")
    def load(relative):
        for base in candidates:
            path = base / relative
            if path.is_file():
                return json.loads(path.read_text(encoding="utf-8"))
        raise InvalidModelError("Required scripted/reference configuration is missing")
    return load("scripted/watershed_beta.json"), load("reference.json"), scenario


class RecordsService:
    def __init__(self, store, scripted=None, reference=None, scenario=None, now=None):
        self.store = store
        if scripted is None or reference is None or scenario is None:
            loaded = load_inputs(store.scenario_path)
            scripted = loaded[0] if scripted is None else scripted
            reference = loaded[1] if reference is None else reference
            scenario = loaded[2] if scenario is None else scenario
        self.scripted, self.reference, self.scenario = deepcopy((scripted, reference, scenario))
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._validation_scenario = deepcopy(self.scenario)
        self._validation_scenario["responseOptions"] = deepcopy(self.reference.get("responseOptions", []))
        self._validation_scenario["sources"] = deepcopy(self.scenario.get("sources", [])) + deepcopy(self.reference.get("sources", []))
        errors = validate_reference(self.reference, self.scenario) + validate_scripted(self.scripted, self._validation_scenario)
        if errors:
            raise InvalidModelError("Invalid scripted/reference inputs: " + "; ".join(errors))

    def _wall_now(self):
        value = self._now()
        if not isinstance(value, datetime) or value.utcoffset() is None:
            raise InvalidModelError("Clock must return an aware datetime")
        return value.astimezone(timezone.utc)

    def _meta(self, dataset):
        try:
            return self.store._record(dataset, META_KIND, META_ID)
        except NotFoundError:
            return None

    def _story_time(self, meta, wall=None):
        if meta is None:
            raise InvalidModelError("Scripted records have not been initialized")
        start = _parse(meta["storyStartedAt"])
        if meta["config"]["timing"]["storyClock"]["advancesWithWallClock"]:
            start += (wall or self._wall_now()) - _parse(meta["wallStartedAt"])
        return start

    def _all(self, dataset):
        return {key: self.store._records(dataset, key) for key in COLLECTIONS}

    def seed(self, dataset):
        """Replace only record graphs/config; never baseline, runs or cases."""
        config = {k: deepcopy(v) for k, v in self.scripted.items() if k not in {INPUT_KEYS.get(c, c) for c in COLLECTIONS}}
        wall = self._wall_now()
        story = _parse(self.scenario["incidentOrigin"]) + timedelta(hours=config["timing"]["storyClock"]["startRelativeHours"])
        # Validate first: malformed data must not partially clear even an owned
        # in-memory dataset when this method is used without a lock wrapper.
        records = {c: deepcopy(self.scripted[INPUT_KEYS.get(c, c)]) for c in COLLECTIONS}
        self._validate_records(records, config)
        for graph in list(dataset.graphs()):
            if any(str(graph.identifier).startswith(f"urn:citride:graph:{kind}:") for kind in (*COLLECTIONS, META_KIND)):
                dataset.remove_graph(graph.identifier)
        meta = {"id": META_ID, "config": config, "incidentOrigin": self.scenario["incidentOrigin"], "wallStartedAt": wall.isoformat(), "storyStartedAt": story.astimezone(timezone.utc).isoformat()}
        self.store._record_graph(dataset, META_KIND, meta)
        self._ingest_records(dataset, records, "scripted")

    def initialize(self):
        with self.store._locked():
            dataset = self.store._load()
            changed = self._meta(dataset) is None
            if changed:
                self.seed(dataset)
                # Upgrade an existing durable store without manufacturing cases.
                for case in self.store._records(dataset, CASE_KIND):
                    self.on_case_opened(dataset, case)
            if changed:
                self.store._save(dataset)

    def _validate_records(self, records, config):
        data = deepcopy(config)
        data.update({INPUT_KEYS.get(k, k): v for k, v in records.items()})
        errors = validate_scripted(data, self._validation_scenario)
        if errors:
            raise InvalidModelError("Invalid records: " + "; ".join(errors))

    def _ingest_records(self, dataset, records, origin):
        """Single validated dataset ingest primitive for all entry paths."""
        _text(origin, "origin", 256)
        if not isinstance(records, dict) or not records or set(records) - set(COLLECTIONS):
            raise InvalidModelError("records must map supported collection names to lists")
        meta = self._meta(dataset)
        if meta is None:
            raise InvalidModelError("Initialize scripted records before ingestion")
        current = self._all(dataset)
        changes = []
        for collection, incoming in records.items():
            if not isinstance(incoming, list):
                raise InvalidModelError("Record collections must be lists")
            existing = {item["id"]: item for item in current[collection]}
            seen = set()
            for raw in incoming:
                if not isinstance(raw, dict) or not valid_id(raw.get("id")) or raw["id"] in seen:
                    raise InvalidModelError("Incoming records require unique safe identifiers")
                item = deepcopy(raw)
                seen.add(item["id"])
                prior = existing.get(item["id"])
                # Derived view state is never durable record truth.
                for field in ("late", "caseStatus", "reviews", "progress"):
                    item.pop(field, None)
                if prior:
                    item["origin"] = prior["origin"]
                    history = deepcopy(prior.get("history", []))
                    supplied_history = item.get("history", [])
                    if not isinstance(supplied_history, list):
                        raise InvalidModelError("history must be a list")
                    for event in supplied_history:
                        if event not in history:
                            history.append(deepcopy(event))
                    item["history"] = history
                    if item != prior and history == prior.get("history", []) and origin not in ("scripted", "case-link"):
                        item["history"].append({"who": origin, "when": self._wall_now().isoformat(), "what": {"action": "ingest_records", "origin": origin}})
                else:
                    item.setdefault("origin", origin)
                    item.setdefault("history", [])
                existing[item["id"]] = item
                changes.append((collection, item))
            current[collection] = list(existing.values())
        self._validate_records(current, meta["config"])
        # Nothing is mutated until all references and collections validate.
        for collection, item in changes:
            self.store._record_graph(dataset, collection, item)
        return deepcopy([item for _, item in changes])

    def ingest_records(self, records, origin):
        with self.store._locked():
            dataset = self.store._load()
            result = self._ingest_records(dataset, records, origin)
            self.store._save(dataset)
            return result

    def on_case_opened(self, dataset, case_record):
        meta = self._meta(dataset)
        if meta is None:
            raise InvalidModelError("Scripted records have not been initialized")
        changes = {}
        for incident in self.store._records(dataset, "statewideIncidents"):
            if case_record.get("eventId") not in incident.get("linkedEventIds", []):
                continue
            if incident.get("caseId"):
                if incident["caseId"] != case_record["id"]:
                    # One authored incident has one display identity. A second
                    # case never steals record ownership from the first.
                    continue
                return
            opened = case_record.get("createdAt")
            if not aware_time(opened):
                raise InvalidModelError("Case opening requires an aware createdAt")
            story = self._story_time(meta, _parse(opened)).isoformat()
            incident.update(caseId=case_record["id"], openedStoryAt=story)
            changes.setdefault("statewideIncidents", []).append(incident)
            for collection in COLLECTIONS[1:]:
                for item in self.store._records(dataset, collection):
                    if item.get("incidentId") == incident["id"]:
                        item.update(caseId=case_record["id"], openedStoryAt=story)
                        changes.setdefault(collection, []).append(item)
        if changes:
            self._ingest_records(dataset, changes, "case-link")

    def apply_action(self, dataset, case_record, request, who="Authenticated operator"):
        validate_action(request)
        _text(who, "who", 256)
        current = self._all(dataset)
        incident = next((r for r in current["statewideIncidents"] if r.get("caseId") == case_record.get("id") and case_record.get("eventId") in r.get("linkedEventIds", [])), None)
        if incident is None:
            raise InvalidModelError("Record action requires this incident's linked case")
        if case_record.get("status") == "closed":
            raise ConflictError("Closed casework does not allow record changes")
        name = request["action"]
        rules = {
            "record_assessment": ("assessments", "subject", "subject"),
            "set_asset_status": ("assetStatuses", "entityId", "entityId"),
            "record_hunt": ("hunts", "id", "huntId"),
            "set_contact_status": ("contacts", "id", "contactId"),
            "record_decision": ("decisions", "optionId", "optionId"),
            "set_team_status": ("teams", "id", "teamId"),
            "set_task_status": ("responseTasks", "id", "taskId"),
        }
        if name == "add_task":
            collection, item = "responseTasks", None
        else:
            collection, key, field = rules[name]
            item = next((r for r in current[collection] if r.get("incidentId") == incident["id"] and r.get("caseId") == case_record["id"] and r.get(key) == request[field]), None)
            if item is None and name != "record_decision":
                raise InvalidModelError(field + " must identify a record owned by this case")
        meta = self._meta(dataset)
        config = meta["config"]
        label_keys = {"record_hunt": "huntStatusLabels", "set_contact_status": "contactStatusLabels", "record_decision": "decisionLabels"}
        if name in label_keys:
            value = request["decision" if name == "record_decision" else "status"]
            if value not in config[label_keys[name]] or (name == "record_decision" and value == "none"):
                raise InvalidModelError("Status must be a configured recorded value")
        if name in ("add_task", "set_team_status"):
            team = next((t for t in current["teams"] if t["id"] == request["teamId"]), None)
            groups = {g["id"] for g in config["taskGroups"]}
            if (team is None and request["teamId"] not in groups) or (team is not None and team.get("caseId") != case_record["id"]):
                raise InvalidModelError("teamId must be a supplied group or team owned by this case")
        if item is None:
            # Instantiated config inherits its source's provenance; never edit
            # the config file or pretend the analyst declaration is authority.
            source = self.scripted["sources"][0]
            source_refs = [source["id"]]
            if name == "record_decision":
                option = next((r for r in self.reference["responseOptions"] if r["id"] == request["optionId"]), None)
                if option is None:
                    raise InvalidModelError("optionId must identify a configured option")
                source_refs = deepcopy(option["sourceRefs"])
                source = next((r for r in self.reference["sources"] if r["id"] == source_refs[0]), source)
            item = {"id": "record-" + uuid4().hex, "incidentId": incident["id"], "caseId": case_record["id"], "openedStoryAt": incident["openedStoryAt"],
                    "origin": "analyst", "sourceRefs": source_refs, "classification": source["classification"], "handling": deepcopy(source["handling"]), "history": []}
        item = deepcopy(item)
        fields = {k: deepcopy(request[k]) for k in ACTION_FIELDS[name]}
        if name == "set_asset_status":
            fields["detail"] = fields.pop("note")
            item["label"] = STATUS_LABELS["assetStatusLabels"][request["status"]]
        if name == "set_team_status":
            fields["statusText"] = STATUS_LABELS["teamStatusLabels"][request["status"]]
            item.setdefault("updates", []).append({"at": self._story_time(meta).isoformat(), "text": fields.pop("updateText")})
        if name == "add_task":
            fields["status"] = "not_started"
        if name == "record_decision":
            fields["recordedBy"] = who
        if name == "set_task_status":
            if request["status"] == "done":
                item["doneAt"] = self._story_time(meta).isoformat()
            else:
                item.pop("doneAt", None)
                item.pop("doneOffsetMinutes", None)
        for identifier in ("huntId", "contactId", "taskId"):
            fields.pop(identifier, None)
        item.update(fields)
        item["history"].append({"who": who, "when": self._wall_now().isoformat(), "what": deepcopy(request)})
        self._ingest_records(dataset, {collection: [item]}, "analyst")
        return f"{name.replace('_', ' ').capitalize()} recorded locally; no dispatch, notification or recovery is asserted."

    def story_now(self):
        with self.store._locked():
            return self._story_time(self._meta(self.store._load())).isoformat()

    def records(self, incident_id=None):
        with self.store._locked():
            dataset = self.store._load()
            meta = self._meta(dataset)
            if meta is None:
                raise InvalidModelError("Scripted records have not been initialized")
            current = self._all(dataset)
            now = self._story_time(meta)
            cases = {r["id"]: r for r in self.store._records(dataset, CASE_KIND)}
            visible = []
            for incident in current["statewideIncidents"]:
                if incident.get("linkedEventIds") and not incident.get("caseId"):
                    continue
                case = cases.get(incident.get("caseId"))
                if incident.get("linkedEventIds") and case is None:
                    continue
                if case is not None:
                    incident["status"] = case["status"]
                    incident["reviews"] = deepcopy(case.get("decisions", []))
                    incident["progress"] = deepcopy(case.get("tasks", []))
                    incident["runId"] = case.get("runId")
                visible.append(incident)
            if incident_id is not None:
                visible = [i for i in visible if incident_id in (i["id"], i.get("caseId"))]
            ids = {i["id"] for i in visible}
            current["statewideIncidents"] = visible
            for collection in COLLECTIONS[1:]:
                current[collection] = [r for r in current[collection] if r.get("incidentId") in ids]
            origin = _parse(meta.get("incidentOrigin", self.scenario["incidentOrigin"]))
            def enrich(item, opened=None):
                opened = _parse(item["openedStoryAt"]) if "openedStoryAt" in item else opened
                for key, value in list(item.items()):
                    if isinstance(value, list):
                        for member in value:
                            if isinstance(member, dict):
                                enrich(member, opened)
                    elif isinstance(value, dict):
                        enrich(value, opened)
                for key, target in (("relativeTimeHours", "at"), ("startedRelativeHours", "startedAt"), ("closedRelativeHours", "closedAt")):
                    if key in item:
                        item[target] = (origin + timedelta(hours=item[key])).isoformat()
                if opened:
                    for key, target in (("offsetMinutes", "at"), ("dueOffsetMinutes", "dueAt"), ("doneOffsetMinutes", "doneAt"), ("etaOffsetMinutes", "etaAt")):
                        if key in item and target not in item:
                            item[target] = (opened + timedelta(minutes=item[key])).isoformat()
            for collection, items in current.items():
                for item in items:
                    enrich(item)
                    if collection == "responseTasks":
                        item["late"] = item["status"] != "done" and "dueAt" in item and _parse(item["dueAt"]) < now
            config = meta["config"]
            result = {**current, "storyNow": now.isoformat(), "timing": config["timing"], "taskGroups": config["taskGroups"]}
            result.update(STATUS_LABELS)
            result.update({k: v for k, v in config.items() if k.endswith("Labels")})
            return deepcopy(result)

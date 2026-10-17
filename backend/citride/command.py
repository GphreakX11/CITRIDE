"""Durable local review casework; no dispatch, authority, or recovery actions."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from math import isfinite
from typing import TypedDict, cast
from uuid import uuid4

from .engine import compute_run
from .incident_context import incident_context
from .storage import ConflictError, InvalidModelError, NotFoundError
from .validation import validate_baseline
from .records import RecordsService, ACTION_FIELDS as RECORD_ACTION_FIELDS, validate_action


class CommandIncident(TypedDict):
    id: str
    version: int
    title: str
    priority: str
    status: str
    createdAt: str
    updatedAt: str
    closedAt: str | None
    closureNote: str | None
    eventId: str
    baselineRevision: int
    eventSnapshot: dict
    contextSnapshot: dict
    tasks: list[dict]
    decisions: list[dict]
    notes: list[dict]
    activity: list[dict]
    runId: str | None
    runSnapshot: dict | None


KIND = "command-incident"
TASK_LABELS = ("Review source evidence", "Review consequence assumptions", "Document coordination needs")
RETIRED_EVENT_TYPES = {"ReferenceInvestigation", "PacketCaptureInvestigation"}
PUBLIC_FIELDS = set(CommandIncident.__annotations__)
PRIORITIES = {"critical", "high", "medium", "low"}
STATUSES = {"open", "monitoring", "closed"}
ACTION_FIELDS = {
    "set_status": {"status", "note"}, "set_task": {"taskId", "completed"},
    "review_decision": {"decisionId", "note"}, "add_note": {"note"},
    "analyze": {"scenarioId", "evaluationHour", "horizonHours"},
    **RECORD_ACTION_FIELDS,
}


def _retired(record):
    """Only the retired event types are hidden; historical records stay intact."""
    event = record.get("eventSnapshot") if isinstance(record, dict) else None
    event_type = event.get("type") if isinstance(event, dict) else None
    return isinstance(event_type, str) and event_type in RETIRED_EVENT_TYPES


def _text(value, name, limit=256):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise InvalidModelError(f"{name} must be nonempty text of at most {limit} characters")
    return value


def _integer(value, name):
    if type(value) is not int or value < 1:
        raise InvalidModelError(f"{name} must be a positive integer")


def _hours(value, name):
    try:
        valid = type(value) in (int, float) and isfinite(value) and 0 <= value <= 7200
    except OverflowError:
        valid = False
    if not valid:
        raise InvalidModelError(f"{name} must be finite hours between 0 and 7200")


def _timestamp():
    return datetime.now(timezone.utc).isoformat()


def _id():
    return str(uuid4())


def _request(request, create=False):
    if not isinstance(request, dict):
        raise InvalidModelError("Request must be an object")
    if create:
        fields = {"eventId", "title", "priority", "expectedBaselineRevision", "clientRequestId"}
    else:
        action = request.get("action")
        if not isinstance(action, str) or action not in ACTION_FIELDS:
            raise InvalidModelError("Unknown case action")
        fields = ACTION_FIELDS[action] | {"action", "expectedVersion", "clientRequestId"}
    if set(request) != fields:
        raise InvalidModelError("Request has missing or unsupported fields")
    _text(request["clientRequestId"], "clientRequestId")
    if create:
        _text(request["eventId"], "eventId")
        _text(request["title"], "title", 160)
        if not isinstance(request["priority"], str) or request["priority"] not in PRIORITIES:
            raise InvalidModelError("Invalid priority")
        _integer(request["expectedBaselineRevision"], "expectedBaselineRevision")
    else:
        _integer(request["expectedVersion"], "expectedVersion")
        action = request["action"]
        if action in RECORD_ACTION_FIELDS:
            validate_action(request)
        if "note" in request:
            _text(request["note"], "note", 2000)
        if action == "set_status" and (not isinstance(request["status"], str) or request["status"] not in STATUSES):
            raise InvalidModelError("Invalid status")
        if action == "set_task":
            _text(request["taskId"], "taskId")
            if type(request["completed"]) is not bool:
                raise InvalidModelError("completed must be a boolean")
        if action == "review_decision":
            _text(request["decisionId"], "decisionId")
        if action == "analyze":
            _text(request["scenarioId"], "scenarioId")
            _hours(request["evaluationHour"], "evaluationHour")
            _hours(request["horizonHours"], "horizonHours")
            if request["horizonHours"] == 0 or request["evaluationHour"] > request["horizonHours"]:
                raise InvalidModelError("Positive horizonHours must include evaluationHour")


def _fingerprint(request, identifier=None):
    payload = {"operation": "create" if identifier is None else "act", "id": identifier, "request": request}
    return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _validated_baseline(baseline):
    try:
        _integer(baseline["baselineRevision"], "baselineRevision")
        errors = validate_baseline(baseline)
        if errors:
            raise InvalidModelError("Invalid baseline: " + "; ".join(errors))
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise InvalidModelError("Malformed baseline") from exc


def _decisions(run):
    """All labels/provenance come exclusively from this immutable run snapshot."""
    snapshot = run["baselineSnapshot"]
    entities = {item["id"]: item for item in snapshot["entities"]}
    functions = {item["id"]: item for item in snapshot["serviceFunctions"]}
    sources = {item["id"]: item for item in snapshot["sources"]}
    decisions = []
    for impact in run["impacts"]:
        entity = entities[impact["entityId"]]
        function = functions[impact["functionId"]]
        if function["facility"] != entity["id"] or impact.get("evidenceStatus") != "modeled":
            raise InvalidModelError("Invalid modeled impact ownership or evidence status")
        decisions.append({
            "id": _id(), "title": f"Review modeled consequence: {function['label']} — {entity['label']}",
            "entityId": impact["entityId"], "entityLabel": entity["label"],
            "functionId": impact["functionId"], "functionLabel": function["label"],
            "state": impact["state"], "windowHours": deepcopy(impact["windowHours"]),
            "sourceRefs": deepcopy(impact["sourceRefs"]),
            "sourceSnapshots": [deepcopy(sources[ref]) for ref in impact["sourceRefs"]],
            "assumptions": deepcopy(impact["assumptions"]), "reviewed": False,
            "reviewNote": None, "reviewedAt": None,
            "authorityBasis": "not_configured", "gateStatus": "not_evaluated",
        })
    return decisions


class CommandService:
    def __init__(self, store):
        self.store = store

    def _records(self, dataset):
        try:
            records = [record for record in self.store._records(dataset, KIND) if not _retired(record)]
            if len(records) > 200:
                raise InvalidModelError("Incident capacity exceeded")
            identifiers, receipts = set(), set()
            for record in records:
                self._public(dataset, record)
                if record["id"] in identifiers or self.store._record(dataset, KIND, record["id"]) != record:
                    raise InvalidModelError("Stored incident identifier mismatch")
                identifiers.add(record["id"])
                if receipts.intersection(record["_requests"]):
                    raise InvalidModelError("Request receipts are shared between incidents")
                receipts.update(record["_requests"])
            return records
        except (KeyError, TypeError, ValueError, AttributeError, NotFoundError) as exc:
            raise InvalidModelError("Malformed stored incident") from exc

    def _public(self, dataset, record) -> CommandIncident:
        if _retired(record):
            raise NotFoundError("Incident was not found")
        try:
            if set(record) != (PUBLIC_FIELDS - {"runSnapshot"}) | {"_requests"}:
                raise InvalidModelError("Malformed stored incident fields")
            for key in ("id", "eventId"):
                _text(record[key], key)
            _text(record["title"], "title", 160)
            _integer(record["version"], "version")
            _integer(record["baselineRevision"], "baselineRevision")
            if record["priority"] not in PRIORITIES or record["status"] not in STATUSES:
                raise InvalidModelError("Invalid stored priority/status")
            for key in ("createdAt", "updatedAt"):
                self._time(record[key])
            if record["eventSnapshot"]["id"] != record["eventId"] or record["contextSnapshot"]["event"] != record["eventSnapshot"]:
                raise InvalidModelError("Incident event snapshot mismatch")
            if record["contextSnapshot"]["baselineRevision"] != record["baselineRevision"]:
                raise InvalidModelError("Incident context revision mismatch")
            context = record["contextSnapshot"]
            if set(context) != {"baselineRevision", "event", "cyberAsset", "physicalAsset", "facility", "provider", "serviceArea", "downstreamDependencies", "scenarios", "sourceRefs", "warnings"}:
                raise InvalidModelError("Malformed captured context")
            for key in ("cyberAsset", "physicalAsset", "facility", "provider", "serviceArea"):
                if context[key] is not None and not isinstance(context[key], dict):
                    raise InvalidModelError("Malformed captured structural record")
            for key in ("downstreamDependencies", "scenarios", "sourceRefs", "warnings"):
                if not isinstance(context[key], list):
                    raise InvalidModelError("Malformed captured context collection")
            for scenario in context["scenarios"]:
                _text(scenario["id"], "scenarioId")
                refs = scenario["seed"]["eventRefs"]
                if not isinstance(refs, list) or record["eventId"] not in refs:
                    raise InvalidModelError("Captured scenario is not linked to this event")
            task_labels = TASK_LABELS
            if not isinstance(record["tasks"], list) or len(record["tasks"]) != len(task_labels):
                raise InvalidModelError("Invalid incident tasks")
            for task, label in zip(record["tasks"], task_labels):
                if set(task) != {"id", "label", "completed", "completedAt"} or task["label"] != label or type(task["completed"]) is not bool:
                    raise InvalidModelError("Invalid incident task")
                _text(task["id"], "taskId")
                if task["completed"]:
                    self._time(task["completedAt"])
                elif task["completedAt"] is not None:
                    raise InvalidModelError("Incomplete task has completion timestamp")
            if len({task["id"] for task in record["tasks"]}) != len(task_labels):
                raise InvalidModelError("Duplicate task IDs")
            for key in ("notes", "activity", "decisions"):
                if not isinstance(record[key], list):
                    raise InvalidModelError(f"Invalid stored {key}")
            if len(record["activity"]) > 300 or record["version"] != len(record["activity"]) + 1:
                raise InvalidModelError("Invalid action history")
            receipts = record["_requests"]
            if not isinstance(receipts, dict) or len(receipts) != record["version"]:
                raise InvalidModelError("Invalid request receipts")
            for key, fingerprint in receipts.items():
                _text(key, "clientRequestId")
                if not isinstance(fingerprint, str) or len(fingerprint) != 64 or any(c not in "0123456789abcdef" for c in fingerprint):
                    raise InvalidModelError("Invalid receipt fingerprint")
            for note in record["notes"]:
                if set(note) != {"id", "text", "createdAt"}:
                    raise InvalidModelError("Invalid stored note")
                _text(note["id"], "noteId")
                _text(note["text"], "note", 2000)
                self._time(note["createdAt"])
            for activity in record["activity"]:
                if set(activity) != {"id", "kind", "message", "createdAt"} or activity["kind"] not in ACTION_FIELDS:
                    raise InvalidModelError("Invalid stored activity")
                _text(activity["id"], "activityId")
                _text(activity["message"], "message", 2400)
                self._time(activity["createdAt"])
            if record["status"] == "closed":
                self._time(record["closedAt"])
                _text(record["closureNote"], "closureNote", 2000)
                if not all(t["completed"] for t in record["tasks"]) or not all(d["reviewed"] for d in record["decisions"]):
                    raise InvalidModelError("Closed incident has pending reviews")
            elif record["closedAt"] is not None or record["closureNote"] is not None:
                raise InvalidModelError("Active incident has closure metadata")
            run = None
            if record["runId"] is not None:
                _text(record["runId"], "runId")
                try:
                    run = self.store._record(dataset, "run", record["runId"])
                except NotFoundError as exc:
                    raise InvalidModelError("Incident references a missing immutable run") from exc
                if run["id"] != record["runId"] or run["baselineRevision"] != record["baselineRevision"] or record["eventId"] not in run["seed"]["eventRefs"]:
                    raise InvalidModelError("Incident run does not match captured event/revision")
                if run["baselineSnapshot"]["baselineRevision"] != record["baselineRevision"] or run["request"]["overrides"] != [] or run["scenarioId"] not in {s["id"] for s in context["scenarios"]}:
                    raise InvalidModelError("Incident run differs from captured analysis scope")
                # Validate against captured evidence, never the current baseline.
                # IDs/revisions alone do not establish the same event, topology,
                # scenario seed, or analysis settings after malformed persistence.
                if incident_context(run["baselineSnapshot"], record["eventId"]) != context:
                    raise InvalidModelError("Incident context differs from immutable run")
                scenario = next(s for s in context["scenarios"] if s["id"] == run["scenarioId"])
                if run["seed"] != scenario["seed"] or run["request"]["scenarioId"] != run["scenarioId"]:
                    raise InvalidModelError("Incident run seed/request differs from captured scenario")
                _hours(run["request"]["evaluationHour"], "evaluationHour")
                _hours(run["request"]["horizonHours"], "horizonHours")
                if run["request"]["horizonHours"] == 0 or run["request"]["evaluationHour"] > run["request"]["horizonHours"]:
                    raise InvalidModelError("Invalid stored analysis horizon")
                expected = _decisions(run)
                if len(expected) != len(record["decisions"]):
                    raise InvalidModelError("Incident decisions do not match modeled impacts")
                for decision, original in zip(record["decisions"], expected):
                    if set(decision) != set(original):
                        raise InvalidModelError("Invalid decision fields")
                    for field in set(original) - {"id", "reviewed", "reviewNote", "reviewedAt"}:
                        if decision[field] != original[field]:
                            raise InvalidModelError("Decision differs from immutable run")
                    _text(decision["id"], "decisionId")
                    if type(decision["reviewed"]) is not bool:
                        raise InvalidModelError("Invalid reviewed flag")
                    if decision["reviewed"]:
                        _text(decision["reviewNote"], "reviewNote", 2000)
                        self._time(decision["reviewedAt"])
                    elif decision["reviewNote"] is not None or decision["reviewedAt"] is not None:
                        raise InvalidModelError("Unreviewed decision has review metadata")
                if len({d["id"] for d in record["decisions"]}) != len(record["decisions"]):
                    raise InvalidModelError("Duplicate decision IDs")
            elif record["decisions"]:
                raise InvalidModelError("Decisions lack a captured run")
            return cast(CommandIncident, deepcopy({**{key: record[key] for key in PUBLIC_FIELDS - {"runSnapshot"}}, "runSnapshot": run}))
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise InvalidModelError("Malformed stored incident or immutable run") from exc

    @staticmethod
    def _time(value):
        if not isinstance(value, str):
            raise InvalidModelError("Invalid stored server timestamp")
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
            raise InvalidModelError("Stored timestamp must be UTC")

    def _replay(self, dataset, records, request, identifier=None):
        fingerprint = _fingerprint(request, identifier)
        for record in records:
            prior = record["_requests"].get(request["clientRequestId"])
            if prior is not None:
                if prior != fingerprint:
                    raise ConflictError("clientRequestId was already used for a different request")
                return self._public(dataset, record)
        return None

    def list(self) -> list[CommandIncident]:
        with self.store._locked():
            return self.list_from_dataset(self.store._load())

    def list_from_dataset(self, dataset) -> list[CommandIncident]:
        """Validate/filter public incidents without acquiring a lock or loading."""
        return [self._public(dataset, record) for record in self._records(dataset)]

    def get(self, identifier) -> CommandIncident:
        with self.store._locked():
            _text(identifier, "incidentId")
            dataset = self.store._load()
            try:
                record = self.store._record(dataset, KIND, identifier)
            except (KeyError, TypeError, ValueError, AttributeError) as exc:
                raise InvalidModelError("Malformed stored incident") from exc
            if not isinstance(record, dict) or record.get("id") != identifier:
                raise InvalidModelError("Stored incident identifier mismatch")
            return self._public(dataset, record)

    def create(self, request: dict) -> CommandIncident:
        with self.store._locked():
            _request(request, create=True)
            dataset = self.store._load()
            records = self._records(dataset)
            replay = self._replay(dataset, records, request)
            if replay is not None:
                return replay
            baseline = self.store._baseline(dataset)
            _validated_baseline(baseline)
            if request["expectedBaselineRevision"] != baseline["baselineRevision"]:
                raise ConflictError("Baseline revision changed; reload before creating casework")
            for existing in records:
                if existing["eventId"] == request["eventId"] and existing["status"] != "closed":
                    raise ConflictError(f"Event already has active incident {existing['id']}")
            if len(records) >= 200:
                raise ConflictError("Incident capacity of 200 reached")
            try:
                event = next((event for event in baseline["events"] if event.get("id") == request["eventId"]), None)
                if event is not None and event.get("type") in RETIRED_EVENT_TYPES:
                    raise NotFoundError("Event was not found")
                context = incident_context(baseline, request["eventId"])
            except ValueError as exc:
                raise InvalidModelError("eventId must resolve to a baseline event") from exc
            task_labels = TASK_LABELS
            now = _timestamp()
            record = {
                "id": _id(), "version": 1, "title": request["title"], "priority": request["priority"],
                "status": "open", "createdAt": now, "updatedAt": now, "closedAt": None, "closureNote": None,
                "eventId": request["eventId"], "baselineRevision": baseline["baselineRevision"],
                "eventSnapshot": deepcopy(context["event"]), "contextSnapshot": context,
                "tasks": [{"id": _id(), "label": label, "completed": False, "completedAt": None} for label in task_labels],
                "decisions": [], "notes": [], "activity": [], "runId": None,
                "_requests": {request["clientRequestId"]: _fingerprint(request)},
            }
            result = self._public(dataset, record)
            RecordsService(self.store).on_case_opened(dataset, record)
            self.store._record_graph(dataset, KIND, record)
            self.store._save(dataset)
            return result

    def act(self, identifier, request: dict) -> CommandIncident:
        with self.store._locked():
            _text(identifier, "incidentId")
            _request(request)
            dataset = self.store._load()
            records = self._records(dataset)
            replay = self._replay(dataset, records, request, identifier)
            if replay is not None:
                return replay
            record = next((r for r in records if r["id"] == identifier), None)
            if record is None:
                raise NotFoundError(f"Incident {identifier} was not found")
            if request["expectedVersion"] != record["version"]:
                raise ConflictError("Incident version changed; reload before updating casework")
            action = request["action"]
            if record["status"] == "closed" and not (action == "set_status" and request["status"] in {"open", "monitoring"}):
                raise ConflictError("Closed casework allows only explicit reopening with a note")
            if len(record["activity"]) >= 300:
                raise ConflictError("Case action capacity of 300 reached")
            now = _timestamp()
            run = None
            if action == "set_status":
                if request["status"] == "closed":
                    if not all(t["completed"] for t in record["tasks"]) or not all(d["reviewed"] for d in record["decisions"]):
                        raise ConflictError("Complete all tasks and review all decisions before case tracking closure")
                    record["closedAt"], record["closureNote"] = now, request["note"]
                    message = "Case tracking closed only; no recovery or dispatch is asserted. " + request["note"]
                else:
                    if record["status"] == "closed":
                        for existing in records:
                            if existing["id"] != identifier and existing["eventId"] == record["eventId"] and existing["status"] != "closed":
                                raise ConflictError(f"Event already has active incident {existing['id']}")
                    record["closedAt"] = record["closureNote"] = None
                    message = f"Local case tracking set to {request['status']}. " + request["note"]
                record["status"] = request["status"]
            elif action == "set_task":
                task = next((t for t in record["tasks"] if t["id"] == request["taskId"]), None)
                if task is None:
                    raise InvalidModelError("taskId must name a task in this case")
                task.update(completed=request["completed"], completedAt=now if request["completed"] else None)
                message = f"Local review task {'completed' if request['completed'] else 'reopened'}: {task['label']}"
            elif action == "review_decision":
                decision = next((d for d in record["decisions"] if d["id"] == request["decisionId"]), None)
                if decision is None:
                    raise InvalidModelError("decisionId must name a modeled decision in this case")
                decision.update(reviewed=True, reviewNote=request["note"], reviewedAt=now)
                message = "Modeled consequence reviewed locally; authority not configured and formal gate not evaluated. " + request["note"]
            elif action == "add_note":
                record["notes"].append({"id": _id(), "text": request["note"], "createdAt": now})
                message = "Local coordination note recorded; not sent."
            elif action in RECORD_ACTION_FIELDS:
                message = RecordsService(self.store).apply_action(dataset, record, request)
            else:
                if record["runId"] is not None:
                    raise ConflictError("This case already captures an immutable run; it cannot be overwritten")
                scenarios = record["contextSnapshot"]["scenarios"]
                if not any(s["id"] == request["scenarioId"] and record["eventId"] in s["seed"].get("eventRefs", []) for s in scenarios):
                    raise InvalidModelError("scenarioId must be explicitly linked to this captured event context")
                baseline = self.store._baseline(dataset)
                _validated_baseline(baseline)
                if baseline["baselineRevision"] != record["baselineRevision"]:
                    raise ConflictError("Baseline revision changed; analysis requires the captured case revision")
                run_request = {key: request[key] for key in ("scenarioId", "evaluationHour", "horizonHours")}
                run_request["overrides"] = []
                try:
                    run = compute_run(deepcopy(baseline), run_request, "run-" + uuid4().hex)
                    run["createdAt"] = now
                    record["decisions"] = _decisions(run)
                except (ValueError, KeyError, TypeError, AttributeError) as exc:
                    raise InvalidModelError("Invalid consequence analysis model") from exc
                record["runId"] = run["id"]
                message = "Immutable conditional consequence analysis captured; no observed impact or formal gate pass is asserted."
            record["version"] += 1
            record["updatedAt"] = now
            record["activity"].append({"id": _id(), "kind": action, "message": message, "createdAt": now})
            record["_requests"][request["clientRequestId"]] = _fingerprint(request, identifier)
            if run is not None:
                self.store._record_graph(dataset, "run", run)
            result = self._public(dataset, record)
            self.store._record_graph(dataset, KIND, record)
            self.store._save(dataset)
            return result

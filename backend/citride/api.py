"""Single-tenant local demo API. Bind to loopback; production auth is deferred."""

import json
import os
import re
import threading
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .access import DemoAccessMiddleware
from .billington_reference import idt_router
from . import billington_reference
from .zeek_logs import load_zeek_json
from .command_requests import CommandActionRequest, CommandCreateRequest, DemoResetRequest
from .records import RecordsService
from .storage import (
    ConflictError,
    InvalidModelError,
    NotFoundError,
    Repository,
    StorageUnavailableError,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$"
FiniteHours = Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]
Identifier = Annotated[str, Field(pattern=ID_PATTERN)]
QueryIdentifier = Annotated[str, Query(pattern=ID_PATTERN)]


class ProposalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dependency: dict
    expectedBaselineRevision: Annotated[int, Field(strict=True, ge=1)]

    @model_validator(mode="after")
    def safe_dependency_id(self):
        identifier = self.dependency.get("id")
        if not isinstance(identifier, str) or not re.fullmatch(ID_PATTERN, identifier):
            raise ValueError(
                "Dependency id must be a safe identifier of 1–128 characters"
            )
        # Drafts may contain invalid domain values for review, but payloads are
        # always valid JSON; non-finite values must never reach persisted RDF.
        try:
            json.dumps(self.dependency, allow_nan=False)
        except (TypeError, ValueError) as error:
            raise ValueError(
                "Dependency must contain JSON values and finite numbers"
            ) from error
        return self


class BackupOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dependencyId: Identifier
    backupMinHours: FiniteHours
    backupMaxHours: FiniteHours
    note: Annotated[str, Field(min_length=1, max_length=2000)]

    @model_validator(mode="after")
    def ordered_window(self):
        if self.backupMinHours > self.backupMaxHours:
            raise ValueError("Backup minimum cannot exceed maximum")
        if not self.note.strip():
            raise ValueError("Override note must explain the simulated assumption")
        return self


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clientRequestId: Identifier | None = None
    expectedBaselineRevision: Annotated[int | None, Field(strict=True, ge=1)] = None
    scenarioId: Identifier
    evaluationHour: FiniteHours = 1
    horizonHours: Annotated[float, Field(strict=True, gt=0, allow_inf_nan=False)] = 12
    overrides: list[BackupOverride] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def valid_window(self):
        if self.evaluationHour > self.horizonHours:
            raise ValueError("Evaluation hour must not exceed horizon")
        ids = [override.dependencyId for override in self.overrides]
        if len(ids) != len(set(ids)):
            raise ValueError("Each dependency may have only one backup override")
        return self


class InferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedBaselineRevision: Annotated[int | None, Field(strict=True, ge=1)] = None


def _safe_id(identifier: str) -> str:
    if not re.fullmatch(ID_PATTERN, identifier):
        raise HTTPException(status_code=422, detail="Invalid identifier")
    return identifier


def create_app(
    data_dir: Path | None = None, scenario_path: Path | None = None
) -> FastAPI:
    app = FastAPI(
        title="CITRIDE local synthetic demo",
        version="0.1.0",
        description="Single-tenant synthetic simulation. Hosted instances use a shared demo login; no live OT connection.",
    )
    if not billington_reference.REFERENCE_DIR.is_dir():
        billington_reference.REFERENCE_DIR = Path(__file__).parent / "demo_data/reference/idt"
    app.include_router(idt_router)

    hosted = os.environ.get("VERCEL") == "1"
    database_url = (
        None
        if data_dir is not None
        else (os.environ.get("CITRIDE_DATABASE_URL") or os.environ.get("DATABASE_URL"))
    )
    app.add_middleware(
        DemoAccessMiddleware,
        username=os.environ.get("CITRIDE_DEMO_USERNAME", "demo"),
        password=(
            # Runtime configuration only; no credential is embedded in source.
            os.environ.get("CITRIDE_DEMO_PASSWORD")
        ),
        required=hosted,
        secure_origin=hosted and os.environ.get("VERCEL_ENV") != "development",
    )
    repository_path = data_dir or Path(
        os.environ.get("CITRIDE_DATA_DIR", REPO_ROOT / ".local")
    )
    bundled_data = Path(__file__).parent / "demo_data"
    local_fixture = REPO_ROOT / "data" / "scenario.json"
    fixture_path = scenario_path or (
        local_fixture if local_fixture.is_file() else bundled_data / "scenario.json"
    )
    repository: Repository | None = None
    reset_enabled = data_dir is not None or os.environ.get("CITRIDE_ALLOW_DEMO_RESET") == "1"
    if scenario_path is None:
        # Validate source configuration before traffic without durable writes.
        from types import SimpleNamespace
        RecordsService(SimpleNamespace(scenario_path=fixture_path))

    @app.exception_handler(StorageUnavailableError)
    async def unavailable_storage(_request, _error):
        return JSONResponse(
            status_code=503,
            content={"detail": "Demo storage is temporarily unavailable."},
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_error(_request, error: RequestValidationError):
        # Pydantic includes offending input/context in errors. Restrict the
        # response to actionable fields so NaN inputs and exception objects do
        # not break JSON encoding, and raw submitted records are not echoed.
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {key: issue[key] for key in ("type", "loc", "msg") if key in issue}
                    for issue in error.errors()
                ]
            },
        )

    repository_lock = threading.Lock()

    def repo() -> Repository:
        nonlocal repository
        # Browser startup makes parallel requests. Initialize exactly once and
        # publish only after records are ready; a failed attempt remains retryable.
        with repository_lock:
            if repository is None:
                try:
                    if database_url:
                        from .postgres import PostgresRepository

                        candidate = PostgresRepository(
                            database_url,
                            fixture_path,
                            state_key=os.environ.get("CITRIDE_STATE_KEY")
                            or (
                                "citride-" + os.environ.get("VERCEL_ENV", "development")
                                if hosted
                                else "default"
                            ),
                        )
                    elif hosted:
                        raise HTTPException(
                            status_code=503,
                            detail="Set CITRIDE_DATABASE_URL or DATABASE_URL for durable hosted storage.",
                            headers={"X-CITRIDE-Setup-Required": "database_not_configured"},
                        )
                    else:
                        candidate = Repository(repository_path, fixture_path)
                    RecordsService(candidate).initialize()
                    repository = candidate
                except (OSError, ValueError, InvalidModelError) as error:
                    raise HTTPException(
                        status_code=503, detail=f"Demo model could not be loaded: {error}"
                    ) from error
            return repository

    RepositoryDependency = Annotated[Repository, Depends(repo)]

    def handle_operation(operation):
        try:
            return operation()
        except NotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ConflictError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except (InvalidModelError, ValueError) as error:
            diagnostics = getattr(error, "diagnostics", None)
            if diagnostics is not None:
                return JSONResponse(
                    status_code=422,
                    content={
                        "detail": str(error),
                        "category": "semantic_inconsistency",
                        "diagnostics": diagnostics,
                    },
                )
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.get("/health")
    def health(store: RepositoryDependency):
        records = RecordsService(store)
        now = records.now()
        return {
            "status": "ok",
            "baselineRevision": store.baseline()["baselineRevision"],
            "demoMode": True,
            "now": now,
            "operationsTimeZone": records.c4_reference['operationsTimeZone'],
            "resetEnabled": reset_enabled,
        }

    @app.get("/v1/login", include_in_schema=False)
    def demo_login():
        # Top-level navigation invokes the browser's password prompt; credentials
        # then apply to subsequent same-origin /v1 requests, never JS storage.
        return RedirectResponse(url="/", status_code=303)

    @app.get("/v1/reference")
    def reference_data(store: RepositoryDependency):
        return deepcopy(RecordsService(store).reference)

    @app.get("/v1/command/records")
    def command_records(store: RepositoryDependency, incidentId: QueryIdentifier | None = None):
        return handle_operation(lambda: RecordsService(store).records(incidentId))

    @app.get('/v1/command/consequences')
    def command_consequences(store: RepositoryDependency, incidentId: QueryIdentifier | None = None):
        from .consequence_projection import ConsequenceService
        return handle_operation(lambda: ConsequenceService(store).view(incidentId))

    @app.post("/v1/demo/reset")
    def reset_demo(request: DemoResetRequest, store: RepositoryDependency):
        if not reset_enabled:
            raise HTTPException(status_code=403, detail="Demo reset is disabled for this environment")
        return handle_operation(lambda: store.reset_demo(request.expectedBaselineRevision, request.clientRequestId))

    @app.get("/v1/bootstrap")
    def bootstrap(store: RepositoryDependency):
        return store.baseline()

    @app.get("/v1/workspace")
    def workspace(store: RepositoryDependency):
        from .workspace import workspace_snapshot

        return handle_operation(
            lambda: workspace_snapshot(store, reset_enabled=reset_enabled)
        )

    @app.get("/v1/telemetry")
    def telemetry(store: RepositoryDependency):
        streams = []
        telemetry_dir = fixture_path.parent / "telemetry"
        try:
            corelight = load_zeek_json(telemetry_dir / "corelight")
        except ValueError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        for path in sorted(telemetry_dir.glob("*.json")):
            # network.json is only a compatibility view of conn, not a second
            # evidence stream when Corelight logs are available.
            if path.name == "manifest.json" or (corelight and path.name == "network.json"):
                continue
            with path.open(encoding="utf-8") as source:
                payload = json.load(source)
            streams.extend(payload if isinstance(payload, list) else [payload])
        for name, records in corelight.items():
            simulated = bool(records) and all(row.get("origin") == "simulated" for row in records)
            label = "VPN log" if name == "vpn" else "Network · Corelight format"
            if simulated:
                label += " (simulated)"
            if name != "vpn":
                label += f" · {name}"
            stream = {
                "id": f"corelight/{name}",
                "label": label,
                "sourceRef": "src-network",
                "format": "synthetic_vpn_auth_json" if name == "vpn" else "corelight_zeek_json",
                "records": records,
            }
            if simulated:
                stream["origin"] = "simulated"
            streams.append(stream)
        return {"streams": streams}

    @app.get("/v1/incident-context")
    def incident_context(store: RepositoryDependency, eventId: QueryIdentifier):
        from .incident_context import incident_context as build_context

        def operation():
            baseline = store.baseline()
            if not any(
                event.get("id") == eventId for event in baseline.get("events", [])
            ):
                raise NotFoundError(f"Event {eventId} was not found")
            return build_context(baseline, eventId)

        return handle_operation(operation)

    @app.get("/v1/command/incidents")
    def command_incidents(store: RepositoryDependency):
        from .command import CommandService

        return handle_operation(lambda: {"incidents": CommandService(store).list()})

    @app.post("/v1/command/incidents", status_code=201)
    def create_command_incident(
        request: CommandCreateRequest, store: RepositoryDependency
    ):
        from .command import CommandService

        return handle_operation(
            lambda: CommandService(store).create(request.model_dump())
        )

    @app.get("/v1/command/incidents/{incident_id}")
    def command_incident(incident_id: str, store: RepositoryDependency):
        from .command import CommandService

        return handle_operation(
            lambda: CommandService(store).get(_safe_id(incident_id))
        )

    @app.post("/v1/command/incidents/{incident_id}/actions")
    def command_action(
        incident_id: str, request: CommandActionRequest, store: RepositoryDependency
    ):
        from .command import CommandService

        return handle_operation(
            lambda: CommandService(store).act(
                _safe_id(incident_id), request.model_dump()
            )
        )

    @app.post("/v1/dependency-proposals", status_code=201)
    def create_proposal(request: ProposalRequest, store: RepositoryDependency):
        return handle_operation(
            lambda: store.create_proposal(
                request.dependency, request.expectedBaselineRevision
            )
        )

    @app.get("/v1/dependency-proposals")
    def proposals(store: RepositoryDependency):
        return {"proposals": store.proposals()}

    @app.get("/v1/dependency-proposals/{proposal_id}")
    def proposal(proposal_id: str, store: RepositoryDependency):
        return handle_operation(lambda: store.proposal(_safe_id(proposal_id)))

    @app.post("/v1/dependency-proposals/{proposal_id}/validate")
    def validate_proposal(proposal_id: str, store: RepositoryDependency):
        return handle_operation(lambda: store.validate_proposal(_safe_id(proposal_id)))

    @app.post("/v1/dependency-proposals/{proposal_id}/promote")
    def promote(proposal_id: str, store: RepositoryDependency):
        return handle_operation(lambda: store.promote(_safe_id(proposal_id)))

    @app.post("/v1/runs", status_code=201, include_in_schema=False)
    @app.post("/v1/cascade-runs", status_code=201)
    def create_run(request: RunRequest, store: RepositoryDependency):
        from .engine import compute_run

        def compute(data, model_request, run_id):
            run = compute_run(data, model_request, run_id)
            run["createdAt"] = datetime.now(timezone.utc).isoformat()
            return run

        return handle_operation(lambda: store.create_run(request.model_dump(exclude={"expectedBaselineRevision"}), compute, request.expectedBaselineRevision))

    @app.get("/v1/runs", include_in_schema=False)
    def compatible_run_list(store: RepositoryDependency):
        return runs(store)["runs"]

    @app.get("/v1/cascade-runs")
    def runs(store: RepositoryDependency):
        from .workspace import run_summaries

        return {"runs": run_summaries(store.runs())}

    @app.get("/v1/cascade-runs/{run_id}/compare")
    def compare(run_id: str, store: RepositoryDependency, otherRunId: QueryIdentifier):
        from .engine import compare_runs

        def operation():
            left = store.run(_safe_id(run_id))
            right = store.run(otherRunId)
            return compare_runs(left, right)

        return handle_operation(operation)

    @app.get("/v1/runs/{run_id}", include_in_schema=False)
    @app.get("/v1/cascade-runs/{run_id}")
    def run_detail(run_id: str, store: RepositoryDependency):
        return handle_operation(lambda: store.run(_safe_id(run_id)))

    @app.get("/v1/explain")
    def explain(
        store: RepositoryDependency, runId: QueryIdentifier, impactId: QueryIdentifier
    ):
        def operation():
            run = store.run(runId)
            impact = next(
                (item for item in run["impacts"] if item["id"] == impactId), None
            )
            if impact is None:
                raise NotFoundError(f"Impact {impactId} was not found in run {runId}")
            snapshot = run["baselineSnapshot"]
            used_dependencies = {
                identifier for path in impact["paths"] for identifier in path
            }
            dependencies = deepcopy(
                [
                    item
                    for item in snapshot["dependencies"]
                    if item["id"] in used_dependencies
                ]
            )
            overrides = {
                item["dependencyId"]: item
                for item in run["request"].get("overrides", [])
            }
            for dependency in dependencies:
                if dependency["id"] in overrides:
                    override = overrides[dependency["id"]]
                    dependency["baselineBackupHours"] = [
                        dependency.get("usableBackupMinHours"),
                        dependency.get("usableBackupMaxHours"),
                    ]
                    dependency["usableBackupMinHours"] = override["backupMinHours"]
                    dependency["usableBackupMaxHours"] = override["backupMaxHours"]
                    dependency["whatIfOverride"] = deepcopy(override)
            source_ids = set(impact["sourceRefs"]) | set(
                run["seed"].get("sourceRefs", [])
            )
            source_catalog = snapshot.get("sources", []) + run.get(
                "overrideSources", []
            )
            assertion_ids = {
                identifier
                for dependency in dependencies
                for identifier in dependency.get("parameterAssertionRefs", {}).values()
            }
            parameter_assertions = [
                item
                for item in snapshot.get("assumptions", [])
                if item["id"] in assertion_ids
            ]
            events = [
                event
                for event in snapshot.get("events", [])
                if event["id"] in run["seed"].get("eventRefs", [])
            ]
            for item in events + parameter_assertions:
                source_ids.update(item.get("sourceRefs", []))
            return {
                "runId": runId,
                "impact": impact,
                "seed": run["seed"],
                "dependencies": dependencies,
                "sources": [
                    source for source in source_catalog if source["id"] in source_ids
                ],
                "assumptions": impact["assumptions"],
                "parameterAssertions": parameter_assertions,
                "eventEvidence": events,
                "baselineRevision": run["baselineRevision"],
            }

        return handle_operation(operation)

    @app.get("/v1/ontology")
    def ontology():
        from .reasoning import ontology_metadata

        return handle_operation(ontology_metadata)

    @app.post("/v1/inference-runs", status_code=201)
    def create_inference(
        store: RepositoryDependency, request: InferenceRequest | None = None
    ):
        from .reasoning import compute_inference, ontology_document

        def compute(data, run_id):
            run = compute_inference(data, run_id)
            run["createdAt"] = datetime.now(timezone.utc).isoformat()
            # Storage retains this exact ontology in a hash-addressed graph;
            # the private transfer field is excluded from the API response.
            run["_ontologyTurtle"] = ontology_document()
            return run

        expected_revision = (
            request.expectedBaselineRevision if request is not None else None
        )
        return handle_operation(
            lambda: store.create_inference_run(expected_revision, compute)
        )

    @app.get("/v1/inference-runs")
    def inference_runs(store: RepositoryDependency):
        from .reasoning import ontology_metadata

        def operation():
            metadata = ontology_metadata()
            keys = (
                "id",
                "createdAt",
                "baselineRevision",
                "stale",
                "staleReasons",
                "currentBaselineRevision",
                "currentOntologySha256",
            )
            return {
                "runs": [
                    {
                        **{key: run[key] for key in keys},
                        "ontologyVersion": run["ontology"]["version"],
                        "inferredCount": len(run["inferredFacts"]),
                    }
                    for run in store.inference_runs(metadata["sha256"])
                ]
            }

        return handle_operation(operation)

    @app.get("/v1/inference-runs/{run_id}/facts/{fact_id}")
    def inference_fact(run_id: str, fact_id: str, store: RepositoryDependency):
        return handle_operation(
            lambda: store.inference_fact(_safe_id(run_id), _safe_id(fact_id))
        )

    @app.get("/v1/inference-runs/{run_id}")
    def inference_run(run_id: str, store: RepositoryDependency):
        from .reasoning import ontology_metadata

        return handle_operation(
            lambda: store.inference_run(_safe_id(run_id), ontology_metadata()["sha256"])
        )

    @app.get("/v1/graph/export")
    def graph_export(store: RepositoryDependency):
        return Response(
            store.export(),
            media_type="application/n-quads",
            headers={"Content-Disposition": 'attachment; filename="citride.nq"'},
        )

    frontend_dist = REPO_ROOT / "frontend" / "dist"
    if frontend_dist.is_dir():

        @app.get("/{frontend_path:path}", include_in_schema=False)
        def frontend(frontend_path: str):
            if frontend_path == "v1" or frontend_path.startswith("v1/"):
                raise HTTPException(
                    status_code=404, detail="API endpoint was not found"
                )
            file_path = (frontend_dist / frontend_path).resolve()
            if not file_path.is_relative_to(frontend_dist.resolve()):
                raise HTTPException(status_code=404, detail="File was not found")
            return FileResponse(
                file_path if file_path.is_file() else frontend_dist / "index.html"
            )

    return app


app = create_app()

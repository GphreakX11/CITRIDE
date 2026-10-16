"""Strict review-only command-workspace request contracts."""

from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")]
Version = Annotated[int, Field(strict=True, ge=1)]
Note = Annotated[str, Field(min_length=1, max_length=2000)]
Hours = Annotated[float, Field(strict=True, ge=0, le=7200, allow_inf_nan=False)]


class CommandModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def nonblank_text(self):
        for name in ("title", "note"):
            value = getattr(self, name, None)
            if isinstance(value, str) and not value.strip():
                raise ValueError(f"{name} must contain meaningful text")
        return self


class CommandCreateRequest(CommandModel):
    eventId: Identifier
    title: Annotated[str, Field(min_length=1, max_length=160)]
    priority: Literal["critical", "high", "medium", "low"]
    expectedBaselineRevision: Version
    clientRequestId: Identifier


class ActionBase(CommandModel):
    expectedVersion: Version
    clientRequestId: Identifier


class StatusAction(ActionBase):
    action: Literal["set_status"]
    status: Literal["open", "monitoring", "closed"]
    note: Note


class TaskAction(ActionBase):
    action: Literal["set_task"]
    taskId: Identifier
    completed: Annotated[bool, Field(strict=True)]


class ReviewAction(ActionBase):
    action: Literal["review_decision"]
    decisionId: Identifier
    note: Note


class CoordinationAction(ActionBase):
    action: Literal["add_note"]
    note: Note


class AnalyzeAction(ActionBase):
    action: Literal["analyze"]
    scenarioId: Identifier
    evaluationHour: Hours = 1
    horizonHours: Annotated[
        float, Field(strict=True, gt=0, le=7200, allow_inf_nan=False)
    ] = 12

    @model_validator(mode="after")
    def ordered_horizon(self):
        if self.evaluationHour > self.horizonHours:
            raise ValueError("Evaluation hour must not exceed horizon")
        return self


class AssessmentAction(ActionBase):
    action: Literal["record_assessment"]
    subject: Identifier
    cluster: Note
    actorLabel: Note
    confidence: Literal["low", "medium", "high"]
    note: Note

class AssetStatusAction(ActionBase):
    action: Literal["set_asset_status"]
    entityId: Identifier
    status: Literal["confirmed", "suspected", "at_risk", "normal"]
    note: Note

class HuntAction(ActionBase):
    action: Literal["record_hunt"]
    huntId: Identifier
    status: Literal["running", "queued", "done", "no_findings", "findings"]
    resultNote: Note

class ContactAction(ActionBase):
    action: Literal["set_contact_status"]
    contactId: Identifier
    status: Literal["contacted", "attempted", "not_yet", "engaged", "on_standby", "waiting_on_chief", "not_shared_no_consent"]
    note: Note

class RecordDecisionAction(ActionBase):
    action: Literal["record_decision"]
    optionId: Identifier
    decision: Literal["chosen", "deferred", "not_chosen", "standing_by"]
    decidedBy: Note
    note: Note

class TeamPeople(CommandModel):
    onSite: Annotated[int, Field(strict=True, ge=0)]
    remote: Annotated[int, Field(strict=True, ge=0)]
    traveling: Annotated[int, Field(strict=True, ge=0)]
    standby: Annotated[int, Field(strict=True, ge=0)]

class TeamStatusAction(ActionBase):
    action: Literal["set_team_status"]
    teamId: Identifier
    status: Literal["en_route", "standby", "remote", "on_site"]
    people: TeamPeople
    locationLabel: Note
    updateText: Note

class AddResponseTaskAction(ActionBase):
    action: Literal["add_task"]
    label: Note
    teamId: Identifier
    ownerRole: Note
    dueAt: Note

class ResponseTaskStatusAction(ActionBase):
    action: Literal["set_task_status"]
    taskId: Identifier
    status: Literal["not_started", "in_progress", "waiting", "done"]

class DemoResetRequest(CommandModel):
    expectedBaselineRevision: Version
    clientRequestId: Identifier
    confirm: Literal["RESET DEMO"]

CommandActionRequest = Annotated[
    StatusAction | TaskAction | ReviewAction | CoordinationAction | AnalyzeAction | AssessmentAction | AssetStatusAction | HuntAction | ContactAction | RecordDecisionAction | TeamStatusAction | AddResponseTaskAction | ResponseTaskStatusAction,
    Field(discriminator="action"),
]

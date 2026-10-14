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


CommandActionRequest = Annotated[
    StatusAction | TaskAction | ReviewAction | CoordinationAction | AnalyzeAction,
    Field(discriminator="action"),
]

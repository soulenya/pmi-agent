"""Pydantic schemas for Projects, Tasks, and TaskComments."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


# ── Project ───────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(max_length=255)
    description: str | None = None
    goal: str = ""
    color: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    start_date: datetime | None = None
    target_date: datetime | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    description: str | None = None
    goal: str | None = None
    status: str | None = None
    visibility: Literal["private", "shared", "company"] | None = None
    color: str | None = None
    target_date: datetime | None = None
    is_archived: bool | None = None


class ProjectOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    goal: str
    status: str
    visibility: str
    owner_id: uuid.UUID | None
    start_date: datetime | None
    target_date: datetime | None
    color: str | None
    is_archived: bool
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Task ──────────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title: str = Field(max_length=500)
    description: str | None = None
    project_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    priority: str = "medium"
    assignee_id: uuid.UUID | None = None
    due_date: datetime | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    is_milestone: bool = False
    tags: list[str] = []
    source_ref: dict | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    assignee_id: uuid.UUID | None = None
    due_date: datetime | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    progress_pct: int | None = Field(None, ge=0, le=100)
    is_milestone: bool | None = None
    sort_order: int | None = None
    tags: list[str] | None = None
    project_id: uuid.UUID | None = None


class TaskOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID | None
    parent_task_id: uuid.UUID | None
    title: str
    description: str | None
    status: str
    priority: str
    assignee_id: uuid.UUID | None
    due_date: datetime | None
    start_date: datetime | None = None
    end_date: datetime | None = None
    progress_pct: int = 0
    is_milestone: bool = False
    sort_order: int = 0
    completed_at: datetime | None
    tags: list[str]
    attachments: list[dict] = []
    source_conversation_id: uuid.UUID | None
    source_ref: dict | None = None
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Timeline ────────────────────────────────────────────────────────────

DependencyKind = Literal["FS", "SS", "FF", "SF"]


class DependencyCreate(BaseModel):
    predecessor_id: uuid.UUID
    kind: DependencyKind = "FS"
    lag_days: int = Field(0, ge=-365, le=365)


class DependencyOut(BaseModel):
    id: uuid.UUID
    predecessor_id: uuid.UUID
    successor_id: uuid.UUID
    kind: str
    lag_days: int

    model_config = {"from_attributes": True}


class ScheduleOut(BaseModel):
    task_id: uuid.UUID
    early_start: date
    early_finish: date
    late_start: date
    late_finish: date
    slack_days: int
    is_critical: bool
    is_late: bool


class TimelineOut(BaseModel):
    project_id: uuid.UUID
    tasks: list[TaskOut]
    dependencies: list[DependencyOut]
    schedule: list[ScheduleOut]
    my_role: str


class ReorderItem(BaseModel):
    task_id: uuid.UUID
    sort_order: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


# ── TaskComment ───────────────────────────────────────────────────────────────

class TaskCommentCreate(BaseModel):
    content: str


class TaskCommentOut(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    author_id: uuid.UUID
    content: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

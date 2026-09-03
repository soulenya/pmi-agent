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
    visibility: Literal["private", "shared", "company"] = "private"
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
    blocked_by_gate: uuid.UUID | None = None


class GateOut(BaseModel):
    """A gate as the downstream timeline needs to draw it."""

    link_id: uuid.UUID
    from_project_id: uuid.UUID
    from_project_name: str
    gate_task_id: uuid.UUID | None = None
    gate_task_title: str = ""
    opens_on: date | None = None
    status: str = "open"
    note: str = ""


class TimelineOut(BaseModel):
    project_id: uuid.UUID
    tasks: list[TaskOut]
    dependencies: list[DependencyOut]
    schedule: list[ScheduleOut]
    gates: list[GateOut] = []
    my_role: str


# ── Project links ─────────────────────────────────────────────────────────────

ProjectLinkKind = Literal["depends_on", "gates", "parallel", "subproject_of"]
ProjectLinkStatus = Literal["open", "satisfied", "waived"]


class ProjectLinkCreate(BaseModel):
    to_project_id: uuid.UUID
    kind: ProjectLinkKind = "depends_on"
    gate_task_id: uuid.UUID | None = None
    note: str = ""


class ProjectLinkUpdate(BaseModel):
    kind: ProjectLinkKind | None = None
    gate_task_id: uuid.UUID | None = None
    note: str | None = None
    status: ProjectLinkStatus | None = None


class ProjectLinkOut(BaseModel):
    id: uuid.UUID
    from_project_id: uuid.UUID
    to_project_id: uuid.UUID
    kind: str
    gate_task_id: uuid.UUID | None = None
    gate_task_title: str = ""
    note: str = ""
    status: str = "open"
    satisfied_at: datetime | None = None
    # The end of the link that is not the project being asked about. Empty when
    # the viewer cannot see it: a private project stays absent, not greyed out.
    other_project_id: uuid.UUID | None = None
    other_project_name: str = ""
    other_project_status: str = ""
    other_visible: bool = True
    direction: str = "out"  # out = this project is the `from` end
    created_at: datetime


class PortfolioNode(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    color: str | None = None
    goal: str = ""
    open_tasks: int = 0
    late_tasks: int = 0
    open_gates: int = 0
    next_milestone: str = ""
    next_milestone_date: date | None = None


class PortfolioEdge(BaseModel):
    id: uuid.UUID
    from_project_id: uuid.UUID
    to_project_id: uuid.UUID
    kind: str
    status: str = "open"
    note: str = ""
    # True when one end is a project this viewer cannot see. The edge is drawn
    # dangling and carries no name.
    dangling: bool = False


class PortfolioOut(BaseModel):
    projects: list[PortfolioNode] = []
    links: list[PortfolioEdge] = []


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

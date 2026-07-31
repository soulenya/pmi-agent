"""Pydantic schemas for Projects, Tasks, and TaskComments."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ── Project ───────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(max_length=255)
    description: str | None = None
    color: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    start_date: datetime | None = None
    target_date: datetime | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    description: str | None = None
    status: str | None = None
    color: str | None = None
    target_date: datetime | None = None
    is_archived: bool | None = None


class ProjectOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    status: str
    owner_id: uuid.UUID | None
    start_date: datetime | None
    target_date: datetime | None
    color: str | None
    is_archived: bool
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
    tags: list[str] = []
    source_ref: dict | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    assignee_id: uuid.UUID | None = None
    due_date: datetime | None = None
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
    completed_at: datetime | None
    tags: list[str]
    attachments: list[dict] = []
    source_conversation_id: uuid.UUID | None
    source_ref: dict | None = None
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


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

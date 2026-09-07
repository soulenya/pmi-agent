"""The shape of a whole project in transit between two databases.

A project made on this computer is invisible to everyone else, so sharing one
means moving it to the hub. Identifiers are not carried across: the two
databases number their rows independently. Each row instead gets a `key` that
is unique within the bundle, and parents, canvas cards and edges point at those
keys. The receiving side mints real ids and rewrites the pointers as it goes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from models.schemas.canvas import NodeKind, Viewport


class TaskBundle(BaseModel):
    key: str
    parent_key: str | None = None
    title: str
    description: str | None = None
    status: str = "todo"
    priority: str = "medium"
    due_date: datetime | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    progress_pct: int = 0
    is_milestone: bool = False
    sort_order: int = 0
    completed_at: datetime | None = None
    tags: list[str] = Field(default_factory=list)
    source_ref: dict | None = None


class CanvasNodeBundle(BaseModel):
    key: str
    parent_key: str | None = None
    kind: NodeKind
    # For a task card this is the task's key, not its id; see the module note.
    ref_id: str | None = None
    label: str = ""
    content: str = ""
    x: float = 0
    y: float = 0
    width: float = 200
    height: float = 120
    z: int = 0
    style: dict = Field(default_factory=dict)


class CanvasEdgeBundle(BaseModel):
    source_key: str
    target_key: str
    source_handle: str | None = None
    target_handle: str | None = None
    kind: str = "link"
    label: str = ""
    style: dict = Field(default_factory=dict)


class CanvasBundle(BaseModel):
    name: str = "Canvas"
    viewport: Viewport = Field(default_factory=Viewport)
    nodes: list[CanvasNodeBundle] = Field(default_factory=list)
    edges: list[CanvasEdgeBundle] = Field(default_factory=list)


class PinBundle(BaseModel):
    kind: str
    ref_id: str = ""
    label: str


class MemberBundle(BaseModel):
    email: EmailStr
    role: Literal["viewer", "commenter", "editor"] = "editor"


class ProjectBundle(BaseModel):
    """Everything worth carrying. Anything Google-shaped is deliberately absent:
    the hub holds no credentials and could not follow the reference anyway."""

    name: str
    description: str | None = None
    goal: str = ""
    status: str = "active"
    color: str | None = None
    visibility: Literal["shared", "company"] = "shared"
    start_date: datetime | None = None
    target_date: datetime | None = None
    tasks: list[TaskBundle] = Field(default_factory=list)
    canvases: list[CanvasBundle] = Field(default_factory=list)
    pins: list[PinBundle] = Field(default_factory=list)
    members: list[MemberBundle] = Field(default_factory=list)


class ProjectImported(BaseModel):
    project_id: str
    tasks: int
    canvas_nodes: int
    pins: int
    members: int


class PromoteRequest(BaseModel):
    visibility: Literal["shared", "company"] = "shared"


class PromoteResult(ProjectImported):
    """What the desktop needs to send the user to the copy that people can see."""

    hub_url: str | None = None

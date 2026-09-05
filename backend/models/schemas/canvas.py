"""Canvas request/response schemas."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# Free-form nodes hold their own content; reference nodes point at something
# that already exists elsewhere in the app and are resolved for live data.
FREEFORM_KINDS = ("sticky", "text", "frame", "shape", "image", "ink", "link")
REFERENCE_KINDS = (
    "task",
    "kb_doc",
    "drive_doc",
    "regulatory_doc",
    "budget",
    "website",
    "generated_file",
    "email_thread",
    "conversation",
    "project",
    "canvas",
)
NodeKind = Literal[
    "sticky",
    "text",
    "frame",
    "shape",
    "image",
    "ink",
    "link",
    "task",
    "kb_doc",
    "drive_doc",
    "regulatory_doc",
    "budget",
    "website",
    "generated_file",
    "email_thread",
    "conversation",
    "project",
    "canvas",
]


class Viewport(BaseModel):
    x: float = 0
    y: float = 0
    zoom: float = 1


class CanvasNodeCreate(BaseModel):
    kind: NodeKind
    ref_id: str | None = None
    label: str = ""
    content: str = ""
    x: float = 0
    y: float = 0
    width: float = 200
    height: float = 120
    z: int = 0
    style: dict[str, Any] = Field(default_factory=dict)
    parent_node_id: uuid.UUID | None = None


class CanvasNodeUpdate(BaseModel):
    label: str | None = None
    content: str | None = None
    x: float | None = None
    y: float | None = None
    width: float | None = None
    height: float | None = None
    z: int | None = None
    style: dict[str, Any] | None = None
    parent_node_id: uuid.UUID | None = None


class CanvasNodePatch(CanvasNodeUpdate):
    """One node's worth of a batched autosave."""

    id: uuid.UUID


class CanvasNodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    canvas_id: uuid.UUID
    parent_node_id: uuid.UUID | None = None
    kind: str
    ref_id: str | None = None
    label: str = ""
    content: str = ""
    x: float
    y: float
    width: float
    height: float
    z: int = 0
    style: dict[str, Any] = Field(default_factory=dict)


class CanvasEdgeCreate(BaseModel):
    source_node_id: uuid.UUID
    target_node_id: uuid.UUID
    source_handle: str | None = None
    target_handle: str | None = None
    kind: str = "link"
    label: str = ""
    style: dict[str, Any] = Field(default_factory=dict)


class CanvasEdgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    canvas_id: uuid.UUID
    source_node_id: uuid.UUID
    target_node_id: uuid.UUID
    source_handle: str | None = None
    target_handle: str | None = None
    kind: str = "link"
    label: str = ""
    style: dict[str, Any] = Field(default_factory=dict)


class CanvasOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    viewport: Viewport = Field(default_factory=Viewport)


class CanvasFull(CanvasOut):
    nodes: list[CanvasNodeOut] = Field(default_factory=list)
    edges: list[CanvasEdgeOut] = Field(default_factory=list)
    my_role: str = "viewer"


class CanvasUpdate(BaseModel):
    name: str | None = None
    viewport: Viewport | None = None


class BatchNodeUpdate(BaseModel):
    nodes: list[CanvasNodePatch] = Field(default_factory=list)


class ResolveRequest(BaseModel):
    node_ids: list[uuid.UUID] = Field(default_factory=list)


class ResolvedRef(BaseModel):
    """Live data for one reference node, fetched in bulk."""

    node_id: uuid.UUID
    kind: str
    ref_id: str | None = None
    title: str = ""
    subtitle: str = ""
    status: str | None = None
    # A hint for the colour of the node — "ok" | "warn" | "late" | "gone".
    state: str = "ok"
    missing: bool = False
    # The task this one sits under, so the board can fold a family away.
    parent_ref_id: str | None = None


class ResolveResponse(BaseModel):
    items: list[ResolvedRef] = Field(default_factory=list)

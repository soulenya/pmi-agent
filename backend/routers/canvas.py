"""Project canvas REST API — the infinite whiteboard behind a project."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user, require_project_role
from models.db.browser import BrowserBookmark
from models.db.budget import Budget
from models.db.canvas import CanvasEdge, CanvasNode, ProjectCanvas
from models.db.conversation import Conversation
from models.db.document import Document
from models.db.regulatory import RegulatoryDocument
from models.db.task import Project, Task, TaskDependency
from models.db.user import User
from models.schemas.canvas import (
    BatchNodeUpdate,
    CanvasEdgeCreate,
    CanvasEdgeOut,
    CanvasFull,
    CanvasNodeCreate,
    CanvasNodeOut,
    CanvasNodeUpdate,
    CanvasOut,
    CanvasUpdate,
    ResolvedRef,
    ResolveRequest,
    ResolveResponse,
    Viewport,
)
from services.projects import schedule as sched
from services.projects.access import resolve_role

router = APIRouter(prefix="/projects", tags=["canvas"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_canvas(
    db: AsyncSession, project_id: uuid.UUID, canvas_id: uuid.UUID
) -> ProjectCanvas:
    canvas = (
        await db.execute(
            select(ProjectCanvas).where(
                ProjectCanvas.id == canvas_id, ProjectCanvas.project_id == project_id
            )
        )
    ).scalar_one_or_none()
    if canvas is None:
        raise HTTPException(status_code=404, detail="Canvas not found.")
    return canvas


async def _get_node(
    db: AsyncSession, canvas_id: uuid.UUID, node_id: uuid.UUID
) -> CanvasNode:
    node = (
        await db.execute(
            select(CanvasNode).where(
                CanvasNode.id == node_id, CanvasNode.canvas_id == canvas_id
            )
        )
    ).scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found.")
    return node


def _viewport(raw: object) -> Viewport:
    return Viewport.model_validate(raw) if isinstance(raw, dict) else Viewport()


def _full(canvas: ProjectCanvas, nodes: list[CanvasNode], edges: list[CanvasEdge],
          role: str) -> CanvasFull:
    return CanvasFull(
        id=canvas.id,
        project_id=canvas.project_id,
        name=canvas.name,
        viewport=_viewport(canvas.viewport),
        nodes=[CanvasNodeOut.model_validate(n) for n in nodes],
        edges=[CanvasEdgeOut.model_validate(e) for e in edges],
        my_role=role,
    )


# ── Canvases ──────────────────────────────────────────────────────────────────

@router.get("/{project_id}/canvas", response_model=list[CanvasOut])
async def list_canvases(
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> list[CanvasOut]:
    result = await db.execute(
        select(ProjectCanvas)
        .where(ProjectCanvas.project_id == project.id)
        .order_by(ProjectCanvas.created_at)
    )
    return [
        CanvasOut(
            id=c.id, project_id=c.project_id, name=c.name, viewport=_viewport(c.viewport)
        )
        for c in result.scalars().all()
    ]


@router.post("/{project_id}/canvas", response_model=CanvasOut,
             status_code=status.HTTP_201_CREATED)
async def create_canvas(
    body: CanvasUpdate | None = None,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CanvasOut:
    canvas = ProjectCanvas(
        project_id=project.id,
        name=(body.name if body and body.name else "Canvas"),
        viewport={"x": 0, "y": 0, "zoom": 1},
        created_by=current_user.id,
    )
    db.add(canvas)
    await db.commit()
    await db.refresh(canvas)
    return CanvasOut(
        id=canvas.id, project_id=canvas.project_id, name=canvas.name,
        viewport=_viewport(canvas.viewport),
    )


@router.get("/{project_id}/canvas/default", response_model=CanvasFull)
async def get_default_canvas(
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CanvasFull:
    """The project's first canvas, created on demand so the tab is never empty."""
    role = await resolve_role(db, project, current_user.id) or "viewer"
    canvas = (
        await db.execute(
            select(ProjectCanvas)
            .where(ProjectCanvas.project_id == project.id)
            .order_by(ProjectCanvas.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    if canvas is None:
        if role == "viewer" or role == "commenter":
            # Nothing to show and no right to make one.
            return CanvasFull(
                id=uuid.UUID(int=0), project_id=project.id, name="Canvas",
                viewport=Viewport(), my_role=role,
            )
        canvas = ProjectCanvas(
            project_id=project.id, name="Canvas",
            viewport={"x": 0, "y": 0, "zoom": 1}, created_by=current_user.id,
        )
        db.add(canvas)
        await db.commit()
        await db.refresh(canvas)
    nodes, edges = await _nodes_and_edges(db, canvas.id)
    return _full(canvas, nodes, edges, role)


async def _nodes_and_edges(
    db: AsyncSession, canvas_id: uuid.UUID
) -> tuple[list[CanvasNode], list[CanvasEdge]]:
    nodes = list(
        (
            await db.execute(
                select(CanvasNode)
                .where(CanvasNode.canvas_id == canvas_id)
                .order_by(CanvasNode.z, CanvasNode.created_at)
            )
        )
        .scalars()
        .all()
    )
    edges = list(
        (await db.execute(select(CanvasEdge).where(CanvasEdge.canvas_id == canvas_id)))
        .scalars()
        .all()
    )
    return nodes, edges


@router.get("/{project_id}/canvas/{canvas_id}", response_model=CanvasFull)
async def get_canvas(
    canvas_id: uuid.UUID,
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CanvasFull:
    canvas = await _get_canvas(db, project.id, canvas_id)
    role = await resolve_role(db, project, current_user.id) or "viewer"
    nodes, edges = await _nodes_and_edges(db, canvas.id)
    return _full(canvas, nodes, edges, role)


@router.patch("/{project_id}/canvas/{canvas_id}", response_model=CanvasOut)
async def update_canvas(
    canvas_id: uuid.UUID,
    body: CanvasUpdate,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
) -> CanvasOut:
    canvas = await _get_canvas(db, project.id, canvas_id)
    if body.name is not None:
        canvas.name = body.name
    if body.viewport is not None:
        canvas.viewport = body.viewport.model_dump()
    await db.commit()
    await db.refresh(canvas)
    return CanvasOut(
        id=canvas.id, project_id=canvas.project_id, name=canvas.name,
        viewport=_viewport(canvas.viewport),
    )


@router.delete("/{project_id}/canvas/{canvas_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_canvas(
    canvas_id: uuid.UUID,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
) -> None:
    canvas = await _get_canvas(db, project.id, canvas_id)
    await db.delete(canvas)
    await db.commit()


# ── Nodes ─────────────────────────────────────────────────────────────────────

@router.post("/{project_id}/canvas/{canvas_id}/nodes", response_model=CanvasNodeOut,
             status_code=status.HTTP_201_CREATED)
async def create_node(
    canvas_id: uuid.UUID,
    body: CanvasNodeCreate,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CanvasNodeOut:
    canvas = await _get_canvas(db, project.id, canvas_id)
    node = CanvasNode(
        canvas_id=canvas.id, created_by=current_user.id, **body.model_dump()
    )
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return CanvasNodeOut.model_validate(node)


@router.patch("/{project_id}/canvas/{canvas_id}/nodes", response_model=list[CanvasNodeOut])
async def update_nodes(
    canvas_id: uuid.UUID,
    body: BatchNodeUpdate,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
) -> list[CanvasNodeOut]:
    """Batched autosave — one request per idle pause, not one per drag frame."""
    canvas = await _get_canvas(db, project.id, canvas_id)
    if not body.nodes:
        return []
    wanted = {p.id: p for p in body.nodes}
    result = await db.execute(
        select(CanvasNode).where(
            CanvasNode.canvas_id == canvas.id, CanvasNode.id.in_(list(wanted))
        )
    )
    changed = list(result.scalars().all())
    for node in changed:
        patch = wanted[node.id]
        for field, value in patch.model_dump(exclude={"id"}, exclude_none=True).items():
            setattr(node, field, value)
    await db.commit()
    for node in changed:
        await db.refresh(node)
    return [CanvasNodeOut.model_validate(n) for n in changed]


@router.patch("/{project_id}/canvas/{canvas_id}/nodes/{node_id}",
              response_model=CanvasNodeOut)
async def update_node(
    canvas_id: uuid.UUID,
    node_id: uuid.UUID,
    body: CanvasNodeUpdate,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
) -> CanvasNodeOut:
    canvas = await _get_canvas(db, project.id, canvas_id)
    node = await _get_node(db, canvas.id, node_id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(node, field, value)
    await db.commit()
    await db.refresh(node)
    return CanvasNodeOut.model_validate(node)


@router.delete("/{project_id}/canvas/{canvas_id}/nodes/{node_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(
    canvas_id: uuid.UUID,
    node_id: uuid.UUID,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
) -> None:
    canvas = await _get_canvas(db, project.id, canvas_id)
    node = await _get_node(db, canvas.id, node_id)
    await db.delete(node)
    await db.commit()


# ── Edges ─────────────────────────────────────────────────────────────────────

async def _task_ids_for(
    db: AsyncSession, canvas_id: uuid.UUID, node_ids: list[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    """Map canvas node id -> task id, for the `task` reference nodes among them."""
    result = await db.execute(
        select(CanvasNode).where(
            CanvasNode.canvas_id == canvas_id,
            CanvasNode.id.in_(node_ids),
            CanvasNode.kind == "task",
        )
    )
    out: dict[uuid.UUID, uuid.UUID] = {}
    for node in result.scalars().all():
        try:
            out[node.id] = uuid.UUID(str(node.ref_id))
        except (ValueError, TypeError):
            continue
    return out


@router.post("/{project_id}/canvas/{canvas_id}/edges", response_model=CanvasEdgeOut,
             status_code=status.HTTP_201_CREATED)
async def create_edge(
    canvas_id: uuid.UUID,
    body: CanvasEdgeCreate,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CanvasEdgeOut:
    canvas = await _get_canvas(db, project.id, canvas_id)
    if body.source_node_id == body.target_node_id:
        raise HTTPException(status_code=400, detail="A node cannot link to itself.")
    await _get_node(db, canvas.id, body.source_node_id)
    await _get_node(db, canvas.id, body.target_node_id)

    existing = (
        await db.execute(
            select(CanvasEdge).where(
                CanvasEdge.canvas_id == canvas.id,
                CanvasEdge.source_node_id == body.source_node_id,
                CanvasEdge.target_node_id == body.target_node_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return CanvasEdgeOut.model_validate(existing)

    # Two task nodes joined on the canvas are a real schedule dependency; the
    # canvas and the timeline are two views of one graph.
    tasks = await _task_ids_for(db, canvas.id, [body.source_node_id, body.target_node_id])
    pred_task = tasks.get(body.source_node_id)
    succ_task = tasks.get(body.target_node_id)
    if pred_task and succ_task and pred_task != succ_task:
        await _link_tasks(db, project.id, pred_task, succ_task, current_user.id)

    edge = CanvasEdge(
        canvas_id=canvas.id, created_by=current_user.id, **body.model_dump()
    )
    db.add(edge)
    await db.commit()
    await db.refresh(edge)
    return CanvasEdgeOut.model_validate(edge)


async def _link_tasks(
    db: AsyncSession,
    project_id: uuid.UUID,
    predecessor_id: uuid.UUID,
    successor_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    task_ids = [
        t
        for t in (
            await db.execute(select(Task.id).where(Task.project_id == project_id))
        ).scalars()
    ]
    if predecessor_id not in task_ids or successor_id not in task_ids:
        return
    known = set(task_ids)
    rows = (
        await db.execute(
            select(TaskDependency).where(TaskDependency.successor_id.in_(task_ids))
        )
    ).scalars()
    deps = [
        sched.DependencyIn(
            predecessor_id=d.predecessor_id, successor_id=d.successor_id,
            kind=d.kind, lag_days=d.lag_days,
        )
        for d in rows
        if d.predecessor_id in known
    ]
    if any(
        d.predecessor_id == predecessor_id and d.successor_id == successor_id
        for d in deps
    ):
        return
    if sched.would_create_cycle(deps, predecessor_id, successor_id):
        raise HTTPException(
            status_code=409,
            detail="That would make the tasks wait on each other in a loop.",
        )
    db.add(
        TaskDependency(
            predecessor_id=predecessor_id, successor_id=successor_id,
            kind="FS", lag_days=0, created_by=user_id,
        )
    )


@router.delete("/{project_id}/canvas/{canvas_id}/edges/{edge_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def delete_edge(
    canvas_id: uuid.UUID,
    edge_id: uuid.UUID,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
) -> None:
    canvas = await _get_canvas(db, project.id, canvas_id)
    edge = (
        await db.execute(
            select(CanvasEdge).where(
                CanvasEdge.id == edge_id, CanvasEdge.canvas_id == canvas.id
            )
        )
    ).scalar_one_or_none()
    if edge is None:
        raise HTTPException(status_code=404, detail="Link not found.")

    # Undo the schedule dependency the edge stood for, so the two views agree.
    tasks = await _task_ids_for(db, canvas.id, [edge.source_node_id, edge.target_node_id])
    pred_task = tasks.get(edge.source_node_id)
    succ_task = tasks.get(edge.target_node_id)
    if pred_task and succ_task:
        await db.execute(
            sa_delete(TaskDependency).where(
                TaskDependency.predecessor_id == pred_task,
                TaskDependency.successor_id == succ_task,
            )
        )
    await db.delete(edge)
    await db.commit()


# ── Resolve ───────────────────────────────────────────────────────────────────

@router.post("/{project_id}/canvas/{canvas_id}/resolve", response_model=ResolveResponse)
async def resolve_nodes(
    canvas_id: uuid.UUID,
    body: ResolveRequest,
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> ResolveResponse:
    """Live data for every reference node in one round trip.

    A 200-node canvas must not become 200 requests, so this batches by kind:
    one query per kind, never one per node.
    """
    canvas = await _get_canvas(db, project.id, canvas_id)
    query = select(CanvasNode).where(CanvasNode.canvas_id == canvas.id)
    if body.node_ids:
        query = query.where(CanvasNode.id.in_(body.node_ids))
    nodes = list((await db.execute(query)).scalars().all())

    by_kind: dict[str, list[CanvasNode]] = defaultdict(list)
    for node in nodes:
        if node.ref_id:
            by_kind[node.kind].append(node)

    items: list[ResolvedRef] = []

    def uuids(kind: str) -> dict[uuid.UUID, list[CanvasNode]]:
        out: dict[uuid.UUID, list[CanvasNode]] = defaultdict(list)
        for n in by_kind.get(kind, []):
            try:
                out[uuid.UUID(str(n.ref_id))].append(n)
            except (ValueError, TypeError):
                items.append(_gone(n))
        return out

    # Tasks
    wanted = uuids("task")
    if wanted:
        rows = (
            await db.execute(select(Task).where(Task.id.in_(list(wanted))))
        ).scalars()
        found = {t.id: t for t in rows}
        for ref, group in wanted.items():
            task = found.get(ref)
            for node in group:
                if task is None:
                    items.append(_gone(node))
                    continue
                status_value = getattr(task.status, "value", task.status)
                items.append(
                    ResolvedRef(
                        node_id=node.id, kind="task", ref_id=str(ref),
                        title=task.title, status=str(status_value),
                        subtitle=(
                            f"due {task.due_date.date().isoformat()}"
                            if task.due_date else ""
                        ),
                        state=_task_state(task),
                    )
                )

    # Knowledge base documents
    wanted = uuids("kb_doc")
    if wanted:
        rows = (
            await db.execute(select(Document).where(Document.id.in_(list(wanted))))
        ).scalars()
        found = {d.id: d for d in rows}
        for ref, group in wanted.items():
            doc = found.get(ref)
            for node in group:
                if doc is None:
                    items.append(_gone(node))
                    continue
                doc_status = str(getattr(doc.status, "value", doc.status))
                items.append(
                    ResolvedRef(
                        node_id=node.id, kind="kb_doc", ref_id=str(ref),
                        title=doc.title, status=doc_status,
                        state="warn" if doc_status not in ("ready", "indexed") else "ok",
                    )
                )

    # Budgets
    wanted = uuids("budget")
    if wanted:
        rows = (
            await db.execute(select(Budget).where(Budget.id.in_(list(wanted))))
        ).scalars()
        found = {b.id: b for b in rows}
        for ref, group in wanted.items():
            budget = found.get(ref)
            for node in group:
                if budget is None:
                    items.append(_gone(node))
                    continue
                items.append(
                    ResolvedRef(
                        node_id=node.id, kind="budget", ref_id=str(ref),
                        title=budget.title,
                        subtitle=(
                            f"allotment {budget.allotment:,.0f}"
                            if budget.allotment is not None else ""
                        ),
                    )
                )

    # Regulatory documents
    wanted = uuids("regulatory_doc")
    if wanted:
        rows = (
            await db.execute(
                select(RegulatoryDocument).where(RegulatoryDocument.id.in_(list(wanted)))
            )
        ).scalars()
        found = {r.id: r for r in rows}
        for ref, group in wanted.items():
            doc = found.get(ref)
            for node in group:
                if doc is None:
                    items.append(_gone(node))
                    continue
                items.append(
                    ResolvedRef(
                        node_id=node.id, kind="regulatory_doc", ref_id=str(ref),
                        title=doc.title,
                        status=str(getattr(doc.status, "value", doc.status)),
                    )
                )

    # Conversations
    wanted = uuids("conversation")
    if wanted:
        rows = (
            await db.execute(
                select(Conversation).where(Conversation.id.in_(list(wanted)))
            )
        ).scalars()
        found = {c.id: c for c in rows}
        for ref, group in wanted.items():
            convo = found.get(ref)
            for node in group:
                if convo is None:
                    items.append(_gone(node))
                    continue
                items.append(
                    ResolvedRef(
                        node_id=node.id, kind="conversation", ref_id=str(ref),
                        title=convo.title or "Untitled chat",
                    )
                )

    # Other projects
    wanted = uuids("project")
    if wanted:
        rows = (
            await db.execute(select(Project).where(Project.id.in_(list(wanted))))
        ).scalars()
        found = {p.id: p for p in rows}
        for ref, group in wanted.items():
            other = found.get(ref)
            for node in group:
                if other is None:
                    items.append(_gone(node))
                    continue
                items.append(
                    ResolvedRef(
                        node_id=node.id, kind="project", ref_id=str(ref),
                        title=other.name, status=other.status,
                    )
                )

    # Nested canvases
    wanted = uuids("canvas")
    if wanted:
        rows = (
            await db.execute(
                select(ProjectCanvas).where(ProjectCanvas.id.in_(list(wanted)))
            )
        ).scalars()
        found = {c.id: c for c in rows}
        for ref, group in wanted.items():
            other = found.get(ref)
            for node in group:
                if other is None:
                    items.append(_gone(node))
                    continue
                items.append(
                    ResolvedRef(
                        node_id=node.id, kind="canvas", ref_id=str(ref), title=other.name
                    )
                )

    # Bookmarked pages — matched on URL, which is what a website node stores.
    site_nodes = by_kind.get("website", [])
    if site_nodes:
        urls = [n.ref_id for n in site_nodes if n.ref_id]
        rows = (
            await db.execute(
                select(BrowserBookmark).where(BrowserBookmark.url.in_(urls))
            )
        ).scalars()
        titles = {b.url: b.title for b in rows}
        for node in site_nodes:
            items.append(
                ResolvedRef(
                    node_id=node.id, kind="website", ref_id=node.ref_id,
                    title=titles.get(node.ref_id or "", node.label or node.ref_id or ""),
                    subtitle=node.ref_id or "",
                )
            )

    return ResolveResponse(items=items)


def _gone(node: CanvasNode) -> ResolvedRef:
    return ResolvedRef(
        node_id=node.id, kind=node.kind, ref_id=node.ref_id,
        title=node.label or "Deleted", missing=True, state="gone",
    )


def _task_state(task: Task) -> str:
    status_value = str(getattr(task.status, "value", task.status))
    if status_value in ("done", "cancelled"):
        return "ok"
    if task.due_date and task.due_date < datetime.now(timezone.utc):
        return "late"
    return "ok"

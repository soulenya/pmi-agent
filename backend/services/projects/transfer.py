"""Packing a project up, and setting it down again in another database.

`build` reads a project out of the machine it lives on. `restore` writes one in,
minting fresh ids and rewriting every pointer as it goes. The two are used
together by promotion — local project out, hub project in — but they are
deliberately separate, because only `restore` ever runs on the hub.
"""

from __future__ import annotations

import logging
import secrets
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.canvas import CanvasEdge, CanvasNode, ProjectCanvas
from models.db.project_member import ProjectMember
from models.db.task import Project, Task
from models.db.user import User
from models.db.workroom import Workroom, WorkroomItem
from models.schemas.project_transfer import (
    CanvasBundle,
    CanvasEdgeBundle,
    CanvasNodeBundle,
    MemberBundle,
    PinBundle,
    ProjectBundle,
    ProjectImported,
    TaskBundle,
)
from services.auth.service import hash_password
from services.projects.access import ALLOWED_DOMAINS
from services.projects.workroom import ensure_workroom

logger = logging.getLogger(__name__)


async def build(
    db: AsyncSession, project: Project, visibility: str = "shared"
) -> ProjectBundle:
    """Read a whole project out of this database into a portable bundle."""
    tasks = list(
        (
            await db.execute(
                select(Task)
                .where(Task.project_id == project.id)
                .order_by(Task.sort_order.asc(), Task.created_at.asc())
            )
        ).scalars()
    )
    task_bundles = [
        TaskBundle(
            key=str(t.id),
            parent_key=str(t.parent_task_id) if t.parent_task_id else None,
            title=t.title,
            description=t.description,
            status=str(t.status),
            priority=str(t.priority),
            due_date=t.due_date,
            start_date=t.start_date,
            end_date=t.end_date,
            progress_pct=t.progress_pct,
            is_milestone=t.is_milestone,
            sort_order=t.sort_order,
            completed_at=t.completed_at,
            tags=list(t.tags or []),
            source_ref=t.source_ref,
        )
        for t in tasks
    ]
    # A parent left behind would orphan its children on arrival.
    known = {t.key for t in task_bundles}
    for t in task_bundles:
        if t.parent_key not in known:
            t.parent_key = None

    canvases: list[CanvasBundle] = []
    for canvas in (
        await db.execute(
            select(ProjectCanvas)
            .where(ProjectCanvas.project_id == project.id)
            .order_by(ProjectCanvas.created_at.asc())
        )
    ).scalars():
        nodes = list(
            (
                await db.execute(select(CanvasNode).where(CanvasNode.canvas_id == canvas.id))
            ).scalars()
        )
        node_keys = {str(n.id) for n in nodes}
        edges = list(
            (
                await db.execute(select(CanvasEdge).where(CanvasEdge.canvas_id == canvas.id))
            ).scalars()
        )
        canvases.append(
            CanvasBundle(
                name=canvas.name,
                viewport=canvas.viewport or {"x": 0, "y": 0, "zoom": 1},
                nodes=[
                    CanvasNodeBundle(
                        key=str(n.id),
                        parent_key=(
                            str(n.parent_node_id)
                            if n.parent_node_id and str(n.parent_node_id) in node_keys
                            else None
                        ),
                        kind=n.kind,
                        ref_id=n.ref_id,
                        label=n.label,
                        content=n.content,
                        x=n.x,
                        y=n.y,
                        width=n.width,
                        height=n.height,
                        z=n.z,
                        style=n.style or {},
                    )
                    for n in nodes
                ],
                edges=[
                    CanvasEdgeBundle(
                        source_key=str(e.source_node_id),
                        target_key=str(e.target_node_id),
                        source_handle=e.source_handle,
                        target_handle=e.target_handle,
                        kind=e.kind,
                        label=e.label,
                        style=e.style or {},
                    )
                    for e in edges
                    if str(e.source_node_id) in node_keys and str(e.target_node_id) in node_keys
                ],
            )
        )

    pins: list[PinBundle] = []
    room = (
        await db.execute(
            select(Workroom)
            .where(Workroom.project_id == project.id)
            .order_by(Workroom.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if room is not None:
        pins = [
            PinBundle(kind=i.kind, ref_id=i.ref_id, label=i.label)
            for i in (
                await db.execute(
                    select(WorkroomItem)
                    .where(WorkroomItem.workroom_id == room.id)
                    .order_by(WorkroomItem.created_at.asc())
                )
            ).scalars()
        ]

    members: list[MemberBundle] = []
    rows = (
        await db.execute(
            select(ProjectMember, User)
            .join(User, User.id == ProjectMember.user_id)
            .where(ProjectMember.project_id == project.id)
        )
    ).all()
    for member, user in rows:
        # The owner is granted on arrival by being the one who sent it.
        if member.role == "owner" or user.id == project.owner_id or not user.email:
            continue
        members.append(MemberBundle(email=user.email, role=member.role))

    return ProjectBundle(
        name=project.name,
        description=project.description,
        goal=project.goal or "",
        status=project.status,
        color=project.color,
        visibility="company" if visibility == "company" else "shared",
        start_date=project.start_date,
        target_date=project.target_date,
        tasks=task_bundles,
        canvases=canvases,
        pins=pins,
        members=members,
    )


async def _member_user(db: AsyncSession, email: str) -> User | None:
    """Find the account a role is being granted to, creating it dormant if need be.

    Same rule as adding someone by hand: an allowed address may be given a role
    before its owner has ever signed in. This grants a role, not a way in.
    """
    email = email.strip().lower()
    if email.rsplit("@", 1)[-1] not in ALLOWED_DOMAINS:
        return None
    user = (
        await db.execute(select(User).where(func.lower(User.email) == email))
    ).scalar_one_or_none()
    if user is None:
        user = User(
            email=email,
            display_name=email.split("@")[0],
            hashed_password=hash_password(secrets.token_urlsafe(32)),
            role="member",
            is_active=True,
            can_write_regulatory=True,
            onboarding_complete=False,
        )
        db.add(user)
        await db.flush()
    return user


async def restore(db: AsyncSession, owner: User, bundle: ProjectBundle) -> ProjectImported:
    """Write a bundle into this database as a new project owned by `owner`.

    Does not commit; the caller decides when the whole arrival is final.
    """
    project = Project(
        id=uuid.uuid4(),
        name=bundle.name,
        description=bundle.description,
        goal=bundle.goal,
        status=bundle.status,
        color=bundle.color,
        visibility=bundle.visibility,
        start_date=bundle.start_date,
        target_date=bundle.target_date,
        owner_id=owner.id,
        created_by=owner.id,
    )
    db.add(project)
    await db.flush()

    task_ids: dict[str, uuid.UUID] = {}
    for t in bundle.tasks:
        task = Task(
            id=uuid.uuid4(),
            project_id=project.id,
            title=t.title,
            description=t.description,
            status=t.status,
            priority=t.priority,
            due_date=t.due_date,
            start_date=t.start_date,
            end_date=t.end_date,
            progress_pct=t.progress_pct,
            is_milestone=t.is_milestone,
            sort_order=t.sort_order,
            completed_at=t.completed_at,
            tags=list(t.tags or []),
            source_ref=t.source_ref,
            created_by=owner.id,
        )
        task_ids[t.key] = task.id
        db.add(task)
    await db.flush()
    # Parents are set second, so a child listed before its parent still finds it.
    for t in bundle.tasks:
        if t.parent_key and t.parent_key in task_ids:
            await db.execute(
                Task.__table__.update()
                .where(Task.id == task_ids[t.key])
                .values(parent_task_id=task_ids[t.parent_key])
            )

    node_total = 0
    for cb in bundle.canvases:
        canvas = ProjectCanvas(
            id=uuid.uuid4(),
            project_id=project.id,
            name=cb.name,
            viewport=cb.viewport.model_dump(),
            created_by=owner.id,
        )
        db.add(canvas)
        await db.flush()

        node_ids: dict[str, uuid.UUID] = {}
        for n in cb.nodes:
            ref = n.ref_id
            # A task card points at a task that has just been renumbered.
            if n.kind == "task" and ref and ref in task_ids:
                ref = str(task_ids[ref])
            node = CanvasNode(
                id=uuid.uuid4(),
                canvas_id=canvas.id,
                kind=n.kind,
                ref_id=ref,
                label=n.label,
                content=n.content,
                x=n.x,
                y=n.y,
                width=n.width,
                height=n.height,
                z=n.z,
                style=n.style or {},
                created_by=owner.id,
            )
            node_ids[n.key] = node.id
            db.add(node)
        await db.flush()
        node_total += len(node_ids)

        for n in cb.nodes:
            if n.parent_key and n.parent_key in node_ids:
                await db.execute(
                    CanvasNode.__table__.update()
                    .where(CanvasNode.id == node_ids[n.key])
                    .values(parent_node_id=node_ids[n.parent_key])
                )

        seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
        for e in cb.edges:
            src, dst = node_ids.get(e.source_key), node_ids.get(e.target_key)
            # The table allows one edge per pair, and a rejected duplicate
            # would take the whole arrival down with it.
            if src is None or dst is None or (src, dst) in seen:
                continue
            seen.add((src, dst))
            db.add(
                CanvasEdge(
                    id=uuid.uuid4(),
                    canvas_id=canvas.id,
                    source_node_id=src,
                    target_node_id=dst,
                    source_handle=e.source_handle,
                    target_handle=e.target_handle,
                    kind=e.kind,
                    label=e.label,
                    style=e.style or {},
                )
            )

    pins = 0
    if bundle.pins:
        room = await ensure_workroom(db, project, owner.id)
        for p in bundle.pins:
            db.add(
                WorkroomItem(
                    id=uuid.uuid4(),
                    workroom_id=room.id,
                    kind=p.kind,
                    ref_id=p.ref_id,
                    label=p.label,
                )
            )
            pins += 1

    members = 0
    for m in bundle.members:
        user = await _member_user(db, str(m.email))
        if user is None or user.id == owner.id:
            continue
        db.add(
            ProjectMember(
                id=uuid.uuid4(), project_id=project.id, user_id=user.id, role=m.role
            )
        )
        members += 1

    await db.flush()
    return ProjectImported(
        project_id=str(project.id),
        tasks=len(task_ids),
        canvas_nodes=node_total,
        pins=pins,
        members=members,
    )

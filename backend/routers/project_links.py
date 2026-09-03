"""Links between projects, and the portfolio they form.

Creating a link needs editor rights on the project you are linking *from* and
at least viewer on the one you are linking *to* — you cannot wire your work to
something you are not allowed to know exists.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user, require_project_role
from models.db.project_link import ProjectLink
from models.db.task import Project, Task
from models.db.user import User
from models.schemas.tasks import (
    PortfolioEdge,
    PortfolioNode,
    PortfolioOut,
    ProjectLinkCreate,
    ProjectLinkOut,
    ProjectLinkUpdate,
)
from services.projects import links as link_svc
from services.projects.access import resolve_role, visible_project_ids
from services.projects.links import announce_closed_gates

router = APIRouter(prefix="/projects", tags=["projects"])
portfolio_router = APIRouter(prefix="/portfolio", tags=["projects"])

_OPEN_TASK_STATUSES = ("backlog", "todo", "in_progress", "in_review")


async def _task_titles(
    db: AsyncSession, task_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not task_ids:
        return {}
    rows = (
        await db.execute(select(Task.id, Task.title).where(Task.id.in_(list(task_ids))))
    ).all()
    return {tid: title for tid, title in rows}


async def _shape(
    db: AsyncSession,
    links: list[ProjectLink],
    project_id: uuid.UUID,
    visible: set[uuid.UUID],
) -> list[ProjectLinkOut]:
    other_ids = {
        link.to_project_id if link.from_project_id == project_id else link.from_project_id
        for link in links
    }
    readable = other_ids & visible
    names: dict[uuid.UUID, Project] = {}
    if readable:
        rows = (
            await db.execute(select(Project).where(Project.id.in_(list(readable))))
        ).scalars()
        names = {p.id: p for p in rows}
    titles = await _task_titles(db, {lk.gate_task_id for lk in links if lk.gate_task_id})

    out: list[ProjectLinkOut] = []
    for link in links:
        outward = link.from_project_id == project_id
        other_id = link.to_project_id if outward else link.from_project_id
        other = names.get(other_id)
        out.append(
            ProjectLinkOut(
                id=link.id,
                from_project_id=link.from_project_id,
                to_project_id=link.to_project_id,
                kind=link.kind,
                gate_task_id=link.gate_task_id,
                gate_task_title=titles.get(link.gate_task_id, "") if link.gate_task_id else "",
                note=link.note,
                status=link.status,
                satisfied_at=link.satisfied_at,
                other_project_id=other_id if other is not None else None,
                other_project_name=other.name if other is not None else "",
                other_project_status=other.status if other is not None else "",
                other_visible=other is not None,
                direction="out" if outward else "in",
                created_at=link.created_at,
            )
        )
    return out


@router.get("/{project_id}/links", response_model=list[ProjectLinkOut])
async def list_project_links(
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ProjectLinkOut]:
    links = await link_svc.links_for_project(db, project.id)
    closed = await link_svc.refresh_gates(db, links)
    if closed:
        await announce_closed_gates(db, closed)
        await db.commit()
    visible = set(await visible_project_ids(db, current_user.id))
    return await _shape(db, links, project.id, visible)


@router.post(
    "/{project_id}/links",
    response_model=ProjectLinkOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_link(
    body: ProjectLinkCreate,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectLinkOut:
    if body.to_project_id == project.id:
        raise HTTPException(status_code=400, detail="A project cannot link to itself.")

    other = (
        await db.execute(select(Project).where(Project.id == body.to_project_id))
    ).scalar_one_or_none()
    if other is None or await resolve_role(db, other, current_user.id) is None:
        raise HTTPException(status_code=404, detail="Project not found.")

    if body.gate_task_id is not None:
        await _check_gate_task(db, body.kind, body.gate_task_id, project.id, other.id)

    existing = await link_svc.all_links(db)
    loop = link_svc.cycle_path(existing, body.kind, project.id, body.to_project_id)
    if loop is not None:
        raise HTTPException(status_code=409, detail=await _loop_message(db, loop))

    link = ProjectLink(
        from_project_id=project.id,
        to_project_id=body.to_project_id,
        kind=body.kind,
        gate_task_id=body.gate_task_id,
        note=body.note,
        status="open",
        created_by=current_user.id,
    )
    db.add(link)
    await db.flush()
    await link_svc.refresh_gates(db, [link])
    await db.commit()
    await db.refresh(link)
    visible = set(await visible_project_ids(db, current_user.id))
    shaped = await _shape(db, [link], project.id, visible)
    return shaped[0]


@router.patch("/{project_id}/links/{link_id}", response_model=ProjectLinkOut)
async def update_project_link(
    link_id: uuid.UUID,
    body: ProjectLinkUpdate,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectLinkOut:
    link = await _own_link(db, link_id, project.id)
    updates = body.model_dump(exclude_unset=True)

    new_kind = updates.get("kind", link.kind)
    if new_kind != link.kind:
        existing = [
            lk for lk in await link_svc.all_links(db) if lk != _as_link_in(link)
        ]
        loop = link_svc.cycle_path(
            existing, new_kind, link.from_project_id, link.to_project_id
        )
        if loop is not None:
            raise HTTPException(status_code=409, detail=await _loop_message(db, loop))
        link.kind = new_kind

    if "gate_task_id" in updates:
        if updates["gate_task_id"] is not None:
            await _check_gate_task(
                db, new_kind, updates["gate_task_id"], link.from_project_id, link.to_project_id
            )
        link.gate_task_id = updates["gate_task_id"]
    if "note" in updates and updates["note"] is not None:
        link.note = updates["note"]
    if "status" in updates and updates["status"] is not None:
        link.status = updates["status"]
        link.satisfied_at = (
            datetime.now(timezone.utc) if updates["status"] == "satisfied" else None
        )

    await db.flush()
    if link.status != "waived":
        await link_svc.refresh_gates(db, [link])
    await db.commit()
    await db.refresh(link)
    visible = set(await visible_project_ids(db, current_user.id))
    shaped = await _shape(db, [link], project.id, visible)
    return shaped[0]


@router.delete(
    "/{project_id}/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_project_link(
    link_id: uuid.UUID,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
) -> None:
    link = await _own_link(db, link_id, project.id)
    await db.delete(link)
    await db.commit()


@portfolio_router.get("", response_model=PortfolioOut)
async def get_portfolio(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioOut:
    """Every project the viewer may see, and the links between them.

    A project they may not see is absent rather than greyed out, and a link
    pointing into one is returned dangling — the kind of relationship is not a
    secret, but the name of the project on the other end is.
    """
    visible = set(await visible_project_ids(db, current_user.id))
    if not visible:
        return PortfolioOut()

    projects = list(
        (
            await db.execute(
                select(Project)
                .where(Project.id.in_(list(visible)), Project.is_archived.is_(False))
                .order_by(Project.created_at)
            )
        ).scalars()
    )
    ids = [p.id for p in projects]
    if not ids:
        return PortfolioOut()

    open_counts = dict(
        (
            await db.execute(
                select(Task.project_id, func.count(Task.id))
                .where(Task.project_id.in_(ids), Task.status.in_(_OPEN_TASK_STATUSES))
                .group_by(Task.project_id)
            )
        ).all()
    )
    today = datetime.now(timezone.utc)
    late_counts = dict(
        (
            await db.execute(
                select(Task.project_id, func.count(Task.id))
                .where(
                    Task.project_id.in_(ids),
                    Task.status.in_(_OPEN_TASK_STATUSES),
                    Task.due_date.isnot(None),
                    Task.due_date < today,
                )
                .group_by(Task.project_id)
            )
        ).all()
    )

    milestones: dict[uuid.UUID, Task] = {}
    for task in (
        await db.execute(
            select(Task)
            .where(
                Task.project_id.in_(ids),
                Task.is_milestone.is_(True),
                Task.status.in_(_OPEN_TASK_STATUSES),
            )
            .order_by(Task.due_date.asc().nullslast())
        )
    ).scalars():
        if task.project_id is not None:
            milestones.setdefault(task.project_id, task)

    links = list(
        (
            await db.execute(
                select(ProjectLink).where(
                    or_(
                        ProjectLink.from_project_id.in_(ids),
                        ProjectLink.to_project_id.in_(ids),
                    )
                )
            )
        ).scalars()
    )
    closed = await link_svc.refresh_gates(db, links)
    if closed:
        await announce_closed_gates(db, closed)
        await db.commit()

    gate_counts: dict[uuid.UUID, int] = {}
    for link in links:
        if link.kind == "gates" and link.status == "open":
            gate_counts[link.to_project_id] = gate_counts.get(link.to_project_id, 0) + 1

    nodes = []
    for p in projects:
        milestone = milestones.get(p.id)
        nodes.append(
            PortfolioNode(
                id=p.id,
                name=p.name,
                status=p.status,
                color=p.color,
                goal=(p.goal or "")[:200],
                open_tasks=int(open_counts.get(p.id, 0)),
                late_tasks=int(late_counts.get(p.id, 0)),
                open_gates=gate_counts.get(p.id, 0),
                next_milestone=milestone.title if milestone else "",
                next_milestone_date=(
                    milestone.due_date.date()
                    if milestone is not None and milestone.due_date is not None
                    else None
                ),
            )
        )

    edges = [
        PortfolioEdge(
            id=link.id,
            from_project_id=link.from_project_id,
            to_project_id=link.to_project_id,
            kind=link.kind,
            status=link.status,
            note=link.note,
            dangling=link.from_project_id not in visible or link.to_project_id not in visible,
        )
        for link in links
    ]
    return PortfolioOut(projects=nodes, links=edges)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _as_link_in(link: ProjectLink) -> link_svc.LinkIn:
    return link_svc.LinkIn(
        from_project_id=link.from_project_id,
        to_project_id=link.to_project_id,
        kind=link.kind,
    )


async def _own_link(
    db: AsyncSession, link_id: uuid.UUID, project_id: uuid.UUID
) -> ProjectLink:
    link = (
        await db.execute(select(ProjectLink).where(ProjectLink.id == link_id))
    ).scalar_one_or_none()
    if link is None or project_id not in (link.from_project_id, link.to_project_id):
        raise HTTPException(status_code=404, detail="Link not found.")
    return link


async def _check_gate_task(
    db: AsyncSession,
    kind: str,
    task_id: uuid.UUID,
    from_project_id: uuid.UUID,
    to_project_id: uuid.UUID,
) -> None:
    """A gate's condition has to be a milestone in the project doing the gating."""
    if kind != "gates":
        raise HTTPException(
            status_code=400,
            detail="Only a gate link has a condition. Change the kind to 'gates' first.",
        )
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if task is None or task.project_id != from_project_id:
        raise HTTPException(
            status_code=400,
            detail="The gate task has to be a task in the project doing the gating.",
        )
    if not task.is_milestone:
        raise HTTPException(
            status_code=400,
            detail=f"\"{task.title}\" is not a milestone. Mark it as one, or pick another.",
        )


async def _loop_message(db: AsyncSession, path: list[uuid.UUID]) -> str:
    """Name the projects in the loop rather than just refusing."""
    rows = (
        await db.execute(select(Project.id, Project.name).where(Project.id.in_(path)))
    ).all()
    names = {pid: name for pid, name in rows}
    chain = " → ".join(names.get(pid, "a project you cannot see") for pid in path)
    return f"That would make these projects wait on each other: {chain}."

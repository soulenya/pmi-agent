"""Tasks and Projects REST API."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user, require_project_role
from models.db.task import Project, Task, TaskDependency
from models.db.user import User
from models.schemas.tasks import (
    DependencyCreate,
    DependencyOut,
    GateOut,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    ReorderRequest,
    ScheduleOut,
    TaskCommentCreate,
    TaskCommentOut,
    TaskCreate,
    TaskOut,
    TaskUpdate,
    TimelineOut,
)
from repositories.task_repo import ProjectRepository, TaskRepository
from services.projects import custody, links as link_svc, schedule as sched
from services.projects.access import resolve_role, visible_project_ids
from services.projects.links import announce_closed_gates
from services.projects.workroom import ensure_workroom

router = APIRouter(prefix="/tasks", tags=["tasks"])
projects_router = APIRouter(prefix="/projects", tags=["projects"])


# ── Projects ──────────────────────────────────────────────────────────────────

@projects_router.get("", response_model=list[ProjectOut])
async def list_projects(
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ProjectOut]:
    repo = ProjectRepository(db)
    projects = await repo.list(
        include_archived=include_archived, visible_to=current_user.id
    )
    return [ProjectOut.model_validate(p) for p in projects]


@projects_router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectOut:
    repo = ProjectRepository(db)
    project = await repo.create(created_by=current_user.id, **body.model_dump())
    await ensure_workroom(db, project, current_user.id)
    await db.commit()
    return ProjectOut.model_validate(project)


@projects_router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project: Project = Depends(require_project_role("viewer")),
) -> ProjectOut:
    return ProjectOut.model_validate(project)


@projects_router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    body: ProjectUpdate,
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectOut:
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    new_visibility = updates.get("visibility")
    if new_visibility is not None and new_visibility != project.visibility:
        # Widening who can see a project is an owner's call, not an editor's.
        role = await resolve_role(db, project, current_user.id)
        if role != "owner":
            raise HTTPException(
                status_code=403, detail="Only the owner can change who can see a project."
            )
    if updates.get("is_archived") is True and project.archived_at is None:
        updates["archived_at"] = datetime.now(timezone.utc)
    updated = await ProjectRepository(db).update(project.id, **updates)
    await db.commit()
    return ProjectOut.model_validate(updated)


# ── Tasks ─────────────────────────────────────────────────────────────────────
async def _project_tasks(db: AsyncSession, project_id: uuid.UUID) -> list[Task]:
    result = await db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .order_by(Task.sort_order, Task.created_at)
    )
    return list(result.scalars().all())


async def _project_dependencies(
    db: AsyncSession, task_ids: list[uuid.UUID]
) -> list[TaskDependency]:
    if not task_ids:
        return []
    result = await db.execute(
        select(TaskDependency).where(TaskDependency.successor_id.in_(task_ids))
    )
    # Both ends must be in this project, or the chart would reference a bar it
    # is not drawing.
    known = set(task_ids)
    return [d for d in result.scalars().all() if d.predecessor_id in known]


def _as_date(value: datetime | None) -> date | None:
    return value.date() if value is not None else None


def _to_schedule_inputs(
    tasks: list[Task], deps: list[TaskDependency]
) -> tuple[list[sched.TaskIn], list[sched.DependencyIn]]:
    task_in = [
        sched.TaskIn(
            id=t.id,
            start_date=_as_date(t.start_date),
            end_date=_as_date(t.end_date),
            due_date=_as_date(t.due_date),
            is_milestone=t.is_milestone,
            progress_pct=t.progress_pct,
        )
        for t in tasks
    ]
    dep_in = [
        sched.DependencyIn(
            predecessor_id=d.predecessor_id,
            successor_id=d.successor_id,
            kind=d.kind,
            lag_days=d.lag_days,
        )
        for d in deps
    ]
    return task_in, dep_in


async def _project_gates(
    db: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[list[GateOut], list[sched.GateIn]]:
    """The gates this project waits on, drawn from the linked projects' milestones.

    The gate is on your own timeline, so you always see that it is there. The
    name of the project holding it is only filled in if you can see that
    project.
    """
    gate_links = await link_svc.gates_into(db, project_id)
    if not gate_links:
        return [], []
    closed = await link_svc.refresh_gates(db, gate_links)
    if closed:
        await announce_closed_gates(db, closed)
        await db.commit()

    task_ids = [lk.gate_task_id for lk in gate_links if lk.gate_task_id]
    milestones = {}
    if task_ids:
        rows = (await db.execute(select(Task).where(Task.id.in_(task_ids)))).scalars()
        milestones = {t.id: t for t in rows}
    visible = set(await visible_project_ids(db, user_id))
    upstream_ids = {lk.from_project_id for lk in gate_links} & visible
    upstream = {}
    if upstream_ids:
        rows = (
            await db.execute(select(Project).where(Project.id.in_(list(upstream_ids))))
        ).scalars()
        upstream = {p.id: p for p in rows}

    out: list[GateOut] = []
    inputs: list[sched.GateIn] = []
    for link in gate_links:
        milestone = milestones.get(link.gate_task_id) if link.gate_task_id else None
        opens_on = link_svc.gate_date(milestone)
        known = link.from_project_id in upstream
        out.append(
            GateOut(
                link_id=link.id,
                from_project_id=link.from_project_id,
                from_project_name=(
                    upstream[link.from_project_id].name if known else "another project"
                ),
                gate_task_id=link.gate_task_id if known else None,
                gate_task_title=(
                    milestone.title if known and milestone is not None else ""
                ),
                opens_on=opens_on,
                status=link.status,
                note=link.note if known else "",
            )
        )
        inputs.append(
            sched.GateIn(id=link.id, opens_on=opens_on, is_open=link.status == "open")
        )
    return out, inputs


@projects_router.get("/{project_id}/timeline", response_model=TimelineOut)
async def get_project_timeline(
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TimelineOut:
    """Tasks, dependencies, gates and the computed schedule in one payload."""
    tasks = await _project_tasks(db, project.id)
    deps = await _project_dependencies(db, [t.id for t in tasks])
    task_in, dep_in = _to_schedule_inputs(tasks, deps)
    gates, gate_in = await _project_gates(db, project.id, current_user.id)
    try:
        computed = sched.schedule(
            task_in, dep_in, today=datetime.now(timezone.utc).date(), gates=gate_in
        )
    except sched.CycleError:
        # Stored data should never loop, but a chart that cannot be drawn is
        # better than a request that hangs.
        computed = {}
    role = await resolve_role(db, project, current_user.id)
    return TimelineOut(
        project_id=project.id,
        tasks=[TaskOut.model_validate(t) for t in tasks],
        dependencies=[DependencyOut.model_validate(d) for d in deps],
        schedule=[
            ScheduleOut(
                task_id=s.id,
                early_start=s.early_start,
                early_finish=s.early_finish,
                late_start=s.late_start,
                late_finish=s.late_finish,
                slack_days=s.slack_days,
                is_critical=s.is_critical,
                is_late=s.is_late,
                blocked_by_gate=s.blocked_by_gate,
            )
            for s in computed.values()
        ],
        gates=gates,
        my_role=role or "viewer",
    )

async def _visible_task(
    db: AsyncSession, task_id: uuid.UUID, user: User
) -> Task:
    """A task the user may act on, or 404.

    Mirrors what ``TaskRepository.list`` will return: your own tasks, tasks
    assigned to you, and tasks in a project you can see. 404 rather than 403 so
    the response doesn't confirm that someone else's task id exists.
    """
    task = await TaskRepository(db).get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")
    if task.created_by == user.id or task.assignee_id == user.id:
        return task
    if task.project_id is not None:
        project = await ProjectRepository(db).get(task.project_id)
        if project is not None and await resolve_role(db, project, user.id):
            return task
    raise HTTPException(status_code=404, detail="Task not found.")


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    project_id: uuid.UUID | None = Query(None),
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TaskOut]:
    repo = TaskRepository(db)
    if project_id is not None:
        project = await ProjectRepository(db).get(project_id)
        if project is None or not await resolve_role(db, project, current_user.id):
            raise HTTPException(status_code=404, detail="Project not found.")
    tasks = await repo.list(
        user_id=current_user.id,
        project_id=project_id,
        status=status,
    )
    return [TaskOut.model_validate(t) for t in tasks]


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskOut:
    repo = TaskRepository(db)
    task = await repo.create(created_by=current_user.id, **body.model_dump())
    if task.project_id is not None:
        project = await ProjectRepository(db).get(task.project_id)
        if project is None or not await resolve_role(db, project, current_user.id):
            raise HTTPException(status_code=404, detail="Project not found.")
        await custody.take(db, project, "task", task.id, current_user.id)
    await db.commit()
    return TaskOut.model_validate(task)


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskOut:
    task = await _visible_task(db, task_id, current_user)
    return TaskOut.model_validate(task)


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskOut:
    await _visible_task(db, task_id, current_user)
    held = await custody.assert_may_change(db, "task", task_id, current_user.id)
    repo = TaskRepository(db)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "project_id" in updates:
        custody.assert_stays_put(held, updates["project_id"])
        # Moving work into a shared project makes it that project's, or anyone
        # could park something there and quietly take it back.
        if held is None and updates["project_id"] is not None:
            target = await ProjectRepository(db).get(updates["project_id"])
            if target is None or not await resolve_role(db, target, current_user.id):
                raise HTTPException(status_code=404, detail="Project not found.")
            await custody.take(db, target, "task", task_id, current_user.id)
    task = await repo.update(task_id, **updates)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")
    if task.is_milestone:
        # Finishing a milestone is what closes a gate somewhere downstream.
        await announce_closed_gates(
            db, await link_svc.refresh_gates(db, await link_svc.gates_on_task(db, task.id))
        )
    await db.commit()
    return TaskOut.model_validate(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await _visible_task(db, task_id, current_user)
    await custody.assert_may_change(db, "task", task_id, current_user.id)
    repo = TaskRepository(db)
    deleted = await repo.delete(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found.")
    await db.commit()


# ── Dependencies and ordering ─────────────────────────────────────────────────

@router.post(
    "/{task_id}/dependencies",
    response_model=DependencyOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_dependency(
    task_id: uuid.UUID,
    body: DependencyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DependencyOut:
    """Make `task_id` wait on `predecessor_id`."""
    successor = await _visible_task(db, task_id, current_user)
    predecessor = await _visible_task(db, body.predecessor_id, current_user)
    await custody.assert_may_change(db, "task", task_id, current_user.id)

    if successor.project_id is None or successor.project_id != predecessor.project_id:
        raise HTTPException(
            status_code=400,
            detail="Both tasks must be in the same project to depend on each other.",
        )

    tasks = await _project_tasks(db, successor.project_id)
    existing = await _project_dependencies(db, [t.id for t in tasks])
    _, dep_in = _to_schedule_inputs(tasks, existing)
    if sched.would_create_cycle(dep_in, predecessor.id, successor.id):
        raise HTTPException(
            status_code=409,
            detail="That would make the tasks wait on each other in a loop.",
        )

    dependency = TaskDependency(
        id=uuid.uuid4(),
        predecessor_id=predecessor.id,
        successor_id=successor.id,
        kind=body.kind,
        lag_days=body.lag_days,
        created_by=current_user.id,
    )
    db.add(dependency)
    await db.commit()
    await db.refresh(dependency)
    return DependencyOut.model_validate(dependency)


@router.delete(
    "/{task_id}/dependencies/{predecessor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_dependency(
    task_id: uuid.UUID,
    predecessor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await _visible_task(db, task_id, current_user)
    await custody.assert_may_change(db, "task", task_id, current_user.id)
    result = await db.execute(
        sa_delete(TaskDependency).where(
            TaskDependency.successor_id == task_id,
            TaskDependency.predecessor_id == predecessor_id,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Dependency not found.")
    await db.commit()


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_tasks(
    body: ReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    repo = TaskRepository(db)
    for item in body.items:
        await _visible_task(db, item.task_id, current_user)
        await custody.assert_may_change(db, "task", item.task_id, current_user.id)
        await repo.update(item.task_id, sort_order=item.sort_order)
    await db.commit()


# ── Task comments ─────────────────────────────────────────────────────────────

@router.get("/{task_id}/comments", response_model=list[TaskCommentOut])
async def list_comments(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TaskCommentOut]:
    await _visible_task(db, task_id, current_user)
    repo = TaskRepository(db)
    comments = await repo.list_comments(task_id)
    return [TaskCommentOut.model_validate(c) for c in comments]


@router.post(
    "/{task_id}/comments",
    response_model=TaskCommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_comment(
    task_id: uuid.UUID,
    body: TaskCommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskCommentOut:
    await _visible_task(db, task_id, current_user)
    task_repo = TaskRepository(db)
    comment = await task_repo.add_comment(task_id, current_user.id, body.content)
    await db.commit()
    return TaskCommentOut.model_validate(comment)


# ── Attachments ───────────────────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel


class AttachmentAdd(_BaseModel):
    name: str
    url: str
    source: str = "upload"   # "upload" | "drive"
    drive_file_id: str | None = None


@router.post("/{task_id}/attachments", response_model=TaskOut)
async def add_attachment(
    task_id: uuid.UUID,
    body: AttachmentAdd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskOut:
    task = await _visible_task(db, task_id, current_user)
    att = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "url": body.url,
        "source": body.source,
    }
    if body.drive_file_id:
        att["drive_file_id"] = body.drive_file_id
    task.attachments = (task.attachments or []) + [att]
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(task, "attachments")
    await db.commit()
    await db.refresh(task)
    return TaskOut.model_validate(task)


@router.delete("/{task_id}/attachments/{attachment_id}", response_model=TaskOut)
async def remove_attachment(
    task_id: uuid.UUID,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskOut:
    task = await _visible_task(db, task_id, current_user)
    task.attachments = [a for a in (task.attachments or []) if a.get("id") != attachment_id]
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(task, "attachments")
    await db.commit()
    await db.refresh(task)
    return TaskOut.model_validate(task)

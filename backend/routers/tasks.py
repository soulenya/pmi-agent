"""Tasks and Projects REST API."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user, require_project_role
from models.db.task import Project, Task
from models.db.user import User
from models.schemas.tasks import (
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    TaskCommentCreate,
    TaskCommentOut,
    TaskCreate,
    TaskOut,
    TaskUpdate,
)
from repositories.task_repo import ProjectRepository, TaskRepository
from services.projects.access import resolve_role

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
    repo = TaskRepository(db)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    task = await repo.update(task_id, **updates)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")
    await db.commit()
    return TaskOut.model_validate(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await _visible_task(db, task_id, current_user)
    repo = TaskRepository(db)
    deleted = await repo.delete(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found.")
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

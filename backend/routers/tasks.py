"""Tasks and Projects REST API."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
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
    projects = await repo.list(include_archived=include_archived)
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
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectOut:
    repo = ProjectRepository(db)
    project = await repo.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ProjectOut.model_validate(project)


@projects_router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectOut:
    repo = ProjectRepository(db)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    project = await repo.update(project_id, **updates)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    await db.commit()
    return ProjectOut.model_validate(project)


# ── Tasks ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[TaskOut])
async def list_tasks(
    project_id: uuid.UUID | None = Query(None),
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TaskOut]:
    repo = TaskRepository(db)
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
    repo = TaskRepository(db)
    task = await repo.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")
    return TaskOut.model_validate(task)


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskOut:
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
    task_repo = TaskRepository(db)
    if await task_repo.get(task_id) is None:
        raise HTTPException(status_code=404, detail="Task not found.")
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
    from sqlalchemy import select
    from models.db.task import Task
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
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
    from sqlalchemy import select
    from models.db.task import Task
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    task.attachments = [a for a in (task.attachments or []) if a.get("id") != attachment_id]
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(task, "attachments")
    await db.commit()
    await db.refresh(task)
    return TaskOut.model_validate(task)

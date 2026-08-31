"""Repositories for Project, Task, and TaskComment."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_member import ProjectMember
from models.db.task import Project, Task, TaskComment


class ProjectRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(
        self,
        *,
        include_archived: bool = False,
        visible_to: uuid.UUID | None = None,
    ) -> list[Project]:
        stmt = select(Project).order_by(Project.created_at.desc())
        if not include_archived:
            stmt = stmt.where(Project.is_archived == False)  # noqa: E712
        if visible_to is not None:
            member = select(ProjectMember.id).where(
                ProjectMember.project_id == Project.id,
                ProjectMember.user_id == visible_to,
            )
            stmt = stmt.where(
                member.exists()
                | (Project.owner_id == visible_to)
                | (Project.created_by == visible_to)
                | (Project.visibility == "company")
            )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, project_id: uuid.UUID) -> Project | None:
        result = await self.session.execute(
            select(Project).where(Project.id == project_id)
        )
        return result.scalar_one_or_none()

    async def create(self, *, created_by: uuid.UUID, **fields: Any) -> Project:
        project = Project(id=uuid.uuid4(), created_by=created_by, owner_id=created_by, **fields)
        self.session.add(project)
        self.session.add(
            ProjectMember(
                id=uuid.uuid4(), project_id=project.id, user_id=created_by, role="owner"
            )
        )
        await self.session.flush()
        await self.session.refresh(project)
        return project

    async def update(self, project_id: uuid.UUID, **fields: Any) -> Project | None:
        project = await self.get(project_id)
        if project is None:
            return None
        for key, val in fields.items():
            if val is not None or key in ("description", "color"):
                setattr(project, key, val)
        await self.session.flush()
        await self.session.refresh(project)
        return project

    async def delete(self, project_id: uuid.UUID) -> bool:
        project = await self.get(project_id)
        if project is None:
            return False
        await self.session.delete(project)
        return True


class TaskRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(
        self,
        *,
        user_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
        status: str | None = None,
    ) -> list[Task]:
        stmt = select(Task).order_by(Task.created_at.desc())
        if project_id is not None:
            stmt = stmt.where(Task.project_id == project_id)
        if status is not None:
            stmt = stmt.where(Task.status == status)
        # If no project filter, show tasks created by or assigned to user
        if project_id is None and user_id is not None:
            from sqlalchemy import or_
            stmt = stmt.where(
                or_(Task.created_by == user_id, Task.assignee_id == user_id)
            )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, task_id: uuid.UUID) -> Task | None:
        result = await self.session.execute(
            select(Task).where(Task.id == task_id)
        )
        return result.scalar_one_or_none()

    async def create(self, *, created_by: uuid.UUID, **fields: Any) -> Task:
        task = Task(id=uuid.uuid4(), created_by=created_by, **fields)
        self.session.add(task)
        await self.session.flush()
        await self.session.refresh(task)
        return task

    async def update(self, task_id: uuid.UUID, **fields: Any) -> Task | None:
        task = await self.get(task_id)
        if task is None:
            return None
        for key, val in fields.items():
            setattr(task, key, val)
        # Auto-set completed_at
        if fields.get("status") == "done" and task.completed_at is None:
            task.completed_at = datetime.now(timezone.utc)
        await self.session.flush()
        await self.session.refresh(task)
        return task

    async def delete(self, task_id: uuid.UUID) -> bool:
        task = await self.get(task_id)
        if task is None:
            return False
        await self.session.delete(task)
        return True

    async def list_comments(self, task_id: uuid.UUID) -> list[TaskComment]:
        result = await self.session.execute(
            select(TaskComment)
            .where(TaskComment.task_id == task_id)
            .order_by(TaskComment.created_at.asc())
        )
        return list(result.scalars().all())

    async def add_comment(
        self, task_id: uuid.UUID, author_id: uuid.UUID, content: str
    ) -> TaskComment:
        comment = TaskComment(
            id=uuid.uuid4(),
            task_id=task_id,
            author_id=author_id,
            content=content,
        )
        self.session.add(comment)
        await self.session.flush()
        await self.session.refresh(comment)
        return comment

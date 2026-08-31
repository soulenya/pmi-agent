"""The project space — one call that returns everything a project page needs.

A project is the container: its workroom (Gerry's side of it), its tasks, its
pinned material and its people. The page opens on one request, not six.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user, require_project_role
from models.db.project_member import ProjectMember
from models.db.task import Project, Task
from models.db.user import User
from models.db.workroom import Workroom, WorkroomItem, WorkroomJournalEntry
from models.schemas.tasks import ProjectOut
from services.projects.access import resolve_role

router = APIRouter(prefix="/projects", tags=["projects"])

_OPEN_TASK_STATUSES = ("backlog", "todo", "in_progress", "in_review")


class WorkroomBrief(BaseModel):
    id: uuid.UUID
    title: str
    conversation_id: uuid.UUID | None


class MemberOut(BaseModel):
    user_id: uuid.UUID
    email: str | None = None
    display_name: str | None = None
    role: str


class ProjectSpaceOut(BaseModel):
    project: ProjectOut
    my_role: str
    workroom: WorkroomBrief | None
    members: list[MemberOut]
    counts: dict[str, int]


async def _scalar(db: AsyncSession, stmt) -> int:
    return int((await db.execute(stmt)).scalar() or 0)


@router.get("/{project_id}/space", response_model=ProjectSpaceOut)
async def get_project_space(
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectSpaceOut:
    room = (
        await db.execute(
            select(Workroom)
            .where(Workroom.project_id == project.id)
            .order_by(Workroom.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()

    tasks_total = await _scalar(
        db, select(func.count(Task.id)).where(Task.project_id == project.id)
    )
    tasks_open = await _scalar(
        db,
        select(func.count(Task.id)).where(
            Task.project_id == project.id, Task.status.in_(_OPEN_TASK_STATUSES)
        ),
    )
    items = journal = 0
    if room is not None:
        items = await _scalar(
            db,
            select(func.count(WorkroomItem.id)).where(WorkroomItem.workroom_id == room.id),
        )
        journal = await _scalar(
            db,
            select(func.count(WorkroomJournalEntry.id)).where(
                WorkroomJournalEntry.workroom_id == room.id
            ),
        )

    member_rows = (
        await db.execute(
            select(ProjectMember, User)
            .outerjoin(User, User.id == ProjectMember.user_id)
            .where(ProjectMember.project_id == project.id)
            .order_by(ProjectMember.created_at.asc())
        )
    ).all()
    members = [
        MemberOut(
            user_id=m.user_id,
            email=getattr(u, "email", None),
            display_name=getattr(u, "display_name", None),
            role=m.role,
        )
        for m, u in member_rows
    ]

    my_role = await resolve_role(db, project, current_user.id) or "viewer"

    return ProjectSpaceOut(
        project=ProjectOut.model_validate(project),
        my_role=my_role,
        workroom=(
            WorkroomBrief(id=room.id, title=room.title, conversation_id=room.conversation_id)
            if room is not None
            else None
        ),
        members=members,
        counts={
            "tasks_total": tasks_total,
            "tasks_open": tasks_open,
            "items": items,
            "journal": journal,
            "members": len(members),
        },
    )


@router.post("/{project_id}/workroom", response_model=WorkroomBrief)
async def ensure_project_workroom(
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkroomBrief:
    """Return the project's workroom, creating it on first use."""
    room = (
        await db.execute(
            select(Workroom)
            .where(Workroom.project_id == project.id)
            .order_by(Workroom.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if room is None:
        room = Workroom(
            id=uuid.uuid4(),
            user_id=current_user.id,
            project_id=project.id,
            title=project.name[:200],
            goal=project.goal or "",
        )
        db.add(room)
        await db.commit()
        await db.refresh(room)
    return WorkroomBrief(id=room.id, title=room.title, conversation_id=room.conversation_id)

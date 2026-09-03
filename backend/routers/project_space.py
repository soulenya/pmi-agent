"""The project space — one call that returns everything a project page needs.

A project is the container: its workroom (Gerry's side of it), its tasks, its
pinned material and its people. The page opens on one request, not six.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user, require_project_role
from models.db.budget import Budget
from models.db.project_custody import CUSTODY_ITEM_TYPES, ProjectItemCustody
from models.db.project_member import ProjectMember
from models.db.task import Project, Task
from models.db.user import User
from models.db.workroom import Workroom, WorkroomItem, WorkroomJournalEntry
from models.schemas.tasks import ProjectOut
from services.auth.service import hash_password
from services.projects import custody
from services.projects.access import ALLOWED_DOMAINS, resolve_role
from services.projects.workroom import ensure_workroom

logger = logging.getLogger(__name__)

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


# The owner is not assignable: ownership moves by a different act than sharing.
AssignableRole = Literal["viewer", "commenter", "editor"]


class MemberAdd(BaseModel):
    email: EmailStr
    role: AssignableRole = "editor"


class MemberUpdate(BaseModel):
    role: AssignableRole


class HeldItemOut(BaseModel):
    item_type: str
    item_id: uuid.UUID
    label: str | None = None
    since: datetime


class ReleaseRequest(BaseModel):
    note: str | None = None


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


# ── Budgets ───────────────────────────────────────────────────────────────────

class ProjectBudgetOut(BaseModel):
    id: uuid.UUID
    title: str
    currency: str
    allotment: float | None
    drive_url: str
    cached_summary: dict
    cached_at: datetime | None
    is_mine: bool


@router.get("/{project_id}/budgets", response_model=list[ProjectBudgetOut])
async def list_project_budgets(
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ProjectBudgetOut]:
    """The budgets attached to this project.

    Everyone on the project sees the figures. Only the person who linked the
    sheet can change it: the numbers belong to the project, the sheet on Drive
    still belongs to them.
    """
    rows = (
        await db.execute(
            select(Budget)
            .where(Budget.project_id == project.id)
            .order_by(Budget.title)
        )
    ).scalars()
    return [
        ProjectBudgetOut(
            id=b.id,
            title=b.title,
            currency=b.currency,
            allotment=float(b.allotment) if b.allotment is not None else None,
            drive_url=b.drive_url,
            cached_summary=b.cached_summary or {},
            cached_at=b.cached_at,
            is_mine=b.user_id == current_user.id,
        )
        for b in rows
    ]


# ── People ────────────────────────────────────────────────────────────────────

async def _require_owner(db: AsyncSession, project: Project, user_id: uuid.UUID) -> None:
    if await resolve_role(db, project, user_id) != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the owner can decide who is on a project.",
        )


async def _member_out(db: AsyncSession, member: ProjectMember) -> MemberOut:
    user = (
        await db.execute(select(User).where(User.id == member.user_id))
    ).scalar_one_or_none()
    return MemberOut(
        user_id=member.user_id,
        email=getattr(user, "email", None),
        display_name=getattr(user, "display_name", None),
        role=member.role,
    )


async def _notify_added(db: AsyncSession, project: Project, user_id: uuid.UUID, role: str) -> None:
    """Tell someone they have been put on a project. Never raises."""
    try:
        from models.db.enums import NotificationType
        from repositories.conversation_repo import NotificationRepository

        await NotificationRepository(db).create(
            user_id=user_id,
            type=NotificationType.SYSTEM_ALERT.value,
            title=f"You were added to {project.name}",
            message=f"You can now open {project.name} as {role}.",
            entity_type="project",
            entity_id=project.id,
        )
    except Exception:  # noqa: BLE001 — a missed notification must not fail the write
        logger.exception("Failed to announce project membership")


@router.post(
    "/{project_id}/members",
    response_model=MemberOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_project_member(
    body: MemberAdd,
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MemberOut:
    """Put someone on a project by email address.

    The person does not have to have signed in yet. If their address is on an
    allowed domain we create the account here, dormant, so that the role is
    already waiting the first time they arrive. Identity is still checked at
    sign-in — this grants a role, not a way in.
    """
    await _require_owner(db, project, current_user.id)

    email = body.email.strip().lower()
    domain = email.rsplit("@", 1)[-1] if "@" in email else ""
    if domain not in ALLOWED_DOMAINS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{email}' is not on an address this workspace recognises.",
        )

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

    existing = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{email} is already on this project.",
        )

    member = ProjectMember(
        id=uuid.uuid4(), project_id=project.id, user_id=user.id, role=body.role
    )
    db.add(member)

    # A project nobody else can see is not shared by adding people to it.
    if project.visibility == "private":
        project.visibility = "shared"

    await _notify_added(db, project, user.id, body.role)
    await db.commit()
    await db.refresh(member)
    return await _member_out(db, member)


@router.patch("/{project_id}/members/{user_id}", response_model=MemberOut)
async def update_project_member(
    user_id: uuid.UUID,
    body: MemberUpdate,
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MemberOut:
    await _require_owner(db, project, current_user.id)

    member = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="That person is not on this project.")
    if member.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The owner's role cannot be changed here.",
        )

    member.role = body.role
    await db.commit()
    await db.refresh(member)
    return await _member_out(db, member)


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project_member(
    user_id: uuid.UUID,
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await _require_owner(db, project, current_user.id)

    member = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        return
    if member.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A project cannot be left without its owner.",
        )
    await db.delete(member)
    await db.commit()


@router.post("/{project_id}/workroom", response_model=WorkroomBrief)
async def ensure_project_workroom(
    project: Project = Depends(require_project_role("editor")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkroomBrief:
    """Return the project's workroom, creating it on first use."""
    room = await ensure_workroom(db, project, current_user.id)
    await db.commit()
    await db.refresh(room)
    return WorkroomBrief(id=room.id, title=room.title, conversation_id=room.conversation_id)


# ── Custody ───────────────────────────────────────────────────────────────────

@router.get("/{project_id}/held", response_model=list[HeldItemOut])
async def list_held_items(
    project: Project = Depends(require_project_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> list[HeldItemOut]:
    """What this project is holding, so the page can say so plainly."""
    rows = (
        await db.execute(
            select(ProjectItemCustody)
            .where(
                ProjectItemCustody.project_id == project.id,
                ProjectItemCustody.released_at.is_(None),
            )
            .order_by(ProjectItemCustody.created_at.asc())
        )
    ).scalars().all()

    task_ids = [r.item_id for r in rows if r.item_type == "task"]
    titles: dict[uuid.UUID, str] = {}
    if task_ids:
        titles = {
            t.id: t.title
            for t in (
                await db.execute(select(Task).where(Task.id.in_(task_ids)))
            ).scalars()
        }
    return [
        HeldItemOut(
            item_type=r.item_type,
            item_id=r.item_id,
            label=titles.get(r.item_id),
            since=r.created_at,
        )
        for r in rows
    ]


@router.post("/{project_id}/held/{item_type}/{item_id}/release", status_code=204)
async def release_held_item(
    item_type: str,
    item_id: uuid.UUID,
    body: ReleaseRequest | None = None,
    project: Project = Depends(require_project_role("owner")),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Let an item out of the project. Only an owner can give the work away."""
    if item_type not in CUSTODY_ITEM_TYPES:
        raise HTTPException(status_code=404, detail="Nothing like that is held here.")
    held = await custody.holder(db, item_type, item_id)
    if held is None or held.project_id != project.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This project is not holding that.",
        )
    await custody.release(db, held, current_user.id, (body.note if body else None))
    await db.commit()

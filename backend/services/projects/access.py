"""Who may see and change a project.

The rule, in one place because everything else will depend on it:

- ``private``  — the owner and nobody else. Not listed, not linkable, not
  visible as a placeholder. Other people cannot tell it exists.
- ``shared``   — the explicit member list, at the role each member was given.
- ``company``  — every signed-in user gets ``editor``; members keep their own
  role where it is higher. Opening a project to the firm is meant to invite
  the firm to work in it, not to watch it. A standing setting, not a one-off
  share.

There is no admin bypass. "Personal" has to mean personal or it means nothing.
Nothing here governs what the agent may read across projects — that is decided
by project links, not by visibility.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_member import PROJECT_ROLES, ProjectMember
from models.db.task import Project

# Who may hold an account at all. Sign-in checks it and so does sharing, so it
# lives here rather than in either caller.
ALLOWED_DOMAINS = {"pmi-llc.com", "precisianmedical.com"}


def role_at_least(role: str, minimum: str) -> bool:
    """True if ``role`` carries at least the authority of ``minimum``."""
    try:
        return PROJECT_ROLES.index(role) >= PROJECT_ROLES.index(minimum)
    except ValueError:
        return False


async def get_member_role(
    db: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID
) -> str | None:
    """The user's explicit membership role, or None if they are not a member."""
    row = (
        await db.execute(
            select(ProjectMember.role).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return row


async def resolve_role(
    db: AsyncSession, project: Project, user_id: uuid.UUID
) -> str | None:
    """The user's effective role on a project, or None if they cannot see it."""
    member_role = await get_member_role(db, project.id, user_id)
    if member_role:
        return member_role
    # Legacy rows predating migration 033's backfill: an owner with no row.
    if project.owner_id == user_id or project.created_by == user_id:
        return "owner"
    if project.visibility == "company":
        return "editor"
    return None


async def visible_project_ids(db: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    """Every project id the user may see. Use to scope list queries."""
    rows = (
        await db.execute(
            select(Project.id)
            .outerjoin(
                ProjectMember,
                (ProjectMember.project_id == Project.id)
                & (ProjectMember.user_id == user_id),
            )
            .where(
                (ProjectMember.id.isnot(None))
                | (Project.owner_id == user_id)
                | (Project.created_by == user_id)
                | (Project.visibility == "company")
            )
        )
    ).scalars()
    return list(rows)

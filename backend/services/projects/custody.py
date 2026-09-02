"""Custody — work made in a shared space stays there until it is released.

The rule, in one place because every item type has to obey the same one:

- Anything created inside a **shared** or **company** project is held by that
  project from the moment it is created.
- While held, it can only be changed by someone with ``editor`` on that
  project, and it cannot be moved to another project or pulled out into
  someone's personal list.
- Releasing is the owner's call, and it is recorded.

A ``private`` project holds nothing: there is nobody to share custody with, so
personal rules already cover it.

The hub is the authority. A desktop that has the same row is looking at a copy;
it must send changes here rather than write its own and push them up.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_custody import ProjectItemCustody
from models.db.task import Project
from services.projects.access import resolve_role, role_at_least

# Custody only means something where more than one person can reach the work.
SHARED_VISIBILITIES = ("shared", "company")


async def holder(
    db: AsyncSession, item_type: str, item_id: uuid.UUID
) -> ProjectItemCustody | None:
    """The live custody row for an item, or None if nothing holds it."""
    return (
        await db.execute(
            select(ProjectItemCustody).where(
                ProjectItemCustody.item_type == item_type,
                ProjectItemCustody.item_id == item_id,
                ProjectItemCustody.released_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def take(
    db: AsyncSession,
    project: Project,
    item_type: str,
    item_id: uuid.UUID,
    user_id: uuid.UUID,
) -> ProjectItemCustody | None:
    """Put an item under a project's custody, if that project is a shared one.

    Returns None for a private project, where custody would mean nothing.
    """
    if project.visibility not in SHARED_VISIBILITIES:
        return None
    existing = await holder(db, item_type, item_id)
    if existing is not None:
        return existing
    row = ProjectItemCustody(
        project_id=project.id,
        item_type=item_type,
        item_id=item_id,
        created_by=user_id,
    )
    db.add(row)
    return row


async def assert_may_change(
    db: AsyncSession,
    item_type: str,
    item_id: uuid.UUID,
    user_id: uuid.UUID,
) -> ProjectItemCustody | None:
    """Raise unless the user may change this item where it currently lives.

    Returns the live custody row so callers can enforce the rest of the rule
    without asking twice.
    """
    held = await holder(db, item_type, item_id)
    if held is None:
        return None
    project = await db.get(Project, held.project_id)
    if project is None:
        return held
    role = await resolve_role(db, project, user_id)
    if role is None or not role_at_least(role, "editor"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"This belongs to the project \u201c{project.name}\u201d and can only be "
                "changed there, by someone on the project. Ask an owner to release it "
                "if it needs to move."
            ),
        )
    return held


def assert_stays_put(
    held: ProjectItemCustody | None, new_project_id: uuid.UUID | None
) -> None:
    """Held work cannot be moved out of, or between, projects."""
    if held is None or new_project_id == held.project_id:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "This was made in a shared project and stays there until it is released."
        ),
    )


async def release(
    db: AsyncSession,
    held: ProjectItemCustody,
    user_id: uuid.UUID,
    note: str | None = None,
) -> ProjectItemCustody:
    held.released_at = datetime.now(timezone.utc)
    held.released_by = user_id
    held.release_note = note
    return held

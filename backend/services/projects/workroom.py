"""The workroom behind a project.

Every project gets one the moment it is created, with a conversation already
attached. A workroom without a conversation is a dead end — the Chat tab has
nothing to open — and asking someone to press "start one" before Gerry will
talk about their own project is a step with no decision in it.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.task import Project
from models.db.workroom import Workroom
from repositories.conversation_repo import ConversationRepository


async def ensure_workroom(
    db: AsyncSession, project: Project, user_id: uuid.UUID
) -> Workroom:
    """The project's workroom, created with its conversation on first use.

    Does not commit: the caller decides when the whole write lands.
    """
    room = (
        await db.execute(
            select(Workroom)
            .where(Workroom.project_id == project.id)
            .order_by(Workroom.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if room is None:
        conv = await ConversationRepository(db).create(
            user_id=user_id, title=f"Project: {project.name.strip()[:180]}"
        )
        room = Workroom(
            id=uuid.uuid4(),
            user_id=user_id,
            project_id=project.id,
            title=project.name[:200],
            goal=project.goal or "",
            conversation_id=conv.id,
        )
        db.add(room)
        await db.flush()
    elif room.conversation_id is None:
        # Rooms made before this ran, and any that lost their conversation.
        conv = await ConversationRepository(db).create(
            user_id=room.user_id, title=f"Project: {project.name.strip()[:180]}"
        )
        room.conversation_id = conv.id
        await db.flush()

    return room

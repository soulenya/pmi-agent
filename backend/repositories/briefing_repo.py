"""Repository for Briefings."""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.briefing import Briefing


class BriefingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_for_date(self, user_id: uuid.UUID, for_date: date) -> Briefing | None:
        result = await self.session.execute(
            select(Briefing)
            .where(Briefing.user_id == user_id, Briefing.generated_for_date == for_date)
            .order_by(Briefing.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list(self, user_id: uuid.UUID, *, limit: int = 10) -> list[Briefing]:
        result = await self.session.execute(
            select(Briefing)
            .where(Briefing.user_id == user_id)
            .order_by(Briefing.generated_for_date.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        briefing_type: str,
        generated_for_date: date,
        headline: str | None = None,
        priority_items: list | None = None,
        open_actions: list | None = None,
        upcoming_events: list | None = None,
        full_content: str | None = None,
    ) -> Briefing:
        briefing = Briefing(
            id=uuid.uuid4(),
            user_id=user_id,
            type=briefing_type,
            generated_for_date=generated_for_date,
            headline=headline,
            priority_items=priority_items or [],
            open_actions=open_actions or [],
            upcoming_events=upcoming_events or [],
            full_content=full_content,
        )
        self.session.add(briefing)
        await self.session.flush()
        await self.session.refresh(briefing)
        return briefing

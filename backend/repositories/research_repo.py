"""Repository for ResearchReport and ResearchSource."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.db.research import ResearchReport, ResearchSource


class ResearchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Reports ───────────────────────────────────────────────────────────────

    async def list(self, *, created_by: uuid.UUID | None = None, limit: int = 50) -> list[ResearchReport]:
        stmt = (
            select(ResearchReport)
            .options(selectinload(ResearchReport.sources))
            .order_by(ResearchReport.created_at.desc())
            .limit(limit)
        )
        if created_by is not None:
            stmt = stmt.where(ResearchReport.created_by == created_by)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, report_id: uuid.UUID) -> ResearchReport | None:
        result = await self.session.execute(
            select(ResearchReport)
            .options(selectinload(ResearchReport.sources))
            .where(ResearchReport.id == report_id)
        )
        return result.scalar_one_or_none()

    async def create(self, *, created_by: uuid.UUID, **fields: Any) -> ResearchReport:
        report = ResearchReport(id=uuid.uuid4(), created_by=created_by, **fields)
        self.session.add(report)
        await self.session.flush()
        await self.session.refresh(report)
        return report

    async def update(self, report_id: uuid.UUID, **fields: Any) -> ResearchReport | None:
        report = await self.get(report_id)
        if report is None:
            return None
        for key, val in fields.items():
            setattr(report, key, val)
        await self.session.flush()
        await self.session.refresh(report)
        return report

    # ── Sources ───────────────────────────────────────────────────────────────

    async def add_sources(
        self, report_id: uuid.UUID, sources: list[dict]
    ) -> list[ResearchSource]:
        objs = []
        for i, s in enumerate(sources):
            src = ResearchSource(
                id=uuid.uuid4(),
                report_id=report_id,
                title=s.get("title"),
                url=s["url"],
                domain=s.get("domain"),
                snippet=s.get("snippet"),
                relevance_score=float(len(sources) - i) / len(sources) if sources else None,
            )
            self.session.add(src)
            objs.append(src)
        await self.session.flush()
        return objs

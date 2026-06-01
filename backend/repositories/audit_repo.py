"""Audit event repository — INSERT only; no update or delete methods."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.audit import AuditEvent
from repositories.base import BaseRepository


class AuditRepository(BaseRepository[AuditEvent]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(AuditEvent, session)

    # ── Override mutating methods to enforce append-only ─────────────────────

    async def update(self, obj: AuditEvent, **kwargs: object) -> AuditEvent:  # type: ignore[override]
        raise NotImplementedError("AuditEvent records are immutable.")

    async def delete(self, obj: AuditEvent) -> None:  # type: ignore[override]
        raise NotImplementedError("AuditEvent records cannot be deleted.")

    # ── Query helpers ─────────────────────────────────────────────────────────

    async def get_latest(self) -> AuditEvent | None:
        result = await self.session.execute(
            select(AuditEvent).order_by(AuditEvent.sequence_number.desc()).limit(1)
        )
        return result.scalar_one_or_none()

    async def get_by_sequence(self, sequence_number: int) -> AuditEvent | None:
        result = await self.session.execute(
            select(AuditEvent).where(AuditEvent.sequence_number == sequence_number)
        )
        return result.scalar_one_or_none()

    async def get_by_entity(
        self, entity_type: str, entity_id: UUID
    ) -> list[AuditEvent]:
        result = await self.session.execute(
            select(AuditEvent)
            .where(
                AuditEvent.entity_type == entity_type,
                AuditEvent.entity_id == entity_id,
            )
            .order_by(AuditEvent.sequence_number)
        )
        return list(result.scalars().all())

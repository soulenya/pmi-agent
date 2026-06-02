"""Repositories for RegulatoryDocument, RiskItem, and CAPA."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.regulatory import CAPA, RegulatoryDocument, RiskItem


class RegulatoryDocRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(
        self,
        *,
        doc_type: str | None = None,
        status: str | None = None,
    ) -> list[RegulatoryDocument]:
        stmt = select(RegulatoryDocument).order_by(RegulatoryDocument.created_at.desc())
        if doc_type:
            stmt = stmt.where(RegulatoryDocument.doc_type == doc_type)
        if status:
            stmt = stmt.where(RegulatoryDocument.status == status)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, doc_id: uuid.UUID) -> RegulatoryDocument | None:
        result = await self.session.execute(
            select(RegulatoryDocument).where(RegulatoryDocument.id == doc_id)
        )
        return result.scalar_one_or_none()

    async def create(self, *, created_by: uuid.UUID, **fields: Any) -> RegulatoryDocument:
        doc = RegulatoryDocument(id=uuid.uuid4(), created_by=created_by, owner_id=created_by, **fields)
        self.session.add(doc)
        await self.session.flush()
        await self.session.refresh(doc)
        return doc

    async def update(self, doc_id: uuid.UUID, **fields: Any) -> RegulatoryDocument | None:
        doc = await self.get(doc_id)
        if doc is None:
            return None
        for key, val in fields.items():
            setattr(doc, key, val)
        await self.session.flush()
        await self.session.refresh(doc)
        return doc

    async def delete(self, doc_id: uuid.UUID) -> bool:
        doc = await self.get(doc_id)
        if doc is None:
            return False
        await self.session.delete(doc)
        return True


class RiskItemRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(self, regulatory_doc_id: uuid.UUID | None = None) -> list[RiskItem]:
        stmt = select(RiskItem).order_by(RiskItem.created_at.desc())
        if regulatory_doc_id:
            stmt = stmt.where(RiskItem.regulatory_doc_id == regulatory_doc_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, item_id: uuid.UUID) -> RiskItem | None:
        result = await self.session.execute(
            select(RiskItem).where(RiskItem.id == item_id)
        )
        return result.scalar_one_or_none()

    async def create(self, **fields: Any) -> RiskItem:
        item = RiskItem(id=uuid.uuid4(), **fields)
        self.session.add(item)
        await self.session.flush()
        await self.session.refresh(item)
        return item

    async def update(self, item_id: uuid.UUID, **fields: Any) -> RiskItem | None:
        item = await self.get(item_id)
        if item is None:
            return None
        for key, val in fields.items():
            setattr(item, key, val)
        await self.session.flush()
        await self.session.refresh(item)
        return item

    async def delete(self, item_id: uuid.UUID) -> bool:
        item = await self.get(item_id)
        if item is None:
            return False
        await self.session.delete(item)
        return True


class CAPARepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(self, *, status: str | None = None) -> list[CAPA]:
        stmt = select(CAPA).order_by(CAPA.created_at.desc())
        if status:
            stmt = stmt.where(CAPA.status == status)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, capa_id: uuid.UUID) -> CAPA | None:
        result = await self.session.execute(
            select(CAPA).where(CAPA.id == capa_id)
        )
        return result.scalar_one_or_none()

    async def create(self, **fields: Any) -> CAPA:
        capa = CAPA(id=uuid.uuid4(), **fields)
        self.session.add(capa)
        await self.session.flush()
        await self.session.refresh(capa)
        return capa

    async def update(self, capa_id: uuid.UUID, **fields: Any) -> CAPA | None:
        capa = await self.get(capa_id)
        if capa is None:
            return None
        for key, val in fields.items():
            setattr(capa, key, val)
        await self.session.flush()
        await self.session.refresh(capa)
        return capa

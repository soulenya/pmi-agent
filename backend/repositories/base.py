"""Generic async repository base class using the Repository pattern."""

from __future__ import annotations

from typing import Any, Generic, TypeVar
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.base import Base

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    """
    Provides standard CRUD operations for a SQLAlchemy model.
    Business logic lives in service classes, not here.
    """

    def __init__(self, model: type[ModelT], session: AsyncSession) -> None:
        self.model = model
        self.session = session

    async def get(self, id: UUID) -> ModelT | None:
        result = await self.session.get(self.model, id)
        return result

    async def get_or_raise(self, id: UUID) -> ModelT:
        obj = await self.get(id)
        if obj is None:
            raise ValueError(f"{self.model.__name__} with id={id} not found")
        return obj

    async def list(
        self,
        *,
        filters: list[Any] | None = None,
        order_by: Any | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[ModelT]:
        stmt = select(self.model)
        if filters:
            stmt = stmt.where(*filters)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        if offset:
            stmt = stmt.offset(offset)
        if limit is not None:
            stmt = stmt.limit(limit)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count(self, *filters: Any) -> int:
        stmt = select(func.count()).select_from(self.model)
        if filters:
            stmt = stmt.where(*filters)
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def create(self, **kwargs: Any) -> ModelT:
        obj = self.model(**kwargs)
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def update(self, obj: ModelT, **kwargs: Any) -> ModelT:
        for key, value in kwargs.items():
            setattr(obj, key, value)
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def delete(self, obj: ModelT) -> None:
        await self.session.delete(obj)
        await self.session.flush()

    async def save(self, obj: ModelT) -> ModelT:
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

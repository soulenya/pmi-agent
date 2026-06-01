"""
Repository for Document, DocumentCategory, and DocumentChunk models.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.document import Document, DocumentCategory, DocumentChunk
from repositories.base import BaseRepository


class DocumentCategoryRepository(BaseRepository[DocumentCategory]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(DocumentCategory, session)

    async def get_by_name(self, name: str) -> DocumentCategory | None:
        result = await self._session.execute(
            select(DocumentCategory).where(DocumentCategory.name == name)
        )
        return result.scalar_one_or_none()


class DocumentRepository(BaseRepository[Document]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Document, session)

    async def list_active(
        self,
        *,
        category_id: UUID | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Document]:
        q = select(Document).where(Document.deleted_at.is_(None))
        if category_id is not None:
            q = q.where(Document.category_id == category_id)
        q = q.order_by(Document.created_at.desc()).limit(limit).offset(offset)
        result = await self._session.execute(q)
        return list(result.scalars().all())

    async def count_active(self, *, category_id: UUID | None = None) -> int:
        q = select(func.count()).select_from(Document).where(Document.deleted_at.is_(None))
        if category_id is not None:
            q = q.where(Document.category_id == category_id)
        result = await self._session.execute(q)
        return result.scalar_one()

    async def get_active(self, doc_id: UUID) -> Document | None:
        result = await self._session.execute(
            select(Document).where(
                Document.id == doc_id,
                Document.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def soft_delete(self, doc_id: UUID) -> bool:
        from datetime import datetime, timezone

        doc = await self.get_active(doc_id)
        if doc is None:
            return False
        doc.deleted_at = datetime.now(timezone.utc)
        await self._session.flush()
        return True


class DocumentChunkRepository(BaseRepository[DocumentChunk]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(DocumentChunk, session)

    async def get_by_document(self, document_id: UUID) -> list[DocumentChunk]:
        result = await self._session.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == document_id)
            .order_by(DocumentChunk.chunk_index)
        )
        return list(result.scalars().all())

    async def delete_by_document(self, document_id: UUID) -> int:
        from sqlalchemy import delete

        result = await self._session.execute(
            delete(DocumentChunk).where(DocumentChunk.document_id == document_id)
        )
        await self._session.flush()
        return result.rowcount

    async def vector_search(
        self,
        embedding: list[float],
        *,
        top_k: int = 5,
        category_id: UUID | None = None,
    ) -> list[tuple[DocumentChunk, float]]:
        """
        Cosine similarity search using pgvector <=> operator.
        Returns (chunk, distance) pairs ordered by ascending distance (most similar first).
        Joins to Document to allow category filtering and soft-delete exclusion.
        """
        from pgvector.sqlalchemy import Vector

        q = (
            select(
                DocumentChunk,
                DocumentChunk.embedding.op("<=>")(embedding).label("distance"),
            )
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(Document.deleted_at.is_(None))
        )
        if category_id is not None:
            q = q.where(Document.category_id == category_id)

        q = q.order_by("distance").limit(top_k)
        result = await self._session.execute(q)
        rows = result.all()
        # Convert cosine distance [0,2] → cosine similarity [0,1]
        return [(row[0], round(1 - float(row[1]) / 2, 4)) for row in rows]

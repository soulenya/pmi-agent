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
        result = await self.session.execute(
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
        result = await self.session.execute(q)
        return list(result.scalars().all())

    async def count_active(self, *, category_id: UUID | None = None) -> int:
        q = select(func.count()).select_from(Document).where(Document.deleted_at.is_(None))
        if category_id is not None:
            q = q.where(Document.category_id == category_id)
        result = await self.session.execute(q)
        return result.scalar_one()

    async def get_active(self, doc_id: UUID) -> Document | None:
        result = await self.session.execute(
            select(Document).where(
                Document.id == doc_id,
                Document.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def find_active_by_checksum(
        self, checksum: str, *, exclude_id: UUID | None = None
    ) -> Document | None:
        """Return the oldest active (non-deleted) document with this SHA-256, if any.

        Used for duplicate detection before ingesting a new file.
        """
        if not checksum:
            return None
        q = select(Document).where(
            Document.checksum_sha256 == checksum,
            Document.deleted_at.is_(None),
        )
        if exclude_id is not None:
            q = q.where(Document.id != exclude_id)
        q = q.order_by(Document.created_at.asc()).limit(1)
        result = await self.session.execute(q)
        return result.scalar_one_or_none()

    async def find_duplicate_groups(self) -> list[list[Document]]:
        """Return groups of active documents that share an identical SHA-256.

        Each returned list has 2+ documents (same byte content), ordered oldest
        first so callers can treat the first as the original to keep. Used by the
        manual duplicate scan.
        """
        dup_checksums = (
            select(Document.checksum_sha256)
            .where(
                Document.deleted_at.is_(None),
                Document.checksum_sha256.is_not(None),
            )
            .group_by(Document.checksum_sha256)
            .having(func.count() > 1)
        )
        result = await self.session.execute(
            select(Document)
            .where(
                Document.deleted_at.is_(None),
                Document.checksum_sha256.in_(dup_checksums),
            )
            .order_by(Document.checksum_sha256, Document.created_at.asc())
        )
        groups: dict[str, list[Document]] = {}
        for doc in result.scalars().all():
            groups.setdefault(doc.checksum_sha256, []).append(doc)
        return [g for g in groups.values() if len(g) > 1]

    async def soft_delete(self, doc_id: UUID) -> bool:
        from datetime import datetime, timezone

        doc = await self.get_active(doc_id)
        if doc is None:
            return False
        doc.deleted_at = datetime.now(timezone.utc)
        await self.session.flush()
        return True


class DocumentChunkRepository(BaseRepository[DocumentChunk]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(DocumentChunk, session)

    async def get_by_document(self, document_id: UUID) -> list[DocumentChunk]:
        result = await self.session.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == document_id)
            .order_by(DocumentChunk.chunk_index)
        )
        return list(result.scalars().all())

    async def delete_by_document(self, document_id: UUID) -> int:
        from sqlalchemy import delete

        result = await self.session.execute(
            delete(DocumentChunk).where(DocumentChunk.document_id == document_id)
        )
        await self.session.flush()
        return result.rowcount

    async def delete_all_chunks(self) -> int:
        """Delete ALL document chunks across all documents. Used during re-index."""
        from sqlalchemy import delete

        result = await self.session.execute(delete(DocumentChunk))
        await self.session.flush()
        return result.rowcount

    async def get_all_document_ids_ready(self) -> list[UUID]:
        """
        Return IDs of all active (non-deleted), ready documents.
        Used by the re-index pipeline to enumerate documents to re-embed.
        """
        result = await self.session.execute(
            select(Document.id).where(
                Document.deleted_at.is_(None),
                Document.status == "ready",
            )
        )
        return list(result.scalars().all())

    async def vector_search(
        self,
        embedding: list[float],
        *,
        top_k: int = 5,
        category_id: UUID | None = None,
    ) -> list[tuple[DocumentChunk, float]]:
        """
        Cosine similarity search using pgvector cosine_distance.
        Returns (chunk, distance) pairs ordered by ascending distance (most similar first).
        Joins to Document to allow category filtering and soft-delete exclusion.
        """
        distance = DocumentChunk.embedding.cosine_distance(embedding).label("distance")
        q = (
            select(DocumentChunk, distance)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(Document.deleted_at.is_(None))
        )
        if category_id is not None:
            q = q.where(Document.category_id == category_id)

        q = q.order_by("distance").limit(top_k)
        result = await self.session.execute(q)
        rows = result.all()
        # Convert cosine distance [0,2] → cosine similarity [0,1]
        return [(row[0], round(1 - float(row[1]) / 2, 4)) for row in rows]

"""Document, DocumentCategory, and DocumentChunk ORM models."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.db.base import Base
from models.db.enums import DocumentSourceType, DocumentStatus


class DocumentCategory(Base):
    __tablename__ = "document_categories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_categories.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    documents: Mapped[list[Document]] = relationship("Document", back_populates="category")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[DocumentSourceType] = mapped_column(String(50), nullable=False)
    source_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_categories.id"), nullable=True, index=True
    )

    # File info
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # Processing state
    status: Mapped[DocumentStatus] = mapped_column(
        String(20), nullable=False, default=DocumentStatus.PENDING, index=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Metadata
    author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    document_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    is_regulated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_confidential: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Soft delete (regulated docs must never be hard-deleted)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Source-update tracking (Google Drive sync) ──────────────────────────────
    # sync_status: None/"current" = in sync, "modified"/"renamed"/"deleted" = an
    # update is available in the source that has not yet been applied/dismissed.
    sync_status: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    # Last-known source modified timestamp (e.g. Drive modifiedTime) used as the
    # baseline to detect changes without downloading the full file each check.
    source_modified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # When the source was last checked for updates (distinct from last_synced_at,
    # which is when the content was last actually (re)imported).
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Human-readable note about the detected change (e.g. new name on rename).
    sync_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Baseline source file name recorded at import/sync time, used to detect
    # renames in the source without relying on the (possibly customised) title.
    source_name: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Relationships
    category: Mapped[DocumentCategory | None] = relationship(
        "DocumentCategory", back_populates="documents"
    )
    chunks: Mapped[list[DocumentChunk]] = relationship(
        "DocumentChunk", back_populates="document", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Document id={self.id} title={self.title!r} status={self.status}>"


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Content
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Position & hierarchy
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    section_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_chunk_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_chunks.id"), nullable=True
    )
    # 0 = document summary, 1 = section, 2 = paragraph
    chunk_level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Embedding — dimension is provider-dependent; Vector(None) lets PostgreSQL
    # enforce the actual column dimension rather than hard-coding 768 here.
    # The column is ALTERed at ingest/reindex time when the provider changes.
    embedding: Mapped[list[float] | None] = mapped_column(Vector(None), nullable=True)
    embedding_model: Mapped[str] = mapped_column(
        String(100), nullable=False, default="nomic-embed-text"
    )
    embedding_dimension: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    embedding_created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    document: Mapped[Document] = relationship("Document", back_populates="chunks")

    def __repr__(self) -> str:
        return f"<DocumentChunk id={self.id} doc={self.document_id} idx={self.chunk_index}>"

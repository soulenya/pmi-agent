"""
Document and knowledge-base Pydantic schemas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ── Document category ────────────────────────────────────────────────────────

class DocumentCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None
    created_at: datetime


# ── Document ──────────────────────────────────────────────────────────────────

class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category_id: UUID | None
    title: str
    source_type: str
    source_uri: str | None
    file_name: str | None
    mime_type: str | None
    file_size_bytes: int | None
    checksum_sha256: str | None
    is_regulated: bool
    status: str
    chunk_count: int
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime


class DocumentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)
    category_id: UUID | None = None
    is_regulated: bool = False
    source_uri: str | None = None


class DocumentUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=512)
    category_id: UUID | None = None
    is_regulated: bool | None = None


# ── Chunks ────────────────────────────────────────────────────────────────────

class DocumentChunkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    document_id: UUID
    chunk_index: int
    content: str
    page_number: int | None


# ── Vector search ─────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)
    category_id: UUID | None = None


class SearchResult(BaseModel):
    chunk_id: UUID
    document_id: UUID
    document_title: str
    chunk_index: int
    page_number: int | None
    content: str
    score: float  # cosine similarity [0, 1]

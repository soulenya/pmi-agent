"""Pydantic schemas for Research Reports and Sources."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ResearchSourceOut(BaseModel):
    id: uuid.UUID
    title: str | None
    url: str
    domain: str | None
    snippet: str | None
    relevance_score: float | None
    retrieved_at: datetime

    model_config = {"from_attributes": True}


class ResearchReportOut(BaseModel):
    id: uuid.UUID
    title: str
    query: str
    summary: str | None
    full_report: str | None
    status: str
    tags: list[str]
    sources: list[ResearchSourceOut] = []
    created_at: datetime
    created_by: uuid.UUID | None
    ingested_as_document_id: uuid.UUID | None

    model_config = {"from_attributes": True}


class RunResearchRequest(BaseModel):
    query: str = Field(min_length=3, max_length=500)
    title: str | None = Field(None, max_length=500)
    tags: list[str] = []
    max_results: int = Field(8, ge=1, le=20)
    ingest_to_kb: bool = False

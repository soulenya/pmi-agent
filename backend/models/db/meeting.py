"""MeetingNote ORM model."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class MeetingNote(Base):
    __tablename__ = "meeting_notes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    # Raw transcript or notes pasted by the user
    raw_transcript: Mapped[str] = mapped_column(Text, nullable=False)
    # LLM-generated outputs (null until summarized)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    decisions: Mapped[str | None] = mapped_column(Text, nullable=True)  # markdown bullet list
    action_items: Mapped[str | None] = mapped_column(Text, nullable=True)  # markdown bullet list
    next_steps: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Metadata
    meeting_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attendees: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    # IDs of tasks auto-created from action items
    generated_task_ids: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    # KB document this note was ingested as (guards against duplicate adds)
    kb_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<MeetingNote id={self.id} title={self.title!r}>"

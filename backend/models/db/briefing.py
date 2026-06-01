"""Briefing ORM model."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base
from models.db.enums import BriefingType


class Briefing(Base):
    __tablename__ = "briefings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    type: Mapped[BriefingType] = mapped_column(String(20), nullable=False)
    headline: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Structured sections stored as JSON arrays
    priority_items: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)
    open_actions: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)
    upcoming_events: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)
    email_summary: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)

    full_content: Mapped[str | None] = mapped_column(Text, nullable=True)

    agent_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agent_runs.id"), nullable=True
    )
    generated_for_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<Briefing id={self.id} type={self.type} date={self.generated_for_date}>"

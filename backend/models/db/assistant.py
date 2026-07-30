"""ORM model for the daily assistant scan suggestions.

The daily Gmail/Tasks scan surfaces items that need the user's attention:
follow-up reminders, recommended tasks (created only on approval), and
auto-imported meeting summaries (imported immediately, kept or removed on
review). Each surfaced item is one ``AssistantSuggestion`` row. The
``(user_id, kind, source_id)`` triple is unique so repeated daily scans never
duplicate the same item.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class AssistantSuggestion(Base):
    __tablename__ = "assistant_suggestions"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "kind", "source_id", name="uq_assistant_suggestion_dedup"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # followup_email | followup_task | task_recommendation | meeting_import
    kind: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    # pending | accepted | dismissed | completed (already done — never resurfaces)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # gmail_thread | gmail_message | google_task | chat_conversation
    # | gmail_attachment | drive_doc
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_id: Mapped[str] = mapped_column(String(255), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # kind-specific structured data (e.g. recommended task fields, message id)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # set after accept (task) / import (document)
    result_entity_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    result_entity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    # How many times the user has dismissed this source's suggestion. A single
    # dismissal lets the item resurface on the next scan (guards against an
    # accidental dismissal); reaching the suppression threshold stops it for good.
    dismissal_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:
        return (
            f"<AssistantSuggestion id={self.id} kind={self.kind} "
            f"status={self.status} title={self.title!r}>"
        )

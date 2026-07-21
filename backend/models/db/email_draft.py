"""EmailDraft ORM model."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class EmailDraft(Base):
    __tablename__ = "email_drafts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Inputs from user
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    recipient_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    recipient_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Comma-separated additional recipients (passed straight to gmail_send)
    cc: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bcc: Mapped[str | None] = mapped_column(String(500), nullable=True)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)  # what the email should accomplish
    tone: Mapped[str] = mapped_column(String(50), nullable=False, default="professional")
    key_points: Mapped[str | None] = mapped_column(Text, nullable=True)  # user notes/bullet points
    # LLM-generated draft body
    draft_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Workflow state
    # draft | pending_approval | approved | rejected | sent (future)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")
    # ApprovalIntent id if submitted for approval
    approval_intent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    # Generated-file attachments: [{"filename": <safe name>, "display_name": str}]
    attachments: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
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
        return f"<EmailDraft id={self.id} subject={self.subject!r} status={self.status}>"

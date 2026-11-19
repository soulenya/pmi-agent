"""What the hub has stored of each conversation in the company brain.

One row per conversation that has a page in GBrain: how many messages that
page holds, so the next pass can tell whether the conversation has moved on.

There is deliberately no foreign key to ``conversations``. The row has to
outlive its conversation: it is how the hub learns that a conversation was
deleted and its page must go too.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class BrainConversationArchive(Base):
    __tablename__ = "brain_conversation_archives"

    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    archived_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

"""PersonalNote — a thing one person told Gerry to remember.

Not a sticky on a canvas, not a journal line in a room, not a task: a note is
private to the person who made it, from the moment it is saved. Gerry reads a
person's notes only while working for that person — in chat, and in the
routines they run — so a weekly update written for you can draw on what you
noted during the week and nobody else's notes.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base

# How the note arrived. Shown in the list so a dictated note reads as one.
NOTE_SOURCES = ("voice", "text", "gerry")


class PersonalNote(Base):
    __tablename__ = "personal_notes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="text")
    # The conversation it was said in, when Gerry saved it. Bare uuid, not a
    # FK: hub mirrors carry ids this database may not have a row for.
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<PersonalNote id={self.id} user={self.user_id}>"

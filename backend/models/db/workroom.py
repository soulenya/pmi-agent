"""Workroom ORM models — persistent per-user co-work spaces.

A Workroom = a goal + pinned artifacts + a dedicated conversation + a progress
journal. Items reference artifacts loosely by kind + ref_id (Drive file IDs,
KB document UUIDs, generated filenames, Gmail thread IDs, task UUIDs, Odoo
records, regulatory file IDs).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base

# Supported artifact kinds (validated in the router; stored as plain strings).
WORKROOM_ITEM_KINDS = (
    "drive_doc",
    "kb_doc",
    "generated_file",
    "note",
    "email_thread",
    "task",
    "odoo_record",
    "regulatory_doc",
)


class Workroom(Base):
    __tablename__ = "workrooms"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # "active" | "archived"
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Drive file id of the room's shared manifest (JSON on the shared Drive).
    # Set for both the sharer and anyone who joined from the manifest.
    share_file_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class WorkroomItem(Base):
    __tablename__ = "workroom_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    workroom_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workrooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    ref_id: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WorkroomJournalEntry(Base):
    __tablename__ = "workroom_journal"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    workroom_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workrooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    entry: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

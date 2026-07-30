"""ORM model for recurring scheduled tasks that Little Gerry runs on its own.

A scheduled task is a saved natural-language instruction (the ``prompt``) plus a
recurrence (daily / weekly / monthly at a local time). A background loop wakes
periodically, runs every task whose ``next_run_at`` has passed by invoking the
agent headlessly, then records the outcome and computes the next run time.

Times are interpreted in the server's LOCAL timezone — correct for this
per-user desktop app, matching the existing daily-assistant and Drive-sync
loops which also use local time.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class ScheduledTask(Base):
    __tablename__ = "scheduled_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # The natural-language instruction handed to the agent each run, e.g.
    # "Create a Word report summarising the previous week's emails and tasks."
    prompt: Mapped[str] = mapped_column(Text, nullable=False)

    # daily | weekly | monthly
    frequency: Mapped[str] = mapped_column(String(20), nullable=False, default="weekly")
    # 0=Monday .. 6=Sunday (used when frequency == 'weekly')
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 1..31 (used when frequency == 'monthly'; clamped to month length)
    day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hour: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    minute: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, index=True
    )

    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    last_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # success | failed | running
    last_run_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_run_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Generated file names the last run actually produced, verified present on
    # disk when the run ended. Kept separately because last_run_output is
    # truncated for display and can cut the /api/files/... links off the end.
    last_run_files: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Conversation that holds the run history, so the user can open it in chat.
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # When set, this is a STANDING ROOM TASK: runs happen inside the workroom's
    # conversation (inheriting the WORKROOM CONTEXT block) and journal there.
    workroom_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workrooms.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    run_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

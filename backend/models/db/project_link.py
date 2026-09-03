"""How one project relates to another.

Read a row as a sentence, ``from`` first:

- ``A depends_on B``    — A waits for B.
- ``A gates B``         — B waits for A, and specifically for ``gate_task_id``,
                          a milestone in A. This is the only kind that carries
                          a condition.
- ``A parallel B``      — running alongside, no precedence either way.
- ``A subproject_of B`` — A is contained by B.

Links are also what decides how far the agent may read. Visibility says who
may open a project; links say which other projects it may look across.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base

PROJECT_LINK_KINDS = ("depends_on", "gates", "parallel", "subproject_of")

# Only `gates` uses these. `waived` is deliberate and sticky: someone decided
# to proceed without the milestone, and the schedule should stop nagging.
PROJECT_LINK_STATUSES = ("open", "satisfied", "waived")

# The kinds that impose an order, so a loop in them is a schedule that cannot
# happen. `parallel` says nothing about order and never loops.
PRECEDENCE_KINDS = ("depends_on", "gates")


class ProjectLink(Base):
    __tablename__ = "project_links"
    __table_args__ = (
        UniqueConstraint(
            "from_project_id", "to_project_id", "kind", name="uq_project_link"
        ),
        CheckConstraint(
            "from_project_id <> to_project_id", name="ck_project_link_not_self"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    from_project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    to_project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="depends_on")
    # The milestone that closes a gate. Deleting the task leaves the gate open
    # rather than quietly satisfying it.
    gate_task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    satisfied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

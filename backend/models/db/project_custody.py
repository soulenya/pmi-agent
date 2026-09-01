"""Custody — which shared project an item belongs to while it is being worked on.

A live row (``released_at`` is NULL) means the item may only be changed inside
that project, by someone the project trusts. Released rows are kept so the
handover is answerable later.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base

# What can be held. Kept narrow on purpose: each entry needs a route that
# actually enforces the hold, so adding one is a deliberate act.
CUSTODY_ITEM_TYPES = ("task",)


class ProjectItemCustody(Base):
    __tablename__ = "project_item_custody"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_type: Mapped[str] = mapped_column(String(32), nullable=False)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    released_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    released_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    release_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        state = "released" if self.released_at else "held"
        return f"<ProjectItemCustody {self.item_type}:{self.item_id} {state}>"

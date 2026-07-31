"""Per-file Drive edit grants — the only thing that lets Gerry write to Drive.

Google's OAuth scopes are all-or-nothing: once the user connects Workspace,
the token can technically write to every file they own. This table narrows
that back down. Gerry may modify a Drive file only while an ``active`` row
exists for that exact ``file_id``, and a grant is never created by the agent —
only by the signed-in user answering the permission prompt or using Settings.

Deliberately per file: granting access to one document says nothing about any
other, so every new document needs its own grant.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from models.db.base import Base


class DriveEditGrant(Base):
    __tablename__ = "drive_edit_grants"
    __table_args__ = (UniqueConstraint("user_id", "file_id", name="uq_drive_edit_grant_file"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    file_url: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    # active | revoked — revoked rows are kept so the history stays auditable.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    edit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<DriveEditGrant {self.file_name or self.file_id} status={self.status}>"

"""The desktop's standing connection to the hub, one row per person.

Each user signs in to the hub themselves, so the desktop never holds a shared
identity: it holds that person's refresh token and acts only as them. The token
is Fernet-encrypted for the same reason Google's is — a stolen database file
should not be a working set of credentials.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class HubLink(Base):
    __tablename__ = "hub_links"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    hub_url: Mapped[str] = mapped_column(String(500), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    refresh_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_ok_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # The last failure, kept so the settings page can say what went wrong
    # instead of only that the connection is down.
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

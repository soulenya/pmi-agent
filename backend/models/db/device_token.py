"""Device token ORM model — APNs registrations for the iOS app.

One row per (user, device). The same physical device re-registers with the same
APNs token on each launch, so the token itself is the natural unique key. When
APNs reports a token is no longer valid (HTTP 410), the row is deleted.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class DeviceToken(Base):
    """A push-notification registration for a single mobile device."""

    __tablename__ = "device_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # The APNs device token (hex string). Unique across the table — a device that
    # re-registers updates the existing row rather than creating duplicates.
    token: Mapped[str] = mapped_column(String(512), nullable=False, unique=True, index=True)
    # "ios" today; reserved for future "android"/"web-push" without a schema change.
    platform: Mapped[str] = mapped_column(String(20), nullable=False, default="ios")
    # App build that registered, for debugging stale-client issues. Optional.
    app_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Bumped every time the device re-registers, so we can prune long-dead tokens.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<DeviceToken user={self.user_id} platform={self.platform}>"

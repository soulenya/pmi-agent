"""Odoo ERP connection ORM model."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class OdooConnection(Base):
    """A single user's Odoo ERP connection.

    Credentials are stored encrypted (Fernet) — the API key is never persisted
    in plaintext. One connection per user (enforced by the unique constraint).
    """

    __tablename__ = "odoo_connections"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_odoo_connection_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Normalized base URL, e.g. "https://acme.odoo.com"
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    # Odoo database name
    database: Mapped[str] = mapped_column(String(255), nullable=False)
    # Login (email) used to authenticate
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    # Fernet-encrypted API key — never stored plaintext
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    # Cached identity / server info from the last successful connection
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    server_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_connected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<OdooConnection user={self.user_id} url={self.url} db={self.database}>"

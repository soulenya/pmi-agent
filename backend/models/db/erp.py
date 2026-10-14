"""ERP connection ORM model — one row per user, any provider."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class ErpConnection(Base):
    """A single user's ERP connection.

    ``provider`` names the adapter in ``services/erp`` (``odoo`` today). The
    Odoo columns (url, database, username, api_key_encrypted) are kept as they
    were; another provider keeps its non-secret settings in ``config`` and its
    secret, Fernet-encrypted, in ``api_key_encrypted``. One connection per user.
    """

    __tablename__ = "erp_connections"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_erp_connection_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="odoo", server_default="odoo")
    # Normalized base URL, e.g. "https://acme.odoo.com"
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    # Odoo database name (blank for providers without one)
    database: Mapped[str] = mapped_column(String(255), nullable=False)
    # Login (email) used to authenticate
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    # Fernet-encrypted API key / token — never stored plaintext
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    # Provider-specific non-secret settings
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
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
        return f"<ErpConnection user={self.user_id} provider={self.provider} url={self.url}>"

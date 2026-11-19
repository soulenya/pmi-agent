"""Secrets an administrator enters in the app, on a host with no OS keyring.

A desktop keeps provider API keys in the operating system's keyring. The hub
has none: its keys come from the environment (Secret Manager), which only an
operator with cloud access can change. This table lets a hub's administrator
paste a key in the web app instead. Values are Fernet-encrypted with the
install's own key; an environment value, where one exists, still wins.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class AppSecret(Base):
    __tablename__ = "app_secrets"

    name: Mapped[str] = mapped_column(String(100), primary_key=True)
    value_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

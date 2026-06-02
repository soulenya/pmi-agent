"""
AuditEvent ORM model — append-only, hash-chained event log.
The pmi_app DB role has INSERT only; UPDATE and DELETE are revoked.
Schema matches the migration (001_initial_schema.py).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Identity, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Monotonic sequence; gaps indicate deleted records (tampering)
    sequence_number: Mapped[int] = mapped_column(
        BigInteger, Identity(start=1, cycle=False), unique=True, nullable=False
    )

    # ── Classification ────────────────────────────────────────────────────────
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    # ── Actor ─────────────────────────────────────────────────────────────────
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )

    # ── Subject ───────────────────────────────────────────────────────────────
    entity_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # ── Content ───────────────────────────────────────────────────────────────
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=dict)

    # ── Integrity chain ───────────────────────────────────────────────────────
    previous_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    record_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    # ── Request context ───────────────────────────────────────────────────────
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<AuditEvent seq={self.sequence_number} type={self.event_type}>"

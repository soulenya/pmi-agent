"""
AuditEvent ORM model — append-only, hash-chained event log.
The pmi_app DB role has INSERT only; UPDATE and DELETE are revoked.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base
from models.db.enums import AgentType


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Monotonic sequence; gaps indicate deleted records (tampering)
    sequence_number: Mapped[int] = mapped_column(
        BigInteger, autoincrement=True, unique=True, nullable=False
    )

    # ── Actor ────────────────────────────────────────────────────────────────
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    agent_type: Mapped[AgentType | None] = mapped_column(
        String(50), nullable=True
    )
    agent_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    # ── Classification ────────────────────────────────────────────────────────
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # auth | document | agent | approval | task | system
    event_category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # ── Subject ───────────────────────────────────────────────────────────────
    entity_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # ── Content ───────────────────────────────────────────────────────────────
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=dict)

    # ── Integrity chain ───────────────────────────────────────────────────────
    previous_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    record_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    # ── Cross-references ──────────────────────────────────────────────────────
    approval_intent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )

    # NO updated_at — append-only by design

    def __repr__(self) -> str:
        return f"<AuditEvent seq={self.sequence_number} type={self.event_type}>"

"""ApprovalIntent ORM model — holds AI-generated actions pending human approval."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.db.base import Base
from models.db.enums import ApprovalStatus, IntentType, RiskLevel


class ApprovalIntent(Base):
    __tablename__ = "approval_intents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    agent_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agent_runs.id"), nullable=True, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    intent_type: Mapped[IntentType] = mapped_column(String(50), nullable=False)
    intent_title: Mapped[str] = mapped_column(String(500), nullable=False)
    intent_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Full structured action data — validated by Pydantic before storage
    intent_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)

    risk_level: Mapped[RiskLevel] = mapped_column(
        String(20), nullable=False, default=RiskLevel.LOW
    )

    status: Mapped[ApprovalStatus] = mapped_column(
        String(20), nullable=False, default=ApprovalStatus.PENDING
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return (
            f"<ApprovalIntent id={self.id} type={self.intent_type} status={self.status}>"
        )

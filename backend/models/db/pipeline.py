"""The sales pipeline: who the company is talking to, and where each conversation stands.

Shared by everyone at the company, so it lives on the hub; a desktop reads and
writes it through the hub. A lead is one prospect or opportunity. Stages are
the columns it moves through and are the company's own words. Notes are the
lead's history: what people wrote, and what changed.

``source`` / ``source_id`` record where an imported row came from (``odoo`` and
the Odoo id), so an import can be run again without making anything twice.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class PipelineStage(Base):
    __tablename__ = "pipeline_stages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PipelineLead(Base):
    __tablename__ = "pipeline_leads"
    __table_args__ = (UniqueConstraint("source", "source_id", name="uq_pipeline_lead_source"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    company: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    contact_name: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    contact_title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    stage_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pipeline_stages.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # open | won | lost. Separate from the stage: a lead is lost from whichever stage it was in.
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open", index=True)
    value: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    next_step: Mapped[str] = mapped_column(Text, nullable=False, default="")
    next_step_due: Mapped[date | None] = mapped_column(Date, nullable=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Kept as text too: an imported owner may not have an account here.
    owner_name: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    details: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    source_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PipelineNote(Base):
    """One entry in a lead's history. Never edited: a correction is a new note."""

    __tablename__ = "pipeline_notes"
    __table_args__ = (UniqueConstraint("lead_id", "source_id", name="uq_pipeline_note_source"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pipeline_leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # note: something a person wrote. email: a message sent. event: a change (stage, status).
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="note")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    author_name: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    source_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

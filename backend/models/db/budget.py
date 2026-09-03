"""Budget ORM model — link + mirror for a Drive-backed personal budget.

The Google Sheet on the user's Drive is the system of record; this row
links it (drive_file_id), holds permissions (gerry_write_enabled gates
the AGENT's writes — the user's own writes are always allowed), and
caches a parsed copy so the page and chat reads are instant.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class Budget(Base):
    __tablename__ = "budgets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The sheet outlives any project that claims it, so this clears rather than cascades.
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    drive_file_id: Mapped[str] = mapped_column(String(255), nullable=False)
    drive_url: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    allotment: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    # Gates the AGENT's ledger writes only; the user always has full control.
    gerry_write_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Daily Gmail invoice check for this budget (suggest-first, never silent).
    gmail_check_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Linked sheets Gerry didn't create can only be read (drive.file scope).
    external_readonly: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cached_ledger: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    cached_categories: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    cached_summary: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    drive_modified_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class BudgetFolder(Base):
    """A Drive folder linked to a budget (invoices/receipts) — read-only to
    Gerry: files are listed and read for extraction, never modified or moved.
    ``scanned_files`` maps file_id → extraction record so nothing is
    processed twice."""

    __tablename__ = "budget_folders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    budget_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("budgets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="invoice")
    folder_id: Mapped[str] = mapped_column(String(255), nullable=False)
    folder_name: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    folder_url: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    auto_scan: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    scanned_files: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class BudgetReference(Base):
    """Budget A references budget B's numbers. Always visible in A's panel;
    with ``include_as_entry`` a marked ledger row in A's sheet mirrors B's
    total on every refresh (note carries ``budget-ref:<B.id>``)."""

    __tablename__ = "budget_references"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    budget_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("budgets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ref_budget_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("budgets.id", ondelete="CASCADE"), nullable=False
    )
    include_as_entry: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

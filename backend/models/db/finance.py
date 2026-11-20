"""What Gerry has read from the bank: accounts with their last balances, and transactions.

Read-only copies, refreshed by a sync. Each row carries the ``environment`` it
came from, so sandbox test data can never be shown as the company's money.
Only the last four digits of an account number are kept. A transaction is
never updated or deleted: the bank's posted history does not change.

Also here: the company's one connection to QuickBooks Online. Nothing read
from QuickBooks is stored, only the encrypted tokens that allow reading it.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.db.base import Base


class BankAccount(Base):
    __tablename__ = "bank_accounts"
    __table_args__ = (UniqueConstraint("provider", "environment", "external_id", name="uq_bank_account_external"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="usbank")
    environment: Mapped[str] = mapped_column(String(20), nullable=False)
    external_id: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    last4: Mapped[str] = mapped_column(String(4), nullable=False, default="")
    account_type: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    bank_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    ledger_balance: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    available_balance: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    balance_as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class BankTransaction(Base):
    __tablename__ = "bank_transactions"
    __table_args__ = (UniqueConstraint("account_id", "dedupe_key", name="uq_bank_transaction_dedupe"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    posted_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # Signed: money in is positive, money out is negative.
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    kind: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Who it was paid to or came from, when the bank says.
    counterparty: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    reference: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    # What makes this row this row, so a repeated sync adds nothing.
    dedupe_key: Mapped[str] = mapped_column(String(64), nullable=False)
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class QuickBooksConnection(Base):
    """The company's connection to one QuickBooks company, one per environment."""

    __tablename__ = "quickbooks_connections"
    __table_args__ = (UniqueConstraint("environment", name="uq_quickbooks_connection_environment"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # sandbox | production: which of Intuit's two worlds the tokens belong to.
    environment: Mapped[str] = mapped_column(String(20), nullable=False)
    # Intuit's id for the QuickBooks company; part of every request.
    realm_id: Mapped[str] = mapped_column(String(40), nullable=False)
    company_name: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    access_token_enc: Mapped[str] = mapped_column(Text, nullable=False)
    # Intuit replaces the refresh token as it is used; the newest one is the only one kept.
    refresh_token_enc: Mapped[str] = mapped_column(Text, nullable=False)
    access_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    refresh_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    connected_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Intuit stopped accepting the tokens: a person has to connect again.
    needs_reconnect: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

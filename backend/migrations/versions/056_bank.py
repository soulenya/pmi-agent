"""bank_accounts, bank_transactions — what Gerry has read from the bank

Revision ID: 056
Revises: 055
Create Date: 2026-11-20 00:00:00.000000

Read-only copies of the company's bank accounts (name, last four digits, last
balances) and their posted transactions, kept on the hub (brand feature
``finance``) and shown only to people on the finance list. Each account row
records the bank environment it came from, so sandbox data stays apart from
real data. ``dedupe_key`` makes a repeated sync add nothing.

Empty on a desktop, and on a hub whose brand does not read a bank.
"""
from __future__ import annotations

from alembic import op
from migrations._roles import APP_ROLE

# revision identifiers, used by Alembic.
revision = "056"
down_revision = "055"
branch_labels = None
depends_on = None

_TABLES = ("bank_accounts", "bank_transactions")


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS bank_accounts (
            id                 uuid PRIMARY KEY,
            provider           varchar(20) NOT NULL DEFAULT 'usbank',
            environment        varchar(20) NOT NULL,
            external_id        varchar(100) NOT NULL,
            name               varchar(300) NOT NULL DEFAULT '',
            last4              varchar(4) NOT NULL DEFAULT '',
            account_type       varchar(40) NOT NULL DEFAULT '',
            bank_name          varchar(200) NOT NULL DEFAULT '',
            currency           varchar(8) NOT NULL DEFAULT 'USD',
            ledger_balance     numeric(18, 2),
            available_balance  numeric(18, 2),
            balance_as_of      date,
            synced_at          timestamptz,
            created_at         timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_bank_account_external UNIQUE (provider, environment, external_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS bank_transactions (
            id            uuid PRIMARY KEY,
            account_id    uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
            posted_on     date NOT NULL,
            amount        numeric(18, 2) NOT NULL,
            currency      varchar(8) NOT NULL DEFAULT 'USD',
            kind          varchar(60) NOT NULL DEFAULT '',
            description   text NOT NULL DEFAULT '',
            counterparty  varchar(300) NOT NULL DEFAULT '',
            reference     varchar(100) NOT NULL DEFAULT '',
            dedupe_key    varchar(64) NOT NULL,
            raw           jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at    timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_bank_transaction_dedupe UNIQUE (account_id, dedupe_key)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_bank_transactions_account_id ON bank_transactions (account_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_bank_transactions_posted_on ON bank_transactions (posted_on)")
    for table in _TABLES:
        op.execute(
            f"""
            DO $$ BEGIN
                IF EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                    ALTER TABLE {table} OWNER TO {APP_ROLE};
                END IF;
            END $$;
            """
        )


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table}")

"""budgets table — personal Drive-backed budgets

Each budget's system of record is a Google Sheet on the user's Drive
(created by Little Gerry → writable under drive.file). This table is the
LINK + MIRROR: drive file id, permissions (gerry_write_enabled), and a
parsed cache so the Budget page and chat reads are instant. The sheet is
authoritative on every conflict.

Revision ID: 020
Revises: 019
Create Date: 2026-07-21 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS budgets (
            id                  uuid PRIMARY KEY,
            user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title               varchar(200) NOT NULL,
            drive_file_id       varchar(255) NOT NULL,
            drive_url           varchar(1000) NOT NULL DEFAULT '',
            allotment           numeric(14, 2),
            currency            varchar(8) NOT NULL DEFAULT 'USD',
            gerry_write_enabled boolean NOT NULL DEFAULT FALSE,
            external_readonly   boolean NOT NULL DEFAULT FALSE,
            cached_ledger       jsonb NOT NULL DEFAULT '[]'::jsonb,
            cached_categories   jsonb NOT NULL DEFAULT '[]'::jsonb,
            cached_summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
            drive_modified_at   varchar(64),
            cached_at           timestamptz,
            created_at          timestamptz NOT NULL DEFAULT now(),
            updated_at          timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_budgets_user_id ON budgets (user_id)")
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pmi_app') THEN
                ALTER TABLE budgets OWNER TO pmi_app;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS budgets")

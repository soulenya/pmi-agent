"""budget_folders + budgets.gmail_check_enabled — Phase 6 interconnects

A budget can link Drive folders (invoices / receipts). Gerry scans them
READ-ONLY: lists files, extracts vendor/date/amount (text or OCR via a
temp app-created Google Doc), and proposes ledger entries as accept/dismiss
suggestions — never a silent write, sources never modified. scanned_files
is the per-folder registry that prevents re-processing.

Revision ID: 021
Revises: 020
Create Date: 2026-07-22 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS budget_folders (
            id            uuid PRIMARY KEY,
            budget_id     uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
            kind          varchar(20) NOT NULL DEFAULT 'invoice',
            folder_id     varchar(255) NOT NULL,
            folder_name   varchar(500) NOT NULL DEFAULT '',
            folder_url    varchar(1000) NOT NULL DEFAULT '',
            auto_scan     boolean NOT NULL DEFAULT FALSE,
            scanned_files jsonb NOT NULL DEFAULT '{}'::jsonb,
            last_scan_at  timestamptz,
            created_at    timestamptz NOT NULL DEFAULT now(),
            updated_at    timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_budget_folders_budget_id ON budget_folders (budget_id)"
    )
    op.execute(
        "ALTER TABLE budgets ADD COLUMN IF NOT EXISTS gmail_check_enabled boolean NOT NULL DEFAULT FALSE"
    )
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pmi_app') THEN
                ALTER TABLE budget_folders OWNER TO pmi_app;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS budget_folders")
    op.execute("ALTER TABLE budgets DROP COLUMN IF EXISTS gmail_check_enabled")

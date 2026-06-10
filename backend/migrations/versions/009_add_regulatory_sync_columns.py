"""regulatory_nodes Google Drive selective-sync columns

Adds source-update tracking columns to regulatory_nodes so the Regulatory
file explorer can detect Drive-side changes (modified / renamed / deleted)
and let the user selectively re-import individual files — mirroring the
Knowledge Base sync, but with per-file user confirmation (regulated section).

Revision ID: 009
Revises: 008
Create Date: 2026-06-09 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE regulatory_nodes "
        "ADD COLUMN IF NOT EXISTS sync_status varchar(20)"
    )
    op.execute(
        "ALTER TABLE regulatory_nodes "
        "ADD COLUMN IF NOT EXISTS sync_detail text"
    )
    op.execute(
        "ALTER TABLE regulatory_nodes "
        "ADD COLUMN IF NOT EXISTS source_name varchar(500)"
    )
    op.execute(
        "ALTER TABLE regulatory_nodes "
        "ADD COLUMN IF NOT EXISTS last_checked_at timestamptz"
    )
    op.execute(
        "ALTER TABLE regulatory_nodes "
        "ADD COLUMN IF NOT EXISTS last_synced_at timestamptz"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_regulatory_nodes_sync_status "
        "ON regulatory_nodes (sync_status)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_regulatory_nodes_sync_status")
    op.execute("ALTER TABLE regulatory_nodes DROP COLUMN IF EXISTS last_synced_at")
    op.execute("ALTER TABLE regulatory_nodes DROP COLUMN IF EXISTS last_checked_at")
    op.execute("ALTER TABLE regulatory_nodes DROP COLUMN IF EXISTS source_name")
    op.execute("ALTER TABLE regulatory_nodes DROP COLUMN IF EXISTS sync_detail")
    op.execute("ALTER TABLE regulatory_nodes DROP COLUMN IF EXISTS sync_status")

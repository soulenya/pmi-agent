"""add_document_sync_tracking

Adds columns used to detect and flag source (Google Drive) updates for
documents: sync_status, source_modified_at, last_checked_at, sync_detail.

Revision ID: 003
Revises: 002
Create Date: 2026-06-09 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS sync_status varchar(20)")
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_modified_at timestamptz")
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS last_checked_at timestamptz")
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS sync_detail text")
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_name varchar(500)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_documents_sync_status ON documents (sync_status)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_documents_sync_status")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS source_name")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS sync_detail")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS last_checked_at")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS source_modified_at")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS sync_status")

"""notifications.payload — a free-form pointer for kinds whose target is not a UUID

Revision ID: 048
Revises: 047
Create Date: 2026-09-18 00:00:00.000000

A new-email notification points at a Gmail thread, whose id is a hex string,
not a UUID; entity_id cannot hold it.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS payload jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS payload")

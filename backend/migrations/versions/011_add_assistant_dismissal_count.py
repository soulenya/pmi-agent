"""assistant_suggestions.dismissal_count

Tracks how many times the user has dismissed a given source's suggestion. The
daily scan resurfaces an item dismissed only once (so an accidental dismissal
is not permanent) but suppresses it once it has been dismissed at least twice.

Revision ID: 011
Revises: 010
Create Date: 2026-06-17 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE assistant_suggestions
        ADD COLUMN IF NOT EXISTS dismissal_count integer NOT NULL DEFAULT 0
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE assistant_suggestions DROP COLUMN IF EXISTS dismissal_count"
    )

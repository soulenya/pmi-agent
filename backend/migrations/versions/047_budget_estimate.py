"""budgets.cached_estimate — the cost plan mirrored from the Estimate tab

Revision ID: 047
Revises: 046
Create Date: 2026-09-18 00:00:00.000000

One JSONB list per budget: the parsed lines of the sheet's Estimate tab.
The totals live under cached_summary["estimate"], so no second column.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE budgets ADD COLUMN IF NOT EXISTS cached_estimate jsonb NOT NULL DEFAULT '[]'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE budgets DROP COLUMN IF EXISTS cached_estimate")

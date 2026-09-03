"""attach a budget to a project

Revision ID: 040
Revises: 039
Create Date: 2026-09-03 00:00:00.000000

Nullable and ON DELETE SET NULL: a budget is a link to a Drive sheet that
exists whether or not any project claims it, so losing the project must not
lose the budget.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE budgets
        ADD COLUMN IF NOT EXISTS project_id uuid
        REFERENCES projects(id) ON DELETE SET NULL
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_budgets_project_id ON budgets (project_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_budgets_project_id")
    op.execute("ALTER TABLE budgets DROP COLUMN IF EXISTS project_id")

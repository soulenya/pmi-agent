"""scheduled_tasks.workroom_id — standing room tasks

A scheduled task bound to a workroom runs inside the room's conversation
(inheriting the WORKROOM CONTEXT block) and journals each successful run.

Revision ID: 015
Revises: 014
Create Date: 2026-07-17 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE scheduled_tasks
        ADD COLUMN IF NOT EXISTS workroom_id uuid
            REFERENCES workrooms(id) ON DELETE SET NULL
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_scheduled_tasks_workroom_id "
        "ON scheduled_tasks (workroom_id)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE scheduled_tasks DROP COLUMN IF EXISTS workroom_id")

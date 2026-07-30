"""scheduled_tasks.last_run_files — verified generated files from the last run

The run output is truncated to 4,000 chars for display, which can cut off the
/api/files/... links a report ends with. This column records the file names the
run actually produced (verified present on disk at the end of the run) so the
Scheduled Tasks page can offer Download / Open in Workspace / Add to KB / Pin
without re-parsing truncated text.

Revision ID: 026
Revises: 025
Create Date: 2026-07-30 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS last_run_files jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE scheduled_tasks DROP COLUMN IF EXISTS last_run_files")

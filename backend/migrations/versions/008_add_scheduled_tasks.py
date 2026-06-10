"""scheduled_tasks table for recurring agent tasks

Adds:
- scheduled_tasks table — one row per recurring instruction the user asks
  Little Gerry to perform on a schedule (daily/weekly/monthly at a local time).
  A background loop runs each task whose next_run_at has passed.

Revision ID: 008
Revises: 007
Create Date: 2026-06-09 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id),
            title varchar(255) NOT NULL,
            prompt text NOT NULL,
            frequency varchar(20) NOT NULL DEFAULT 'weekly',
            day_of_week integer,
            day_of_month integer,
            hour integer NOT NULL DEFAULT 8,
            minute integer NOT NULL DEFAULT 0,
            enabled boolean NOT NULL DEFAULT true,
            next_run_at timestamptz,
            last_run_at timestamptz,
            last_run_status varchar(20),
            last_run_output text,
            conversation_id uuid,
            run_count integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_scheduled_tasks_user_id "
        "ON scheduled_tasks (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_scheduled_tasks_enabled "
        "ON scheduled_tasks (enabled)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_scheduled_tasks_next_run_at "
        "ON scheduled_tasks (next_run_at)"
    )
    # Hand ownership to the runtime role so the app (pmi_app) can access it.
    op.execute("ALTER TABLE scheduled_tasks OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS scheduled_tasks")

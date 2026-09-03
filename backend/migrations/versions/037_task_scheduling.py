"""task scheduling and dependencies (Project Space phase 1a)

Revision ID: 037
Revises: 036
Create Date: 2026-09-03 00:00:00.000000

`due_date` stays what it always was — the date a task must be done by. Planned
work gets its own `start_date`/`end_date` so a bar can be drawn without
overloading a field the rest of the app already reads.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE tasks
            ADD COLUMN IF NOT EXISTS start_date   timestamptz,
            ADD COLUMN IF NOT EXISTS end_date     timestamptz,
            ADD COLUMN IF NOT EXISTS progress_pct integer NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS is_milestone boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS sort_order   integer NOT NULL DEFAULT 0
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tasks_project_sort ON tasks (project_id, sort_order)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS task_dependencies (
            id              uuid PRIMARY KEY,
            predecessor_id  uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            successor_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            kind            varchar(2) NOT NULL DEFAULT 'FS',
            lag_days        integer NOT NULL DEFAULT 0,
            created_by      uuid REFERENCES users(id),
            created_at      timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_task_dependency UNIQUE (predecessor_id, successor_id),
            CONSTRAINT ck_task_dependency_not_self CHECK (predecessor_id <> successor_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_task_dependencies_successor"
        " ON task_dependencies (successor_id)"
    )
    op.execute("ALTER TABLE task_dependencies OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS task_dependencies")
    op.execute("DROP INDEX IF EXISTS ix_tasks_project_sort")
    op.execute(
        """
        ALTER TABLE tasks
            DROP COLUMN IF EXISTS start_date,
            DROP COLUMN IF EXISTS end_date,
            DROP COLUMN IF EXISTS progress_pct,
            DROP COLUMN IF EXISTS is_milestone,
            DROP COLUMN IF EXISTS sort_order
        """
    )

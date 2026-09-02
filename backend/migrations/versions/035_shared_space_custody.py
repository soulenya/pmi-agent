"""custody of items created in a shared project space

Revision ID: 035
Revises: 034
Create Date: 2026-09-01 00:00:00.000000

Work started in a shared space belongs to that space until it is deliberately
let go. Recording custody as its own row rather than a flag on each table means
the rule is written once and reads the same for a task, a document or anything
added later, and that releasing something leaves a trace of who released it and
when instead of silently clearing a boolean.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project_item_custody (
            id           uuid PRIMARY KEY,
            project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            item_type    varchar(32) NOT NULL,
            item_id      uuid NOT NULL,
            created_at   timestamptz NOT NULL DEFAULT now(),
            created_by   uuid REFERENCES users(id),
            released_at  timestamptz,
            released_by  uuid REFERENCES users(id),
            release_note text
        )
        """
    )
    # One holder at a time. Released rows stay as history, so the uniqueness
    # only applies while custody is live.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_project_item_custody_held
        ON project_item_custody (item_type, item_id)
        WHERE released_at IS NULL
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_project_item_custody_project "
        "ON project_item_custody (project_id)"
    )

    # Tasks already sitting in a shared or company project were created there,
    # so they are already under that project's custody - recording it now keeps
    # the rule from applying only to work created after this migration.
    op.execute(
        """
        INSERT INTO project_item_custody
            (id, project_id, item_type, item_id, created_at, created_by)
        SELECT gen_random_uuid(), p.id, 'task', t.id,
               COALESCE(t.created_at, now()), t.created_by
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE p.visibility IN ('shared', 'company')
        ON CONFLICT DO NOTHING
        """
    )

    op.execute("ALTER TABLE project_item_custody OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS project_item_custody")

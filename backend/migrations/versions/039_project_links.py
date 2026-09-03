"""links between projects, with gates (Project Space phase 2)

Revision ID: 039
Revises: 038
Create Date: 2026-09-03 00:00:00.000000

A link reads from -> to as a sentence: "A depends_on B", "A gates B".
Only `gates` carries a condition, and that condition is a milestone task.
"""

from __future__ import annotations

from alembic import op

revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS project_links (
            id              uuid PRIMARY KEY,
            from_project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            to_project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            kind            varchar(20) NOT NULL DEFAULT 'depends_on',
            gate_task_id    uuid REFERENCES tasks(id) ON DELETE SET NULL,
            note            text NOT NULL DEFAULT '',
            status          varchar(20) NOT NULL DEFAULT 'open',
            satisfied_at    timestamptz,
            created_by      uuid REFERENCES users(id),
            created_at      timestamptz NOT NULL DEFAULT now(),
            updated_at      timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_project_link UNIQUE (from_project_id, to_project_id, kind),
            CONSTRAINT ck_project_link_not_self CHECK (from_project_id <> to_project_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_project_links_from
        ON project_links (from_project_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_project_links_to
        ON project_links (to_project_id)
    """)
    op.execute("ALTER TABLE project_links OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS project_links")

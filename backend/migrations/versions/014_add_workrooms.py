"""workrooms tables

Workrooms are persistent per-user co-work spaces: a goal + pinned artifacts +
a dedicated conversation + a progress journal. Items reference artifacts by
kind + ref_id (Drive file IDs, KB document UUIDs, generated filenames, Gmail
thread IDs, task UUIDs, Odoo records, regulatory file IDs) — loose references
by design, matching the local-first architecture.

Revision ID: 014
Revises: 013
Create Date: 2026-07-17 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS workrooms (
            id              uuid PRIMARY KEY,
            user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title           varchar(200) NOT NULL,
            goal            text NOT NULL DEFAULT '',
            status          varchar(20) NOT NULL DEFAULT 'active',
            conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
            created_at      timestamptz NOT NULL DEFAULT now(),
            updated_at      timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_workrooms_user_id ON workrooms (user_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workrooms_conversation_id ON workrooms (conversation_id)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS workroom_items (
            id          uuid PRIMARY KEY,
            workroom_id uuid NOT NULL REFERENCES workrooms(id) ON DELETE CASCADE,
            kind        varchar(30) NOT NULL,
            ref_id      varchar(500) NOT NULL DEFAULT '',
            label       varchar(300) NOT NULL,
            created_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workroom_items_workroom_id ON workroom_items (workroom_id)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS workroom_journal (
            id          uuid PRIMARY KEY,
            workroom_id uuid NOT NULL REFERENCES workrooms(id) ON DELETE CASCADE,
            entry       text NOT NULL,
            created_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workroom_journal_workroom_id ON workroom_journal (workroom_id)"
    )
    # Hand ownership to the runtime role so the app (pmi_app) can access them.
    op.execute("ALTER TABLE workrooms OWNER TO pmi_app")
    op.execute("ALTER TABLE workroom_items OWNER TO pmi_app")
    op.execute("ALTER TABLE workroom_journal OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS workroom_journal")
    op.execute("DROP TABLE IF EXISTS workroom_items")
    op.execute("DROP TABLE IF EXISTS workrooms")

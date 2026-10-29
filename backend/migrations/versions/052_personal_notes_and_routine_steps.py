"""personal_notes — what one person told Gerry to remember; routine steps and links

Revision ID: 052
Revises: 051
Create Date: 2026-10-29 00:00:00.000000

One row per note, owned by one person. Every read filters on user_id; there
is no sharing column because there is no sharing. Archived notes keep their
row with archived_at set so "undo" is possible.

scheduled_tasks gains ``steps`` (the routine's procedure: do / if-then-
otherwise, as JSON) and ``last_run_links`` (every Drive and web link the last
run produced, gathered from tool results rather than the model's closing
text, so a report written straight to Drive is reachable from Today).
"""
from __future__ import annotations

from alembic import op
from migrations._roles import APP_ROLE

# revision identifiers, used by Alembic.
revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS personal_notes (
            id               uuid PRIMARY KEY,
            user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content          text NOT NULL,
            source           varchar(20) NOT NULL DEFAULT 'text',
            conversation_id  uuid,
            created_at       timestamptz NOT NULL DEFAULT now(),
            updated_at       timestamptz NOT NULL DEFAULT now(),
            archived_at      timestamptz
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_personal_notes_user_id ON personal_notes (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_personal_notes_created_at ON personal_notes (created_at)"
    )
    op.execute(
        f"""
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                ALTER TABLE personal_notes OWNER TO {APP_ROLE};
            END IF;
        END $$;
        """
    )
    op.execute("ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS steps jsonb")
    op.execute("ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS last_run_links jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE scheduled_tasks DROP COLUMN IF EXISTS last_run_links")
    op.execute("ALTER TABLE scheduled_tasks DROP COLUMN IF EXISTS steps")
    op.execute("DROP TABLE IF EXISTS personal_notes")
